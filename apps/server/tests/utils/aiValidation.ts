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
  for (const unit of units.values()) {
    if (!game.players.has(unit.playerId)) violations.push(`unit ${unit.id} has no owner`);
    if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) {
      violations.push(`unit ${unit.id} has a non-finite location`);
    } else if (map && (unit.x < 0 || unit.y < 0 || unit.x >= map.width || unit.y >= map.height)) {
      violations.push(`unit ${unit.id} is outside the map at ${unit.x},${unit.y}`);
    }
    if (!Number.isFinite(unit.health) || !Number.isFinite(unit.movementLeft)) {
      violations.push(`unit ${unit.id} has invalid health or movement`);
    }
    if (unit.transportedBy) {
      const transport = units.get(unit.transportedBy);
      if (!transport) violations.push(`unit ${unit.id} references missing transport ${unit.transportedBy}`);
      else if (!transport.cargoUnits?.includes(unit.id)) {
        violations.push(`transport ${transport.id} does not contain cargo ${unit.id}`);
      } else if (unit.x !== transport.x || unit.y !== transport.y) {
        violations.push(`cargo ${unit.id} is not colocated with transport ${transport.id}`);
      }
    }
    for (const cargoId of unit.cargoUnits ?? []) {
      if (units.get(cargoId)?.transportedBy !== unit.id) {
        violations.push(`cargo ${cargoId} does not point back to transport ${unit.id}`);
      }
    }
  }

  for (const city of game.cityManager.getAllCities()) {
    if (!game.players.has(city.playerId)) violations.push(`city ${city.id} has no owner`);
    if (!Number.isFinite(city.population) || city.population <= 0) {
      violations.push(`city ${city.id} has invalid population`);
    }
    if (!Number.isFinite(city.x) || !Number.isFinite(city.y)) {
      violations.push(`city ${city.id} has a non-finite location`);
    } else if (map && (city.x < 0 || city.y < 0 || city.x >= map.width || city.y >= map.height)) {
      violations.push(`city ${city.id} is outside the map at ${city.x},${city.y}`);
    }
  }

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
