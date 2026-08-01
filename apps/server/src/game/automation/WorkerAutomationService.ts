import { ActionType } from '@app-types/shared/actions';
import { planWorkerImprovements, type WorkerAssignment } from '@game/ai/AIWorkerPlanner';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit, UnitOrder } from '@game/managers/UnitManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import type { WorkerAutomationTask } from './WorkerAutomationTypes';

export interface WorkerExecutionCallbacks {
  setTask: (unitId: string, task: WorkerAutomationTask) => Promise<void> | void;
  clearTask: (unitId: string) => Promise<void> | void;
  markTransportRequired?: (unitId: string) => void;
}

const ACTION_ORDERS: Partial<Record<ActionType, UnitOrder['type']>> = {
  [ActionType.BUILD_ROAD]: 'road',
  [ActionType.BUILD_RAILROAD]: 'railroad',
  [ActionType.BUILD_IRRIGATION]: 'irrigate',
  [ActionType.BUILD_MINE]: 'mine',
  [ActionType.CULTIVATE]: 'cultivate',
  [ActionType.PLANT]: 'plant',
  [ActionType.TRANSFORM_TERRAIN]: 'transform',
  [ActionType.CLEAN_POLLUTION]: 'cleanPollution',
};

function taskMatchesOrders(unit: Unit, task: WorkerAutomationTask | undefined): boolean {
  const orders = unit.orders ?? [];
  if (orders.length === 0 || orders.every(order => order.type === 'autoSettler')) return true;
  if (!task) return false;
  const first = orders[0]!;
  if (first.type === 'move') {
    return first.targetX === task.targetX && first.targetY === task.targetY;
  }
  return (
    ACTION_ORDERS[task.action] === first.type &&
    unit.x === task.targetX &&
    unit.y === task.targetY &&
    orders.slice(1).every(order => order.type === 'autoSettler')
  );
}

export function workerHasExplicitOrders(
  unit: Unit,
  task: WorkerAutomationTask | undefined
): boolean {
  return !taskMatchesOrders(unit, task);
}

export function isWorkerTileSafe(
  game: GameInstance,
  playerId: string,
  hostileUnits: Unit[],
  x: number,
  y: number
): boolean {
  const guarded = game.unitManager.getPlayerUnits(playerId).some(friendly => {
    if (friendly.x !== x || friendly.y !== y || friendly.transportedBy) return false;
    const type = game.unitManager.getUnitType(friendly.unitTypeId);
    return Boolean(type && (type.attack ?? type.combat ?? 0) > 0);
  });
  if (guarded) return true;
  return !hostileUnits.some(hostile => {
    if (hostile.x === x && hostile.y === y) return true;
    const type = game.unitManager.getUnitType(hostile.unitTypeId);
    const distance = game.mapManager.getDistance(hostile.x, hostile.y, x, y);
    return Boolean(
      type &&
      (type.attack ?? type.combat ?? 0) > 0 &&
      distance >= 0 &&
      distance <= Math.max(1, type.movement)
    );
  });
}

export function planInfrastructureWork(
  game: GameInstance,
  playerId: string,
  workers: Unit[],
  hostileUnits: Unit[],
  existingTasks: Readonly<Record<string, WorkerAutomationTask>>,
  excludedAssignments?: ReadonlySet<string>,
  travelTurns?: ReadonlyMap<string, number>
) {
  return planWorkerImprovements({
    turn: game.currentTurn,
    playerId,
    workers,
    cities: game.cityManager.getPlayerCities(playerId),
    hostileUnits,
    friendlyUnits: game.unitManager.getPlayerUnits(playerId),
    existingTasks,
    getTile: (x, y) => game.mapManager.getTile(x, y),
    getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
    getCardinalNeighbors: (x, y) =>
      game.mapManager
        .getTopology()
        .getCardinalNeighbors(x, y)
        .map(position => game.mapManager.getTile(position.x, position.y))
        .filter((tile): tile is NonNullable<typeof tile> => tile !== null),
    getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
    distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    researchedTechs: game.researchManager.getPlayerResearch(playerId)?.researchedTechs ?? new Set(),
    rulesetName: game.config?.ruleset ?? 'classic',
    excludedAssignments,
    canPerformAction: (worker, action, tile) =>
      game.unitManager.canUnitPerformAction(worker.id, action, tile.x, tile.y),
    travelTurns: travelTurns
      ? (worker, tile) => travelTurns.get(`${worker.id}:${tile.x},${tile.y}`)
      : undefined,
    climate: game.turnManager?.getClimateState?.(),
  });
}

async function planPathAwareInfrastructureWork(
  game: GameInstance,
  playerId: string,
  workers: Unit[],
  hostileUnits: Unit[],
  existingTasks: Readonly<Record<string, WorkerAutomationTask>>,
  retainCrossContinentCandidates: boolean
) {
  const tiles = new Map<string, { x: number; y: number }>();
  for (const city of game.cityManager.getPlayerCities(playerId)) {
    for (const tile of city.workableTiles ?? []) tiles.set(`${tile.x},${tile.y}`, tile);
  }
  const travelTurns = new Map<string, number>();
  for (const worker of workers) {
    const movement = Math.max(1, game.unitManager.getUnitType(worker.unitTypeId)?.movement ?? 1);
    for (const tile of tiles.values()) {
      const key = `${worker.id}:${tile.x},${tile.y}`;
      if (worker.x === tile.x && worker.y === tile.y) {
        travelTurns.set(key, 0);
        continue;
      }
      const path = await game.pathfindingManager.findPath(worker, tile.x, tile.y);
      if (!path.valid || path.path.length < 2) {
        const source = game.mapManager.getTile(worker.x, worker.y);
        const destination = game.mapManager.getTile(tile.x, tile.y);
        if (
          !retainCrossContinentCandidates ||
          !source ||
          !destination ||
          source.continentId <= 0 ||
          destination.continentId <= 0 ||
          source.continentId === destination.continentId
        ) {
          continue;
        }
        travelTurns.set(
          key,
          Math.max(
            1,
            Math.ceil(game.mapManager.getDistance(worker.x, worker.y, tile.x, tile.y) / movement)
          )
        );
        continue;
      }
      const estimated = Number(path.estimatedTurns);
      const totalCost = Number(path.totalCost);
      travelTurns.set(
        key,
        Number.isFinite(estimated) && estimated >= 0
          ? Math.max(1, estimated)
          : Math.max(1, Math.ceil((Number.isFinite(totalCost) ? totalCost : 1) / movement))
      );
    }
  }
  return planInfrastructureWork(
    game,
    playerId,
    workers,
    hostileUnits,
    existingTasks,
    undefined,
    travelTurns
  );
}

export function planReachableInfrastructureWork(
  game: GameInstance,
  playerId: string,
  workers: Unit[],
  hostileUnits: Unit[],
  existingTasks: Readonly<Record<string, WorkerAutomationTask>>
) {
  return planPathAwareInfrastructureWork(
    game,
    playerId,
    workers,
    hostileUnits,
    existingTasks,
    false
  );
}

/**
 * AI workers share authoritative path evaluation with human Auto Worker, but
 * retain cross-continent candidates so the AI-only ferry policy can service
 * them. Same-continent candidates without an authoritative path are rejected.
 */
export function planAIInfrastructureWork(
  game: GameInstance,
  playerId: string,
  workers: Unit[],
  hostileUnits: Unit[],
  existingTasks: Readonly<Record<string, WorkerAutomationTask>>
) {
  return planPathAwareInfrastructureWork(
    game,
    playerId,
    workers,
    hostileUnits,
    existingTasks,
    true
  );
}

async function executeAssignment(
  game: GameInstance,
  playerId: string,
  assignment: WorkerAssignment,
  task: WorkerAutomationTask,
  callbacks: WorkerExecutionCallbacks
): Promise<number> {
  const unit = game.unitManager.getUnit(assignment.unit.id);
  if (!unit || unit.playerId !== playerId || unit.transportedBy) {
    await callbacks.clearTask(assignment.unit.id);
    return 0;
  }
  if (unit.activity && unit.activity.type !== 'idle') return 0;
  if (workerHasExplicitOrders(unit, task) || unit.movementLeft <= 0) return 0;

  await callbacks.setTask(unit.id, task);
  if (unit.x === task.targetX && unit.y === task.targetY) {
    if (!game.unitManager.canUnitPerformAction(unit.id, task.action)) {
      await callbacks.clearTask(unit.id);
      return 0;
    }
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      task.action,
      undefined,
      undefined,
      playerId,
      { preserveAutomation: true }
    );
    if (!result.success) {
      await callbacks.clearTask(unit.id);
      game.unitManager.broadcastUnitInfo?.(unit.id);
      return 0;
    }
    if (task.requestCityId) {
      game.cityManager.clearWorkerTaskRequest(
        task.requestCityId,
        task.targetX,
        task.targetY,
        task.action
      );
    }
    game.unitManager.broadcastUnitInfo?.(unit.id);
    return 1;
  }

  const path = await game.pathfindingManager.findPath(unit, task.targetX, task.targetY);
  if (!path.valid || path.path.length < 2) {
    const source = game.mapManager.getTile(unit.x, unit.y);
    const destination = game.mapManager.getTile(task.targetX, task.targetY);
    if (
      source &&
      destination &&
      source.continentId > 0 &&
      destination.continentId > 0 &&
      source.continentId !== destination.continentId
    ) {
      callbacks.markTransportRequired?.(unit.id);
    } else {
      await callbacks.clearTask(unit.id);
    }
    return 0;
  }
  const result = await game.unitManager.executeUnitAction(
    unit.id,
    ActionType.GOTO,
    task.targetX,
    task.targetY,
    playerId,
    { preserveAutomation: true }
  );
  if (!result.success) await callbacks.clearTask(unit.id);
  game.unitManager.broadcastUnitInfo?.(unit.id);
  return result.success ? 1 : 0;
}

export async function executeInfrastructurePlan(
  game: GameInstance,
  playerId: string,
  assignments: WorkerAssignment[],
  tasks: Readonly<Record<string, WorkerAutomationTask>>,
  callbacks: WorkerExecutionCallbacks
): Promise<number> {
  let actions = 0;
  for (const assignment of assignments) {
    const task = tasks[assignment.unit.id];
    if (!task) continue;
    actions += await executeAssignment(game, playerId, assignment, task, callbacks);
  }
  return actions;
}

export async function processHumanWorkerAutomation(
  game: GameInstance,
  hostilityPolicy: DiplomacyHostilityPolicy
): Promise<number> {
  let actions = 0;
  for (const [playerId, player] of game.players) {
    if (player.isAI) continue;
    const allWorkers = game.unitManager
      .getPlayerUnits(playerId)
      .filter(unit => unit.automation === 'worker');
    const hostileIds = await hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const visibleUnits = game.unitManager.getVisibleUnits(
      playerId,
      game.visibilityManager.getVisibleTiles(playerId),
      game.visibilityManager.getDetectionTiles(playerId)
    );
    const hostileUnits = visibleUnits.filter(unit => hostileIds.has(unit.playerId));
    for (const unit of allWorkers) {
      if (unit.transportedBy && unit.automationTask) {
        await game.unitManager.setWorkerAutomationTask(unit.id, undefined);
      } else if (
        unit.automationTask &&
        unit.activity &&
        unit.activity.type !== 'idle' &&
        !isWorkerTileSafe(game, playerId, hostileUnits, unit.x, unit.y)
      ) {
        await game.unitManager.setWorkerAutomationTask(unit.id, undefined);
      }
    }
    const existingTasks = Object.fromEntries(
      allWorkers.filter(unit => unit.automationTask).map(unit => [unit.id, unit.automationTask!])
    );
    const workers = allWorkers.filter(
      unit => !unit.transportedBy && !workerHasExplicitOrders(unit, unit.automationTask)
    );
    if (workers.length === 0) continue;
    const plan = await planReachableInfrastructureWork(
      game,
      playerId,
      workers,
      hostileUnits,
      existingTasks
    );
    const plannedIds = new Set(Object.keys(plan.tasks));
    for (const unit of workers) {
      if (
        unit.automationTask &&
        !plannedIds.has(unit.id) &&
        (!unit.activity || unit.activity.type === 'idle')
      ) {
        await game.unitManager.setWorkerAutomationTask(unit.id, undefined);
      }
    }
    actions += await executeInfrastructurePlan(game, playerId, plan.assignments, plan.tasks, {
      setTask: (unitId, task) => game.unitManager.setWorkerAutomationTask(unitId, task),
      clearTask: unitId => game.unitManager.setWorkerAutomationTask(unitId, undefined),
    });
  }
  return actions;
}
