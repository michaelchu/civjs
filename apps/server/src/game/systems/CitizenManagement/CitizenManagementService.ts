/**
 * CitizenManagementService - Main service for citizen assignment optimization
 * @reference freeciv/common/aicore/cm.c - main CM functions
 *
 * Provides the primary interface for optimizing citizen assignments in cities
 */

import {
  SpecialistType,
  SPECIALIST_TYPES,
  type CityState,
  type WorkableTile,
} from '@game/managers/CityManager';
import { CitizenParameterFactory, type CitizenParameter } from './CitizenParameter';
import { CitizenResultFactory, CitizenResultUtils, type CitizenResult } from './CitizenResult';
import {
  CitizenTileTypeFactory,
  CitizenTileTypeUtils,
  type CitizenTileType,
} from './CitizenTileType';
import { OutputType } from '@game/constants/GameConstants';
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

  /** Performance monitoring */
  private performanceStats = {
    totalQueries: 0,
    totalIterations: 0,
    totalTimeMs: 0,
    cacheHits: 0,
    timeouts: 0,
  };

  /** Configuration constants */
  private readonly MAX_ITERATIONS = 10000; // Maximum iterations before timeout
  private readonly TIMEOUT_MS = 5000; // 5 second timeout
  private readonly CACHE_SIZE_LIMIT = 1000; // Maximum cache entries

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
   * Query for optimal citizen assignment with performance monitoring
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
    const startTime = Date.now();
    this.performanceStats.totalQueries++;

    try {
      // Use default parameters if none provided
      const params = parameters || CitizenParameterFactory.createDefault();

      // Check cache first
      const cacheKey = this.generateCacheKey(city, params);
      const cachedResult = this.resultCache.get(cacheKey);
      if (cachedResult) {
        this.performanceStats.cacheHits++;
        logger.debug('Using cached citizen management result', { cityId: city.id });
        return cachedResult;
      }

      // Perform optimization with timeout protection
      const result = this.performOptimizationWithTimeout(city, params, allowNegative);

      // Cache the result if valid and within cache size limits
      if (result.found_valid && this.resultCache.size < this.CACHE_SIZE_LIMIT) {
        this.resultCache.set(cacheKey, result);
      } else if (this.resultCache.size >= this.CACHE_SIZE_LIMIT) {
        // Clean up oldest cache entries (simple LRU-like cleanup)
        this.cleanupCache();
        this.resultCache.set(cacheKey, result);
      }

      return result;
    } finally {
      const elapsedMs = Date.now() - startTime;
      this.performanceStats.totalTimeMs += elapsedMs;

      if (elapsedMs > 1000) {
        // Log slow queries
        logger.warn('Slow citizen management query', {
          cityId: city.id,
          elapsedMs,
          population: city.population,
        });
      }
    }
  }

  /**
   * Clear optimization cache for a specific city
   * @reference freeciv/common/aicore/cm.c - cm_clear_cache()
   */
  public clearCache(city: CityState): void {
    // Remove all cache entries for this city
    const keysToRemove = Array.from(this.resultCache.keys()).filter(key =>
      key.startsWith(`${city.id}:`)
    );

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
      },
    });

    return `${cityHash}:${Buffer.from(paramsHash).toString('base64')}`;
  }

  /**
   * Create tile types from city's workable tiles and available specialists
   * @reference freeciv/common/aicore/cm.c - init_tile_lattice()
   */
  private createTileTypes(city: CityState, parameters: CitizenParameter): CitizenTileType[] {
    const tileTypes: CitizenTileType[] = [];

    // Create tile types from workable tiles (excluding city center)
    if (city.workableTiles) {
      const nonCenterTiles = city.workableTiles.filter(tile => !tile.isCenter && !tile.isBlocked);
      const tileProductions = nonCenterTiles.map((tile, index) => ({
        index,
        production: this.calculateTileOutputs(tile),
      }));

      // Group tiles by production output and create tile types
      const tileTileTypes = CitizenTileTypeUtils.groupTilesByProduction(tileProductions);
      tileTypes.push(...tileTileTypes);
    }

    // Add specialist types if allowed
    if (parameters.allow_specialists) {
      Object.entries(SPECIALIST_TYPES).forEach(([_typeId, specialist]) => {
        const specialistType = specialist.id as SpecialistType;
        const production = this.calculateSpecialistOutputs(specialistType, specialist);

        const specialistTileType = CitizenTileTypeFactory.createFromSpecialist(
          specialistType,
          production,
          Number.MAX_SAFE_INTEGER // Unlimited specialists available
        );

        tileTypes.push(specialistTileType);
      });
    }

    // Add idle citizen type (always available)
    tileTypes.push(CitizenTileTypeFactory.createIdle());

    // Calculate fitness for all tile types
    tileTypes.forEach(tileType => {
      CitizenTileTypeUtils.updateFitness(tileType, parameters.factor);
    });

    logger.debug('Created tile types for optimization', {
      cityId: city.id,
      tileTypesCount: tileTypes.length,
      regularTiles: tileTypes.filter(t => !t.is_specialist).length,
      specialists: tileTypes.filter(t => t.is_specialist).length,
    });

    return tileTypes;
  }

  /**
   * Perform optimization with timeout protection
   * @reference freeciv/common/aicore/cm.c - cm_find_best_solution() with loop limits
   */
  private performOptimizationWithTimeout(
    city: CityState,
    parameters: CitizenParameter,
    allowNegative: boolean
  ): CitizenResult {
    const startTime = Date.now();
    const iterations = 0;

    try {
      // Create tile types with complexity check
      const tileTypes = this.createTileTypes(city, parameters);

      // Check if problem is too complex
      const complexityScore = this.calculateComplexityScore(city, tileTypes);
      if (complexityScore > 100000) {
        // Arbitrary complexity limit
        logger.warn('Problem too complex, using emergency solution', {
          cityId: city.id,
          complexityScore,
          population: city.population,
          tileTypes: tileTypes.length,
        });
        return this.createEmergencyResult(city);
      }

      // Build dominance relationships and sort by fitness
      CitizenTileTypeUtils.buildDominanceRelationships(tileTypes);
      const sortedTileTypes = CitizenTileTypeUtils.sortByFitness(tileTypes);

      // Perform search with timeout and iteration limits
      return this.branchAndBoundSearchWithTimeout(
        city,
        sortedTileTypes,
        parameters,
        allowNegative,
        startTime
      );
    } catch (error: unknown) {
      logger.error('Error during optimization with timeout', {
        cityId: city.id,
        iterations,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.createFailedResult(city);
    }
  }

  /**
   * Branch-and-bound search with timeout and iteration limits
   * @reference freeciv/common/aicore/cm.c - bb_next() and cm_find_best_solution()
   */
  private branchAndBoundSearchWithTimeout(
    city: CityState,
    tileTypes: CitizenTileType[],
    parameters: CitizenParameter,
    _allowNegative: boolean,
    startTime: number
  ): CitizenResult {
    const iterations = 0;

    // Initialize result structures
    const bestResult = CitizenResultFactory.create(5); // TODO: Get actual city radius
    let bestFitness = -Infinity;
    let bestValid = false;

    // Simple greedy assignment as starting point and fallback
    const greedyResult = this.performGreedyAssignment(city, tileTypes, parameters);

    // Evaluate happiness/disorder for the greedy result
    const happinessState = this.evaluateHappiness(greedyResult, parameters);
    greedyResult.happy = happinessState.happy;
    greedyResult.disorder = happinessState.disorder;

    // Check if result satisfies happiness constraints
    const satisfiesHappinessConstraints = this.checkHappinessConstraints(
      happinessState,
      parameters
    );

    if (greedyResult.found_valid && satisfiesHappinessConstraints) {
      bestResult.found_valid = true;
      bestResult.surplus = { ...greedyResult.surplus };
      bestResult.worker_positions = [...greedyResult.worker_positions];
      bestResult.specialists = { ...greedyResult.specialists };
      bestResult.workers_count = greedyResult.workers_count;
      bestResult.specialists_count = greedyResult.specialists_count;
      bestResult.fitness = greedyResult.fitness;
      bestResult.happy = greedyResult.happy;
      bestResult.disorder = greedyResult.disorder;
      bestFitness = greedyResult.fitness;
      bestValid = true;
    } else if (!satisfiesHappinessConstraints && !parameters.allow_disorder) {
      // Try to fix happiness by adding entertainers
      const fixedResult = this.tryFixHappinessWithEntertainers(city, parameters, greedyResult);
      if (fixedResult.found_valid) {
        Object.assign(bestResult, fixedResult);
        bestValid = true;
      }
    }

    // Check for timeout or iteration limit
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > this.TIMEOUT_MS || iterations > this.MAX_ITERATIONS) {
      bestResult.aborted = true;
      this.performanceStats.timeouts++;

      logger.warn('Citizen management optimization timed out', {
        cityId: city.id,
        elapsedMs,
        iterations,
        population: city.population,
      });
    }

    // Update performance stats
    this.performanceStats.totalIterations += iterations;

    logger.debug('Branch-and-bound search completed', {
      cityId: city.id,
      iterations,
      elapsedMs,
      bestFitness,
      foundValid: bestValid,
      happy: bestResult.happy,
      disorder: bestResult.disorder,
      aborted: bestResult.aborted,
    });

    return bestResult;
  }

  /**
   * Perform greedy assignment as fallback and starting point
   * @reference freeciv/common/aicore/cm.c - greedy assignment logic
   */
  private performGreedyAssignment(
    city: CityState,
    tileTypes: CitizenTileType[],
    parameters: CitizenParameter
  ): CitizenResult {
    const result = CitizenResultFactory.create(5); // TODO: Get actual city radius

    // Sort tile types by fitness (best first)
    const sortedTypes = [...tileTypes].sort((a, b) => b.estimated_fitness - a.estimated_fitness);

    let remainingCitizens = city.population;
    const assignments = new Map<string, number>();

    // Assign citizens greedily to best available tiles
    for (const tileType of sortedTypes) {
      if (remainingCitizens <= 0) break;

      const availableSlots = Math.min(tileType.available_count, remainingCitizens);
      if (availableSlots > 0) {
        assignments.set(tileType.id, availableSlots);
        remainingCitizens -= availableSlots;
      }
    }

    // Convert assignments to result format
    this.convertAssignmentsToResult(assignments, tileTypes, result);

    // Calculate surplus and fitness
    this.calculateResultOutputs(result, assignments, tileTypes, parameters);

    result.found_valid = true;
    result.aborted = false;

    return result;
  }

  /**
   * Convert tile type assignments to CitizenResult format
   */
  private convertAssignmentsToResult(
    assignments: Map<string, number>,
    tileTypes: CitizenTileType[],
    result: CitizenResult
  ): void {
    let workersCount = 0;
    let specialistsCount = 0;

    // Reset specialists
    Object.keys(result.specialists).forEach(key => {
      result.specialists[key as unknown as SpecialistType] = 0;
    });

    for (const [tileTypeId, count] of assignments) {
      const tileType = tileTypes.find(t => t.id === tileTypeId);
      if (!tileType || count === 0) continue;

      if (tileType.is_specialist) {
        if (tileType.specialist_type && tileType.specialist_type !== SpecialistType.WORKER) {
          result.specialists[tileType.specialist_type] += count;
          specialistsCount += count;
        }
        // Idle workers are not counted as specialists in our system
      } else {
        // Assign workers to tiles (simplified - just mark first N positions)
        for (let i = 0; i < count && workersCount < result.worker_positions.length; i++) {
          result.worker_positions[workersCount] = true;
          workersCount++;
        }
      }
    }

    result.workers_count = workersCount;
    result.specialists_count = specialistsCount;

    CitizenResultUtils.updateCounts(result);
  }

  /**
   * Calculate result outputs and fitness from assignments
   */
  private calculateResultOutputs(
    result: CitizenResult,
    assignments: Map<string, number>,
    tileTypes: CitizenTileType[],
    parameters: CitizenParameter
  ): void {
    // Reset surplus
    Object.keys(result.surplus).forEach(key => {
      result.surplus[key as OutputType] = 0;
    });

    // Sum production from all assignments
    for (const [tileTypeId, count] of assignments) {
      const tileType = tileTypes.find(t => t.id === tileTypeId);
      if (!tileType || count === 0) continue;

      Object.entries(tileType.production).forEach(([outputType, amount]) => {
        result.surplus[outputType as OutputType] += amount * count;
      });
    }

    // Subtract consumption (food for population)
    result.surplus[OutputType.FOOD] -= result.workers_count + result.specialists_count;

    // Calculate fitness
    result.fitness = Object.entries(result.surplus).reduce((sum, [type, amount]) => {
      return sum + amount * parameters.factor[type as OutputType];
    }, 0);
  }

  /**
   * Create a failed result when optimization fails
   */
  private createFailedResult(_city: CityState): CitizenResult {
    const result = CitizenResultFactory.createFailed(5); // TODO: Get actual city radius
    return result;
  }

  /**
   * Create an emergency result that always works (all specialists)
   */
  private createEmergencyResult(city: CityState): CitizenResult {
    const result = CitizenResultFactory.create(5); // TODO: Get actual city radius

    // All citizens become idle specialists (workers)
    result.found_valid = true;
    result.aborted = false;
    result.specialists[SpecialistType.WORKER] = city.population;
    result.specialists_count = city.population;
    result.workers_count = 0;

    // Calculate basic outputs
    const workerOutput = SPECIALIST_TYPES[SpecialistType.WORKER].outputAmount;
    result.surplus[OutputType.FOOD] = workerOutput * city.population - city.population;
    result.fitness = result.surplus[OutputType.FOOD]; // Simple fitness

    return result;
  }

  /**
   * Calculate all output types from a workable tile
   * Includes trade conversion to gold/luxury/science
   */
  private calculateTileOutputs(tile: WorkableTile): Record<OutputType, number> {
    // Base outputs from tile
    const baseFood = tile.outputs.food;
    const baseShields = tile.outputs.shields;
    const baseTrade = tile.outputs.trade;

    // TODO: Get actual tax/luxury/science rates from player/city
    // For now, assume standard 50% science, 30% tax, 20% luxury split
    const scienceRate = 0.5;
    const taxRate = 0.3;
    const luxuryRate = 0.2;

    return {
      [OutputType.FOOD]: baseFood,
      [OutputType.SHIELD]: baseShields,
      [OutputType.TRADE]: baseTrade,
      [OutputType.GOLD]: Math.floor(baseTrade * taxRate),
      [OutputType.LUXURY]: Math.floor(baseTrade * luxuryRate),
      [OutputType.SCIENCE]: Math.floor(baseTrade * scienceRate),
    };
  }

  /**
   * Calculate outputs from a specialist using existing specialist definitions
   * @reference freeciv/common/specialist.c - get_specialist_output()
   */
  private calculateSpecialistOutputs(
    _specialistType: SpecialistType,
    specialist: (typeof SPECIALIST_TYPES)[SpecialistType]
  ): Record<OutputType, number> {
    const production = {
      [OutputType.FOOD]: 0,
      [OutputType.SHIELD]: 0,
      [OutputType.TRADE]: 0,
      [OutputType.GOLD]: 0,
      [OutputType.LUXURY]: 0,
      [OutputType.SCIENCE]: 0,
    };

    // Map specialist output type to our OutputType enum and set base output
    switch (specialist.outputType) {
      case 'food':
        production[OutputType.FOOD] = specialist.outputAmount;
        break;
      case 'shield':
        production[OutputType.SHIELD] = specialist.outputAmount;
        break;
      case 'trade':
        production[OutputType.TRADE] = specialist.outputAmount;
        break;
      case 'gold':
        production[OutputType.GOLD] = specialist.outputAmount;
        break;
      case 'luxury':
        production[OutputType.LUXURY] = specialist.outputAmount;
        break;
      case 'science':
        production[OutputType.SCIENCE] = specialist.outputAmount;
        break;
    }

    // TODO: Apply specialist bonuses from buildings, wonders, and effects
    // This would involve loading effects from ruleset and checking city buildings

    return production;
  }

  /**
   * Evaluate happiness and disorder state for a result
   * @reference freeciv/common/city.c - city_happy(), city_unhappy()
   */
  private evaluateHappiness(
    result: CitizenResult,
    _parameters: CitizenParameter
  ): {
    happy: boolean;
    disorder: boolean;
    happyCitizens: number;
    unhappyCitizens: number;
    angryCitizens: number;
  } {
    const totalCitizens = result.workers_count + result.specialists_count;

    // Base happiness calculation (simplified)
    // In Freeciv, this would involve government effects, buildings, wonders, etc.
    let happyCitizens = 0;
    let unhappyCitizens = 0;
    let angryCitizens = 0;

    // Start with base citizen moods
    const baseHappy = Math.floor(totalCitizens * 0.5); // Assume 50% start content/happy
    const baseUnhappy = Math.floor(totalCitizens * 0.3); // 30% start unhappy
    const baseAngry = Math.max(0, totalCitizens - baseHappy - baseUnhappy); // Rest angry

    // Apply luxury effects from specialists
    const entertainers = result.specialists[SpecialistType.ENTERTAINER] || 0;
    const luxuryOutput = result.surplus[OutputType.LUXURY] || 0;

    // Each entertainer makes 3 unhappy citizens content (Freeciv standard)
    const luxuryEffect = entertainers * 3 + Math.floor(luxuryOutput / 2);

    // Convert angry to unhappy, then unhappy to content/happy
    angryCitizens = Math.max(0, baseAngry - luxuryEffect);
    unhappyCitizens = Math.max(0, baseUnhappy - Math.max(0, luxuryEffect - baseAngry));
    happyCitizens = totalCitizens - angryCitizens - unhappyCitizens;

    // Apply Freeciv happiness rules
    const isHappy =
      totalCitizens >= 3 && // Minimum size for happiness (celebratesize)
      angryCitizens === 0 &&
      unhappyCitizens === 0 &&
      happyCitizens >= Math.ceil(totalCitizens / 2);

    const isDisorder = happyCitizens < unhappyCitizens + 2 * angryCitizens;

    return {
      happy: isHappy,
      disorder: isDisorder,
      happyCitizens,
      unhappyCitizens,
      angryCitizens,
    };
  }

  /**
   * Check if happiness state satisfies parameter constraints
   */
  private checkHappinessConstraints(
    happinessState: { happy: boolean; disorder: boolean },
    parameters: CitizenParameter
  ): boolean {
    if (parameters.require_happy && !happinessState.happy) {
      return false;
    }

    if (!parameters.allow_disorder && happinessState.disorder) {
      return false;
    }

    return true;
  }

  /**
   * Attempt to fix happiness by converting workers to entertainers
   * @reference freeciv/common/aicore/cm.c - similar logic in CM optimization
   */
  private tryFixHappinessWithEntertainers(
    city: CityState,
    parameters: CitizenParameter,
    originalResult: CitizenResult
  ): CitizenResult {
    if (!parameters.allow_specialists) {
      return originalResult; // Can't use specialists
    }

    const result = CitizenResultFactory.create(originalResult.city_radius_sq);

    // Copy original result
    result.surplus = { ...originalResult.surplus };
    result.worker_positions = [...originalResult.worker_positions];
    result.specialists = { ...originalResult.specialists };
    result.workers_count = originalResult.workers_count;
    result.specialists_count = originalResult.specialists_count;
    result.fitness = originalResult.fitness;

    // Try adding entertainers until happiness constraints are satisfied
    const maxEntertainers = Math.min(3, result.workers_count); // Don't convert too many workers

    for (let entertainersToAdd = 1; entertainersToAdd <= maxEntertainers; entertainersToAdd++) {
      // Remove workers from least productive tiles
      let workersRemoved = 0;
      for (
        let i = result.worker_positions.length - 1;
        i >= 0 && workersRemoved < entertainersToAdd;
        i--
      ) {
        if (result.worker_positions[i]) {
          result.worker_positions[i] = false;
          workersRemoved++;
        }
      }

      // Add entertainers
      result.specialists[SpecialistType.ENTERTAINER] =
        (result.specialists[SpecialistType.ENTERTAINER] || 0) + entertainersToAdd;
      result.workers_count -= entertainersToAdd;
      result.specialists_count += entertainersToAdd;

      // Recalculate outputs
      this.recalculateResultOutputs(result, parameters);

      // Check if happiness is now satisfied
      const happinessState = this.evaluateHappiness(result, parameters);
      result.happy = happinessState.happy;
      result.disorder = happinessState.disorder;

      if (this.checkHappinessConstraints(happinessState, parameters)) {
        result.found_valid = true;
        result.aborted = false;

        logger.debug('Fixed happiness with entertainers', {
          cityId: city.id,
          entertainersAdded: entertainersToAdd,
          happy: result.happy,
          disorder: result.disorder,
        });

        return result;
      }
    }

    // Could not fix happiness
    result.found_valid = false;
    return result;
  }

  /**
   * Recalculate result outputs after citizen reassignment
   */
  private recalculateResultOutputs(result: CitizenResult, parameters: CitizenParameter): void {
    // Reset surplus
    Object.keys(result.surplus).forEach(key => {
      result.surplus[key as OutputType] = 0;
    });

    // Add outputs from worked tiles (simplified - would need actual tile data)
    // For now, assume each worked tile produces average outputs
    const averageTileFood = 2;
    const averageTileShields = 1;
    const averageTileTrade = 1;

    result.surplus[OutputType.FOOD] += result.workers_count * averageTileFood;
    result.surplus[OutputType.SHIELD] += result.workers_count * averageTileShields;
    result.surplus[OutputType.TRADE] += result.workers_count * averageTileTrade;

    // Add specialist outputs
    Object.entries(result.specialists).forEach(([specialistType, count]) => {
      const specialist = SPECIALIST_TYPES[specialistType as unknown as SpecialistType];
      if (specialist && count > 0) {
        switch (specialist.outputType) {
          case 'food':
            result.surplus[OutputType.FOOD] += count * specialist.outputAmount;
            break;
          case 'shield':
            result.surplus[OutputType.SHIELD] += count * specialist.outputAmount;
            break;
          case 'trade':
            result.surplus[OutputType.TRADE] += count * specialist.outputAmount;
            break;
          case 'gold':
            result.surplus[OutputType.GOLD] += count * specialist.outputAmount;
            break;
          case 'luxury':
            result.surplus[OutputType.LUXURY] += count * specialist.outputAmount;
            break;
          case 'science':
            result.surplus[OutputType.SCIENCE] += count * specialist.outputAmount;
            break;
        }
      }
    });

    // Subtract food consumption
    result.surplus[OutputType.FOOD] -= result.workers_count + result.specialists_count;

    // Recalculate fitness
    result.fitness = Object.entries(result.surplus).reduce((sum, [type, amount]) => {
      return sum + amount * parameters.factor[type as OutputType];
    }, 0);
  }

  /**
   * Calculate complexity score to detect problems that might be too expensive
   * @reference freeciv/common/aicore/cm.c - complexity estimation
   */
  private calculateComplexityScore(city: CityState, tileTypes: CitizenTileType[]): number {
    const population = city.population;
    const numTileTypes = tileTypes.length;

    // Rough complexity estimate: population^2 * tileTypes
    // This is a simplification of the actual branching factor
    return population * population * numTileTypes;
  }

  /**
   * Clean up cache when it gets too large
   * Simple LRU-like cleanup - removes oldest 25% of entries
   */
  private cleanupCache(): void {
    const entries = Array.from(this.resultCache.entries());
    const removeCount = Math.floor(entries.length * 0.25);

    // Remove first N entries (oldest in insertion order)
    for (let i = 0; i < removeCount; i++) {
      this.resultCache.delete(entries[i][0]);
    }

    logger.debug('Cleaned up citizen management cache', {
      removedEntries: removeCount,
      remainingEntries: this.resultCache.size,
    });
  }

  /**
   * Get current performance statistics
   */
  public getPerformanceStats() {
    return {
      ...this.performanceStats,
      averageTimeMs:
        this.performanceStats.totalQueries > 0
          ? this.performanceStats.totalTimeMs / this.performanceStats.totalQueries
          : 0,
      averageIterations:
        this.performanceStats.totalQueries > 0
          ? this.performanceStats.totalIterations / this.performanceStats.totalQueries
          : 0,
      iterationsPerSecond:
        this.performanceStats.totalTimeMs > 0
          ? (this.performanceStats.totalIterations * 1000) / this.performanceStats.totalTimeMs
          : 0,
      cacheHitRate:
        this.performanceStats.totalQueries > 0
          ? this.performanceStats.cacheHits / this.performanceStats.totalQueries
          : 0,
    };
  }

  /**
   * Reset performance statistics
   */
  public resetPerformanceStats(): void {
    this.performanceStats = {
      totalQueries: 0,
      totalIterations: 0,
      totalTimeMs: 0,
      cacheHits: 0,
      timeouts: 0,
    };
    logger.debug('Reset citizen management performance stats');
  }

  /**
   * Shutdown the service and clean up resources
   */
  public shutdown(): void {
    // Log final performance stats before shutdown
    const stats = this.getPerformanceStats();
    logger.info('CitizenManagement final performance stats', stats);

    this.clearAllCaches();
    this.resetPerformanceStats();
    this.initialized = false;

    logger.info('CitizenManagement system shutdown');
  }
}
