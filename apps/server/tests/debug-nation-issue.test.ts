/**
 * Debug test to reproduce the exact nation selection issue
 * This test simulates the real user flow that's causing "Random" to appear in status bar
 */

import { GameManagementHandler } from '@network/handlers/GameManagementHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';

// Mock dependencies
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Debug Nation Issue', () => {
  let handler: GameManagementHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let mockGameManager: jest.Mocked<GameManager>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockUsername = 'testuser';
  const mockGameId = 'test-game-id';
  const mockPlayerId = 'test-player-id';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create active connections map
    activeConnections = new Map();

    // Mock GameManager with real-world scenarios
    mockGameManager = {
      createGame: jest.fn(),
      joinGame: jest.fn(),
      startGame: jest.fn(),
      getGame: jest.fn(),
      getGameListForLobby: jest.fn(),
      deleteGame: jest.fn(),
      updatePlayerConnection: jest.fn(),
      getPlayerById: jest.fn(),
    } as any;

    // Mock PacketHandler
    mockPacketHandler = {
      register: jest.fn(),
      send: jest.fn(),
    } as any;

    // Mock Socket with emit spy
    mockSocket = {
      id: mockSocketId,
      join: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      data: {},
    } as any;

    mockIo = {} as any;

    // Create handler
    handler = new GameManagementHandler(activeConnections, mockGameManager);
    activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
  });

  describe('Reproduce Status Bar Random Issue', () => {
    it('should demonstrate the issue when user selects specific nation but gets random', async () => {
      // Arrange - User selects "American" when creating game
      const gameData = {
        name: 'Test Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'american', // User clearly selected American
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);

      // SIMULATE THE ISSUE: getPlayerById returns null (database timing issue)
      mockGameManager.getPlayerById.mockResolvedValue(null);

      handler.register(mockPacketHandler, mockIo, mockSocket);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act - Create game
      await handlerFn(mockSocket, gameData);

      // Assert - Check what the server sends to client
      console.log('=== DEBUGGING THE ISSUE ===');
      console.log('User selected nation:', gameData.selectedNation);
      console.log('getPlayerById returned:', null);

      const socketEmitCall = (mockSocket.emit as jest.Mock).mock.calls.find(
        call => call[0] === 'game_created'
      );

      const packetSendCall = (mockPacketHandler.send as jest.Mock).mock.calls[0];

      console.log('Socket emit assignedNation:', socketEmitCall?.[1]?.assignedNation);
      console.log('Packet send assignedNation:', packetSendCall?.[2]?.assignedNation);

      // This demonstrates the issue: when getPlayerById returns null,
      // the fallback logic uses selectedNation, which should work correctly.
      // But if there's another issue...

      expect(socketEmitCall[1].assignedNation).toBe('american');
      expect(packetSendCall[2].assignedNation).toBe('american');
    });

    it('should demonstrate the issue when user selects random but server fails to assign', async () => {
      // Arrange - User selects "random"
      const gameData = {
        name: 'Random Test Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'random', // User selected random
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);

      // SIMULATE THE ISSUE: getPlayerById returns null AND selectedNation is random
      mockGameManager.getPlayerById.mockResolvedValue(null);

      handler.register(mockPacketHandler, mockIo, mockSocket);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await handlerFn(mockSocket, gameData);

      // Assert
      console.log('=== DEBUGGING RANDOM SELECTION ISSUE ===');
      console.log('User selected:', gameData.selectedNation);
      console.log('getPlayerById returned:', null);

      const socketEmitCall = (mockSocket.emit as jest.Mock).mock.calls.find(
        call => call[0] === 'game_created'
      );

      const packetSendCall = (mockPacketHandler.send as jest.Mock).mock.calls[0];

      console.log('Socket emit assignedNation:', socketEmitCall?.[1]?.assignedNation);
      console.log('Packet send assignedNation:', packetSendCall?.[2]?.assignedNation);

      // This shows the fix! When:
      // 1. User selects "random"
      // 2. Server should assign specific nation but getPlayerById fails
      // 3. Original fallback was: playerData?.nation || data.selectedNation || 'random'
      // 4. Fixed: we never send 'random' as final nation, default to 'american'
      // 5. Client receives 'american' (our fix prevents 'random' from being sent)

      expect(socketEmitCall[1].assignedNation).toBe('american');
      expect(packetSendCall[2].assignedNation).toBe('american');
    });

    it('should show the correct behavior when everything works', async () => {
      // Arrange - User selects "random"
      const gameData = {
        name: 'Working Random Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'random',
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);

      // CORRECT BEHAVIOR: getPlayerById returns the actual assigned nation
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'chinese', // Server correctly assigned Chinese
        civilization: 'chinese',
      });

      handler.register(mockPacketHandler, mockIo, mockSocket);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await handlerFn(mockSocket, gameData);

      // Assert
      console.log('=== CORRECT BEHAVIOR ===');

      const socketEmitCall = (mockSocket.emit as jest.Mock).mock.calls.find(
        call => call[0] === 'game_created'
      );

      const packetSendCall = (mockPacketHandler.send as jest.Mock).mock.calls[0];

      console.log('User selected:', gameData.selectedNation);
      console.log('Server assigned:', 'chinese');
      console.log('Socket emit assignedNation:', socketEmitCall?.[1]?.assignedNation);
      console.log('Packet send assignedNation:', packetSendCall?.[2]?.assignedNation);

      expect(socketEmitCall[1].assignedNation).toBe('chinese');
      expect(packetSendCall[2].assignedNation).toBe('chinese');
    });
  });
});
