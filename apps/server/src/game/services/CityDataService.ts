/**
 * CityDataService - Handles city data transformation and serialization for client communication
 *
 * This service transforms internal CityState objects to client-compatible format
 * with calculated production, surplus, citizens, and other required data.
 *
 * Follows freeciv-web patterns with pcity['prod'], pcity['surplus'] structure
 * @reference freeciv-web/javascript/city.js
 */

import { SPECIALIST_TYPES, type CityState, type SpecialistType } from '@game/managers/CityManager';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetUnitsService } from './RulesetUnitsService';
import { rulesetBuildingsService, type RulesetBuildingsService } from './RulesetBuildingsService';

export interface CityDataRulesetDependencies {
  loader: Pick<RulesetLoader, 'getCivstyle'>;
  buildings: RulesetBuildingsService;
}

const defaultRulesetDependencies: CityDataRulesetDependencies = {
  loader: rulesetLoader,
  buildings: rulesetBuildingsService,
};

interface ClientCityData {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;
  actualPopulation?: number;

  // Basic output values (for legacy compatibility)
  food: number;
  shields: number;
  trade: number;

  // Detailed production breakdown
  prod: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
  };

  // Net surplus/deficit after consumption
  surplus: {
    food: number;
    shields: number;
    trade: number;
    gold: number;
    luxury: number;
    science: number;
  };

  // Waste/corruption
  waste: {
    shields: number;
    trade: number;
  };

  // Population details
  foodStock: number;
  granarySize: number;
  granaryTurns: number;

  // Citizens happiness breakdown
  citizens: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
    specialists: Record<string, number>;
  };

  // Buildings with proper structure
  buildings: Array<{
    id: string;
    name: string;
    upkeep: number;
  }>;

  // Units
  presentUnits: string[];
  supportedUnits: string[];

  // Production info
  production?: {
    target: string;
    type: 'unit' | 'building' | 'wonder';
    progress: number;
    cost: number;
    turnsToComplete: number;
    percentComplete?: number;
  };

  // Worklist
  worklist: Array<{
    target: string;
    type: 'unit' | 'building' | 'wonder';
    cost: number;
  }>;

  // Trade routes
  tradeRoutes: Array<{
    partnerId: string;
    goods: string;
    value: number;
  }>;

  // City state
  celebrating: boolean;
  disorder: boolean;
  pollution: number;

  // Rally point
  rallyPoint?: {
    x: number;
    y: number;
    persistent: boolean;
  };
}

export class CityDataService {
  /**
   * Transform internal CityState to client-compatible format following freeciv-web patterns
   */
  static transformCityForClient(
    city: CityState,
    rulesetName: string = 'classic',
    dependencies: CityDataRulesetDependencies = defaultRulesetDependencies
  ): ClientCityData {
    // Use actual calculated values from CityManager
    const civstyle = dependencies.loader.getCivstyle(rulesetName);
    const foodPerTurn = city.foodPerTurn ?? civstyle.min_city_center_food;
    const productionPerTurn = city.productionPerTurn ?? civstyle.min_city_center_shield;
    const tradePerTurn = city.tradePerTurn ?? civstyle.min_city_center_trade;
    const sciencePerTurn = city.sciencePerTurn ?? Math.floor(tradePerTurn / 2);

    // Calculate gold from trade (remaining after science allocation)
    const goldPerTurn = Math.max(0, tradePerTurn - sciencePerTurn);

    // Calculate luxury from specialists
    const luxuryPerTurn = this.calculateSpecialistOutput(city.specialists, 'luxury');

    // Production breakdown (total before consumption)
    const prod = {
      food: foodPerTurn,
      shields: productionPerTurn,
      trade: tradePerTurn,
      gold: goldPerTurn,
      luxury: luxuryPerTurn,
      science: sciencePerTurn,
    };

    // Calculate surplus (after consumption) - following freeciv pattern
    const surplus = {
      food: foodPerTurn - city.population * civstyle.food_cost,
      shields: productionPerTurn, // All shields go to production (no consumption)
      trade: tradePerTurn, // Trade is base (before gold/science split)
      gold: goldPerTurn,
      luxury: luxuryPerTurn,
      science: sciencePerTurn,
    };

    // Transform buildings to client format with proper upkeep
    const buildingTypes = dependencies.buildings.getBuildingTypes(rulesetName);
    const buildings = city.buildings.map(buildingId => {
      const building = buildingTypes[buildingId];
      if (!building) {
        throw new Error(`Building '${buildingId}' not found in ruleset '${rulesetName}'`);
      }
      return { id: buildingId, name: building.name, upkeep: building.upkeep };
    });

    // Use actual happiness data from city state
    const citizens = {
      happy: city.happiness.happy,
      content: city.happiness.content,
      unhappy: city.happiness.unhappy,
      angry: city.happiness.angry,
      specialists: this.transformSpecialists(city.specialists),
    };

    // Calculate granary size using freeciv formula
    const granarySize = this.calculateGranarySize(city.population, rulesetName);
    const foodStock = city.foodStock || 0;
    const granaryTurns = this.calculateGranaryTurns(surplus.food, foodStock, granarySize);

    // Transform current production with server-calculated data
    const production = city.currentProduction
      ? (() => {
          const progress = city.productionStock || city.shieldStock || 0;
          const cost = this.getProductionCost(
            city.currentProduction,
            city.productionType || 'unit',
            rulesetName,
            dependencies
          );
          const percentComplete = cost > 0 ? Math.min((progress / cost) * 100, 100) : 0;

          return {
            target: city.currentProduction,
            type: (city.productionType as 'unit' | 'building' | 'wonder') || 'unit',
            progress,
            cost,
            turnsToComplete: this.calculateTurnsToComplete(city, rulesetName, dependencies),
            percentComplete,
          };
        })()
      : undefined;

    // Transform worklist with accurate costs
    const worklist = city.worklist.map(item => ({
      target: item.value,
      type: item.kind as 'unit' | 'building' | 'wonder',
      cost:
        item.remainingCost ||
        this.getProductionCost(item.value, item.kind, rulesetName, dependencies),
    }));

    return {
      id: city.id,
      name: city.name,
      playerId: city.playerId,
      x: city.x,
      y: city.y,
      size: city.population,
      actualPopulation: city.population * 1000, // Actual population count

      // Legacy compatibility (for backward compatibility)
      food: foodPerTurn,
      shields: productionPerTurn,
      trade: tradePerTurn,

      // Freeciv-web compatible detailed breakdowns
      prod,
      surplus,
      waste: this.calculateWaste(city), // Implement waste/corruption

      // Population and growth
      foodStock,
      granarySize,
      granaryTurns,
      citizens,

      // Infrastructure
      buildings,
      presentUnits: [], // TODO: Get units present in city from UnitManager
      supportedUnits: [], // TODO: Get units supported by city from UnitManager

      // Production system
      production,
      worklist,

      // Trade routes
      tradeRoutes: city.tradeRoutes.map(route => ({
        partnerId: route.partnerCity,
        goods: 'Trade',
        value: route.value,
      })),

      // City state
      celebrating: this.isCelebrating(city),
      disorder: this.isInDisorder(city),
      pollution: this.calculatePollution(city),

      rallyPoint: undefined, // TODO: Implement rally points
    };
  }

  /**
   * Transform multiple cities for client
   */
  static transformCitiesForClient(
    cities: CityState[],
    rulesetName: string = 'classic',
    dependencies: CityDataRulesetDependencies = defaultRulesetDependencies
  ): Record<string, ClientCityData> {
    const result: Record<string, ClientCityData> = {};

    for (const city of cities) {
      result[city.id] = this.transformCityForClient(city, rulesetName, dependencies);
    }

    return result;
  }

  /**
   * Calculate specialist output for a given type
   */
  private static calculateSpecialistOutput(
    specialists: Record<SpecialistType, number>,
    outputType: string
  ): number {
    let total = 0;

    for (const [specialistType, count] of Object.entries(specialists)) {
      const type = parseInt(specialistType) as SpecialistType;
      const definition = SPECIALIST_TYPES[type];

      if (definition && definition.outputType === outputType) {
        total += definition.outputAmount * count;
      }
    }

    return total;
  }

  /**
   * Calculate granary size using freeciv formula
   * @reference freeciv/common/city.c:2132 city_granary_size()
   */
  private static calculateGranarySize(population: number, rulesetName: string = 'classic'): number {
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
   * Calculate turns to growth/starvation
   */
  private static calculateGranaryTurns(
    foodSurplus: number,
    foodStock: number,
    granarySize: number
  ): number {
    if (foodSurplus > 0) {
      // Growth - turns until granary fills
      return Math.ceil((granarySize - foodStock) / foodSurplus);
    } else if (foodSurplus < 0) {
      // Starvation - negative turns until population loss
      return Math.floor(foodStock / Math.abs(foodSurplus)) * -1;
    } else {
      // No change
      return 999;
    }
  }

  /**
   * Calculate waste and corruption
   */
  private static calculateWaste(_city: CityState): { shields: number; trade: number } {
    // TODO: Implement proper waste/corruption calculation based on distance from capital
    return { shields: 0, trade: 0 };
  }

  /**
   * Check if city is celebrating
   */
  private static isCelebrating(_city: CityState): boolean {
    // TODO: Implement celebration logic (happy citizens >= 50% and size >= celebrate_size)
    return false;
  }

  /**
   * Check if city is in disorder
   */
  private static isInDisorder(city: CityState): boolean {
    return city.happiness.unhappy > city.happiness.content + city.happiness.happy;
  }

  /**
   * Calculate pollution level
   */
  private static calculatePollution(_city: CityState): number {
    // TODO: Implement pollution calculation based on population and buildings
    return 0;
  }

  /**
   * Transform specialists to client format
   */
  private static transformSpecialists(specialists: Record<number, number>): Record<string, number> {
    const result: Record<string, number> = {};

    // Convert from SpecialistType enum to string keys
    const specialistNames: Record<number, string> = {
      0: 'scientist',
      1: 'taxman',
      2: 'entertainer',
      3: 'worker',
      4: 'engineer',
      5: 'merchant',
    };

    for (const [typeId, count] of Object.entries(specialists)) {
      const name = specialistNames[parseInt(typeId)];
      if (name && count > 0) {
        result[name] = count;
      }
    }

    return result;
  }

  /**
   * Get production cost for item from actual definitions
   */
  private static getProductionCost(
    itemId: string,
    type: string,
    rulesetName: string = 'classic',
    dependencies: CityDataRulesetDependencies = defaultRulesetDependencies
  ): number {
    if (type === 'unit') {
      const unitType = rulesetUnitsService.getUnitType(itemId);
      return unitType?.cost || 10;
    } else if (type === 'building') {
      return dependencies.buildings.getBuildingTypes(rulesetName)[itemId]?.cost || 40;
    }

    return 100; // Default wonder cost
  }

  /**
   * Calculate turns to complete current production
   * Uses same logic as client to ensure consistency
   */
  private static calculateTurnsToComplete(
    city: any,
    rulesetName: string,
    dependencies: CityDataRulesetDependencies
  ): number {
    if (!city.currentProduction) {
      return 0;
    }

    const productionCost = this.getProductionCost(
      city.currentProduction,
      city.productionType || 'unit',
      rulesetName,
      dependencies
    );
    const progress = city.productionStock || city.shieldStock || 0;
    const remainingShields = Math.max(0, productionCost - progress);

    // Use same calculation priority as CityProductionHandler
    const shieldsPerTurn = Math.max(1, city.productionPerTurn || city.surplus?.shields || 1);

    return Math.ceil(remainingShields / shieldsPerTurn);
  }
}
