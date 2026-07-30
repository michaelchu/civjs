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

function scenario() {
  const tiles = Array.from({ length: 10 }, (_, x) =>
    Array.from({ length: 10 }, (_, y) => ({
      x,
      y,
      terrain: 'grassland',
      continentId: 1,
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
    config,
    {
      getAllUnits: () => new Map(),
      getUnitType: (id: string) =>
        ['warriors', 'archers', 'horsemen', 'barbarian_leader'].includes(id) ? { id } : undefined,
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
});
