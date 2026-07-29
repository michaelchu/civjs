import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { ActionType } from '@app-types/shared/actions';
import { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { rankCitySites } from '@game/ai/FreecivAIPlanner';
import { createAIDecisionSource } from '@game/ai/FreecivAIDecisionSource';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import { chooseGuardRendezvous, planCityGuards } from '@game/ai/FreecivAIGuardPlanner';
import { planHunterMissileLaunches, planHunters } from '@game/ai/FreecivAIHunterPlanner';
import {
  hostileUnitsForPlanning,
  sortedPlayerUnits,
  targetableForeignCities,
} from '@game/ai/FreecivAITargeting';
import { planWorkerImprovements, type WorkerAssignment } from '@game/ai/FreecivAIWorkerPlanner';
import {
  explorationAdditionalStepCost,
  planExploration,
  type ExplorationPlan,
} from '@game/ai/FreecivAIExplorerPlanner';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { planMilitaryRecovery } from '@game/ai/FreecivAIRecoveryPlanner';
import {
  buildMilitaryTravelTimes,
  militaryTravelKey,
  planMilitaryCampaign,
  selectProjectedCityDefender,
  type MilitaryObjective,
} from '@game/ai/FreecivAIMilitaryPlanner';
import {
  buildCityThreatTravelTimes,
  cityThreatTravelKey,
} from '@game/ai/FreecivAICityDangerPlanner';

function unitAttack(type: UnitType): number {
  return type.attack ?? type.combat ?? 0;
}

function hasPositiveValue(value: number | undefined): boolean {
  return Number(value) > 0;
}

function isSpecializedAwayFromExploration(type: UnitType): boolean {
  return [
    hasPositiveValue(type.transport_capacity),
    hasPositiveValue(type.fuel),
    hasPositiveValue(type.paratroopersRange),
    type.flags?.includes('GameLoss') === true,
  ].includes(true);
}

function shouldPreserveInactiveUnit(candidate: Unit, preserveInactive: boolean): boolean {
  if (!preserveInactive) return false;
  return [candidate.fortified, candidate.sentryUntil !== undefined].includes(true);
}

function hasBasicExplorerAvailability(
  game: GameInstance,
  state: FreecivAIState,
  candidate: Unit
): boolean {
  const type = game.unitManager.getUnitType(candidate.unitTypeId);
  if (candidate.movementLeft <= 0) return false;
  if (candidate.transportedBy) return false;
  if (!type) return false;
  if (type.canBuildImprovements) return false;
  if (type.canFoundCity) return false;
  const task = state.unitTasks[candidate.id];
  if (task && task.role !== 'explore') return false;
  return true;
}

function isIdleMilitaryExplorer(
  type: UnitType,
  candidate: Unit,
  preserveInactive: boolean
): boolean {
  if (!['military', 'naval'].includes(type.unitClass)) return false;
  if (unitAttack(type) <= 0) return false;
  if (isSpecializedAwayFromExploration(type)) return false;
  if (shouldPreserveInactiveUnit(candidate, preserveInactive)) return false;
  return true;
}

function isAvailableExplorer(
  game: GameInstance,
  state: FreecivAIState,
  candidate: Unit,
  preserveInactive: boolean
): boolean {
  if (!hasBasicExplorerAvailability(game, state, candidate)) return false;
  const type = game.unitManager.getUnitType(candidate.unitTypeId)!;
  if (type.roles?.includes('Explorer')) return true;
  return isIdleMilitaryExplorer(type, candidate, preserveInactive);
}

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
    const hostileCities = targetableForeignCities(game, playerId, hostilePlayerIds, profile);
    const decisions = createAIDecisionSource(game, playerId, 'military-target');
    const existingCityTargets = new Map(
      Object.entries(state.unitTasks)
        .filter(
          ([, task]) =>
            task.role === 'attack' &&
            Boolean(task.targetId && hostileCities.some(city => city.id === task.targetId))
        )
        .map(([unitId, task]) => [unitId, task.targetId!] as const)
    );
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'attack' || task.role === 'retreat') delete state.unitTasks[unitId];
    }
    let actions = 0;
    const attackers = sortedPlayerUnits(game, playerId).flatMap(attacker => {
      if (
        ['guard', 'defend', 'hunter', 'air', 'paradrop', 'recover'].includes(
          state.unitTasks[attacker.id]?.role ?? ''
        )
      ) {
        return [];
      }
      if (
        profile.handicaps.has('away') &&
        (attacker.fortified || attacker.sentryUntil !== undefined)
      ) {
        return [];
      }
      const type = game.unitManager.getUnitType(attacker.unitTypeId);
      if (attacker.movementLeft <= 0 || !type || (type.attack ?? type.combat ?? 0) <= 0) return [];
      return [{ unit: attacker, type }];
    });
    const militaryTravelTimes = await buildMilitaryTravelTimes({
      attackers: attackers.map(attacker => attacker.unit),
      targets: [
        ...enemies.map(enemy => ({ x: enemy.x, y: enemy.y })),
        ...hostileCities.map(city => ({ x: city.x, y: city.y })),
      ],
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY),
    });
    const campaign = planMilitaryCampaign({
      attackers,
      hostileUnits: enemies.filter(target => Boolean(game.unitManager.getUnit(target.id))),
      hostileCities,
      existingCityTargets,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      travelTurns: (attacker, targetX, targetY) =>
        militaryTravelTimes.get(militaryTravelKey(attacker.id, targetX, targetY)),
      isStackProtected: (x, y) => {
        const tile = game.mapManager.getTile(x, y);
        return Boolean(
          game.cityManager.getCityAt(x, y) ||
            tile?.improvements?.some((extra: string) => ['fortress', 'airbase'].includes(extra))
        );
      },
      acceptObjective: (attacker, target) =>
        decisions.fuzzy(`${attacker.id}:${target.targetId}`, true),
      attackerRating: unit => game.unitManager.calculateUnitAttackRating(unit),
      defenderRating: (attacker, defender) =>
        game.unitManager.calculateUnitDefenseRating(defender, attacker),
      projectedDefender:
        typeof game.cityManager.canCityContinueProduction === 'function'
          ? (city, attacker) =>
              selectProjectedCityDefender({
                gameId: game.id,
                city,
                attacker,
                unitTypes: Object.values(UNIT_TYPES),
                canBuild: (cityId, unitTypeId) =>
                  game.cityManager.canCityContinueProduction(cityId, 'unit', unitTypeId),
                rateDefense: (defender, projectedAttacker) =>
                  game.unitManager.calculateUnitDefenseRating(defender, projectedAttacker),
              })
          : undefined,
      causesMilitaryUnhappiness: attacker => {
        if (
          !attacker.homeCityId ||
          typeof game.cityManager.getCityMilitaryUnhappiness !== 'function'
        ) {
          return false;
        }
        const currentCity = game.cityManager.getCityAt(attacker.x, attacker.y);
        return Boolean(
          currentCity?.id === attacker.homeCityId &&
            game.cityManager.getCityMilitaryUnhappiness(attacker.homeCityId) > 0
        );
      },
    });

    for (const { unit: plannedAttacker, type } of attackers) {
      const attacker = game.unitManager.getUnit(plannedAttacker.id);
      if (!attacker) continue;
      const objective = campaign.assignments.get(attacker.id);
      if (!objective) {
        actions += await this.retreatDamagedUnit(game, attacker, playerId, state);
        continue;
      }
      state.unitTasks[attacker.id] = {
        role: 'attack',
        targetId: objective.targetId,
        targetX: objective.x,
        targetY: objective.y,
        assignedTurn: game.currentTurn,
      };
      actions += await this.executeMilitaryObjective(game, attacker, type, objective, playerId);
    }
    return actions;
  }

  private async executeMilitaryObjective(
    game: GameInstance,
    attacker: Unit,
    type: UnitType,
    objective: MilitaryObjective,
    playerId: string
  ): Promise<number> {
    if (!objective.defender) {
      const result = await game.unitManager.executeUnitAction(
        attacker.id,
        ActionType.GOTO,
        objective.x,
        objective.y,
        playerId
      );
      return result.success ? 1 : 0;
    }
    const distance = game.mapManager.getDistance(attacker.x, attacker.y, objective.x, objective.y);
    if (distance > (type.range ?? 1)) {
      return this.moveTowardMilitaryTarget(game, attacker, objective.x, objective.y);
    }
    const defender = game.unitManager.getUnit(objective.defender.id);
    if (!defender) return 0;
    if (type.flags?.includes('Nuclear')) {
      await game.unitManager.executeUnitAction(
        attacker.id,
        ActionType.NUCLEAR_EXPLOSION,
        defender.x,
        defender.y,
        playerId
      );
    } else if (type.rulesetUnitClassFlags?.includes('Missile')) {
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
    return 1;
  }

  private async retreatDamagedUnit(
    game: GameInstance,
    unit: Unit,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    if (unit.health >= 50 || unit.movementLeft <= 0) return 0;
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const owners = new Set([playerId, ...relations.allied]);
    const candidates = await Promise.all(
      game.cityManager
        .getAllCities()
        .filter(city => owners.has(city.playerId))
        .map(async city => ({
          city,
          path: await game.pathfindingManager.findPath(unit, city.x, city.y),
          regeneration: game.unitManager.calculateUnitHitpointRecovery(unit, city.x, city.y)
            .regeneration,
        }))
    );
    const destination = candidates
      .filter(candidate => candidate.path.valid)
      .sort(
        (left, right) =>
          left.path.totalCost * (left.regeneration > 0 ? 1 : 3) -
            right.path.totalCost * (right.regeneration > 0 ? 1 : 3) ||
          left.city.id.localeCompare(right.city.id)
      )[0]?.city;
    if (!destination) return 0;
    state.unitTasks[unit.id] = {
      role: 'retreat',
      targetId: destination.id,
      targetX: destination.x,
      targetY: destination.y,
      assignedTurn: game.currentTurn,
    };
    if (unit.x === destination.x && unit.y === destination.y) return 0;
    const result = await game.unitManager.executeUnitAction(
      unit.id,
      ActionType.GOTO,
      destination.x,
      destination.y,
      playerId
    );
    return result.success ? 1 : 0;
  }

  async manageMilitaryRecovery(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const friendlyCityOwners = new Set([playerId, ...relations.allied]);
    const plan = await planMilitaryRecovery({
      turn: game.currentTurn,
      units: game.unitManager.getPlayerUnits(playerId),
      cities: game.cityManager.getAllCities().filter(city => friendlyCityOwners.has(city.playerId)),
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY),
      hasAcceleratedRegeneration: (unit, city) =>
        game.unitManager.calculateUnitHitpointRecovery(unit, city.x, city.y).regeneration > 0,
    });

    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'recover') delete state.unitTasks[unitId];
    }
    Object.assign(state.unitTasks, plan.tasks);

    let actions = 0;
    for (const assignment of plan.assignments) {
      const unit = game.unitManager.getUnit(assignment.unit.id);
      if (
        !unit ||
        unit.movementLeft <= 0 ||
        (unit.x === assignment.city.x && unit.y === assignment.city.y)
      ) {
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        assignment.city.x,
        assignment.city.y,
        playerId
      );
      if (result.success) actions++;
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
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const threatTravelTimes = await buildCityThreatTravelTimes({
      cities,
      threateningUnits: hostileUnits,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      getUnit: unitId => game.unitManager.getUnit(unitId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY),
    });
    const plan = planCityGuards({
      turn: game.currentTurn,
      cities,
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits,
      existingTasks: state.unitTasks,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      threatTravelTurns: (unit, city) =>
        threatTravelTimes.get(cityThreatTravelKey(unit.id, city.id)),
      defenderStrength: unit => game.unitManager.calculateUnitDefenseRating(unit),
      attackerStrength: (unit, type, city) => {
        const attack = game.unitManager.calculateUnitAttackRating(unit);
        const defenseBonus = game.unitManager.calculateCityDefenseBonusAgainst(
          unit,
          type,
          city.x,
          city.y
        );
        return (attack * 100) / Math.max(1, 100 + defenseBonus);
      },
      unitAttackerStrength: unit => game.unitManager.calculateUnitAttackRating(unit),
      profile,
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
      const city = task.targetId ? game.cityManager.getCity?.(task.targetId) : undefined;
      const charge = task.targetId ? game.unitManager.getUnit(task.targetId) : undefined;
      if (!unit || (!city && !charge) || unit.movementLeft <= 0) continue;
      if (profile.handicaps.has('away') && (unit.fortified || unit.sentryUntil !== undefined)) {
        continue;
      }
      const destination = city
        ? { x: city.x, y: city.y }
        : chooseGuardRendezvous(
            unit,
            charge!,
            state.unitTasks[charge!.id],
            unitTypeId => game.unitManager.getUnitType(unitTypeId),
            (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY)
          );
      if (unit.x === destination.x && unit.y === destination.y) {
        if (!city) continue;
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
      if (
        !game.unitManager.canUnitPerformAction(
          unit.id,
          ActionType.GOTO,
          destination.x,
          destination.y
        )
      ) {
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        unit.id,
        ActionType.GOTO,
        destination.x,
        destination.y,
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
      actions += await this.launchHunterMissiles(game, hunter, target, hostileUnits);
      if (!game.unitManager.getUnit(target.id)) continue;
      if (
        game.mapManager.getDistance(hunter.x, hunter.y, target.x, target.y) <= (type.range ?? 1)
      ) {
        await game.unitManager.attackUnit(hunter.id, target.id);
        actions++;
        continue;
      }
      actions += await this.moveTowardMilitaryTarget(game, hunter, target.x, target.y);
      const movedHunter = game.unitManager.getUnit(hunter.id);
      const survivingTarget = game.unitManager.getUnit(target.id);
      if (movedHunter && survivingTarget) {
        actions += await this.launchHunterMissiles(
          game,
          movedHunter,
          survivingTarget,
          hostileUnits
        );
      }
    }
    return actions;
  }

  private async launchHunterMissiles(
    game: GameInstance,
    hunter: Unit,
    primaryTarget: Unit,
    hostileUnits: Unit[]
  ): Promise<number> {
    if (typeof game.unitManager.unloadUnit !== 'function') return 0;
    const launches = planHunterMissileLaunches(
      hunter,
      primaryTarget,
      game.unitManager.getPlayerUnits(hunter.playerId),
      hostileUnits.filter(target => Boolean(game.unitManager.getUnit(target.id))),
      unitTypeId => game.unitManager.getUnitType(unitTypeId),
      (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY)
    );
    let actions = 0;
    for (const launch of launches) {
      let missile = game.unitManager.getUnit(launch.missile.id);
      const target = game.unitManager.getUnit(launch.target.id);
      if (!missile || !target) continue;
      if (missile.transportedBy) {
        if (!(await game.unitManager.unloadUnit(missile.id, hunter.x, hunter.y))) continue;
        actions++;
        missile = game.unitManager.getUnit(missile.id);
        if (!missile) continue;
      }
      if (game.mapManager.getDistance(missile.x, missile.y, target.x, target.y) > 1) {
        actions += await this.moveTowardMilitaryTarget(game, missile, target.x, target.y);
        missile = game.unitManager.getUnit(missile.id);
      }
      if (
        !missile ||
        !game.unitManager.getUnit(target.id) ||
        game.mapManager.getDistance(missile.x, missile.y, target.x, target.y) > 1
      ) {
        continue;
      }
      const missileType = game.unitManager.getUnitType(missile.unitTypeId);
      const action = missileType?.flags?.includes('Nuclear')
        ? ActionType.NUCLEAR_EXPLOSION
        : ActionType.SUICIDE_ATTACK;
      if (!game.unitManager.canUnitPerformAction(missile.id, action, target.x, target.y)) continue;
      const result = await game.unitManager.executeUnitAction(
        missile.id,
        action,
        target.x,
        target.y,
        missile.playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }

  private async moveTowardMilitaryTarget(
    game: GameInstance,
    attacker: Unit,
    targetX: number,
    targetY: number
  ): Promise<number> {
    if (
      typeof game.mapManager.getNeighbors !== 'function' ||
      typeof game.pathfindingManager?.findPath !== 'function'
    ) {
      return 0;
    }
    const candidates = await Promise.all(
      game.mapManager.getNeighbors(targetX, targetY).map(async tile => ({
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

  async automateExploration(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const map = game.mapManager.getMapData();
    if (!map || typeof game.pathfindingManager?.findPath !== 'function') return 0;
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const explorers = sortedPlayerUnits(game, playerId).filter(candidate =>
      isAvailableExplorer(game, state, candidate, profile.handicaps.has('away'))
    );
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const visibleUnits = game.unitManager.getVisibleUnits(
      playerId,
      game.visibilityManager.getVisibleTiles(playerId),
      game.visibilityManager.getDetectionTiles(playerId)
    );
    const nonAlliedUnits = visibleUnits.filter(
      unit => unit.playerId !== playerId && !relations.allied.has(unit.playerId)
    );
    const nonAlliedCityTiles = new Set(
      game.cityManager
        .getAllCities()
        .filter(
          city =>
            city.playerId !== playerId &&
            !relations.allied.has(city.playerId) &&
            game.visibilityManager.isTileExplored(playerId, city.x, city.y)
        )
        .map(city => `${city.x},${city.y}`)
    );
    const routeContext = {
      map,
      exploredTiles: game.visibilityManager.getExploredTiles(playerId),
      hostileUnits: nonAlliedUnits.filter(unit => relations.hostile.has(unit.playerId)),
      nonAlliedUnits,
      nonAlliedCityTiles,
      getType: (unitTypeId: string) => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX: number, fromY: number, toX: number, toY: number) =>
        game.mapManager.getDistance(fromX, fromY, toX, toY),
      mayExploreTile: (unit: Unit, tile: (typeof map.tiles)[number][number]) => {
        if (!tile.owner || tile.owner === playerId || relations.allied.has(tile.owner)) return true;
        const type = game.unitManager.getUnitType(unit.unitTypeId);
        if (type?.unitClass === 'civilian' || type?.flags?.includes('NonMil')) return true;
        return relations.hostile.has(tile.owner);
      },
    };
    const plan = await planExploration({
      turn: game.currentTurn,
      playerId,
      units: explorers,
      ...routeContext,
      existingTasks: state.unitTasks,
      getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
      squaredDistance: (fromX, fromY, toX, toY) =>
        game.mapManager.getTopology().squaredDistance(fromX, fromY, toX, toY),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY, {
          additionalStepCost: (actor, _fromX, _fromY, toX, toY) =>
            explorationAdditionalStepCost(routeContext, actor, toX, toY),
        }),
      knowsHuts: !profile.handicaps.has('huts'),
    });
    this.replaceExplorationTasks(state, plan);
    return this.executeExplorationPlan(game, state, plan);
  }

  private replaceExplorationTasks(state: FreecivAIState, plan: ExplorationPlan): void {
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'explore') delete state.unitTasks[unitId];
    }
    Object.assign(state.unitTasks, plan.tasks);
  }

  private async executeExplorationPlan(
    game: GameInstance,
    state: FreecivAIState,
    plan: ExplorationPlan
  ): Promise<number> {
    let actions = 0;
    for (const assignment of plan.assignments) {
      if (await this.followExplorationPath(game, state, assignment)) actions++;
    }
    return actions;
  }

  private async followExplorationPath(
    game: GameInstance,
    state: FreecivAIState,
    assignment: ExplorationPlan['assignments'][number]
  ): Promise<boolean> {
    let moved = false;
    try {
      for (const step of assignment.path.path.slice(1)) {
        const unit = game.unitManager.getUnit(assignment.unit.id);
        if (!unit || unit.movementLeft <= 0) break;
        if (!(await game.unitManager.moveUnit(unit.id, step.x, step.y))) break;
        moved = true;
      }
    } catch {
      delete state.unitTasks[assignment.unit.id];
      return false;
    }
    if (!moved) delete state.unitTasks[assignment.unit.id];
    return moved;
  }
}
