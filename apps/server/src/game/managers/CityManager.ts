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
import { Server as SocketServer } from 'socket.io';

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

// Import the newly extracted services
import { CityTurnProcessingService } from '@game/services/CityTurnProcessingService';
import { CityCalculationService } from '@game/services/CityCalculationService';
import { CityHappinessService } from '@game/services/CityHappinessService';
import { CityOptimizationService } from '@game/services/CityOptimizationService';

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
  productionStock?: number;

  // Resources and storage
  foodStock?: number;
  foodPerTurn?: number;
  productionPerTurn?: number;
  tradePerTurn?: number;
  shieldStock?: number; // Stored shields
  sciencePerTurn?: number;

  // Culture system (freeciv-based)
  history: number; // Accumulated culture history

  // Buildings and specialists
  buildings: string[];
  specialists: Record<SpecialistType, number>;

  // Tile management
  workableTiles?: WorkableTile[];
  citizenAssignments?: Record<string, boolean>;

  // Trade and economics
  tradeRoutes: TradeRoute[];

  // Happiness and growth
  happiness: Happiness;

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
  requiredTech?: string;
  requires?: string[]; // Required buildings
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
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    cost: 40,
    effects: {
      defenseBonus: 50, // 50% defense bonus for new units
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
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void | Promise<void>;
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
  private io?: SocketServer; // Socket.IO server for emitting events
  private validationService?: CityFoundingValidationService;

  // Specialized services
  private managementService?: CityManagementService;
  private tileManagementService?: CityTileManagementService;
  private buildingService?: CityBuildingService;
  private tradeRouteService?: CityTradeRouteService;
  private productionService?: CityProductionService;
  private governorService?: CityGovernorService;
  private captureService?: CityCaptureService;
  private citizenManagementService?: CitizenManagementService;

  // Newly extracted services
  private turnProcessingService?: CityTurnProcessingService;
  private calculationService: CityCalculationService;
  private happinessService: CityHappinessService;
  private optimizationService?: CityOptimizationService;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    _effectsManager: EffectsManager, // Mark as unused with underscore
    callbacks: CityManagerCallbacks = {}
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.callbacks = callbacks;

    // Initialize services that don't have dependencies
    this.calculationService = new CityCalculationService();
    this.happinessService = new CityHappinessService();
  }

  /**
   * Set or update callbacks after initialization
   */
  setCallbacks(newCallbacks: Partial<CityManagerCallbacks>): void {
    this.callbacks = { ...this.callbacks, ...newCallbacks };
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

    // Initialize optimization service (will be fully initialized after setMapManager)
    this.optimizationService = new CityOptimizationService(
      this.cities,
      this.citizenManagementService
    );

    // Note: Turn processing service will be initialized in setMapManager when all dependencies are available

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

    // Update optimization service with tile management service
    if (this.optimizationService) {
      this.optimizationService.setTileManagementService(this.tileManagementService);
    }

    // Initialize turn processing service now that we have all dependencies
    this.turnProcessingService = new CityTurnProcessingService({
      gameId: this.gameId,
      cities: this.cities,
      callbacks: this.callbacks,
      io: this.io,
      governorService: this.governorService,
      tileManagementService: this.tileManagementService,
      refreshCityWithGovernmentEffects: this.refreshCityWithGovernmentEffects.bind(this),
      optimizeCitizens: this.optimizeCitizens.bind(this),
      calculateCityOutputs: this.calculateCityOutputs.bind(this),
      calculateHappiness: this.calculateHappiness.bind(this),
      saveCityToDatabase: this.saveCityToDatabase.bind(this),
    });
  }

  /**
   * Set the Socket.IO server for emitting events
   */
  setSocketServer(io: SocketServer): void {
    this.io = io;

    // Update turn processing service with socket server if it exists
    if (this.turnProcessingService) {
      // The service would need to support updating the io dependency
      // For now, we might need to reinitialize it if socket server is critical
      // This would require a method to update dependencies or proper dependency injection container
    }
  }

  /**
   * Get cities map for production handler access
   */
  getCitiesMap(): Map<string, CityState> {
    return this.cities;
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
      currentProduction: 'warriors', // Default production following Freeciv
      productionType: 'unit' as const,
      turnsToComplete: 10, // Warriors cost, will be recalculated
      productionStock: 0, // Shield stock for current production
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

  async processCityTurn(cityId: string, currentTurn: number): Promise<void> {
    if (!this.turnProcessingService) {
      logger.warn(`Cannot process city turn - turn processing service not available`);
      return;
    }

    // Delegate to CityTurnProcessingService for comprehensive turn processing
    await this.turnProcessingService.processCityTurn(cityId, currentTurn);
  }

  // === PUBLIC TESTING METHODS (delegating to services) ===

  /**
   * Calculate granary size for a given population - delegates to CityCalculationService
   * @param population City population
   * @param rulesetName Ruleset to use (defaults to 'classic')
   */
  public calculateGranarySize(population: number, rulesetName: string = 'classic'): number {
    return this.calculationService.calculateGranarySize(population, rulesetName);
  }

  /**
   * Process food and growth for a city - delegates to CityTurnProcessingService
   * This is exposed for testing compatibility
   */
  public async processFoodAndGrowth(city: any, currentTurn: number): Promise<void> {
    if (!this.turnProcessingService) {
      throw new Error('Turn processing service not available');
    }
    // Now properly delegate to the public method on the service
    return this.turnProcessingService.processFoodAndGrowth(city, currentTurn);
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

  async setCityProduction(
    cityId: string,
    productionType: 'unit' | 'building',
    productionId: string,
    playerId: string
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    // Validate production choice with specific error messages
    if (productionType === 'building') {
      if (city.buildings.includes(productionId)) {
        throw new Error(`Building already exists: ${productionId}`);
      }
      if (!BUILDING_TYPES[productionId]) {
        throw new Error(`Unknown building type: ${productionId}`);
      }
    } else if (productionType === 'unit') {
      if (!Object.values(UNIT_TYPES).some(unitType => unitType.id === productionId)) {
        throw new Error(`Unknown unit type: ${productionId}`);
      }
    }

    let productionCost = 0;
    if (productionType === 'unit') {
      const unitType = UNIT_TYPES[productionId];
      productionCost = unitType?.cost || 0;
    } else {
      const building = BUILDING_TYPES[productionId];
      productionCost = building?.cost || 0;
    }

    city.currentProduction = productionId;
    city.productionType = productionType;
    city.turnsToComplete = Math.ceil(productionCost / Math.max(1, city.productionPerTurn || 1));

    // Save changes to database
    await this.saveCityToDatabase(city);

    return true;
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
          history: record.history || 0, // Culture history
          productionStock: record.production || 0,
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
        production: city.productionStock || 0,
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

    // Delegate to CityCalculationService for corruption calculation
    return this.calculationService.calculateCorruption(distanceToCapital, governmentType);
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

    // Delegate to CityHappinessService for all happiness calculations
    return this.happinessService.calculateDetailedHappiness(city);
  }

  public calculateHappiness(cityId: string): Happiness {
    const city = this.cities.get(cityId);
    if (!city) {
      return { happy: 0, content: 0, unhappy: 0, angry: 0 };
    }

    // Delegate to CityHappinessService for happiness calculation
    return this.happinessService.calculateHappiness(city);
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

    // Delegate to CityHappinessService to apply happiness to city state
    this.happinessService.applyCityHappiness(city);
  }

  private calculateSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    // Delegate to CityCalculationService for distance calculation
    return this.calculationService.calculateSquaredDistance(x1, y1, x2, y2);
  }

  public calculateCityOutputs(cityId: string): {
    food: number;
    shields: number;
    trade: number;
    science: number;
    gold: number;
    luxury: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return { food: 0, shields: 0, trade: 0, science: 0, gold: 0, luxury: 0 };
    }

    // Delegate to CityCalculationService for all calculations
    const outputs = this.calculationService.calculateCityOutputs(
      city,
      undefined, // Let the service get tile outputs from tileManagementService
      this.tileManagementService
    );

    // Update city state with calculated outputs
    city.foodPerTurn = outputs.food;
    city.productionPerTurn = outputs.shields;
    city.tradePerTurn = outputs.trade;
    city.sciencePerTurn = outputs.science;

    return outputs;
  }

  public refreshCityWithGovernmentEffects(cityId: string): void {
    // In a full implementation, this would get the current government from the game state
    const defaultGovernment = 'despotism';

    // Recalculate city outputs first to ensure they're current
    this.calculateCityOutputs(cityId);

    this.applyCityCorruption(cityId, defaultGovernment);
    this.applyCityHappiness(cityId);
  }

  /**
   * Lightweight city refresh method that only recalculates outputs without government effects
   * Useful for frequent updates during turn processing
   */
  public refreshCityOutputs(cityId: string): void {
    this.calculateCityOutputs(cityId);
  }

  // === CITIZEN OPTIMIZATION METHODS ===

  /**
   * Optimize citizen assignments for a city using the CitizenManagement system
   * @param cityId The city to optimize
   * @param parameters Optional optimization parameters (uses default if not provided)
   */
  private async optimizeCitizens(cityId: string, parameters?: any): Promise<boolean> {
    if (!this.optimizationService) {
      logger.warn(
        `Cannot optimize citizens for city ${cityId} - optimization service not available`
      );
      return false;
    }

    // Delegate to CityOptimizationService for citizen optimization
    const result = await this.optimizationService.optimizeCitizens(cityId, parameters);
    return result.success;
  }

  /**
   * Public method to manually optimize a city's citizens
   * @param cityId The city to optimize
   * @param parameters Optional optimization parameters
   */
  async optimizeCityManually(cityId: string, parameters?: any): Promise<boolean> {
    if (!this.optimizationService) {
      logger.warn(`Cannot manually optimize city ${cityId} - optimization service not available`);
      return false;
    }

    // Delegate to CityOptimizationService for manual optimization
    const result = await this.optimizationService.optimizeCityManually(cityId, parameters);
    return result.success;
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
   * Get cities by player - used by EconomicManager
   */
  getCitiesByPlayer(playerId: string): CityState[] {
    return Array.from(this.cities.values()).filter(city => city.playerId === playerId);
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
