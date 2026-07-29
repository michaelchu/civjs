import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import { ActionType } from '@app-types/shared/actions';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { rankCitySites, rankMilitaryTargets } from '@game/ai/FreecivAIPlanner';
import { createAIDecisionSource } from '@game/ai/FreecivAIDecisionSource';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import { planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { planHunters } from '@game/ai/FreecivAIHunterPlanner';
import { hostileUnitsForPlanning, sortedPlayerUnits } from '@game/ai/FreecivAITargeting';
import { planWorkerImprovements, type WorkerAssignment } from '@game/ai/FreecivAIWorkerPlanner';

/**
 * Executes expansion, worker, transport, military, and special-unit decisions
 * through authoritative unit and city managers.
 */
export class FreecivAIUnitController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async foundReadyCities(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    let actions = 0;
    for (const unit of sortedPlayerUnits(game, playerId)) {
      if (
        unit.movementLeft <= 0 ||
        unit.transportedBy ||
        !game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
      ) {
        continue;
      }
      if (game.unitManager.canUnitPerformAction(unit.id, ActionType.FOUND_CITY)) {
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          ActionType.FOUND_CITY,
          undefined,
          undefined,
          playerId
        );
        if (result.success) actions++;
        continue;
      }
      actions += await this.moveSettlerTowardBestSite(game, unit, state);
    }
    return actions;
  }

  private async moveSettlerTowardBestSite(
    game: GameInstance,
    unit: Unit,
    state: FreecivAIState
  ): Promise<number> {
    const map = game.mapManager.getMapData?.();
    if (
      !map ||
      typeof game.cityManager.canFoundCityAt !== 'function' ||
      typeof game.pathfindingManager?.findPath !== 'function'
    ) {
      return 0;
    }
    const player = game.players.get(unit.playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const cities = game.cityManager.getAllCities();
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, unit.playerId);
    const hostileUnits = hostileUnitsForPlanning(game, unit.playerId, hostileIds, profile);
    const candidates = rankCitySites(
      map.tiles
        .flat()
        .filter(tile => game.cityManager.canFoundCityAt(tile.x, tile.y, unit.playerId)),
      (x, y) => game.mapManager.getNeighbors(x, y),
      terrain => rulesetLoader.getTerrain(terrain),
      tile => game.mapManager.getDistance(unit.x, unit.y, tile.x, tile.y),
      tile =>
        cities.length === 0
          ? Number.MAX_SAFE_INTEGER
          : Math.min(
              ...cities.map(city => game.mapManager.getDistance(city.x, city.y, tile.x, tile.y))
            ),
      tile =>
        hostileUnits.reduce((sum, enemy) => {
          const distance = game.mapManager.getDistance(tile.x, tile.y, enemy.x, enemy.y);
          return distance <= 3 ? sum + 1 / Math.max(1, distance) : sum;
        }, 0),
      (profile.expansion / 100) * (profile.traits.expansionist / 50)
    ).slice(0, 24);
    for (const candidate of candidates) {
      state.unitTasks[unit.id] = {
        role: 'settle',
        targetX: candidate.tile.x,
        targetY: candidate.tile.y,
        assignedTurn: game.currentTurn,
      };
      const path = await game.pathfindingManager.findPath(unit, candidate.tile.x, candidate.tile.y);
      if (!path.valid || path.path.length < 2) continue;
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        candidate.tile.x,
        candidate.tile.y,
        unit.playerId
      );
      return result.success ? 1 : 0;
    }
    return 0;
  }

  async automateWorkers(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const workers = sortedPlayerUnits(game, playerId).filter(unit => {
      const type = game.unitManager.getUnitType(unit.unitTypeId);
      return Boolean(
        type?.canBuildImprovements &&
          state.unitTasks[unit.id]?.role !== 'settle' &&
          state.unitTasks[unit.id]?.role !== 'ferry'
      );
    });
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const plan = planWorkerImprovements({
      turn: game.currentTurn,
      playerId,
      workers,
      cities: game.cityManager.getPlayerCities(playerId),
      hostileUnits: hostileUnitsForPlanning(game, playerId, hostileIds, profile),
      existingTasks: state.unitTasks,
      getTile: (x, y) => game.mapManager.getTile(x, y),
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      researchedTechs:
        game.researchManager.getPlayerResearch(playerId)?.researchedTechs ?? new Set(),
    });

    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'worker') delete state.unitTasks[unitId];
    }
    Object.assign(state.unitTasks, plan.tasks);

    let actions = 0;
    for (const assignment of plan.assignments) {
      actions += await this.executeWorkerAssignment(game, playerId, state, assignment);
    }
    return actions;
  }

  private async executeWorkerAssignment(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    assignment: WorkerAssignment
  ): Promise<number> {
    const unit = game.unitManager.getUnit(assignment.unit.id);
    if (!unit || unit.movementLeft <= 0) return 0;
    if (unit.x === assignment.tile.x && unit.y === assignment.tile.y) {
      return this.startWorkerActivity(game, playerId, state, assignment, unit);
    }
    return this.moveWorkerToAssignment(game, playerId, state, assignment, unit);
  }

  private async startWorkerActivity(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    assignment: WorkerAssignment,
    unit: Unit
  ): Promise<number> {
    if (!game.unitManager.canUnitPerformAction(unit.id, assignment.action)) {
      delete state.unitTasks[unit.id];
      return 0;
    }
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      assignment.action,
      undefined,
      undefined,
      playerId
    );
    return result.success ? 1 : 0;
  }

  private async moveWorkerToAssignment(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    assignment: WorkerAssignment,
    unit: Unit
  ): Promise<number> {
    if (
      typeof game.pathfindingManager?.findPath !== 'function' ||
      !game.unitManager.canUnitPerformAction(
        unit.id,
        ActionType.GOTO,
        assignment.tile.x,
        assignment.tile.y
      )
    ) {
      delete state.unitTasks[unit.id];
      return 0;
    }
    const path = await game.pathfindingManager.findPath(unit, assignment.tile.x, assignment.tile.y);
    if (!path.valid || path.path.length < 2) {
      delete state.unitTasks[unit.id];
      return 0;
    }
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.GOTO,
      assignment.tile.x,
      assignment.tile.y,
      playerId
    );
    return result.success ? 1 : 0;
  }

  async attackAdjacentEnemies(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostilePlayerIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const enemies = hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile)
      .filter(unit => !unit.transportedBy)
      .sort((a, b) => a.id.localeCompare(b.id));
    const decisions = createAIDecisionSource(game, playerId, 'military-target');
    let actions = 0;

    for (const attacker of sortedPlayerUnits(game, playerId)) {
      if (state.unitTasks[attacker.id]?.role === 'guard') continue;
      if (state.unitTasks[attacker.id]?.role === 'defend') continue;
      if (state.unitTasks[attacker.id]?.role === 'hunter') continue;
      if (state.unitTasks[attacker.id]?.role === 'air') continue;
      if (state.unitTasks[attacker.id]?.role === 'paradrop') continue;
      if (
        profile.handicaps.has('away') &&
        (attacker.fortified || attacker.sentryUntil !== undefined)
      ) {
        continue;
      }
      const type = game.unitManager.getUnitType(attacker.unitTypeId);
      if (attacker.movementLeft <= 0 || (type?.attack ?? type?.combat ?? 0) <= 0) continue;
      if (!type) continue;
      const ranked = rankMilitaryTargets(
        attacker,
        type,
        enemies.filter(target => Boolean(game.unitManager.getUnit(target.id))),
        unitTypeId => game.unitManager.getUnitType(unitTypeId),
        target => game.mapManager.getDistance(attacker.x, attacker.y, target.x, target.y)
      );
      const considered = ranked.filter(target =>
        decisions.fuzzy(`${attacker.id}:${target.unit.id}`, true)
      );
      let defender = considered.find(target => target.distance <= (type.range ?? 1))?.unit;
      if (!defender) {
        const target = considered[0]?.unit;
        if (target) {
          actions += await this.moveTowardMilitaryTarget(game, attacker, target);
          defender =
            game.unitManager.getUnit(target.id) &&
            game.mapManager.getDistance(attacker.x, attacker.y, target.x, target.y) <=
              (type.range ?? 1)
              ? target
              : undefined;
        }
      }
      if (!defender) continue;
      if (type?.flags?.includes('Nuclear')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.NUCLEAR_EXPLOSION,
          defender.x,
          defender.y,
          playerId
        );
      } else if (type?.rulesetUnitClassFlags?.includes('Missile')) {
        await game.unitManager.executeUnitAction(
          attacker.id,
          ActionType.SUICIDE_ATTACK,
          defender.x,
          defender.y,
          playerId
        );
      } else {
        await game.unitManager.attackUnit(attacker.id, defender.id);
      }
      actions++;
    }
    return actions;
  }

  async manageCityGuards(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .filter(city => Number.isFinite(city.x) && Number.isFinite(city.y));
    if (cities.length === 0) return 0;
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const plan = planCityGuards({
      turn: game.currentTurn,
      cities,
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits,
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      dangerHandicap: profile.handicaps.has('danger'),
    });

    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'guard' || task.role === 'defend') {
        delete state.unitTasks[unitId];
      }
    }
    Object.assign(state.unitTasks, plan.assignments);

    let actions = 0;
    for (const [unitId, task] of Object.entries(plan.assignments).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const unit = game.unitManager.getUnit(unitId);
      const city = task.targetId ? game.cityManager.getCity(task.targetId) : undefined;
      if (!unit || !city || unit.movementLeft <= 0) continue;
      if (profile.handicaps.has('away') && (unit.fortified || unit.sentryUntil !== undefined)) {
        continue;
      }
      if (unit.x === city.x && unit.y === city.y) {
        if (!unit.fortified && game.unitManager.canUnitPerformAction(unit.id, ActionType.FORTIFY)) {
          const result = await game.unitManager.executeUnitAction(
            unit.id,
            ActionType.FORTIFY,
            undefined,
            undefined,
            playerId
          );
          if (result.success) actions++;
        }
        continue;
      }
      if (!game.unitManager.canUnitPerformAction(unit.id, ActionType.GOTO, city.x, city.y)) {
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        city.x,
        city.y,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  async manageHunters(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile).filter(
      unit => !unit.transportedBy
    );
    const plan = planHunters({
      turn: game.currentTurn,
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits,
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'hunter') delete state.unitTasks[unitId];
    }
    Object.assign(state.unitTasks, plan.assignments);

    let actions = 0;
    for (const [unitId, task] of Object.entries(plan.assignments).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      const hunter = game.unitManager.getUnit(unitId);
      const target = task.targetId ? game.unitManager.getUnit(task.targetId) : undefined;
      if (!hunter || !target || hunter.movementLeft <= 0) continue;
      if (profile.handicaps.has('away') && (hunter.fortified || hunter.sentryUntil !== undefined)) {
        continue;
      }
      const type = game.unitManager.getUnitType(hunter.unitTypeId);
      if (!type) continue;
      if (
        game.mapManager.getDistance(hunter.x, hunter.y, target.x, target.y) <= (type.range ?? 1)
      ) {
        await game.unitManager.attackUnit(hunter.id, target.id);
        actions++;
        continue;
      }
      actions += await this.moveTowardMilitaryTarget(game, hunter, target);
    }
    return actions;
  }

  private async moveTowardMilitaryTarget(
    game: GameInstance,
    attacker: Unit,
    target: Unit
  ): Promise<number> {
    if (
      typeof game.mapManager.getNeighbors !== 'function' ||
      typeof game.pathfindingManager?.findPath !== 'function'
    ) {
      return 0;
    }
    const candidates = await Promise.all(
      game.mapManager.getNeighbors(target.x, target.y).map(async tile => ({
        tile,
        path: await game.pathfindingManager.findPath(attacker, tile.x, tile.y),
      }))
    );
    const destination = candidates
      .filter(candidate => candidate.path.valid && candidate.path.path.length > 1)
      .sort(
        (a, b) =>
          a.path.estimatedTurns - b.path.estimatedTurns ||
          a.path.totalCost - b.path.totalCost ||
          a.tile.x - b.tile.x ||
          a.tile.y - b.tile.y
      )[0]?.tile;
    if (!destination) return 0;
    const result = await game.unitManager.executeUnitAction(
      attacker.id,
      ActionType.GOTO,
      destination.x,
      destination.y,
      attacker.playerId
    );
    return result.success ? 1 : 0;
  }

  async automateExploration(game: GameInstance, playerId: string): Promise<number> {
    const unit = sortedPlayerUnits(game, playerId).find(candidate => {
      const type = game.unitManager.getUnitType(candidate.unitTypeId);
      return (
        candidate.movementLeft > 0 &&
        !candidate.automation &&
        !type?.canBuildImprovements &&
        (type?.attack ?? type?.combat ?? 0) <= 0 &&
        game.unitManager.canUnitPerformAction(candidate.id, ActionType.AUTO_EXPLORE)
      );
    });
    if (!unit) return 0;
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.AUTO_EXPLORE,
      undefined,
      undefined,
      playerId
    );
    return result.success ? 1 : 0;
  }
}
