import { GameLifecycleManager } from '@game/orchestrators/GameLifecycleManager';
import { GameStateManager } from '@game/orchestrators/GameStateManager';
import { FreecivRandom } from '@game/random/FreecivRandom';
import { buildStoredGameConfig } from '@game/runtime/GameInstanceFactory';

// Minimal stubs for dependencies
const stubIo = {} as any;
const stubDb = { getDatabase: () => ({}) } as any;

function createManager(overrides?: {
  onBroadcast?: (gameId: string, event: string, data: any) => void;
  onPersistMapData?: (gameId: string, mapData: any, terrainSettings?: any) => Promise<void>;
  onCreateStartingUnits?: (
    gameId: string,
    mapData: any,
    unitManager: any,
    players: Map<string, any>
  ) => Promise<void>;
}) {
  const games = new Map<string, any>();
  const onBroadcast = overrides?.onBroadcast;
  const onPersistMapData = overrides?.onPersistMapData;
  const onCreateStartingUnits = overrides?.onCreateStartingUnits;

  return new GameLifecycleManager(
    stubIo,
    stubDb,
    games,
    onBroadcast,
    onPersistMapData,
    onCreateStartingUnits
  );
}

describe('GameLifecycleManager helper behavior', () => {
  test('maps landmass presets around Freeciv default landmass', () => {
    const manager = createManager();

    expect((manager as any).getLandPercent('sparse')).toBe(20);
    expect((manager as any).getLandPercent('normal')).toBe(30);
    expect((manager as any).getLandPercent('dense')).toBe(50);
    expect((manager as any).getLandPercent(undefined)).toBe(30);
  });

  test('stores the configured Freeciv seed and its warmed initial state', () => {
    const manager = createManager();

    const data = (manager as any).buildGameData(
      {
        name: 'seeded',
        hostId: 'host',
        randomSeed: 1234,
      },
      'classic'
    );

    expect(data.gameState.randomSeed).toBe(1234);
    expect(data.gameState.randomState).toEqual(new FreecivRandom(1234).getState());
  });

  test('stores resolved per-game research pacing', () => {
    const manager = createManager();

    const data = (manager as any).buildGameData(
      {
        name: 'slow research',
        hostId: 'host',
        researchPacing: { scienceBox: 150 },
      },
      'civ2civ3'
    );

    expect(data.gameState.researchPacing).toEqual({ scienceBox: 150, techPenalty: 100 });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/default/nationlist.ruleset:2-46
   * @reference reference/freeciv/common/nation.c:881-905
   * @assertion A c2c3 game's active nation set is resolved at creation and survives reconstruction from persisted game state.
   */
  test('persists the resolved Civ2Civ3 nation set for future joins and recovery', () => {
    const manager = createManager();
    const core = (manager as any).buildGameData(
      { name: 'core nations', hostId: 'host' },
      'civ2civ3'
    );
    const extended = (manager as any).buildGameData(
      { name: 'extended nations', hostId: 'host', nationSet: 'all' },
      'civ2civ3'
    );

    expect(core.gameState.nationSet).toBe('core');
    expect(extended.gameState.nationSet).toBe('all');
    expect(
      buildStoredGameConfig({
        name: 'extended nations',
        hostId: 'host',
        ruleset: 'civ2civ3',
        gameState: extended.gameState,
      })
    ).toMatchObject({ ruleset: 'civ2civ3', nationSet: 'all' });
  });

  test('uses a configured map seed when constructing a map manager for replayable games', () => {
    const manager = createManager();
    const terrainSettings = {
      generator: 'random',
      landmass: 'normal',
      huts: 15,
      temperature: 50,
      wetness: 50,
      rivers: 50,
      resources: 'normal',
    };

    const first = (manager as any).createMapManager(
      { mapWidth: 20, mapHeight: 20, mapSeed: 'ai-validation-seed' },
      terrainSettings
    );
    const second = (manager as any).createMapManager(
      { mapWidth: 20, mapHeight: 20, mapSeed: 'ai-validation-seed' },
      terrainSettings
    );

    expect(first.getSeed()).toBe('ai-validation-seed');
    expect(second.getSeed()).toBe(first.getSeed());
  });

  test('map persistence failures propagate to the game-start caller', async () => {
    const persistenceError = new Error('map write failed');
    const where = jest.fn().mockRejectedValue(persistenceError);
    const databaseProvider = {
      getDatabase: () => ({
        update: jest.fn(() => ({
          set: jest.fn(() => ({ where })),
        })),
      }),
    } as any;
    const stateManager = new GameStateManager(
      { info: jest.fn(), error: jest.fn(), debug: jest.fn() },
      databaseProvider
    );

    await expect(
      stateManager.persistMapData('g1', {
        width: 1,
        height: 1,
        seed: 'seed',
        generatedAt: new Date(0),
        startingPositions: [],
        tiles: [[{ terrain: 'ocean' }]],
      })
    ).rejects.toThrow('map write failed');
  });

  test('failed first-start initialization rolls generated state back to a retryable lobby', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const transactionDatabase = {
      delete: jest.fn(() => ({ where })),
      update: jest.fn(() => ({
        set: jest.fn(() => ({ where })),
      })),
    };
    const transaction = jest.fn(async callback => callback(transactionDatabase));
    const manager = new GameLifecycleManager(
      stubIo,
      { getDatabase: () => ({ transaction }) } as any,
      new Map()
    );

    await (manager as any).markGameStartFailed(
      'g1',
      {
        currentTurn: 0,
        startedAt: null,
        mapSeed: null,
        mapData: null,
        gameState: { terrainSettings: { generator: 'random' } },
        players: [
          {
            id: 'p1',
            gold: 0,
            technologies: [],
            currentResearch: null,
            researchProgress: 0,
            government: 'despotism',
            revolutionTurns: 0,
          },
        ],
      },
      new Error('map write failed')
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transactionDatabase.delete).toHaveBeenCalledTimes(5);
    expect(transactionDatabase.update).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(7);
  });

  test('deleteGame permanently removes a host-owned game', async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const deleteTable = jest.fn(() => ({ where }));
    const findFirst = jest.fn().mockResolvedValue({
      id: 'g1',
      hostId: 'hostA',
      players: [],
    });
    const io = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
    const databaseProvider = {
      getDatabase: () => ({
        query: { games: { findFirst } },
        delete: deleteTable,
      }),
    } as any;
    const manager = new GameLifecycleManager(io, databaseProvider, new Map());

    await manager.deleteGame('g1', 'hostA');

    expect(deleteTable).toHaveBeenCalledWith(expect.anything());
    expect(where).toHaveBeenCalled();
  });

  test('deleteGame rejects a non-host', async () => {
    const deleteTable = jest.fn();
    const databaseProvider = {
      getDatabase: () => ({
        query: {
          games: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'g1',
              hostId: 'hostA',
              players: [],
            }),
          },
        },
        delete: deleteTable,
      }),
    } as any;
    const manager = new GameLifecycleManager(stubIo, databaseProvider, new Map());

    await expect(manager.deleteGame('g1', 'hostB')).rejects.toThrow(
      'Only the host can delete a game'
    );
    expect(deleteTable).not.toHaveBeenCalled();
  });

  test('validateStartConditions throws for non-host', () => {
    const manager = createManager();
    const game = { hostId: 'hostA', gameType: 'single', players: [{}, {}], status: 'waiting' };
    expect(() => (manager as any).validateStartConditions(game, 'hostB')).toThrow(
      'Only the host can start the game'
    );
  });

  test('validateStartConditions throws for insufficient players (single)', () => {
    const manager = createManager();
    const game = { hostId: 'hostA', gameType: 'single', players: [], status: 'waiting' };
    expect(() => (manager as any).validateStartConditions(game, 'hostA')).toThrow(
      'Need at least 1 players to start'
    );
  });

  test('validateStartConditions throws for non-waiting status', () => {
    const manager = createManager();
    const game = { hostId: 'hostA', gameType: 'single', players: [{}], status: 'active' };
    expect(() => (manager as any).validateStartConditions(game, 'hostA')).toThrow(
      'Game is not in waiting state'
    );
  });

  test('requestPathDelegate returns success with valid unit and path', async () => {
    const games = new Map<string, any>();
    const manager = new GameLifecycleManager(stubIo, stubDb, games);

    const unit = { id: 'u1', playerId: 'p1' };
    const gameInstance = {
      unitManager: { getUnit: (id: string) => (id === 'u1' ? unit : undefined) },
      pathfindingManager: {
        findPath: async () => ({
          path: [{ x: 1, y: 1 }],
          valid: true,
          totalCost: 3,
          estimatedTurns: 1,
        }),
      },
    } as any;
    games.set('g1', gameInstance);

    const res = await (manager as any).requestPathDelegate('g1', 'p1', 'u1', 5, 5);
    expect(res.success).toBe(true);
    expect(res.path).toBeDefined();
    expect(res.path.unitId).toBe('u1');
    expect(res.path.valid).toBe(true);
  });

  test('requestPathDelegate returns error when unit not found', async () => {
    const games = new Map<string, any>();
    const manager = new GameLifecycleManager(stubIo, stubDb, games);

    const gameInstance = {
      unitManager: { getUnit: () => undefined },
      pathfindingManager: { findPath: async () => ({ path: [], valid: false }) },
    } as any;
    games.set('g1', gameInstance);

    const res = await (manager as any).requestPathDelegate('g1', 'p1', 'u1', 5, 5);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Unit not found');
  });

  test('persistAndBroadcast calls persistence, starting units, and broadcast', async () => {
    const onPersistMapData = jest.fn(async () => {});
    const onCreateStartingUnits = jest.fn(async () => {});
    const onBroadcast = jest.fn();
    const manager = createManager({
      onBroadcast,
      onPersistMapData,
      onCreateStartingUnits,
    });

    const mapManager = {
      getMapData: () => ({ width: 10, height: 5, startingPositions: [{ x: 1, y: 2 }] }),
    } as any;
    const unitManager = {} as any;
    const players = new Map<string, any>();

    await (manager as any).persistAndBroadcast(
      'g1',
      mapManager,
      { generator: 'random' },
      unitManager,
      players,
      'RANDOM'
    );

    expect(onPersistMapData).toHaveBeenCalledTimes(1);
    expect(onCreateStartingUnits).toHaveBeenCalledTimes(1);
    expect(onBroadcast).toHaveBeenCalledTimes(1);
    const [gameId, event, data] = onBroadcast.mock.calls[0];
    expect(gameId).toBe('g1');
    expect(event).toBe('map_generated');
    expect(data.mapSize).toBe('10x5');
  });

  test('tryGenerate returns true on success and false on error', async () => {
    const manager = createManager();

    const okMapManager = { generateMap: async () => {} } as any;
    const badMapManager = {
      generateMap: async () => {
        throw new Error('boom');
      },
    } as any;
    const players = new Map<string, any>();

    await expect(
      (manager as any).tryGenerate(okMapManager, players, 'random', 'RANDOM')
    ).resolves.toBe(true);
    await expect(
      (manager as any).tryGenerate(badMapManager, players, 'random', 'RANDOM')
    ).resolves.toBe(false);
  });

  test('performEmergencyFallback tries FRACTAL then RANDOM', async () => {
    const manager = createManager();
    const calls: string[] = [];
    const mapManager = {
      generateMap: async (_players: any, type: string) => {
        calls.push(type);
        if (type === 'FRACTAL') throw new Error('fractal failed');
        // RANDOM succeeds
      },
    } as any;
    const players = new Map<string, any>();

    await expect(
      (manager as any).performEmergencyFallback(mapManager, players, 'RANDOM')
    ).resolves.toBeUndefined();
    expect(calls).toEqual(['FRACTAL', 'RANDOM']);
  });
});
