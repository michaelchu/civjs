import { ActionType } from '@app-types/shared/actions';
import { planAirMissions, type AirMission, type AirRefuelPoint } from '@game/ai/AIAirPlanner';
import { planDiplomatMissions, type DiplomatMission } from '@game/ai/AIDiplomatPlanner';
import { planParadropMissions, type ParadropMission } from '@game/ai/AIParadropPlanner';
import { createAIProfile } from '@game/ai/AIProfile';
import type { FreecivAIState } from '@game/ai/AIStateStore';
import { hostileUnitsForPlanning, targetableForeignCities } from '@game/ai/AITargeting';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import {
  calculateDiplomatBribeCost,
  calculateDiplomatInciteCost,
} from '@game/services/DiplomatActionEconomics';
import { calculateTreasuryReserve } from '@game/ai/AITreasuryPlanner';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { CityState } from '@game/managers/CityManager';
import type { MapTile } from '@game/map/MapTypes';

function buildAirRefuelPoints(options: {
  game: GameInstance;
  friendlyUnits: Unit[];
  friendlyCities: CityState[];
  hostileUnits: Unit[];
  mapTiles: MapTile[];
}): AirRefuelPoint[] {
  const { game, friendlyUnits, friendlyCities, hostileUnits, mapTiles } = options;
  const points: AirRefuelPoint[] = friendlyCities.map(city => {
    const defenders = friendlyUnits.filter(
      unit => unit.x === city.x && unit.y === city.y && !unit.transportedBy
    );
    const graveDanger = hostileUnits.filter(enemy => {
      const type = game.unitManager.getUnitType(enemy.unitTypeId);
      return (
        game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y) <= 1 &&
        type?.rulesetUnitClassFlags.includes('CanOccupyCity') === true &&
        type.flags?.includes('NonMil') !== true
      );
    }).length;
    return {
      id: city.id,
      kind: 'city',
      x: city.x,
      y: city.y,
      city,
      graveDanger,
      defenderCount: defenders.length,
      recoveryTurns: (unit: Unit) => {
        const gain = game.unitManager.calculateUnitHitpointRecovery(unit, city.x, city.y).gain;
        return gain > 0 ? Math.ceil(Math.max(0, 100 - unit.health) / gain) : Infinity;
      },
    };
  });
  for (const tile of mapTiles) {
    if (
      !tile.improvements.some(extra => extra.toLowerCase() === 'airbase') ||
      hostileUnits.some(unit => unit.x === tile.x && unit.y === tile.y)
    ) {
      continue;
    }
    points.push({
      id: `airbase:${tile.x},${tile.y}`,
      kind: 'airbase',
      x: tile.x,
      y: tile.y,
      recoveryTurns: unit => {
        const gain = game.unitManager.calculateUnitHitpointRecovery(unit, tile.x, tile.y).gain;
        return gain > 0 ? Math.ceil(Math.max(0, 100 - unit.health) / gain) : Infinity;
      },
    });
  }
  for (const carrier of friendlyUnits) {
    const type = game.unitManager.getUnitType(carrier.unitTypeId);
    if (
      !type ||
      (type.transport_capacity ?? 0) <= 0 ||
      !type.cargoClasses.some(unitClass => ['Air', 'Helicopter', 'Missile'].includes(unitClass))
    ) {
      continue;
    }
    points.push({
      id: carrier.id,
      kind: 'carrier',
      x: carrier.x,
      y: carrier.y,
      carrier,
      cargoClasses: type.cargoClasses,
      remainingCapacity: game.unitManager.getTransportCapacityRemaining(carrier.id),
      recoveryTurns: unit => {
        const gain = game.unitManager.calculateUnitHitpointRecovery(
          unit,
          carrier.x,
          carrier.y
        ).gain;
        return gain > 0 ? Math.ceil(Math.max(0, 100 - unit.health) / gain) : Infinity;
      },
    });
  }
  return points;
}

/**
 * Executes air, paradrop, diplomat, and spy missions through authoritative
 * action and combat APIs.
 */
export class FreecivAISpecialUnitController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async manageAirAndParadrops(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const relations = await this.hostilityPolicy.getRelationPlayerIds(gameId, playerId);
    const hostileIds = relations.hostile;
    const allCities = game.cityManager.getAllCities?.() ?? [];
    const friendlyOwners = new Set([playerId, ...relations.allied]);
    const friendlyUnits = game.unitManager.getPlayerUnits(playerId);
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostileIds, profile);
    const friendlyCities = allCities.filter(city => friendlyOwners.has(city.playerId));
    const friendlyPlanningUnits = [...game.unitManager.getAllUnits().values()].filter(unit =>
      friendlyOwners.has(unit.playerId)
    );
    const mapTiles = game.mapManager.getMapData?.()?.tiles.flat() ?? [];
    const refuelPoints = buildAirRefuelPoints({
      game,
      friendlyUnits,
      friendlyCities,
      hostileUnits,
      mapTiles,
    });
    const missions = planAirMissions({
      friendlyUnits,
      hostileUnits,
      friendlyCities,
      hostileCities: targetableForeignCities(game, playerId, hostileIds, profile),
      refuelPoints,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      attackerRating: unit => game.unitManager.calculateUnitAttackRating(unit),
      defenderRating: (attacker, defender) =>
        game.unitManager.calculateUnitDefenseRating(defender, attacker),
      canAttack: (attacker, defender) => game.unitManager.canUnitTargetUnit(attacker, defender),
      hasOccupierSupport: city =>
        friendlyUnits.some(unit => {
          const type = game.unitManager.getUnitType(unit.unitTypeId);
          return (
            type?.rulesetUnitClassFlags.includes('CanOccupyCity') === true &&
            type.flags?.includes('NonMil') !== true &&
            game.mapManager.getDistance(unit.x, unit.y, city.x, city.y) <=
              Math.max(1, type.movement) * 3
          );
        }),
      planesHandicap: profile.handicaps.has('no_planes'),
    });
    const exploredTiles = game.visibilityManager.getExploredTiles?.(playerId) ?? new Set<string>();
    const visibleTiles = game.visibilityManager.getVisibleTiles?.(playerId) ?? new Set<string>();
    const paradropMissions = planParadropMissions({
      paratroopers: friendlyUnits.filter(unit => {
        const type = game.unitManager.getUnitType(unit.unitTypeId);
        return type?.flags?.includes('Paratroopers') && type.paratroopersRange > 0;
      }),
      friendlyUnits: friendlyPlanningUnits,
      hostileUnits,
      friendlyCities,
      hostileCities: targetableForeignCities(game, playerId, hostileIds, profile),
      tiles: mapTiles,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      canParadropTo: (unit, tile) =>
        game.unitManager.canUnitPerformAction(unit.id, ActionType.PARADROP, tile.x, tile.y),
      isKnown: tile => !profile.handicaps.has('map') || exploredTiles.has(`${tile.x},${tile.y}`),
      isSeen: tile => !profile.handicaps.has('fog') || visibleTiles.has(`${tile.x},${tile.y}`),
      cityUrgency: city =>
        hostileUnits.reduce((urgency, enemy) => {
          const type = game.unitManager.getUnitType(enemy.unitTypeId);
          if (
            !type?.rulesetUnitClassFlags.includes('CanOccupyCity') ||
            type.flags?.includes('NonMil')
          ) {
            return urgency;
          }
          const distance = game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y);
          if (distance > Math.max(1, type.movement) * 3) return urgency;
          return urgency + 1 + (distance <= Math.max(1, type.movement) ? 10 : 0);
        }, 0),
      terrainDefense: tile => rulesetLoader.getTerrain(tile.terrain).defense,
      isStackProtected: tile =>
        Boolean(
          game.cityManager.getCityAt(tile.x, tile.y) ||
            tile.improvements.some(extra => ['fortress', 'airbase'].includes(extra.toLowerCase()))
        ),
      canAttack: (attacker, defender) => game.unitManager.canUnitTargetUnit(attacker, defender),
      defenderRating: (attacker, defender) =>
        game.unitManager.calculateUnitDefenseRating(defender, attacker),
      winChance: (attacker, defender) =>
        game.unitManager.calculateUnitWinChance(attacker, defender),
      fogHandicap: profile.handicaps.has('fog'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'air' || task.role === 'paradrop') delete state.unitTasks[unitId];
    }
    const airActions = await this.executeAirMissions(game, playerId, state, missions);
    const paradropActions = await this.executeParadropMissions(
      game,
      playerId,
      state,
      hostileUnits,
      paradropMissions
    );
    return airActions + paradropActions;
  }

  private async executeAirMissions(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    missions: AirMission[]
  ): Promise<number> {
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: 'air',
        targetId: mission.kind === 'strike' ? mission.target.id : undefined,
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      if (mission.kind === 'hold' || mission.unit.movementLeft <= 0) continue;
      if (mission.kind === 'return' || mission.kind === 'rebase') {
        actions += await this.executeAirReturn(game, playerId, mission);
      } else if (mission.kind === 'strike') {
        actions += await this.executeAirStrike(game, playerId, mission);
      }
    }
    return actions;
  }

  private async executeAirReturn(
    game: GameInstance,
    playerId: string,
    mission: Extract<AirMission, { kind: 'return' | 'rebase' }>
  ): Promise<number> {
    const result = await game.unitManager.executeUnitAction(
      mission.unit.id,
      ActionType.GOTO,
      mission.targetX,
      mission.targetY,
      playerId
    );
    let actions = Number(result.success);
    const moved = game.unitManager.getUnit(mission.unit.id);
    const reachedCarrier =
      moved &&
      mission.base.kind === 'carrier' &&
      moved.x === mission.base.x &&
      moved.y === mission.base.y &&
      !moved.transportedBy;
    if (reachedCarrier) {
      const loaded = await game.unitManager.executeUnitAction(
        moved.id,
        ActionType.LOAD_UNIT,
        moved.x,
        moved.y,
        playerId
      );
      actions += Number(loaded.success);
    }
    return actions;
  }

  private async executeAirStrike(
    game: GameInstance,
    playerId: string,
    mission: Extract<AirMission, { kind: 'strike' }>
  ): Promise<number> {
    let actions = 0;
    let aircraft = game.unitManager.getUnit(mission.unit.id);
    if (aircraft?.transportedBy) {
      if (!(await game.unitManager.unloadUnit(aircraft.id, aircraft.x, aircraft.y))) return actions;
      actions++;
      aircraft = game.unitManager.getUnit(aircraft.id);
    }
    if (!aircraft) return actions;
    if (game.mapManager.getDistance(aircraft.x, aircraft.y, mission.targetX, mission.targetY) > 1) {
      actions += await this.moveAircraftToTarget(game, aircraft, mission.targetX, mission.targetY);
      aircraft = game.unitManager.getUnit(aircraft.id);
    }
    const target = game.unitManager.getUnit(mission.target.id);
    if (
      !aircraft ||
      !target ||
      aircraft.movementLeft <= 0 ||
      game.mapManager.getDistance(aircraft.x, aircraft.y, target.x, target.y) > 1
    ) {
      return actions;
    }
    const type = game.unitManager.getUnitType(mission.unit.unitTypeId);
    if ((type?.bombardRate ?? 0) > 0) {
      const result = await game.unitManager.executeUnitAction(
        aircraft.id,
        ActionType.BOMBARD,
        mission.targetX,
        mission.targetY,
        playerId
      );
      return actions + Number(result.success);
    }
    await game.unitManager.attackUnit(aircraft.id, target.id);
    return actions + 1;
  }

  private async executeParadropMissions(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    hostileUnits: Unit[],
    missions: ParadropMission[]
  ): Promise<number> {
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: 'paradrop',
        targetId: this.paradropTargetId(mission),
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      const actor = game.unitManager.getUnit(mission.unit.id);
      if (!actor || actor.movementLeft <= 0) continue;
      const rampage = await this.attackAdjacentWithParatrooper(game, actor, hostileUnits);
      actions += rampage;
      const ready = game.unitManager.getUnit(actor.id);
      if (!ready || ready.movementLeft <= 0 || rampage > 0 || mission.kind === 'hold') continue;
      if (mission.kind === 'return') {
        const result = await game.unitManager.executeUnitAction(
          ready.id,
          ActionType.GOTO,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        ready.id,
        ActionType.PARADROP,
        mission.targetX,
        mission.targetY,
        playerId
      );
      if (!result.success) continue;
      actions++;
      const landed = game.unitManager.getUnit(ready.id);
      if (landed?.movementLeft) {
        actions += await this.attackAdjacentWithParatrooper(
          game,
          landed,
          hostileUnits,
          mission.kind === 'tactical' ? mission.attackTarget.id : undefined
        );
      }
    }
    return actions;
  }

  private paradropTargetId(mission: ParadropMission): string | undefined {
    if (mission.kind === 'tactical') return mission.attackTarget.id;
    return 'targetCity' in mission ? mission.targetCity.id : undefined;
  }

  private async attackAdjacentWithParatrooper(
    game: GameInstance,
    unit: Unit,
    hostileUnits: Unit[],
    preferredTargetId?: string
  ): Promise<number> {
    const candidates = hostileUnits
      .map(candidate => game.unitManager.getUnit(candidate.id))
      .filter((candidate): candidate is Unit => Boolean(candidate))
      .filter(
        candidate =>
          game.mapManager.getDistance(unit.x, unit.y, candidate.x, candidate.y) <= 1 &&
          game.unitManager.canUnitTargetUnit(unit, candidate)
      )
      .map(candidate => {
        const chance = game.unitManager.calculateUnitWinChance(unit, candidate);
        const targetType = game.unitManager.getUnitType(candidate.unitTypeId);
        const actorType = game.unitManager.getUnitType(unit.unitTypeId);
        return {
          candidate,
          want:
            chance * Math.max(1, targetType?.cost ?? 1) -
            (1 - chance) * Math.max(1, actorType?.cost ?? 1),
        };
      })
      .filter(candidate => candidate.want > 0)
      .sort(
        (left, right) =>
          Number(right.candidate.id === preferredTargetId) -
            Number(left.candidate.id === preferredTargetId) ||
          right.want - left.want ||
          left.candidate.id.localeCompare(right.candidate.id)
      );
    const target = candidates[0]?.candidate;
    if (!target) return 0;
    await game.unitManager.attackUnit(unit.id, target.id);
    return 1;
  }

  private async moveAircraftToTarget(
    game: GameInstance,
    aircraft: Unit,
    targetX: number,
    targetY: number
  ): Promise<number> {
    const candidates = await Promise.all(
      game.mapManager.getNeighbors(targetX, targetY).map(async tile => ({
        tile,
        path: await game.pathfindingManager.findPath(aircraft, tile.x, tile.y),
      }))
    );
    const destination = candidates
      .filter(candidate => candidate.path.valid && candidate.path.path.length > 1)
      .sort(
        (left, right) =>
          left.path.totalCost - right.path.totalCost ||
          left.tile.x - right.tile.x ||
          left.tile.y - right.tile.y
      )[0]?.tile;
    if (!destination) return 0;
    const result = await game.unitManager.executeUnitAction(
      aircraft.id,
      ActionType.GOTO,
      destination.x,
      destination.y,
      aircraft.playerId
    );
    return result.success ? 1 : 0;
  }

  async manageDiplomatUnits(
    gameId: string,
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    const units = game.unitManager.getPlayerUnits(playerId);
    const diplomats = units.filter(unit =>
      game.unitManager.getUnitType(unit.unitTypeId)?.flags?.includes('Diplomat')
    );
    if (diplomats.length === 0) return 0;
    const snapshot = await this.hostilityPolicy.getDiplomacySnapshot(gameId, playerId);
    const relations = await this.hostilityPolicy.getRelationPlayerIds(gameId, playerId);
    const cities = game.cityManager.getAllCities?.() ?? [];
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const relationByPlayer = new Map(snapshot.nations.map(nation => [nation.id, nation.relation]));
    const allForeignPlayerIds = new Set(
      snapshot.nations.filter(nation => nation.isAlive).map(nation => nation.id)
    );
    const potentiallyHostileIds = new Set(
      [...allForeignPlayerIds].filter(otherPlayerId => !relations.allied.has(otherPlayerId))
    );
    const foreignUnits = hostileUnitsForPlanning(game, playerId, potentiallyHostileIds, profile);
    const foreignCities = targetableForeignCities(game, playerId, allForeignPlayerIds, profile);
    const friendlyCities = cities.filter(city => city.playerId === playerId);
    const economicManager = game.turnManager.getEconomicManager();
    const gold =
      (await economicManager?.getPlayerGold(playerId)) ?? game.players.get(playerId)?.gold ?? 0;
    const goldReserve = calculateTreasuryReserve({
      cities: friendlyCities,
      unitCount: units.length,
      atWar: relations.hostile.size > 0,
      netGold: game.players.get(playerId)?.goldPerTurn ?? 0,
    });
    const ownerGold = new Map<string, number>();
    await Promise.all(
      [...new Set(foreignUnits.map(unit => unit.playerId))].map(async ownerId => {
        ownerGold.set(ownerId, (await economicManager?.getPlayerGold(ownerId)) ?? 0);
      })
    );
    const inciteCosts = new Map<string, number>();
    await Promise.all(
      foreignCities.map(async city => {
        inciteCosts.set(city.id, await calculateDiplomatInciteCost(game, city));
      })
    );
    const travelCosts = new Map<string, number>();
    const targets = [
      ...foreignCities.map(target => ({ ...target, approach: true })),
      ...foreignUnits.map(target => ({ ...target, approach: true })),
      ...friendlyCities.map(target => ({ ...target, approach: false })),
    ];
    await Promise.all(
      diplomats.flatMap(diplomat =>
        targets.map(async target => {
          const key = `${diplomat.id}:${target.x},${target.y}`;
          if (game.mapManager.getDistance(diplomat.x, diplomat.y, target.x, target.y) <= 1) {
            travelCosts.set(key, 0);
            return;
          }
          if (target.approach) {
            const approach = await this.findDiplomatApproach(game, diplomat, target.x, target.y);
            travelCosts.set(key, approach?.cost ?? Infinity);
          } else {
            const path = await game.pathfindingManager.findPath(diplomat, target.x, target.y);
            travelCosts.set(key, path.valid ? path.totalCost : Infinity);
          }
        })
      )
    );
    const stealableTechs = new Map(
      snapshot.nations.map(nation => {
        const known = new Set(game.researchManager.getResearchedTechs(playerId));
        return [
          nation.id,
          game.researchManager.getResearchedTechs(nation.id).filter(tech => !known.has(tech))
            .length,
        ] as const;
      })
    );
    const cityDiplomatThreat = (city: (typeof cities)[number]) =>
      foreignUnits.some(enemy => {
        const type = game.unitManager.getUnitType(enemy.unitTypeId);
        return (
          type?.flags?.includes('Diplomat') === true &&
          game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y) <=
            Math.max(1, type.movement) * 3
        );
      });
    const missions = planDiplomatMissions({
      diplomats,
      friendlyUnits: units,
      foreignUnits: foreignUnits.filter(
        target =>
          !game.cityManager.getCityAt(target.x, target.y) &&
          game.unitManager.getUnitsAt(target.x, target.y).filter(unit => unit.id !== target.id)
            .length === 0
      ),
      foreignCities,
      friendlyCities,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      travelCost: (unit, targetX, targetY) =>
        travelCosts.get(`${unit.id}:${targetX},${targetY}`) ?? Infinity,
      relation: otherPlayerId => {
        const relation = relationByPlayer.get(otherPlayerId);
        return {
          allied: relation?.state === 'alliance' || relation?.state === 'team',
          atWar: relation?.state === 'war',
          hasEmbassy: relation?.embassy ?? false,
        };
      },
      countStealableTechs: otherPlayerId => stealableTechs.get(otherPlayerId) ?? 0,
      inciteCost: city => inciteCosts.get(city.id) ?? Infinity,
      bribeCost: target =>
        calculateDiplomatBribeCost(game, target, ownerGold.get(target.playerId) ?? 0),
      canBribeUnit: target =>
        !game.unitManager.getUnitType(target.unitTypeId)?.flags?.includes('Unbribable') &&
        game.governmentManager?.getPlayerGovernment(target.playerId)?.currentGovernment !==
          'democracy',
      canInciteCity: city =>
        !city.buildings.includes('palace') &&
        game.governmentManager?.getPlayerGovernment(city.playerId)?.currentGovernment !==
          'democracy',
      actionOdds: (actor, action, defender) =>
        game.unitManager.calculateDiplomatActionOdds(actor, action, defender),
      cityUrgency: city =>
        foreignUnits.reduce((urgency, enemy) => {
          const type = game.unitManager.getUnitType(enemy.unitTypeId);
          if (
            !type?.rulesetUnitClassFlags.includes('CanOccupyCity') ||
            type.flags?.includes('NonMil')
          ) {
            return urgency;
          }
          const distance = game.mapManager.getDistance(enemy.x, enemy.y, city.x, city.y);
          return distance <= Math.max(1, type.movement) * 3
            ? urgency + 1 + Number(distance <= Math.max(1, type.movement)) * 10
            : urgency;
        }, 0),
      cityDiplomatThreat,
      cityDiplomatDefender: city =>
        foreignUnits.find(unit => {
          const type = game.unitManager.getUnitType(unit.unitTypeId);
          return (
            unit.x === city.x && unit.y === city.y && type?.flags?.includes('Diplomat') === true
          );
        }),
      unitThreatensDiplomat: (target, diplomat, travelCost) => {
        const targetType = game.unitManager.getUnitType(target.unitTypeId);
        const defenders = units.filter(
          unit => unit.x === diplomat.x && unit.y === diplomat.y && unit.id !== diplomat.id
        );
        const bestDefense = defenders.reduce(
          (best, defender) =>
            Math.max(best, game.unitManager.calculateUnitDefenseRating(defender, target)),
          0
        );
        return (
          game.unitManager.calculateUnitAttackRating(target) > bestDefense &&
          (targetType?.movement ?? 0) > travelCost
        );
      },
      gold,
      goldReserve,
      diplomatHandicap: profile.handicaps.has('diplomat'),
      noBribeWarFooting: profile.handicaps.has('no_bribe_war_footing'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'diplomat') delete state.unitTasks[unitId];
    }
    return this.executeDiplomatMissions(game, playerId, state, missions);
  }

  private async executeDiplomatMissions(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState,
    missions: DiplomatMission[]
  ): Promise<number> {
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: 'diplomat',
        targetId: mission.targetId,
        targetX: mission.targetX,
        targetY: mission.targetY,
        action: mission.action,
        assignedTurn: game.currentTurn,
      };
      let actor = game.unitManager.getUnit(mission.unit.id);
      if (!actor || actor.movementLeft <= 0 || mission.kind === 'hold') continue;
      let distance = game.mapManager.getDistance(
        actor.x,
        actor.y,
        mission.targetX,
        mission.targetY
      );
      if (mission.kind === 'action' && mission.action && distance <= 1) {
        actions += await this.performDiplomatAction(game, playerId, actor, mission);
        continue;
      }
      if (mission.kind === 'defend') {
        const result = await game.unitManager.executeUnitAction(
          actor.id,
          ActionType.GOTO,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
      } else {
        const moved = await this.moveDiplomatTowardTarget(
          game,
          actor,
          mission.targetX,
          mission.targetY
        );
        actions += moved;
      }
      actor = game.unitManager.getUnit(mission.unit.id);
      if (!actor || !mission.action || actor.movementLeft <= 0) continue;
      distance = game.mapManager.getDistance(actor.x, actor.y, mission.targetX, mission.targetY);
      if (distance <= 1) {
        actions += await this.performDiplomatAction(game, playerId, actor, mission);
      }
    }
    return actions;
  }

  private async performDiplomatAction(
    game: GameInstance,
    playerId: string,
    actor: Unit,
    mission: DiplomatMission
  ): Promise<number> {
    if (!mission.action) return 0;
    const result = await game.unitManager.executeUnitAction(
      actor.id,
      mission.action,
      mission.targetX,
      mission.targetY,
      playerId
    );
    return Number(result.success);
  }

  private async findDiplomatApproach(
    game: GameInstance,
    diplomat: Unit,
    targetX: number,
    targetY: number
  ): Promise<{ x: number; y: number; cost: number } | undefined> {
    const candidates = await Promise.all(
      game.mapManager.getNeighbors(targetX, targetY).map(async tile => ({
        tile,
        path: await game.pathfindingManager.findPath(diplomat, tile.x, tile.y),
      }))
    );
    const best = candidates
      .filter(candidate => candidate.path.valid)
      .sort(
        (left, right) =>
          left.path.totalCost - right.path.totalCost ||
          left.tile.x - right.tile.x ||
          left.tile.y - right.tile.y
      )[0];
    return best ? { x: best.tile.x, y: best.tile.y, cost: best.path.totalCost } : undefined;
  }

  private async moveDiplomatTowardTarget(
    game: GameInstance,
    diplomat: Unit,
    targetX: number,
    targetY: number
  ): Promise<number> {
    const approach = await this.findDiplomatApproach(game, diplomat, targetX, targetY);
    if (!approach) return 0;
    const result = await game.unitManager.executeUnitAction(
      diplomat.id,
      ActionType.GOTO,
      approach.x,
      approach.y,
      diplomat.playerId
    );
    return result.success ? 1 : 0;
  }
}
