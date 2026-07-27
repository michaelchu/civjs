import { gameClient } from '../GameClient';
import { useGameStore } from '../../store/gameStore';
import { vi } from 'vitest';

const jest = vi;

const { mockSocket } = vi.hoisted(() => ({
  mockSocket: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// Mock the game store
vi.mock('../../store/gameStore', () => ({
  useGameStore: {
    getState: vi.fn(),
    setState: vi.fn(),
  },
}));

describe('GameClient - Nation Selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (gameClient as unknown as { socket: typeof mockSocket }).socket = mockSocket;

    // Mock store state
    (useGameStore.getState as jest.Mock).mockReturnValue({
      updateGameState: jest.fn(),
      setClientState: jest.fn(),
    });

    // Reset socket
    mockSocket.emit.mockClear();
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'packet') {
        queueMicrotask(() => handler({ type: 5, data: { accepted: true } }));
      }
    });
  });

  describe('joinSpecificGame', () => {
    it('deduplicates concurrent joins for the same game', async () => {
      let joinCallback: ((response: { success: boolean; playerId: string }) => void) | undefined;
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          joinCallback = callback;
        }
      });

      const firstJoin = gameClient.joinSpecificGame('game-1', 'TestPlayer');
      const secondJoin = gameClient.joinSpecificGame('game-1', 'TestPlayer');

      expect(secondJoin).toBe(firstJoin);
      await vi.waitFor(() => {
        expect(mockSocket.emit.mock.calls.filter(([event]) => event === 'join_game')).toHaveLength(
          1
        );
      });

      joinCallback?.({ success: true, playerId: 'player-1' });
      await Promise.all([firstJoin, secondJoin]);
    });

    it('should pass selectedNation to server when joining a game', async () => {
      // Arrange
      const gameId = 'test-game-id';
      const playerName = 'TestPlayer';
      const selectedNation = 'american';

      // Mock successful server response
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          expect(_data).toEqual({
            gameId,
            playerName,
            selectedNation,
          });
          callback({
            success: true,
            playerId: 'player-123',
            assignedNation: 'american',
          });
        }
      });

      // Act
      await gameClient.joinSpecificGame(gameId, playerName, selectedNation);

      // Assert
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join_game',
        {
          gameId,
          playerName,
          selectedNation,
        },
        expect.any(Function)
      );
    });

    it('should default to random when no selectedNation provided', async () => {
      // Arrange
      const gameId = 'test-game-id';
      const playerName = 'TestPlayer';

      // Mock successful server response
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          expect(_data.selectedNation).toBe('random');
          callback({
            success: true,
            playerId: 'player-123',
            assignedNation: 'roman',
          });
        }
      });

      // Act
      await gameClient.joinSpecificGame(gameId, playerName);

      // Assert
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'join_game',
        {
          gameId,
          playerName,
          selectedNation: 'random',
        },
        expect.any(Function)
      );
    });

    it('should use assignedNation from server response in player data', async () => {
      // Arrange
      const gameId = 'test-game-id';
      const playerName = 'TestPlayer';
      const selectedNation = 'chinese';
      const assignedNation = 'chinese';

      const mockUpdateGameState = jest.fn();
      (useGameStore.getState as jest.Mock).mockReturnValue({
        updateGameState: mockUpdateGameState,
        setClientState: jest.fn(),
      });

      // Mock server response
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          callback({
            success: true,
            playerId: 'player-123',
            assignedNation,
          });
        }
      });

      // Act
      await gameClient.joinSpecificGame(gameId, playerName, selectedNation);

      // Assert
      expect(mockUpdateGameState).toHaveBeenCalledWith({
        currentPlayerId: 'player-123',
        players: {
          'player-123': expect.objectContaining({
            nation: assignedNation,
            name: playerName,
          }),
        },
        governments: expect.any(Object),
        phase: 'movement',
        turn: 1,
      });
    });

    it('should fallback to selectedNation when assignedNation not provided', async () => {
      // Arrange
      const gameId = 'test-game-id';
      const playerName = 'TestPlayer';
      const selectedNation = 'french';

      const mockUpdateGameState = jest.fn();
      (useGameStore.getState as jest.Mock).mockReturnValue({
        updateGameState: mockUpdateGameState,
        setClientState: jest.fn(),
      });

      // Mock server response without assignedNation
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          callback({
            success: true,
            playerId: 'player-123',
            // No assignedNation in response
          });
        }
      });

      // Act
      await gameClient.joinSpecificGame(gameId, playerName, selectedNation);

      // Assert
      expect(mockUpdateGameState).toHaveBeenCalledWith({
        currentPlayerId: 'player-123',
        players: {
          'player-123': expect.objectContaining({
            nation: selectedNation, // Should fallback to selectedNation
            name: playerName,
          }),
        },
        governments: expect.any(Object),
        phase: 'movement',
        turn: 1,
      });
    });

    it('should handle random nation assignment from server', async () => {
      // Arrange
      const gameId = 'test-game-id';
      const playerName = 'TestPlayer';
      const selectedNation = 'random';
      const assignedNation = 'german'; // Server assigned a specific nation

      const mockUpdateGameState = jest.fn();
      (useGameStore.getState as jest.Mock).mockReturnValue({
        updateGameState: mockUpdateGameState,
        setClientState: jest.fn(),
      });

      // Mock server response
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'join_game') {
          callback({
            success: true,
            playerId: 'player-123',
            assignedNation,
          });
        }
      });

      // Act
      await gameClient.joinSpecificGame(gameId, playerName, selectedNation);

      // Assert
      expect(mockUpdateGameState).toHaveBeenCalledWith({
        currentPlayerId: 'player-123',
        players: {
          'player-123': expect.objectContaining({
            nation: assignedNation, // Should use the randomly assigned nation
            name: playerName,
          }),
        },
        governments: expect.any(Object),
        phase: 'movement',
        turn: 1,
      });
    });
  });

  describe('createGame', () => {
    it('should pass selectedNation to server when creating a game', async () => {
      // Arrange
      const gameData = {
        gameName: 'Test Game',
        playerName: 'TestPlayer',
        gameType: 'single' as const,
        maxPlayers: 4,
        mapSize: 'standard',
        selectedNation: 'japanese',
      };

      // Mock authentication
      mockSocket.emit.mockImplementation((event, _data, callback) => {
        if (event === 'authenticate') {
          callback({ success: true, userId: 'user-123' });
        }
      });

      let packetHandlerCount = 0;
      mockSocket.on.mockImplementation((event, handler) => {
        if (event === 'packet') {
          packetHandlerCount += 1;
          queueMicrotask(() =>
            handler(
              packetHandlerCount === 1
                ? { type: 5, data: { accepted: true } }
                : {
                    type: 201,
                    data: { success: true, gameId: 'game-123', assignedNation: 'japanese' },
                  }
            )
          );
        }
      });

      // Act & Assert
      const gameIdPromise = gameClient.createGame(gameData);

      // Verify the packet sent includes selectedNation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockSocket.emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: 200, // GAME_CREATE
          data: expect.objectContaining({
            selectedNation: 'japanese',
          }),
        })
      );

      await expect(gameIdPromise).resolves.toBe('game-123');
    });
  });
});
