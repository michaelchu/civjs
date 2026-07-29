import type { AIUnitTask } from '@game/ai/AIStateStore';
import type { MapData, MapTile } from '@game/managers/MapManager';
import type { PathfindingResult } from '@game/managers/PathfindingManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

const DISTANCE_FACTOR = 0.6;
const SAME_TERRAIN_SCORE = 21;
const DIFFERENT_TERRAIN_SCORE = 81;
const KNOWN_DIFFERENT_TERRAIN_SCORE = 51;
const BEST_NORMAL_TILE = 60_900;
const HUT_SCORE = BEST_NORMAL_TILE + 2;
const MAX_PATH_CANDIDATES = 48;

export interface ExplorerAssignment {
  unit: Unit;
  tile: MapTile;
  path: PathfindingResult;
  desirability: number;
  want: number;
}

export interface ExplorationPlan {
  assignments: ExplorerAssignment[];
  tasks: Record<string, AIUnitTask>;
}

export interface ExplorerPlanningContext {
  turn: number;
  playerId: string;
  units: Unit[];
  map: MapData;
  exploredTiles: ReadonlySet<string>;
  hostileUnits: Unit[];
  nonAlliedUnits: Unit[];
  nonAlliedCityTiles: ReadonlySet<string>;
  existingTasks: Readonly<Record<string, AIUnitTask>>;
  getType: (unitTypeId: string) => UnitType | undefined;
  getNeighbors: (x: number, y: number) => MapTile[];
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  squaredDistance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  findPath: (unit: Unit, targetX: number, targetY: number) => Promise<PathfindingResult>;
  mayExploreTile: (unit: Unit, tile: MapTile) => boolean;
  knowsHuts: boolean;
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isSea(tile: MapTile): boolean {
  return tile.continentId === 0 || tile.terrain === 'ocean' || tile.terrain === 'deep_ocean';
}

function isNative(type: UnitType, tile: MapTile): boolean {
  if (type.rulesetUnitClass === 'Air' || type.rulesetUnitClass === 'Helicopter') return true;
  const seaUnit = type.rulesetUnitClass === 'Sea' || type.rulesetUnitClass === 'Trireme';
  return seaUnit === isSea(tile);
}

function likelyNative(context: ExplorerPlanningContext, type: UnitType, tile: MapTile): number {
  if (context.exploredTiles.has(tileKey(tile.x, tile.y))) return isNative(type, tile) ? 100 : 0;
  const neighbors = context.getNeighbors(tile.x, tile.y);
  let native = 0;
  let foreign = 0;
  for (const neighbor of neighbors) {
    if (!context.exploredTiles.has(tileKey(neighbor.x, neighbor.y))) continue;
    if (isNative(type, neighbor)) native++;
    else foreign++;
  }
  return 50 + (50 / Math.max(1, neighbors.length)) * (native - foreign);
}

function tilesInVision(
  context: ExplorerPlanningContext,
  center: MapTile,
  visionRadiusSquared: number
): MapTile[] {
  return context.map.tiles
    .flat()
    .filter(
      tile => context.squaredDistance(center.x, center.y, tile.x, tile.y) <= visionRadiusSquared
    );
}

function knownHutBonus(context: ExplorerPlanningContext, tile: MapTile): number {
  if (!context.knowsHuts) return 0;
  return tile.improvements.some(extra => extra.toLowerCase() === 'hut') ? HUT_SCORE : 0;
}

/**
 * Freeciv values frontier tiles by expected information revealed, with extra
 * weight for discovering terrain unlike the explorer's native terrain.
 *
 * @reference reference/freeciv/server/advisors/autoexplorer.c:165-265
 */
export function explorationDesirability(
  context: ExplorerPlanningContext,
  unit: Unit,
  tile: MapTile
): number {
  const type = context.getType(unit.unitTypeId);
  if (
    !type ||
    !context.exploredTiles.has(tileKey(tile.x, tile.y)) ||
    !context.mayExploreTile(unit, tile)
  ) {
    return 0;
  }
  let desirable = 0;
  let unknown = 0;
  for (const visible of tilesInVision(context, tile, type.vision_radius_sq ?? type.sight)) {
    const native = likelyNative(context, type, visible);
    if (!context.exploredTiles.has(tileKey(visible.x, visible.y))) {
      unknown++;
      desirable += (native * SAME_TERRAIN_SCORE + (100 - native) * DIFFERENT_TERRAIN_SCORE) / 100;
    } else if (context.distance(tile.x, tile.y, visible.x, visible.y) === 1) {
      desirable += ((100 - native) * KNOWN_DIFFERENT_TERRAIN_SCORE) / 100;
    }
  }
  if (unknown === 0) desirable = 0;
  return desirable + knownHutBonus(context, tile);
}

function hostileStrikeRange(
  context: Pick<ExplorerPlanningContext, 'getType'>,
  hostile: Unit
): number {
  const type = context.getType(hostile.unitTypeId);
  if (!type || (type.attack ?? type.combat) <= 0) return 0;
  const movement = Math.max(0, Math.ceil(hostile.movementLeft / 3));
  return movement + Math.max(1, type.range ?? 1);
}

export function explorationAdditionalStepCost(
  context: Pick<
    ExplorerPlanningContext,
    | 'exploredTiles'
    | 'hostileUnits'
    | 'nonAlliedUnits'
    | 'nonAlliedCityTiles'
    | 'getType'
    | 'distance'
    | 'mayExploreTile'
    | 'map'
  >,
  unit: Unit,
  toX: number,
  toY: number
): number {
  const key = tileKey(toX, toY);
  if (!context.exploredTiles.has(key)) return -1;
  const tile = context.map.tiles[toX]?.[toY];
  if (!tile || !context.mayExploreTile(unit, tile)) return -1;
  if (context.nonAlliedCityTiles.has(key)) return -1;
  if (context.nonAlliedUnits.some(other => other.x === toX && other.y === toY)) return -1;
  const defense = Math.max(1, context.getType(unit.unitTypeId)?.defense ?? 1);
  return context.hostileUnits.reduce((risk, hostile) => {
    const distance = context.distance(toX, toY, hostile.x, hostile.y);
    const exposure = hostileStrikeRange(context, hostile) + 1 - distance;
    if (exposure <= 0) return risk;
    const attack = Math.max(
      1,
      context.getType(hostile.unitTypeId)?.attack ??
        context.getType(hostile.unitTypeId)?.combat ??
        1
    );
    return risk + Math.ceil((3 * exposure * attack) / defense);
  }, 0);
}

function pathUsesKnownLegalTiles(
  context: ExplorerPlanningContext,
  path: PathfindingResult,
  unit: Unit
): boolean {
  const occupied = new Set(context.nonAlliedUnits.map(other => tileKey(other.x, other.y)));
  return path.path.every(step => {
    const key = tileKey(step.x, step.y);
    if (!context.exploredTiles.has(key)) return false;
    const tile = context.map.tiles[step.x]?.[step.y];
    if (!tile || !context.mayExploreTile(unit, tile)) return false;
    const isStart = step.x === unit.x && step.y === unit.y;
    if (!isStart && occupied.has(key)) return false;
    if (context.nonAlliedCityTiles.has(key)) return false;
    return true;
  });
}

function weightedPathCost(
  context: ExplorerPlanningContext,
  unit: Unit,
  path: PathfindingResult
): number {
  if (path.weightedCost !== undefined) return path.weightedCost;
  return (
    path.totalCost +
    path.path
      .slice(1)
      .reduce(
        (risk, step) =>
          risk + Math.max(0, explorationAdditionalStepCost(context, unit, step.x, step.y)),
        0
      )
  );
}

function initialCandidateWant(
  context: ExplorerPlanningContext,
  unit: Unit,
  tile: MapTile,
  desirable: number
): number {
  const distance = context.distance(unit.x, unit.y, tile.x, tile.y);
  return desirable * DISTANCE_FACTOR ** distance;
}

async function rankedAssignmentsForUnit(
  context: ExplorerPlanningContext,
  unit: Unit,
  reserved: ReadonlySet<string>
): Promise<ExplorerAssignment[]> {
  const existing = context.existingTasks[unit.id];
  const candidates = context.map.tiles
    .flat()
    .filter(tile => tile.x !== unit.x || tile.y !== unit.y)
    .filter(tile => !reserved.has(tileKey(tile.x, tile.y)))
    .map(tile => ({ tile, desirability: explorationDesirability(context, unit, tile) }))
    .filter(candidate => candidate.desirability > 0)
    .sort(
      (left, right) =>
        initialCandidateWant(context, unit, right.tile, right.desirability) -
          initialCandidateWant(context, unit, left.tile, left.desirability) ||
        left.tile.y - right.tile.y ||
        left.tile.x - right.tile.x
    );
  const shortlisted = candidates.slice(0, MAX_PATH_CANDIDATES);
  const previous = candidates.find(
    candidate => candidate.tile.x === existing?.targetX && candidate.tile.y === existing?.targetY
  );
  if (previous && !shortlisted.includes(previous)) shortlisted.push(previous);

  const reached = await Promise.all(
    shortlisted.map(async candidate => ({
      ...candidate,
      path: await context.findPath(unit, candidate.tile.x, candidate.tile.y),
    }))
  );
  return reached
    .filter(candidate => candidate.path.valid && candidate.path.path.length > 1)
    .filter(candidate => pathUsesKnownLegalTiles(context, candidate.path, unit))
    .map(candidate => {
      const persistent =
        candidate.tile.x === existing?.targetX && candidate.tile.y === existing?.targetY ? 1.05 : 1;
      return {
        unit,
        tile: candidate.tile,
        path: candidate.path,
        desirability: candidate.desirability,
        want:
          candidate.desirability *
          DISTANCE_FACTOR ** weightedPathCost(context, unit, candidate.path) *
          persistent,
      };
    })
    .sort(
      (left, right) =>
        right.want - left.want ||
        left.path.totalCost - right.path.totalCost ||
        left.tile.y - right.tile.y ||
        left.tile.x - right.tile.x
    );
}

/**
 * Allocate distinct frontier destinations to explorers while retaining a
 * still-valuable prior destination as a small anti-thrashing preference.
 */
export async function planExploration(context: ExplorerPlanningContext): Promise<ExplorationPlan> {
  const assignments: ExplorerAssignment[] = [];
  const tasks: Record<string, AIUnitTask> = {};
  const reserved = new Set<string>();
  for (const unit of context.units.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const assignment = (await rankedAssignmentsForUnit(context, unit, reserved))[0];
    if (!assignment) continue;
    assignments.push(assignment);
    reserved.add(tileKey(assignment.tile.x, assignment.tile.y));
    tasks[unit.id] = {
      role: 'explore',
      targetX: assignment.tile.x,
      targetY: assignment.tile.y,
      assignedTurn:
        context.existingTasks[unit.id]?.targetX === assignment.tile.x &&
        context.existingTasks[unit.id]?.targetY === assignment.tile.y
          ? context.existingTasks[unit.id].assignedTurn
          : context.turn,
    };
  }
  return { assignments, tasks };
}
