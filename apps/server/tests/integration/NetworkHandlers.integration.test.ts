import { Server as SocketServer } from 'socket.io';
import { Socket as ClientSocket, io as ClientIO } from 'socket.io-client';
import { createServer, Server as HTTPServer } from 'http';
import { PacketHandler } from '../../src/network/PacketHandler';
import { setupSocketHandlers } from '../../src/network/socket-handlers';
import { PacketType } from '../../src/types/packet';
import { GameManager } from '../../src/game/GameManager';
import {
  getTestDatabase,
  clearAllTables,
  setupTestDatabase,
  cleanupTestDatabase,
} from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';

describe('NetworkHandlers - Integration Tests with Real Socket Communication', () => {
  let httpServer: HTTPServer;
  let socketServer: SocketServer;
  let clientSocket: ClientSocket;
  let gameManager: GameManager;
  const port = 3333; // Test port

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async done => {
    // Clear database and reset singleton
    await clearAllTables();
    (GameManager as any).instance = null;

    // Create HTTP server
    httpServer = createServer();

    // Create Socket.IO server
    socketServer = new SocketServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });

    // Initialize GameManager
    gameManager = GameManager.getInstance(socketServer);

    // Setup socket handlers
    socketServer.on('connection', socket => {
      setupSocketHandlers(socketServer, socket);
    });

    // Start server
    httpServer.listen(port, () => {
      // Create client socket
      clientSocket = ClientIO(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      clientSocket.on('connect', () => {
        done();
      });
    });
  });

  afterEach(done => {
    // Cleanup
    if (clientSocket) {
      clientSocket.disconnect();
    }
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      httpServer.close(() => {
        done();
      });
    } else {
      done();
    }
  });

  describe('packet handling and validation', () => {
    it('should handle valid packets and validate schemas', done => {
      const validPacket = {
        type: PacketType.CHAT_MSG,
        data: {
          message: 'Hello world',
        },
        timestamp: Date.now(),
      };

      // Listen for response
      clientSocket.on('packet_response', response => {
        expect(response.success).toBeDefined();
        done();
      });

      // Send packet
      clientSocket.emit('packet', validPacket);
    });

    it('should reject invalid packet structures', done => {
      const invalidPacket = {
        // Missing type and data
        timestamp: Date.now(),
      };

      // Listen for error response
      clientSocket.on('packet_error', error => {
        expect(error.message).toContain('Invalid packet');
        done();
      });

      // Send invalid packet
      clientSocket.emit('packet', invalidPacket);
    });

    it('should handle packet sequence numbers correctly', done => {
      let responseCount = 0;

      const packet1 = {
        type: PacketType.CHAT_MSG,
        data: { message: 'First message' },
        seq: 1,
        timestamp: Date.now(),
      };

      const packet2 = {
        type: PacketType.CHAT_MSG,
        data: { message: 'Second message' },
        seq: 2,
        timestamp: Date.now(),
      };

      // Listen for responses
      clientSocket.on('packet_response', () => {
        responseCount++;
        if (responseCount === 2) {
          done();
        }
      });

      // Send packets in sequence
      clientSocket.emit('packet', packet1);
      setTimeout(() => {
        clientSocket.emit('packet', packet2);
      }, 10);
    });
  });

  describe('game communication integration', () => {
    let scenario: any;
    let playerId: string;

    beforeEach(async () => {
      // Create game scenario
      scenario = await createBasicGameScenario();
      playerId = scenario.players[0].id;

      // Load game into GameManager
      await gameManager.loadGame(scenario.game.id);
    });

    it('should handle unit movement commands through socket', done => {
      const game = gameManager.getGameInstance(scenario.game.id);
      const unit = Array.from(game!.unitManager.getPlayerUnits(playerId))[0];

      const movePacket = {
        type: PacketType.UNIT_MOVE,
        data: {
          gameId: scenario.game.id,
          unitId: unit.id,
          targetX: unit.x + 1,
          targetY: unit.y,
        },
        timestamp: Date.now(),
      };

      // Listen for movement response
      clientSocket.on('unit_moved', response => {
        expect(response.unitId).toBe(unit.id);
        expect(response.newX).toBe(unit.x + 1);
        expect(response.newY).toBe(unit.y);

        // Verify unit actually moved in game
        const movedUnit = game!.unitManager.getUnit(unit.id);
        expect(movedUnit!.x).toBe(unit.x + 1);
        expect(movedUnit!.y).toBe(unit.y);

        done();
      });

      // Send move command
      clientSocket.emit('packet', movePacket);
    });

    it('should broadcast game state changes to all players', done => {
      // Create second client socket
      const client2Socket = ClientIO(`http://localhost:${port}`, {
        transports: ['websocket'],
        forceNew: true,
      });

      client2Socket.on('connect', () => {
        const game = gameManager.getGameInstance(scenario.game.id);
        const unit = Array.from(game!.unitManager.getPlayerUnits(playerId))[0];

        let broadcastReceived = false;

        // Second client listens for broadcasts
        client2Socket.on('game_state_update', update => {
          expect(update.gameId).toBe(scenario.game.id);
          broadcastReceived = true;
          client2Socket.disconnect();
          if (broadcastReceived) done();
        });

        // First client makes a move
        const movePacket = {
          type: PacketType.UNIT_MOVE,
          data: {
            gameId: scenario.game.id,
            unitId: unit.id,
            targetX: unit.x + 1,
            targetY: unit.y,
          },
          timestamp: Date.now(),
        };

        clientSocket.emit('packet', movePacket);
      });
    });

    it('should handle turn management through socket communication', done => {
      const turnEndPacket = {
        type: PacketType.TURN_END,
        data: {
          gameId: scenario.game.id,
          playerId: playerId,
        },
        timestamp: Date.now(),
      };

      // Listen for turn response
      clientSocket.on('turn_ended', response => {
        expect(response.playerId).toBe(playerId);
        expect(response.turnAdvanced).toBeDefined();
        done();
      });

      // Send turn end command
      clientSocket.emit('packet', turnEndPacket);
    });
  });

  describe('authentication and authorization', () => {
    it('should handle user authentication through sockets', done => {
      const authPacket = {
        type: PacketType.SERVER_JOIN_REQ,
        data: {
          username: 'TestPlayer',
          version: '1.0.0',
        },
        timestamp: Date.now(),
      };

      // Listen for authentication response
      clientSocket.on('server_join_reply', response => {
        expect(response.accepted).toBeDefined();
        if (response.accepted) {
          expect(response.userId).toBeDefined();
        }
        done();
      });

      // Send authentication request
      clientSocket.emit('packet', authPacket);
    });

    it('should reject unauthorized game actions', done => {
      const unauthorizedPacket = {
        type: PacketType.UNIT_MOVE,
        data: {
          gameId: scenario.game.id,
          unitId: 'fake-unit-id',
          targetX: 10,
          targetY: 10,
        },
        timestamp: Date.now(),
      };

      // Listen for error response
      clientSocket.on('action_error', error => {
        expect(error.message).toContain('unauthorized');
        done();
      });

      // Send unauthorized action
      clientSocket.emit('packet', unauthorizedPacket);
    });
  });

  describe('real-time game events and notifications', () => {
    let scenario: any;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      await gameManager.loadGame(scenario.game.id);
    });

    it('should broadcast city founding events to all players', done => {
      const game = gameManager.getGameInstance(scenario.game.id);
      const settlerUnit = Array.from(game!.unitManager.getPlayerUnits(scenario.players[0].id)).find(
        u => u.unitTypeId === 'settler'
      );

      if (!settlerUnit) {
        done();
        return;
      }

      const foundCityPacket = {
        type: PacketType.CITY_FOUND,
        data: {
          gameId: scenario.game.id,
          unitId: settlerUnit.id,
          cityName: 'New Test City',
        },
        timestamp: Date.now(),
      };

      // Listen for city founded broadcast
      clientSocket.on('city_founded', response => {
        expect(response.cityName).toBe('New Test City');
        expect(response.x).toBe(settlerUnit.x);
        expect(response.y).toBe(settlerUnit.y);
        done();
      });

      // Send found city command
      clientSocket.emit('packet', foundCityPacket);
    });

    it('should handle research progress updates', done => {
      const researchPacket = {
        type: PacketType.RESEARCH_SET,
        data: {
          gameId: scenario.game.id,
          playerId: scenario.players[0].id,
          techId: 'pottery',
        },
        timestamp: Date.now(),
      };

      // Listen for research update
      clientSocket.on('research_updated', response => {
        expect(response.playerId).toBe(scenario.players[0].id);
        expect(response.currentTech).toBe('pottery');
        done();
      });

      // Send research command
      clientSocket.emit('packet', researchPacket);
    });

    it('should handle chat messages and broadcast to game players', done => {
      const chatPacket = {
        type: PacketType.CHAT_MSG,
        data: {
          gameId: scenario.game.id,
          message: 'Hello from integration test!',
          playerId: scenario.players[0].id,
        },
        timestamp: Date.now(),
      };

      // Listen for chat broadcast
      clientSocket.on('chat_message_broadcast', response => {
        expect(response.message).toBe('Hello from integration test!');
        expect(response.playerId).toBe(scenario.players[0].id);
        expect(response.gameId).toBe(scenario.game.id);
        done();
      });

      // Send chat message
      clientSocket.emit('packet', chatPacket);
    });
  });

  describe('connection management and error handling', () => {
    it('should handle client disconnection gracefully', done => {
      const disconnectHandled = jest.fn();

      socketServer.on('disconnect', socket => {
        disconnectHandled();
      });

      // Disconnect client
      clientSocket.disconnect();

      setTimeout(() => {
        // Connection should be cleaned up
        expect(disconnectHandled).toHaveBeenCalled();
        done();
      }, 100);
    });

    it('should handle rapid successive packet sending', done => {
      let responsesReceived = 0;
      const totalPackets = 10;

      // Listen for responses
      clientSocket.on('packet_response', () => {
        responsesReceived++;
        if (responsesReceived === totalPackets) {
          done();
        }
      });

      // Send multiple packets rapidly
      for (let i = 0; i < totalPackets; i++) {
        const packet = {
          type: PacketType.CHAT_MSG,
          data: { message: `Message ${i}` },
          seq: i,
          timestamp: Date.now(),
        };
        clientSocket.emit('packet', packet);
      }
    });

    it('should handle malformed JSON gracefully', done => {
      // Listen for error response
      clientSocket.on('packet_error', error => {
        expect(error.message).toBeDefined();
        done();
      });

      // Send malformed data (this will be handled by socket.io parsing)
      clientSocket.emit('packet', 'invalid-json-string');
    });
  });

  describe('performance and load handling', () => {
    it('should handle concurrent connections efficiently', async () => {
      const numClients = 5;
      const clients: ClientSocket[] = [];
      const connectionPromises: Promise<void>[] = [];

      // Create multiple client connections
      for (let i = 0; i < numClients; i++) {
        const client = ClientIO(`http://localhost:${port}`, {
          transports: ['websocket'],
          forceNew: true,
        });

        clients.push(client);

        connectionPromises.push(
          new Promise<void>(resolve => {
            client.on('connect', resolve);
          })
        );
      }

      // Wait for all connections
      await Promise.all(connectionPromises);

      // Send packet from each client
      const responsePromises = clients.map((client, index) => {
        return new Promise<void>(resolve => {
          client.on('packet_response', resolve);

          const packet = {
            type: PacketType.CHAT_MSG,
            data: { message: `Message from client ${index}` },
            timestamp: Date.now(),
          };

          client.emit('packet', packet);
        });
      });

      // All should respond
      await Promise.all(responsePromises);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    it('should maintain responsiveness under packet load', done => {
      const startTime = Date.now();
      let responsesReceived = 0;
      const totalPackets = 50;

      clientSocket.on('packet_response', () => {
        responsesReceived++;
        if (responsesReceived === totalPackets) {
          const endTime = Date.now();
          const totalTime = endTime - startTime;

          // Should handle 50 packets within reasonable time (< 5 seconds)
          expect(totalTime).toBeLessThan(5000);
          done();
        }
      });

      // Send many packets
      for (let i = 0; i < totalPackets; i++) {
        const packet = {
          type: PacketType.CHAT_MSG,
          data: { message: `Load test message ${i}` },
          timestamp: Date.now(),
        };
        clientSocket.emit('packet', packet);
      }
    });
  });
});
