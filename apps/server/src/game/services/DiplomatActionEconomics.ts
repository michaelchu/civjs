/**
 * @module server/game/services/DiplomatActionEconomics
 * Provides the server-side Diplomat Action Economics service.
 */
import type { CityState } from '@game/cities/CityTypes';
import type { GameInstance } from '@game/runtime/GameTypes';
import type { Unit } from '@game/units/UnitTypes';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';

export type RuntimeCultureCache = Map<string, number | undefined>;

function getRuntimePlayerCulture(
  game: GameInstance,
  playerId: string,
  cache?: RuntimeCultureCache
): number | undefined {
  if (cache?.has(playerId)) return cache.get(playerId);
  const culture = game.turnManager.getCultureManager?.().getRuntimePlayerCulture(playerId);
  cache?.set(playerId, culture);
  return culture;
}

/**
 * @reference reference/freeciv/common/unit.c:2371-2471 unit_bribe_cost()
 */
export function calculateDiplomatBribeCost(
  game: GameInstance,
  target: Unit,
  ownerGold: number,
  cultureCache?: RuntimeCultureCache
): number {
  const rulesetName = game.config?.ruleset ?? 'civ2civ3';
  const targetType = getTargetType(game, target, rulesetName);
  const distance = getCapitalDistance(game, target);
  const { base_bribe_cost: baseBribeCost } =
    rulesetLoader.loadGameRulesRuleset(rulesetName).game_parameters;
  let cost = (baseBribeCost + ownerGold) / (distance + 2);
  cost *= valueOr(targetType?.cost, 10) / 10;
  cost *= 0.5 * (1 + target.health / 100);
  const premium = getBribePremium(game, target, targetType, rulesetName, cultureCache);
  cost *= (100 + premium) / 100;
  return Math.max(1, Math.floor(cost));
}

function getTargetType(game: GameInstance, target: Unit, rulesetName: string): any {
  return (
    game.unitManager.getUnitType?.(target.unitTypeId) ??
    rulesetUnitsService.getUnitType(target.unitTypeId, rulesetName)
  );
}

function valueOr(value: any, fallback: number): number {
  return value === undefined || value === null ? fallback : value;
}

function getBribePremium(
  game: GameInstance,
  target: Unit,
  targetType: any,
  rulesetName: string,
  cultureCache?: RuntimeCultureCache
): number {
  return new EffectsManager(rulesetName).calculateEffect(EffectType.UNIT_BRIBE_COST_PCT, {
    playerId: target.playerId,
    unitId: target.id,
    unitType: target.unitTypeId,
    unitClass: targetType?.rulesetUnitClass,
    unitClassFlags: new Set(targetType?.rulesetUnitClassFlags ?? []),
    unitTypeFlags: new Set(targetType?.flags ?? []),
    playerCulture: getRuntimePlayerCulture(game, target.playerId, cultureCache),
  }).value;
}

function getCapitalDistance(game: GameInstance, target: Unit): number {
  const capital = game.cityManager
    .getPlayerCities(target.playerId)
    .find(city => city.buildings.includes('palace'));
  return capital ? game.mapManager.getDistance(capital.x, capital.y, target.x, target.y) : 32;
}

/**
 * Available CivJS state is applied to the classic incite formula: treasury,
 * local units, improvements, stability, city size, and capital distance.
 *
 * @reference reference/freeciv/server/cityturn.c:3556-3630
 * @reference reference/freeciv/data/classic/game.ruleset:208-216
 */
export async function calculateDiplomatInciteCost(
  game: GameInstance,
  city: CityState,
  cultureCache?: RuntimeCultureCache
): Promise<number> {
  const economicManager = game.turnManager.getEconomicManager();
  if (!economicManager) return Infinity;
  const ownerGold = await economicManager.getPlayerGold(city.playerId);
  const rulesetName = game.config?.ruleset ?? 'civ2civ3';
  const parameters = rulesetLoader.loadGameRulesRuleset(rulesetName).game_parameters;
  const buildingTypes = rulesetBuildingsService.getBuildingTypes(rulesetName);
  const unitCost = game.unitManager
    .getUnitsAt(city.x, city.y)
    .reduce(
      (sum, unit) =>
        sum +
        ((
          game.unitManager.getUnitType?.(unit.unitTypeId) ??
          rulesetUnitsService.getUnitType(unit.unitTypeId, rulesetName)
        )?.cost ?? 0) *
          parameters.incite_unit_factor,
      0
    );
  const improvementCost = city.buildings.reduce(
    (sum, building) =>
      sum + (buildingTypes[building]?.cost ?? 0) * parameters.incite_improvement_factor,
    0
  );
  let cost = ownerGold + parameters.base_incite_cost + unitCost + improvementCost;
  if (city.happiness.unhappy === 0 && city.happiness.angry === 0) cost *= 2;
  const capital = game.cityManager
    .getPlayerCities(city.playerId)
    .find(candidate => candidate.buildings.includes('palace'));
  const distance = capital ? game.mapManager.getDistance(capital.x, capital.y, city.x, city.y) : 32;
  const effectiveSize = Math.max(
    1,
    city.size + city.happiness.happy - city.happiness.unhappy - city.happiness.angry * 3
  );
  const costWithBaseFactors = Math.max(
    1,
    Math.floor((cost * effectiveSize * parameters.incite_total_factor) / ((distance + 3) * 100))
  );
  const premium = new EffectsManager(rulesetName).calculateEffect(EffectType.INCITE_COST_PCT, {
    playerId: city.playerId,
    cityId: city.id,
    cityBuildings: new Set(city.buildings),
    maxUnitsOnTile: game.unitManager.getUnitsAt(city.x, city.y).length,
    cityCulture: game.turnManager.getCultureManager?.().getRuntimeCityCulture(city.id),
    playerCulture: getRuntimePlayerCulture(game, city.playerId, cultureCache),
  }).value;
  return Math.max(1, Math.floor((costWithBaseFactors * (100 + premium)) / 100));
}
