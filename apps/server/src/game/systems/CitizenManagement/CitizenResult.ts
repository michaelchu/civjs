/**
 * CitizenResult - Result of citizen management optimization
 * @reference freeciv/common/aicore/cm.h - struct cm_result
 * 
 * Contains the optimal citizen assignment and resulting city outputs
 */

import type { OutputType } from '@game/constants/GameConstants';
import type { SpecialistType } from '@game/managers/CityManager';

/**
 * Result of citizen assignment optimization
 * Based on Freeciv's cm_result structure
 */
export interface CitizenResult {
  /** Whether the optimization was successful */
  found_valid: boolean;
  
  /** Whether the optimization was aborted (timeout/complexity) */
  aborted: boolean;
  
  /** Whether the city is in disorder */
  disorder: boolean;
  
  /** Whether all citizens are happy */
  happy: boolean;
  
  /** Final surplus for each output type after optimization */
  surplus: Record<OutputType, number>;
  
  /** City radius squared (for tile positioning) */
  city_radius_sq: number;
  
  /** Which tile positions are worked (boolean array indexed by city map) */
  worker_positions: boolean[];
  
  /** Number of each type of specialist */
  specialists: Record<SpecialistType, number>;
  
  /** Total number of citizens working tiles */
  workers_count: number;
  
  /** Total number of specialist citizens */
  specialists_count: number;
  
  /** Overall fitness score of this solution */
  fitness: number;
}

/**
 * Factory and utility functions for CitizenResult
 */
export class CitizenResultFactory {
  /**
   * Create a new result for a given city
   * @param cityRadiusSq City's workable tile radius squared
   */
  static create(cityRadiusSq: number): CitizenResult {
    // Initialize worker positions array for all tiles in city radius
    const maxTiles = (2 * Math.floor(Math.sqrt(cityRadiusSq)) + 1) ** 2;
    
    return {
      found_valid: false,
      aborted: false,
      disorder: false,
      happy: false,
      surplus: {
        [OutputType.FOOD]: 0,
        [OutputType.SHIELD]: 0,
        [OutputType.TRADE]: 0,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 0,
      },
      city_radius_sq: cityRadiusSq,
      worker_positions: new Array(maxTiles).fill(false),
      specialists: {
        [SpecialistType.SCIENTIST]: 0,
        [SpecialistType.TAX_COLLECTOR]: 0,
        [SpecialistType.ENTERTAINER]: 0,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 0,
        [SpecialistType.MERCHANT]: 0,
      },
      workers_count: 0,
      specialists_count: 0,
      fitness: 0,
    };
  }

  /**
   * Create a failed result (no valid solution found)
   */
  static createFailed(cityRadiusSq: number): CitizenResult {
    const result = this.create(cityRadiusSq);
    result.found_valid = false;
    result.aborted = true;
    return result;
  }
}

/**
 * Utility functions for CitizenResult
 */
export class CitizenResultUtils {
  /**
   * Calculate total number of citizens in the result
   */
  static getTotalCitizens(result: CitizenResult): number {
    return result.workers_count + result.specialists_count;
  }

  /**
   * Calculate total specialists count from specialist breakdown
   */
  static calculateSpecialistsCount(specialists: Record<SpecialistType, number>): number {
    return Object.values(specialists).reduce((sum, count) => sum + count, 0);
  }

  /**
   * Calculate workers count from worker positions
   */
  static calculateWorkersCount(workerPositions: boolean[]): number {
    return workerPositions.filter(worked => worked).length;
  }

  /**
   * Update counts in result based on current assignments
   */
  static updateCounts(result: CitizenResult): void {
    result.workers_count = this.calculateWorkersCount(result.worker_positions);
    result.specialists_count = this.calculateSpecialistsCount(result.specialists);
  }

  /**
   * Validate that result is internally consistent
   */
  static validate(result: CitizenResult, expectedPopulation: number): boolean {
    const totalCitizens = this.getTotalCitizens(result);
    
    if (totalCitizens !== expectedPopulation) {
      return false;
    }
    
    // Check that worker positions array is correct size
    const expectedTiles = (2 * Math.floor(Math.sqrt(result.city_radius_sq)) + 1) ** 2;
    if (result.worker_positions.length !== expectedTiles) {
      return false;
    }
    
    // Check that specialists counts are non-negative
    for (const count of Object.values(result.specialists)) {
      if (count < 0) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Create a human-readable summary of the result
   */
  static summarize(result: CitizenResult): string {
    if (!result.found_valid) {
      return 'No valid solution found';
    }
    
    const lines = [
      `Workers: ${result.workers_count}, Specialists: ${result.specialists_count}`,
      `Surplus: ${Object.entries(result.surplus)
        .map(([type, amount]) => `${type}:${amount}`)
        .join(', ')}`,
      `Status: ${result.disorder ? 'Disorder' : result.happy ? 'Happy' : 'Content'}`,
      `Fitness: ${result.fitness}`,
    ];
    
    return lines.join('\n');
  }
}