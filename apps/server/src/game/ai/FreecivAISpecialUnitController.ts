import { ActionType } from '@app-types/shared/actions';
import { planAirMissions, type AirRefuelPoint } from '@game/ai/FreecivAIAirPlanner';
import { planDiplomatMissions } from '@game/ai/FreecivAIDiplomatPlanner';
import { planParadropMissions } from '@game/ai/FreecivAIParadropPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import { hostileUnitsForPlanning, targetableForeignCities } from '@game/ai/FreecivAITargeting';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

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
    const refuelPoints: AirRefuelPoint[] = friendlyCities.map(city => {
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
        kind: 'city' as const,
        x: city.x,
        y: city.y,
        city,
        graveDanger,
        defenderCount: defenders.length,
        recoveryTurns: (unit: (typeof friendlyUnits)[number]) => {
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
      refuelPoints.push({
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
      refuelPoints.push({
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
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          ActionType.GOTO,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
        const moved = game.unitManager.getUnit(mission.unit.id);
        if (
          moved &&
          mission.base.kind === 'carrier' &&
          moved.x === mission.base.x &&
          moved.y === mission.base.y &&
          !moved.transportedBy
        ) {
          const loaded = await game.unitManager.executeUnitAction(
            moved.id,
            ActionType.LOAD_UNIT,
            moved.x,
            moved.y,
            playerId
          );
          if (loaded.success) actions++;
        }
      } else if (mission.kind === 'strike') {
        let aircraft = game.unitManager.getUnit(mission.unit.id);
        if (aircraft?.transportedBy) {
          if (!(await game.unitManager.unloadUnit(aircraft.id, aircraft.x, aircraft.y))) continue;
          actions++;
          aircraft = game.unitManager.getUnit(aircraft.id);
        }
        if (!aircraft) continue;
        if (
          game.mapManager.getDistance(aircraft.x, aircraft.y, mission.targetX, mission.targetY) > 1
        ) {
          actions += await this.moveAircraftToTarget(
            game,
            aircraft,
            mission.targetX,
            mission.targetY
          );
          aircraft = game.unitManager.getUnit(aircraft.id);
        }
        const target = game.unitManager.getUnit(mission.target.id);
        if (
          !aircraft ||
          !target ||
          aircraft.movementLeft <= 0 ||
          game.mapManager.getDistance(aircraft.x, aircraft.y, target.x, target.y) > 1
        ) {
          continue;
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
          if (result.success) actions++;
        } else {
          await game.unitManager.attackUnit(aircraft.id, target.id);
          actions++;
        }
      }
    }
    for (const mission of paradropMissions) {
      state.unitTasks[mission.unit.id] = {
        role: 'paradrop',
        targetId:
          mission.kind === 'tactical'
            ? mission.attackTarget.id
            : 'targetCity' in mission
              ? mission.targetCity.id
              : undefined,
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
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const units = game.unitManager.getPlayerUnits(playerId);
    const cities = game.cityManager.getAllCities?.() ?? [];
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const missions = planDiplomatMissions({
      diplomats: units.filter(unit =>
        game.unitManager.getUnitType(unit.unitTypeId)?.flags?.includes('Diplomat')
      ),
      friendlyUnits: units,
      hostileUnits: hostileUnitsForPlanning(game, playerId, hostileIds, profile),
      foreignCities: targetableForeignCities(
        game,
        playerId,
        new Set(cities.filter(city => city.playerId !== playerId).map(city => city.playerId)),
        profile
      ),
      friendlyCities: cities.filter(city => city.playerId === playerId),
      hostilePlayerIds: hostileIds,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      diplomatHandicap: profile.handicaps.has('diplomat'),
      noBribeWarFooting: profile.handicaps.has('no_bribe_war_footing'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'diplomat') delete state.unitTasks[unitId];
    }
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: 'diplomat',
        targetId: mission.targetId,
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      if (mission.unit.movementLeft <= 0) continue;
      const distance = game.mapManager.getDistance(
        mission.unit.x,
        mission.unit.y,
        mission.targetX,
        mission.targetY
      );
      if (mission.kind === 'action' && mission.action && distance <= 1) {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          mission.action,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
        continue;
      }
      const result = await game.unitManager.executeUnitAction(
        mission.unit.id,
        ActionType.GOTO,
        mission.targetX,
        mission.targetY,
        playerId
      );
      if (result.success) actions++;
    }
    return actions;
  }
}
