import { BUILDING_TYPES, type CityState } from '@game/managers/CityManager';
import type { GameInstance } from '@game/managers/GameManager';
import type { Unit } from '@game/managers/UnitManager';
import { getUnitType } from '@game/constants/UnitConstants';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

/**
 * @reference reference/freeciv/common/unit.c:2371-2471 unit_bribe_cost()
 */
export function calculateDiplomatBribeCost(
  game: GameInstance,
  target: Unit,
  ownerGold: number
): number {
  const targetType = getUnitType(target.unitTypeId);
  const capital = game.cityManager
    .getPlayerCities(target.playerId)
    .find(city => city.buildings.includes('palace'));
  const distance = capital
    ? game.mapManager.getDistance(capital.x, capital.y, target.x, target.y)
    : 32;
  const { base_bribe_cost: baseBribeCost } = rulesetLoader.loadGameRulesRuleset().game_parameters;
  let cost = (baseBribeCost + ownerGold) / (distance + 2);
  cost *= (targetType?.cost ?? 10) / 10;
  cost *= 0.5 * (1 + target.health / 100);
  return Math.max(1, Math.floor(cost));
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
  city: CityState
): Promise<number> {
  const economicManager = game.turnManager.getEconomicManager();
  if (!economicManager) return Infinity;
  const ownerGold = await economicManager.getPlayerGold(city.playerId);
  const parameters = rulesetLoader.loadGameRulesRuleset().game_parameters;
  const unitCost = game.unitManager
    .getUnitsAt(city.x, city.y)
    .reduce(
      (sum, unit) =>
        sum + (getUnitType(unit.unitTypeId)?.cost ?? 0) * parameters.incite_unit_factor,
      0
    );
  const improvementCost = city.buildings.reduce(
    (sum, building) =>
      sum + (BUILDING_TYPES[building]?.cost ?? 0) * parameters.incite_improvement_factor,
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
  return Math.max(
    1,
    Math.floor((cost * effectiveSize * parameters.incite_total_factor) / ((distance + 3) * 100))
  );
}
