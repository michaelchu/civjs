/* eslint-disable complexity */
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { cities } from '@database/schema';
import { eq } from 'drizzle-orm';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  EffectsManager,
  EffectType,
  OutputType,
  EffectContext,
} from '@game/managers/EffectsManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import {
  CityFoundingValidationService,
  CityFoundingValidationResult,
  CityFoundingErrorCode,
} from '@game/services/CityFoundingValidationService';
import type { Unit } from '@game/managers/UnitManager';
import type { MapManager } from '@game/managers/MapManager';

// Following original Freeciv city radius logic
export const CITY_MAP_DEFAULT_RADIUS = 2;
export const CITY_MAP_DEFAULT_RADIUS_SQ = CITY_MAP_DEFAULT_RADIUS * CITY_MAP_DEFAULT_RADIUS + 1; // 5
export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = CITY_MAP_MAX_RADIUS * CITY_MAP_MAX_RADIUS + 1; // 10

// Following Freeciv city minimum distance constants (reference: freeciv/common/game.h:492-494)
export const GAME_DEFAULT_CITYMINDIST = 2;
export const GAME_MIN_CITYMINDIST = 1;
export const GAME_MAX_CITYMINDIST = 11;

// Following Freeciv VUT (Value Universal Type) constants
// Reference: freeciv-web/javascript/city.js production system
export const VUT_UTYPE = 0; // Unit type
export const VUT_IMPROVEMENT = 1; // Building/improvement

// Following Freeciv happiness feeling stages
// Reference: freeciv-web/javascript/city.js:92-97
export const FEELING_BASE = 0; // before any of the modifiers below
export const FEELING_LUXURY = 1; // after luxury
export const FEELING_EFFECT = 2; // after building effects
export const FEELING_NATIONALITY = 3; // after citizen nationality effects
export const FEELING_MARTIAL = 4; // after units enforce martial order
export const FEELING_FINAL = 5; // after wonders (final result)

// Following Freeciv specialist types
// Reference: freeciv-web/javascript/city.js:99 and specialists data
export enum SpecialistType {
  SCIENTIST = 0, // Science specialist
  TAX_COLLECTOR = 1, // Gold specialist
  ENTERTAINER = 2, // Luxury specialist
  // Extended specialists (require Adam Smith's Trading Company)
  WORKER = 3, // Food specialist
  ENGINEER = 4, // Shield specialist
  MERCHANT = 5, // Trade specialist
}

export interface SpecialistDefinition {
  id: SpecialistType;
  name: string;
  pluralName: string;
  shortName: string;
  outputType: 'science' | 'gold' | 'luxury' | 'food' | 'shield' | 'trade';
  outputAmount: number;
  requiredWonder?: string; // Some specialists require specific wonders
}

// Following Freeciv specialist definitions
export const SPECIALIST_TYPES: Record<SpecialistType, SpecialistDefinition> = {
  [SpecialistType.SCIENTIST]: {
    id: SpecialistType.SCIENTIST,
    name: 'Scientist',
    pluralName: 'Scientists',
    shortName: 'Sci',
    outputType: 'science',
    outputAmount: 3, // Base science output
  },
  [SpecialistType.TAX_COLLECTOR]: {
    id: SpecialistType.TAX_COLLECTOR,
    name: 'Tax Collector',
    pluralName: 'Tax Collectors',
    shortName: 'Tax',
    outputType: 'gold',
    outputAmount: 3, // Base gold output
  },
  [SpecialistType.ENTERTAINER]: {
    id: SpecialistType.ENTERTAINER,
    name: 'Entertainer',
    pluralName: 'Entertainers',
    shortName: 'Ent',
    outputType: 'luxury',
    outputAmount: 3, // Base luxury output
  },
  [SpecialistType.WORKER]: {
    id: SpecialistType.WORKER,
    name: 'Worker',
    pluralName: 'Workers',
    shortName: 'Wkr',
    outputType: 'food',
    outputAmount: 2, // Base food output
    requiredWonder: "Adam Smith's Trading Company",
  },
  [SpecialistType.ENGINEER]: {
    id: SpecialistType.ENGINEER,
    name: 'Engineer',
    pluralName: 'Engineers',
    shortName: 'Eng',
    outputType: 'shield',
    outputAmount: 2, // Base shield output
    requiredWonder: "Adam Smith's Trading Company",
  },
  [SpecialistType.MERCHANT]: {
    id: SpecialistType.MERCHANT,
    name: 'Merchant',
    pluralName: 'Merchants',
    shortName: 'Mer',
    outputType: 'trade',
    outputAmount: 2, // Base trade output
    requiredWonder: "Adam Smith's Trading Company",
  },
};

// Following Freeciv building types
export interface BuildingType {
  id: string;
  name: string;
  cost: number; // shields required
  upkeep: number; // gold per turn
  effects: {
    defenseBonus?: number;
    happinessBonus?: number;
    healthBonus?: number;
    scienceBonus?: number;
    goldBonus?: number;
    productionBonus?: number;
    foodBonus?: number;
  };
  requiredTech?: string;
  obsoletedBy?: string;
}

// Basic buildings following Freeciv
export const BUILDING_TYPES: Record<string, BuildingType> = {
  palace: {
    id: 'palace',
    name: 'Palace',
    cost: 100,
    upkeep: 0,
    effects: {
      defenseBonus: 100, // 100% defense bonus
      happinessBonus: 1,
    },
  },
  granary: {
    id: 'granary',
    name: 'Granary',
    cost: 60,
    upkeep: 1,
    effects: {
      foodBonus: 50, // 50% food bonus (helps with growth)
    },
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    cost: 40,
    upkeep: 1,
    effects: {
      defenseBonus: 50, // 50% defense bonus
    },
  },
  library: {
    id: 'library',
    name: 'Library',
    cost: 80,
    upkeep: 1,
    effects: {
      scienceBonus: 50, // 50% science bonus
    },
  },
  marketplace: {
    id: 'marketplace',
    name: 'Marketplace',
    cost: 80,
    upkeep: 0,
    effects: {
      goldBonus: 50, // 50% trade->gold bonus
    },
  },
  temple: {
    id: 'temple',
    name: 'Temple',
    cost: 40,
    upkeep: 1,
    effects: {
      happinessBonus: 2,
    },
  },
  walls: {
    id: 'walls',
    name: 'City Walls',
    cost: 80,
    upkeep: 0,
    effects: {
      defenseBonus: 200, // 200% defense bonus
    },
  },
};

// Production queue item following Freeciv worklist system
// Reference: freeciv-web/javascript/city.js:3136 populate_worklist_production_choices
export interface ProductionItem {
  kind: 'unit' | 'building'; // String types for compatibility, maps to VUT_UTYPE/VUT_IMPROVEMENT
  value: string; // unit type id or building id
  name: string;
  cost: number; // shield cost
  vutKind?: number; // Optional VUT constant for freeciv-web compatibility
}

// Type helpers for production
export type ProductionKind = 'unit' | 'building';

// Helper function to convert between VUT constants and string types
export function vutToProductionKind(vut: number): ProductionKind {
  return vut === VUT_UTYPE ? 'unit' : 'building';
}

export function productionKindToVut(kind: ProductionKind): number {
  return kind === 'unit' ? VUT_UTYPE : VUT_IMPROVEMENT;
}

// City interface following Freeciv structure
export interface CityState {
  id: string;
  gameId: string;
  playerId: string;
  name: string;
  x: number;
  y: number;

  // Population and growth (following Freeciv)
  population: number; // city size
  foodStock: number; // accumulated food (matches pcity['food_stock'])
  foodPerTurn: number; // food surplus/deficit
  granarySize: number; // food needed for next growth (matches pcity['granary_size'])
  granaryTurns: number; // turns to grow/starve (-1 = starvation next turn)

  // Production (following Freeciv shield system)
  productionStock: number; // accumulated shields
  productionPerTurn: number; // shield surplus
  currentProduction?: string | null; // what's being built
  productionType?: 'unit' | 'building' | null; // type of production
  turnsToComplete: number;
  worklist: ProductionItem[]; // production queue following Freeciv worklist

  // Economy (following Freeciv trade system)
  goldPerTurn: number;
  sciencePerTurn: number;
  culturePerTurn: number;
  luxuryPerTurn: number; // luxury for happiness

  // Buildings and improvements
  buildings: string[]; // building IDs
  workingTiles: Array<{ x: number; y: number }>; // tiles being worked

  // Specialists following Freeciv system
  // Reference: freeciv-web/javascript/city.js:2556-2626
  specialists: Record<SpecialistType, number>; // count of each specialist type

  // Status
  isCapital: boolean;
  defenseStrength: number;
  happinessLevel: number; // 0-100
  healthLevel: number; // 0-100

  // Detailed happiness breakdown following Freeciv
  // Reference: freeciv-web/javascript/city.js:2728-2819 show_city_happy_tab
  happiness: {
    happy: number; // happy citizens
    content: number; // content citizens
    unhappy: number; // unhappy citizens
    angry: number; // angry citizens
  };

  // Turn tracking
  foundedTurn: number;
  lastGrowthTurn?: number;
}

// Corruption calculation result
export interface CorruptionResult {
  baseWaste: number;
  distanceWaste: number;
  totalWaste: number;
  wasteReduction: number;
  finalWaste: number;
  governmentCenter?: { cityId: string; distance: number };
}

// Happiness calculation result
export interface HappinessResult {
  baseHappy: number;
  baseContent: number;
  baseUnhappy: number;
  martialLawBonus: number;
  buildingBonus: number;
  finalHappy: number;
  finalContent: number;
  finalUnhappy: number;
}

export interface CityManagerCallbacks {
  createUnit?: (playerId: string, unitType: string, x: number, y: number) => Promise<string>;
  getUnit?: (unitId: string) => Unit | undefined;
  getAllUnits?: () => Map<string, Unit>;
}

export class CityManager {
  private cities: Map<string, CityState> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private effectsManager: EffectsManager;
  private governmentManager?: GovernmentManager;
  private callbacks: CityManagerCallbacks;
  private mapManager?: MapManager;
  private validationService?: CityFoundingValidationService;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    effectsManager?: EffectsManager,
    callbacks?: CityManagerCallbacks,
    mapManager?: MapManager
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.effectsManager = effectsManager || new EffectsManager();
    this.callbacks = callbacks || {};
    this.mapManager = mapManager;

    if (this.mapManager) {
      // TODO: Get ruleset name from game configuration
      const rulesetName = 'classic';
      this.validationService = new CityFoundingValidationService(
        this.mapManager,
        GAME_DEFAULT_CITYMINDIST,
        rulesetName
      );
    }
  }

  /**
   * Check if citymindist prevents city on tile
   * Based on reference: freeciv/common/city.c:1465-1478 citymindist_prevents_city_on_tile()
   */
  private citymindistPreventsCityOnTile(x: number, y: number): boolean {
    // citymindist minimum is 1, meaning adjacent is okay
    const citymindist = GAME_DEFAULT_CITYMINDIST;

    // square_iterate(nmap, ptile, citymindist - 1, ptile1) - check all tiles within citymindist-1
    const radius = citymindist - 1;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const checkX = x + dx;
        const checkY = y + dy;

        // Check if there's a city at this position
        const existingCity = this.getCityAt(checkX, checkY);
        if (existingCity) {
          return true; // City found within minimum distance
        }
      }
    }

    return false;
  }

  /**
   * Comprehensive city founding validation using Freeciv reference implementation
   * Reference: freeciv/common/city.c:1487-1551 city_can_be_built_here()
   * Reference: freeciv/server/citytools.c:580 create_city_for_player()
   */
  private validateCityFounding(
    x: number,
    y: number,
    unit: Unit | undefined,
    playerId: string
  ): CityFoundingValidationResult {
    if (!this.validationService) {
      logger.warn('CityFoundingValidationService not available - using basic validation');
      // Fallback to basic validation
      if (this.citymindistPreventsCityOnTile(x, y)) {
        return {
          canFound: false,
          errorMessage: `Cannot found city at (${x}, ${y}): too close to existing city (citymindist=${GAME_DEFAULT_CITYMINDIST})`,
          errorCode: CityFoundingErrorCode.CITYMINDIST_VIOLATION,
        };
      }
      return { canFound: true };
    }

    // Check for enemy units blocking city founding
    // Reference: freeciv/server/citytools.c:580
    if (this.callbacks.getAllUnits) {
      const allUnits = this.callbacks.getAllUnits();
      const enemyUnitValidation = this.validationService.validateNoEnemyUnits(
        x,
        y,
        playerId,
        allUnits
      );
      if (!enemyUnitValidation.canFound) {
        return enemyUnitValidation;
      }
    }

    // Main city founding validation
    return this.validationService.validateCityFounding(
      x,
      y,
      unit || null,
      playerId,
      this.cities,
      false // not hut test
    );
  }

  /**
   * Found a new city following Freeciv logic with comprehensive validation
   * Reference: freeciv/common/city.c:1487-1551 city_can_be_built_here()
   * Reference: freeciv/server/citytools.c:580 create_city_for_player()
   */
  async foundCity(
    playerId: string,
    name: string,
    x: number,
    y: number,
    foundedTurn: number,
    unit?: Unit
  ): Promise<string> {
    logger.info('Founding new city', { name, x, y, playerId, unitId: unit?.id });

    // Comprehensive validation using Freeciv-based validation service
    const validationResult = this.validateCityFounding(x, y, unit, playerId);
    if (!validationResult.canFound) {
      throw new Error(validationResult.errorMessage || 'Cannot found city at this location');
    }

    // Create city in database following Freeciv initial values
    const [dbCity] = await this.databaseProvider
      .getDatabase()
      .insert(cities)
      .values({
        gameId: this.gameId,
        playerId,
        name,
        x,
        y,
        population: 1, // Cities start with size 1
        food: 0,
        foodPerTurn: 2, // Basic food production
        production: 0,
        productionPerTurn: 1, // Basic shield production
        goldPerTurn: 0,
        sciencePerTurn: 0,
        culturePerTurn: 1, // Basic culture
        buildings: [], // No initial buildings
        workedTiles: [{ x, y }], // City works its own tile
        isCapital: false,
        defenseStrength: 1, // Base defense
        happiness: 50,
        health: 100,
        foundedTurn,
      })
      .returning();

    // Create city instance following Freeciv structure
    const cityState: CityState = {
      id: dbCity.id,
      gameId: this.gameId,
      playerId,
      name,
      x,
      y,
      population: 1,
      foodStock: 0,
      foodPerTurn: 2,
      granarySize: this.calculateGranarySize(1), // Initial granary size calculation
      granaryTurns: this.calculateGranaryTurns(1, 0, 2), // Initial calculation
      productionStock: 0,
      productionPerTurn: 1,
      goldPerTurn: 0,
      sciencePerTurn: 0,
      culturePerTurn: 1,
      luxuryPerTurn: 0,
      buildings: [],
      workingTiles: [{ x, y }],
      // Initialize specialists - new cities start with no specialists
      specialists: {
        [SpecialistType.SCIENTIST]: 0,
        [SpecialistType.TAX_COLLECTOR]: 0,
        [SpecialistType.ENTERTAINER]: 0,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 0,
        [SpecialistType.MERCHANT]: 0,
      },
      worklist: [], // Empty production queue
      isCapital: false,
      defenseStrength: 1,
      happinessLevel: 50,
      healthLevel: 100,
      happiness: {
        happy: 1, // Size 1 city starts content
        content: 0,
        unhappy: 0,
        angry: 0,
      },
      foundedTurn,
      turnsToComplete: 0,
    };

    this.cities.set(dbCity.id, cityState);
    logger.info('City founded successfully', { cityId: dbCity.id, name });

    return dbCity.id;
  }

  /**
   * Refresh city following Freeciv city_refresh logic with specialist support
   * Reference: freeciv-web/javascript/city.js refreshCity functions
   */
  refreshCity(cityId: string): void {
    const city = this.cities.get(cityId);
    if (!city) return;

    // Calculate base tile outputs (simplified)
    let foodOutput = 0;
    let shieldOutput = 0;
    let tradeOutput = 0;

    // Each worked tile contributes (following Freeciv)
    for (const tile of city.workingTiles) {
      // Simplified: center tile gives 2 food, 1 shield, 1 trade
      // Other tiles give variable amounts based on terrain
      if (tile.x === city.x && tile.y === city.y) {
        foodOutput += 2; // City center always produces food
        shieldOutput += 1;
        tradeOutput += 1;
      } else {
        // Simplified terrain - each worked tile gives some output
        foodOutput += 1;
        shieldOutput += 1;
        tradeOutput += 1;
      }
    }

    // Add specialist outputs following Freeciv specialist system
    // Reference: freeciv-web/javascript/city.js specialist calculations
    let specialistFood = 0;
    let specialistShields = 0;
    let specialistTrade = 0;
    let specialistGold = 0;
    let specialistScience = 0;
    let specialistLuxury = 0;

    for (const [specialistTypeKey, count] of Object.entries(city.specialists)) {
      const specialistType = parseInt(specialistTypeKey) as SpecialistType;
      const specialist = SPECIALIST_TYPES[specialistType];
      const output = specialist.outputAmount * count;

      switch (specialist.outputType) {
        case 'food':
          specialistFood += output;
          break;
        case 'shield':
          specialistShields += output;
          break;
        case 'trade':
          specialistTrade += output;
          break;
        case 'gold':
          specialistGold += output;
          break;
        case 'science':
          specialistScience += output;
          break;
        case 'luxury':
          specialistLuxury += output;
          break;
      }
    }

    // Total base outputs including specialists
    foodOutput += specialistFood;
    shieldOutput += specialistShields;
    tradeOutput += specialistTrade;

    // Calculate building bonuses
    let scienceBonus = 0;
    let goldBonus = 0;
    let defenseBonus = 0;
    let happinessBonus = 0;
    let foodBonus = 0;

    for (const buildingId of city.buildings) {
      const building = BUILDING_TYPES[buildingId];
      if (building) {
        scienceBonus += building.effects.scienceBonus || 0;
        goldBonus += building.effects.goldBonus || 0;
        defenseBonus += building.effects.defenseBonus || 0;
        happinessBonus += building.effects.happinessBonus || 0;
        foodBonus += building.effects.foodBonus || 0;
      }
    }

    // Apply bonuses (following Freeciv percentage system)
    // Trade gets converted to science/gold/luxury based on tax rates
    // For now use 50/50 split - TODO: integrate with PolicyManager for tax rates
    const tradeAfterBonus = Math.floor((tradeOutput * (100 + goldBonus + scienceBonus)) / 100);
    city.sciencePerTurn = Math.floor(tradeAfterBonus / 2) + specialistScience;
    city.goldPerTurn = Math.floor(tradeAfterBonus / 2) + specialistGold;
    city.luxuryPerTurn = specialistLuxury; // Luxury comes from specialists mainly

    city.defenseStrength = Math.floor((1 * (100 + defenseBonus)) / 100);

    // Calculate food and production surplus (following Freeciv upkeep)
    const populationUpkeep = city.population * 2; // Each citizen eats 2 food
    city.foodPerTurn = Math.floor((foodOutput * (100 + foodBonus)) / 100) - populationUpkeep;
    city.productionPerTurn = shieldOutput;

    // Update granary size and turns calculation
    city.granarySize = this.calculateGranarySize(city.population);
    city.granaryTurns = this.calculateGranaryTurns(
      city.population,
      city.foodStock,
      city.foodPerTurn
    );

    // Basic happiness calculation - will be enhanced with full happiness system
    city.happinessLevel = Math.min(100, 50 + happinessBonus + specialistLuxury * 10);

    logger.debug('City refreshed with specialists', {
      cityId,
      population: city.population,
      foodPerTurn: city.foodPerTurn,
      productionPerTurn: city.productionPerTurn,
      goldPerTurn: city.goldPerTurn,
      sciencePerTurn: city.sciencePerTurn,
      luxuryPerTurn: city.luxuryPerTurn,
      specialists: city.specialists,
      granaryTurns: city.granaryTurns,
    });
  }

  /**
   * Process city turn following Freeciv update_city_activities logic
   */
  async processCityTurn(cityId: string, currentTurn: number): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) return;

    // Refresh city first
    this.refreshCity(cityId);

    // Apply government effects (corruption, happiness, etc.)
    this.refreshCityWithGovernmentEffects(cityId);

    // Process food (growth/starvation) following Freeciv
    city.foodStock += city.foodPerTurn;

    // Handle growth and starvation following Freeciv granary logic
    // Reference: freeciv-web/javascript/city.js granary calculations
    const foodNeededForGrowth = city.granarySize; // Use actual granary size

    if (city.foodPerTurn > 0 && city.foodStock >= foodNeededForGrowth) {
      // City grows
      city.population++;

      // Check if granary exists to preserve food
      const hasGranary = city.buildings.includes('granary');
      if (hasGranary) {
        // Granary preserves 50% of food when growing
        city.foodStock = Math.floor(foodNeededForGrowth / 2);
      } else {
        // No granary - start fresh
        city.foodStock = 0;
      }

      city.lastGrowthTurn = currentTurn;
      city.granaryTurns = this.calculateGranaryTurns(
        city.population,
        city.foodStock,
        city.foodPerTurn
      );

      logger.info('City grew', {
        cityId,
        newSize: city.population,
        hasGranary,
        foodPreserved: city.foodStock,
      });
    } else if (city.foodPerTurn < 0 && city.foodStock < 0) {
      // City starves (loses population)
      if (city.population > 1) {
        city.population--;
        city.foodStock = 0; // Reset food stock after starvation
        city.granaryTurns = this.calculateGranaryTurns(
          city.population,
          city.foodStock,
          city.foodPerTurn
        );

        logger.info('City starved', { cityId, newSize: city.population });
      } else {
        // Cannot starve below size 1 - just reset food
        city.foodStock = 0;
      }
    } else {
      // Update granary turns for UI display
      city.granaryTurns = this.calculateGranaryTurns(
        city.population,
        city.foodStock,
        city.foodPerTurn
      );
    }

    // Process production following Freeciv shield system
    if (city.currentProduction) {
      city.productionStock += city.productionPerTurn;

      let productionCost = 0;
      if (city.productionType === 'unit') {
        const unitType = UNIT_TYPES[city.currentProduction];
        productionCost = unitType?.cost || 0;
      } else if (city.productionType === 'building') {
        const building = BUILDING_TYPES[city.currentProduction];
        productionCost = building?.cost || 0;
      }

      // Update turns to complete
      if (city.productionPerTurn > 0) {
        city.turnsToComplete = Math.ceil(
          (productionCost - city.productionStock) / city.productionPerTurn
        );
      }

      // Complete production if enough shields
      if (city.productionStock >= productionCost) {
        await this.completeProduction(cityId);
      }
    }

    // Update database
    await this.saveCityToDatabase(city);
  }

  /**
   * Complete current production and advance worklist following Freeciv logic
   * Reference: freeciv-web/javascript/city.js production completion
   */
  private async completeProduction(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || !city.currentProduction) return;

    if (city.productionType === 'unit') {
      // Unit completed - create through callback
      logger.info('Unit production completed', {
        cityId,
        unitType: city.currentProduction,
      });

      if (this.callbacks.createUnit) {
        try {
          await this.callbacks.createUnit(city.playerId, city.currentProduction, city.x, city.y);
        } catch (error) {
          logger.error('Failed to create unit from city production', {
            cityId,
            unitType: city.currentProduction,
            error,
          });
        }
      }
    } else if (city.productionType === 'building') {
      // Building completed
      city.buildings.push(city.currentProduction);
      logger.info('Building completed', {
        cityId,
        building: city.currentProduction,
      });
    }

    // Reset current production
    city.productionStock = 0;
    city.currentProduction = null;
    city.productionType = null;
    city.turnsToComplete = 0;

    // Advance to next item in worklist (following Freeciv worklist logic)
    if (city.worklist.length > 0) {
      const nextItem = city.worklist.shift()!;

      // Check if we can still build this item (requirements may have changed)
      if (this.canCityQueueItem(city, nextItem.kind, nextItem.value)) {
        city.currentProduction = nextItem.value;
        city.productionType = nextItem.kind;

        // Calculate turns to complete for new production
        let productionCost = 0;
        if (nextItem.kind === 'unit') {
          const unitType = UNIT_TYPES[nextItem.value];
          productionCost = unitType?.cost || 0;
        } else {
          const building = BUILDING_TYPES[nextItem.value];
          productionCost = building?.cost || 0;
        }

        if (city.productionPerTurn > 0) {
          city.turnsToComplete = Math.ceil(productionCost / city.productionPerTurn);
        }

        logger.info('Started next worklist item', {
          cityId,
          production: nextItem.name,
          type: nextItem.kind,
          turnsToComplete: city.turnsToComplete,
        });
      } else {
        logger.warn('Skipped invalid worklist item', {
          cityId,
          production: nextItem.name,
          reason: 'Requirements no longer met',
        });

        // Try next item in worklist
        if (city.worklist.length > 0) {
          await this.completeProduction(cityId); // Recursive call to try next item
          return;
        }
      }
    }

    // Refresh city to apply new building effects
    this.refreshCity(cityId);
  }

  /**
   * Calculate granary size following Freeciv formula
   * Reference: freeciv-web matches granary size calculations
   */
  private calculateGranarySize(population: number): number {
    // Following classic Freeciv granary size formula
    // Granary size increases with city size: 10 * (population + 1)
    return (population + 1) * 10;
  }

  /**
   * Calculate granary turns to growth/starvation following exact Freeciv logic
   * Reference: freeciv-web/javascript/city.js:2320-2338 city_turns_to_growth_text
   */
  private calculateGranaryTurns(
    population: number,
    foodStock: number,
    foodPerTurn: number
  ): number {
    if (foodPerTurn === 0) {
      return 0; // blocked - matches original "blocked" return
    }

    const granarySize = this.calculateGranarySize(population);

    if (foodPerTurn > 0) {
      // Positive food surplus - growing
      if (foodStock >= granarySize) {
        return 1; // Ready to grow next turn
      }
      const foodNeeded = granarySize - foodStock;
      return Math.ceil(foodNeeded / foodPerTurn);
    } else if (foodPerTurn < 0) {
      // Negative food - starving
      if (population <= 1) {
        return 1000000; // Cannot starve below size 1 - matches original logic
      }

      // Calculate turns until starvation
      const turnsToStarvation = Math.ceil(foodStock / Math.abs(foodPerTurn));
      return turnsToStarvation === 1 ? -1 : -turnsToStarvation; // -1 for immediate starvation
    }

    return 0; // No change
  }

  /**
   * Change specialist assignment following exact Freeciv logic
   * Reference: freeciv-web/javascript/city.js:2580-2626 city_change_specialist
   */
  async changeSpecialist(
    cityId: string,
    fromSpecialist: SpecialistType,
    toSpecialist: SpecialistType | -1, // -1 means auto-cycle
    playerId: string,
    hasAdamSmith: boolean = false,
    modifierKeyPressed: boolean = false
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('Not your city');
    }

    // Validate we have a specialist of the from type to convert
    if (city.specialists[fromSpecialist] <= 0) {
      throw new Error(`No ${SPECIALIST_TYPES[fromSpecialist].name} to reassign`);
    }

    let finalToSpecialist: SpecialistType;

    // Following exact freeciv-web specialist cycling logic
    if (toSpecialist === -1) {
      // Auto-cycle behavior - matches freeciv-web logic exactly
      if (!hasAdamSmith) {
        // Standard rules: cycle through first 3 specialists only
        finalToSpecialist = ((fromSpecialist + 1) % 3) as SpecialistType;
      } else {
        // Adam Smith rules: can access all 6 specialists
        finalToSpecialist = ((fromSpecialist + 1) % 6) as SpecialistType;

        // CTRL/ALT/CMD key optionally bypasses extended specialists 3-5
        if (modifierKeyPressed && finalToSpecialist >= 3) {
          finalToSpecialist = SpecialistType.SCIENTIST; // Reset to first specialist
        }
      }
    } else {
      // Specific specialist selected
      finalToSpecialist = toSpecialist;

      // Validate accessibility based on Adam Smith wonder
      if (finalToSpecialist >= 3 && !hasAdamSmith) {
        throw new Error("Extended specialists require Adam Smith's Trading Company");
      }
    }

    // Make the change
    city.specialists[fromSpecialist]--;
    city.specialists[finalToSpecialist]++;

    // Refresh city to recalculate outputs with new specialist distribution
    this.refreshCity(cityId);

    // Save to database
    await this.saveCityToDatabase(city);

    logger.info('Specialist changed (freeciv-web compliant)', {
      cityId,
      from: SPECIALIST_TYPES[fromSpecialist].name,
      to: SPECIALIST_TYPES[finalToSpecialist].name,
      hasAdamSmith,
      modifierKeyPressed,
    });
  }

  /**
   * Add to city production worklist following Freeciv logic
   * Reference: freeciv-web/javascript/city.js:3628-3645 city_add_to_worklist
   */
  async addToWorklist(cityId: string, items: ProductionItem[]): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    // Validate all items can be queued
    for (const item of items) {
      if (!this.canCityQueueItem(city, item.kind, item.value)) {
        throw new Error(`Cannot queue ${item.name}: requirements not met`);
      }
    }

    // Add to worklist
    city.worklist.push(...items);

    // If city has no current production, start first item from worklist
    if (!city.currentProduction && city.worklist.length > 0) {
      const firstItem = city.worklist.shift()!;
      await this.setCityProduction(cityId, firstItem.value, firstItem.kind);
    }

    await this.saveCityToDatabase(city);
    logger.info('Items added to worklist', { cityId, itemCount: items.length });
  }

  /**
   * Check if city can queue a production item
   * Reference: freeciv-web/javascript/city.js:1745-1765 can_city_queue_item
   */
  private canCityQueueItem(city: CityState, kind: 'unit' | 'building', value: string): boolean {
    if (kind === 'building') {
      // Cannot queue building if already built or already in queue
      if (city.buildings.includes(value)) {
        return false;
      }

      // Check if already in worklist
      const inWorklist = city.worklist.some(
        item => item.kind === 'building' && item.value === value
      );
      if (inWorklist) {
        return false;
      }

      // Check current production
      if (city.currentProduction === value && city.productionType === 'building') {
        return false;
      }
    }

    // TODO: Add technology requirements check when TechnologyManager is integrated
    // TODO: Add government requirements check when GovernmentManager is integrated

    return true;
  }

  /**
   * Generate available production options for city following Freeciv logic
   * Reference: freeciv-web/javascript/city.js:1589-1680 generate_production_list
   */
  getAvailableProductions(cityId: string): ProductionItem[] {
    const city = this.cities.get(cityId);
    if (!city) return [];

    const productionList: ProductionItem[] = [];

    // Add available units
    for (const [unitId, unitType] of Object.entries(UNIT_TYPES)) {
      // TODO: Add unit requirement checks (tech, government, resources) when integrated
      if (this.canCityQueueItem(city, 'unit', unitId)) {
        productionList.push({
          kind: 'unit',
          value: unitId,
          name: unitType.name,
          cost: unitType.cost,
          vutKind: VUT_UTYPE, // Add VUT constant for freeciv-web compatibility
        });
      }
    }

    // Add available buildings
    for (const [buildingId, building] of Object.entries(BUILDING_TYPES)) {
      // TODO: Add building requirement checks (tech, obsolescence) when integrated
      if (this.canCityQueueItem(city, 'building', buildingId)) {
        productionList.push({
          kind: 'building',
          value: buildingId,
          name: building.name,
          cost: building.cost,
          vutKind: VUT_IMPROVEMENT, // Add VUT constant for freeciv-web compatibility
        });
      }
    }

    // Sort by cost for better UX
    productionList.sort((a, b) => a.cost - b.cost);

    return productionList;
  }

  /**
   * Set city production following Freeciv production queue
   */
  async setCityProduction(
    cityId: string,
    production: string,
    type: 'unit' | 'building'
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    // Validate production choice
    if (type === 'unit' && !UNIT_TYPES[production]) {
      throw new Error(`Unknown unit type: ${production}`);
    }
    if (type === 'building' && !BUILDING_TYPES[production]) {
      throw new Error(`Unknown building type: ${production}`);
    }
    if (type === 'building' && city.buildings.includes(production)) {
      throw new Error(`Building already exists: ${production}`);
    }

    city.currentProduction = production;
    city.productionType = type;

    // Calculate turns to complete
    let productionCost = 0;
    if (type === 'unit') {
      productionCost = UNIT_TYPES[production].cost;
    } else {
      productionCost = BUILDING_TYPES[production].cost;
    }

    if (city.productionPerTurn > 0) {
      city.turnsToComplete = Math.ceil(
        (productionCost - city.productionStock) / city.productionPerTurn
      );
    }

    await this.saveCityToDatabase(city);
    logger.info('City production set', {
      cityId,
      production,
      type,
      turnsToComplete: city.turnsToComplete,
    });
  }

  /**
   * Get city by ID
   */
  getCity(cityId: string): CityState | undefined {
    return this.cities.get(cityId);
  }

  /**
   * Get all cities for a player
   */
  getPlayerCities(playerId: string): CityState[] {
    return Array.from(this.cities.values()).filter(city => city.playerId === playerId);
  }

  /**
   * Load cities from database
   */
  async loadCities(): Promise<void> {
    const dbCities = await this.databaseProvider
      .getDatabase()
      .select()
      .from(cities)
      .where(eq(cities.gameId, this.gameId));

    for (const dbCity of dbCities) {
      const cityState: CityState = {
        id: dbCity.id,
        gameId: dbCity.gameId,
        playerId: dbCity.playerId,
        name: dbCity.name,
        x: dbCity.x,
        y: dbCity.y,
        population: dbCity.population,
        foodStock: dbCity.food,
        foodPerTurn: dbCity.foodPerTurn,
        granarySize: this.calculateGranarySize(dbCity.population),
        granaryTurns: this.calculateGranaryTurns(
          dbCity.population,
          dbCity.food,
          dbCity.foodPerTurn
        ),
        productionStock: dbCity.production,
        productionPerTurn: dbCity.productionPerTurn,
        currentProduction: dbCity.currentProduction || null,
        worklist: [], // TODO: Load from database when worklist persistence is added
        goldPerTurn: dbCity.goldPerTurn,
        sciencePerTurn: dbCity.sciencePerTurn,
        culturePerTurn: dbCity.culturePerTurn,
        luxuryPerTurn: 0, // Will be calculated in refreshCity
        buildings: Array.isArray(dbCity.buildings) ? (dbCity.buildings as string[]) : [],
        workingTiles: Array.isArray(dbCity.workedTiles)
          ? (dbCity.workedTiles as Array<{ x: number; y: number }>)
          : [{ x: dbCity.x, y: dbCity.y }],
        // Initialize specialists - TODO: Load from database when specialist persistence is added
        specialists: {
          [SpecialistType.SCIENTIST]: 0,
          [SpecialistType.TAX_COLLECTOR]: 0,
          [SpecialistType.ENTERTAINER]: 0,
          [SpecialistType.WORKER]: 0,
          [SpecialistType.ENGINEER]: 0,
          [SpecialistType.MERCHANT]: 0,
        },
        isCapital: dbCity.isCapital,
        defenseStrength: dbCity.defenseStrength,
        happinessLevel: dbCity.happiness,
        healthLevel: dbCity.health,
        happiness: {
          happy: 1, // Will be recalculated in refreshCity
          content: 0,
          unhappy: 0,
          angry: 0,
        },
        foundedTurn: dbCity.foundedTurn,
        turnsToComplete: 0,
      };

      this.cities.set(dbCity.id, cityState);

      // Refresh city to recalculate all outputs with current data
      this.refreshCity(dbCity.id);
    }

    logger.info(`Loaded ${this.cities.size} cities for game ${this.gameId}`);
  }

  /**
   * Save city to database
   */
  private async saveCityToDatabase(city: CityState): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(cities)
      .set({
        population: city.population,
        food: city.foodStock,
        foodPerTurn: city.foodPerTurn,
        production: city.productionStock,
        productionPerTurn: city.productionPerTurn,
        currentProduction: city.currentProduction,
        goldPerTurn: city.goldPerTurn,
        sciencePerTurn: city.sciencePerTurn,
        culturePerTurn: city.culturePerTurn,
        buildings: city.buildings,
        workedTiles: city.workingTiles,
        defenseStrength: city.defenseStrength,
        happiness: city.happinessLevel,
        health: city.healthLevel,
      })
      .where(eq(cities.id, city.id));
  }

  /**
   * Process all cities for a turn
   */
  async processAllCitiesTurn(currentTurn: number): Promise<void> {
    for (const cityId of this.cities.keys()) {
      await this.processCityTurn(cityId, currentTurn);
    }
  }

  /**
   * Get debug information
   */
  getDebugInfo(): any {
    return {
      gameId: this.gameId,
      cityCount: this.cities.size,
      cities: Array.from(this.cities.values()).map(city => ({
        id: city.id,
        name: city.name,
        population: city.population,
        foodPerTurn: city.foodPerTurn,
        productionPerTurn: city.productionPerTurn,
        currentProduction: city.currentProduction,
      })),
    };
  }

  /**
   * Set government manager for government-related calculations
   */
  setGovernmentManager(governmentManager: GovernmentManager): void {
    this.governmentManager = governmentManager;
  }

  /**
   * Calculate corruption/waste for city output
   * Direct port of freeciv city_waste() function
   * Reference: /reference/freeciv/common/city.c city_waste()
   */
  public calculateCorruption(
    cityId: string,
    outputType: OutputType,
    totalOutput: number,
    currentGovernment: string
  ): CorruptionResult {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`City ${cityId} not found for corruption calculation`);
      return {
        baseWaste: 0,
        distanceWaste: 0,
        totalWaste: 0,
        wasteReduction: 0,
        finalWaste: 0,
      };
    }

    const context: EffectContext = {
      playerId: city.playerId,
      cityId: city.id,
      government: currentGovernment,
      outputType,
    };

    // Base waste level from government
    const baseWasteEffect = this.effectsManager.calculateEffect(EffectType.OUTPUT_WASTE, context);
    let wasteLevel = baseWasteEffect.value;
    let totalEffective = totalOutput;
    const penaltySize = 0;

    // Special case for trade: affected by city size restrictions
    // TODO: Implement notradesize/fulltradesize when game settings are available
    if (outputType === OutputType.TRADE) {
      // For now, skip size penalties - will be added when game settings integrated
    }

    totalEffective -= penaltySize;
    let penaltyWaste = 0;
    let wasteAll = false;

    // Distance-based waste calculation
    if (totalEffective > 0) {
      const distanceWasteEffect = this.effectsManager.calculateEffect(
        EffectType.OUTPUT_WASTE_BY_DISTANCE,
        context
      );
      const relDistanceWasteEffect = this.effectsManager.calculateEffect(
        EffectType.OUTPUT_WASTE_BY_REL_DISTANCE,
        context
      );

      if (distanceWasteEffect.value > 0 || relDistanceWasteEffect.value > 0) {
        const govCenter = this.findNearestGovernmentCenter(city.playerId, city.x, city.y);

        if (!govCenter) {
          wasteAll = true; // No government center - lose all output
        } else {
          const distance = govCenter.distance;
          wasteLevel += (distanceWasteEffect.value * distance) / 100;

          // Relative distance waste (scales with map size)
          if (relDistanceWasteEffect.value > 0) {
            // Using 50x50 as standard map size for reference
            // TODO: Get actual map size when MapManager is integrated
            const mapSize = Math.max(50, 50); // Placeholder
            wasteLevel += (relDistanceWasteEffect.value * 50 * distance) / (100 * mapSize);
          }
        }
      }
    }

    // Calculate final waste
    if (wasteAll) {
      penaltyWaste = totalEffective;
    } else {
      // Apply waste percentage reduction effects
      const wasteReductionEffect = this.effectsManager.calculateEffect(
        EffectType.OUTPUT_WASTE_PCT,
        context
      );

      if (wasteLevel > 0) {
        penaltyWaste = (totalEffective * wasteLevel) / 100;
      }

      // Apply waste reduction (like from Palace)
      const wasteReduction = (penaltyWaste * wasteReductionEffect.value) / 100;
      penaltyWaste -= wasteReduction;

      // Clip to valid range
      penaltyWaste = Math.min(Math.max(penaltyWaste, 0), totalEffective);
    }

    const finalWaste = penaltyWaste + penaltySize;
    const govCenter = this.findNearestGovernmentCenter(city.playerId, city.x, city.y);

    return {
      baseWaste: baseWasteEffect.value,
      distanceWaste: wasteLevel - baseWasteEffect.value,
      totalWaste: wasteLevel,
      wasteReduction: 0, // TODO: Calculate actual reduction
      finalWaste: Math.floor(finalWaste),
      governmentCenter: govCenter || undefined,
    };
  }

  /**
   * Calculate detailed happiness for a city following Freeciv logic
   * Reference: freeciv-web/javascript/city.js:2728-2819 show_city_happy_tab
   * Reference: freeciv happiness calculations in common/city.c
   */
  public calculateDetailedHappiness(
    cityId: string,
    currentGovernment: string,
    militaryUnitsInCity: number = 0
  ): HappinessResult & { breakdown: any } {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`City ${cityId} not found for happiness calculation`);
      const population = 0;
      return {
        baseHappy: 0,
        baseContent: population,
        baseUnhappy: 0,
        martialLawBonus: 0,
        buildingBonus: 0,
        finalHappy: 0,
        finalContent: population,
        finalUnhappy: 0,
        breakdown: {},
      };
    }

    let happy = 0;
    let content = city.population;
    let unhappy = 0;
    const angry = 0;

    // Step 1: Base citizens (all start as content)
    // Reference: freeciv FEELING_BASE
    const baseHappy = 0;
    const baseContent = city.population;
    const baseUnhappy = 0;

    // Step 2: Apply luxury effects
    // Reference: freeciv FEELING_LUXURY
    const luxuryEffect = Math.floor(city.luxuryPerTurn / 2); // 2 luxury = 1 happy citizen
    happy += luxuryEffect;
    content = Math.max(0, content - luxuryEffect);

    // Step 3: Apply building effects
    // Reference: freeciv FEELING_EFFECT
    let buildingHappiness = 0;
    for (const buildingId of city.buildings) {
      const building = BUILDING_TYPES[buildingId];
      if (building?.effects.happinessBonus) {
        buildingHappiness += building.effects.happinessBonus;
      }
    }
    happy += buildingHappiness;
    content = Math.max(0, content - buildingHappiness);

    // Step 4: Martial law effects
    // Reference: freeciv FEELING_MARTIAL
    // Each military unit can pacify up to 2 unhappy citizens (simplified)
    const martialLawEffect = Math.min(militaryUnitsInCity * 2, unhappy);

    // Step 5: Government-based unhappiness
    // Different governments have different unhappiness thresholds
    let govUnhappiness = 0;
    switch (currentGovernment) {
      case 'anarchy':
        govUnhappiness = Math.max(0, city.population - 1); // All but 1 citizen unhappy
        break;
      case 'despotism':
        govUnhappiness = Math.max(0, city.population - 3); // Size 4+ cities get unhappy
        break;
      case 'monarchy':
        govUnhappiness = Math.max(0, city.population - 4); // Size 5+ cities get unhappy
        break;
      case 'republic':
      case 'democracy':
        govUnhappiness = Math.max(0, city.population - 5); // Size 6+ cities get unhappy
        break;
      default:
        govUnhappiness = Math.max(0, city.population - 3);
    }

    // Convert some content citizens to unhappy based on government
    unhappy += govUnhappiness;
    content = Math.max(0, content - govUnhappiness);

    // Apply martial law reduction
    unhappy = Math.max(0, unhappy - martialLawEffect);
    content += Math.min(martialLawEffect, govUnhappiness);

    // Step 6: Final adjustments - any remaining citizens are content
    // Citizens can be: happy, content, unhappy, or angry
    // Angry citizens cause disorder (not implemented yet)

    const result = {
      baseHappy,
      baseContent: baseContent,
      baseUnhappy,
      martialLawBonus: martialLawEffect,
      buildingBonus: buildingHappiness,
      finalHappy: happy,
      finalContent: content,
      finalUnhappy: unhappy,
      breakdown: {
        luxuryEffect,
        buildingHappiness,
        govUnhappiness,
        martialLawEffect,
        militaryUnitsInCity,
      },
    };

    // Update city's happiness breakdown
    city.happiness = {
      happy,
      content,
      unhappy,
      angry, // Will be used for disorder calculations
    };

    return result;
  }

  /**
   * Calculate happiness for a city (simplified version for backwards compatibility)
   * Reference: freeciv happiness calculations in common/city.c
   */
  public calculateHappiness(
    cityId: string,
    currentGovernment: string,
    militaryUnitsInCity: number
  ): HappinessResult {
    const detailed = this.calculateDetailedHappiness(
      cityId,
      currentGovernment,
      militaryUnitsInCity
    );
    return {
      baseHappy: detailed.baseHappy,
      baseContent: detailed.baseContent,
      baseUnhappy: detailed.baseUnhappy,
      martialLawBonus: detailed.martialLawBonus,
      buildingBonus: detailed.buildingBonus,
      finalHappy: detailed.finalHappy,
      finalContent: detailed.finalContent,
      finalUnhappy: detailed.finalUnhappy,
    };
  }

  /**
   * Check if city is in disorder (unhappy citizens > happy citizens)
   * Reference: freeciv-web/javascript/city.js:5110-5118 city_unhappy
   */
  public isCityUnhappy(cityId: string): boolean {
    const city = this.cities.get(cityId);
    if (!city) return false;

    // City is unhappy if unhappy + angry citizens > happy citizens
    return city.happiness.unhappy + city.happiness.angry * 2 > city.happiness.happy;
  }

  /**
   * Get city state description following Freeciv logic
   * Reference: freeciv-web/javascript/city.js:5120-5135 get_city_state
   */
  public getCityStateDescription(cityId: string): string {
    const city = this.cities.get(cityId);
    if (!city) return 'Unknown';

    // Check for starvation
    if (city.foodPerTurn < 0 && city.population > 1) {
      return 'Famine';
    }

    // Check for celebration (requires happiness and sufficient size)
    const celebrateSize = 3; // Minimum size for celebration
    if (
      city.happiness.happy > city.happiness.unhappy + city.happiness.angry &&
      city.population >= celebrateSize
    ) {
      return 'Celebrating';
    }

    // Check for disorder
    if (this.isCityUnhappy(cityId)) {
      return 'Disorder';
    }

    return 'Peace';
  }

  /**
   * Find nearest government center (Palace, Courthouse)
   * Reference: freeciv nearest_gov_center() in common/city.c
   */
  private findNearestGovernmentCenter(
    playerId: string,
    cityX: number,
    cityY: number
  ): { cityId: string; distance: number } | null {
    let nearest: { cityId: string; distance: number } | null = null;
    let minDistance = Infinity;

    // Find all cities with government center effect (Palace, Courthouse)
    for (const [cityId, city] of this.cities) {
      if (city.playerId !== playerId) {
        continue;
      }

      // Check if city has government center building
      const hasGovCenter =
        city.buildings.includes('palace') || city.buildings.includes('courthouse');

      if (hasGovCenter) {
        const distance = Math.abs(city.x - cityX) + Math.abs(city.y - cityY);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = { cityId, distance };
        }
      }
    }

    return nearest;
  }

  /**
   * Apply corruption to city production
   * Updates city output values with corruption calculations
   */
  public applyCityCorruption(cityId: string, currentGovernment: string): void {
    const city = this.cities.get(cityId);
    if (!city) {
      return;
    }

    // Calculate corruption for trade output
    const tradeCorruption = this.calculateCorruption(
      cityId,
      OutputType.TRADE,
      city.goldPerTurn + city.sciencePerTurn, // Total trade
      currentGovernment
    );

    // Calculate corruption for shield output
    const shieldCorruption = this.calculateCorruption(
      cityId,
      OutputType.SHIELD,
      city.productionPerTurn,
      currentGovernment
    );

    // Apply corruption to city output
    const tradeAfterCorruption = Math.max(
      0,
      city.goldPerTurn + city.sciencePerTurn - tradeCorruption.finalWaste
    );
    const shieldsAfterCorruption = Math.max(
      0,
      city.productionPerTurn - shieldCorruption.finalWaste
    );

    // Distribute remaining trade between gold and science (50/50 for now)
    // TODO: Use actual tax rates when PolicyManager integration is complete
    city.goldPerTurn = Math.floor(tradeAfterCorruption / 2);
    city.sciencePerTurn = tradeAfterCorruption - city.goldPerTurn;
    city.productionPerTurn = shieldsAfterCorruption;

    logger.debug(
      `Applied corruption to city ${city.name}: trade=${tradeCorruption.finalWaste}, shields=${shieldCorruption.finalWaste}`
    );
  }

  /**
   * Apply happiness calculations to city with detailed tracking
   * Updates city happiness level based on government and buildings
   */
  public applyCityHappiness(cityId: string, currentGovernment: string): void {
    const city = this.cities.get(cityId);
    if (!city) {
      return;
    }

    // Count military units in city (placeholder - will be integrated with UnitManager)
    const militaryUnitsInCity = 0; // TODO: Get from UnitManager

    // Use detailed happiness calculation
    const happinessResult = this.calculateDetailedHappiness(
      cityId,
      currentGovernment,
      militaryUnitsInCity
    );

    // Update city happiness level (scale to 0-100)
    const totalCitizens = city.population;
    if (totalCitizens > 0) {
      // Happiness score based on the proportion of happy vs unhappy citizens
      const happinessScore =
        ((happinessResult.finalHappy - happinessResult.finalUnhappy) * 50) / totalCitizens + 50;
      city.happinessLevel = Math.min(100, Math.max(0, happinessScore));
    }

    logger.debug(
      `Applied detailed happiness to city ${city.name}: happy=${happinessResult.finalHappy}, content=${happinessResult.finalContent}, unhappy=${happinessResult.finalUnhappy}, state=${this.getCityStateDescription(cityId)}`,
      happinessResult.breakdown
    );
  }

  /**
   * Refresh city with government effects
   * Applies corruption and happiness based on current government
   */
  public refreshCityWithGovernmentEffects(cityId: string): void {
    if (!this.governmentManager) {
      logger.warn('GovernmentManager not set, skipping government effects');
      return;
    }

    const city = this.cities.get(cityId);
    if (!city) {
      return;
    }

    const playerGov = this.governmentManager.getPlayerGovernment(city.playerId);
    const currentGovernment = playerGov?.currentGovernment || 'despotism';

    // Apply corruption and happiness
    this.applyCityCorruption(cityId, currentGovernment);
    this.applyCityHappiness(cityId, currentGovernment);
  }

  /**
   * Get city at specific coordinates
   */
  getCityAt(x: number, y: number): CityState | null {
    for (const city of this.cities.values()) {
      if (city.x === x && city.y === y) {
        return city;
      }
    }
    return null;
  }

  /**
   * Cleanup all cities
   */
  cleanup(): void {
    this.cities.clear();
    logger.debug(`City manager cleaned up for game ${this.gameId}`);
  }
}
