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
import type { Server as SocketServer } from 'socket.io';
import type { CityGovernorService } from './CityGovernorService';
import type { CityTileManagementService } from './CityTileManagementService';

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

// Define building types (extracted from CityManager)
interface BuildingType {
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

const BUILDING_TYPES: Record<string, BuildingType> = {
  granary: {
    id: 'granary',
    name: 'Granary',
    cost: 60,
    effects: {
      foodBonus: 50,
    },
  },
  temple: {
    id: 'temple',
    name: 'Temple',
    cost: 40,
    effects: {
      happinessEffect: 2,
    },
  },
  marketplace: {
    id: 'marketplace',
    name: 'Marketplace',
    cost: 80,
    effects: {
      goldBonus: 50,
    },
  },
  library: {
    id: 'library',
    name: 'Library',
    cost: 80,
    effects: {
      scienceBonus: 50,
    },
  },
  walls: {
    id: 'walls',
    name: 'City Walls',
    cost: 120,
    effects: {
      defenseBonus: 200,
    },
  },
  factory: {
    id: 'factory',
    name: 'Factory',
    cost: 140,
    effects: {
      productionBonus: 50,
    },
  },
  palace: {
    id: 'palace',
    name: 'Palace',
    cost: 100,
    effects: {
      defenseBonus: 100,
    },
  },
};

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
  io?: SocketServer;
  governorService?: CityGovernorService;
  tileManagementService?: CityTileManagementService;

  // Method dependencies (functions from CityManager)
  refreshCityWithGovernmentEffects: (cityId: string) => void;
  optimizeCitizens: (cityId: string) => Promise<boolean>;
  calculateCityOutputs: (cityId: string) => any;
  calculateHappiness: (cityId: string) => any;
  saveCityToDatabase: (city: CityState) => Promise<void>;
}

/**
 * CityTurnProcessingService handles the complete city turn processing pipeline
 */
export class CityTurnProcessingService extends BaseGameService {
  private dependencies: CityTurnProcessingDependencies;

  constructor(dependencies: CityTurnProcessingDependencies) {
    super(logger);
    this.dependencies = dependencies;
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

      // Optimize citizen assignments
      await this.dependencies.optimizeCitizens(cityId);
      recordStep('citizen_optimization');

      // Calculate city outputs
      this.dependencies.calculateCityOutputs(cityId);
      recordStep('calculate_outputs');

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

      // Process happiness
      this.dependencies.calculateHappiness(cityId);
      recordStep('happiness');

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
   */
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
      if (this.dependencies.tileManagementService && city.workableTiles) {
        // Re-run auto-assignment to allocate the new citizen
        this.dependencies.tileManagementService.reassignCitizensAfterGrowth(city);
      }
      // Re-optimize citizens after growth to ensure best assignment
      await this.dependencies.optimizeCitizens(city.id);

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
        logger.info(`City ${city.name} starved and lost population`);
      }
    } else {
      city.foodStock = newFoodStock;
    }
  }

  /**
   * Process production accumulation and completion
   */
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

  /**
   * Handle production completion
   */
  private async completeProduction(cityId: string): Promise<void> {
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
      if (!city.buildings.includes(city.currentProduction)) {
        city.buildings.push(city.currentProduction);
      }
    } else if (city.productionType === 'unit') {
      // Unit creation is handled by the onCityProductionComplete callback
      // which properly integrates with UnitManager
    }

    // Store production details before resetting
    const completedProductionType = city.productionType as 'unit' | 'building' | 'wonder';
    const completedProductionId = city.currentProduction;

    // Reset production
    city.currentProduction = null;
    city.productionType = null;
    city.productionStock = 0;
    city.turnsToComplete = 0;

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

    // Trigger callback
    if (this.dependencies.callbacks.onCityProductionComplete) {
      const result = this.dependencies.callbacks.onCityProductionComplete(city, productionItem);
      if (result instanceof Promise) {
        // Handle async callback without blocking
        result.catch(error => {
          logger.error('Error in onCityProductionComplete callback', {
            error: error instanceof Error ? error.message : 'Unknown error',
            cityId: city.id,
            productionItem,
          });
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
