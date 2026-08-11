import { RandomEventsManager } from '@game/managers/RandomEventsManager';

describe('RandomEventsManager', () => {
  it('invokes barbarian spawning after the configured onset', async () => {
    const barbarianManager = {
      spawnBarbarians: jest.fn().mockResolvedValue({
        successfulSpawns: 1,
        totalSpawns: 1,
        spawns: [{ success: true, unitsCreated: 2, barbarianPlayerId: 'barbarians' }],
      }),
    };
    const broadcastToGame = jest.fn();
    const manager = new RandomEventsManager(
      'game-1',
      {
        barbarianRate: 1,
        onsetBarbarian: 10,
        disastersEnabled: false,
        disasterFrequency: 0,
        randomMovementsEnabled: false,
        resourceChangesEnabled: false,
        resourceChangeFrequency: 0,
        goodyHutsEnabled: false,
        barbarianHutChance: 0,
      },
      barbarianManager as any,
      { checkPlayerDisasters: jest.fn() } as any,
      {} as any,
      {} as any,
      { broadcastToGame } as any
    );

    const result = await manager.processRandomEvents(10, -3900, ['player-1']);

    expect(barbarianManager.spawnBarbarians).toHaveBeenCalledWith(10);
    expect(result.barbarianEvents).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        eventType: 'barbarian_uprising',
        success: true,
        details: expect.objectContaining({ unitsSpawned: 2 }),
      }),
    ]);
    expect(broadcastToGame).toHaveBeenCalledWith(
      'game-1',
      'barbarian_uprising',
      expect.objectContaining({ unitsSpawned: 2, spawnType: undefined })
    );
  });

  it('processes random-movement units during begin-turn setup', async () => {
    const unit = { id: 'storm-1', unitTypeId: 'storm' };
    const unitManager = {
      getUnitsWithRandomMovement: jest.fn().mockReturnValue([unit]),
      executeRandomMovement: jest.fn().mockResolvedValue({
        success: true,
        fromTile: { x: 2, y: 2 },
        toTile: { x: 3, y: 2 },
        movementPointsUsed: 3,
      }),
    };
    const barbarianManager = { spawnBarbarians: jest.fn() };
    const disasterManager = { checkPlayerDisasters: jest.fn() };
    const manager = new RandomEventsManager(
      'game-1',
      {
        barbarianRate: 0,
        onsetBarbarian: 60,
        disastersEnabled: false,
        disasterFrequency: 0,
        randomMovementsEnabled: true,
        resourceChangesEnabled: false,
        resourceChangeFrequency: 0,
        goodyHutsEnabled: false,
        barbarianHutChance: 0,
      },
      barbarianManager as any,
      disasterManager as any,
      unitManager as any,
      {} as any,
      { broadcastToGame: jest.fn() } as any
    );

    const result = await manager.processRandomUnitMovements(['player-1']);

    expect(result.unitMovements).toBe(1);
    expect(result.results).toEqual([
      expect.objectContaining({
        eventType: 'random_unit_movement',
        playersAffected: ['player-1'],
        details: expect.objectContaining({
          unitId: 'storm-1',
          unitType: 'storm',
          fromTile: { x: 2, y: 2 },
          toTile: { x: 3, y: 2 },
        }),
      }),
    ]);
    expect(unitManager.executeRandomMovement).toHaveBeenCalledWith('storm-1');

    const remainingEvents = await manager.processRandomEvents(60, -3900, ['player-1']);
    expect(remainingEvents.unitMovements).toBe(0);
    expect(unitManager.executeRandomMovement).toHaveBeenCalledTimes(1);
  });

  it('does not count a Storm whose legal destinations are blocked', async () => {
    const unitManager = {
      getUnitsWithRandomMovement: jest
        .fn()
        .mockReturnValue([{ id: 'storm-1', unitTypeId: 'storm' }]),
      executeRandomMovement: jest.fn().mockResolvedValue({
        success: false,
        fromTile: { x: 2, y: 2 },
        movementPointsUsed: 0,
      }),
    };
    const manager = new RandomEventsManager(
      'game-1',
      {
        barbarianRate: 0,
        onsetBarbarian: 60,
        disastersEnabled: false,
        disasterFrequency: 0,
        randomMovementsEnabled: true,
        resourceChangesEnabled: false,
        resourceChangeFrequency: 0,
        goodyHutsEnabled: false,
        barbarianHutChance: 0,
      },
      { spawnBarbarians: jest.fn() } as any,
      { checkPlayerDisasters: jest.fn() } as any,
      unitManager as any,
      {} as any,
      { broadcastToGame: jest.fn() } as any
    );

    const result = await manager.processRandomUnitMovements(['player-1']);

    expect(result.unitMovements).toBe(0);
    expect(result.results).toEqual([]);
  });
});
