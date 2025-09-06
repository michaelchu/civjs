/**
 * Debug test specifically for Aztec nation selection issue
 */

import { PlayerConnectionManager } from '../src/game/orchestrators/PlayerConnectionManager';
import { DatabaseProvider } from '../src/database/DatabaseProvider';

// Mock logger
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock RulesetLoader
jest.mock('../src/shared/data/rulesets/RulesetLoader', () => ({
  RulesetLoader: {
    getInstance: jest.fn(() => ({
      loadNationsRuleset: jest.fn(() => ({
        nations: {
          american: { id: 'american', name: 'American' },
          aztec: { id: 'aztec', name: 'Aztec' },
          chinese: { id: 'chinese', name: 'Chinese' },
          roman: { id: 'roman', name: 'Roman' },
        },
      })),
    })),
  },
}));

describe('Debug Aztec Nation Issue', () => {
  let playerManager: PlayerConnectionManager;
  let mockDatabase: any;

  const mockGameId = 'test-game-id';
  const mockUserId = 'test-user-id';

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock database
    mockDatabase = {
      query: {
        games: {
          findFirst: jest.fn(),
        },
      },
      insert: jest.fn(),
    };

    const mockDbProvider = {
      getDatabase: jest.fn(() => mockDatabase),
    } as unknown as DatabaseProvider;

    playerManager = new PlayerConnectionManager(mockDbProvider);
  });

  it('should successfully assign Aztec nation when selected', async () => {
    // Arrange
    console.log('=== DEBUGGING AZTEC SELECTION ===');

    const selectedNation = 'aztec';
    console.log('User selected nation:', selectedNation);

    // Mock game with no existing players
    mockDatabase.query.games.findFirst.mockResolvedValue({
      id: mockGameId,
      status: 'waiting',
      maxPlayers: 4,
      players: [], // No existing players, so aztec should be available
    });

    // Mock successful player creation
    mockDatabase.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
      }),
    });

    // Act
    const result = await playerManager.joinGame(mockGameId, mockUserId, selectedNation);

    console.log('Result from joinGame:', result);
    console.log('Assigned nation:', result.assignedNation);

    // Assert
    expect(result.assignedNation).toBe('aztec');
    expect(result.playerId).toBe('new-player-id');

    // Verify the database insert was called with aztec nation
    const valuesCall = mockDatabase.insert().values.mock.calls[0][0];
    console.log('Database insert values:', valuesCall);
    expect(valuesCall.nation).toBe('aztec');
    expect(valuesCall.civilization).toBe('aztec');
  });

  it('should fallback to american if aztec is already taken', async () => {
    // Arrange
    console.log('=== DEBUGGING AZTEC ALREADY TAKEN ===');

    const selectedNation = 'aztec';
    console.log('User selected nation:', selectedNation);

    // Mock game with aztec already taken
    mockDatabase.query.games.findFirst.mockResolvedValue({
      id: mockGameId,
      status: 'waiting',
      maxPlayers: 4,
      players: [
        { id: 'existing-player', civilization: 'aztec' }, // Aztec already taken
      ],
    });

    // Mock successful player creation
    mockDatabase.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: 'new-player-id' }]),
      }),
    });

    // Act & Assert
    try {
      await playerManager.joinGame(mockGameId, mockUserId, selectedNation);
      fail('Should have thrown error for taken nation');
    } catch (error) {
      console.log('Expected error:', (error as Error).message);
      expect((error as Error).message).toBe('That nation is already in use.');
    }
  });

  it('should handle case sensitivity issues', async () => {
    // Arrange
    console.log('=== DEBUGGING CASE SENSITIVITY ===');

    const selectedNation = 'Aztec'; // Capital A
    console.log('User selected nation (with capital):', selectedNation);

    // Mock game with no existing players
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
    const result = await playerManager.joinGame(mockGameId, mockUserId, selectedNation);

    console.log('Result for capital Aztec:', result);
    console.log('Assigned nation:', result.assignedNation);

    // The nation should be normalized to lowercase
    expect(result.assignedNation).toBe('Aztec'); // Should preserve the input case
  });
});
