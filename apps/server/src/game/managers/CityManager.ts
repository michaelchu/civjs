/* eslint-disable complexity */
import { randomUUID } from 'crypto';
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { cities, games } from '@database/schema';
import { eq } from 'drizzle-orm';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  SpecialistType,
  SPECIALIST_TYPES,
  type SpecialistDefinition,
} from '@game/constants/SpecialistDefinitions';
import type { BuildingCultureRequirement } from '@shared/data/rulesets/schemas';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsManager } from '@game/managers/EffectsManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import {
  CityFoundingValidationService,
  CityFoundingValidationResult,
  CityFoundingErrorCode,
} from '@game/services/CityFoundingValidationService';
import type { MapManager } from '@game/managers/MapManager';
import { Server as SocketServer } from 'socket.io';
import type { TaxRates } from '@game/systems/Economic/types/EconomicTypes';
import { DEFAULT_TAX_RATES } from '@game/systems/Economic/constants/EconomicConstants';
import { UnitSupportManager, type UnitSupportData } from '@game/managers/UnitSupportManager';
import { ActionType, type ActionResult } from '@app-types/shared/actions';

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

// CivJS uses a stricter default than Freeciv so neighboring city centers have
// at least two intervening tiles.
export const GAME_DEFAULT_CITYMINDIST = 3;
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

export { SpecialistType, SPECIALIST_TYPES, type SpecialistDefinition };

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
  routeType?: string;
  goods?: string;
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
  goldPerTurn?: number;
  luxuryPerTurn?: number;
  pollution?: number;
  unitGoldUpkeep?: number;
  unitShieldUpkeep?: number;
  grossProductionPerTurn?: number;
  wasHappy?: boolean;
  disorderTurns?: number;

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

  // A classic airport may participate in one airlift per turn.
  airliftUsedTurn?: number;
}

export interface BuildingType {
  id: string;
  name: string;
  genus: 'Improvement' | 'SmallWonder' | 'GreatWonder' | 'Special' | 'Convert';
  cost: number;
  requiredTech?: string;
  requires?: string[]; // Required buildings
  cultureRequirements?: BuildingCultureRequirement[];
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

/** @reference reference/freeciv/data/classic/buildings.ruleset */
export const BUILDING_TYPES: Record<string, BuildingType> =
  rulesetBuildingsService.getPlayableBuildingTypes();

// Callback interface for events
export interface CityManagerCallbacks {
  onCityFounded?: (city: CityState) => void;
  onCityGrowth?: (city: CityState, oldSize: number) => void;
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void | Promise<void>;
  onCityDestroyed?: (city: CityState) => void;
  onCityCaptured?: (city: CityState, oldPlayerId: string) => void;
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
  private currentTurnProvider?: () => number;
  /**
   * Players that have ever owned a city, mirroring freeciv's PLRF_FIRST_CITY.
   * @reference reference/freeciv/common/fc_types.h:501-503
   */
  private playersWithFirstCity: Set<string> = new Set();

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
  private effectsManager: EffectsManager;
  private governmentManager?: GovernmentManager;
  private calculationService: CityCalculationService;
  private happinessService: CityHappinessService;
  private playerGovernmentProvider?: (playerId: string) => string;
  private playerTechsProvider: (playerId: string) => ReadonlySet<string> = () => new Set();
  private playerBuildingsProvider: (playerId: string) => ReadonlySet<string> = () => new Set();
  private playerTaxRatesProvider: (playerId: string) => TaxRates = () => ({
    ...DEFAULT_TAX_RATES,
  });
  private playerGoldProvider: (playerId: string) => Promise<number> = async () => 0;
  private spendPlayerGoldProvider: (playerId: string, amount: number) => Promise<boolean> =
    async () => false;
  private addPlayerGoldProvider: (playerId: string, amount: number) => Promise<boolean> =
    async () => false;
  private addResearchPointsProvider: (playerId: string, amount: number) => Promise<void> =
    async () => {};
  private diplomaticStateProvider: (playerId: string, otherPlayerId: string) => Promise<string> =
    async () => 'no_contact';
  private unitSupportProvider: (city: CityState) => UnitSupportData[] = () => [];
  private mapChangedCallback?: (gameId: string, mapData: unknown) => void;
  private readonly unitSupportManager: UnitSupportManager;
  private optimizationService?: CityOptimizationService;
  private readonly nuclearPopulationLossPct: number;

  constructor(
    gameId: string,
    databaseProvider: DatabaseProvider,
    effectsManager: EffectsManager,
    callbacks: CityManagerCallbacks = {}
  ) {
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
    this.callbacks = callbacks;
    this.effectsManager = effectsManager;
    this.nuclearPopulationLossPct = rulesetLoader.getCombatRules().nuke_pop_loss_pct;
    this.unitSupportManager = new UnitSupportManager(gameId, effectsManager);

    // Every city service evaluates requirements against the same game-owned
    // ruleset instance so effects cannot diverge between subsystems.
    this.calculationService = new CityCalculationService(effectsManager);
    this.happinessService = new CityHappinessService(effectsManager);
  }

  /**
   * Set or update callbacks after initialization
   */
  setCallbacks(newCallbacks: Partial<CityManagerCallbacks>): void {
    Object.assign(this.callbacks, newCallbacks);
  }

  public setCurrentTurnProvider(provider: () => number): void {
    this.currentTurnProvider = provider;
  }

  public setPlayerTechsProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.playerTechsProvider = provider;
    this.happinessService.setPlayerTechsProvider(provider);
    this.tradeRouteService?.setPlayerTechsProvider(provider);
  }

  public setPlayerBuildingsProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.playerBuildingsProvider = provider;
    this.happinessService.setPlayerBuildingsProvider(provider);
  }

  public setPlayerTaxRatesProvider(provider: (playerId: string) => TaxRates): void {
    this.playerTaxRatesProvider = provider;
  }

  public setUnitSupportProvider(provider: (city: CityState) => UnitSupportData[]): void {
    this.unitSupportProvider = provider;
  }

  public setMapChangedCallback(callback: (gameId: string, mapData: unknown) => void): void {
    this.mapChangedCallback = callback;
  }

  public setPlayerGovernmentProvider(provider: (playerId: string) => string): void {
    this.playerGovernmentProvider = provider;
    this.happinessService.setPlayerGovernmentProvider(provider);
    this.tileManagementService?.setPlayerGovernmentProvider(provider);
  }

  private getPlayerGovernment(playerId: string): string {
    if (!this.playerGovernmentProvider) {
      throw new Error(`No government provider configured for player '${playerId}'`);
    }
    const government = this.playerGovernmentProvider(playerId);
    if (!government) {
      throw new Error(`No government found for player '${playerId}'`);
    }
    return government;
  }

  /**
   * Initialize the CityManager and its services
   */
  async initialize(): Promise<void> {
    // Initialize specialized services
    this.buildingService = new CityBuildingService(
      this.cities,
      this.databaseProvider,
      BUILDING_TYPES,
      this.effectsManager
    );

    const mapData = this.mapManager?.getMapData();
    this.tradeRouteService = new CityTradeRouteService(
      this.cities,
      2,
      {
        width: mapData?.width ?? 80,
        height: mapData?.height ?? 50,
        getContinentId: (x, y) => this.mapManager?.getTile(x, y)?.continentId,
        getCurrentTurn: () => this.currentTurnProvider?.() ?? 0,
        getRealDistance: (x1, y1, x2, y2) =>
          (this.mapManager as Partial<MapManager> | undefined)
            ?.getTopology?.()
            .realDistance(x1, y1, x2, y2) ?? Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)),
        getMapDistance: (x1, y1, x2, y2) =>
          (this.mapManager as Partial<MapManager> | undefined)
            ?.getTopology?.()
            .mapDistance(x1, y1, x2, y2) ?? Math.abs(x2 - x1) + Math.abs(y2 - y1),
      },
      this.effectsManager
    );
    this.tradeRouteService.setPlayerTechsProvider(this.playerTechsProvider);

    this.productionService = new CityProductionService(
      this.cities,
      BUILDING_TYPES,
      this.playerGoldProvider,
      this.spendPlayerGoldProvider
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
      this.citizenManagementService,
      undefined,
      playerId => this.playerTaxRatesProvider(playerId),
      cityId => {
        this.calculateCityOutputs(cityId);
        this.applyCityHappiness(cityId);
      }
    );

    // setMapManager is commonly called before initialize. Rebuild the
    // map-dependent services now that governor and optimization exist.
    if (this.mapManager) {
      this.setMapManager(this.mapManager);
    }

    // Initialize high-level coordination service
    // Note: CityManagementService needs different constructor parameters
    // this.managementService = new CityManagementService(...);
  }

  /**
   * Connect rush production to the authoritative per-game treasury.
   * This is configured once TurnManager has created its EconomicManager.
   */
  setTreasuryProviders(
    getPlayerGold: (playerId: string) => Promise<number>,
    spendPlayerGold: (playerId: string, amount: number) => Promise<boolean>
  ): void {
    this.playerGoldProvider = getPlayerGold;
    this.spendPlayerGoldProvider = spendPlayerGold;
    this.productionService = new CityProductionService(
      this.cities,
      BUILDING_TYPES,
      getPlayerGold,
      spendPlayerGold
    );
  }

  public setTradeProviders(
    addGold: (playerId: string, amount: number) => Promise<boolean>,
    addResearch: (playerId: string, amount: number) => Promise<void>,
    diplomaticState: (playerId: string, otherPlayerId: string) => Promise<string>
  ): void {
    this.addPlayerGoldProvider = addGold;
    this.addResearchPointsProvider = addResearch;
    this.diplomaticStateProvider = diplomaticState;
  }

  /**
   * Set the MapManager dependency
   */
  setMapManager(mapManager: MapManager): void {
    this.mapManager = mapManager;
    this.effectsManager.setRealDistanceProvider((x1, y1, x2, y2) => {
      const topology = (mapManager as Partial<MapManager>).getTopology?.();
      return (
        topology?.realDistance(x1, y1, x2, y2) ?? Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
      );
    });

    // Initialize CityTileManagementService now that we have MapManager
    this.tileManagementService = new CityTileManagementService(
      this.cities,
      this.mapManager,
      CITY_MAP_DEFAULT_RADIUS_SQ,
      rulesetLoader,
      this.effectsManager
    );
    if (this.playerGovernmentProvider) {
      this.tileManagementService.setPlayerGovernmentProvider(this.playerGovernmentProvider);
    }

    // Update optimization service with tile management service
    if (this.optimizationService) {
      this.optimizationService.setTileManagementService(this.tileManagementService);
    }

    // Initialize turn processing service now that we have all dependencies
    this.turnProcessingService = new CityTurnProcessingService({
      gameId: this.gameId,
      cities: this.cities,
      callbacks: this.callbacks,
      effectsManager: this.effectsManager,
      io: this.io,
      governorService: this.governorService,
      tileManagementService: this.tileManagementService,
      refreshCityWithGovernmentEffects: this.refreshCityWithGovernmentEffects.bind(this),
      calculateCityOutputs: this.calculateCityOutputs.bind(this),
      calculateHappiness: this.calculateHappiness.bind(this),
      applyCityHappiness: this.applyCityHappiness.bind(this),
      getPlayerGovernment: this.getPlayerGovernment.bind(this),
      checkPollution: this.checkPollution.bind(this),
      forceGovernmentRevolution: async playerId => {
        await this.governmentManager?.overthrowGovernment(
          playerId,
          this.currentTurnProvider?.() ?? 0
        );
      },
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
  setGovernmentManager(governmentManager: GovernmentManager): void {
    this.governmentManager = governmentManager;
  }

  // === CORE CITY LIFECYCLE METHODS ===

  private citymindistPreventsCityOnTile(x: number, y: number): boolean {
    const minDistance = GAME_DEFAULT_CITYMINDIST;
    const topology = (this.mapManager as Partial<MapManager> | undefined)?.getTopology?.();

    for (const city of this.cities.values()) {
      const distance =
        topology?.realDistance(city.x, city.y, x, y) ??
        Math.max(Math.abs(city.x - x), Math.abs(city.y - y));

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
    // @reference reference/freeciv/server/citytools.c:639-690
    const currentTurn = this.currentTurnProvider?.() ?? 1;

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
      wasHappy: false,
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
      airliftUsedTurn: undefined,
    };

    // Free initial buildings for the player's very first city. Freeciv checks
    // this before the city joins the owner's city list.
    // @reference reference/freeciv/server/citytools.c:1559-1564 create_city()
    const isFirstCity = !this.playersWithFirstCity.has(playerId);
    if (isFirstCity) {
      this.buildFreeBuildings(city);
      this.playersWithFirstCity.add(playerId);
    }

    this.cities.set(cityId, city);

    // Classic roads are automatically present on eligible city centers.
    // A river center requires Bridge Building, so leave that case untouched.
    // @reference reference/freeciv/data/classic/terrain.ruleset extra_road
    const centerTile = this.mapManager?.getTile(x, y);
    const previousCenterRoad = centerTile
      ? {
          hasRoad: centerTile.hasRoad,
          improvements: Array.isArray(centerTile.improvements)
            ? [...centerTile.improvements]
            : undefined,
        }
      : undefined;
    if (centerTile && centerTile.riverMask === 0) {
      centerTile.hasRoad = true;
      if (!centerTile.improvements.includes('road')) {
        centerTile.improvements.push('road');
      }
    }

    // Initialize workable tiles using the service
    if (this.tileManagementService) {
      this.tileManagementService.initializeWorkableTiles(city);
      // A newly founded city starts with its citizen working the land. Player
      // governors may opt into specialists on later optimization passes.
      const initialParameters = CitizenParameterFactory.createDefault();
      initialParameters.allow_specialists = false;
      await this.optimizeCitizens(cityId, initialParameters);
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
    try {
      await this.saveCityToDatabase(city);
    } catch (error) {
      // Founding is authoritative only after persistence succeeds. Roll back
      // provisional state so the tile and first-city grant can be retried.
      this.cities.delete(cityId);
      if (isFirstCity) this.playersWithFirstCity.delete(playerId);
      if (centerTile && previousCenterRoad) {
        centerTile.hasRoad = previousCenterRoad.hasRoad;
        if (previousCenterRoad.improvements) {
          centerTile.improvements = previousCenterRoad.improvements;
        }
      }
      throw error;
    }

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

  /**
   * Give a player's first city the ruleset's free initial buildings.
   *
   * Freeciv also re-grants buildings flagged SaveSmallWonder to a later "first"
   * city when the `savepalace` server setting is on; neither the improvement
   * flag nor the setting is modelled here, so only the never-had-a-city branch
   * is implemented.
   * @reference reference/freeciv/server/citytools.c:1435-1479 city_build_free_buildings()
   */
  private buildFreeBuildings(city: CityState): void {
    for (const buildingId of rulesetLoader.getGlobalInitBuildings()) {
      if (city.buildings.includes(buildingId)) {
        continue;
      }

      city.buildings.push(buildingId);
      logger.info('Granted free initial building', {
        cityId: city.id,
        playerId: city.playerId,
        buildingId,
      });
    }
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
      const kind = item.kind === 'wonder' ? 'building' : item.kind;
      return this.canCityQueueItem(city, kind, item.value);
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
      const building = BUILDING_TYPES[productionId];
      if (
        building.genus === 'GreatWonder' &&
        [...this.cities.values()].some(
          other =>
            other.buildings.includes(productionId) ||
            (other.id !== city.id && other.currentProduction === productionId)
        )
      ) {
        throw new Error(`Great Wonder is already built or under construction: ${productionId}`);
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
    const productionStock = city.productionStock ?? city.shieldStock ?? 0;
    city.turnsToComplete = Math.ceil(
      Math.max(0, productionCost - productionStock) / Math.max(1, city.productionPerTurn || 1)
    );

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
          tradePerTurn: record.tradePerTurn || 0,
          sciencePerTurn: record.sciencePerTurn || 0, // Will be recalculated
          goldPerTurn: record.goldPerTurn || 0,
          luxuryPerTurn: record.luxuryPerTurn || 0,
          pollution: record.pollution || 0,
          history: record.history || 0, // Culture history
          wasHappy: record.wasHappy,
          disorderTurns: record.disorderTurns,
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
          tradeRoutes: (record.tradeRoutes as TradeRoute[]) || [],
          governor: (record.governor as CityGovernor | null) ?? undefined,
          happiness: {
            happy: 0,
            content: Math.max(0, record.population - 1),
            unhappy: record.happiness < 0 ? Math.abs(record.happiness) : 0,
            angry: 0,
          },
          worklist: (record.productionQueue as ProductionItem[]) || [],
          defenseStrength: record.defenseStrength || 1,
          airliftUsedTurn: record.airliftUsedTurn ?? undefined,
        };

        this.cities.set(city.id, city);
        // A recovered owner has already had a city, so later foundings must not
        // hand out the ruleset's free initial buildings again.
        // @reference reference/freeciv/server/savegame/savegame2.c:3675-3678
        this.playersWithFirstCity.add(city.playerId);

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
        tradePerTurn: city.tradePerTurn || 0,
        goldPerTurn: city.goldPerTurn || 0,
        luxuryPerTurn: city.luxuryPerTurn || 0,
        sciencePerTurn: city.sciencePerTurn || 0,
        pollution: city.pollution || 0,
        tradeRoutes: city.tradeRoutes,
        governor: city.governor ?? null,
        culturePerTurn: 0, // Will be calculated
        faithPerTurn: 0, // Will be calculated
        history: city.history || 0, // Culture history
        buildings: city.buildings,
        specialists: city.specialists,
        productionQueue: city.worklist,
        happiness: city.happiness.content - city.happiness.unhappy, // Simplified happiness mapping
        wasHappy: city.wasHappy ?? false,
        disorderTurns: city.disorderTurns ?? 0,
        defenseStrength: city.defenseStrength || 1,
        airliftUsedTurn: city.airliftUsedTurn ?? null,
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
            error?.cause?.code === '23505' ||
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

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(
            new Error(
              `Database operation timed out for city ${city.id} after ${DB_OPERATION_TIMEOUT}ms`
            )
          );
        }, DB_OPERATION_TIMEOUT);
        timeout.unref?.();
      });

      try {
        await Promise.race([dbOperation(), timeoutPromise]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
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

    const support = this.getCityHappinessSupport(city);
    return this.happinessService.calculateDetailedHappiness(
      city,
      city.luxuryPerTurn ?? 0,
      support.militaryUnitsPresent,
      support.militaryUnhappiness
    );
  }

  public calculateHappiness(cityId: string): Happiness {
    const city = this.cities.get(cityId);
    if (!city) {
      return { happy: 0, content: 0, unhappy: 0, angry: 0 };
    }

    const support = this.getCityHappinessSupport(city);
    return this.happinessService.calculateHappiness(
      city,
      city.luxuryPerTurn ?? 0,
      support.militaryUnitsPresent,
      support.militaryUnhappiness
    );
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

  public applyCityHappiness(cityId: string): void {
    const city = this.cities.get(cityId);
    if (!city) return;

    const support = this.getCityHappinessSupport(city);
    this.happinessService.applyCityHappiness(
      city,
      city.luxuryPerTurn ?? 0,
      support.militaryUnitsPresent,
      support.militaryUnhappiness
    );
  }

  private getCityHappinessSupport(city: CityState): {
    militaryUnitsPresent: number;
    militaryUnhappiness: number;
  } {
    const units = this.unitSupportProvider(city);
    const support = this.unitSupportManager.calculateCityUnitSupport(
      city.id,
      city.playerId,
      this.getPlayerGovernment(city.playerId).toLowerCase(),
      city.population,
      units,
      new Set(city.buildings),
      new Set(this.playerBuildingsProvider(city.playerId))
    );
    return {
      militaryUnitsPresent: units.filter(
        unit => unit.isMilitaryUnit && unit.currentLocation === city.id
      ).length,
      militaryUnhappiness: support.happinessEffect,
    };
  }

  public calculateCityOutputs(cityId: string): {
    food: number;
    shields: number;
    trade: number;
    science: number;
    gold: number;
    luxury: number;
    pollution: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        food: 0,
        shields: 0,
        trade: 0,
        science: 0,
        gold: 0,
        luxury: 0,
        pollution: 0,
      };
    }

    // Delegate to CityCalculationService for all calculations
    const tileOutputs = this.tileManagementService?.calculateCityOutputs(city.id);
    city.grossProductionPerTurn = tileOutputs?.shields ?? 0;
    if (tileOutputs && this.tradeRouteService) {
      tileOutputs.trade += this.tradeRouteService.getCityTradeRouteRevenue(city.id);
    }
    const supportedUnits = this.unitSupportProvider(city);
    const support = this.unitSupportManager.calculateCityUnitSupport(
      city.id,
      city.playerId,
      this.getPlayerGovernment(city.playerId).toLowerCase(),
      city.population,
      supportedUnits,
      new Set(city.buildings),
      new Set(this.playerBuildingsProvider(city.playerId))
    );
    const populationFood = city.population * rulesetLoader.getCivstyle().food_cost;
    const unitUpkeep = {
      food: Math.max(0, support.upkeepCosts.food - populationFood),
      shield: support.upkeepCosts.shield,
      gold: support.upkeepCosts.gold,
    };
    const outputs = this.calculationService.calculateCityOutputs(
      city,
      tileOutputs,
      this.tileManagementService,
      {
        government: this.getPlayerGovernment(city.playerId),
        playerTechs: this.playerTechsProvider(city.playerId),
        playerBuildings: this.playerBuildingsProvider(city.playerId),
        playerCities: this.getPlayerCities(city.playerId),
        mapWidth: this.mapManager?.getMapData()?.width,
        mapHeight: this.mapManager?.getMapData()?.height,
        taxRates: this.playerTaxRatesProvider(city.playerId),
        unitUpkeep,
      }
    );

    // Update city state with calculated outputs
    city.foodPerTurn = outputs.food;
    city.productionPerTurn = outputs.shields;
    city.tradePerTurn = outputs.trade;
    city.sciencePerTurn = outputs.science;
    city.goldPerTurn = outputs.gold;
    city.luxuryPerTurn = outputs.luxury;
    city.pollution = outputs.pollution;
    city.unitGoldUpkeep = unitUpkeep.gold;
    city.unitShieldUpkeep = unitUpkeep.shield;

    return outputs;
  }

  /**
   * Roll and place one pollution extra on a workable non-center land tile.
   * The roll is derived from persisted game/turn/city identity so recovery
   * cannot change an already determined turn outcome.
   *
   * @reference reference/freeciv/server/cityturn.c:3500-3548
   */
  public async checkPollution(cityId: string, currentTurn: number): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || !this.mapManager || (city.pollution ?? 0) <= 0) return false;
    const roll = this.stableHash(`${this.gameId}:${currentTurn}:${city.id}:pollution`) % 100;
    if (roll >= (city.pollution ?? 0)) return false;

    const candidates = (city.workableTiles ?? [])
      .filter(tile => !tile.isCenter)
      .map(tile => this.mapManager!.getTile(tile.x, tile.y))
      .filter(
        tile =>
          tile !== null &&
          !['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain) &&
          !(tile.improvements ?? []).includes('pollution')
      );
    if (candidates.length === 0) return false;

    const index =
      this.stableHash(`${this.gameId}:${currentTurn}:${city.id}:pollution-tile`) %
      candidates.length;
    const tile = candidates[index]!;
    this.mapManager.updateTileProperty(tile.x, tile.y, 'improvements', [
      ...(tile.improvements ?? []),
      'pollution',
    ]);
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({ mapData: this.mapManager.getMapData() })
      .where(eq(games.id, this.gameId));
    this.mapChangedCallback?.(this.gameId, this.mapManager.getMapData());
    return true;
  }

  private stableHash(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * Recalculate a city against the owner's current government. Corruption is
   * already subtracted while outputs are produced, so nothing may deduct it a
   * second time here.
   * @reference reference/freeciv/common/city.c:3201-3244 city_refresh_from_main_map()
   */
  public refreshCityWithGovernmentEffects(cityId: string): void {
    this.calculateCityOutputs(cityId);
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
  async setCitizenParameters(cityId: string, parameters: any): Promise<boolean> {
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

    await this.saveCityToDatabase(city);
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
    const sold = await this.buildingService.sellBuilding(cityId, buildingId);
    const city = this.cities.get(cityId);
    if (sold && city) await this.saveCityToDatabase(city);
    return sold;
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
    const source = this.cities.get(sourceCityId);
    const partner = this.cities.get(partnerCityId);
    if (!source || !partner) return false;
    const relation =
      source.playerId === partner.playerId
        ? 'domestic'
        : await this.diplomaticStateProvider(source.playerId, partner.playerId);
    const settlement = this.tradeRouteService.calculateTradeSettlement(source, partner, relation);
    const established = await this.tradeRouteService.establishTradeRoute(
      sourceCityId,
      partnerCityId,
      playerId,
      relation
    );
    if (established) {
      await this.applyTradeBonus(playerId, settlement.bonus, settlement.bonusType);
      await Promise.all([...this.cities.values()].map(city => this.saveCityToDatabase(city)));
      this.calculateCityOutputs(sourceCityId);
      this.calculateCityOutputs(partnerCityId);
    }
    return established;
  }

  private async applyTradeBonus(
    playerId: string,
    amount: number,
    bonusType: 'None' | 'Gold' | 'Science' | 'Both'
  ): Promise<void> {
    if (amount <= 0 || bonusType === 'None') return;
    if (bonusType === 'Gold' || bonusType === 'Both') {
      await this.addPlayerGoldProvider(playerId, amount);
    }
    if (bonusType === 'Science' || bonusType === 'Both') {
      await this.addResearchPointsProvider(playerId, amount);
    }
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
    const removed = await this.tradeRouteService.removeTradeRoute(sourceCityId, partnerCityId);
    if (removed) {
      await Promise.all(
        [sourceCityId, partnerCityId]
          .map(cityId => this.cities.get(cityId))
          .filter((city): city is CityState => Boolean(city))
          .map(city => this.saveCityToDatabase(city))
      );
      this.calculateCityOutputs(sourceCityId);
      this.calculateCityOutputs(partnerCityId);
    }
    return removed;
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
    const configured = await this.governorService.configureCityGovernor(cityId, playerId, config);
    const city = this.cities.get(cityId);
    if (configured && city) {
      await this.saveCityToDatabase(city);
    }
    return configured;
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
    cityDestroyed?: boolean;
    reason?: string;
  }> {
    if (!this.captureService)
      return {
        success: false,
        populationLoss: 0,
        buildingsDestroyed: [],
        reason: 'Service not available',
      };
    const cityBeforeCapture = this.cities.get(cityId);
    const oldPlayerId = cityBeforeCapture?.playerId ?? '';
    const result = await this.captureService.captureCity(
      cityId,
      conquerorPlayerId,
      conquerorUnitId
    );
    if (result.success && result.cityDestroyed && cityBeforeCapture) {
      await this.destroyCity(cityId);
      return result;
    }

    const city = this.cities.get(cityId);
    if (result.success && city) {
      this.calculateCityOutputs(cityId);
      this.applyCityHappiness(cityId);
      await this.saveCityToDatabase(city);
      this.callbacks.onCityCaptured?.(city, oldPlayerId);
    }
    return result;
  }

  async transferCity(cityId: string, newPlayerId: string): Promise<boolean> {
    if (!this.captureService) return false;
    const city = this.cities.get(cityId);
    if (!city) return false;
    const oldPlayerId = city.playerId;
    const transferred = await this.captureService.transferCity(cityId, newPlayerId);
    if (transferred && oldPlayerId !== newPlayerId) {
      this.calculateCityOutputs(cityId);
      this.applyCityHappiness(cityId);
      await this.saveCityToDatabase(city);
      this.callbacks.onCityCaptured?.(city, oldPlayerId);
    }
    return transferred;
  }

  /**
   * Apply the classic nuclear population consequence to every city in the
   * blast circle. The classic ruleset uses a 49 percent rounded population
   * loss and zero defender survival.
   * @reference reference/freeciv/server/unittools.c:2954-3037 do_nuke_tile()
   * @reference reference/freeciv/data/classic/game.ruleset:279-284
   */
  async applyNuclearExplosion(
    centerX: number,
    centerY: number,
    radiusSquared: number,
    _attackerPlayerId: string
  ): Promise<string[]> {
    const affected: string[] = [];
    for (const city of [...this.cities.values()]) {
      const dx = city.x - centerX;
      const dy = city.y - centerY;
      if (dx * dx + dy * dy > radiusSquared) continue;
      affected.push(city.id);
      const populationLoss = Math.round((city.population * this.nuclearPopulationLossPct) / 100);
      city.population = Math.max(1, city.population - populationLoss);
      city.size = city.population;
      await this.saveCityToDatabase(city);
    }
    return affected;
  }

  // === UTILITY METHODS ===

  private async updateTradeRoutesOnPlayerChange(
    cityId: string,
    _newPlayerId: string,
    _oldPlayerId: string
  ): Promise<void> {
    if (this.tradeRouteService) {
      await this.tradeRouteService.updateRoutesOnPlayerChange(cityId, this.diplomaticStateProvider);
    }
  }

  public async updateTradeRoutesForDiplomacy(
    firstPlayerId: string,
    secondPlayerId: string
  ): Promise<void> {
    if (!this.tradeRouteService) return;
    const relation = await this.diplomaticStateProvider(firstPlayerId, secondPlayerId);
    this.tradeRouteService.updateRoutesForDiplomacy(firstPlayerId, secondPlayerId, relation);
    await Promise.all([...this.cities.values()].map(city => this.saveCityToDatabase(city)));
  }

  async destroyCity(cityId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) return false;

    if (this.tradeRouteService) {
      await this.tradeRouteService.updateTradeRoutesOnCityDestruction(cityId);
    }

    // Remove from memory
    this.cities.delete(cityId);

    // Remove from database
    try {
      const db = this.databaseProvider.getDatabase();
      await db.delete(cities).where(eq(cities.id, cityId));
    } catch (error) {
      logger.error('Failed to delete city from database', { cityId, error });
    }

    if (this.tradeRouteService) {
      await Promise.all(
        [...this.cities.values()].map(remaining => this.saveCityToDatabase(remaining))
      );
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

  public async sabotageCityBuilding(
    cityId: string,
    actingPlayerId: string
  ): Promise<string | null> {
    const city = this.cities.get(cityId);
    if (!city) throw new Error('Target city not found');
    if (city.playerId === actingPlayerId) throw new Error('Cannot sabotage your own city');
    const target = [...city.buildings].filter(building => building !== 'palace').sort()[0];
    if (!target) return null;
    city.buildings = city.buildings.filter(building => building !== target);
    this.calculateCityOutputs(city.id);
    this.applyCityHappiness(city.id);
    await this.saveCityToDatabase(city);
    return target;
  }

  /**
   * A successful classic poison action removes exactly one citizen.
   * Classic keeps the food stock (`poison_empties_food_stock = FALSE`).
   * @reference reference/freeciv/server/diplomats.c:97-212
   * @reference reference/freeciv/data/classic/actions.ruleset:111-113
   */
  public async poisonCity(cityId: string, actingPlayerId: string): Promise<CityState> {
    const city = this.cities.get(cityId);
    if (!city) throw new Error('Target city not found');
    if (city.playerId === actingPlayerId) throw new Error('Cannot poison your own city');
    if (city.size < 2) throw new Error('Target city must have at least two citizens');
    city.size -= 1;
    city.population = city.size;
    this.calculateCityOutputs(city.id);
    this.applyCityHappiness(city.id);
    await this.saveCityToDatabase(city);
    return city;
  }

  /**
   * Apply Freeciv's ReducePopulation disaster effect. A city of size one is
   * unaffected unless the ruleset uses ReducePopDestroy (classic does not).
   */
  public async reducePopulationForDisaster(cityId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || city.size <= 1) return false;
    city.size -= 1;
    city.population = city.size;
    this.calculateCityOutputs(city.id);
    this.applyCityHappiness(city.id);
    await this.saveCityToDatabase(city);
    return true;
  }

  /**
   * Destroy one ordinary, non-wonder improvement selected by the caller's
   * random source. Freeciv excludes wonders and disaster-proof improvements.
   */
  public async destroyDisasterBuilding(
    cityId: string,
    random: () => number = Math.random
  ): Promise<string | null> {
    const city = this.cities.get(cityId);
    if (!city) return null;
    const candidates = city.buildings.filter(buildingId => {
      try {
        return rulesetLoader.getBuilding(buildingId).genus === 'Improvement';
      } catch {
        return false;
      }
    });
    if (candidates.length === 0) return null;
    const buildingId = candidates[Math.floor(random() * candidates.length)];
    city.buildings = city.buildings.filter(building => building !== buildingId);
    this.calculateCityOutputs(city.id);
    this.applyCityHappiness(city.id);
    await this.saveCityToDatabase(city);
    return buildingId;
  }

  /**
   * Place one pollution or fallout extra on an eligible workable land tile.
   */
  public async placeDisasterExtra(
    cityId: string,
    extra: 'pollution' | 'fallout',
    random: () => number = Math.random
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || !this.mapManager) return false;
    const candidates = (city.workableTiles ?? [])
      .filter(tile => !tile.isCenter)
      .map(tile => this.mapManager!.getTile(tile.x, tile.y))
      .filter(
        tile =>
          tile !== null &&
          !['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain) &&
          !(tile.improvements ?? []).includes(extra)
      );
    if (candidates.length === 0) return false;
    const tile = candidates[Math.floor(random() * candidates.length)]!;
    this.mapManager.updateTileProperty(tile.x, tile.y, 'improvements', [
      ...(tile.improvements ?? []),
      extra,
    ]);
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({ mapData: this.mapManager.getMapData() })
      .where(eq(games.id, this.gameId));
    this.mapChangedCallback?.(this.gameId, this.mapManager.getMapData());
    return true;
  }

  public async emptyDisasterStock(cityId: string, stock: 'food' | 'production'): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) return false;
    if (stock === 'food') {
      if ((city.foodStock ?? 0) <= 0) return false;
      city.foodStock = 0;
    } else {
      if ((city.productionStock ?? city.shieldStock ?? 0) <= 0) return false;
      city.productionStock = 0;
      city.shieldStock = 0;
    }
    await this.saveCityToDatabase(city);
    return true;
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

  /**
   * Consume a population-adding unit in a friendly city.
   * @reference reference/freeciv/server/citytools.c unit_do_add_to_city()
   */
  public async joinCity(cityId: string, playerId: string, population: number): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || city.playerId !== playerId || population <= 0) return false;
    city.size += population;
    city.population = city.size;
    this.calculateCityOutputs(city.id);
    this.applyCityHappiness(city.id);
    await this.saveCityToDatabase(city);
    return true;
  }

  /**
   * Add a caravan's full shield value to a friendly Great Wonder build.
   * @reference reference/freeciv/server/unithand.c unit_do_help_build()
   */
  public async helpWonder(cityId: string, playerId: string, shields: number): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || city.playerId !== playerId || !city.currentProduction || shields <= 0) {
      return false;
    }
    const building = rulesetBuildingsService.getBuildingTypes()[city.currentProduction];
    if (building?.genus !== 'GreatWonder') return false;
    city.productionStock = (city.productionStock ?? city.shieldStock ?? 0) + shields;
    city.shieldStock = city.productionStock;
    await this.saveCityToDatabase(city);
    return true;
  }

  /**
   * Recover a disbanded unit's full ruleset shield value in a friendly city.
   */
  public async recoverUnitShields(
    cityId: string,
    playerId: string,
    shields: number
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city || city.playerId !== playerId || !city.currentProduction || shields <= 0) {
      return false;
    }
    city.productionStock = (city.productionStock ?? city.shieldStock ?? 0) + shields;
    city.shieldStock = city.productionStock;
    await this.saveCityToDatabase(city);
    return true;
  }

  /**
   * Sell caravan goods for the classic one-time distance/trade bonus.
   * @reference reference/freeciv/common/traderoutes.c
   * get_caravan_enter_city_trade_bonus()
   */
  public async enterMarketplace(
    homeCityId: string,
    destinationCityId: string,
    playerId: string
  ): Promise<number | null> {
    const home = this.cities.get(homeCityId);
    const destination = this.cities.get(destinationCityId);
    if (!home || !destination || home.playerId !== playerId || home.id === destination.id) {
      return null;
    }
    if (!this.tradeRouteService) return null;
    const relation =
      home.playerId === destination.playerId
        ? 'domestic'
        : await this.diplomaticStateProvider(home.playerId, destination.playerId);
    const settlement = this.tradeRouteService.calculateTradeSettlement(home, destination, relation);
    await this.applyTradeBonus(playerId, settlement.bonus, settlement.bonusType);
    return settlement.bonus;
  }

  public async executeUnitCityAction(
    actionType: ActionType,
    playerId: string,
    unitTypeId: string,
    homeCityId: string | undefined,
    targetX: number,
    targetY: number
  ): Promise<ActionResult> {
    const city = this.getCityAt(targetX, targetY);
    const unitType = UNIT_TYPES[unitTypeId];
    if (!city || !unitType) return { success: false, message: 'Target city not found' };

    let success = false;
    let message = '';
    switch (actionType) {
      case ActionType.JOIN_CITY:
        success = await this.joinCity(city.id, playerId, unitType.pop_cost ?? 1);
        message = 'Unit joined the city';
        break;
      case ActionType.HELP_WONDER:
        success = await this.helpWonder(city.id, playerId, unitType.cost);
        message = `Added ${unitType.cost} shields to the wonder`;
        break;
      case ActionType.DISBAND_UNIT_RECOVER:
        success = await this.recoverUnitShields(city.id, playerId, unitType.cost);
        message = `Recovered ${unitType.cost} shields`;
        break;
      case ActionType.MARKETPLACE: {
        const revenue = homeCityId
          ? await this.enterMarketplace(homeCityId, city.id, playerId)
          : null;
        success = revenue !== null;
        message = `Sold goods for ${revenue ?? 0} gold`;
        break;
      }
    }
    return {
      success,
      message: success ? message : `Cannot perform ${actionType} in this city`,
      unitDestroyed: success,
      cityId: city.id,
    };
  }

  public getAllCities(): CityState[] {
    return Array.from(this.cities.values());
  }

  public getCityCount(): number {
    return this.cities.size;
  }

  /**
   * Atomically reserve both endpoint airports for this turn.
   * @reference reference/freeciv/server/unittools.c:3062-3095 do_airline()
   */
  public async reserveAirlift(
    sourceCityId: string,
    destinationCityId: string,
    playerId: string,
    turn: number
  ): Promise<boolean> {
    const source = this.cities.get(sourceCityId);
    const destination = this.cities.get(destinationCityId);
    const parameters = rulesetLoader.loadGameRulesRuleset().game_parameters;
    const sourceUnavailable =
      !parameters.airlift_from_always_enabled &&
      (!source?.buildings.includes('airport') || source?.airliftUsedTurn === turn);
    const destinationUnavailable =
      !parameters.airlift_to_always_enabled &&
      (!destination?.buildings.includes('airport') || destination?.airliftUsedTurn === turn);
    if (
      !source ||
      !destination ||
      source.id === destination.id ||
      source.playerId !== playerId ||
      sourceUnavailable ||
      destinationUnavailable
    ) {
      return false;
    }

    const sourcePrevious = source.airliftUsedTurn;
    const destinationPrevious = destination.airliftUsedTurn;
    source.airliftUsedTurn = turn;
    destination.airliftUsedTurn = turn;
    try {
      const db = this.databaseProvider.getDatabase();
      await db.update(cities).set({ airliftUsedTurn: turn }).where(eq(cities.id, source.id));
      await db.update(cities).set({ airliftUsedTurn: turn }).where(eq(cities.id, destination.id));
      return true;
    } catch (error) {
      source.airliftUsedTurn = sourcePrevious;
      destination.airliftUsedTurn = destinationPrevious;
      throw error;
    }
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
