import { ActionType } from '@app-types/shared/actions';
import { planAirMissions } from '@game/ai/FreecivAIAirPlanner';
import { planDiplomatMissions } from '@game/ai/FreecivAIDiplomatPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import { hostileUnitsForPlanning, targetableForeignCities } from '@game/ai/FreecivAITargeting';
import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';

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
    const hostileIds = await this.hostilityPolicy.getHostilePlayerIds(gameId, playerId);
    const allCities = game.cityManager.getAllCities?.() ?? [];
    const profile = createAIProfile(
      game.players.get(playerId)?.aiLevel,
      game.players.get(playerId)?.aiTraits
    );
    const missions = planAirMissions({
      friendlyUnits: game.unitManager.getPlayerUnits(playerId),
      hostileUnits: hostileUnitsForPlanning(game, playerId, hostileIds, profile),
      friendlyCities: allCities.filter(city => city.playerId === playerId),
      hostileCities: targetableForeignCities(game, playerId, hostileIds, profile),
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      planesHandicap: profile.handicaps.has('no_planes'),
    });
    for (const [unitId, task] of Object.entries(state.unitTasks)) {
      if (task.role === 'air' || task.role === 'paradrop') delete state.unitTasks[unitId];
    }
    let actions = 0;
    for (const mission of missions) {
      state.unitTasks[mission.unit.id] = {
        role: mission.kind === 'paradrop' ? 'paradrop' : 'air',
        targetId:
          mission.kind === 'strike'
            ? mission.target.id
            : mission.kind === 'paradrop'
              ? mission.targetCity.id
              : undefined,
        targetX: mission.targetX,
        targetY: mission.targetY,
        assignedTurn: game.currentTurn,
      };
      if (mission.unit.movementLeft <= 0) continue;
      if (mission.kind === 'paradrop') {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          ActionType.PARADROP,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
      } else if (mission.kind === 'return') {
        const result = await game.unitManager.executeUnitAction(
          mission.unit.id,
          ActionType.GOTO,
          mission.targetX,
          mission.targetY,
          playerId
        );
        if (result.success) actions++;
      } else {
        const type = game.unitManager.getUnitType(mission.unit.unitTypeId);
        if ((type?.bombardRate ?? 0) > 0) {
          const result = await game.unitManager.executeUnitAction(
            mission.unit.id,
            ActionType.BOMBARD,
            mission.targetX,
            mission.targetY,
            playerId
          );
          if (result.success) actions++;
        } else {
          await game.unitManager.attackUnit(mission.unit.id, mission.target.id);
          actions++;
        }
      }
    }
    return actions;
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
