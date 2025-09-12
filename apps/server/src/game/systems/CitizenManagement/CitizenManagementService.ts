/**
 * CitizenManagementService - Main service for citizen assignment optimization
 * @reference freeciv/common/aicore/cm.c - main CM functions
 * 
 * Provides the primary interface for optimizing citizen assignments in cities
 */

import type { CityState } from '@game/managers/CityManager';
import type { CitizenParameter } from './CitizenParameter';
import type { CitizenResult } from './CitizenResult';
import { CitizenParameterFactory } from './CitizenParameter';
import { CitizenResultFactory } from './CitizenResult';
import { logger } from '@utils/logger';

/**
 * Main service for citizen management optimization
 * This will be the primary interface used by CityManager and other services
 */
export class CitizenManagementService {
  private static instance: CitizenManagementService;
  
  /** Cache of results for performance */
  private resultCache = new Map<string, CitizenResult>();
  
  /** Whether the service has been initialized */
  private initialized = false;

  private constructor() {}

  public static getInstance(): CitizenManagementService {
    if (!CitizenManagementService.instance) {
      CitizenManagementService.instance = new CitizenManagementService();
    }
    return CitizenManagementService.instance;
  }

  /**
   * Initialize the citizen management system
   * @reference freeciv/common/aicore/cm.c - cm_init()
   */
  public initialize(): void {
    if (this.initialized) {
      return;
    }

    // Initialize any global data structures
    this.resultCache.clear();
    this.initialized = true;
    
    logger.info('CitizenManagement system initialized');
  }

  /**
   * Query for optimal citizen assignment
   * @reference freeciv/common/aicore/cm.c - cm_query_result()
   * 
   * @param city The city to optimize
   * @param parameters Optimization parameters
   * @param allowNegative Whether to allow negative surpluses
   * @returns Optimal citizen assignment result
   */
  public queryResult(
    city: CityState,
    parameters?: CitizenParameter,
    allowNegative: boolean = false
  ): CitizenResult {
    // Use default parameters if none provided
    const params = parameters || CitizenParameterFactory.createDefault();
    
    // Check cache first
    const cacheKey = this.generateCacheKey(city, params);
    const cachedResult = this.resultCache.get(cacheKey);
    if (cachedResult) {
      logger.debug('Using cached citizen management result', { cityId: city.id });
      return cachedResult;
    }

    // For now, return a placeholder result
    // TODO: Implement the actual optimization algorithm
    const result = this.performOptimization(city, params, allowNegative);
    
    // Cache the result
    this.resultCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Clear optimization cache for a specific city
   * @reference freeciv/common/aicore/cm.c - cm_clear_cache()
   */
  public clearCache(city: CityState): void {
    // Remove all cache entries for this city
    const keysToRemove = Array.from(this.resultCache.keys())
      .filter(key => key.startsWith(`${city.id}:`));
    
    for (const key of keysToRemove) {
      this.resultCache.delete(key);
    }
    
    logger.debug('Cleared citizen management cache', { cityId: city.id });
  }

  /**
   * Clear all optimization caches
   */
  public clearAllCaches(): void {
    this.resultCache.clear();
    logger.debug('Cleared all citizen management caches');
  }

  /**
   * Get optimal citizen assignment using default parameters
   * Convenience method for common usage
   */
  public getOptimalAssignment(city: CityState): CitizenResult {
    return this.queryResult(city, CitizenParameterFactory.createDefault());
  }

  /**
   * Get growth-focused citizen assignment
   */
  public getGrowthFocusedAssignment(city: CityState): CitizenResult {
    return this.queryResult(city, CitizenParameterFactory.createGrowthFocused());
  }

  /**
   * Get production-focused citizen assignment
   */
  public getProductionFocusedAssignment(city: CityState): CitizenResult {
    return this.queryResult(city, CitizenParameterFactory.createProductionFocused());
  }

  /**
   * Get trade-focused citizen assignment
   */
  public getTradeFocusedAssignment(city: CityState): CitizenResult {
    return this.queryResult(city, CitizenParameterFactory.createTradeFocused());
  }

  /**
   * Generate a cache key for a city and parameters
   */
  private generateCacheKey(city: CityState, parameters: CitizenParameter): string {
    // Create a simple hash of the city state and parameters that affect optimization
    const cityHash = `${city.id}:${city.population}:${city.x}:${city.y}`;
    const paramsHash = JSON.stringify({
      factors: parameters.factor,
      minimal: parameters.minimal_surplus,
      flags: {
        max_growth: parameters.max_growth,
        require_happy: parameters.require_happy,
        allow_disorder: parameters.allow_disorder,
        allow_specialists: parameters.allow_specialists,
      }
    });
    
    return `${cityHash}:${Buffer.from(paramsHash).toString('base64')}`;
  }

  /**
   * Perform the actual citizen optimization
   * TODO: This is a placeholder that will be replaced with the full algorithm
   */
  private performOptimization(
    city: CityState,
    parameters: CitizenParameter,
    allowNegative: boolean
  ): CitizenResult {
    logger.debug('Performing citizen optimization', { 
      cityId: city.id, 
      population: city.population,
      allowNegative 
    });

    // For now, create a simple result that works all available tiles
    // This will be replaced with the full branch-and-bound algorithm
    const result = CitizenResultFactory.create(5); // Assume radius 5 for now
    
    // Mark as successful for now
    result.found_valid = true;
    result.aborted = false;
    
    // Simple assignment: work as many tiles as we have population
    // This is a placeholder - the real algorithm will be much more sophisticated
    const availableTiles = city.workableTiles?.length || 0;
    const citizensToAssign = Math.min(city.population, availableTiles);
    
    for (let i = 0; i < citizensToAssign && i < result.worker_positions.length; i++) {
      result.worker_positions[i] = true;
    }
    
    result.workers_count = citizensToAssign;
    result.specialists_count = city.population - citizensToAssign;
    
    // Calculate basic surplus (placeholder)
    // TODO: Calculate actual surplus based on worked tiles and specialists
    result.surplus = {
      food: Math.max(0, city.foodPerTurn - city.population),
      shield: city.productionPerTurn,
      trade: city.tradePerTurn,
      gold: 0,
      luxury: 0,
      science: city.sciencePerTurn,
    };
    
    // Simple fitness calculation
    result.fitness = Object.entries(result.surplus).reduce((sum, [type, amount]) => {
      return sum + amount * parameters.factor[type as keyof typeof parameters.factor];
    }, 0);

    logger.debug('Citizen optimization completed', {
      cityId: city.id,
      workers: result.workers_count,
      specialists: result.specialists_count,
      fitness: result.fitness
    });

    return result;
  }

  /**
   * Shutdown the service and clean up resources
   */
  public shutdown(): void {
    this.clearAllCaches();
    this.initialized = false;
    logger.info('CitizenManagement system shutdown');
  }
}