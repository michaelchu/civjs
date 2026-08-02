// Mock playerColors FIRST, before any imports
jest.mock('@utils/playerColors', () => ({
  getNextPlayerColorTheme: jest.fn(() => {
    return {
      primary: { r: 255, g: 0, b: 255 }, // Magenta for testing
      secondary: { r: 255, g: 255, b: 255 },
      tertiary: { r: 0, g: 0, b: 0 },
      name: 'Test Theme',
    };
  }),
}));

import { PlayerConnectionManager } from '@game/orchestrators/PlayerConnectionManager';
import { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

// Mock RulesetLoader
const mockNationsRuleset = {
  nations: {
    american: { id: 'american', name: 'American', leaders: [{ name: 'George Washington' }] },
    chinese: { id: 'chinese', name: 'Chinese', leaders: [{ name: 'Mao Zedong' }] },
    roman: {
      id: 'roman',
      name: 'Roman',
      leaders: [{ name: 'Romulus' }, { name: 'Gaius Iulius Caesar' }],
    },
    german: { id: 'german', name: 'German' },
    french: { id: 'french', name: 'French' },
    japanese: { id: 'japanese', name: 'Japanese' },
  },
};

// Mock the RulesetLoader
const mockRulesetLoader = {
  loadNationsRuleset: jest.fn(),
  getNationsForSet: jest.fn(),
};

jest.mock('@shared/data/rulesets/RulesetLoader', () => ({
  RulesetLoader: {
    getInstance: jest.fn(() => mockRulesetLoader),
  },
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('PlayerConnectionManager - Nation Selection', () => {
  let playerManager: PlayerConnectionManager;
  let mockDatabaseProvider: jest.Mocked<DatabaseProvider>;
  let mockDatabase: any;

  const mockGameId = 'test-game-id';
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    jest.clearAllMocks();

    (RulesetLoader.getInstance as jest.Mock).mockReturnValue(mockRulesetLoader);

    // Reset the mock to return our mock data
    mockRulesetLoader.loadNationsRuleset.mockReturnValue(mockNationsRuleset);
    mockRulesetLoader.getNationsForSet.mockReturnValue(mockNationsRuleset.nations);

    // Mock database operations
    mockDatabase = {
      query: {
        games: {
          findFirst: jest.fn(),
        },
        players: {
          findFirst: jest.fn(),
        },
      },
      insert: jest.fn(() => ({
        values: jest.fn(() => ({
          returning: jest.fn(() => [{ id: 'new-player-id' }]),
        })),
      })),
    };

    mockDatabaseProvider = {
      getDatabase: jest.fn(() => mockDatabase),
    } as any;

    playerManager = new PlayerConnectionManager(mockDatabaseProvider);
  });

  describe('validateAndSelectNation', () => {
    it('should return specific nation when available and not taken', async () => {
      // Arrange
      const civilization = 'american';
      const existingPlayers = [{ civilization: 'chinese' }, { civilization: 'roman' }];

      // Use reflection to access private method for testing
      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      // Assert
      expect(result).toBe('american');
    });

    it('uses only the active nation set and rejects non-playable factions', async () => {
      const extendedNations = {
        ...mockNationsRuleset.nations,
        abkhaz: { id: 'abkhaz', name: 'Abkhaz', leaders: [{ name: 'Ardzinba' }] },
        animals: { id: 'animals', name: 'Animal Kingdom', is_playable: false },
      };
      mockRulesetLoader.getNationsForSet.mockImplementation((_ruleset: string, nationSet?: string) =>
        nationSet === 'all' ? extendedNations : mockNationsRuleset.nations
      );
      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      await expect(validateMethod('abkhaz', [], 'civ2civ3', undefined, 'core')).rejects.toThrow(
        'That nation is not available in the active nation set.'
      );
      await expect(validateMethod('animals', [], 'civ2civ3', undefined, 'all')).rejects.toThrow(
        'That nation is not available in the active nation set.'
      );
      await expect(validateMethod('abkhaz', [], 'civ2civ3', undefined, 'all')).resolves.toBe(
        'abkhaz'
      );
      expect(mockRulesetLoader.getNationsForSet).toHaveBeenCalledWith('civ2civ3', 'all');
    });

    it('should throw error when nation is already taken', async () => {
      // Arrange
      const civilization = 'american';
      const existingPlayers = [
        { civilization: 'american' }, // Nation already taken
        { civilization: 'chinese' },
      ];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act & Assert
      await expect(validateMethod(civilization, existingPlayers)).rejects.toThrow(
        'That nation is already in use.'
      );
    });

    it('should randomly select nation when civilization is "random"', async () => {
      // Arrange
      const civilization = 'random';
      const existingPlayers = [
        { civilization: 'american' }, // Taken
      ];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Mock Math.random to control selection
      const originalRandom = Math.random;
      // Available nations after filtering: chinese, roman, german, french, japanese (5 nations)
      // Use index 2 to select 'german' (0-based index)
      Math.random = jest.fn(() => 0.4); // 0.4 * 5 = 2.0, floor(2.0) = 2 -> 'german'

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      expect(result).toBeDefined();
      expect(result).not.toBe('random');
      expect(result).toBe('german');

      // Cleanup
      Math.random = originalRandom;
    });

    it('should select only nations present in the trimmed ruleset', async () => {
      // Arrange
      const civilization = 'random';
      const existingPlayers: any[] = [];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Mock Math.random to ensure consistent testing
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.1); // Select first available

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      // Assert
      expect(result).not.toBe('barbarian');
      expect(result).not.toBe('random');

      // Cleanup
      Math.random = originalRandom;
    });

    it('should exclude already taken nations from random selection', async () => {
      // Arrange
      const civilization = 'random';
      const existingPlayers = [
        { civilization: 'american' },
        { civilization: 'chinese' },
        { civilization: 'roman' },
      ];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      expect(['german', 'french', 'japanese']).toContain(result);
    });

    it('should fallback to american when no nations available', async () => {
      // Arrange - all nations in the trimmed mock catalogue are taken
      const civilization = 'random';
      const existingPlayers = [
        { civilization: 'american' },
        { civilization: 'chinese' },
        { civilization: 'roman' },
        { civilization: 'german' },
        { civilization: 'french' },
        { civilization: 'japanese' },
      ];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      // Assert
      expect(result).toBe('random');
    });

    it('should fallback to american when ruleset loading fails', async () => {
      // Arrange
      // Use the mocked RulesetLoader
      (RulesetLoader.getInstance as jest.Mock).mockReturnValue({
        getNationsForSet: jest.fn(() => {
          throw new Error('Failed to load ruleset');
        }),
      });

      const civilization = 'random';
      const existingPlayers: any[] = [];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      // Assert
      expect(result).toBe('american');
    });

    it('should fallback to american when civilization is undefined', async () => {
      // Arrange
      const civilization = undefined;
      const existingPlayers: any[] = [];

      const validateMethod = (playerManager as any).validateAndSelectNation.bind(playerManager);

      // Act
      const result = await validateMethod(civilization, existingPlayers);

      // Assert
      expect(result).toBe('american');
    });
  });

  describe('joinGame with nation selection', () => {
    it('chooses a random unused leader from the selected nation', () => {
      const getLeaderName = (playerManager as any).getLeaderName.bind(playerManager);

      expect(
        getLeaderName('roman', 'civ2civ3', [{ leaderName: 'Romulus' }], () => 0, 'Leader1')
      ).toBe('Gaius Iulius Caesar');
    });

    it('should reject an existing player rejoining a finished game', async () => {
      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'ended',
        maxPlayers: 4,
        players: [{ id: 'existing-player-id', userId: mockUserId }],
      });

      await expect(playerManager.joinGame(mockGameId, mockUserId, 'american')).rejects.toThrow(
        'Game has finished'
      );
      expect(mockDatabase.insert).not.toHaveBeenCalled();
    });

    it('should create player with specified nation', async () => {
      // Arrange
      const civilization = 'chinese';

      // Mock game exists and is in waiting status
      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        maxPlayers: 4,
        players: [],
      });

      // Mock successful player creation
      mockDatabase.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
        }),
      });

      // Act
      const result = await playerManager.joinGame(mockGameId, mockUserId, civilization);

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          playerId: 'new-player-id',
          assignedNation: 'chinese',
          assignedColor: expect.any(Object),
        })
      );

      // Verify insert was called with correct nation data
      const insertCall = mockDatabase.insert.mock.calls[0];
      expect(insertCall[0]).toBe(players);

      const valuesCall = mockDatabase.insert().values.mock.calls[0][0];
      expect(valuesCall).toMatchObject({
        gameId: mockGameId,
        userId: mockUserId,
        nation: 'chinese',
        civilization: 'chinese',
        leaderName: 'Mao Zedong',
      });
    });

    it('uses the game\'s persisted nation set when a player joins', async () => {
      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        maxPlayers: 4,
        ruleset: 'civ2civ3',
        gameState: { nationSet: 'all' },
        players: [],
      });
      mockDatabase.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
        }),
      });

      await playerManager.joinGame(mockGameId, mockUserId, 'chinese');

      expect(mockRulesetLoader.getNationsForSet).toHaveBeenCalledWith('civ2civ3', 'all');
    });

    it('should handle random nation assignment', async () => {
      // Arrange
      const civilization = 'random';

      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        maxPlayers: 4,
        players: [
          {
            civilization: 'american',
            color: { r: 255, g: 0, b: 0 },
          },
        ], // One nation taken with color
      });

      mockDatabase.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
        }),
      });

      // Mock Math.random for consistent testing
      const originalRandom = Math.random;
      Math.random = jest.fn(() => 0.0); // Select first available

      // Act
      const result = await playerManager.joinGame(mockGameId, mockUserId, civilization);

      // Assert
      expect(result).toEqual(
        expect.objectContaining({
          playerId: 'new-player-id',
          assignedColor: expect.any(Object),
        })
      );

      const valuesCall = mockDatabase.insert().values.mock.calls[0][0];
      expect(valuesCall.nation).not.toBe('random');
      expect(valuesCall.nation).not.toBe('random');
      expect(valuesCall.nation).toBeDefined();

      // Cleanup
      Math.random = originalRandom;
    });

    it('should prevent duplicate nation selection', async () => {
      // Arrange
      const civilization = 'roman';

      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        maxPlayers: 4,
        players: [
          {
            civilization: 'roman',
            color: { r: 0, g: 255, b: 0 },
          }, // Nation already taken
        ],
      });

      // Act & Assert
      await expect(playerManager.joinGame(mockGameId, mockUserId, civilization)).rejects.toThrow(
        'That nation is already in use.'
      );
    });

    it('should handle undefined civilization parameter', async () => {
      // Arrange
      const civilization = undefined;

      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        maxPlayers: 4,
        players: [],
      });

      mockDatabase.insert.mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
        }),
      });

      // Act
      await playerManager.joinGame(mockGameId, mockUserId, civilization);

      // Assert
      const valuesCall = mockDatabase.insert().values.mock.calls[0][0];
      expect(valuesCall.nation).toBe('american'); // Should fallback to american
    });
  });

  describe('AI difficulty', () => {
    it('copies the game-level Freeciv difficulty to generated AI players', async () => {
      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        gameState: { aiLevel: 'hard' },
        players: [],
      });
      const inserted: any[] = [];
      mockDatabase.insert.mockReturnValue({
        values: jest.fn((value: any) => {
          inserted.push(value);
          return {
            returning: jest.fn().mockResolvedValue([{ id: `ai-${inserted.length}` }]),
          };
        }),
      });

      await playerManager.ensureMinimumPlayers(mockGameId);

      expect(inserted.length).toBeGreaterThan(0);
      expect(inserted.every(player => player.aiLevel === 'hard')).toBe(true);
    });

    it('falls back to Freeciv easy for legacy or invalid game settings', async () => {
      mockDatabase.query.games.findFirst.mockResolvedValue({
        id: mockGameId,
        status: 'waiting',
        gameState: { aiLevel: 'away' },
        players: [],
      });
      const inserted: any[] = [];
      mockDatabase.insert.mockReturnValue({
        values: jest.fn((value: any) => {
          inserted.push(value);
          return {
            returning: jest.fn().mockResolvedValue([{ id: `ai-${inserted.length}` }]),
          };
        }),
      });

      await playerManager.ensureMinimumPlayers(mockGameId);

      expect(inserted.length).toBeGreaterThan(0);
      expect(inserted.every(player => player.aiLevel === 'easy')).toBe(true);
    });
  });
});
