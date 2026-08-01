import { GameManager, type GameInstance } from '@game/managers/GameManager';
import { getTerrainMovementCost } from '@game/constants/MovementConstants';
import { Server as SocketServer } from 'socket.io';
import { createBasicGameScenario, TestGameScenario } from '../fixtures/gameFixtures';
import { clearAllTables, getTestDatabaseProvider } from './testDatabase';

/**
 * Creates a mock Socket.IO server for tests
 * This mock is designed to be robust against timing issues and async operations
 */
export function createMockSocketServer(): SocketServer {
  // Create persistent emit functions that won't lose references
  const mockEmit = jest.fn().mockName('socket.emit');
  const mockRoomEmit = jest.fn().mockName('room.emit');

  // Create a stable room object with persistent references
  const mockRoom = {
    emit: mockRoomEmit,
    to: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
  };

  // Make the room object non-enumerable to prevent garbage collection issues
  Object.defineProperty(mockRoom, '__stable', { value: true, enumerable: false });

  // Create stable functions that maintain closure over mockRoom
  const stableTo = jest.fn().mockImplementation((_room: string) => {
    // Always return the same room object to maintain reference stability
    return mockRoom;
  });

  const stableIn = jest.fn().mockImplementation((_room: string) => {
    return mockRoom;
  });

  const mockServer = {
    emit: mockEmit,
    to: stableTo,
    in: stableIn,
    sockets: {
      sockets: new Map(),
      adapter: { rooms: new Map() },
      emit: mockEmit,
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

  // Ensure the mock server maintains references to its methods
  Object.defineProperty(mockServer, '__mocks', {
    value: { emit: mockEmit, roomEmit: mockRoomEmit, room: mockRoom },
    enumerable: false,
  });

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

  // Create game manager with test database provider
  const testDbProvider = getTestDatabaseProvider();
  const gameManager = GameManager.getInstance(mockIo, testDbProvider);

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

function isSeparatedFromSites(
  game: GameInstance,
  sites: Array<{ x: number; y: number }>,
  x: number,
  y: number
): boolean {
  return sites.every(site => game.mapManager.getDistance(site.x, site.y, x, y) >= 3);
}

function collectMapSites(
  game: GameInstance,
  count: number,
  usable: (x: number, y: number, selected: Array<{ x: number; y: number }>) => boolean
): Array<{ x: number; y: number }> {
  const map = game.mapManager.getMapData();
  if (!map) throw new Error('Expected generated map data');
  const sites: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      if (sites.length === count) return sites;
      if (usable(x, y, sites)) sites.push({ x, y });
    }
  }
  return sites;
}

/** Select deterministic sites through the authoritative gameplay validator. */
export function findValidCitySites(
  game: GameInstance,
  playerId: string,
  count: number,
  reserved: Array<{ x: number; y: number }> = []
): Array<{ x: number; y: number }> {
  const sites = collectMapSites(game, count, (x, y, selected) => {
    if (!game.cityManager.canFoundCityAt(x, y, playerId)) return false;
    return isSeparatedFromSites(game, reserved, x, y) && isSeparatedFromSites(game, selected, x, y);
  });
  if (sites.length !== count) throw new Error(`Expected ${count} valid city sites`);
  return sites;
}

/** Select unoccupied native terrain for deterministic unit fixtures. */
export function findPassableUnitSites(
  game: GameInstance,
  unitTypeId: string,
  count: number,
  excluded: Array<{ x: number; y: number }> = []
): Array<{ x: number; y: number }> {
  const map = game.mapManager.getMapData();
  if (!map) throw new Error('Expected generated map data');
  const sites = collectMapSites(game, count, (x, y) => {
    if (excluded.some(site => site.x === x && site.y === y)) return false;
    if (game.unitManager.getUnitsAt(x, y).length > 0) return false;
    const terrain = map.tiles[x]?.[y]?.terrain ?? 'inaccessible';
    return getTerrainMovementCost(terrain, unitTypeId) >= 0;
  });
  if (sites.length !== count) throw new Error(`Expected ${count} passable ${unitTypeId} sites`);
  return sites;
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
