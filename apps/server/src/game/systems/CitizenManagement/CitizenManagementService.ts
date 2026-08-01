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
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface CitizenOptimizationContext {
  taxRates?: { tax: number; luxury: number; science: number };
  rulesetName?: string;
}

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
    allowNegative: boolean = false,
    context: CitizenOptimizationContext = {}
  ): CitizenResult {
    const startTime = Date.now();
    this.performanceStats.totalQueries++;

    try {
      // Use default parameters if none provided
      const params = parameters || CitizenParameterFactory.createDefault();

      // Check cache first
      const cacheKey = this.generateCacheKey(city, params, context);
      const cachedResult = this.resultCache.get(cacheKey);
      if (cachedResult) {
        this.performanceStats.cacheHits++;
        logger.debug('Using cached citizen management result', { cityId: city.id });
        return cachedResult;
      }

      // Perform optimization with timeout protection
      const result = this.performOptimizationWithTimeout(city, params, allowNegative, context);

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
  private generateCacheKey(
    city: CityState,
    parameters: CitizenParameter,
    context: CitizenOptimizationContext
  ): string {
    // Create a simple hash of the city state and parameters that affect optimization
    const cityHash = JSON.stringify({
      id: city.id,
      population: city.population,
      happiness: city.happiness,
      specialists: city.specialists,
      tiles: city.workableTiles?.map(tile => ({
        outputs: tile.outputs,
        blocked: tile.isBlocked,
        center: tile.isCenter,
      })),
      taxRates: context.taxRates,
      rulesetName: context.rulesetName,
    });
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
  private createTileTypes(
    city: CityState,
    parameters: CitizenParameter,
    context: CitizenOptimizationContext
  ): CitizenTileType[] {
    const tileTypes: CitizenTileType[] = [];

    // Create tile types from workable tiles (excluding city center)
    if (city.workableTiles) {
      const tileProductions = city.workableTiles
        .map((tile, index) => ({ tile, index }))
        .filter(({ tile }) => !tile.isCenter && !tile.isBlocked)
        .map(({ tile, index }) => ({
          index,
          production: this.calculateTileOutputs(tile, context.taxRates),
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
    allowNegative: boolean,
    context: CitizenOptimizationContext
  ): CitizenResult {
    const startTime = Date.now();
    const iterations = 0;

    try {
      // Create tile types. Search limits below bound every problem without
      // manufacturing an invalid "successful" emergency assignment.
      const tileTypes = this.createTileTypes(city, parameters, context);

      // Build dominance relationships and sort by fitness
      CitizenTileTypeUtils.buildDominanceRelationships(tileTypes);
      const sortedTileTypes = CitizenTileTypeUtils.sortByFitness(tileTypes);

      // Perform search with timeout and iteration limits
      return this.branchAndBoundSearchWithTimeout(
        city,
        sortedTileTypes,
        parameters,
        allowNegative,
        startTime,
        context
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
    allowNegative: boolean,
    startTime: number,
    context: CitizenOptimizationContext
  ): CitizenResult {
    let iterations = 0;
    let bestResult = CitizenResultFactory.create(this.getCityRadiusSq(city));
    let bestFitness = -Infinity;
    let aborted = false;
    let fallbackUsed = false;
    const assignments = new Map<string, number>();

    const evaluate = (): void => {
      const candidate = CitizenResultFactory.create(this.getCityRadiusSq(city));
      this.convertAssignmentsToResult(assignments, tileTypes, candidate);
      this.calculateResultOutputs(candidate, assignments, tileTypes, parameters, city, context);
      const happinessState = this.evaluateHappiness(city, candidate);
      candidate.happy = happinessState.happy;
      candidate.disorder = happinessState.disorder;
      const meetsMinimum = Object.values(OutputType).every(
        output =>
          allowNegative || candidate.surplus[output] >= (parameters.minimal_surplus[output] ?? 0)
      );
      if (
        meetsMinimum &&
        this.checkHappinessConstraints(happinessState, parameters) &&
        candidate.fitness > bestFitness
      ) {
        candidate.found_valid = true;
        bestResult = candidate;
        bestFitness = candidate.fitness;
      }
    };

    const search = (typeIndex: number, remaining: number): void => {
      if (
        aborted ||
        iterations >= this.MAX_ITERATIONS ||
        Date.now() - startTime > this.TIMEOUT_MS
      ) {
        aborted = true;
        return;
      }
      iterations++;
      if (typeIndex === tileTypes.length) {
        if (remaining === 0) evaluate();
        return;
      }
      const tileType = tileTypes[typeIndex];
      const maximum = Math.min(tileType.available_count, remaining);
      for (let count = maximum; count >= 0; count--) {
        assignments.set(tileType.id, count);
        search(typeIndex + 1, remaining - count);
        if (aborted) break;
      }
      assignments.delete(tileType.id);
    };

    search(0, city.population);
    if (!bestResult.found_valid) {
      const fallback = this.performGreedyAssignment(city, tileTypes, parameters, context);
      const happinessState = this.evaluateHappiness(city, fallback);
      fallback.happy = happinessState.happy;
      fallback.disorder = happinessState.disorder;
      const fallbackMeetsMinimum = Object.values(OutputType).every(
        output =>
          allowNegative || fallback.surplus[output] >= (parameters.minimal_surplus[output] ?? 0)
      );
      fallback.found_valid = false;
      if (
        CitizenResultUtils.getTotalCitizens(fallback) === city.population &&
        fallbackMeetsMinimum &&
        this.checkHappinessConstraints(happinessState, parameters)
      ) {
        fallback.found_valid = true;
      }
      fallback.assignment_complete =
        CitizenResultUtils.getTotalCitizens(fallback) === city.population;
      if (fallback.assignment_complete) {
        bestResult = fallback;
        bestFitness = fallback.fitness;
        fallbackUsed = true;
      }
    }

    const elapsedMs = Date.now() - startTime;
    bestResult.aborted = aborted;
    bestResult.timed_out = aborted;
    bestResult.fallback_used = fallbackUsed;
    bestResult.failure_reason = bestResult.found_valid
      ? undefined
      : aborted
        ? 'timeout'
        : 'constraints';
    if (aborted) this.performanceStats.timeouts++;
    this.performanceStats.totalIterations += iterations;

    logger.debug('Branch-and-bound search completed', {
      cityId: city.id,
      iterations,
      elapsedMs,
      bestFitness,
      foundValid: bestResult.found_valid,
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
    parameters: CitizenParameter,
    context: CitizenOptimizationContext = {}
  ): CitizenResult {
    const result = CitizenResultFactory.create(this.getCityRadiusSq(city));

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
    this.calculateResultOutputs(result, assignments, tileTypes, parameters, city, context);

    result.found_valid = CitizenResultUtils.getTotalCitizens(result) === city.population;
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
    let idleCount = 0;

    // Reset specialists
    Object.keys(result.specialists).forEach(key => {
      result.specialists[key as unknown as SpecialistType] = 0;
    });

    for (const [tileTypeId, count] of assignments) {
      const tileType = tileTypes.find(t => t.id === tileTypeId);
      if (!tileType || count === 0) continue;

      if (tileType.id === 'idle') {
        idleCount += count;
        continue;
      }

      if (tileType.is_specialist) {
        if (tileType.specialist_type !== undefined) {
          result.specialists[tileType.specialist_type] += count;
          specialistsCount += count;
        }
      } else {
        for (let i = 0; i < count && i < tileType.tile_indices.length; i++) {
          result.worker_positions[tileType.tile_indices[i]] = true;
          workersCount++;
        }
      }
    }

    result.workers_count = workersCount;
    result.specialists_count = specialistsCount;
    result.idle_count = idleCount;

    CitizenResultUtils.updateCounts(result);
  }

  /**
   * Calculate result outputs and fitness from assignments
   */
  private calculateResultOutputs(
    result: CitizenResult,
    assignments: Map<string, number>,
    tileTypes: CitizenTileType[],
    parameters: CitizenParameter,
    city: CityState,
    context: CitizenOptimizationContext
  ): void {
    // Reset surplus
    Object.keys(result.surplus).forEach(key => {
      result.surplus[key as OutputType] = 0;
    });

    const center = city.workableTiles?.find(tile => tile.isCenter && !tile.isBlocked);
    if (center) {
      const centerOutputs = this.calculateTileOutputs(center, context.taxRates);
      for (const output of Object.values(OutputType)) {
        result.surplus[output] += centerOutputs[output];
      }
    }

    for (const [tileTypeId, count] of assignments) {
      const tileType = tileTypes.find(t => t.id === tileTypeId);
      if (!tileType || count === 0) continue;

      Object.entries(tileType.production).forEach(([outputType, amount]) => {
        result.surplus[outputType as OutputType] += amount * count;
      });
    }

    // Subtract consumption (food for population)
    result.surplus[OutputType.FOOD] -=
      CitizenResultUtils.getTotalCitizens(result) *
      rulesetLoader.getCivstyle(context.rulesetName).food_cost;

    // Calculate fitness
    result.fitness = Object.entries(result.surplus).reduce((sum, [type, amount]) => {
      return sum + amount * parameters.factor[type as OutputType];
    }, 0);
  }

  /**
   * Create a failed result when optimization fails
   */
  private createFailedResult(_city: CityState): CitizenResult {
    const result = CitizenResultFactory.createFailed(this.getCityRadiusSq(_city));
    return result;
  }

  /**
   * Calculate all output types from a workable tile
   * Includes trade conversion to gold/luxury/science
   */
  private calculateTileOutputs(
    tile: WorkableTile,
    taxRates: { tax: number; luxury: number; science: number } = {
      tax: 30,
      luxury: 20,
      science: 50,
    }
  ): Record<OutputType, number> {
    // Base outputs from tile
    const baseFood = tile.outputs.food;
    const baseShields = tile.outputs.shields;
    const baseTrade = tile.outputs.trade;

    const scienceRate = taxRates.science / 100;
    const taxRate = taxRates.tax / 100;
    const luxuryRate = taxRates.luxury / 100;

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

    return production;
  }

  /**
   * Evaluate happiness and disorder state for a result
   * @reference freeciv/common/city.c - city_happy(), city_unhappy()
   */
  private evaluateHappiness(
    city: CityState,
    result: CitizenResult
  ): {
    happy: boolean;
    disorder: boolean;
    happyCitizens: number;
    unhappyCitizens: number;
    angryCitizens: number;
  } {
    const totalCitizens = CitizenResultUtils.getTotalCitizens(result);

    let happyCitizens = Math.min(totalCitizens, city.happiness.happy);
    let unhappyCitizens = Math.min(totalCitizens - happyCitizens, city.happiness.unhappy);
    let angryCitizens = Math.min(
      totalCitizens - happyCitizens - unhappyCitizens,
      city.happiness.angry
    );

    // Apply luxury effects from specialists
    const entertainers = result.specialists[SpecialistType.ENTERTAINER] || 0;
    const luxuryOutput = result.surplus[OutputType.LUXURY] || 0;

    // Each entertainer makes 3 unhappy citizens content (Freeciv standard)
    const luxuryEffect = entertainers * 3 + Math.floor(luxuryOutput / 2);

    // Convert angry to unhappy, then unhappy to content/happy
    const baseAngry = angryCitizens;
    angryCitizens = Math.max(0, angryCitizens - luxuryEffect);
    unhappyCitizens = Math.max(0, unhappyCitizens - Math.max(0, luxuryEffect - baseAngry));
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

  private getCityRadiusSq(city: CityState): number {
    const radius = city.cityRadius || 2;
    return radius * radius + 1;
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
