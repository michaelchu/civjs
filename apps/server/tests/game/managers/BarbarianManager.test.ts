import {
  BarbarianManager,
  BarbarianType,
  type BarbarianSpawnConfig,
} from '@game/managers/BarbarianManager';

const config: BarbarianSpawnConfig = {
  rate: 2,
  onsetTurn: 60,
  landBarbarianChance: 100,
  seaBarbarianChance: 100,
  minDistanceFromCity: 3,
  maxDistanceFromCity: 8,
  unitsPerSpawn: { min: 2, max: 2 },
  leaderChance: 100,
};

function scenario(sea = false) {
  const tiles = Array.from({ length: 10 }, (_, x) =>
    Array.from({ length: 10 }, (_, y) => ({
      x,
      y,
      terrain: sea ? 'ocean' : 'grassland',
      continentId: sea ? 0 : 1,
      cityId: x === 0 && y === 0 ? 'capital' : undefined,
      unitIds: [],
    }))
  );
  const createUnit = jest
    .fn()
    .mockImplementation(async (_playerId: string, unitTypeId: string, x: number, y: number) => ({
      id: `${unitTypeId}-${x}-${y}-${createUnit.mock.calls.length}`,
      unitTypeId,
      x,
      y,
    }));
  const insert = jest.fn().mockReturnValue({
    values: jest.fn().mockResolvedValue(undefined),
  });
  const manager = new BarbarianManager(
    'game',
    { ...config },
    {
      getAllUnits: () => new Map(),
      getUnitType: (id: string) =>
        ['warriors', 'archers', 'horsemen', 'barbarian_leader', 'trireme'].includes(id)
          ? { id, transport_capacity: id === 'trireme' ? 2 : undefined }
          : undefined,
      createUnit,
    } as any,
    {
      getMapData: () => ({ width: 10, height: 10, tiles }),
      getDistance: (x1: number, y1: number, x2: number, y2: number) =>
        Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
    } as any,
    {} as any,
    {
      getDatabase: () => ({ insert }),
    } as any,
    { next: () => 0 },
    async type => `barbarian-${type}`
  );
  return { createUnit, insert, manager };
}

describe('BarbarianManager', () => {
  it('registers a persisted barbarian player with the live game state', async () => {
    const barbarian = {
      id: 'barbarian-player',
      gameId: 'game',
      civilization: 'barbarian-land',
    };
    const playerRegistrar = jest.fn();
    const manager = new BarbarianManager(
      'game',
      { ...config },
      {} as any,
      {} as any,
      {} as any,
      {
        getDatabase: () => ({
          query: { players: { findFirst: jest.fn().mockResolvedValue(barbarian) } },
        }),
      } as any,
      { next: () => 0 },
      undefined,
      playerRegistrar
    );

    await expect(
      (manager as any).getOrCreateBarbarianPlayer(BarbarianType.LAND_BARBARIAN)
    ).resolves.toBe('barbarian-player');
    expect(playerRegistrar).toHaveBeenCalledWith(barbarian);
  });

  it('uses authoritative map size and spawns a leader plus ruleset units in wilderness', async () => {
    const { createUnit, insert, manager } = scenario();

    const result = await manager.spawnBarbarians(60);

    expect(result).toMatchObject({
      mapFactor: 1,
      totalSpawns: 1,
      successfulSpawns: 1,
    });
    expect(result.spawns[0]).toMatchObject({
      spawnType: BarbarianType.LAND_BARBARIAN,
      unitsCreated: 3,
      location: { distanceToNearestCity: 3 },
    });
    expect(createUnit).toHaveBeenCalledWith(
      'barbarian-land',
      'barbarian_leader',
      expect.any(Number),
      expect.any(Number)
    );
    expect(createUnit).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('does not consume the stream or spawn before the configured onset', async () => {
    const { createUnit, manager } = scenario();

    expect(await manager.spawnBarbarians(59)).toMatchObject({
      totalSpawns: 0,
      successfulSpawns: 0,
    });
    expect(createUnit).not.toHaveBeenCalled();
  });

  it('keeps sea barbarian land units embarked on their boat', async () => {
    const { createUnit, manager } = scenario(true);

    const result = await manager.spawnBarbarians(60);
    const spawn = result.spawns[0]!;
    const { x, y } = spawn.location;

    expect(spawn).toMatchObject({
      spawnType: BarbarianType.SEA_BARBARIAN,
      unitsCreated: 3,
    });
    expect(createUnit).toHaveBeenCalledWith('barbarian-sea', 'trireme', x, y);
    expect(createUnit).toHaveBeenCalledWith(
      'barbarian-sea',
      'warriors',
      x,
      y,
      undefined,
      expect.any(String)
    );
    expect(createUnit).toHaveBeenCalledWith(
      'barbarian-sea',
      'barbarian_leader',
      x,
      y,
      undefined,
      expect.any(String)
    );
  });

  it('reports explorer survival for protected and disabled huts', async () => {
    const protectedHut = scenario().manager;
    expect(await protectedHut.unleashBarbariansAt(1, 1)).toBe(true);

    const disabledHut = scenario().manager;
    (disabledHut as any).config.allowHutBarbarians = false;
    expect(await disabledHut.unleashBarbariansAt(5, 5)).toBe(true);
  });

  it('allows hut hordes in HUTS_ONLY mode while random uprisings remain disabled', async () => {
    const { manager } = scenario();
    (manager as any).config.rate = 0;
    (manager as any).config.allowHutBarbarians = true;
    (manager as any).mapManager.getDistance = jest.fn(() => 10);
    jest.spyOn(manager as any, 'getOrCreateBarbarianPlayer').mockResolvedValue('barbarian-land');
    jest.spyOn(manager as any, 'spawnBarbarianUnits').mockResolvedValue(['barbarian-1']);

    await expect(manager.unleashBarbariansAt(5, 5)).resolves.toBe(false);
    expect((manager as any).spawnBarbarianUnits).toHaveBeenCalled();
  });

  it('reports explorer loss when a hut horde actually spawns', async () => {
    const { manager } = scenario();
    (manager as any).mapManager.getDistance = jest.fn(() => 10);
    jest.spyOn(manager as any, 'getOrCreateBarbarianPlayer').mockResolvedValue('barbarian-land');
    jest.spyOn(manager as any, 'spawnBarbarianUnits').mockResolvedValue(['barbarian-1']);

    const survived = await manager.unleashBarbariansAt(5, 5);
    expect((manager as any).getOrCreateBarbarianPlayer).toHaveBeenCalled();
    expect((manager as any).spawnBarbarianUnits).toHaveBeenCalled();
    expect(survived).toBe(false);
  });
});
