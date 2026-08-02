/**
 * @module server/game/ai/AIWorkerPlanner
 * Implements AIWorker Planner decision logic for AI-controlled players.
 */
import { ActionType } from '@app-types/shared/actions';
import type { WorkerAutomationTask } from '@game/automation/WorkerAutomationTypes';
import type { CityState } from '@game/cities/CityTypes';
import type { MapTile } from '@game/managers/MapManager';
import type { Unit } from '@game/units/UnitTypes';
import { hasClassicIrrigationSource } from '@game/rules/ClassicIrrigationRules';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface WorkerAssignment {
  unit: Unit;
  tile: MapTile;
  action: ActionType;
  want: number;
  travelTurns: number;
  workTurns: number;
  requestCityId?: string;
}

interface ExistingWorkerTask extends WorkerAutomationTask {
  role?: 'worker';
}

export interface WorkerPlanningContext {
  turn: number;
  playerId: string;
  workers: Unit[];
  cities: CityState[];
  ownedTiles?: MapTile[];
  hostileUnits: Unit[];
  friendlyUnits?: Unit[];
  existingTasks: Readonly<Record<string, ExistingWorkerTask>>;
  getTile: (x: number, y: number) => MapTile | null;
  getNeighbors: (x: number, y: number) => MapTile[];
  getCardinalNeighbors: (x: number, y: number) => MapTile[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  researchedTechs: ReadonlySet<string>;
  rulesetName?: string;
  excludedAssignments?: ReadonlySet<string>;
  canPerformAction?: (worker: Unit, action: ActionType, tile: MapTile) => boolean;
  travelTurns?: (worker: Unit, tile: MapTile) => number | undefined;
  climate?: {
    warmingPressure: number;
    coolingPressure: number;
    warmingEvents: number;
    coolingEvents: number;
    warmingLevel: number;
    coolingLevel: number;
  };
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
  requests: Array<{ cityId: string; action: ActionType; want: number }>;
}

// @reference reference/freeciv/server/advisors/advbuilding.h:19-21
const OUTPUT_WEIGHTS = { food: 30, shields: 17, trade: 18 };
const REQUEST_PRIORITY = 1_000_000_000;

function weightedOutputs(food: number, shields: number, trade: number): number {
  return (
    food * OUTPUT_WEIGHTS.food +
    (food > 0 ? OUTPUT_WEIGHTS.food / 2 : 0) +
    shields * OUTPUT_WEIGHTS.shields +
    (shields > 0 ? OUTPUT_WEIGHTS.shields / 2 : 0) +
    trade * OUTPUT_WEIGHTS.trade +
    (trade > 0 ? OUTPUT_WEIGHTS.trade / 2 : 0)
  );
}

function terrainValue(terrainId: MapTile['terrain'], rulesetName: string): number {
  const terrain = rulesetLoader.getTerrain(terrainId, rulesetName);
  return weightedOutputs(terrain.food, terrain.shields, terrain.trade);
}

function resourceOutputs(
  tile: MapTile,
  rulesetName: string
): { food: number; shields: number; trade: number } {
  if (!tile.resource) return { food: 0, shields: 0, trade: 0 };
  try {
    const resource = rulesetLoader.getResource(tile.resource, rulesetName);
    return {
      food: Number(resource.food) || 0,
      shields: Number(resource.shield) || 0,
      trade: Number(resource.trade) || 0,
    };
  } catch {
    return { food: 0, shields: 0, trade: 0 };
  }
}

function currentTileValue(tile: MapTile, rulesetName: string): number {
  const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName);
  const resource = resourceOutputs(tile, rulesetName);
  let food = terrain.food + resource.food;
  let shields = terrain.shields + resource.shields;
  let trade = terrain.trade + resource.trade;
  if (tile.improvements.includes('irrigation')) {
    food += terrain.irrigationFoodIncr;
  }
  if (tile.improvements.includes('mine')) {
    shields += terrain.miningShieldIncr;
  }
  if (
    (tile.hasRoad || tile.improvements.includes('road')) &&
    ['grassland', 'plains'].includes(tile.terrain)
  ) {
    trade += 1;
  }
  if (tile.riverMask !== 0) trade += 1;
  if (tile.hasRailroad || tile.improvements.includes('railroad')) {
    shields = Math.floor(shields * 1.5);
  }
  return weightedOutputs(food, shields, trade);
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

function cleanupChoices(context: WorkerPlanningContext, tile: MapTile): ImprovementChoice[] {
  const extras = new Set(tile.improvements.map(extra => extra.toLowerCase()));
  if (!extras.has('pollution') && !extras.has('fallout')) return [];
  const climate = context.climate;
  const warmingUrgency = climate
    ? (climate.warmingPressure * 50) / Math.max(1, climate.warmingLevel) +
      climate.warmingEvents * 50
    : 0;
  const coolingUrgency = climate
    ? (climate.coolingPressure * 50) / Math.max(1, climate.coolingLevel) +
      climate.coolingEvents * 50
    : 0;
  return [
    {
      action: ActionType.CLEAN_POLLUTION,
      benefit:
        1000 +
        (extras.has('pollution') ? warmingUrgency : 0) +
        (extras.has('fallout') ? coolingUrgency : 0),
      workTurns: 3,
    },
  ];
}

function yieldChoices(
  context: WorkerPlanningContext,
  tile: MapTile,
  rulesetName: string
): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName);
  const choices: ImprovementChoice[] = [];
  if (
    terrain.irrigationTime > 0 &&
    !tile.improvements.includes('irrigation') &&
    hasClassicIrrigationSource(context.getCardinalNeighbors(tile.x, tile.y))
  ) {
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

function basicRoadChoices(
  context: WorkerPlanningContext,
  tile: MapTile,
  rulesetName: string
): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName);
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

function railroadChoices(
  context: WorkerPlanningContext,
  tile: MapTile,
  rulesetName: string
): ImprovementChoice[] {
  const hasRoad = tile.hasRoad || tile.improvements.includes('road');
  const hasRailroad = tile.hasRailroad || tile.improvements.includes('railroad');
  if (!context.researchedTechs.has('railroad') || hasRailroad) return [];
  const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName);
  const shields =
    terrain.shields + (tile.improvements.includes('mine') ? terrain.miningShieldIncr : 0);
  const railroadBenefit =
    Math.max(1, Math.floor(shields * 1.5) - shields) * OUTPUT_WEIGHTS.shields + 4;
  if (!hasRoad) {
    if (terrain.roadTime <= 0) return [];
    const trade = ['grassland', 'plains'].includes(tile.terrain) ? OUTPUT_WEIGHTS.trade : 0;
    return [
      {
        action: ActionType.BUILD_ROAD,
        benefit: railroadBenefit + trade + roadNetworkBenefit(context, tile),
        workTurns: terrain.roadTime * 3,
      },
    ];
  }
  return [
    {
      action: ActionType.BUILD_RAILROAD,
      benefit: railroadBenefit,
      workTurns: Math.max(1, terrain.roadTime * 2),
    },
  ];
}

function terrainChangeChoices(tile: MapTile, rulesetName: string): ImprovementChoice[] {
  const terrain = rulesetLoader.getTerrain(tile.terrain, rulesetName);
  const choices: ImprovementChoice[] = [];
  for (const [action, target, workTurns] of [
    [ActionType.CULTIVATE, terrain.cultivateTo, terrain.cultivateTime],
    [ActionType.PLANT, terrain.plantTo, terrain.plantTime],
    [ActionType.TRANSFORM_TERRAIN, terrain.transformTo, terrain.transformTime ?? 0],
  ] as const) {
    if (!target || workTurns <= 0) continue;
    const benefit = terrainValue(target, rulesetName) - terrainValue(tile.terrain, rulesetName);
    if (benefit > 0) choices.push({ action, benefit, workTurns });
  }
  return choices;
}

function improvementChoices(context: WorkerPlanningContext, tile: MapTile): ImprovementChoice[] {
  const rulesetName = context.rulesetName ?? 'classic';
  return [
    ...cleanupChoices(context, tile),
    ...yieldChoices(context, tile, rulesetName),
    ...basicRoadChoices(context, tile, rulesetName),
    ...railroadChoices(context, tile, rulesetName),
    ...terrainChangeChoices(tile, rulesetName),
  ].filter(choice => choice.benefit > 0);
}

function candidateTiles(context: WorkerPlanningContext): CandidateTile[] {
  const rulesetName = context.rulesetName ?? 'classic';
  const candidates = new Map<string, CandidateTile>();
  for (const city of context.cities) {
    for (const workable of city.workableTiles ?? []) {
      const tile = context.getTile(workable.x, workable.y);
      if (!tile || tile.owner !== context.playerId) continue;
      const key = `${tile.x},${tile.y}`;
      const candidate = {
        tile,
        worked: workable.isWorked,
        currentValue: currentTileValue(tile, rulesetName),
        requests: (city.workerTaskRequests ?? [])
          .filter(request => request.x === tile.x && request.y === tile.y)
          .map(request => ({
            cityId: city.id,
            action: request.action,
            want: request.want,
          })),
      };
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, candidate);
      } else {
        existing.worked ||= candidate.worked;
        existing.requests.push(...candidate.requests);
      }
    }
  }

  // City radii drive economic value, but roads, cleanup, and future growth
  // also need workers to service owned territory outside the current radius.
  // These tiles receive the normal unworked-tile score and can never expand
  // automation into neutral or foreign territory.
  for (const tile of context.ownedTiles ?? []) {
    if (tile.owner !== context.playerId) continue;
    const key = `${tile.x},${tile.y}`;
    if (candidates.has(key)) continue;
    candidates.set(key, {
      tile,
      worked: false,
      currentValue: currentTileValue(tile, rulesetName),
      requests: [],
    });
  }
  return [...candidates.values()];
}

function isSafe(context: WorkerPlanningContext, tile: MapTile): boolean {
  const defended = context.friendlyUnits?.some(friendly => {
    if (friendly.x !== tile.x || friendly.y !== tile.y || friendly.transportedBy) return false;
    const type = context.getType(friendly.unitTypeId);
    return Boolean(type && (type.attack ?? type.combat ?? 0) > 0);
  });
  if (defended) return true;
  return !context.hostileUnits.some(hostile => {
    if (hostile.x === tile.x && hostile.y === tile.y) return true;
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

function isSameTask(task: ExistingWorkerTask | undefined, candidate: WorkerAssignment): boolean {
  return Boolean(
    task &&
    (task.role === undefined || task.role === 'worker') &&
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
  const travelTurns =
    context.travelTurns?.(worker, candidate.tile) ??
    Math.ceil(distance / Math.max(1, type?.movement ?? 1));
  const workTurns = Math.max(
    1,
    Math.ceil(choice.workTurns / (worker.unitTypeId === 'engineers' ? 2 : 1))
  );
  const delay = travelTurns + workTurns;
  const useFactor = candidate.worked ? 2 : 1;
  const resultingTileBonus = candidate.worked ? 0 : candidate.currentValue + choice.benefit;
  const want = (choice.benefit * useFactor * 100 + resultingTileBonus * 10) / (10 + delay);
  const request = candidate.requests
    .filter(item => item.action === choice.action)
    .sort((left, right) => right.want - left.want || left.cityId.localeCompare(right.cityId))[0];
  const requestedWant = request ? ((request.want + 1) * 10) / (travelTurns + 1) : 0;
  return {
    unit: worker,
    tile: candidate.tile,
    action: choice.action,
    want: request ? REQUEST_PRIORITY + requestedWant : want,
    travelTurns,
    workTurns,
    requestCityId: request?.cityId,
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
  tasks: Record<string, WorkerAutomationTask>;
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
        .filter(
          candidate =>
            !context.travelTurns || context.travelTurns(worker, candidate.tile) !== undefined
        )
        .flatMap(candidate =>
          improvementChoices(context, candidate.tile)
            .filter(
              choice => context.canPerformAction?.(worker, choice.action, candidate.tile) !== false
            )
            .map(choice => scoreChoice(worker, candidate, choice, context))
        )
    )
    .filter(
      assignment =>
        !context.excludedAssignments?.has(
          `${assignment.unit.id}:${assignment.tile.x},${assignment.tile.y}`
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
  const tasks: Record<string, WorkerAutomationTask> = {};

  for (const candidate of ranked) {
    const tileKey = `${candidate.tile.x},${candidate.tile.y}`;
    if (assignedWorkers.has(candidate.unit.id) || reservedTiles.has(tileKey)) continue;
    assignments.push(candidate);
    assignedWorkers.add(candidate.unit.id);
    reservedTiles.add(tileKey);
    const oldTask = context.existingTasks[candidate.unit.id];
    tasks[candidate.unit.id] = {
      action: candidate.action,
      targetX: candidate.tile.x,
      targetY: candidate.tile.y,
      assignedTurn: isSameTask(oldTask, candidate) ? oldTask!.assignedTurn : context.turn,
      requestCityId: candidate.requestCityId,
    };
  }
  return { assignments, tasks };
}
