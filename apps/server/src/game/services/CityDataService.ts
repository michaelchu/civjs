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
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

interface ClientCityData {
  id: string;
  name: string;
  playerId: string;
  x: number;
  y: number;
  size: number;

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
  static transformCityForClient(city: CityState, rulesetName: string = 'classic'): ClientCityData {
    // Use actual calculated values from CityManager
    const foodPerTurn = city.foodPerTurn || 2; // Default city center food
    const productionPerTurn = city.productionPerTurn || 1; // Default city center shields
    const tradePerTurn = city.tradePerTurn || 1; // Default city center trade
    const sciencePerTurn = city.sciencePerTurn || Math.floor(tradePerTurn / 2);

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
      food: foodPerTurn - city.population * 2, // Food consumption = 2 per citizen
      shields: productionPerTurn, // All shields go to production (no consumption)
      trade: tradePerTurn, // Trade is base (before gold/science split)
      gold: goldPerTurn,
      luxury: luxuryPerTurn,
      science: sciencePerTurn,
    };

    // Transform buildings to client format with proper upkeep
    const buildings: { id: string; name: string; upkeep: number }[] = city.buildings.map(
      building => {
        const buildingId = typeof building === 'string' ? building : building.id;
        return {
          id: buildingId,
          name: this.getBuildingDisplayName(buildingId),
          upkeep: this.getBuildingUpkeep(buildingId),
        };
      }
    );

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

    // Transform current production with actual shield stock
    const production = city.currentProduction
      ? {
          target: city.currentProduction,
          type: (city.productionType as 'unit' | 'building' | 'wonder') || 'unit',
          progress: city.productionStock || city.shieldStock || 0,
          cost: this.getProductionCost(city.currentProduction, city.productionType || 'unit'),
          turnsToComplete: city.turnsToComplete,
        }
      : undefined;

    // Transform worklist with accurate costs
    const worklist = city.worklist.map(item => ({
      target: item.value,
      type: item.kind as 'unit' | 'building' | 'wonder',
      cost: item.remainingCost || this.getProductionCost(item.value, item.kind),
    }));

    return {
      id: city.id,
      name: city.name,
      playerId: city.playerId,
      x: city.x,
      y: city.y,
      size: city.population,

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
    rulesetName: string = 'classic'
  ): Record<string, ClientCityData> {
    const result: Record<string, ClientCityData> = {};

    for (const city of cities) {
      result[city.id] = this.transformCityForClient(city, rulesetName);
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
   * Get building display name
   */
  private static getBuildingDisplayName(buildingId: string): string {
    const displayNames: Record<string, string> = {
      granary: 'Granary',
      temple: 'Temple',
      marketplace: 'Marketplace',
      library: 'Library',
      walls: 'City Walls',
      factory: 'Factory',
      palace: 'Palace',
      barracks: 'Barracks',
    };

    return displayNames[buildingId] || buildingId.charAt(0).toUpperCase() + buildingId.slice(1);
  }

  /**
   * Get building upkeep cost
   */
  private static getBuildingUpkeep(buildingId: string): number {
    const upkeepCosts: Record<string, number> = {
      temple: 1,
      marketplace: 1,
      library: 1,
      walls: 1,
      factory: 2,
      palace: 0,
      granary: 0,
      barracks: 1,
    };

    return upkeepCosts[buildingId] || 0;
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
   * Get production cost for item from actual game constants
   */
  private static getProductionCost(itemId: string, type: string): number {
    if (type === 'unit') {
      // Dynamically import to avoid circular dependencies
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { UNIT_TYPES } = require('@game/constants/UnitConstants');
      return UNIT_TYPES[itemId]?.cost || 10;
    } else if (type === 'building') {
      // Dynamically import to avoid circular dependencies
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const { BUILDING_TYPES } = require('@game/managers/CityManager');
      return BUILDING_TYPES[itemId]?.cost || 40;
    }

    return 100; // Default wonder cost
  }
}
