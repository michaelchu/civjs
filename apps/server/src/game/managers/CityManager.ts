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
      productionStock: 0, // Shield stock for current production
      foodStock: 0,
      foodPerTurn: 2, // Base city center food
      productionPerTurn: 1, // Base city center production
      tradePerTurn: 1, // Base city center trade
      sciencePerTurn: 0, // Will be calculated
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
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot process turn for city: ${cityId} - city not found`);
      return;
    }

    const startTime = Date.now();

    const stepTimings: Array<{ step: string; duration: number }> = [];
    let lastStepTime = startTime;

    const recordStep = (step: string) => {
      const now = Date.now();
      stepTimings.push({
        step,
        duration: now - lastStepTime,
      });
      lastStepTime = now;
    };

    try {
      // Apply government effects first
      this.refreshCityWithGovernmentEffects(cityId);
      recordStep('government_effects');

      // Apply automated governor if enabled
      if (this.governorService && city.governor?.isEnabled) {
        await this.governorService.applyGovernorAutomation(cityId);
      }
      recordStep('governor_automation');

      // Optimize citizen assignments
      await this.optimizeCitizens(cityId);
      recordStep('citizen_optimization');

      // Calculate city outputs
      this.calculateCityOutputs(cityId);
      recordStep('calculate_outputs');

      // Trigger callback for city turn processing (science accumulation)
      if (this.callbacks.onCityTurnProcessed) {
        this.callbacks.onCityTurnProcessed(city);
      }
      recordStep('callbacks');

      // Process food and growth
      await this.processFoodAndGrowth(city, currentTurn);
      recordStep('food_growth');

      // Process production
      await this.processProduction(city, currentTurn);
      recordStep('production');

      // Process happiness
      this.calculateHappiness(cityId);
      recordStep('happiness');

      // Save changes to database
      await this.saveCityToDatabase(city);
      recordStep('database_save');

      const totalTime = Date.now() - startTime;

      // Log performance details for slow cities or if total time is concerning
      if (totalTime > 2000 || stepTimings.some(s => s.duration > 1000)) {
        logger.warn(`Slow city turn processing detected for ${city.name}`, {
          gameId: this.gameId,
          cityId,
          totalTime,
          stepTimings,
          population: city.population,
          currentProduction: city.currentProduction,
          productionType: city.productionType,
        });
      }
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`Error processing turn for city ${city.name}`, {
        gameId: this.gameId,
        cityId,
        totalTime,
        stepTimings,
        error: errorMessage,
        population: city.population,
        currentProduction: city.currentProduction,
        productionType: city.productionType,
      });

      // Don't re-throw database errors during turn processing to avoid breaking the entire turn
      // The error has already been logged above, and the turn processing should continue
      logger.warn('City turn processing completed with database save error, continuing with turn', {
        gameId: this.gameId,
        cityId,
        cityName: city.name,
      });
    }
  }

  private async processFoodAndGrowth(city: CityState, _currentTurn: number): Promise<void> {
    const foodSurplus = city.foodPerTurn || 0;
    const currentFoodStock = city.foodStock || 0;
    const newFoodStock = currentFoodStock + foodSurplus;

    const granarySize = this.calculateGranarySize(city.population);

    if (newFoodStock >= granarySize && foodSurplus > 0) {
      // City grows
      const oldSize = city.population;
      city.population += 1;
      city.size = city.population;
      city.foodStock = newFoodStock - granarySize;

      logger.info(`City ${city.name} grew from size ${oldSize} to ${city.population}`);

      // Automatically assign the new citizen to work the best available tile
      if (this.tileManagementService && city.workableTiles) {
        // Re-run auto-assignment to allocate the new citizen
        this.tileManagementService.reassignCitizensAfterGrowth(city);
      }
      // Re-optimize citizens after growth to ensure best assignment
      await this.optimizeCitizens(city.id);

      // Recalculate outputs after assigning new citizen
      this.calculateCityOutputs(city.id);

      if (this.callbacks.onCityGrowth) {
        this.callbacks.onCityGrowth(city, oldSize);
      }
    } else if (newFoodStock < 0) {
      // City starves
      city.foodStock = 0;
      if (city.population > 1) {
        city.population -= 1;
        city.size = city.population;
        logger.info(`City ${city.name} starved and lost population`);
      }
    } else {
      city.foodStock = newFoodStock;
    }
  }

  private async processProduction(city: CityState, _currentTurn: number): Promise<void> {
    if (!city.currentProduction) {
      return;
    }

    const productionPerTurn = city.productionPerTurn || 0;
    const currentProductionStock = city.productionStock || 0;
    const newProductionStock = currentProductionStock + productionPerTurn;

    let productionCost = 0;
    let productionIsValid = true;

    if (city.productionType === 'unit') {
      const unitType = UNIT_TYPES[city.currentProduction];
      if (!unitType) {
        logger.error(`Invalid unit type in production for city ${city.name}`, {
          cityId: city.id,
          productionType: city.productionType,
          currentProduction: city.currentProduction,
          availableUnitTypes: Object.keys(UNIT_TYPES),
        });
        productionIsValid = false;
      } else {
        productionCost = unitType.cost || 0;
      }
    } else if (city.productionType === 'building') {
      const building = BUILDING_TYPES[city.currentProduction];
      if (!building) {
        logger.error(`Invalid building type in production for city ${city.name}`, {
          cityId: city.id,
          productionType: city.productionType,
          currentProduction: city.currentProduction,
          availableBuildingTypes: Object.keys(BUILDING_TYPES),
        });
        productionIsValid = false;
      } else {
        productionCost = building.cost || 0;
      }
    } else {
      logger.error(`Unknown production type for city ${city.name}`, {
        cityId: city.id,
        productionType: city.productionType,
        currentProduction: city.currentProduction,
      });
      productionIsValid = false;
    }

    if (!productionIsValid) {
      logger.warn(`Clearing invalid production for city ${city.name}`);
      city.currentProduction = null;
      city.productionType = null;
      city.productionStock = 0;
      city.turnsToComplete = 0;
      return;
    }

    if (productionCost <= 0) {
      logger.warn(`Production cost is 0 or negative for city ${city.name}, setting to 1`, {
        cityId: city.id,
        productionType: city.productionType,
        currentProduction: city.currentProduction,
        originalCost: productionCost,
      });
      productionCost = 1;
    }

    if (newProductionStock >= productionCost) {
      // Production completed
      await this.completeProduction(city.id);
    } else {
      city.productionStock = newProductionStock;
      city.turnsToComplete = Math.ceil(
        (productionCost - newProductionStock) / Math.max(1, productionPerTurn)
      );
    }
  }

  private async completeProduction(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || !city.currentProduction) {
      return;
    }

    const productionItem: ProductionItem = {
      kind: city.productionType as 'unit' | 'building',
      value: city.currentProduction,
    };

    if (city.productionType === 'building') {
      // Add the building to the city
      if (!city.buildings.includes(city.currentProduction)) {
        city.buildings.push(city.currentProduction);
      }
    } else if (city.productionType === 'unit') {
      // Handle unit creation (would integrate with UnitManager)
    }

    // Reset production
    city.currentProduction = null;
    city.productionType = null;
    city.productionStock = 0;
    city.turnsToComplete = 0;

    // Trigger callback
    if (this.callbacks.onCityProductionComplete) {
      this.callbacks.onCityProductionComplete(city, productionItem);
    }
  }

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
    for (const buildingId of city.buildings) {
      const building = BUILDING_TYPES[buildingId];
      if (building && building.effects.happinessEffect) {
        buildingEffect += building.effects.happinessEffect;
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
