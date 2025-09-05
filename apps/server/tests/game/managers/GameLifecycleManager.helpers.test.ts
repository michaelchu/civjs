import { GameLifecycleManager } from '../../../src/game/managers/GameLifecycleManager';

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
