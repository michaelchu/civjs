/* eslint-disable @typescript-eslint/no-explicit-any, complexity */
import { logger } from '../utils/logger';
import { db } from '../database';
import { cities } from '../database/schema';
import { eq } from 'drizzle-orm';
import { UNIT_TYPES } from './constants/UnitConstants';
import { EffectsManager, EffectType, OutputType, EffectContext } from './EffectsManager';
import type { GovernmentManager } from './GovernmentManager';

// Following original Freeciv city radius logic
export const CITY_MAP_DEFAULT_RADIUS = 2;
export const CITY_MAP_DEFAULT_RADIUS_SQ = CITY_MAP_DEFAULT_RADIUS * CITY_MAP_DEFAULT_RADIUS + 1; // 5
export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = CITY_MAP_MAX_RADIUS * CITY_MAP_MAX_RADIUS + 1; // 10

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
      foodBonus: 1, // Helps with growth
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
  foodStock: number; // accumulated food
  foodPerTurn: number; // food surplus/deficit

  // Production (following Freeciv shield system)
  productionStock: number; // accumulated shields
  productionPerTurn: number; // shield surplus
  currentProduction?: string; // what's being built
  productionType?: 'unit' | 'building'; // type of production
  turnsToComplete: number;

  // Economy (following Freeciv trade system)
  goldPerTurn: number;
  sciencePerTurn: number;
  culturePerTurn: number;

  // Buildings and improvements
  buildings: string[]; // building IDs
  workingTiles: Array<{ x: number; y: number }>; // tiles being worked

  // Status
  isCapital: boolean;
  defenseStrength: number;
  happinessLevel: number; // 0-100
  healthLevel: number; // 0-100

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

export class CityManager {
  private cities: Map<string, CityState> = new Map();
  private gameId: string;
  private effectsManager: EffectsManager;
  private governmentManager?: GovernmentManager;

  constructor(gameId: string, effectsManager?: EffectsManager) {
    this.gameId = gameId;
    this.effectsManager = effectsManager || new EffectsManager();
  }

  /**
   * Found a new city following Freeciv logic
   */
  async foundCity(
    playerId: string,
    name: string,
    x: number,
    y: number,
    foundedTurn: number
  ): Promise<string> {
    logger.info('Founding new city', { name, x, y, playerId });

    // Create city in database following Freeciv initial values
    const [dbCity] = await db
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
      productionStock: 0,
      productionPerTurn: 1,
      goldPerTurn: 0,
      sciencePerTurn: 0,
      culturePerTurn: 1,
      buildings: [],
      workingTiles: [{ x, y }],
      isCapital: false,
      defenseStrength: 1,
      happinessLevel: 50,
      healthLevel: 100,
      foundedTurn,
      turnsToComplete: 0,
    };

    this.cities.set(dbCity.id, cityState);
    logger.info('City founded successfully', { cityId: dbCity.id, name });

    return dbCity.id;
  }

  /**
   * Refresh city following Freeciv city_refresh logic
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

    // Calculate building bonuses
    let scienceBonus = 0;
    let goldBonus = 0;
    let defenseBonus = 0;
    let happinessBonus = 0;

    for (const buildingId of city.buildings) {
      const building = BUILDING_TYPES[buildingId];
      if (building) {
        scienceBonus += building.effects.scienceBonus || 0;
        goldBonus += building.effects.goldBonus || 0;
        defenseBonus += building.effects.defenseBonus || 0;
        happinessBonus += building.effects.happinessBonus || 0;
      }
    }

    // Apply bonuses (following Freeciv percentage system)
    city.sciencePerTurn = Math.floor((tradeOutput * (100 + scienceBonus)) / 100);
    city.goldPerTurn = Math.floor((tradeOutput * (100 + goldBonus)) / 100);
    city.defenseStrength = Math.floor((1 * (100 + defenseBonus)) / 100);
    city.happinessLevel = Math.min(100, 50 + happinessBonus);

    // Calculate food and production surplus (following Freeciv upkeep)
    const populationUpkeep = city.population * 2; // Each citizen eats 2 food
    city.foodPerTurn = foodOutput - populationUpkeep;
    city.productionPerTurn = shieldOutput;

    logger.debug('City refreshed', {
      cityId,
      population: city.population,
      foodPerTurn: city.foodPerTurn,
      productionPerTurn: city.productionPerTurn,
      goldPerTurn: city.goldPerTurn,
      sciencePerTurn: city.sciencePerTurn,
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

    // Handle growth following Freeciv granary logic
    const foodNeededForGrowth = (city.population + 1) * 10; // Simplified
    if (city.foodStock >= foodNeededForGrowth && city.foodPerTurn > 0) {
      city.population++;
      city.foodStock = 0; // Reset food stock after growth
      city.lastGrowthTurn = currentTurn;
      logger.info('City grew', { cityId, newSize: city.population });
    }

    // Handle starvation following Freeciv
    if (city.foodStock < 0 && city.population > 1) {
      city.population--;
      city.foodStock = 0;
      logger.info('City starved', { cityId, newSize: city.population });
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
   * Complete current production following Freeciv logic
   */
  private async completeProduction(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || !city.currentProduction) return;

    if (city.productionType === 'unit') {
      // Unit completed - would create unit through UnitManager
      logger.info('Unit production completed', {
        cityId,
        unitType: city.currentProduction,
      });
      // Note: Integration with UnitManager would happen in GameManager
    } else if (city.productionType === 'building') {
      // Building completed
      city.buildings.push(city.currentProduction);
      logger.info('Building completed', {
        cityId,
        building: city.currentProduction,
      });
    }

    // Reset production
    city.productionStock = 0;
    city.currentProduction = undefined;
    city.productionType = undefined;
    city.turnsToComplete = 0;

    // Refresh city to apply new building effects
    this.refreshCity(cityId);
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
   * Get city at position
   */
  getCityAt(x: number, y: number): CityState | undefined {
    return Array.from(this.cities.values()).find(city => city.x === x && city.y === y);
  }

  /**
   * Load cities from database
   */
  async loadCities(): Promise<void> {
    const dbCities = await db.select().from(cities).where(eq(cities.gameId, this.gameId));

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
        productionStock: dbCity.production,
        productionPerTurn: dbCity.productionPerTurn,
        currentProduction: dbCity.currentProduction || undefined,
        goldPerTurn: dbCity.goldPerTurn,
        sciencePerTurn: dbCity.sciencePerTurn,
        culturePerTurn: dbCity.culturePerTurn,
        buildings: Array.isArray(dbCity.buildings) ? (dbCity.buildings as string[]) : [],
        workingTiles: Array.isArray(dbCity.workedTiles)
          ? (dbCity.workedTiles as Array<{ x: number; y: number }>)
          : [{ x: dbCity.x, y: dbCity.y }],
        isCapital: dbCity.isCapital,
        defenseStrength: dbCity.defenseStrength,
        happinessLevel: dbCity.happiness,
        healthLevel: dbCity.health,
        foundedTurn: dbCity.foundedTurn,
        turnsToComplete: 0,
      };

      this.cities.set(dbCity.id, cityState);
    }

    logger.info(`Loaded ${this.cities.size} cities for game ${this.gameId}`);
  }

  /**
   * Save city to database
   */
  private async saveCityToDatabase(city: CityState): Promise<void> {
    await db
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
   * Calculate happiness for a city
   * Reference: freeciv happiness calculations in common/city.c
   */
  public calculateHappiness(
    cityId: string,
    currentGovernment: string,
    militaryUnitsInCity: number
  ): HappinessResult {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`City ${cityId} not found for happiness calculation`);
      const population = 0; // City not found
      return {
        baseHappy: 0,
        baseContent: population,
        baseUnhappy: 0,
        martialLawBonus: 0,
        buildingBonus: 0,
        finalHappy: 0,
        finalContent: population,
        finalUnhappy: 0,
      };
    }

    const context: EffectContext = {
      playerId: city.playerId,
      cityId: city.id,
      government: currentGovernment,
    };

    // Base unhappy citizens from city size
    const unhappySizeEffect = this.effectsManager.calculateEffect(
      EffectType.CITY_UNHAPPY_SIZE,
      context
    );
    const baseUnhappy = Math.max(0, city.population - unhappySizeEffect.value);

    // Government-specific base unhappy citizens
    const revolutionUnhappyEffect = this.effectsManager.calculateEffect(
      EffectType.REVOLUTION_UNHAPPINESS,
      context
    );
    const govUnhappy = revolutionUnhappyEffect.value;

    // Martial law from military units
    const martialLawResult = this.effectsManager.calculateMartialLaw(context, militaryUnitsInCity);

    // Building happiness bonuses
    let buildingBonus = 0;
    for (const buildingId of city.buildings) {
      const building = BUILDING_TYPES[buildingId];
      if (building?.effects.happinessBonus) {
        buildingBonus += building.effects.happinessBonus;
      }
    }

    // Calculate final happiness distribution
    const finalUnhappy = Math.max(
      0,
      baseUnhappy + govUnhappy - martialLawResult.happyBonus - buildingBonus
    );
    const finalHappy = buildingBonus + martialLawResult.happyBonus;
    const finalContent = Math.max(0, city.population - finalUnhappy - finalHappy);

    return {
      baseHappy: 0,
      baseContent: city.population,
      baseUnhappy: baseUnhappy + govUnhappy,
      martialLawBonus: martialLawResult.happyBonus,
      buildingBonus,
      finalHappy,
      finalContent,
      finalUnhappy,
    };
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
   * Apply happiness calculations to city
   * Updates city happiness level based on government and buildings
   */
  public applyCityHappiness(cityId: string, currentGovernment: string): void {
    const city = this.cities.get(cityId);
    if (!city) {
      return;
    }

    // Count military units in city (placeholder - will be integrated with UnitManager)
    const militaryUnitsInCity = 0; // TODO: Get from UnitManager

    const happinessResult = this.calculateHappiness(cityId, currentGovernment, militaryUnitsInCity);

    // Update city happiness (scale to 0-100)
    const totalCitizens = city.population;
    if (totalCitizens > 0) {
      const happinessScore = (happinessResult.finalHappy * 100) / totalCitizens;
      city.happinessLevel = Math.min(100, Math.max(0, happinessScore));
    }

    logger.debug(
      `Applied happiness to city ${city.name}: happy=${happinessResult.finalHappy}, content=${happinessResult.finalContent}, unhappy=${happinessResult.finalUnhappy}`
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
   * Cleanup all cities
   */
  cleanup(): void {
    this.cities.clear();
    logger.debug(`City manager cleaned up for game ${this.gameId}`);
  }
}
