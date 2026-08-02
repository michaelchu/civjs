import { GameEventService, GameEventType } from '@game/events/GameEventService';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

const city = {
  id: 'city-1',
  name: 'Test City',
  playerId: 'player-1',
  x: 5,
  y: 6,
};

function movementUnit(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    playerId: 'player-1',
    unitTypeId: 'warriors',
    x: 6,
    y: 6,
    ...overrides,
  };
}

describe('GameEventService telemetry', () => {
  it('drops at least one oldest event when a small queue reaches capacity', () => {
    const service = new GameEventService('game-1', {} as any, createMockDatabaseProvider());
    (service as any).maxEventQueueSize = 1;

    service.recordCityGrowth({ ...city, size: 2 }, 1);
    service.recordCityGrowth({ ...city, size: 3 }, 2);

    expect(service.getTelemetryDiagnostics()).toEqual(
      expect.objectContaining({ droppedEvents: 1, pendingEvents: 1 })
    );
  });

  it('aggregates movement and batches semantic events into one insert', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);

    service.recordUnitLifecycle({
      type: 'moved',
      unit: movementUnit(),
      previousX: 5,
      previousY: 6,
    });
    service.recordUnitLifecycle({
      type: 'moved',
      unit: movementUnit({ x: 7 }),
      previousX: 6,
      previousY: 6,
    });
    service.recordCityGrowth({ ...city, size: 2 }, 1);

    const result = await service.processQueuedEvents(3, -3970);

    expect(result.eventsHandled).toBe(2);
    expect(database.insert).toHaveBeenCalledTimes(1);
    const [records] = database.values.mock.calls[0];
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: GameEventType.CITY_GROWTH }),
        expect.objectContaining({
          eventType: GameEventType.UNIT_MOVEMENT_SUMMARY,
          eventData: expect.objectContaining({
            moveCount: 2,
            unitCount: 1,
            unitMoves: [
              expect.objectContaining({
                unitId: 'unit-1',
                moveCount: 2,
                fromX: 5,
                fromY: 6,
                toX: 7,
                toY: 6,
              }),
            ],
          }),
        }),
      ])
    );
    expect(records).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'completed' })])
    );
    expect(records).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ eventType: GameEventType.UNIT_MOVED })])
    );
  });

  it('keeps late events attached to the turn record where they occurred', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);
    service.recordCityGrowth({ ...city, size: 2 }, 1);
    await service.processQueuedEvents(3, -3970);

    service.recordCityGrowth({ ...city, id: 'city-2', name: 'Late City', size: 3 }, 2);
    service.setCurrentTurnContext('turn-2', 4, -3960);
    await service.processQueuedEvents(4, -3960);

    const [, secondCall] = database.values.mock.calls;
    const [secondRecords] = secondCall;
    const lateRecord = secondRecords.find(
      (record: { eventType?: string }) => record.eventType === GameEventType.CITY_GROWTH
    );
    expect(lateRecord).toEqual(
      expect.objectContaining({
        turnId: 'turn-1',
        eventData: expect.objectContaining({ turn: 3, year: -3970 }),
      })
    );
  });

  it('keeps aggregated movement attached to its originating turn', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);
    service.recordUnitLifecycle({
      type: 'moved',
      unit: movementUnit(),
      previousX: 5,
      previousY: 6,
    });

    service.setCurrentTurnContext('turn-2', 4, -3960);
    await service.processQueuedEvents(4, -3960);

    const [records] = database.values.mock.calls[0];
    expect(records).toEqual([
      expect.objectContaining({
        turnId: 'turn-1',
        eventType: GameEventType.UNIT_MOVEMENT_SUMMARY,
        eventData: expect.objectContaining({ turn: 3, year: -3970 }),
      }),
    ]);
  });

  it('retains events for retry and reports persistence failures', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);
    service.recordCityGrowth({ ...city, size: 2 }, 1);
    database.insert.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });

    const failed = await service.processQueuedEvents(3, -3970);

    expect(failed.persistenceFailures).toBe(1);
    expect(failed.eventsHandled).toBe(0);
    expect(service.getTelemetryDiagnostics()).toEqual(
      expect.objectContaining({ persistenceFailures: 1, pendingEvents: 1 })
    );

    const retried = await service.processQueuedEvents(3, -3970);
    expect(retried.eventsHandled).toBe(1);
    expect(service.getTelemetryDiagnostics().pendingEvents).toBe(0);
  });

  it('does not repeat successful handlers when persistence is retried', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    const handler = jest.fn(async () => true);
    service.registerEventHandler({
      id: 'city-growth-side-effect',
      eventType: GameEventType.CITY_GROWTH,
      priority: 1,
      handler,
    });
    service.setCurrentTurnContext('turn-1', 3, -3970);
    service.recordCityGrowth({ ...city, size: 2 }, 1);
    database.insert.mockImplementationOnce(() => {
      throw new Error('database unavailable');
    });

    await service.processQueuedEvents(3, -3970);
    await service.processQueuedEvents(3, -3970);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not classify spaceship parts as completed buildings', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);
    service.recordCityProductionCompleted(city, {
      kind: 'building',
      value: 'space_structural',
    });

    await service.processQueuedEvents(3, -3970);

    const [records] = database.values.mock.calls[0];
    expect(records).toHaveLength(1);
    expect(records[0].eventType).toBe(GameEventType.CITY_PRODUCTION_COMPLETE);
  });

  it('records collateral victims as individual kill events', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const service = new GameEventService('game-1', {} as any, databaseProvider);
    service.setCurrentTurnContext('turn-1', 3, -3970);

    service.recordCombatOccurred({
      attacker: { id: 'attacker-1', playerId: 'player-1', unitTypeId: 'warriors', x: 10, y: 10 },
      defender: { id: 'defender-1', playerId: 'player-2', unitTypeId: 'phalanx', x: 11, y: 10 },
      result: {
        attackerDamage: 0,
        defenderDamage: 10,
        attackerDestroyed: false,
        defenderDestroyed: true,
        collateralDestroyedIds: ['collateral-1'],
      },
      collateralUnits: [
        {
          id: 'collateral-1',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 11,
          y: 10,
        },
      ],
    });

    await service.processQueuedEvents(3, -3970);

    const [records] = database.values.mock.calls[0];
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: GameEventType.UNIT_KILLED,
          eventData: expect.objectContaining({
            unitId: 'collateral-1',
            role: 'collateral',
            killerUnitId: 'attacker-1',
          }),
        }),
      ])
    );
  });
});
