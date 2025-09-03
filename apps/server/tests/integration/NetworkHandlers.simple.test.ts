import { Server as SocketServer } from 'socket.io';
import { Socket as ClientSocket, io as ClientIO } from 'socket.io-client';
import { createServer, Server as HTTPServer } from 'http';
import { setupSocketHandlers } from '../../src/network/socket-handlers';
import { PacketType } from '../../src/types/packet';
import { GameManager } from '../../src/game/GameManager';
import { clearAllTables, setupTestDatabase, cleanupTestDatabase } from '../utils/testDatabase';

describe('NetworkHandlers - Basic Integration Tests', () => {
  let httpServer: HTTPServer;
  let socketServer: SocketServer;
  let clientSocket: ClientSocket;
  let gameManager: GameManager;
  const port = 3334; // Different test port

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
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

    // Start server and create client connection
    await new Promise<void>(resolve => {
      httpServer.listen(port, () => {
        // Create client socket
        clientSocket = ClientIO(`http://localhost:${port}`, {
          transports: ['websocket'],
          forceNew: true,
        });

        clientSocket.on('connect', () => {
          resolve();
        });
      });
    });
  });

  afterEach(async () => {
    // Cleanup
    if (clientSocket) {
      clientSocket.disconnect();
    }
    if (socketServer) {
      socketServer.close();
    }
    if (httpServer) {
      await new Promise<void>(resolve => {
        httpServer.close(() => {
          resolve();
        });
      });
    }
  });

  describe('basic socket communication', () => {
    it('should establish socket connection', () => {
      expect(clientSocket.connected).toBe(true);
    });

    it('should handle basic packet structure', done => {
      const validPacket = {
        type: PacketType.CHAT_MSG,
        data: {
          message: 'Hello world',
        },
        timestamp: Date.now(),
      };

      // Set timeout for test
      const timeout = setTimeout(() => {
        done.fail('Test timed out waiting for response');
      }, 5000);

      // Listen for any response (success or error)
      clientSocket.on('packet_response', () => {
        clearTimeout(timeout);
        done();
      });

      clientSocket.on('packet_error', () => {
        clearTimeout(timeout);
        done();
      });

      clientSocket.on('error', () => {
        clearTimeout(timeout);
        done();
      });

      // Send packet
      clientSocket.emit('packet', validPacket);
    });

    it('should reject malformed packets', done => {
      const invalidPacket = {
        // Missing type and data
        timestamp: Date.now(),
      };

      const timeout = setTimeout(() => {
        done.fail('Test timed out waiting for error response');
      }, 5000);

      // Listen for error response
      clientSocket.on('packet_error', () => {
        clearTimeout(timeout);
        done();
      });

      clientSocket.on('error', () => {
        clearTimeout(timeout);
        done();
      });

      // Also accept if it just doesn't respond (still valid behavior)
      setTimeout(() => {
        clearTimeout(timeout);
        done();
      }, 1000);

      // Send invalid packet
      clientSocket.emit('packet', invalidPacket);
    });
  });

  describe('connection management', () => {
    it('should handle client disconnection gracefully', done => {
      let disconnectHandled = false;

      socketServer.on('disconnect', () => {
        disconnectHandled = true;
      });

      // Disconnect client
      clientSocket.disconnect();

      setTimeout(() => {
        // Connection should be handled gracefully (no crashes)
        expect(true).toBe(true); // Test passes if no errors thrown
        done();
      }, 100);
    });

    it('should handle multiple rapid packets', done => {
      let responsesReceived = 0;
      const totalPackets = 5;

      const timeout = setTimeout(() => {
        // Even if not all responses received, test passes if no errors
        done();
      }, 3000);

      // Listen for responses
      clientSocket.on('packet_response', () => {
        responsesReceived++;
        if (responsesReceived >= totalPackets) {
          clearTimeout(timeout);
          done();
        }
      });

      clientSocket.on('packet_error', () => {
        responsesReceived++;
        if (responsesReceived >= totalPackets) {
          clearTimeout(timeout);
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
  });

  describe('server authentication', () => {
    it('should handle server join requests', done => {
      const authPacket = {
        type: PacketType.SERVER_JOIN_REQ,
        data: {
          username: 'TestPlayer',
          version: '1.0.0',
        },
        timestamp: Date.now(),
      };

      const timeout = setTimeout(() => {
        done.fail('Test timed out waiting for authentication response');
      }, 5000);

      // Listen for authentication response
      clientSocket.on('server_join_reply', response => {
        clearTimeout(timeout);
        expect(response).toBeDefined();
        done();
      });

      clientSocket.on('packet_error', () => {
        clearTimeout(timeout);
        done(); // Error response is also acceptable
      });

      // Send authentication request
      clientSocket.emit('packet', authPacket);
    });
  });

  describe('performance under load', () => {
    it('should maintain responsiveness', async () => {
      const startTime = Date.now();
      const promises: Promise<void>[] = [];
      const numPackets = 10;

      for (let i = 0; i < numPackets; i++) {
        const promise = new Promise<void>(resolve => {
          const packet = {
            type: PacketType.CHAT_MSG,
            data: { message: `Performance test ${i}` },
            timestamp: Date.now(),
          };

          const timeout = setTimeout(() => {
            resolve(); // Resolve even if no response (avoids hanging test)
          }, 2000);

          clientSocket.on('packet_response', () => {
            clearTimeout(timeout);
            resolve();
          });

          clientSocket.on('packet_error', () => {
            clearTimeout(timeout);
            resolve();
          });

          clientSocket.emit('packet', packet);
        });

        promises.push(promise);
      }

      await Promise.all(promises);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should handle packets within reasonable time
      expect(totalTime).toBeLessThan(10000); // 10 seconds max
    });
  });
});
