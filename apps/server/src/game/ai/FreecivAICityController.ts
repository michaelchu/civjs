import { ActionType } from '@app-types/shared/actions';
import { OutputType } from '@game/constants/GameConstants';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { rankCityProduction } from '@game/ai/FreecivAIPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import {
  hostileUnitsForPlanning,
  potentiallyHostilePlayerIds,
  sortedPlayerUnits,
  targetableForeignCities,
} from '@game/ai/FreecivAITargeting';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { DiplomacyHostilityPolicy } from '@game/services/DiplomacyHostilityPolicy';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import {
  assessCityDanger,
  buildCityThreatTravelTimes,
  cityThreatTravelKey,
} from '@game/ai/FreecivAICityDangerPlanner';
import { rankVirtualMilitaryProduction } from '@game/ai/FreecivAIMilitaryProductionPlanner';
import { rankHunterProduction } from '@game/ai/FreecivAIHunterPlanner';
import { rankVirtualAirProduction } from '@game/ai/FreecivAIAirPlanner';
import { rankVirtualParadropProduction } from '@game/ai/FreecivAIParadropPlanner';

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
    const canContinueProduction =
      typeof game.cityManager.canCityContinueProduction === 'function'
        ? (cityId: string, kind: 'unit' | 'building', id: string) =>
            game.cityManager.canCityContinueProduction(cityId, kind, id)
        : undefined;
    let expansionQueued = units.some(
      unit => game.unitManager.getUnitType(unit.unitTypeId)?.canFoundCity
    );
    const relations = await this.hostilityPolicy.getRelationPlayerIds(game.id, playerId);
    const hostilePlayerIds = relations.hostile;
    const player = game.players.get(playerId);
    const profile = createAIProfile(player?.aiLevel, player?.aiTraits);
    const hostileUnits = hostileUnitsForPlanning(game, playerId, hostilePlayerIds, profile);
    const potentiallyHostileIds = potentiallyHostilePlayerIds(
      game.players.keys(),
      playerId,
      hostilePlayerIds,
      relations.allied,
      relations.unknown,
      state
    );
    const prospectiveUnits = hostileUnitsForPlanning(
      game,
      playerId,
      potentiallyHostileIds,
      profile
    );
    const prospectiveCities = targetableForeignCities(
      game,
      playerId,
      potentiallyHostileIds,
      profile
    );
    const allKnownCities = game.cityManager.getAllCities?.() ?? cities;
    const allUnits = [...game.unitManager.getAllUnits().values()];
    const mapTiles = game.mapManager.getMapData?.()?.tiles.flat() ?? [];
    const exploredTiles = game.visibilityManager.getExploredTiles?.(playerId) ?? new Set<string>();
    const knownTechs = new Set(
      game.researchManager.getPlayerResearch(playerId)?.researchedTechs ?? []
    );
    const threatTravelTimes = await buildCityThreatTravelTimes({
      cities,
      threateningUnits: hostileUnits,
      getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
      getUnit: unitId => game.unitManager.getUnit(unitId),
      distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      findPath: (unit, targetX, targetY) =>
        game.pathfindingManager.findPath(unit, targetX, targetY),
    });
    const reservedWonders = new Set(
      cities
        .flatMap(city => [city.currentProduction, ...(city.worklist ?? []).map(item => item.value)])
        .filter((buildingId): buildingId is string =>
          Boolean(buildingId && BUILDING_TYPES[buildingId]?.genus === 'GreatWonder')
        )
    );

    for (const city of cities) {
      for (const type of Object.values(UNIT_TYPES)) {
        if (
          type.paratroopersRange > 0 &&
          type.flags?.includes('Paratroopers') &&
          type.requiredTech &&
          !knownTechs.has(type.requiredTech)
        ) {
          state.techWants[type.requiredTech] = (state.techWants[type.requiredTech] ?? 0) + 2;
        }
      }
      const offensiveUnitWants = await rankVirtualMilitaryProduction({
        gameId: game.id,
        playerId,
        city,
        unitTypes: Object.values(UNIT_TYPES),
        targetUnits: prospectiveUnits,
        targetCities: prospectiveCities,
        canBuild: (cityId, unitTypeId) =>
          canContinueProduction?.(cityId, 'unit', unitTypeId) ?? false,
        getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
        getNeighbors: (x, y) => game.mapManager.getNeighbors(x, y),
        findPath: (unit, targetX, targetY) =>
          game.pathfindingManager.findPath(unit, targetX, targetY),
        isStackProtected: (x, y) => {
          const tile = game.mapManager.getTile(x, y);
          return Boolean(
            game.cityManager.getCityAt(x, y) ||
              tile?.improvements?.some((extra: string) => ['fortress', 'airbase'].includes(extra))
          );
        },
        rateAttack: unit => game.unitManager.calculateUnitAttackRating(unit),
        rateDefense: (defender, attacker) =>
          game.unitManager.calculateUnitDefenseRating(defender, attacker),
        causesMilitaryUnhappiness: () =>
          typeof game.cityManager.getCityMilitaryUnhappiness === 'function' &&
          game.cityManager.getCityMilitaryUnhappiness(city.id) > 0,
      });
      const hunterWants = rankHunterProduction({
        gameId: game.id,
        playerId,
        city,
        friendlyUnits: units,
        hostileUnits: prospectiveUnits,
        unitTypes: Object.values(UNIT_TYPES),
        canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
        getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
        distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
        targetSelectionHandicap: profile.handicaps.has('targets'),
      });
      for (const [unitTypeId, want] of hunterWants) {
        offensiveUnitWants.set(unitTypeId, Math.max(want, offensiveUnitWants.get(unitTypeId) ?? 0));
      }
      const airWants = rankVirtualAirProduction({
        gameId: game.id,
        playerId,
        city,
        unitTypes: Object.values(UNIT_TYPES),
        hostileUnits: prospectiveUnits,
        hostileCities: prospectiveCities,
        canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
        getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
        distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
        attackerRating: unit => game.unitManager.calculateUnitAttackRating(unit),
        defenderRating: (attacker, defender) =>
          game.unitManager.calculateUnitDefenseRating(defender, attacker),
        canAttack: (attacker, defender) => game.unitManager.canUnitTargetUnit(attacker, defender),
        hasOccupierSupport: targetCity =>
          units.some(unit => {
            const type = game.unitManager.getUnitType(unit.unitTypeId);
            return (
              type?.rulesetUnitClassFlags.includes('CanOccupyCity') === true &&
              type.flags?.includes('NonMil') !== true &&
              game.mapManager.getDistance(unit.x, unit.y, targetCity.x, targetCity.y) <=
                Math.max(1, type.movement) * 3
            );
          }),
        planesHandicap: profile.handicaps.has('no_planes'),
      });
      for (const [unitTypeId, want] of airWants) {
        offensiveUnitWants.set(unitTypeId, Math.max(want, offensiveUnitWants.get(unitTypeId) ?? 0));
      }
      const paradropWants = rankVirtualParadropProduction({
        gameId: game.id,
        playerId,
        city,
        unitTypes: Object.values(UNIT_TYPES),
        units: allUnits,
        cities: allKnownCities,
        alliedPlayerIds: relations.allied,
        tiles: mapTiles,
        canBuild: unitTypeId => canContinueProduction?.(city.id, 'unit', unitTypeId) ?? false,
        isKnown: tile => !profile.handicaps.has('map') || exploredTiles.has(`${tile.x},${tile.y}`),
        distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
      });
      for (const [unitTypeId, want] of paradropWants) {
        offensiveUnitWants.set(unitTypeId, Math.max(want, offensiveUnitWants.get(unitTypeId) ?? 0));
      }
      const dangerAssessment = assessCityDanger({
        city,
        friendlyUnits: units,
        threateningUnits: hostileUnits,
        profile,
        getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
        defenderStrength: unit => game.unitManager.calculateUnitDefenseRating(unit),
        attackerStrength: (enemy, enemyType) => {
          const attack = game.unitManager.calculateUnitAttackRating(enemy);
          const defenseBonus = game.unitManager.calculateCityDefenseBonusAgainst(
            enemy,
            enemyType,
            city.x,
            city.y
          );
          return (attack * 100) / Math.max(1, 100 + defenseBonus);
        },
        travelTurns: (enemy, target) =>
          threatTravelTimes.get(cityThreatTravelKey(enemy.id, target.id)),
      });
      const ranked = canContinueProduction
        ? rankCityProduction({
            city,
            cities,
            units,
            unitTypes: UNIT_TYPES,
            buildingTypes: BUILDING_TYPES,
            canBuild: (kind, id) => canContinueProduction(city.id, kind, id),
            dangerAssessment,
            profile,
            offensiveUnitWants,
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
