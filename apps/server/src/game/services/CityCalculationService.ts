/**
 * CityCalculationService - Pure calculation methods for cities
 *
 * Extracted from CityManager.ts to reduce complexity and improve testability.
 * This service contains all pure mathematical functions related to city mechanics:
 * - Output calculations (food, shields, trade, science, gold, luxury)
 * - Corruption calculations
 * - Distance calculations
 * - Trade to resource conversion
 * - Specialist output calculations
 *
 * All methods in this service are pure functions with no side effects,
 * making them easy to test and reason about.
 *
 * @reference freeciv/common/city.c - city output calculations
 * @reference freeciv-web/javascript/city.js - specialist and trade conversions
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import {
  EffectsManager,
  EffectType,
  OutputType,
  type EffectContext,
} from '@game/managers/EffectsManager';
import type { CityTileManagementService } from './CityTileManagementService';
import {
  SpecialistType,
  SPECIALIST_TYPES,
  type SpecialistDefinition,
} from '@game/constants/SpecialistDefinitions';
import type { TaxRates } from '@game/systems/Economic/types/EconomicTypes';
import { DEFAULT_TAX_RATES } from '@game/systems/Economic/constants/EconomicConstants';
import { distributeTrade } from '@game/systems/Economic/TradeDistribution';

// Re-export types that will be shared
export interface CityState {
  id: string;
  name: string;
  x: number;
  y: number;
  playerId: string;
  population: number;
  size: number;
  cityRadius: number;
  founded: number;
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
  turnsToComplete: number;
  productionStock?: number;
  foodStock?: number;
  foodPerTurn?: number;
  productionPerTurn?: number;
  tradePerTurn?: number;
  shieldStock?: number;
  sciencePerTurn?: number;
  goldPerTurn?: number;
  luxuryPerTurn?: number;
  pollution?: number;
  history: number;
  buildings: string[];
  specialists: Record<number, number>;
  workableTiles?: Array<{
    x: number;
    y: number;
    isWorked: boolean;
    isCenter?: boolean;
    isBlocked?: boolean;
    outputs: { food: number; shields: number; trade: number };
    terrain?: string;
    resource?: string;
    improvements?: string[];
  }>;
  tradeRoutes: any[];
  happiness: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
  };
  governor?: any;
  worklist: any[];
  defenseStrength?: number;
}

export { SpecialistType, SPECIALIST_TYPES, type SpecialistDefinition };

/**
 * City output calculation result
 */
export interface CityOutputs {
  food: number;
  shields: number;
  trade: number;
  science: number;
  gold: number;
  luxury: number;
  pollution: number;
}

/**
 * Owner state needed to evaluate ruleset requirements for a city.
 *
 * Freeciv resolves every effect against the full player context, so the caller
 * must supply it rather than let the service assume a government or ruleset.
 * @reference reference/freeciv/common/requirements.c:6495-6535
 */
export interface CityPlayerContext {
  government: string;
  playerTechs: ReadonlySet<string>;
  playerBuildings: ReadonlySet<string>;
  playerCities: readonly CityState[];
  mapWidth?: number;
  mapHeight?: number;
  taxRates?: TaxRates;
  unitUpkeep?: { food: number; shield: number; gold: number };
}

/**
 * CityCalculationService handles all pure calculation logic for cities
 */
export class CityCalculationService extends BaseGameService {
  private readonly effectsManager: EffectsManager;

  constructor(effectsManager: EffectsManager) {
    super(logger);
    this.effectsManager = effectsManager;
  }

  getServiceName(): string {
    return 'CityCalculationService';
  }

  /**
   * Calculate comprehensive city outputs including all resources
   * @param city City state data
   * @param tileOutputs Base tile outputs from TileManagementService (optional)
   * @param tileManagementService Service for calculating tile outputs (optional)
   * @param playerContext Government, technologies, buildings and cities of the owner
   * @returns Complete city output breakdown
   */
  calculateCityOutputs(
    city: CityState,
    tileOutputs: { food: number; shields: number; trade: number } | undefined,
    tileManagementService: CityTileManagementService | undefined,
    playerContext: CityPlayerContext
  ): CityOutputs {
    // Get base tile outputs
    let baseTileOutputs = tileOutputs;
    if (!baseTileOutputs && tileManagementService) {
      baseTileOutputs = tileManagementService.calculateCityOutputs(city.id);
    }

    // If no tile outputs available, use fallback calculation
    if (!baseTileOutputs) {
      return this.calculateFallbackCityOutputs(city, playerContext.taxRates);
    }

    const effectContext = this.buildCityEffectContext(city, playerContext);
    const specialistOutputs = this.calculateSpecialistOutputs(city.specialists, effectContext);
    const grossFood = this.applyOutputBonus(
      effectContext,
      OutputType.FOOD,
      baseTileOutputs.food + specialistOutputs.food
    );
    const grossShields = this.applyOutputBonus(
      effectContext,
      OutputType.SHIELD,
      baseTileOutputs.shields + specialistOutputs.shields
    );
    const grossTrade = this.applyOutputBonus(
      effectContext,
      OutputType.TRADE,
      baseTileOutputs.trade + specialistOutputs.trade
    );

    // Corruption is subtracted here and nowhere else, matching freeciv where
    // city_waste() feeds the surplus once per output refresh.
    // @reference reference/freeciv/common/city.c:3015-3024 set_city_production()
    // @reference reference/freeciv/common/city.c:3253-3337 city_waste()
    const { corruption } = this.effectsManager.calculateCityCorruption(
      effectContext,
      grossTrade,
      playerContext.playerCities.map(playerCity => ({
        id: playerCity.id,
        x: playerCity.x,
        y: playerCity.y,
        buildings: new Set(playerCity.buildings),
      }))
    );
    const tradeAfterCorruption = Math.max(0, grossTrade - corruption);

    const convertedTrade = distributeTrade(
      tradeAfterCorruption,
      playerContext.taxRates ?? DEFAULT_TAX_RATES
    );
    const science = this.applyOutputBonus(
      effectContext,
      OutputType.SCIENCE,
      convertedTrade.science + specialistOutputs.science
    );
    const gold = this.applyOutputBonus(
      effectContext,
      OutputType.GOLD,
      convertedTrade.gold + specialistOutputs.gold
    );
    const luxury = this.applyOutputBonus(
      effectContext,
      OutputType.LUXURY,
      convertedTrade.luxury + specialistOutputs.luxury
    );

    const foodConsumption = city.population * rulesetLoader.getCivstyle('classic').food_cost;
    const totalOutputs: CityOutputs = {
      food: grossFood - foodConsumption - (playerContext.unitUpkeep?.food ?? 0),
      shields: Math.max(0, grossShields - (playerContext.unitUpkeep?.shield ?? 0)),
      trade: tradeAfterCorruption,
      science,
      gold,
      luxury,
      pollution: this.calculatePollution(city, grossShields, playerContext),
    };

    // Defensive programming to ensure no undefined values
    return {
      food: totalOutputs.food,
      shields: totalOutputs.shields || 0,
      trade: totalOutputs.trade || 0,
      science: totalOutputs.science || 0,
      gold: totalOutputs.gold || 0,
      luxury: totalOutputs.luxury || 0,
      pollution: totalOutputs.pollution || 0,
    };
  }

  /**
   * Fallback calculation when TileManagementService is not available
   * @private
   */
  private calculateFallbackCityOutputs(city: CityState, taxRates?: TaxRates): CityOutputs {
    try {
      const civstyle = rulesetLoader.getCivstyle('classic');
      const food = civstyle.min_city_center_food;
      const shields = civstyle.min_city_center_shield;
      const trade = civstyle.min_city_center_trade;

      const convertedTrade = distributeTrade(trade, taxRates ?? DEFAULT_TAX_RATES);

      return {
        food: food - city.population * civstyle.food_cost,
        shields,
        trade,
        ...convertedTrade,
        pollution: this.calculatePollution(city, shields),
      };
    } catch {
      // Double fallback to hardcoded classic values
      const convertedTrade = distributeTrade(1, taxRates ?? DEFAULT_TAX_RATES);
      return {
        food: 2 - city.population * 2,
        shields: 1,
        trade: 1,
        ...convertedTrade,
        pollution: this.calculatePollution(city, 1),
      };
    }
  }

  /**
   * Baseline production and population pollution plus the ruleset modifier.
   * Pollution-reduction effects are applied by EffectsManager as those
   * Freeciv effect types are ported.
   *
   * @reference reference/freeciv/common/city.c:2785-2823 city_pollution_types()
   */
  private calculatePollution(
    city: CityState,
    shieldProduction: number,
    playerContext?: CityPlayerContext
  ): number {
    const basePollution = rulesetLoader.getCivstyle('classic').base_pollution;
    const context = playerContext
      ? this.buildCityEffectContext(city, playerContext)
      : {
          playerId: city.playerId,
          cityId: city.id,
          cityBuildings: new Set(city.buildings),
        };
    const productionPct =
      100 + this.effectsManager.calculateEffect(EffectType.POLLU_PROD_PCT, context).value;
    const populationPct =
      ((100 + this.effectsManager.calculateEffect(EffectType.POLLU_POP_PCT, context).value) *
        (100 + this.effectsManager.calculateEffect(EffectType.POLLU_POP_PCT_2, context).value)) /
      100;
    const productionPollution = Math.floor((shieldProduction * Math.max(productionPct, 0)) / 100);
    const populationPollution = Math.floor((city.population * Math.max(populationPct, 0)) / 100);
    return Math.max(0, productionPollution + populationPollution + basePollution);
  }

  /**
   * Assemble the requirement context freeciv evaluates effects against.
   * @reference reference/freeciv/common/requirements.c:6495-6535
   */
  private buildCityEffectContext(city: CityState, playerContext: CityPlayerContext): EffectContext {
    return {
      playerId: city.playerId,
      cityId: city.id,
      tileX: city.x,
      tileY: city.y,
      mapWidth: playerContext.mapWidth,
      mapHeight: playerContext.mapHeight,
      government: playerContext.government,
      cityBuildings: new Set(city.buildings),
      playerTechs: new Set(playerContext.playerTechs),
      playerBuildings: new Set(playerContext.playerBuildings),
    };
  }

  private applyOutputBonus(
    effectContext: EffectContext,
    outputType: OutputType,
    output: number
  ): number {
    const bonus = this.effectsManager.calculateEffect(EffectType.OUTPUT_BONUS, {
      ...effectContext,
      outputType,
    }).value;
    return Math.floor((output * (100 + bonus)) / 100);
  }

  /**
   * Calculate outputs from all specialists in a city
   * @private
   */
  private calculateSpecialistOutputs(
    specialists: Record<number, number>,
    effectContext: EffectContext
  ): CityOutputs {
    const outputs: CityOutputs = {
      food: 0,
      shields: 0,
      trade: 0,
      science: 0,
      gold: 0,
      luxury: 0,
      pollution: 0,
    };

    for (const [specialistType, count] of Object.entries(specialists)) {
      const type = parseInt(specialistType) as SpecialistType;
      const definition = SPECIALIST_TYPES[type];

      if (!definition?.ruleName || count <= 0) continue;

      const outputType = definition.outputType as OutputType;
      const amount =
        count *
        this.effectsManager.calculateEffect(EffectType.SPECIALIST_OUTPUT, {
          ...effectContext,
          specialist: definition.ruleName,
          outputType,
        }).value;
      const outputKey = definition.outputType === 'shield' ? 'shields' : definition.outputType;
      outputs[outputKey] += amount;
    }

    return outputs;
  }

  /**
   * Calculate granary size needed for city growth
   * @param population Current city population
   * @param rulesetName Ruleset to use for calculations
   * @returns Required food storage for next growth
   */
  calculateGranarySize(population: number, rulesetName: string = 'classic'): number {
    try {
      const civstyle = rulesetLoader.getCivstyle(rulesetName);
      const granaryFoodIni = civstyle.granary_food_ini;
      const granaryFoodInc = civstyle.granary_food_inc;

      // Freeciv formula: base initial size + increment per additional population
      return granaryFoodIni + (population - 1) * granaryFoodInc;
    } catch {
      // Fallback to classic values if ruleset loading fails
      return 20 + (population - 1) * 10;
    }
  }

  /**
   * Calculate trade allocation ratios for a government type
   * @param governmentType Government type
   * @returns Object with science/gold/luxury ratios (should sum to 1.0)
   */
  calculateTradeAllocationRatios(governmentType: string = 'despotism'): {
    science: number;
    gold: number;
    luxury: number;
  } {
    // Simplified allocation based on government type
    // In full implementation, this would be configurable by player
    switch (governmentType) {
      case 'despotism':
        return { science: 0.5, gold: 0.5, luxury: 0.0 };
      case 'monarchy':
        return { science: 0.4, gold: 0.5, luxury: 0.1 };
      case 'republic':
        return { science: 0.6, gold: 0.3, luxury: 0.1 };
      case 'democracy':
        return { science: 0.7, gold: 0.2, luxury: 0.1 };
      case 'communism':
        return { science: 0.5, gold: 0.4, luxury: 0.1 };
      default:
        return { science: 0.5, gold: 0.5, luxury: 0.0 };
    }
  }

  /**
   * Calculate city efficiency metrics
   * @param city City state
   * @param outputs City outputs
   * @returns Efficiency metrics
   */
  calculateCityEfficiency(
    city: CityState,
    outputs: CityOutputs
  ): {
    foodPerPop: number;
    shieldsPerPop: number;
    sciencePerPop: number;
    tradePerPop: number;
    totalOutputPerPop: number;
  } {
    const population = Math.max(1, city.population);

    return {
      foodPerPop: outputs.food / population,
      shieldsPerPop: outputs.shields / population,
      sciencePerPop: outputs.science / population,
      tradePerPop: outputs.trade / population,
      totalOutputPerPop:
        (outputs.food + outputs.shields + outputs.science + outputs.trade) / population,
    };
  }

  /**
   * Calculate turns to grow for a city
   * @param city City state
   * @param foodSurplus Food surplus per turn
   * @returns Turns until next growth (or -1 if city won't grow)
   */
  calculateTurnsToGrow(city: CityState, foodSurplus: number): number {
    if (foodSurplus <= 0) {
      return -1; // City won't grow
    }

    const granarySize = this.calculateGranarySize(city.population);
    const currentFoodStock = city.foodStock || 0;
    const foodNeeded = granarySize - currentFoodStock;

    return Math.ceil(foodNeeded / foodSurplus);
  }

  /**
   * Validate if city outputs are reasonable (for debugging/testing)
   * @param outputs City outputs to validate
   * @returns Validation result with warnings
   */
  validateCityOutputs(outputs: CityOutputs): {
    isValid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let isValid = true;

    // Check for negative values
    Object.entries(outputs).forEach(([key, value]) => {
      if (value < 0 && key !== 'food') {
        warnings.push(`Negative ${key} output: ${value}`);
        isValid = false;
      }
    });

    // Check for unreasonably high values
    if (outputs.food > 100) warnings.push(`Very high food output: ${outputs.food}`);
    if (outputs.shields > 100) warnings.push(`Very high shields output: ${outputs.shields}`);
    if (outputs.science > 100) warnings.push(`Very high science output: ${outputs.science}`);

    // Check for cities with no production
    if (outputs.food === 0 && outputs.shields === 0) {
      warnings.push('City produces no food or shields');
      isValid = false;
    }

    return { isValid, warnings };
  }
}
