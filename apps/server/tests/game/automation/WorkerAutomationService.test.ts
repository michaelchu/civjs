import { ActionType } from '@app-types/shared/actions';
import {
  isWorkerTileSafe,
  planAIInfrastructureWork,
  planReachableInfrastructureWork,
  processHumanWorkerAutomation,
  workerHasExplicitOrders,
} from '@game/automation/WorkerAutomationService';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';

function worker(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'worker-1',
    gameId: 'game-1',
    playerId: 'human-1',
    unitTypeId: 'worker',
    x: 2,
    y: 2,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
    automation: 'worker',
    orders: [{ type: 'autoSettler' }],
    ...overrides,
  };
}

function gameFor(unit: Unit, target = { x: 2, y: 2 }): GameInstance {
  const tile = {
    x: target.x,
    y: target.y,
    terrain: 'hills',
    resource: null,
    improvements: [],
    hasRoad: false,
    hasRailroad: false,
    riverMask: 0,
    owner: 'human-1',
    continentId: 1,
  } as any;
  const source = { ...tile, x: unit.x, y: unit.y };
  const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
  const setWorkerAutomationTask = jest.fn(async (_unitId: string, task: any) => {
    unit.automationTask = task;
  });
  return {
    id: 'game-1',
    currentTurn: 7,
    config: { name: 'test', hostId: 'human-1', ruleset: 'classic' },
    players: new Map([['human-1', { id: 'human-1', isAI: false } as any]]),
    unitManager: {
      getPlayerUnits: () => [unit],
      getVisibleUnits: () => [],
      getUnit: () => unit,
      getUnitType: () => ({ movement: 3, canBuildImprovements: true }),
      canUnitPerformAction: () => true,
      executeUnitAction,
      setWorkerAutomationTask,
    },
    cityManager: {
      getPlayerCities: () => [
        {
          id: 'city-1',
          playerId: 'human-1',
          x: 2,
          y: 2,
          workableTiles: [{ x: target.x, y: target.y, isWorked: true }],
          workerTaskRequests: [],
        },
      ],
      clearWorkerTaskRequest: jest.fn(),
    },
    mapManager: {
      getTile: (x: number, y: number) =>
        x === target.x && y === target.y ? tile : x === unit.x && y === unit.y ? source : null,
      getNeighbors: () => [],
      getTopology: () => ({ getCardinalNeighbors: () => [] }),
      getDistance: (x: number, y: number, toX: number, toY: number) =>
        Math.max(Math.abs(x - toX), Math.abs(y - toY)),
    },
    pathfindingManager: {
      findPath: jest.fn().mockResolvedValue({
        valid: true,
        path: [source, tile],
      }),
    },
    researchManager: { getPlayerResearch: () => ({ researchedTechs: new Set() }) },
    visibilityManager: {
      getVisibleTiles: () => new Set(),
      getDetectionTiles: () => ({ invisible: new Set(), subsurface: new Set() }),
    },
  } as unknown as GameInstance;
}

describe('shared worker automation service', () => {
  const hostility = { getHostilePlayerIds: jest.fn().mockResolvedValue(new Set()) } as any;

  it('starts useful city-workable infrastructure on a fully explored map', async () => {
    const unit = worker();
    const game = gameFor(unit);

    await expect(processHumanWorkerAutomation(game, hostility)).resolves.toBe(1);

    expect(game.unitManager.setWorkerAutomationTask).toHaveBeenCalledWith(
      unit.id,
      expect.objectContaining({
        action: ActionType.BUILD_MINE,
        targetX: 2,
        targetY: 2,
        assignedTurn: 7,
      })
    );
    expect(game.unitManager.executeUnitAction).toHaveBeenCalledWith(
      unit.id,
      ActionType.BUILD_MINE,
      undefined,
      undefined,
      unit.playerId,
      { preserveAutomation: true }
    );
  });

  it('uses authoritative pathing and goto for a remote reachable city tile', async () => {
    const unit = worker({ x: 0, y: 0 });
    const game = gameFor(unit, { x: 2, y: 2 });

    await expect(processHumanWorkerAutomation(game, hostility)).resolves.toBe(1);

    expect(game.pathfindingManager.findPath).toHaveBeenCalledWith(unit, 2, 2);
    expect(game.unitManager.executeUnitAction).toHaveBeenCalledWith(
      unit.id,
      ActionType.GOTO,
      2,
      2,
      unit.playerId,
      { preserveAutomation: true }
    );
  });

  it('does not overwrite explicit orders', async () => {
    const unit = worker({ orders: [{ type: 'sentry' }] });
    const game = gameFor(unit);

    await expect(processHumanWorkerAutomation(game, hostility)).resolves.toBe(0);
    expect(game.unitManager.executeUnitAction).not.toHaveBeenCalled();
  });

  it('falls back from a higher-ranked unreachable target to reachable work', async () => {
    const unit = worker({ x: 0, y: 0 });
    const game = gameFor(unit, { x: 2, y: 2 });
    const unreachable = game.mapManager.getTile(2, 2)!;
    const reachable = { ...unreachable, x: 1, y: 1, terrain: 'grassland' } as any;
    (game.cityManager.getPlayerCities as any) = () => [
      {
        id: 'city-1',
        playerId: unit.playerId,
        workableTiles: [
          { x: 2, y: 2, isWorked: true },
          { x: 1, y: 1, isWorked: true },
        ],
        workerTaskRequests: [],
      },
    ];
    (game.mapManager.getTile as any) = (x: number, y: number) =>
      x === 2 && y === 2 ? unreachable : x === 1 && y === 1 ? reachable : null;
    (game.pathfindingManager.findPath as any) = jest.fn(
      async (_unit: Unit, x: number, y: number) => ({
        valid: x === 1 && y === 1,
        path: x === 1 && y === 1 ? [{ x: 0, y: 0 }, reachable] : [],
      })
    );

    const plan = await planReachableInfrastructureWork(game, unit.playerId, [unit], [], {});

    expect(plan.assignments[0]).toMatchObject({ tile: { x: 1, y: 1 } });
  });

  it('uses the same path filter for AI workers on unreachable same-continent work', async () => {
    const unit = worker({ x: 0, y: 0 });
    const game = gameFor(unit, { x: 2, y: 2 });
    const unreachable = game.mapManager.getTile(2, 2)!;
    const reachable = { ...unreachable, x: 1, y: 1, terrain: 'grassland' } as any;
    (game.cityManager.getPlayerCities as any) = () => [
      {
        id: 'city-1',
        playerId: unit.playerId,
        workableTiles: [
          { x: 2, y: 2, isWorked: true },
          { x: 1, y: 1, isWorked: true },
        ],
        workerTaskRequests: [],
      },
    ];
    (game.mapManager.getTile as any) = (x: number, y: number) =>
      x === 2 && y === 2 ? unreachable : x === 1 && y === 1 ? reachable : null;
    (game.pathfindingManager.findPath as any) = jest.fn(
      async (_unit: Unit, x: number, y: number) => ({
        valid: x === 1 && y === 1,
        path: x === 1 && y === 1 ? [{ x: 0, y: 0 }, reachable] : [],
      })
    );

    const plan = await planAIInfrastructureWork(game, unit.playerId, [unit], [], {});

    expect(plan.assignments[0]).toMatchObject({ tile: { x: 1, y: 1 } });
  });

  it('recognizes only assignment-owned move and activity orders as automated', () => {
    const task = {
      action: ActionType.BUILD_ROAD,
      targetX: 4,
      targetY: 5,
      assignedTurn: 3,
    };
    expect(
      workerHasExplicitOrders(worker({ orders: [{ type: 'move', targetX: 4, targetY: 5 }] }), task)
    ).toBe(false);
    expect(
      workerHasExplicitOrders(worker({ orders: [{ type: 'move', targetX: 5, targetY: 5 }] }), task)
    ).toBe(true);
  });

  it('rejects threatened work unless a friendly combat guard occupies the tile', () => {
    const unit = worker();
    const game = gameFor(unit);
    const hostile = worker({
      id: 'enemy',
      playerId: 'enemy',
      unitTypeId: 'warrior',
      x: 3,
      y: 2,
      automation: undefined,
      orders: [],
    });
    (game.unitManager.getUnitType as any) = (id: string) =>
      id === 'warrior'
        ? { movement: 1, attack: 1, combat: 1 }
        : { movement: 3, canBuildImprovements: true, attack: 0, combat: 0 };

    expect(isWorkerTileSafe(game, unit.playerId, [hostile], 2, 2)).toBe(false);

    const guard = worker({
      id: 'guard',
      unitTypeId: 'warrior',
      automation: undefined,
      orders: [],
    });
    (game.unitManager.getPlayerUnits as any) = () => [unit, guard];
    expect(isWorkerTileSafe(game, unit.playerId, [hostile], 2, 2)).toBe(true);
  });

  it('invalidates a persisted assignment when its owning city disappears', async () => {
    const task = {
      action: ActionType.BUILD_MINE,
      targetX: 2,
      targetY: 2,
      assignedTurn: 6,
      requestCityId: 'city-1',
    };
    const unit = worker({ automationTask: task });
    const game = gameFor(unit);
    (game.cityManager.getPlayerCities as any) = () => [];

    await expect(processHumanWorkerAutomation(game, hostility)).resolves.toBe(0);

    expect(game.unitManager.setWorkerAutomationTask).toHaveBeenCalledWith(unit.id, undefined);
    expect(unit.automation).toBe('worker');
  });

  it('interrupts an active assignment when diplomacy makes its tile threatened', async () => {
    const task = {
      action: ActionType.BUILD_MINE,
      targetX: 2,
      targetY: 2,
      assignedTurn: 6,
    };
    const unit = worker({
      automationTask: task,
      orders: [{ type: 'mine' }, { type: 'autoSettler' }],
      activity: { type: 'mining', turnsRemaining: 2, totalTurns: 3 },
    });
    const hostile = worker({
      id: 'enemy',
      playerId: 'enemy',
      unitTypeId: 'warrior',
      x: 3,
      y: 2,
      automation: undefined,
      orders: [],
    });
    const game = gameFor(unit);
    (game.unitManager.getVisibleUnits as any) = () => [hostile];
    (game.unitManager.getUnitType as any) = (id: string) =>
      id === 'warrior'
        ? { movement: 1, attack: 1, combat: 1 }
        : { movement: 3, canBuildImprovements: true, attack: 0, combat: 0 };
    const wartimeHostility = {
      getHostilePlayerIds: jest.fn().mockResolvedValue(new Set(['enemy'])),
    } as any;

    await expect(processHumanWorkerAutomation(game, wartimeHostility)).resolves.toBe(0);

    expect(game.unitManager.setWorkerAutomationTask).toHaveBeenCalledWith(unit.id, undefined);
  });
});
