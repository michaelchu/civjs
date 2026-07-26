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
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import type { CityTileManagementService } from './CityTileManagementService';

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

// Specialist types from CityManager
export enum SpecialistType {
  SCIENTIST = 0,
  TAX_COLLECTOR = 1,
  ENTERTAINER = 2,
  WORKER = 3,
  ENGINEER = 4,
  MERCHANT = 5,
}

export interface SpecialistDefinition {
  id: SpecialistType;
  name: string;
  pluralName: string;
  shortName: string;
  outputType: 'science' | 'gold' | 'luxury' | 'food' | 'shield' | 'trade';
  outputAmount: number;
  requiredWonder?: string;
}

// Specialist definitions from CityManager
export const SPECIALIST_TYPES: Record<SpecialistType, SpecialistDefinition> = {
  [SpecialistType.SCIENTIST]: {
    id: SpecialistType.SCIENTIST,
    name: 'Scientist',
    pluralName: 'Scientists',
    shortName: 'Sci',
    outputType: 'science',
    outputAmount: 3,
  },
  [SpecialistType.TAX_COLLECTOR]: {
    id: SpecialistType.TAX_COLLECTOR,
    name: 'Tax Collector',
    pluralName: 'Tax Collectors',
    shortName: 'Tax',
    outputType: 'gold',
    outputAmount: 3,
  },
  [SpecialistType.ENTERTAINER]: {
    id: SpecialistType.ENTERTAINER,
    name: 'Entertainer',
    pluralName: 'Entertainers',
    shortName: 'Ent',
    outputType: 'luxury',
    outputAmount: 3,
  },
  [SpecialistType.WORKER]: {
    id: SpecialistType.WORKER,
    name: 'Worker',
    pluralName: 'Workers',
    shortName: 'Wkr',
    outputType: 'food',
    outputAmount: 2,
  },
  [SpecialistType.ENGINEER]: {
    id: SpecialistType.ENGINEER,
    name: 'Engineer',
    pluralName: 'Engineers',
    shortName: 'Eng',
    outputType: 'shield',
    outputAmount: 2,
  },
  [SpecialistType.MERCHANT]: {
    id: SpecialistType.MERCHANT,
    name: 'Merchant',
    pluralName: 'Merchants',
    shortName: 'Mer',
    outputType: 'trade',
    outputAmount: 3,
  },
};

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
}

/**
 * Government corruption modifiers
 */
export interface GovernmentCorruptionModifiers {
  [government: string]: number;
}

/**
 * CityCalculationService handles all pure calculation logic for cities
 */
export class CityCalculationService extends BaseGameService {
  private readonly effectsManager = new EffectsManager();
  private static readonly GOVERNMENT_CORRUPTION_MODIFIERS: GovernmentCorruptionModifiers = {
    despotism: 1.0,
    monarchy: 0.8,
    republic: 0.6,
    democracy: 0.4,
    communism: 0.9,
  };

  constructor() {
    super(logger);
  }

  getServiceName(): string {
    return 'CityCalculationService';
  }

  /**
   * Calculate comprehensive city outputs including all resources
   * @param city City state data
   * @param tileOutputs Base tile outputs from TileManagementService (optional)
   * @param tileManagementService Service for calculating tile outputs (optional)
   * @returns Complete city output breakdown
   */
  calculateCityOutputs(
    city: CityState,
    tileOutputs?: { food: number; shields: number; trade: number },
    tileManagementService?: CityTileManagementService,
    government: string = 'despotism'
  ): CityOutputs {
    // Get base tile outputs
    let baseTileOutputs = tileOutputs;
    if (!baseTileOutputs && tileManagementService) {
      baseTileOutputs = tileManagementService.calculateCityOutputs(city.id);
    }

    // If no tile outputs available, use fallback calculation
    if (!baseTileOutputs) {
      return this.calculateFallbackCityOutputs(city);
    }

    // Ensure minimum city center outputs from ruleset
    const finalOutputs = this.applyMinimumCityCenterOutputs(baseTileOutputs);

    // Apply corruption before trade is converted to science, gold, and luxury.
    // @reference reference/freeciv/common/city.c city_waste()
    const corruption = this.effectsManager.calculateWaste(
      {
        playerId: city.playerId,
        cityId: city.id,
        government,
        cityBuildings: new Set(city.buildings),
      },
      OutputType.TRADE,
      finalOutputs.trade
    );
    const tradeAfterCorruption = Math.max(0, finalOutputs.trade - corruption);

    // Convert trade to science and gold
    const convertedTrade = this.convertTradeToResources(tradeAfterCorruption);
    const science = this.applyOutputBonus(city, OutputType.SCIENCE, convertedTrade.science);
    const gold = this.applyOutputBonus(city, OutputType.GOLD, convertedTrade.gold);
    const luxury = this.applyOutputBonus(city, OutputType.LUXURY, convertedTrade.luxury);

    // Add specialist contributions
    const specialistOutputs = this.calculateSpecialistOutputs(city.specialists);

    // Combine all outputs
    const totalOutputs: CityOutputs = {
      food: finalOutputs.food + specialistOutputs.food,
      shields: finalOutputs.shields + specialistOutputs.shields,
      trade: tradeAfterCorruption + specialistOutputs.trade,
      science: science + specialistOutputs.science,
      gold: gold + specialistOutputs.gold,
      luxury: luxury + specialistOutputs.luxury,
    };

    // Defensive programming to ensure no undefined values
    return {
      food: totalOutputs.food || 0,
      shields: totalOutputs.shields || 0,
      trade: totalOutputs.trade || 0,
      science: totalOutputs.science || 0,
      gold: totalOutputs.gold || 0,
      luxury: totalOutputs.luxury || 0,
    };
  }

  /**
   * Apply minimum city center outputs from ruleset
   * @private
   */
  private applyMinimumCityCenterOutputs(outputs: {
    food: number;
    shields: number;
    trade: number;
  }): {
    food: number;
    shields: number;
    trade: number;
  } {
    try {
      const civstyle = rulesetLoader.getCivstyle('classic');
      return {
        food: Math.max(outputs.food, civstyle.min_city_center_food),
        shields: Math.max(outputs.shields, civstyle.min_city_center_shield),
        trade: Math.max(outputs.trade, civstyle.min_city_center_trade),
      };
    } catch {
      // Fallback to hardcoded values if ruleset loading fails
      return {
        food: Math.max(outputs.food, 2),
        shields: Math.max(outputs.shields, 1),
        trade: Math.max(outputs.trade, 1),
      };
    }
  }

  /**
   * Fallback calculation when TileManagementService is not available
   * @private
   */
  private calculateFallbackCityOutputs(_city: CityState): CityOutputs {
    try {
      const civstyle = rulesetLoader.getCivstyle('classic');
      const food = civstyle.min_city_center_food;
      const shields = civstyle.min_city_center_shield;
      const trade = civstyle.min_city_center_trade;

      // Calculate science from trade even in fallback mode
      const tradeToScience = trade > 0 ? Math.max(1, Math.floor(trade / 2)) : 0;

      return {
        food,
        shields,
        trade,
        science: tradeToScience,
        gold: 0,
        luxury: 0,
      };
    } catch {
      // Double fallback to hardcoded classic values
      return {
        food: 2,
        shields: 1,
        trade: 1,
        science: 1,
        gold: 0,
        luxury: 0,
      };
    }
  }

  /**
   * Convert trade points to science and gold based on simple allocation
   * In a full implementation, this would use government type and city settings
   * @private
   */
  private convertTradeToResources(trade: number): {
    science: number;
    gold: number;
    luxury: number;
  } {
    // Simplified economics: split trade between science and gold
    // Ensure at least 1 science for any city with trade
    const tradeToScience = trade > 0 ? Math.max(1, Math.floor(trade / 2)) : 0;
    const tradeToGold = Math.max(0, trade - tradeToScience);

    return {
      science: tradeToScience,
      gold: tradeToGold,
      luxury: 0, // Luxury comes from specialists in this simplified model
    };
  }

  private applyOutputBonus(city: CityState, outputType: OutputType, output: number): number {
    const bonus = this.effectsManager.calculateEffect(EffectType.OUTPUT_BONUS, {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
      outputType,
    }).value;
    return Math.floor((output * (100 + bonus)) / 100);
  }

  /**
   * Calculate outputs from all specialists in a city
   * @private
   */
  private calculateSpecialistOutputs(specialists: Record<number, number>): CityOutputs {
    const outputs: CityOutputs = {
      food: 0,
      shields: 0,
      trade: 0,
      science: 0,
      gold: 0,
      luxury: 0,
    };

    for (const [specialistType, count] of Object.entries(specialists)) {
      const type = parseInt(specialistType) as SpecialistType;
      const definition = SPECIALIST_TYPES[type];

      if (!definition || count <= 0) continue;

      const amount = count * definition.outputAmount;

      switch (definition.outputType) {
        case 'science':
          outputs.science += amount;
          break;
        case 'gold':
          outputs.gold += amount;
          break;
        case 'luxury':
          outputs.luxury += amount;
          break;
        case 'food':
          outputs.food += amount;
          break;
        case 'shield':
          outputs.shields += amount;
          break;
        case 'trade':
          outputs.trade += amount;
          break;
      }
    }

    return outputs;
  }

  /**
   * Calculate corruption based on distance to capital and government type
   * @param distanceToCapital Distance from city to capital
   * @param governmentType Current government type
   * @returns Corruption amount
   */
  calculateCorruption(distanceToCapital: number, governmentType: string = 'despotism'): number {
    // Basic corruption calculation based on distance and government
    const baseCorruption = Math.floor(distanceToCapital / 10);
    const governmentModifier = this.getGovernmentCorruptionModifier(governmentType);

    return Math.floor(baseCorruption * governmentModifier);
  }

  /**
   * Get government modifier for corruption calculations
   * @param governmentType Government type
   * @returns Modifier value (1.0 = no change, < 1.0 = reduced corruption)
   */
  getGovernmentCorruptionModifier(governmentType: string): number {
    return CityCalculationService.GOVERNMENT_CORRUPTION_MODIFIERS[governmentType] || 1.0;
  }

  /**
   * Calculate squared distance between two points (for city distance calculations)
   * @param x1 First point X coordinate
   * @param y1 First point Y coordinate
   * @param x2 Second point X coordinate
   * @param y2 Second point Y coordinate
   * @returns Squared distance
   */
  calculateSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
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
      if (value < 0) {
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
