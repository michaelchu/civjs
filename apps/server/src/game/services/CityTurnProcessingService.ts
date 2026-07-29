/**
 * CityTurnProcessingService - Handles city turn processing pipeline
 *
 * Extracted from CityManager.ts to reduce complexity and improve maintainability.
 * This service orchestrates the complete city turn processing sequence:
 * - Government effects application
 * - Governor automation
 * - Citizen optimization
 * - Output calculations
 * - Food and growth processing
 * - Production processing
 * - Happiness calculations
 * - Database persistence
 *
 * @reference freeciv/common/city.c - city turn processing
 * @reference freeciv-web/javascript/city.js - city management
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetBuildingsService } from './RulesetBuildingsService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import type { Server as SocketServer } from 'socket.io';
import type { CityGovernorService } from './CityGovernorService';
import type { CityTileManagementService } from './CityTileManagementService';
import { isSpaceshipPart } from './SpaceshipService';

// Import types from CityManager (we'll need to make these available)
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
  goldPerTurn?: number;
  luxuryPerTurn?: number;
  wasHappy?: boolean;
  disorderTurns?: number;
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

export interface ProductionItem {
  kind: 'unit' | 'building' | 'wonder';
  value: string;
  remainingCost?: number;
}

export interface CityManagerCallbacks {
  onCityGrowth?: (city: CityState, oldSize: number) => void;
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void | Promise<void>;
  onCityTurnProcessed?: (city: CityState) => void;
}

/** @reference reference/freeciv/data/classic/buildings.ruleset */
const BUILDING_TYPES = rulesetBuildingsService.getBuildingTypes();
const WEALTH_PRODUCTION_ID = 'capitalization';

/**
 * Turn processing step timing information
 */
export interface TurnStepTiming {
  step: string;
  duration: number;
}

/**
 * Turn processing performance metrics
 */
export interface TurnProcessingMetrics {
  cityId: string;
  cityName: string;
  totalTime: number;
  stepTimings: TurnStepTiming[];
  population: number;
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
}

/**
 * Dependencies that CityTurnProcessingService needs from CityManager
 */
export interface CityTurnProcessingDependencies {
  gameId: string;
  cities: Map<string, CityState>;
  callbacks: CityManagerCallbacks;
  effectsManager: EffectsManager;
  io?: SocketServer;
  governorService?: CityGovernorService;
  tileManagementService?: CityTileManagementService;

  // Method dependencies (functions from CityManager)
  refreshCityWithGovernmentEffects: (cityId: string) => void;
  calculateCityOutputs: (cityId: string) => any;
  calculateHappiness: (cityId: string) => any;
  applyCityHappiness?: (cityId: string) => void;
  getPlayerGovernment?: (playerId: string) => string;
  checkPollution: (cityId: string, currentTurn: number) => Promise<boolean>;
  canCityContinueProduction?: (cityId: string, kind: 'unit' | 'building', value: string) => boolean;
  forceGovernmentRevolution?: (playerId: string) => Promise<void>;
  saveCityToDatabase: (city: CityState) => Promise<void>;
}

/**
 * CityTurnProcessingService handles the complete city turn processing pipeline
 */
export class CityTurnProcessingService extends BaseGameService {
  private dependencies: CityTurnProcessingDependencies;
  private readonly effectsManager: EffectsManager;

  constructor(dependencies: CityTurnProcessingDependencies) {
    super(logger);
    this.dependencies = dependencies;
    this.effectsManager = dependencies.effectsManager;
  }

  getServiceName(): string {
    return 'CityTurnProcessingService';
  }

  /**
   * Process a single city's turn with comprehensive timing and error handling
   */
  async processCityTurn(cityId: string, currentTurn: number): Promise<void> {
    const city = this.dependencies.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot process turn for city: ${cityId} - city not found`);
      return;
    }

    const startTime = Date.now();
    const stepTimings: TurnStepTiming[] = [];
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
      this.dependencies.refreshCityWithGovernmentEffects(cityId);
      recordStep('government_effects');

      // Apply automated governor if enabled
      if (this.dependencies.governorService && city.governor?.isEnabled) {
        await this.dependencies.governorService.applyGovernorAutomation(cityId);
      }
      recordStep('governor_automation');

      // Calculate city outputs
      this.dependencies.calculateCityOutputs(cityId);
      recordStep('calculate_outputs');

      // Happiness must be refreshed before outputs are accumulated because
      // disorder suppresses the current turn's surplus.
      this.dependencies.applyCityHappiness?.(cityId);
      const inDisorder = city.happiness.unhappy + 2 * city.happiness.angry > city.happiness.happy;
      if (inDisorder) {
        city.foodPerTurn = Math.min(0, city.foodPerTurn ?? 0);
        city.productionPerTurn = 0;
        city.sciencePerTurn = 0;
        city.goldPerTurn = 0;
        city.luxuryPerTurn = 0;
      }
      await this.processCivilDisorder(city, inDisorder);
      recordStep('happiness');

      // Trigger callback for city turn processing (science accumulation)
      if (this.dependencies.callbacks.onCityTurnProcessed) {
        this.dependencies.callbacks.onCityTurnProcessed(city);
      }
      recordStep('callbacks');

      // Process food and growth
      await this.processFoodAndGrowth(city, currentTurn);
      recordStep('food_growth');

      // Process production
      await this.processProduction(city, currentTurn);
      recordStep('production');
      city.wasHappy = this.isHappy(city);

      await this.dependencies.checkPollution(cityId, currentTurn);
      recordStep('pollution');

      // Save changes to database
      await this.dependencies.saveCityToDatabase(city);
      recordStep('database_save');

      const totalTime = Date.now() - startTime;

      // Log performance details for slow cities or if total time is concerning
      if (totalTime > 2000 || stepTimings.some(s => s.duration > 1000)) {
        logger.warn(`Slow city turn processing detected for ${city.name}`, {
          gameId: this.dependencies.gameId,
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
        gameId: this.dependencies.gameId,
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
        gameId: this.dependencies.gameId,
        cityId,
        cityName: city.name,
      });
    }
  }

  /**
   * Democracy falls after more consecutive disorder turns than allowed by
   * Revolution_Unhappiness. Other governments have a zero threshold.
   * @reference reference/freeciv/server/cityturn.c:3821-3875
   */
  private async processCivilDisorder(city: CityState, inDisorder: boolean): Promise<void> {
    if (!inDisorder) {
      city.disorderTurns = 0;
      return;
    }

    city.disorderTurns = (city.disorderTurns ?? 0) + 1;
    const threshold = this.effectsManager.calculateEffect(EffectType.REVOLUTION_UNHAPPINESS, {
      playerId: city.playerId,
      cityId: city.id,
      government: this.dependencies.getPlayerGovernment?.(city.playerId),
      cityBuildings: new Set(city.buildings),
    }).value;
    if (threshold > 0 && city.disorderTurns > threshold) {
      await this.dependencies.forceGovernmentRevolution?.(city.playerId);
      city.disorderTurns = 0;
    }
  }

  /**
   * Process all cities' turns in parallel
   */
  async processAllCitiesTurn(currentTurn: number): Promise<void> {
    const cityPromises = Array.from(this.dependencies.cities.keys()).map(cityId =>
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

  /**
   * Process food consumption and city growth
   * Public method for testing and external access
   */
  public async processFoodAndGrowth(city: CityState, _currentTurn: number): Promise<void> {
    const foodSurplus = city.foodPerTurn || 0;
    const currentFoodStock = city.foodStock || 0;
    const newFoodStock = currentFoodStock + foodSurplus;

    const granarySize = this.calculateGranarySize(city.population);
    const government = this.dependencies.getPlayerGovernment?.(city.playerId) ?? 'despotism';
    const effectContext = {
      playerId: city.playerId,
      cityId: city.id,
      government,
      cityBuildings: new Set(city.buildings),
    };
    const celebrating = city.wasHappy === true && this.isHappy(city);
    const raptureGrowth =
      foodSurplus > 0 &&
      celebrating &&
      this.effectsManager.calculateEffect(EffectType.RAPTURE_GROW, effectContext).value > 0;

    if ((newFoodStock >= granarySize && foodSurplus > 0) || raptureGrowth) {
      const unlimited =
        this.effectsManager.calculateEffect(EffectType.SIZE_UNLIMIT, effectContext).value > 0;
      const configuredSize = this.effectsManager.calculateEffect(
        EffectType.SIZE_ADJ,
        effectContext
      ).value;
      const sizeLimit = unlimited ? Number.POSITIVE_INFINITY : configuredSize;
      if (city.population >= sizeLimit) {
        city.foodStock = Math.min(newFoodStock, granarySize);
        return;
      }
      // City grows
      const oldSize = city.population;
      city.population += 1;
      city.size = city.population;
      const growthFoodRetention = this.effectsManager.calculateEffect(EffectType.GROWTH_FOOD, {
        playerId: city.playerId,
        cityId: city.id,
        cityBuildings: new Set(city.buildings),
      }).value;
      city.foodStock = raptureGrowth
        ? Math.min(newFoodStock, this.calculateGranarySize(city.population))
        : newFoodStock - granarySize + Math.floor((granarySize * growthFoodRetention) / 100);

      logger.info(`City ${city.name} grew from size ${oldSize} to ${city.population}`);

      // Automatically assign the new citizen to work the best available tile
      if (this.dependencies.tileManagementService && city.workableTiles) {
        // Re-run auto-assignment to allocate the new citizen
        this.dependencies.tileManagementService.reassignCitizensAfterGrowth(city);
      }

      // Recalculate outputs after assigning new citizen
      this.dependencies.calculateCityOutputs(city.id);

      if (this.dependencies.callbacks.onCityGrowth) {
        this.dependencies.callbacks.onCityGrowth(city, oldSize);
      }
    } else if (newFoodStock < 0) {
      // City starves
      city.foodStock = 0;
      if (city.population > 1) {
        city.population -= 1;
        city.size = city.population;
        const shrinkFoodRetention = this.effectsManager.calculateEffect(EffectType.SHRINK_FOOD, {
          playerId: city.playerId,
          cityId: city.id,
          cityBuildings: new Set(city.buildings),
        }).value;
        city.foodStock = Math.floor(
          (this.calculateGranarySize(city.population) * shrinkFoodRetention) / 100
        );
        logger.info(`City ${city.name} starved and lost population`);
      }
    } else {
      city.foodStock = newFoodStock;
    }
  }

  private isHappy(city: CityState): boolean {
    return (
      city.population >= 3 &&
      city.happiness.unhappy === 0 &&
      city.happiness.angry === 0 &&
      city.happiness.happy >= Math.ceil(city.population / 2)
    );
  }

  /**
   * Process production accumulation and completion
   */
  private async processProduction(city: CityState, _currentTurn: number): Promise<void> {
    // Recovery guard for older saves and concurrent queue edits: an idle city
    // with a worklist should promote the first valid target before accumulating
    // shields.
    while (!city.currentProduction && city.worklist.length > 0) {
      const next = city.worklist.shift() as ProductionItem;
      const nextType = next.kind === 'wonder' ? 'building' : next.kind;
      const exists =
        (nextType === 'unit' && Boolean(UNIT_TYPES[next.value])) ||
        (nextType === 'building' && Boolean(BUILDING_TYPES[next.value]));
      if (
        exists &&
        (this.dependencies.canCityContinueProduction?.(city.id, nextType, next.value) ?? true)
      ) {
        city.currentProduction = next.value;
        city.productionType = nextType;
      }
    }
    if (!city.currentProduction) {
      return;
    }

    // Wealth is an indefinite conversion mode, not a project. Its shield
    // output is converted to gold during city output calculation, so it must
    // never accumulate shields or complete at the ruleset's 999 sentinel cost.
    if (city.currentProduction === WEALTH_PRODUCTION_ID) {
      city.productionStock = 0;
      city.shieldStock = 0;
      city.turnsToComplete = 0;
      return;
    }

    const productionPerTurn = city.productionPerTurn || 0;
    const currentProductionStock = city.productionStock ?? city.shieldStock ?? 0;
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
      city.shieldStock = 0;
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
      const populationCost =
        city.productionType === 'unit' ? (UNIT_TYPES[city.currentProduction]?.pop_cost ?? 0) : 0;
      // The default Freeciv city option does not allow a population-cost unit
      // to consume the city's final citizen.
      if (populationCost > 0 && city.population <= populationCost) {
        city.productionStock = newProductionStock;
        city.shieldStock = newProductionStock;
        city.turnsToComplete = 0;
        return;
      }
      // Production completed
      city.productionStock = newProductionStock;
      city.shieldStock = newProductionStock;
      if (populationCost > 0) {
        city.population -= populationCost;
        city.size = city.population;
      }
      await this.completeProduction(city.id, productionCost);
    } else {
      city.productionStock = newProductionStock;
      city.shieldStock = newProductionStock;
      city.turnsToComplete = Math.ceil(
        (productionCost - newProductionStock) / Math.max(1, productionPerTurn)
      );
    }
  }

  /**
   * Handle production completion
   */
  private async completeProduction(cityId: string, productionCost: number): Promise<void> {
    const city = this.dependencies.cities.get(cityId);
    if (!city || !city.currentProduction) {
      return;
    }

    const productionItem: ProductionItem = {
      kind: city.productionType as 'unit' | 'building',
      value: city.currentProduction,
    };

    if (city.productionType === 'building') {
      // Add the building to the city
      if (
        !isSpaceshipPart(city.currentProduction) &&
        !city.buildings.includes(city.currentProduction)
      ) {
        city.buildings.push(city.currentProduction);
      }
    } else if (city.productionType === 'unit') {
      // Unit creation is handled by the onCityProductionComplete callback
      // which properly integrates with UnitManager
    }

    // Store production details before resetting
    const completedProductionType = city.productionType as 'unit' | 'building' | 'wonder';
    const completedProductionId = city.currentProduction;

    // Freeciv subtracts only the completed target's cost, retaining excess
    // shields for the next target instead of discarding the entire stock.
    // @reference reference/freeciv/server/cityturn.c:2784-2786
    // @reference reference/freeciv/server/cityturn.c:3054-3062
    const remainingStock = Math.max(
      0,
      (city.productionStock ?? city.shieldStock ?? 0) - productionCost
    );

    // Clear the completed target while retaining its carryover.
    city.currentProduction = null;
    city.productionType = null;
    city.productionStock = remainingStock;
    city.shieldStock = remainingStock;
    city.turnsToComplete = 0;

    // Commit national/unit state before validating the next worklist item.
    // This is significant for capped repeatable projects such as spaceship
    // parts: the newly completed part must count against the next choice.
    if (this.dependencies.callbacks.onCityProductionComplete) {
      const result = this.dependencies.callbacks.onCityProductionComplete(city, productionItem);
      if (result instanceof Promise) {
        await result;
      }
    }

    // Continue with the next authoritative worklist item. Invalidated items
    // are discarded rather than leaving the city permanently idle.
    while (city.worklist.length > 0 && !city.currentProduction) {
      const next = city.worklist.shift() as ProductionItem;
      const nextType = next.kind === 'wonder' ? 'building' : next.kind;
      const exists =
        (nextType === 'unit' && Boolean(UNIT_TYPES[next.value])) ||
        (nextType === 'building' && Boolean(BUILDING_TYPES[next.value]));
      if (
        exists &&
        (this.dependencies.canCityContinueProduction?.(city.id, nextType, next.value) ?? true)
      ) {
        city.currentProduction = next.value;
        city.productionType = nextType;
      }
    }

    // Emit socket event if Socket.IO server is available
    if (this.dependencies.io && completedProductionType && completedProductionId) {
      logger.info('Production completed', {
        gameId: this.dependencies.gameId,
        cityId,
        productionType: completedProductionType,
        productionId: completedProductionId,
      });

      // For unit production, let the callback handle unit creation and broadcasting
      // For building production, emit the completion event here
      if (completedProductionType === 'building') {
        this.dependencies.io.to(`game:${this.dependencies.gameId}`).emit('production:completed', {
          cityId,
          productionType: completedProductionType,
          productionId: completedProductionId,
        });
      }
    }
  }

  /**
   * Calculate granary size needed for city growth
   */
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

  /**
   * Get turn processing performance metrics for debugging
   */
  getPerformanceMetrics(): {
    averageTurnTime: number;
    slowCities: string[];
    totalCitiesProcessed: number;
  } {
    // This would be implemented to track performance metrics over time
    // For now, return placeholder values
    return {
      averageTurnTime: 0,
      slowCities: [],
      totalCitiesProcessed: this.dependencies.cities.size,
    };
  }
}
