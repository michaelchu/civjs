import { ActionType } from '@app-types/shared/actions';
import { OutputType } from '@game/constants/GameConstants';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { rankCityProduction } from '@game/ai/FreecivAIPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import { hostileUnitsForPlanning, sortedPlayerUnits } from '@game/ai/FreecivAITargeting';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';

/**
 * Executes citizen allocation, production, worklist, and city-local unit
 * decisions through authoritative managers.
 */
export class FreecivAICityController {
  constructor(private readonly hostilityPolicy: DiplomacyHostilityPolicy) {}

  async manageCitizens(game: GameInstance, playerId: string): Promise<number> {
    if (typeof game.cityManager.optimizeCityManually !== 'function') return 0;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    let actions = 0;
    for (const city of game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))) {
      const parameters = CitizenParameterFactory.createDefault();
      const unrest = city.happiness.unhappy + city.happiness.angry;
      parameters.minimal_surplus[OutputType.FOOD] = (city.foodStock ?? 0) <= 0 ? 2 : 1;
      parameters.minimal_surplus[OutputType.SHIELD] = 1;
      parameters.factor[OutputType.FOOD] = (city.foodPerTurn ?? 0) <= 0 ? 24 : 8;
      parameters.factor[OutputType.SHIELD] = 6 + profile.traits.builder / 20;
      parameters.factor[OutputType.TRADE] = 3;
      parameters.factor[OutputType.GOLD] = (city.goldPerTurn ?? 0) < 0 ? 10 : 3;
      parameters.factor[OutputType.LUXURY] = unrest > 0 ? 20 : 2;
      parameters.factor[OutputType.SCIENCE] = 4 + profile.traits.builder / 25;
      parameters.happy_factor = unrest > 0 ? 20 : 2;
      parameters.max_growth = city.size < 8 && (city.foodPerTurn ?? 0) >= 0;
      parameters.require_happy = unrest > 0;
      parameters.allow_disorder = false;
      parameters.allow_specialists = true;
      const optimized = await game.cityManager.optimizeCityManually(city.id, parameters);
      if (optimized) actions++;
    }
    return actions;
  }

  async selectProduction(
    game: GameInstance,
    playerId: string,
    state: FreecivAIState
  ): Promise<number> {
    let actions = 0;
    const cities = game.cityManager
      .getPlayerCities(playerId)
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id));
    const units = game.unitManager.getPlayerUnits(playerId);
    let expansionQueued = units.some(
      unit => game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
    );
    const hostilePlayerIds = await this.hostilityPolicy.getHostilePlayerIds(game.id, playerId);
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile);
    const reservedWonders = new Set(
      cities
        .flatMap(city => [city.currentProduction, ...(city.worklist ?? []).map(item => item.value)])
        .filter((buildingId): buildingId is string =>
          Boolean(buildingId && BUILDING_TYPES[buildingId]?.genus === 'GreatWonder')
        )
    );

    for (const city of cities) {
      const ranked =
        typeof game.cityManager.canCityContinueProduction === 'function'
          ? rankCityProduction({
              city,
              cities,
              units,
              unitTypes: UNIT_TYPES,
              buildingTypes: BUILDING_TYPES,
              canBuild: (kind, id) => game.cityManager.canCityContinueProduction(city.id, kind, id),
              nearbyEnemyStrength: hostileUnits.reduce((sum, enemy) => {
                const distance = game.mapManager.getDistance(city.x, city.y, enemy.x, enemy.y);
                if (distance > 4) return sum;
                const enemyType = game.unitManager.getUnitType(enemy.unitTypeId);
                return sum + (enemyType?.attack ?? enemyType?.combat ?? 0) / Math.max(1, distance);
              }, 0),
              profile,
              reservedWonders,
              excludedChoices: new Set(
                [
                  city.currentProduction && city.productionType
                    ? `${city.productionType}:${city.currentProduction}`
                    : undefined,
                  ...(city.worklist ?? []).map(item => {
                    const kind = item.kind === 'wonder' ? 'building' : item.kind;
                    return `${kind}:${item.value}`;
                  }),
                ].filter((value): value is string => Boolean(value))
              ),
            })
          : [];
      state.cityWants[city.id] = Object.fromEntries(
        ranked.slice(0, 12).map(choice => [`${choice.value.kind}:${choice.value.id}`, choice.want])
      );
      if (profile.handicaps.has('away') && city.currentProduction) continue;
      if (
        city.currentProduction &&
        (city.worklist?.length ?? 0) === 0 &&
        typeof game.cityManager.addToWorklist === 'function'
      ) {
        const queued = ranked.slice(0, 2).map(choice => ({
          kind:
            BUILDING_TYPES[choice.value.id]?.genus === 'GreatWonder'
              ? ('wonder' as const)
              : choice.value.kind,
          value: choice.value.id,
        }));
        if (
          queued.length > 0 &&
          (await game.cityManager.addToWorklist(city.id, queued, playerId))
        ) {
          for (const item of queued) {
            if (BUILDING_TYPES[item.value]?.genus === 'GreatWonder') {
              reservedWonders.add(item.value);
            }
          }
          actions++;
        }
        continue;
      }
      if (city.currentProduction) continue;
      const scored = ranked[0];

      let type: 'unit' | 'building' = scored?.value.kind ?? 'unit';
      let id = scored?.value.id ?? 'warriors';
      if (!scored && (city.goldPerTurn ?? 0) < 0 && !city.buildings.includes('marketplace')) {
        type = 'building';
        id = 'marketplace';
      } else if (!scored && !expansionQueued) {
        id = 'settlers';
      }
      if (game.unitManager.getUnitType(id)?.canFoundCity) expansionQueued = true;

      await game.cityManager.setCityProduction(city.id, type, id, playerId);
      if (BUILDING_TYPES[id]?.genus === 'GreatWonder') reservedWonders.add(id);
      actions++;
    }
    return actions;
  }

  async executeUnitActions(game: GameInstance, playerId: string): Promise<number> {
    const preferences = [
      ActionType.HELP_WONDER,
      ActionType.MARKETPLACE,
      ActionType.JOIN_CITY,
      ActionType.CHANGE_HOME_CITY,
      ActionType.UPGRADE_UNIT,
    ];
    let actions = 0;
    for (const unit of sortedPlayerUnits(game, playerId)) {
      if (!game.unitManager.getUnit(unit.id)) continue;
      if (!game.cityManager.getCityAt?.(unit.x, unit.y)) continue;
      for (const action of preferences) {
        const targetX = action === ActionType.UPGRADE_UNIT ? undefined : unit.x;
        const targetY = action === ActionType.UPGRADE_UNIT ? undefined : unit.y;
        if (!game.unitManager.canUnitPerformAction(unit.id, action, targetX, targetY)) continue;
        const result = await game.unitManager.executeUnitAction(
          unit.id,
          action,
          targetX,
          targetY,
          playerId
        );
        if (result.success) actions++;
        break;
      }
    }
    return actions;
  }
}
