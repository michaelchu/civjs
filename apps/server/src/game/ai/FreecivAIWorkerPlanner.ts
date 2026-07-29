import { ActionType } from '@app-types/shared/actions';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';
import type { CityState } from '@game/managers/CityManager';
import type { MapTile } from '@game/managers/MapManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface WorkerAssignment {
  unit: Unit;
  tile: MapTile;
  action: ActionType;
  want: number;
  travelTurns: number;
  workTurns: number;
}

interface WorkerPlanningContext {
  turn: number;
  playerId: string;
  workers: Unit[];
  cities: CityState[];
  hostileUnits: Unit[];
  existingTasks: Readonly<Record<string, AIUnitTask>>;
  getTile: (x: number, y: number) => MapTile | null;
  getNeighbors: (x: number, y: number) => MapTile[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  researchedTechs: ReadonlySet<string>;
}

interface ImprovementChoice {
  action: ActionType;
  benefit: number;
  workTurns: number;
}

interface CandidateTile {
  tile: MapTile;
  worked: boolean;
  currentValue: number;
}

const OUTPUT_WEIGHTS = { food: 3, shields: 2, trade: 1 };

function terrainValue(terrainId: MapTile['terrain']): number {
  const terrain = rulesetLoader.getTerrain(terrainId);
  return (
    terrain.food * OUTPUT_WEIGHTS.food +
    terrain.shields * OUTPUT_WEIGHTS.shields +
    terrain.trade * OUTPUT_WEIGHTS.trade
  );
}

function resourceValue(tile: MapTile): number {
  if (!tile.resource) return 0;
  try {
    const resource = rulesetLoader.getResource(tile.resource);
    return (
      (Number(resource.food) || 0) * OUTPUT_WEIGHTS.food +
      (Number(resource.shield) || 0) * OUTPUT_WEIGHTS.shields +
      (Number(resource.trade) || 0) * OUTPUT_WEIGHTS.trade
    );
  } catch {
    return 0;
  }
}

function currentTileValue(tile: MapTile): number {
  const terrain = rulesetLoader.getTerrain(tile.terrain);
  let value = terrainValue(tile.terrain) + resourceValue(tile);
  if (tile.improvements.includes('irrigation')) {
    value += terrain.irrigationFoodIncr * OUTPUT_WEIGHTS.food;
  }
  if (tile.improvements.includes('mine')) {
    value += terrain.miningShieldIncr * OUTPUT_WEIGHTS.shields;
  }
  if (
    (tile.hasRoad || tile.improvements.includes('road')) &&
    ['grassland', 'plains'].includes(tile.terrain)
  ) {
    value += OUTPUT_WEIGHTS.trade;
  }
  if (tile.riverMask !== 0) value += OUTPUT_WEIGHTS.trade;
  if (tile.hasRailroad || tile.improvements.includes('railroad')) {
    const shields =
      terrain.shields + (tile.improvements.includes('mine') ? terrain.miningShieldIncr : 0);
    value += Math.floor(shields * 1.5) * OUTPUT_WEIGHTS.shields - shields * OUTPUT_WEIGHTS.shields;
  }
  return value;
}

function roadNetworkBenefit(context: WorkerPlanningContext, tile: MapTile): number {
  const connected = context
    .getNeighbors(tile.x, tile.y)
    .filter(neighbor => neighbor.hasRoad || neighbor.hasRailroad).length;
  const cityConnection = context.cities.some(city =>
    context
      .getNeighbors(tile.x, tile.y)
      .some(neighbor => neighbor.x === city.x && neighbor.y === city.y)
  );
  return connected * 2 + (cityConnection ? 4 : 0);
}

function cleanupChoices(tile: MapTile): ImprovementChoice[] {
  return tile.improvements.some(extra => ['pollution', 'fallout'].includes(extra.toLowerCase()))
    ? [{ action: ActionType.CLEAN_POLLUTION, benefit: 1000, workTurns: 3 }]
    : [];
}

function yieldChoices(tile: MapTile): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain);
  const choices: ImprovementChoice[] = [];
  if (terrain.irrigationTime > 0 && !tile.improvements.includes('irrigation')) {
    choices.push({
      action: ActionType.BUILD_IRRIGATION,
      benefit: terrain.irrigationFoodIncr * OUTPUT_WEIGHTS.food,
      workTurns: terrain.irrigationTime,
    });
  }
  if (terrain.miningTime > 0 && !tile.improvements.includes('mine')) {
    choices.push({
      action: ActionType.BUILD_MINE,
      benefit: terrain.miningShieldIncr * OUTPUT_WEIGHTS.shields,
      workTurns: terrain.miningTime,
    });
  }
  return choices;
}

function basicRoadChoices(context: WorkerPlanningContext, tile: MapTile): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain);
  if (terrain.roadTime <= 0 || tile.hasRoad || tile.improvements.includes('road')) return [];
  const trade = ['grassland', 'plains'].includes(tile.terrain) ? OUTPUT_WEIGHTS.trade : 0;
  return [
    {
      action: ActionType.BUILD_ROAD,
      benefit: trade + roadNetworkBenefit(context, tile),
      workTurns: terrain.roadTime,
    },
  ];
}

function railroadChoices(context: WorkerPlanningContext, tile: MapTile): ImprovementChoice[] {
  const hasRoad = tile.hasRoad || tile.improvements.includes('road');
  const hasRailroad = tile.hasRailroad || tile.improvements.includes('railroad');
  if (!context.researchedTechs.has('railroad') || !hasRoad || hasRailroad) return [];
  const terrain = rulesetLoader.getTerrain(tile.terrain);
  const shields =
    terrain.shields + (tile.improvements.includes('mine') ? terrain.miningShieldIncr : 0);
  return [
    {
      action: ActionType.BUILD_RAILROAD,
      benefit: Math.max(1, Math.floor(shields * 1.5) - shields) * OUTPUT_WEIGHTS.shields + 4,
      workTurns: Math.max(1, terrain.roadTime * 2),
    },
  ];
}

function terrainChangeChoices(tile: MapTile): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain);
  const choices: ImprovementChoice[] = [];
  for (const [action, target, workTurns] of [
    [ActionType.CULTIVATE, terrain.cultivateTo, terrain.cultivateTime],
    [ActionType.PLANT, terrain.plantTo, terrain.plantTime],
    [ActionType.TRANSFORM_TERRAIN, terrain.transformTo, terrain.transformTime ?? 0],
  ] as const) {
    if (!target || workTurns <= 0) continue;
    const benefit = terrainValue(target) - terrainValue(tile.terrain);
    if (benefit > 0) choices.push({ action, benefit, workTurns });
  }
  return choices;
}

function improvementChoices(context: WorkerPlanningContext, tile: MapTile): ImprovementChoice[] {
  return [
    ...cleanupChoices(tile),
    ...yieldChoices(tile),
    ...basicRoadChoices(context, tile),
    ...railroadChoices(context, tile),
    ...terrainChangeChoices(tile),
  ].filter(choice => choice.benefit > 0);
}

function candidateTiles(context: WorkerPlanningContext): CandidateTile[] {
  const candidates = new Map<string, CandidateTile>();
  for (const city of context.cities) {
    for (const workable of city.workableTiles ?? []) {
      const tile = context.getTile(workable.x, workable.y);
      if (!tile || (tile.owner && tile.owner !== context.playerId)) continue;
      const key = `${tile.x},${tile.y}`;
      const candidate = {
        tile,
        worked: workable.isWorked,
        currentValue: currentTileValue(tile),
      };
      const existing = candidates.get(key);
      if (!existing || (!existing.worked && candidate.worked)) candidates.set(key, candidate);
    }
  }
  return [...candidates.values()];
}

function isSafe(context: WorkerPlanningContext, tile: MapTile): boolean {
  return !context.hostileUnits.some(hostile => {
    const type = context.getType(hostile.unitTypeId);
    if (!type || (type.attack ?? type.combat ?? 0) <= 0) return false;
    return context.distance(hostile.x, hostile.y, tile.x, tile.y) <= Math.max(1, type.movement);
  });
}

function isAvailableWorker(worker: Unit): boolean {
  return !worker.transportedBy && (!worker.activity || worker.activity.type === 'idle');
}

function canWorkerUseCandidate(
  worker: Unit,
  candidate: CandidateTile,
  occupiedBy: ReadonlyMap<string, ReadonlySet<string>>
): boolean {
  const occupants = occupiedBy.get(`${candidate.tile.x},${candidate.tile.y}`);
  return !occupants || (occupants.size === 1 && occupants.has(worker.id));
}

function isSameTask(task: AIUnitTask | undefined, candidate: WorkerAssignment): boolean {
  return Boolean(
    task?.role === 'worker' &&
      task.action === candidate.action &&
      task.targetX === candidate.tile.x &&
      task.targetY === candidate.tile.y
  );
}

function scoreChoice(
  worker: Unit,
  candidate: CandidateTile,
  choice: ImprovementChoice,
  context: WorkerPlanningContext
): WorkerAssignment {
  const type = context.getType(worker.unitTypeId);
  const distance = context.distance(worker.x, worker.y, candidate.tile.x, candidate.tile.y);
  const travelTurns = Math.ceil(distance / Math.max(1, type?.movement ?? 1));
  const workTurns = Math.max(
    1,
    Math.ceil(choice.workTurns / (worker.unitTypeId === 'engineers' ? 2 : 1))
  );
  const delay = travelTurns + workTurns;
  const useFactor = candidate.worked ? 2 : 1;
  const resultingTileBonus = candidate.worked ? 0 : candidate.currentValue + choice.benefit;
  const want = (choice.benefit * useFactor * 100 + resultingTileBonus * 10) / (10 + delay);
  return {
    unit: worker,
    tile: candidate.tile,
    action: choice.action,
    want,
    travelTurns,
    workTurns,
  };
}

/**
 * Rank city-workable improvements and reserve one destination per worker.
 *
 * This retains Freeciv's decision shape: worked tiles compete by marginal
 * gain, unused tiles by resulting yield, cleanup has strategic value, and all
 * benefits are discounted by travel plus activity time.
 *
 * @reference reference/freeciv/server/advisors/autoworkers.c:308-831
 * @reference reference/freeciv/ai/default/daisettler.c:1032-1218
 */
export function planWorkerImprovements(context: WorkerPlanningContext): {
  assignments: WorkerAssignment[];
  tasks: Record<string, AIUnitTask>;
} {
  const candidates = candidateTiles(context).filter(candidate => isSafe(context, candidate.tile));
  const occupiedBy = new Map<string, Set<string>>();
  for (const worker of context.workers) {
    const key = `${worker.x},${worker.y}`;
    const occupants = occupiedBy.get(key) ?? new Set<string>();
    occupants.add(worker.id);
    occupiedBy.set(key, occupants);
  }
  const availableWorkers = context.workers.filter(isAvailableWorker);
  const ranked = availableWorkers
    .flatMap(worker =>
      candidates
        .filter(candidate => canWorkerUseCandidate(worker, candidate, occupiedBy))
        .flatMap(candidate =>
          improvementChoices(context, candidate.tile).map(choice =>
            scoreChoice(worker, candidate, choice, context)
          )
        )
    )
    .sort(
      (a, b) =>
        b.want - a.want ||
        a.travelTurns - b.travelTurns ||
        a.unit.id.localeCompare(b.unit.id) ||
        a.tile.y - b.tile.y ||
        a.tile.x - b.tile.x ||
        a.action.localeCompare(b.action)
    );
  const assignedWorkers = new Set<string>();
  const reservedTiles = new Set<string>();
  const assignments: WorkerAssignment[] = [];
  const tasks: Record<string, AIUnitTask> = {};

  for (const candidate of ranked) {
    const tileKey = `${candidate.tile.x},${candidate.tile.y}`;
    if (assignedWorkers.has(candidate.unit.id) || reservedTiles.has(tileKey)) continue;
    assignments.push(candidate);
    assignedWorkers.add(candidate.unit.id);
    reservedTiles.add(tileKey);
    const oldTask = context.existingTasks[candidate.unit.id];
    tasks[candidate.unit.id] = {
      role: 'worker',
      action: candidate.action,
      targetX: candidate.tile.x,
      targetY: candidate.tile.y,
      assignedTurn: isSameTask(oldTask, candidate) ? oldTask!.assignedTurn : context.turn,
    };
  }
  return { assignments, tasks };
}
