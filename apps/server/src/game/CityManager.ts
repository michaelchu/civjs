/* eslint-disable @typescript-eslint/no-explicit-any, complexity */
import { logger } from '../utils/logger';
import { db } from '../database';
import { cities } from '../database/schema';
import { eq } from 'drizzle-orm';
import { UNIT_TYPES } from './UnitManager';

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

export class CityManager {
  private cities: Map<string, CityState> = new Map();
  private gameId: string;

  constructor(gameId: string) {
    this.gameId = gameId;
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
   * Cleanup all cities
   */
  cleanup(): void {
    this.cities.clear();
    logger.debug(`City manager cleaned up for game ${this.gameId}`);
  }
}
