import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertAIState } from '@game/ai/AIStateStore';
import type { GameInstance } from '@game/managers/GameManager';

export interface AIValidationFailureArtifact {
  reproduction: string;
  gameId: string;
  mapSeed: string;
  turn: number;
  violations: string[];
  players: Array<{
    id: string;
    cityCount: number;
    unitCount: number;
    decisionCount: number;
    taskCount: number;
  }>;
}

export interface AIValidationArtifactContext {
  configuration: Record<string, unknown>;
  phase: string;
  error: unknown;
  metrics?: AIValidationMetricPoint[];
  lastKnownGoodSnapshot?: string;
}

export interface AIValidationMetricPoint {
  turn: number;
  players: Array<{
    id: string;
    cities: number;
    population: number;
    production: number;
    trade: number;
    science: number;
    units: number;
    technologies: number;
    tasks: number;
    decisions: number;
  }>;
}

/** Capture strategy-neutral, per-turn health data for matrix baselines. */
export function captureAIValidationMetrics(game: GameInstance): AIValidationMetricPoint {
  return {
    turn: game.currentTurn,
    players: [...game.players.values()].map(player => {
      const cities = game.cityManager.getPlayerCities(player.id);
      const state = assertAIState(player.aiState);
      return {
        id: player.id,
        cities: cities.length,
        population: cities.reduce((total, city) => total + city.population, 0),
        production: cities.reduce((total, city) => total + (city.productionPerTurn ?? 0), 0),
        trade: cities.reduce((total, city) => total + (city.tradePerTurn ?? 0), 0),
        science: cities.reduce((total, city) => total + (city.sciencePerTurn ?? 0), 0),
        units: game.unitManager.getPlayerUnits(player.id).length,
        technologies: game.researchManager.getResearchedTechs(player.id).length,
        tasks: Object.keys(state.unitTasks).length,
        decisions: state.lastDecisionCount ?? 0,
      };
    }),
  };
}

/**
 * Stable replay comparison payload. Database IDs and wall-clock values are
 * deliberately excluded: two executions of the same seed need to agree on
 * authoritative game state and decisions, not generated UUIDs.
 */
export function buildAIValidationReplayFingerprint(game: GameInstance): string {
  const map = game.mapManager.getMapData();
  const cityLabels = new Map(
    game.cityManager.getAllCities().map(city => [city.id, `${city.x},${city.y}`])
  );
  const normalizeCityEntries = <T>(entries: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(entries)
        .map(([cityId, value]) => [cityLabels.get(cityId) ?? cityId, value] as [string, T])
        .sort(([left], [right]) => left.localeCompare(right))
    );
  return JSON.stringify({
    state: game.state,
    turn: game.currentTurn,
    map: map
      ? map.tiles
          .flat()
          .map(tile => [
            tile.x,
            tile.y,
            tile.terrain,
            tile.resource ?? null,
            tile.hasRoad,
            tile.hasRailroad,
            [...(tile.improvements ?? [])].sort(),
          ])
      : null,
    cities: game.cityManager
      .getAllCities()
      .map(city => [
        city.x,
        city.y,
        city.population,
        city.foodPerTurn ?? 0,
        city.productionPerTurn ?? 0,
        city.tradePerTurn ?? 0,
        city.sciencePerTurn ?? 0,
        [...city.buildings].sort(),
      ])
      .sort((left, right) => `${left}`.localeCompare(`${right}`)),
    units: [...game.unitManager.getAllUnits().values()]
      .map(unit => [unit.unitTypeId, unit.x, unit.y, unit.health, unit.transportedBy ?? null])
      .sort((left, right) => `${left}`.localeCompare(`${right}`)),
    metrics: captureAIValidationMetrics(game).players.map(({ id: _id, ...metrics }) => metrics),
    plans: [...game.players.values()]
      .map(player => assertAIState(player.aiState).recentPlanSnapshot)
      .filter(plan => plan !== undefined)
      .map(plan => ({
        turn: plan.turn,
        candidateScores: {
          cityProduction: normalizeCityEntries(plan.candidateScores.cityProduction),
          research: plan.candidateScores.research,
        },
        selectedActions: {
          cityProduction: normalizeCityEntries(plan.selectedActions.cityProduction),
          research: plan.selectedActions.research,
        },
        tasks: Object.values(plan.unitTasks)
          .map(task => [
            task.role,
            task.targetX ?? null,
            task.targetY ?? null,
            task.action ?? null,
            task.transportRequired ?? false,
            task.assignedTurn,
          ])
          .sort((left, right) => `${left}`.localeCompare(`${right}`)),
        treasuryGoal: plan.treasuryGoal
          ? { amount: plan.treasuryGoal.amount, reason: plan.treasuryGoal.reason }
          : null,
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    decisions: [...game.players.values()]
      .flatMap(player => assertAIState(player.aiState).recentDecisionTrace ?? [])
      .map(trace => [
        trace.turn,
        trace.label,
        trace.actions,
        trace.input ?? null,
        trace.economicDelta ?? null,
        trace.outcome ?? null,
        trace.error ?? null,
      ])
      .sort((left, right) => `${left}`.localeCompare(`${right}`)),
  });
}

export function assertAIValidationMetricBaseline(
  points: AIValidationMetricPoint[],
  baseline: {
    minimumTurnSamples: number;
    minimumTotalDecisions: number;
    maximumConsecutiveIdleDecisionTurns: number;
  }
): void {
  if (points.length < baseline.minimumTurnSamples) {
    throw new Error(
      `AI validation recorded ${points.length} turn samples; expected ${baseline.minimumTurnSamples}`
    );
  }
  const perPlayer = new Map<string, AIValidationMetricPoint['players'][number][]>();
  for (const point of points) {
    for (const player of point.players) {
      const samples = perPlayer.get(player.id) ?? [];
      samples.push(player);
      perPlayer.set(player.id, samples);
    }
  }
  const totalDecisions = [...perPlayer.values()]
    .flat()
    .reduce((total, sample) => total + sample.decisions, 0);
  if (totalDecisions < baseline.minimumTotalDecisions) {
    throw new Error(`AI players made ${totalDecisions} decisions across the matrix run`);
  }
  for (const [playerId, samples] of perPlayer) {
    assertPlayerDecisionBaseline(playerId, samples, baseline.maximumConsecutiveIdleDecisionTurns);
  }
}

function assertPlayerDecisionBaseline(
  playerId: string,
  samples: AIValidationMetricPoint['players'][number][],
  maximumIdleTurns: number
): void {
  const decisions = samples.reduce((total, sample) => total + sample.decisions, 0);
  if (decisions === 0) return;
  let idle = 0;
  for (const sample of samples) {
    idle = sample.decisions > 0 ? 0 : idle + 1;
    if (idle > maximumIdleTurns) {
      throw new Error('AI player ' + playerId + ' was idle for ' + idle + ' consecutive turns');
    }
  }
}

/**
 * Produces a compact, copyable artifact for deterministic AI simulation failures.
 * Keep this independent of persistence so the same invariant set can run in
 * database integration tests and future headless runners.
 */
export function assertAIValidationInvariants(game: GameInstance): void {
  const map = game.mapManager.getMapData();
  const violations: string[] = [];
  if (!map) violations.push('map data is missing');

  const units = game.unitManager.getAllUnits();
  for (const unit of units.values()) validateUnit(unit, units, game, map, violations);
  for (const city of game.cityManager.getAllCities()) validateCity(city, game, map, violations);

  const players = [...game.players.values()].map(player => {
    const state = assertAIState(player.aiState);
    const ownedUnitIds = new Set(game.unitManager.getPlayerUnits(player.id).map(unit => unit.id));
    for (const unitId of Object.keys(state.unitTasks)) {
      if (!ownedUnitIds.has(unitId)) {
        violations.push(`player ${player.id} retains task for non-owned unit ${unitId}`);
      }
    }
    return {
      id: player.id,
      cityCount: game.cityManager.getPlayerCities(player.id).length,
      unitCount: ownedUnitIds.size,
      decisionCount: state.lastDecisionCount ?? 0,
      taskCount: Object.keys(state.unitTasks).length,
    };
  });

  if (violations.length === 0) return;
  const artifact: AIValidationFailureArtifact = {
    reproduction:
      'npm run test:integration:path -- tests/integration/AIManagerBoundaries.integration.test.ts --runInBand',
    gameId: game.id,
    mapSeed: map?.seed ?? 'missing',
    turn: game.currentTurn,
    violations,
    players,
  };
  throw new Error(`AI validation invariant failure\n${JSON.stringify(artifact, null, 2)}`);
}

function validateUnit(
  unit: any,
  units: Map<string, any>,
  game: GameInstance,
  map: any,
  violations: string[]
): void {
  if (!game.players.has(unit.playerId)) violations.push(`unit ${unit.id} has no owner`);
  validateLocation(`unit ${unit.id}`, unit.x, unit.y, map, violations);
  if (!Number.isFinite(unit.health) || !Number.isFinite(unit.movementLeft))
    violations.push(`unit ${unit.id} has invalid health or movement`);
  validateTransport(unit, units, violations);
  for (const cargoId of unit.cargoUnits ?? []) {
    if (units.get(cargoId)?.transportedBy !== unit.id)
      violations.push(`cargo ${cargoId} does not point back to transport ${unit.id}`);
  }
}

function validateTransport(unit: any, units: Map<string, any>, violations: string[]): void {
  if (!unit.transportedBy) return;
  const transport = units.get(unit.transportedBy);
  if (!transport)
    violations.push(`unit ${unit.id} references missing transport ${unit.transportedBy}`);
  else if (!transport.cargoUnits?.includes(unit.id))
    violations.push(`transport ${transport.id} does not contain cargo ${unit.id}`);
  else if (unit.x !== transport.x || unit.y !== transport.y)
    violations.push(`cargo ${unit.id} is not colocated with transport ${transport.id}`);
}

function validateCity(city: any, game: GameInstance, map: any, violations: string[]): void {
  if (!game.players.has(city.playerId)) violations.push(`city ${city.id} has no owner`);
  if (!Number.isFinite(city.population) || city.population <= 0)
    violations.push(`city ${city.id} has invalid population`);
  validateLocation(`city ${city.id}`, city.x, city.y, map, violations);
}

function validateLocation(
  label: string,
  x: number,
  y: number,
  map: any,
  violations: string[]
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y))
    violations.push(`${label} has a non-finite location`);
  else if (map && (x < 0 || y < 0 || x >= map.width || y >= map.height))
    violations.push(`${label} is outside the map at ${x},${y}`);
}

/**
 * Persists a replayable diagnostic only when a matrix case fails. Test output
 * is deliberately ignored by Git, while the artifact itself is self-contained
 * enough to rerun the exact seed/configuration from the focused Docker command.
 */
export function writeAIValidationFailureArtifact(
  game: GameInstance,
  context: AIValidationArtifactContext
): string {
  const map = game.mapManager.getMapData();
  const outputDirectory = resolve(process.cwd(), 'test-results', 'ai-validation');
  mkdirSync(outputDirectory, { recursive: true });
  const safeSeed = (map?.seed ?? 'missing').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `failure-${safeSeed}-turn-${game.currentTurn}.json`;
  const path = resolve(outputDirectory, filename);
  const players = [...game.players.values()].map(player => ({
    id: player.id,
    aiState: assertAIState(player.aiState),
  }));
  const artifact = {
    version: 1,
    commit: process.env.GIT_COMMIT ?? 'unknown',
    reproduction:
      `AI_VALIDATION_SEED_COUNT=25 INTEGRATION_TEST_PATH=tests/integration/AIManagerBoundaries.integration.test.ts ` +
      `npm run test:integration:path -- tests/integration/AIManagerBoundaries.integration.test.ts`,
    configuration: context.configuration,
    failure: {
      turn: game.currentTurn,
      phase: context.phase,
      error: context.error instanceof Error ? context.error.message : String(context.error),
    },
    metrics: context.metrics,
    lastKnownGoodSnapshot: context.lastKnownGoodSnapshot,
    snapshot: {
      gameId: game.id,
      state: game.state,
      map,
      cities: game.cityManager.getAllCities(),
      units: [...game.unitManager.getAllUnits().values()],
      players,
    },
  };
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}
