/**
 * CityOptimizationService - Handles citizen assignment optimization
 *
 * Extracted from CityManager.ts to create a dedicated service for citizen optimization.
 * This service handles all aspects of optimizing citizen assignments including:
 * - Automated citizen assignment optimization using CitizenManagementService
 * - Manual citizen assignment to specific tiles
 * - Specialist assignment optimization
 * - Optimization parameter management
 * - Integration with tile management and citizen management systems
 *
 * @reference freeciv/common/city.c - citizen assignment
 * @reference freeciv-web/javascript/city.js - citizen management
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { CitizenManagementService } from '@game/systems/CitizenManagement/CitizenManagementService';
import { CitizenParameterFactory } from '@game/systems/CitizenManagement/CitizenParameter';
import { OutputType } from '@game/constants/GameConstants';
import type { CityTileManagementService } from './CityTileManagementService';

// Re-export shared types
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
  governor?: {
    isEnabled: boolean;
    priority: GovernorPriority;
    settings: {
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    };
    citizenParameters?: any;
  };
  worklist: any[];
  defenseStrength?: number;
}

export interface WorkableTile {
  x: number;
  y: number;
  isWorked: boolean;
  isCenter?: boolean;
  isBlocked?: boolean;
  outputs: {
    food: number;
    shields: number;
    trade: number;
  };
  terrain?: string;
  resource?: string;
  improvements?: string[];
}

export enum SpecialistType {
  SCIENTIST = 0,
  TAX_COLLECTOR = 1,
  ENTERTAINER = 2,
  WORKER = 3,
  ENGINEER = 4,
  MERCHANT = 5,
}

export enum GovernorPriority {
  BALANCED = 'balanced',
  FOOD = 'food',
  SHIELDS = 'shields',
  TRADE = 'trade',
  SCIENCE = 'science',
  GOLD = 'gold',
  LUXURY = 'luxury',
}

/**
 * Citizen optimization result
 */
export interface OptimizationResult {
  success: boolean;
  cityId: string;
  previousAssignments?: {
    workedTiles: number;
    specialists: Record<number, number>;
  };
  newAssignments: {
    workedTiles: number;
    specialists: Record<number, number>;
  };
  outputChanges: {
    food: number;
    shields: number;
    trade: number;
    science: number;
  };
  fitness: number;
  reason?: string; // If success is false
}

/**
 * Optimization parameters interface
 */
export interface OptimizationParameters {
  priority: 'food' | 'shields' | 'trade' | 'science' | 'balanced';
  preventStarvation: boolean;
  allowNegativeSurpluses: boolean;
  minimumFood?: number;
  minimumShields?: number;
  preferSpecialists?: boolean;
  maxSpecialists?: number;
  tilePreferences?: Array<{
    terrain: string;
    modifier: number; // Multiplier for tile value
  }>;
}

/**
 * CityOptimizationService handles all citizen assignment optimization
 */
export class CityOptimizationService extends BaseGameService {
  private citizenManagementService: CitizenManagementService;
  private cities: Map<string, CityState>;
  private tileManagementService?: CityTileManagementService;

  constructor(
    cities: Map<string, CityState>,
    citizenManagementService: CitizenManagementService,
    tileManagementService?: CityTileManagementService
  ) {
    super(logger);
    this.cities = cities;
    this.citizenManagementService = citizenManagementService;
    this.tileManagementService = tileManagementService;
  }

  getServiceName(): string {
    return 'CityOptimizationService';
  }

  /**
   * Set the tile management service dependency
   */
  setTileManagementService(service: CityTileManagementService): void {
    this.tileManagementService = service;
  }

  /**
   * Optimize citizen assignments for a city
   * @param cityId City to optimize
   * @param parameters Optional optimization parameters
   * @returns Optimization result
   */
  async optimizeCitizens(
    cityId: string,
    parameters?: OptimizationParameters
  ): Promise<OptimizationResult> {
    if (!this.citizenManagementService || !this.tileManagementService) {
      logger.warn(`Cannot optimize citizens for city ${cityId} - services not available`);
      return {
        success: false,
        cityId,
        newAssignments: { workedTiles: 0, specialists: {} },
        outputChanges: { food: 0, shields: 0, trade: 0, science: 0 },
        fitness: 0,
        reason: 'Required services not available',
      };
    }

    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot optimize citizens - city ${cityId} not found`);
      return {
        success: false,
        cityId,
        newAssignments: { workedTiles: 0, specialists: {} },
        outputChanges: { food: 0, shields: 0, trade: 0, science: 0 },
        fitness: 0,
        reason: 'City not found',
      };
    }

    try {
      // Store previous assignments for comparison
      const previousAssignments = {
        workedTiles: city.workableTiles?.filter(t => t.isWorked).length || 0,
        specialists: { ...city.specialists },
      };

      // Use provided parameters, or stored parameters, or default parameters
      const optimizationParams =
        parameters || this.getCitizenParameters(cityId) || CitizenParameterFactory.createDefault();

      // Get workable tiles for the optimization
      const workableTiles = this.tileManagementService.getWorkableTiles(cityId);
      if (!workableTiles) {
        logger.warn(`Cannot optimize citizens - no workable tiles for city ${cityId}`);
        return {
          success: false,
          cityId,
          newAssignments: { workedTiles: 0, specialists: {} },
          outputChanges: { food: 0, shields: 0, trade: 0, science: 0 },
          fitness: 0,
          reason: 'No workable tiles available',
        };
      }

      // Store previous outputs for comparison
      const previousOutputs = {
        food: city.foodPerTurn || 0,
        shields: city.productionPerTurn || 0,
        trade: city.tradePerTurn || 0,
        science: city.sciencePerTurn || 0,
      };

      // Run the optimization
      const result = this.citizenManagementService.queryResult(
        city,
        optimizationParams,
        !optimizationParams.allowNegativeSurpluses // Don't allow negative surpluses by default
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
            // The city center is worked for free and is never a citizen
            // assignment. Optimizer output must not be allowed to unwork it.
            city.workableTiles[i].isWorked =
              city.workableTiles[i].isCenter || result.worker_positions[i];
          }
        }

        // Update specialist assignments
        city.specialists = { ...result.specialists };

        // Update output calculations based on optimized assignments
        city.foodPerTurn = result.surplus[OutputType.FOOD];
        city.productionPerTurn = result.surplus[OutputType.SHIELD];
        city.tradePerTurn = result.surplus[OutputType.TRADE];
        city.sciencePerTurn = result.surplus[OutputType.SCIENCE];

        const newAssignments = {
          workedTiles: city.workableTiles?.filter(t => t.isWorked).length || 0,
          specialists: { ...city.specialists },
        };

        const outputChanges = {
          food: (city.foodPerTurn || 0) - previousOutputs.food,
          shields: (city.productionPerTurn || 0) - previousOutputs.shields,
          trade: (city.tradePerTurn || 0) - previousOutputs.trade,
          science: (city.sciencePerTurn || 0) - previousOutputs.science,
        };

        logger.debug(`Successfully optimized citizens for city ${city.name}`, {
          cityId,
          fitness: result.fitness,
          workersCount: result.workers_count,
          specialistsCount: result.specialists_count,
        });

        return {
          success: true,
          cityId,
          previousAssignments,
          newAssignments,
          outputChanges,
          fitness: result.fitness,
        };
      } else {
        logger.warn(`Citizen optimization failed for city ${city.name}`, {
          cityId,
          aborted: result.aborted,
        });

        return {
          success: false,
          cityId,
          newAssignments: { workedTiles: 0, specialists: {} },
          outputChanges: { food: 0, shields: 0, trade: 0, science: 0 },
          fitness: 0,
          reason: `Optimization aborted: ${result.aborted}`,
        };
      }
    } catch (error) {
      logger.error(`Error optimizing citizens for city ${city.name}`, {
        cityId,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: false,
        cityId,
        newAssignments: { workedTiles: 0, specialists: {} },
        outputChanges: { food: 0, shields: 0, trade: 0, science: 0 },
        fitness: 0,
        reason: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Public method to manually optimize a city's citizens
   * @param cityId The city to optimize
   * @param parameters Optional optimization parameters
   */
  async optimizeCityManually(
    cityId: string,
    parameters?: OptimizationParameters
  ): Promise<OptimizationResult> {
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
    if (city.governor && city.governor.citizenParameters) {
      return city.governor.citizenParameters;
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

    // Store citizen parameters
    city.governor.citizenParameters = parameters;

    return true;
  }

  /**
   * Assign a citizen to work a specific tile
   * @param cityId City ID
   * @param tileX Tile X coordinate
   * @param tileY Tile Y coordinate
   * @returns Success status
   */
  async assignCitizenToTile(cityId: string, tileX: number, tileY: number): Promise<boolean> {
    if (!this.tileManagementService) return false;
    return this.tileManagementService.assignCitizenToTile(cityId, tileX, tileY);
  }

  /**
   * Convert a tile worker to a specialist
   * @param cityId City ID
   * @param tileX Tile X coordinate
   * @param tileY Tile Y coordinate
   * @param specialistType Type of specialist to create
   * @returns Success status
   */
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

  /**
   * Get workable tiles for a city
   * @param cityId City ID
   * @returns Array of workable tiles or null
   */
  getWorkableTiles(cityId: string): WorkableTile[] | null {
    if (!this.tileManagementService) return null;
    return this.tileManagementService.getWorkableTiles(cityId);
  }

  /**
   * Create default optimization parameters based on governor priority
   * @param priority Governor priority
   * @returns Optimization parameters
   */
  createOptimizationParameters(priority: GovernorPriority): OptimizationParameters {
    const baseParams: OptimizationParameters = {
      priority: 'balanced',
      preventStarvation: true,
      allowNegativeSurpluses: false,
      minimumFood: 2,
      preferSpecialists: false,
    };

    switch (priority) {
      case GovernorPriority.FOOD:
        return {
          ...baseParams,
          priority: 'food',
          minimumFood: 4,
        };
      case GovernorPriority.SHIELDS:
        return {
          ...baseParams,
          priority: 'shields',
          minimumShields: 2,
        };
      case GovernorPriority.TRADE:
        return {
          ...baseParams,
          priority: 'trade',
          preferSpecialists: true,
        };
      case GovernorPriority.SCIENCE:
        return {
          ...baseParams,
          priority: 'science',
          preferSpecialists: true,
          maxSpecialists: 6,
        };
      case GovernorPriority.GOLD:
        return {
          ...baseParams,
          priority: 'trade', // Trade converts to gold
          preferSpecialists: true,
        };
      case GovernorPriority.LUXURY:
        return {
          ...baseParams,
          priority: 'trade',
          preferSpecialists: true,
          maxSpecialists: 4,
        };
      default:
        return baseParams;
    }
  }

  /**
   * Analyze citizen assignment efficiency
   * @param cityId City ID
   * @returns Efficiency analysis
   */
  analyzeCitizenEfficiency(cityId: string): {
    efficiency: number; // 0-100 scale
    recommendations: string[];
    unusedPotential: {
      food: number;
      shields: number;
      trade: number;
    };
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        efficiency: 0,
        recommendations: ['City not found'],
        unusedPotential: { food: 0, shields: 0, trade: 0 },
      };
    }

    const workableTiles = this.getWorkableTiles(cityId);
    if (!workableTiles) {
      return {
        efficiency: 0,
        recommendations: ['Cannot analyze - no tile data available'],
        unusedPotential: { food: 0, shields: 0, trade: 0 },
      };
    }

    // Calculate current output
    const currentOutput = {
      food: city.foodPerTurn || 0,
      shields: city.productionPerTurn || 0,
      trade: city.tradePerTurn || 0,
    };

    // Calculate potential output if all best tiles were worked
    const availableTiles = workableTiles.filter(t => !t.isBlocked && !t.isCenter);
    const bestTiles = availableTiles
      .sort((a, b) => {
        const aTotal = a.outputs.food + a.outputs.shields + a.outputs.trade;
        const bTotal = b.outputs.food + b.outputs.shields + b.outputs.trade;
        return bTotal - aTotal;
      })
      .slice(0, Math.min(city.population, availableTiles.length));

    const potentialOutput = bestTiles.reduce(
      (total, tile) => ({
        food: total.food + tile.outputs.food,
        shields: total.shields + tile.outputs.shields,
        trade: total.trade + tile.outputs.trade,
      }),
      { food: 2, shields: 1, trade: 1 } // City center base
    );

    // Calculate efficiency
    const currentTotal = currentOutput.food + currentOutput.shields + currentOutput.trade;
    const potentialTotal = potentialOutput.food + potentialOutput.shields + potentialOutput.trade;
    const efficiency = potentialTotal > 0 ? Math.round((currentTotal / potentialTotal) * 100) : 0;

    // Calculate unused potential
    const unusedPotential = {
      food: Math.max(0, potentialOutput.food - currentOutput.food),
      shields: Math.max(0, potentialOutput.shields - currentOutput.shields),
      trade: Math.max(0, potentialOutput.trade - currentOutput.trade),
    };

    // Generate recommendations
    const recommendations: string[] = [];

    if (efficiency < 80) {
      recommendations.push('Consider running citizen optimization to improve efficiency');
    }

    if (unusedPotential.food > 2) {
      recommendations.push(
        `${unusedPotential.food} additional food available from better tile assignments`
      );
    }

    if (unusedPotential.shields > 1) {
      recommendations.push(
        `${unusedPotential.shields} additional shields available from better tile assignments`
      );
    }

    if (unusedPotential.trade > 1) {
      recommendations.push(
        `${unusedPotential.trade} additional trade available from better tile assignments`
      );
    }

    const unusedTiles = availableTiles.filter(t => !t.isWorked).length;
    if (unusedTiles > 0 && city.population < availableTiles.length + 1) {
      recommendations.push(`${unusedTiles} workable tiles not being used - consider city growth`);
    }

    return {
      efficiency,
      recommendations,
      unusedPotential,
    };
  }

  /**
   * Get optimization statistics for all cities
   * @returns Overall optimization statistics
   */
  getOptimizationStatistics(): {
    totalCities: number;
    averageEfficiency: number;
    citiesNeedingOptimization: string[];
    totalUnusedPotential: {
      food: number;
      shields: number;
      trade: number;
    };
  } {
    const stats = {
      totalCities: this.cities.size,
      averageEfficiency: 0,
      citiesNeedingOptimization: [] as string[],
      totalUnusedPotential: { food: 0, shields: 0, trade: 0 },
    };

    if (this.cities.size === 0) {
      return stats;
    }

    let totalEfficiency = 0;

    for (const [cityId, city] of this.cities.entries()) {
      const analysis = this.analyzeCitizenEfficiency(cityId);
      totalEfficiency += analysis.efficiency;

      if (analysis.efficiency < 80) {
        stats.citiesNeedingOptimization.push(city.name);
      }

      stats.totalUnusedPotential.food += analysis.unusedPotential.food;
      stats.totalUnusedPotential.shields += analysis.unusedPotential.shields;
      stats.totalUnusedPotential.trade += analysis.unusedPotential.trade;
    }

    stats.averageEfficiency = Math.round(totalEfficiency / this.cities.size);

    return stats;
  }
}
