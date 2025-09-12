/* eslint-disable complexity */
import { randomUUID } from 'crypto';
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { cities } from '@database/schema';
import { eq } from 'drizzle-orm';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { EffectsManager } from '@game/managers/EffectsManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import {
  CityFoundingValidationService,
  CityFoundingValidationResult,
  CityFoundingErrorCode,
} from '@game/services/CityFoundingValidationService';
import type { MapManager } from '@game/managers/MapManager';

// Import the specialized services
import { CityManagementService } from '@game/services/CityManagementService';
import { CityTileManagementService } from '@game/services/CityTileManagementService';
import { CityBuildingService } from '@game/services/CityBuildingService';
import { CityTradeRouteService } from '@game/services/CityTradeRouteService';
import { CityProductionService } from '@game/services/CityProductionService';
import { CityGovernorService } from '@game/services/CityGovernorService';
import { CityCaptureService } from '@game/services/CityCaptureService';
import { CitizenManagementService } from '@game/systems/CitizenManagement/CitizenManagementService';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import { OutputType } from '@game/constants/GameConstants';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

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

// Helper functions for production conversion
export function vutToProductionKind(vut: number): 'unit' | 'building' {
  return vut === VUT_UTYPE ? 'unit' : 'building';
}

export function productionKindToVut(kind: 'unit' | 'building'): number {
  return kind === 'unit' ? VUT_UTYPE : VUT_IMPROVEMENT;
}

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
  },
  [SpecialistType.ENGINEER]: {
    id: SpecialistType.ENGINEER,
    name: 'Engineer',
    pluralName: 'Engineers',
    shortName: 'Eng',
    outputType: 'shield',
    outputAmount: 2, // Base shield output
  },
  [SpecialistType.MERCHANT]: {
    id: SpecialistType.MERCHANT,
    name: 'Merchant',
    pluralName: 'Merchants',
    shortName: 'Mer',
    outputType: 'trade',
    outputAmount: 3, // Base trade output
  },
};

export interface WorkableTile {
  x: number;
  y: number;
  isWorked: boolean;
  isCenter?: boolean; // City center tile
  isBlocked?: boolean; // Blocked by another city
  outputs: {
    food: number;
    shields: number;
    trade: number;
  };
  terrain?: string;
  resource?: string;
  improvements?: string[];
}

export interface TradeRoute {
  id?: string;
  sourceCity: string;
  partnerCity: string;
  establishedTurn: number;
  value: number;
  status?: 'active' | 'disrupted';
  distance?: number;
  isCaravan?: boolean;
}

export interface TradeRouteCalculation {
  baseTradeValue: number;
  distanceBonus: number;
  sizeBonus: number;
  governmentBonus: number;
  totalValue: number;
}

export interface ProductionItem {
  kind: 'unit' | 'building' | 'wonder';
  value: string;
  remainingCost?: number;
  // Additional fields for compatibility
  target?: string;
  production?: string;
  type?: 'unit' | 'building' | 'wonder';
  cost?: number;
}

export interface Happiness {
  happy: number;
  content: number;
  unhappy: number;
  angry: number;
}

// Following Freeciv governor priority options
export enum GovernorPriority {
  BALANCED = 'balanced',
  FOOD = 'food',
  SHIELDS = 'shields',
  TRADE = 'trade',
  SCIENCE = 'science',
  GOLD = 'gold',
  LUXURY = 'luxury',
}

export interface CityGovernor {
  isEnabled: boolean;
  priority: GovernorPriority;
  settings: {
    autoManageSpecialists: boolean;
    autoManageTiles: boolean;
    autoManageProduction: boolean;
    preventStarvation: boolean;
    maintainHappiness: boolean;
  };
}

export interface CityState {
  id: string;
  name: string;
  x: number;
  y: number;
  playerId: string;
  population: number;
  size: number; // City size level (1-40)
  cityRadius: number; // Workable tile radius
  founded: number; // Turn founded

  // Production
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
  turnsToComplete: number;

  // Resources and storage
  foodStock?: number;
  foodPerTurn?: number;
  productionPerTurn?: number;
  tradePerTurn?: number;
  shieldStock?: number; // Stored shields
  shieldsPerTurn?: number; // Shields produced per turn
  sciencePerTurn?: number;

  // Culture system (freeciv-based)
  history: number; // Accumulated culture history
  culturePerTurn?: number; // Culture generated per turn

  // Production system (from client types compatibility)
  prod?: {
    food: number;
    shields: number;
    trade: number;
    gold?: number;
    luxury?: number;
    science?: number;
  };
  surplus?: {
    food: number;
    shields: number;
    trade: number;
    gold?: number;
    luxury?: number;
    science?: number;
  };
  granarySize?: number;
  granaryTurns?: number;

  // Buildings and specialists
  buildings: (string | { id: string; name: string; upkeep: number })[];
  specialists: Record<SpecialistType, number>;

  // Tile management
  workableTiles?: WorkableTile[];
  citizenAssignments?: Record<string, boolean>;

  // Trade and economics
  tradeRoutes: TradeRoute[];

  // Happiness and growth
  happiness: Happiness;
  citizens?: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
    specialists: Record<string, number>;
  };
  disorder?: boolean;
  celebrating?: boolean;

  // Automation
  governor?: CityGovernor;

  // Worklist for production queue
  worklist: ProductionItem[];

  // Defense
  defenseStrength?: number;
}

export interface BuildingType {
  id: string;
  name: string;
  cost: number;
  upkeep?: number;
  effects: {
    defenseBonus?: number;
    foodBonus?: number;
    productionBonus?: number;
    scienceBonus?: number;
    goldBonus?: number;
    luxuryBonus?: number;
    happinessEffect?: number;
  };
}

export const BUILDING_TYPES: Record<string, BuildingType> = {
  granary: {
    id: 'granary',
    name: 'Granary',
    cost: 60,
    effects: {
      foodBonus: 50, // 50% bonus to food storage
    },
  },
  temple: {
    id: 'temple',
    name: 'Temple',
    cost: 40,
    effects: {
      happinessEffect: 2, // Makes 2 unhappy citizens content
    },
  },
  marketplace: {
    id: 'marketplace',
    name: 'Marketplace',
    cost: 80,
    effects: {
      goldBonus: 50, // 50% bonus to gold from trade
    },
  },
  library: {
    id: 'library',
    name: 'Library',
    cost: 80,
    effects: {
      scienceBonus: 50, // 50% bonus to science from trade
    },
  },
  walls: {
    id: 'walls',
    name: 'City Walls',
    cost: 120,
    effects: {
      defenseBonus: 200, // 200% defense bonus
    },
  },
  factory: {
    id: 'factory',
    name: 'Factory',
    cost: 140,
    effects: {
      productionBonus: 50, // 50% bonus to production
    },
  },
  palace: {
    id: 'palace',
    name: 'Palace',
    cost: 100,
    effects: {
      defenseBonus: 100, // 100% defense bonus
    },
  },
};

// Callback interface for events
export interface CityManagerCallbacks {
  onCityFounded?: (city: CityState) => void;
  onCityGrowth?: (city: CityState, oldSize: number) => void;
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void;
  onCityDestroyed?: (city: CityState) => void;
  onCityTurnProcessed?: (city: CityState) => void;
}

/**
 * CityManager - Core city management functionality
 *
 * This manager has been refactored to work with specialized services:
 * - CityTileManagementService: Tile and citizen assignment
 * - CityBuildingService: Building construction and effects
 * - CityTradeRouteService: Inter-city trade routes
 * - CityProductionService: Production rush/buy mechanics
 * - CityGovernorService: Automated city governance
 * - CityCaptureService: City conquest and transfer
 * - CityManagementService: High-level coordination
 */
export class CityManager {
  // Core state
  private cities: Map<string, CityState> = new Map();
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private callbacks: CityManagerCallbacks;
  private mapManager?: MapManager;
  private validationService?: CityFoundingValidationService;

  // Manager dependencies for production completion
  private unitManager?: any; // UnitManager
  private broadcastToGame?: (gameId: string, event: string, data: any) => void;

  // Building types for production validation
  private buildingTypes: Record<string, BuildingType> = BUILDING_TYPES;

  // Specialized services
  private managementService?: CityManagementService;
  private tileManagementService?: CityTileManagementService;
  private buildingService?: CityBuildingService;
  private tradeRouteService?: CityTradeRouteService;
  private productionService?: CityProductionService;
  private governorService?: CityGovernorService;
  private captureService?: CityCaptureService;
  private citizenManagementService?: CitizenManagementService;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    _effectsManager: EffectsManager, // Mark as unused with underscore
    callbacks: CityManagerCallbacks = {}
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.callbacks = callbacks;
  }

  /**
   * Set or update callbacks after initialization
   */
  setCallbacks(newCallbacks: Partial<CityManagerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...newCallbacks };
  }

  /**
   * Set unit manager dependency for production completion
   */
  setUnitManager(unitManager: any): void {
    this.unitManager = unitManager;
  }

  /**
   * Set broadcast function for production events
   */
  setBroadcastFunction(broadcastFn: (gameId: string, event: string, data: any) => void): void {
    this.broadcastToGame = broadcastFn;
  }

  /**
   * Initialize the CityManager and its services
   */
  async initialize(): Promise<void> {
    // Initialize specialized services
    this.buildingService = new CityBuildingService(
      this.cities,
      this.databaseProvider,
      BUILDING_TYPES
    );

    this.tradeRouteService = new CityTradeRouteService(this.cities);

    // Create getter functions for player resources (would be implemented by GameManager)
    const getPlayerGold = (_playerId: string): number => {
      // Placeholder implementation
      return 1000;
    };

    const spendPlayerGold = async (_playerId: string, _amount: number): Promise<boolean> => {
      // Placeholder implementation
      return true;
    };

    this.productionService = new CityProductionService(
      this.cities,
      BUILDING_TYPES,
      getPlayerGold,
      spendPlayerGold
    );

    this.governorService = new CityGovernorService(
      this.cities,
      this.changeSpecialist.bind(this),
      this.assignCitizenToTile.bind(this),
      this.convertTileWorkerToSpecialist.bind(this)
    );

    this.captureService = new CityCaptureService(
      this.cities,
      this.updateTradeRoutesOnPlayerChange.bind(this)
    );

    // Initialize citizen management service
    this.citizenManagementService = CitizenManagementService.getInstance();
    await this.citizenManagementService.initialize();

    // Initialize high-level coordination service
    // Note: CityManagementService needs different constructor parameters
    // this.managementService = new CityManagementService(...);
  }

  /**
   * Set the MapManager dependency
   */
  setMapManager(mapManager: MapManager): void {
    this.mapManager = mapManager;

    // Initialize CityTileManagementService now that we have MapManager
    this.tileManagementService = new CityTileManagementService(
      this.cities,
      this.mapManager,
      CITY_MAP_DEFAULT_RADIUS_SQ
    );
  }

  /**
   * Set the GovernmentManager dependency
   */
  setGovernmentManager(_governmentManager: GovernmentManager): void {
    // Store governmentManager reference if needed in future
    // this.governmentManager = governmentManager;
  }

  // === CORE CITY LIFECYCLE METHODS ===

  private citymindistPreventsCityOnTile(x: number, y: number): boolean {
    const minDistance = GAME_DEFAULT_CITYMINDIST;

    for (const city of this.cities.values()) {
      const dx = Math.abs(city.x - x);
      const dy = Math.abs(city.y - y);
      const distance = Math.max(dx, dy); // Chebyshev distance (square grid)

      if (distance < minDistance) {
        return true;
      }
    }

    return false;
  }

  private validateCityFounding(
    x: number,
    y: number,
    playerId: string,
    _settlerId?: string // Mark as unused
  ): CityFoundingValidationResult {
    // Use the validation service if available
    if (this.validationService) {
      return this.validationService.validateCityFounding(
        x,
        y,
        null, // unit - not available in this context
        playerId,
        this.cities // Pass cities map directly
      );
    }

    // Fallback validation logic
    if (this.citymindistPreventsCityOnTile(x, y)) {
      return {
        canFound: false,
        errorCode: CityFoundingErrorCode.CITYMINDIST_VIOLATION,
        errorMessage: 'Too close to existing city',
      };
    }

    return {
      canFound: true,
    };
  }

  async foundCity(
    x: number,
    y: number,
    name: string,
    playerId: string,
    settlerId?: string
  ): Promise<CityState> {
    logger.info(`Attempting to found city "${name}" at (${x}, ${y}) for player ${playerId}`);

    // Validate city founding
    const validation = this.validateCityFounding(x, y, playerId, settlerId);
    if (!validation.canFound) {
      logger.warn(`City founding failed: ${validation.errorMessage}`, {
        x,
        y,
        playerId,
        settlerId,
        errorCode: validation.errorCode,
      });
      throw new Error(validation.errorMessage);
    }

    const cityId = randomUUID();
    const currentTurn = 1; // This would come from game state

    const city: CityState = {
      id: cityId,
      name,
      x,
      y,
      playerId,
      population: 1,
      size: 1,
      cityRadius: CITY_MAP_DEFAULT_RADIUS,
      founded: currentTurn,
      currentProduction: 'warrior', // Default production following Freeciv
      productionType: 'unit' as const,
      turnsToComplete: 10, // Warrior cost, will be recalculated
      shieldStock: 0, // Shield stock for current production
      foodStock: 0,
      foodPerTurn: 2, // Base city center food
      productionPerTurn: 1, // Base city center production
      tradePerTurn: 1, // Base city center trade
      sciencePerTurn: 0, // Will be calculated
      history: 0, // Start with no culture history
      buildings: [],
      specialists: {
        [SpecialistType.SCIENTIST]: 0,
        [SpecialistType.TAX_COLLECTOR]: 0,
        [SpecialistType.ENTERTAINER]: 0,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 0,
        [SpecialistType.MERCHANT]: 0,
      },
      tradeRoutes: [],
      happiness: {
        happy: 0,
        content: 1,
        unhappy: 0,
        angry: 0,
      },
      worklist: [],
      defenseStrength: 1,
    };

    this.cities.set(cityId, city);

    // Initialize workable tiles using the service
    if (this.tileManagementService) {
      this.tileManagementService.initializeWorkableTiles(city);
      // Auto-assign citizens to best available tiles for new city
      await this.optimizeCitizens(cityId);
    } else {
      // Fallback if service is not available
      logger.warn('TileManagementService not available, providing fallback workable tiles', {
        cityId,
      });
      city.workableTiles = [
        {
          x: city.x,
          y: city.y,
          isCenter: true,
          isWorked: true,
          isBlocked: false,
          outputs: { food: 2, shields: 1, trade: 1 },
        },
      ];
    }

    // Calculate city outputs to ensure science and other values are properly set
    this.calculateCityOutputs(cityId);

    // Save to database
    await this.saveCityToDatabase(city);

    // Trigger callback
    if (this.callbacks.onCityFounded) {
      this.callbacks.onCityFounded(city);
    }

    logger.info(`City "${name}" founded successfully`, {
      cityId,
      x,
      y,
      playerId,
      population: city.population,
    });

    return city;
  }

  // === PRODUCTION METHODS ===

  public calculateGranarySize(population: number, rulesetName: string = 'classic'): number {
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

  // === SPECIALIST MANAGEMENT ===

  async changeSpecialist(
    cityId: string,
    fromType: SpecialistType,
    toType: SpecialistType,
    playerId: string
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot change specialist: city ${cityId} not found`);
      return;
    }

    if (city.playerId !== playerId) {
      logger.warn(`Cannot change specialist: city ${cityId} not owned by player ${playerId}`);
      return;
    }

    if (city.specialists[fromType] <= 0) {
      logger.warn(`Cannot change specialist: no ${fromType} specialists in city ${cityId}`);
      return;
    }

    // Make the change
    city.specialists[fromType] -= 1;
    city.specialists[toType] += 1;

    // Recalculate city outputs
    this.calculateCityOutputs(cityId);
  }

  // === PRODUCTION QUEUE MANAGEMENT ===

  async addToWorklist(cityId: string, items: ProductionItem[]): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      return;
    }

    // Validate each item can be built by this city
    const validItems = items.filter(item => {
      // Filter out wonder types for now since they're not supported in canCityQueueItem
      if (item.kind === 'wonder') {
        return false;
      }
      return this.canCityQueueItem(city, item.kind, item.value);
    });

    city.worklist.push(...validItems);
  }

  private canCityQueueItem(city: CityState, kind: 'unit' | 'building', value: string): boolean {
    if (kind === 'building') {
      // Check if building already exists
      if (city.buildings.includes(value)) {
        return false;
      }

      // Check if building type exists
      return BUILDING_TYPES[value] !== undefined;
    } else if (kind === 'unit') {
      return Object.values(UNIT_TYPES).some(unitType => unitType.id === value);
    }

    return false;
  }

  // === DATABASE OPERATIONS ===

  async loadCities(): Promise<void> {
    try {
      const db = this.databaseProvider.getDatabase();
      const cityRecords = await db.select().from(cities).where(eq(cities.gameId, this.gameId));

      this.cities.clear();

      for (const record of cityRecords) {
        const city: CityState = {
          id: record.id,
          name: record.name,
          x: record.x,
          y: record.y,
          playerId: record.playerId,
          population: record.population,
          size: record.population,
          cityRadius: CITY_MAP_DEFAULT_RADIUS,
          founded: record.foundedTurn || 1,
          currentProduction: record.currentProduction,
          productionType: null, // Will be derived from currentProduction if needed
          turnsToComplete: 0, // Will be calculated
          foodStock: record.food || 0,
          foodPerTurn: record.foodPerTurn || 0,
          productionPerTurn: record.productionPerTurn || 0,
          tradePerTurn: 0, // Will be calculated from trade routes
          sciencePerTurn: record.sciencePerTurn || 0, // Will be recalculated
          shieldStock: record.production || 0, // Use shieldStock consistently
          history: record.history || 0, // Culture history
          buildings: (record.buildings as string[]) || [],
          specialists: (record.specialists as Record<SpecialistType, number>) || {
            [SpecialistType.SCIENTIST]: 0,
            [SpecialistType.TAX_COLLECTOR]: 0,
            [SpecialistType.ENTERTAINER]: 0,
            [SpecialistType.WORKER]: 0,
            [SpecialistType.ENGINEER]: 0,
            [SpecialistType.MERCHANT]: 0,
          },
          tradeRoutes: [], // Will be loaded from separate table if implemented
          happiness: {
            happy: 0,
            content: Math.max(0, record.population - 1),
            unhappy: record.happiness < 0 ? Math.abs(record.happiness) : 0,
            angry: 0,
          },
          worklist: (record.productionQueue as ProductionItem[]) || [],
          defenseStrength: record.defenseStrength || 1,
        };

        this.cities.set(city.id, city);

        // Initialize workable tiles for loaded cities
        this.initializeWorkableTilesForLoadedCity(
          city,
          record.workedTiles as Array<{ x: number; y: number }> | null
        );

        // Calculate city outputs to ensure all values are properly set
        this.calculateCityOutputs(city.id);
      }
    } catch (error) {
      logger.error('Failed to load cities from database', {
        gameId: this.gameId,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  private async saveCityToDatabase(city: CityState): Promise<void> {
    try {
      const db = this.databaseProvider.getDatabase();

      const cityData = {
        id: city.id,
        gameId: this.gameId,
        name: city.name,
        x: city.x,
        y: city.y,
        playerId: city.playerId,
        population: city.population,
        foundedTurn: city.founded || 1,
        currentProduction: city.currentProduction,
        food: city.foodStock || 0,
        foodPerTurn: city.foodPerTurn || 0,
        production: city.shieldStock || 0,
        productionPerTurn: city.productionPerTurn || 0,
        goldPerTurn: 0, // Will be calculated
        sciencePerTurn: 0, // Will be calculated
        culturePerTurn: 0, // Will be calculated
        faithPerTurn: 0, // Will be calculated
        history: city.history || 0, // Culture history
        buildings: city.buildings,
        specialists: city.specialists,
        productionQueue: city.worklist,
        happiness: city.happiness.content - city.happiness.unhappy, // Simplified happiness mapping
        defenseStrength: city.defenseStrength || 1,
        // Default values for other required fields
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        wallsLevel: 0,
        workedTiles:
          city.workableTiles?.filter(t => t.isWorked).map(t => ({ x: t.x, y: t.y })) || [],
      };

      // Use upsert pattern that works in both production and test environments
      const dbOperation = async () => {
        try {
          // Try insert first
          await db.insert(cities).values([cityData]);
        } catch (error: any) {
          // If constraint violation (PostgreSQL or SQLite), try update instead
          if (
            error?.code === 'SQLITE_CONSTRAINT' ||
            error?.constraint === 'PRIMARY' ||
            error?.code === '23505' || // PostgreSQL unique violation
            (error?.message && error.message.includes('duplicate key'))
          ) {
            await db.update(cities).set(cityData).where(eq(cities.id, city.id));
          } else {
            throw error;
          }
        }
      };

      // Apply timeout in all environments to prevent database hangs
      const DB_OPERATION_TIMEOUT = process.env.NODE_ENV === 'test' ? 5000 : 10000; // 5s for tests, 10s for production

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `Database operation timed out for city ${city.id} after ${DB_OPERATION_TIMEOUT}ms`
            )
          );
        }, DB_OPERATION_TIMEOUT);
      });

      await Promise.race([dbOperation(), timeoutPromise]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to save city to database', {
        cityId: city.id,
        cityName: city.name,
        gameId: this.gameId,
        error: errorMessage,
        isTimeout: errorMessage.includes('timed out'),
      });

      // In production, we should be more resilient - log the error but don't crash the turn processing
      // Only throw in non-timeout cases that might be recoverable
      if (!errorMessage.includes('timed out')) {
        throw error;
      } else {
        logger.warn('Database timeout occurred, continuing with turn processing', {
          cityId: city.id,
          cityName: city.name,
        });
      }
    }
  }

  async processAllCitiesTurn(currentTurn: number): Promise<void> {
    const cityPromises = Array.from(this.cities.keys()).map(cityId =>
      this.processCityTurn(cityId, currentTurn)
    );

    try {
      await Promise.all(cityPromises);
    } catch (error) {
      logger.error('Error processing cities turn', {
        currentTurn,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  // === CALCULATION METHODS ===

  public calculateCorruption(
    cityId: string,
    distanceToCapital: number,
    governmentType: string = 'despotism'
  ): number {
    const city = this.cities.get(cityId);
    if (!city) return 0;

    // Basic corruption calculation based on distance and government
    const baseCorruption = Math.floor(distanceToCapital / 10);
    const governmentModifier = this.getGovernmentCorruptionModifier(governmentType);

    return Math.floor(baseCorruption * governmentModifier);
  }

  private getGovernmentCorruptionModifier(governmentType: string): number {
    const modifiers: Record<string, number> = {
      despotism: 1.0,
      monarchy: 0.8,
      republic: 0.6,
      democracy: 0.4,
      communism: 0.9,
    };
    return modifiers[governmentType] || 1.0;
  }

  public calculateDetailedHappiness(cityId: string): {
    stage: number;
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
    luxuryEffect: number;
    buildingEffect: number;
    unitEffect: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        stage: FEELING_FINAL,
        happy: 0,
        content: 0,
        unhappy: 0,
        angry: 0,
        luxuryEffect: 0,
        buildingEffect: 0,
        unitEffect: 0,
      };
    }

    // Start with base population happiness
    const happy = 0;
    let content = Math.max(0, city.population - 1); // Population minus unhappy citizens
    let unhappy = Math.min(1, city.population); // Base unhappiness
    const angry = 0;

    // Apply luxury specialist effects
    const luxurySpecialists = city.specialists[SpecialistType.ENTERTAINER] || 0;
    const luxuryEffect =
      luxurySpecialists * SPECIALIST_TYPES[SpecialistType.ENTERTAINER].outputAmount;

    // Apply building effects
    let buildingEffect = 0;
    for (const building of city.buildings) {
      const buildingId = typeof building === 'string' ? building : building.id;
      const buildingType = BUILDING_TYPES[buildingId];
      if (buildingType && buildingType.effects.happinessEffect) {
        buildingEffect += buildingType.effects.happinessEffect;
      }
    }

    // Apply happiness effects
    const totalHappinessBonus = luxuryEffect + buildingEffect;
    const happinessToApply = Math.min(totalHappinessBonus, unhappy);

    unhappy = Math.max(0, unhappy - happinessToApply);
    content += happinessToApply;

    return {
      stage: FEELING_FINAL,
      happy,
      content,
      unhappy,
      angry,
      luxuryEffect,
      buildingEffect,
      unitEffect: 0, // Would be calculated based on military units
    };
  }

  public calculateHappiness(cityId: string): Happiness {
    const detailedHappiness = this.calculateDetailedHappiness(cityId);
    return {
      happy: detailedHappiness.happy,
      content: detailedHappiness.content,
      unhappy: detailedHappiness.unhappy,
      angry: detailedHappiness.angry,
    };
  }

  public isCityUnhappy(cityId: string): boolean {
    const happiness = this.calculateHappiness(cityId);
    return happiness.unhappy > 0 || happiness.angry > 0;
  }

  public getCityStateDescription(cityId: string): string {
    const city = this.cities.get(cityId);
    if (!city) return 'Unknown city';

    const happiness = this.calculateHappiness(cityId);
    const isUnhappy = happiness.unhappy > 0 || happiness.angry > 0;

    return `${city.name} (Pop: ${city.population}, ${isUnhappy ? 'Unhappy' : 'Content'})`;
  }

  private findNearestGovernmentCenter(city: CityState): CityState | null {
    let nearestCity: CityState | null = null;
    let shortestDistance = Infinity;

    for (const otherCity of this.cities.values()) {
      if (otherCity.playerId === city.playerId && otherCity.id !== city.id) {
        const distance = this.calculateSquaredDistance(city.x, city.y, otherCity.x, otherCity.y);
        if (distance < shortestDistance) {
          shortestDistance = distance;
          nearestCity = otherCity;
        }
      }
    }

    return nearestCity;
  }

  public applyCityCorruption(cityId: string, currentGovernment: string): void {
    const city = this.cities.get(cityId);
    if (!city) return;

    const capitalCity = this.findNearestGovernmentCenter(city);
    const distanceToCapital = capitalCity
      ? Math.sqrt(this.calculateSquaredDistance(city.x, city.y, capitalCity.x, capitalCity.y))
      : 0;

    const corruption = this.calculateCorruption(cityId, distanceToCapital, currentGovernment);

    // Apply corruption to trade income (simplified)
    const originalTrade = city.tradePerTurn || 0;
    city.tradePerTurn = Math.max(0, originalTrade - corruption);
  }

  public applyCityHappiness(cityId: string): void {
    const city = this.cities.get(cityId);
    if (!city) return;

    // Calculate and apply detailed happiness
    const detailedHappiness = this.calculateDetailedHappiness(cityId);
    city.happiness = {
      happy: detailedHappiness.happy,
      content: detailedHappiness.content,
      unhappy: detailedHappiness.unhappy,
      angry: detailedHappiness.angry,
    };
  }

  private calculateSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  public calculateCityOutputs(cityId: string): {
    food: number;
    shields: number;
    trade: number;
    science: number;
    gold: number;
    luxury: number;
  } {
    if (this.tileManagementService) {
      const tileOutputs = this.tileManagementService.calculateCityOutputs(cityId);

      // Add specialist contributions
      const city = this.cities.get(cityId);
      if (!city) {
        return { food: 0, shields: 0, trade: 0, science: 0, gold: 0, luxury: 0 };
      }

      // Provide city center base output for any missing essential outputs
      // Cities should always have at least city center production values from ruleset
      try {
        const civstyle = rulesetLoader.getCivstyle('classic');
        tileOutputs.food = Math.max(tileOutputs.food, civstyle.min_city_center_food);
        tileOutputs.shields = Math.max(tileOutputs.shields, civstyle.min_city_center_shield);
        tileOutputs.trade = Math.max(tileOutputs.trade, civstyle.min_city_center_trade);
      } catch {
        // Fallback to hardcoded values if ruleset loading fails
        tileOutputs.food = Math.max(tileOutputs.food, 2);
        tileOutputs.shields = Math.max(tileOutputs.shields, 1);
        tileOutputs.trade = Math.max(tileOutputs.trade, 1);
      }

      let science = 0;
      let gold = 0;
      let luxury = 0;

      // Convert trade to science and gold (simplified economics)
      // In a full implementation, this would be based on government type and city settings
      // Ensure at least 1 science for any city with trade
      const tradeToScience =
        tileOutputs.trade > 0 ? Math.max(1, Math.floor(tileOutputs.trade / 2)) : 0;
      const tradeToGold = Math.max(0, tileOutputs.trade - tradeToScience);
      science += tradeToScience;
      gold += tradeToGold;

      // Add specialist outputs
      for (const [specialistType, count] of Object.entries(city.specialists)) {
        const type = parseInt(specialistType) as SpecialistType;
        const definition = SPECIALIST_TYPES[type];
        const amount = count * definition.outputAmount;

        switch (definition.outputType) {
          case 'science':
            science += amount;
            break;
          case 'gold':
            gold += amount;
            break;
          case 'luxury':
            luxury += amount;
            break;
          case 'food':
            tileOutputs.food += amount;
            break;
          case 'shield':
            tileOutputs.shields += amount;
            break;
          case 'trade':
            tileOutputs.trade += amount;
            break;
        }
      }

      // Update city state with defensive programming to ensure no undefined values
      city.foodPerTurn = tileOutputs.food || 0;
      city.productionPerTurn = tileOutputs.shields || 0;
      city.tradePerTurn = tileOutputs.trade || 0;
      city.sciencePerTurn = science || 0;

      return {
        food: tileOutputs.food,
        shields: tileOutputs.shields,
        trade: tileOutputs.trade,
        science,
        gold,
        luxury,
      };
    }

    // Fallback calculation when TileManagementService is not available
    const city = this.cities.get(cityId);
    if (city) {
      try {
        const civstyle = rulesetLoader.getCivstyle('classic');
        // Apply fallback outputs from ruleset
        city.foodPerTurn = civstyle.min_city_center_food;
        city.productionPerTurn = civstyle.min_city_center_shield;
        city.tradePerTurn = civstyle.min_city_center_trade;

        // Calculate science from trade even in fallback mode
        const tradeToScience =
          city.tradePerTurn > 0 ? Math.max(1, Math.floor(city.tradePerTurn / 2)) : 0;
        city.sciencePerTurn = tradeToScience;

        return {
          food: civstyle.min_city_center_food,
          shields: civstyle.min_city_center_shield,
          trade: civstyle.min_city_center_trade,
          science: tradeToScience,
          gold: 0,
          luxury: 0,
        };
      } catch {
        // Double fallback to hardcoded classic values
        city.foodPerTurn = 2;
        city.productionPerTurn = 1;
        city.tradePerTurn = 1;
        city.sciencePerTurn = 1;
      }
    }
    return { food: 2, shields: 1, trade: 1, science: 1, gold: 0, luxury: 0 };
  }

  public refreshCityWithGovernmentEffects(cityId: string): void {
    // In a full implementation, this would get the current government from the game state
    const defaultGovernment = 'despotism';

    // Recalculate city outputs first to ensure they're current
    this.calculateCityOutputs(cityId);

    this.applyCityCorruption(cityId, defaultGovernment);
    this.applyCityHappiness(cityId);
  }

  // === CITIZEN OPTIMIZATION METHODS ===

  /**
   * Optimize citizen assignments for a city using the CitizenManagement system
   * @param cityId The city to optimize
   * @param parameters Optional optimization parameters (uses default if not provided)
   */
  private async optimizeCitizens(cityId: string, parameters?: any): Promise<boolean> {
    if (!this.citizenManagementService || !this.tileManagementService) {
      logger.warn(`Cannot optimize citizens for city ${cityId} - services not available`);
      return false;
    }

    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot optimize citizens - city ${cityId} not found`);
      return false;
    }

    try {
      // Use provided parameters, or stored parameters, or default parameters
      const optimizationParams =
        parameters || this.getCitizenParameters(cityId) || CitizenParameterFactory.createDefault();

      // Get workable tiles for the optimization
      const workableTiles = this.tileManagementService.getWorkableTiles(cityId);
      if (!workableTiles) {
        logger.warn(`Cannot optimize citizens - no workable tiles for city ${cityId}`);
        return false;
      }

      // Run the optimization
      const result = this.citizenManagementService.queryResult(
        city,
        optimizationParams,
        false // Don't allow negative surpluses
      );

      if (result.found_valid) {
        // Apply the optimized assignments
        if (city.workableTiles) {
          // Update worked tile assignments
          for (
            let i = 0;
            i < result.worker_positions.length && i < city.workableTiles.length;
            i++
          ) {
            city.workableTiles[i].isWorked = result.worker_positions[i];
          }
        }

        // Update specialist assignments
        city.specialists = { ...result.specialists };

        // Update output calculations based on optimized assignments
        city.foodPerTurn = result.surplus[OutputType.FOOD];
        city.productionPerTurn = result.surplus[OutputType.SHIELD];
        city.tradePerTurn = result.surplus[OutputType.TRADE];
        city.sciencePerTurn = result.surplus[OutputType.SCIENCE];

        logger.debug(`Successfully optimized citizens for city ${city.name}`, {
          cityId,
          fitness: result.fitness,
          workersCount: result.workers_count,
          specialistsCount: result.specialists_count,
        });

        return true;
      } else {
        logger.warn(`Citizen optimization failed for city ${city.name}`, {
          cityId,
          aborted: result.aborted,
        });
        return false;
      }
    } catch (error) {
      logger.error(`Error optimizing citizens for city ${city.name}`, {
        cityId,
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Public method to manually optimize a city's citizens
   * @param cityId The city to optimize
   * @param parameters Optional optimization parameters
   */
  async optimizeCityManually(cityId: string, parameters?: any): Promise<boolean> {
    return this.optimizeCitizens(cityId, parameters);
  }

  /**
   * Get citizen optimization parameters for a city (for UI configuration)
   * @param cityId The city to get parameters for
   */
  getCitizenParameters(cityId: string): any | null {
    const city = this.cities.get(cityId);
    if (!city) return null;

    // Check if city has stored citizen parameters
    if (city.governor && (city.governor as any).citizenParameters) {
      return (city.governor as any).citizenParameters;
    }

    // Return default parameters if none stored
    return CitizenParameterFactory.createDefault();
  }

  /**
   * Set citizen optimization parameters for a city
   * @param cityId The city to set parameters for
   * @param parameters The optimization parameters to set
   */
  setCitizenParameters(cityId: string, parameters: any): boolean {
    const city = this.cities.get(cityId);
    if (!city) return false;

    // For now, we'll store parameters in the city's governor settings
    // In the future, we might add a dedicated citizen management config
    if (!city.governor) {
      city.governor = {
        isEnabled: false,
        priority: GovernorPriority.BALANCED,
        settings: {
          autoManageSpecialists: true,
          autoManageTiles: true,
          autoManageProduction: false,
          preventStarvation: true,
          maintainHappiness: true,
        },
      };
    }

    // Store citizen parameters in a way that doesn't break the interface
    // We'll extend the governor with additional data for now
    (city.governor as any).citizenParameters = parameters;

    return true;
  }

  // === SERVICE DELEGATION METHODS ===

  // Delegate to tile management service
  async assignCitizenToTile(cityId: string, tileX: number, tileY: number): Promise<boolean> {
    if (!this.tileManagementService) return false;
    return this.tileManagementService.assignCitizenToTile(cityId, tileX, tileY);
  }

  async convertTileWorkerToSpecialist(
    cityId: string,
    tileX: number,
    tileY: number,
    specialistType: SpecialistType
  ): Promise<boolean> {
    if (!this.tileManagementService) return false;
    return this.tileManagementService.convertTileWorkerToSpecialist(
      cityId,
      tileX,
      tileY,
      specialistType
    );
  }

  getWorkableTiles(cityId: string): WorkableTile[] | null {
    if (!this.tileManagementService) return null;
    return this.tileManagementService.getWorkableTiles(cityId);
  }

  // Delegate to building service
  canCityBuildBuilding(cityId: string, buildingId: string): boolean {
    if (!this.buildingService) return false;
    return this.buildingService.canCityBuildBuilding(cityId, buildingId);
  }

  async startBuildingConstruction(cityId: string, buildingId: string): Promise<boolean> {
    if (!this.buildingService) return false;
    return this.buildingService.startBuildingConstruction(cityId, buildingId);
  }

  async sellBuilding(cityId: string, buildingId: string): Promise<boolean> {
    if (!this.buildingService) return false;
    return this.buildingService.sellBuilding(cityId, buildingId);
  }

  calculateBuildingMaintenanceCost(cityId: string): number {
    if (!this.buildingService) return 0;
    return this.buildingService.calculateBuildingMaintenanceCost(cityId);
  }

  // Delegate to trade route service
  async establishTradeRoute(
    sourceCityId: string,
    partnerCityId: string,
    playerId: string = 'default'
  ): Promise<boolean> {
    if (!this.tradeRouteService) return false;
    return this.tradeRouteService.establishTradeRoute(sourceCityId, partnerCityId, playerId);
  }

  calculateTradeRouteValue(sourceCityId: string, partnerCityId: string): number {
    if (!this.tradeRouteService) return 0;
    // Get city objects for the service call
    const sourceCity = this.cities.get(sourceCityId);
    const partnerCity = this.cities.get(partnerCityId);
    if (!sourceCity || !partnerCity) return 0;
    const calculation = this.tradeRouteService.calculateTradeRouteValue(sourceCity, partnerCity);
    return calculation.totalValue;
  }

  getCityTradeRouteRevenue(cityId: string): number {
    if (!this.tradeRouteService) return 0;
    return this.tradeRouteService.getCityTradeRouteRevenue(cityId);
  }

  async removeTradeRoute(sourceCityId: string, partnerCityId: string): Promise<boolean> {
    if (!this.tradeRouteService) return false;
    return this.tradeRouteService.removeTradeRoute(sourceCityId, partnerCityId);
  }

  // Delegate to production service
  calculateBuyCost(cityId: string): {
    canBuy: boolean;
    goldCost: number;
    shieldsRemaining: number;
    reason?: string;
  } {
    if (!this.productionService)
      return { canBuy: false, goldCost: 0, shieldsRemaining: 0, reason: 'Service not available' };
    return this.productionService.calculateBuyCost(cityId);
  }

  async buyProduction(
    cityId: string,
    playerId: string
  ): Promise<{ success: boolean; goldSpent: number; completed: boolean; reason?: string }> {
    if (!this.productionService)
      return { success: false, goldSpent: 0, completed: false, reason: 'Service not available' };
    return this.productionService.buyProduction(cityId, playerId);
  }

  // Delegate to governor service
  async configureCityGovernor(
    cityId: string,
    playerId: string,
    config: {
      enabled: boolean;
      priority: GovernorPriority;
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    }
  ): Promise<boolean> {
    if (!this.governorService) return false;
    return this.governorService.configureCityGovernor(cityId, playerId, config);
  }

  getCityGovernorInfo(cityId: string): CityGovernor | null {
    if (!this.governorService) return null;
    return this.governorService.getCityGovernorInfo(cityId);
  }

  // Delegate to capture service
  async captureCity(
    cityId: string,
    conquerorPlayerId: string,
    conquerorUnitId: string
  ): Promise<{
    success: boolean;
    populationLoss: number;
    buildingsDestroyed: string[];
    reason?: string;
  }> {
    if (!this.captureService)
      return {
        success: false,
        populationLoss: 0,
        buildingsDestroyed: [],
        reason: 'Service not available',
      };
    return this.captureService.captureCity(cityId, conquerorPlayerId, conquerorUnitId);
  }

  async transferCity(cityId: string, newPlayerId: string): Promise<boolean> {
    if (!this.captureService) return false;
    return this.captureService.transferCity(cityId, newPlayerId);
  }

  // === UTILITY METHODS ===

  private async updateTradeRoutesOnPlayerChange(
    _cityId: string,
    _newPlayerId: string,
    _oldPlayerId: string
  ): Promise<void> {
    if (this.tradeRouteService) {
      // TODO: Implement trade route updates when service is available
      // this.tradeRouteService.updateRoutesOnPlayerChange(cityId, newPlayerId, oldPlayerId);
    }
  }

  async destroyCity(cityId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) return false;

    // Remove from memory
    this.cities.delete(cityId);

    // Remove from database
    try {
      const db = this.databaseProvider.getDatabase();
      await db.delete(cities).where(eq(cities.id, cityId));
    } catch (error) {
      logger.error('Failed to delete city from database', { cityId, error });
    }

    // Update trade routes
    if (this.tradeRouteService) {
      // This would be implemented to clean up trade routes
    }

    // Trigger callback
    if (this.callbacks.onCityDestroyed) {
      this.callbacks.onCityDestroyed(city);
    }

    return true;
  }

  async renameCity(cityId: string, newName: string, playerId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) return false;

    if (city.playerId !== playerId) return false;

    city.name = newName;

    await this.saveCityToDatabase(city);

    return true;
  }

  // === QUERY METHODS ===

  public getPlayerCities(playerId: string): CityState[] {
    return Array.from(this.cities.values()).filter(city => city.playerId === playerId);
  }

  public getPlayerCityCount(playerId: string): number {
    return this.getPlayerCities(playerId).length;
  }

  public canPlayerSupportMoreCities(playerId: string): boolean {
    // Simplified logic - in full game would consider government type,
    // technologies, and other factors
    const currentCityCount = this.getPlayerCityCount(playerId);
    return currentCityCount < 50; // Arbitrary limit
  }

  // === GETTERS ===

  public getCity(cityId: string): CityState | undefined {
    return this.cities.get(cityId);
  }

  public getAllCities(): CityState[] {
    return Array.from(this.cities.values());
  }

  public getCityCount(): number {
    return this.cities.size;
  }

  // Get the specialized services for direct access if needed
  public getManagementService(): CityManagementService | undefined {
    return this.managementService;
  }

  public getTileManagementService(): CityTileManagementService | undefined {
    return this.tileManagementService;
  }

  public getBuildingService(): CityBuildingService | undefined {
    return this.buildingService;
  }

  public getTradeRouteService(): CityTradeRouteService | undefined {
    return this.tradeRouteService;
  }

  public getProductionService(): CityProductionService | undefined {
    return this.productionService;
  }

  public getGovernorService(): CityGovernorService | undefined {
    return this.governorService;
  }

  public getCaptureService(): CityCaptureService | undefined {
    return this.captureService;
  }

  // === ESSENTIAL COMPATIBILITY METHODS ===
  // Only the methods that are actually used by other parts of the system

  /**
   * Cleanup method - used by GameLifecycleManager
   */
  /**
   * Set city production to a specific unit or building
   * @reference freeciv-web city.js city_change_production()
   */
  async setCityProduction(
    cityId: string,
    production: string,
    type: 'unit' | 'building' | 'wonder'
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    // Store previous production for shield carry-over calculation
    const previousProduction = city.currentProduction;
    const previousType = city.productionType;
    const previousProgress = city.shieldStock || 0;

    // Set new production
    city.currentProduction = production;
    city.productionType = type as 'unit' | 'building';

    // Calculate shield carry-over based on Freeciv rules
    let carryOverShields = 0;
    if (previousProduction && previousType && previousProgress > 0) {
      // Only partial carry-over when changing production type
      if (previousType === type) {
        carryOverShields = Math.floor(previousProgress * 0.5); // 50% carry-over for same type
      } else {
        carryOverShields = Math.floor(previousProgress * 0.25); // 25% carry-over for different type
      }
    }

    city.shieldStock = carryOverShields;

    // Calculate new production cost and turns to complete
    const productionCost = this.getProductionCost(production, type);
    const shieldsPerTurn = city.shieldsPerTurn || 1;
    const remainingShields = Math.max(0, productionCost - city.shieldStock);
    city.turnsToComplete = remainingShields > 0 ? Math.ceil(remainingShields / shieldsPerTurn) : 0;

    logger.debug('City production changed', {
      cityId,
      cityName: city.name,
      production,
      type,
      previousProduction,
      previousType,
      carryOverShields,
      newShieldStock: city.shieldStock,
      productionCost,
      turnsToComplete: city.turnsToComplete,
    });

    // Persist to database
    await this.persistCityProductionToDatabase(city);
  }

  /**
   * Check if a city can build a specific unit or building
   * @reference freeciv-web city.js can_city_build_now()
   */
  async canCityBuild(
    cityId: string,
    production: string,
    type: 'unit' | 'building' | 'wonder'
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    try {
      if (type === 'unit') {
        // Check if unit type exists and city can build it
        const unitType = UNIT_TYPES[production];
        if (!unitType) {
          logger.warn(`Unknown unit type: ${production}`);
          return false;
        }

        // Basic checks - can be expanded with tech requirements, resources, etc.
        return true;
      } else if (type === 'building') {
        // Check if building type exists and city can build it
        const building = this.buildingTypes[production];
        if (!building) {
          logger.warn(`Unknown building type: ${production}`);
          return false;
        }

        // Check if building already exists in city
        if (city.buildings?.some(b => (typeof b === 'string' ? b : b.id) === production)) {
          logger.debug(`City already has building: ${production}`);
          return false;
        }

        // Basic checks - can be expanded with tech requirements, resources, etc.
        return true;
      } else if (type === 'wonder') {
        // Wonder validation logic would go here
        // For now, allow all wonders
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking if city can build production', {
        error,
        cityId,
        production,
        type,
      });
      return false;
    }
  }

  /**
   * Get production cost for a specific unit, building, or wonder
   * @reference freeciv-web city.js get_production_cost()
   */
  private getProductionCost(production: string, type: 'unit' | 'building' | 'wonder'): number {
    if (type === 'unit') {
      const unitType = UNIT_TYPES[production];
      return unitType?.cost || 10;
    } else if (type === 'building') {
      const building = this.buildingTypes[production];
      return building?.cost || 40;
    } else if (type === 'wonder') {
      // Wonder costs - would come from ruleset data
      const wonderCosts: Record<string, number> = {
        pyramids: 200,
        lighthouse: 200,
        oracle: 300,
        colossus: 200,
        'hanging-gardens': 200,
        'great-library': 300,
      };
      return wonderCosts[production] || 200;
    }
    return 10;
  }

  /**
   * Process city turn - handle production completion and unit/building creation
   * @reference freeciv-web city.js city_production_complete() and handle_city_info()
   */
  async processCityTurn(cityId: string, currentTurn: number): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn('City not found for turn processing', { cityId });
      return;
    }

    // Calculate current shield production per turn
    const shieldsPerTurn = city.shieldsPerTurn || city.prod?.shields || 1;

    // Add shields to stock
    city.shieldStock = (city.shieldStock || 0) + shieldsPerTurn;

    // Check if production is complete
    if (city.currentProduction && city.productionType) {
      const productionCost = this.getProductionCost(city.currentProduction, city.productionType);

      if (city.shieldStock >= productionCost) {
        await this.completeProduction(city, currentTurn);
      } else {
        // Update turns to complete
        const remainingShields = productionCost - city.shieldStock;
        city.turnsToComplete = Math.ceil(remainingShields / Math.max(1, shieldsPerTurn));
      }
    }

    // Process city growth (food)
    await this.processCityGrowth(city);

    // Process city happiness and disorder
    this.processCityHappiness(city);

    // Persist changes to database
    await this.persistCityTurnToDatabase(city, currentTurn);

    logger.debug('City turn processed', {
      cityId,
      cityName: city.name,
      shieldStock: city.shieldStock,
      turnsToComplete: city.turnsToComplete,
      population: city.size,
    });
  }

  /**
   * Complete production when shields meet the requirement
   * @reference freeciv-web city.js city_production_complete()
   */
  private async completeProduction(city: CityState, currentTurn: number): Promise<void> {
    if (!city.currentProduction || !city.productionType) {
      return;
    }

    const productionCost = this.getProductionCost(city.currentProduction, city.productionType);

    // Consume shields for production
    city.shieldStock = (city.shieldStock || 0) - productionCost;

    logger.info('Production completed', {
      cityId: city.id,
      cityName: city.name,
      production: city.currentProduction,
      type: city.productionType,
      cost: productionCost,
      remainingShields: city.shieldStock,
    });

    if (city.productionType === 'unit') {
      await this.createUnit(city, city.currentProduction, currentTurn);
    } else if (city.productionType === 'building') {
      await this.createBuilding(city, city.currentProduction);
    }

    // Start next production if there's a worklist
    await this.startNextProduction(city);
  }

  /**
   * Create a unit when unit production completes
   * @reference freeciv-web city.js create_unit_full()
   */
  private async createUnit(city: CityState, unitType: string, currentTurn: number): Promise<void> {
    try {
      // Find a valid position to place the unit (city center first)
      const spawnPosition = this.findUnitSpawnPosition(city.x, city.y);

      if (!spawnPosition) {
        logger.warn('No valid position found for unit spawn, unit lost', {
          cityId: city.id,
          cityName: city.name,
          unitType,
        });
        return;
      }

      // Create unit through UnitManager if available
      if (this.unitManager) {
        const unit = await this.unitManager.createUnit({
          playerId: city.playerId,
          unitTypeId: unitType,
          x: spawnPosition.x,
          y: spawnPosition.y,
          homeCityId: city.id,
          createdTurn: currentTurn,
        });

        logger.info('Unit created from city production', {
          cityId: city.id,
          cityName: city.name,
          unitType,
          unitId: unit.id,
          position: spawnPosition,
        });

        // Broadcast unit creation to players
        if (this.broadcastToGame) {
          this.broadcastToGame(this.gameId, 'unit_created', {
            gameId: this.gameId,
            unitId: unit.id,
            unit: unit, // Include full unit data for client
            playerId: city.playerId,
            unitType,
            x: spawnPosition.x,
            y: spawnPosition.y,
            fromCity: city.id,
            production: true,
          });
        }
      } else {
        logger.warn('UnitManager not available for unit creation');
      }
    } catch (error) {
      logger.error('Failed to create unit from production', {
        error,
        cityId: city.id,
        unitType,
      });
    }
  }

  /**
   * Find a valid position to spawn a unit near the city
   * @reference freeciv-web city.js find_city_tile()
   */
  private findUnitSpawnPosition(centerX: number, centerY: number): { x: number; y: number } | null {
    // Try city center first
    if (this.isValidUnitSpawnPosition(centerX, centerY)) {
      return { x: centerX, y: centerY };
    }

    // Try adjacent tiles in spiral pattern
    const directions = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: -1, dy: -1 },
    ];

    for (const dir of directions) {
      const x = centerX + dir.dx;
      const y = centerY + dir.dy;

      if (this.isValidUnitSpawnPosition(x, y)) {
        return { x, y };
      }
    }

    // Try extended radius
    for (let radius = 2; radius <= 3; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const x = centerX + dx;
          const y = centerY + dy;

          if (this.isValidUnitSpawnPosition(x, y)) {
            return { x, y };
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if a position is valid for unit spawning
   */
  private isValidUnitSpawnPosition(x: number, y: number): boolean {
    // Basic validation - would be enhanced with map terrain checks
    if (this.mapManager) {
      const tile = this.mapManager.getTile(x, y);
      if (!tile) return false;

      // Don't spawn on water for land units (simplified check)
      if (tile.terrain === 'ocean') return false;

      // Check if tile is already occupied by another unit
      if (this.unitManager) {
        const unitsAtTile = this.unitManager.getUnitsAtPosition(x, y);
        if (unitsAtTile.length > 0) return false;
      }

      return true;
    }

    // Fallback: assume position is valid if we can't check
    return true;
  }

  /**
   * Create a building when building production completes
   * @reference freeciv-web city.js city_building_complete()
   */
  private async createBuilding(city: CityState, buildingType: string): Promise<void> {
    try {
      // Add building to city
      if (!city.buildings) {
        city.buildings = [];
      }

      // Avoid duplicates
      const existingBuilding = city.buildings.find(b =>
        typeof b === 'string' ? b === buildingType : b.id === buildingType
      );

      if (!existingBuilding) {
        city.buildings.push({
          id: buildingType,
          name: buildingType,
          upkeep: this.buildingTypes[buildingType]?.upkeep || 0,
        });

        logger.info('Building completed', {
          cityId: city.id,
          cityName: city.name,
          buildingType,
          totalBuildings: city.buildings.length,
        });

        // Broadcast building creation
        if (this.broadcastToGame) {
          this.broadcastToGame(this.gameId, 'building_created', {
            gameId: this.gameId,
            cityId: city.id,
            playerId: city.playerId,
            buildingType,
            production: true,
          });
        }
      } else {
        logger.warn('Building already exists, production wasted', {
          cityId: city.id,
          buildingType,
        });
      }
    } catch (error) {
      logger.error('Failed to create building from production', {
        error,
        cityId: city.id,
        buildingType,
      });
    }
  }

  /**
   * Start next production from worklist or default
   */
  private async startNextProduction(city: CityState): Promise<void> {
    // Check if there's a worklist with next item
    if (city.worklist && city.worklist.length > 0) {
      const nextItem = city.worklist.shift(); // Remove first item
      if (nextItem) {
        city.currentProduction = nextItem.target || nextItem.production;
        city.productionType = nextItem.type as 'unit' | 'building';

        const productionCost = city.currentProduction
          ? this.getProductionCost(city.currentProduction, city.productionType)
          : 0;
        const shieldsPerTurn = city.shieldsPerTurn || 1;
        city.turnsToComplete = Math.ceil(
          (productionCost - (city.shieldStock || 0)) / Math.max(1, shieldsPerTurn)
        );

        logger.debug('Started next production from worklist', {
          cityId: city.id,
          production: city.currentProduction,
          type: city.productionType,
        });

        return;
      }
    }

    // No worklist - default to basic unit or building
    // This could be enhanced to be smarter based on city needs
    city.currentProduction = 'warrior'; // Default to warrior
    city.productionType = 'unit';

    const productionCost = this.getProductionCost(city.currentProduction, city.productionType);
    const shieldsPerTurn = city.shieldsPerTurn || 1;
    city.turnsToComplete = Math.ceil(
      (productionCost - (city.shieldStock || 0)) / Math.max(1, shieldsPerTurn)
    );

    logger.debug('Started default production', {
      cityId: city.id,
      production: city.currentProduction,
      type: city.productionType,
    });
  }

  /**
   * Process city growth (food consumption and population growth)
   */
  private async processCityGrowth(city: CityState): Promise<void> {
    // foodPerTurn in tests represents the net surplus/deficit, not gross production
    const foodSurplus = city.foodPerTurn || city.prod?.food || 0;

    city.foodStock = (city.foodStock || 0) + foodSurplus;

    // Check for growth
    const granarySize = this.calculateGranarySize(city.size);
    if (city.foodStock >= granarySize && foodSurplus > 0) {
      city.size += 1;
      city.population = city.size; // Keep population in sync
      city.foodStock -= granarySize;

      logger.info('City grew', {
        cityId: city.id,
        cityName: city.name,
        newSize: city.size,
        newPopulation: city.population,
        foodStock: city.foodStock,
      });
    }

    // Check for starvation
    if (city.foodStock < 0 && city.size > 1) {
      city.size -= 1;
      city.population = city.size; // Keep population in sync
      city.foodStock = 0;

      logger.warn('City shrunk due to starvation', {
        cityId: city.id,
        cityName: city.name,
        newSize: city.size,
        newPopulation: city.population,
      });
    }
  }

  /**
   * Process city happiness and disorder
   */
  private processCityHappiness(city: CityState): void {
    // Basic happiness calculation - can be enhanced
    const baseHappiness = Math.max(0, 4 - city.size); // Smaller cities are naturally happier
    const buildingBonus =
      city.buildings?.filter(b => (typeof b === 'string' ? b === 'temple' : b.id === 'temple'))
        .length || 0;

    const totalHappiness = baseHappiness + buildingBonus;
    const requiredHappiness = Math.max(0, city.size - 4);

    city.disorder = totalHappiness < requiredHappiness;
    city.celebrating = totalHappiness > requiredHappiness + 2;

    // Update citizens happiness breakdown
    if (!city.citizens) {
      city.citizens = { happy: 0, content: 0, unhappy: 0, angry: 0, specialists: {} };
    }

    city.citizens.happy = Math.min(totalHappiness, city.size);
    city.citizens.unhappy = Math.max(0, requiredHappiness - totalHappiness);
    city.citizens.content = city.size - city.citizens.happy - city.citizens.unhappy;
  }

  /**
   * Persist city turn results to database
   */
  private async persistCityTurnToDatabase(city: CityState, currentTurn: number): Promise<void> {
    try {
      if (!this.databaseProvider) {
        return;
      }

      await this.databaseProvider
        .getDatabase()
        .update(cities)
        .set({
          population: city.size,
          food: city.foodStock || 0,
          production: city.shieldStock || 0,
          currentProduction: city.currentProduction,
        })
        .where(eq(cities.id, city.id));
    } catch (error) {
      logger.error('Failed to persist city turn to database', {
        error,
        cityId: city.id,
        turn: currentTurn,
      });
    }
  }

  /**
   * Persist city production changes to database
   */
  private async persistCityProductionToDatabase(city: CityState): Promise<void> {
    try {
      if (!this.databaseProvider) {
        logger.warn('Database provider not available, skipping city production persistence');
        return;
      }

      await this.databaseProvider
        .getDatabase()
        .update(cities)
        .set({
          currentProduction: city.currentProduction,
          production: city.shieldStock || 0,
        })
        .where(eq(cities.id, city.id));

      logger.debug('City production persisted to database', {
        cityId: city.id,
        production: city.currentProduction,
        type: city.productionType,
      });
    } catch (error) {
      logger.error('Failed to persist city production to database', {
        error,
        cityId: city.id,
        production: city.currentProduction,
      });
    }
  }

  cleanup(): void {
    this.cities.clear();
  }

  /**
   * Get city at coordinates - used by GameLifecycleManager
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
   * Initializes workable tiles for a city loaded from database
   */
  private initializeWorkableTilesForLoadedCity(
    city: CityState,
    workedTiles: Array<{ x: number; y: number }> | null
  ): void {
    if (this.tileManagementService) {
      this.tileManagementService.initializeWorkableTiles(city);
      this.restoreWorkedTilesFromDatabase(city, workedTiles);
    } else {
      this.createFallbackWorkableTiles(city);
    }
  }

  /**
   * Restores worked tiles from database for a city
   */
  private restoreWorkedTilesFromDatabase(
    city: CityState,
    workedTiles: Array<{ x: number; y: number }> | null
  ): void {
    if (!workedTiles || !city.workableTiles) {
      return;
    }

    for (const workedTileCoord of workedTiles) {
      const tile = city.workableTiles.find(
        t => t.x === workedTileCoord.x && t.y === workedTileCoord.y
      );
      if (tile) {
        tile.isWorked = true;
      }
    }
  }

  /**
   * Creates fallback workable tiles when tile management service is unavailable
   */
  private createFallbackWorkableTiles(city: CityState): void {
    logger.warn(
      'TileManagementService not available for loaded city, providing fallback workable tiles',
      { cityId: city.id }
    );
    city.workableTiles = [
      {
        x: city.x,
        y: city.y,
        isCenter: true,
        isWorked: true,
        isBlocked: false,
        outputs: { food: 2, shields: 1, trade: 1 },
      },
    ];
  }
}
