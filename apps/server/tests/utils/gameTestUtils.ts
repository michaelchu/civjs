import { GameManager } from '@game/managers/GameManager';
import { Server as SocketServer } from 'socket.io';
import { createBasicGameScenario, TestGameScenario } from '../fixtures/gameFixtures';
import { clearAllTables } from './testDatabase';

/**
 * Creates a mock Socket.IO server for tests
 */
export function createMockSocketServer(): SocketServer {
  const mockEmitter = {
    emit: jest.fn(),
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };

  const mockServer = {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue(mockEmitter),
    in: jest.fn().mockReturnValue(mockEmitter),
    sockets: {
      sockets: new Map(),
      adapter: { rooms: new Map() },
      emit: jest.fn(),
    },
    // Add any other Socket.IO Server methods that might be used
    on: jest.fn(),
    use: jest.fn(),
    engine: {
      generateId: jest.fn().mockReturnValue('mock-socket-id'),
    },
    adapter: {
      rooms: new Map(),
      sids: new Map(),
    },
  } as unknown as SocketServer;

  return mockServer;
}

/**
 * Sets up a game manager with a loaded game scenario for integration tests
 */
export async function setupGameManagerWithScenario(): Promise<{
  gameManager: GameManager;
  scenario: TestGameScenario;
  mockIo: SocketServer;
}> {
  // Clear database state
  await clearAllTables();

  // Reset GameManager singleton
  (GameManager as any).instance = null;

  // Create mock socket server
  const mockIo = createMockSocketServer();

  // Create game manager
  const gameManager = GameManager.getInstance(mockIo);

  // Create test scenario with map data
  const scenario = await createBasicGameScenario();

  // Load the game into the manager
  const gameInstance = await gameManager.loadGame(scenario.game.id);
  if (!gameInstance) {
    throw new Error('Failed to load game instance from test scenario');
  }

  // Ensure all managers have loaded their data
  await gameInstance.cityManager.loadCities();
  await gameInstance.unitManager.loadUnits();
  await gameInstance.researchManager.loadPlayerResearch();

  return { gameManager, scenario, mockIo };
}

/**
 * Cleans up game manager state after tests
 */
export function cleanupGameManager(gameManager?: GameManager): void {
  gameManager?.clearAllGames();
}

/**
 * Creates a simple game configuration for tests
 */
export function createTestGameConfig(overrides: Partial<any> = {}) {
  return {
    name: 'Integration Test Game',
    hostId: 'test-host-id',
    maxPlayers: 2,
    mapWidth: 20,
    mapHeight: 20,
    ruleset: 'classic',
    ...overrides,
  };
}
