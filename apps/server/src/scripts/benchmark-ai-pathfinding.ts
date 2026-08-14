/**
 * @module server/scripts/benchmark-ai-pathfinding
 * Compares the pre-optimization linear open-set workload with the current
 * heap/cached planner workload on a fixed 32x64, five-AI synthetic match.
 *
 * This is intentionally a standalone algorithm benchmark: it does not create
 * a database game or mutate reference sources. The workload shape mirrors the
 * repeated military target-neighbor and city-danger routes that made large AI
 * turns pathological while keeping the command practical in CI.
 */
import { performance } from 'node:perf_hooks';
import { calculateMovementCost } from '@game/constants/MovementConstants';
import { buildCityThreatTravelTimes } from '@game/ai/AICityDangerPlanner';
import { buildMilitaryTravelTimes } from '@game/ai/AIMilitaryPlanner';
import type { CityState } from '@game/cities/CityTypes';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import type { Unit } from '@game/units/UnitTypes';
import { MapTopology } from '@game/map/MapTopology';

const WIDTH = 32;
const HEIGHT = 64;
const AI_PLAYERS = 5;
const ATTACKERS_PER_AI = 1;
const CITIES_PER_AI = 1;
const TARGETS_PER_AI = 2;
const THREATS_PER_AI = 2;
const SAMPLES = 3;

interface BenchmarkPath {
  valid: boolean;
  estimatedTurns: number;
  totalCost: number;
}

interface Workload {
  attackers: Unit[];
  targets: Array<{ x: number; y: number }>;
  cities: Array<{ id: string; playerId: string; x: number; y: number }>;
  threats: Unit[];
}

interface BenchmarkResult {
  mode: 'linear-baseline' | 'lattice-route-map-optimized';
  samplesMs: number[];
  medianMs: number;
  pathCalls: number;
  searches: number;
  cacheHits: number;
  expandedNodes: number;
}

function makeUnit(id: string, playerIndex: number, index: number): Unit {
  return {
    id,
    gameId: 'benchmark',
    playerId: `player-${playerIndex}`,
    unitTypeId: 'warriors',
    x: (playerIndex * 6 + index * 7 + 2) % WIDTH,
    y: (playerIndex * 11 + index * 13 + 3) % HEIGHT,
    movementLeft: 6,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  };
}

function makeWorkload(): Workload[] {
  const units = Array.from({ length: AI_PLAYERS }, (_, playerIndex) =>
    Array.from({ length: ATTACKERS_PER_AI }, (_, index) =>
      makeUnit(`unit-${playerIndex}-${index}`, playerIndex, index)
    )
  );
  const cities = Array.from({ length: AI_PLAYERS }, (_, playerIndex) =>
    Array.from({ length: CITIES_PER_AI }, (_, index) => ({
      id: `city-${playerIndex}-${index}`,
      playerId: `player-${playerIndex}`,
      x: (playerIndex * 5 + index * 9 + 5) % WIDTH,
      y: (playerIndex * 13 + index * 17 + 8) % HEIGHT,
    }))
  );

  return Array.from({ length: AI_PLAYERS }, (_, playerIndex) => {
    const attackers = units[playerIndex]!;
    const hostileUnits = units
      .flatMap((playerUnits, otherIndex) => (otherIndex === playerIndex ? [] : playerUnits))
      .map(unit => ({ ...unit }));
    return {
      attackers,
      // Clustered objectives intentionally exercise the target-neighbor
      // overlap that appears when several enemy units approach one city.
      targets: Array.from({ length: TARGETS_PER_AI }, (_, index) => ({
        x: 20 + (playerIndex % 2) + index,
        y: 30,
      })),
      cities: cities[playerIndex]!,
      threats: hostileUnits.slice(0, THREATS_PER_AI),
    };
  });
}

function makeMap() {
  const topology = new MapTopology(WIDTH, HEIGHT);
  return {
    getRevision: () => 1,
    getTopology: () => topology,
    getTile: () => ({ terrain: 'grassland' }),
  };
}

class LinearBaselinePathfinder {
  private readonly topology = new MapTopology(WIDTH, HEIGHT);

  async findPath(unit: Unit, targetX: number, targetY: number): Promise<BenchmarkPath> {
    if (unit.x === targetX && unit.y === targetY) {
      return { valid: true, estimatedTurns: 0, totalCost: 0 };
    }
    const open: Array<{ x: number; y: number; cost: number; parent?: any; moveCost: number }> = [
      { x: unit.x, y: unit.y, cost: 0, moveCost: 0 },
    ];
    const best = new Map<string, (typeof open)[number]>();
    const closed = new Set<string>();
    best.set(`${unit.x},${unit.y}`, open[0]!);

    for (let iterations = 0; open.length > 0 && iterations < WIDTH * HEIGHT; iterations++) {
      let lowestIndex = 0;
      for (let index = 1; index < open.length; index++) {
        if (open[index]!.cost < open[lowestIndex]!.cost) lowestIndex = index;
      }
      const current = open.splice(lowestIndex, 1)[0]!;
      const currentKey = `${current.x},${current.y}`;
      if (closed.has(currentKey)) continue;
      closed.add(currentKey);
      if (current.x === targetX && current.y === targetY) {
        return {
          valid: true,
          estimatedTurns: Math.ceil(current.cost / unit.movementLeft),
          totalCost: current.cost,
        };
      }
      for (const neighbor of this.topology.getNeighbors(current.x, current.y)) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (closed.has(key)) continue;
        const moveCost = calculateMovementCost(
          current.x,
          current.y,
          neighbor.x,
          neighbor.y,
          'grassland',
          unit.unitTypeId
        );
        if (moveCost < 0) continue;
        const cost = current.cost + moveCost;
        if (cost >= (best.get(key)?.cost ?? Number.POSITIVE_INFINITY)) continue;
        const node = { x: neighbor.x, y: neighbor.y, cost, parent: current, moveCost };
        best.set(key, node);
        open.push(node);
      }
    }
    return { valid: false, estimatedTurns: 0, totalCost: 0 };
  }
}

async function runWorkload(
  mode: BenchmarkResult['mode'],
  workload: Workload[]
): Promise<BenchmarkResult> {
  const samplesMs: number[] = [];
  let pathCalls = 0;
  let cacheHits = 0;
  let searches = 0;
  let expandedNodes = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    const map = makeMap();
    const optimized = new PathfindingManager(WIDTH, HEIGHT, map);
    optimized.beginTurn(sample);
    optimized.resetDiagnostics();
    const linear = new LinearBaselinePathfinder();
    // Manager construction builds topology indexes once per game. Keep it
    // outside the turn-workload timer so this benchmark isolates recurring
    // AI planning latency rather than game initialization.
    const startedAt = performance.now();

    for (const player of workload) {
      const findPath = async (unit: Unit, x: number, y: number) => {
        pathCalls++;
        return mode === 'linear-baseline'
          ? linear.findPath(unit, x, y)
          : optimized.findPath(unit, x, y);
      };
      const findPaths = async (
        unit: Unit,
        destinations: ReadonlyArray<{ x: number; y: number }>
      ) => {
        pathCalls += destinations.length;
        return optimized.findPaths(unit, destinations);
      };
      const findPathCosts = async (
        unit: Unit,
        destinations: ReadonlyArray<{ x: number; y: number }>
      ) => {
        pathCalls += destinations.length;
        return optimized.findPathCosts(unit, destinations);
      };
      const getNeighbors = (x: number, y: number) => map.getTopology().getNeighbors(x, y);
      if (mode === 'linear-baseline') {
        await runLegacyMilitary(player, findPath, getNeighbors);
        await runLegacyThreats(player, findPath);
        await runLegacyThreats(player, findPath);
      } else {
        await buildMilitaryTravelTimes({
          attackers: player.attackers,
          targets: player.targets,
          getNeighbors,
          findPath,
          findPaths,
          findPathCosts,
        });
        const threatContext = {
          cities: player.cities as unknown as CityState[],
          threateningUnits: player.threats,
          getType: (id: string) =>
            ({ id, paratroopersRange: 0, flags: [], rulesetUnitClassFlags: [] }) as any,
          getUnit: () => undefined,
          distance: (x1: number, y1: number, x2: number, y2: number) =>
            Math.abs(x1 - x2) + Math.abs(y1 - y2),
          findPath,
          findPaths,
          findPathCosts,
        };
        await buildCityThreatTravelTimes(threatContext);
        await buildCityThreatTravelTimes(threatContext);
      }
    }
    const diagnostics = optimized.getDiagnostics();
    cacheHits += diagnostics.cacheHits;
    searches += diagnostics.searches;
    expandedNodes += diagnostics.expandedNodes;
    samplesMs.push(performance.now() - startedAt);
  }
  const ordered = [...samplesMs].sort((left, right) => left - right);
  return {
    mode,
    samplesMs,
    medianMs: ordered[Math.floor(ordered.length / 2)]!,
    pathCalls,
    searches,
    cacheHits,
    expandedNodes,
  };
}

async function runLegacyMilitary(
  player: Workload,
  findPath: (unit: Unit, x: number, y: number) => Promise<BenchmarkPath>,
  getNeighbors: (x: number, y: number) => Array<{ x: number; y: number }>
): Promise<void> {
  for (const attacker of player.attackers) {
    for (const target of player.targets) {
      await Promise.all(
        [{ x: target.x, y: target.y }, ...getNeighbors(target.x, target.y)].map(destination =>
          findPath(attacker, destination.x, destination.y)
        )
      );
    }
  }
}

async function runLegacyThreats(
  player: Workload,
  findPath: (unit: Unit, x: number, y: number) => Promise<BenchmarkPath>
): Promise<void> {
  for (const threat of player.threats) {
    for (const city of player.cities) await findPath(threat, city.x, city.y);
  }
}

async function main(): Promise<void> {
  const workload = makeWorkload();
  const baseline = await runWorkload('linear-baseline', workload);
  const optimized = await runWorkload('lattice-route-map-optimized', workload);
  process.stdout.write(
    `${JSON.stringify({ width: WIDTH, height: HEIGHT, aiPlayers: AI_PLAYERS, baseline, optimized }, null, 2)}\n`
  );
}

void main();
