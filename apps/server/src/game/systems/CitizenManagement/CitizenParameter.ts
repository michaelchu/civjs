/**
 * CitizenParameter - Configuration parameters for citizen management optimization
 * @reference freeciv/common/aicore/cm.h - struct cm_parameter
 *
 * This interface defines how citizens should be assigned to maximize city output
 * according to player preferences and constraints.
 */

import { OutputType } from '@game/constants/GameConstants';

/**
 * Configuration parameters for citizen assignment optimization
 * Based on Freeciv's cm_parameter structure
 */
export interface CitizenParameter {
  /** Minimum required surplus for each output type (food, shields, trade, etc.) */
  minimal_surplus: Record<OutputType, number>;

  /** Weighting factors for each output type in optimization */
  factor: Record<OutputType, number>;

  /** Happiness factor weight in optimization */
  happy_factor: number;

  /** Whether to maximize growth (prioritize food surplus) */
  max_growth: boolean;

  /** Whether city must be happy (no unhappy citizens) */
  require_happy: boolean;

  /** Whether to allow disorder (unhappy > happy citizens) */
  allow_disorder: boolean;

  /** Whether to allow specialists (non-worker citizens) */
  allow_specialists: boolean;
}

/**
 * Factory functions for creating common parameter configurations
 */
export class CitizenParameterFactory {
  /**
   * Create default parameters with equal weighting
   * @reference freeciv/common/aicore/cm.c - cm_init_parameter()
   */
  static createDefault(): CitizenParameter {
    return {
      minimal_surplus: {
        [OutputType.FOOD]: 0,
        [OutputType.SHIELD]: 0,
        [OutputType.TRADE]: 0,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 0,
      },
      factor: {
        [OutputType.FOOD]: 1,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 1,
        [OutputType.GOLD]: 1,
        [OutputType.LUXURY]: 1,
        [OutputType.SCIENCE]: 1,
      },
      happy_factor: 1,
      max_growth: false,
      require_happy: false,
      allow_disorder: false,
      allow_specialists: true,
    };
  }

  /**
   * Create emergency parameters that always produce a valid result
   * @reference freeciv/common/aicore/cm.c - cm_init_emergency_parameter()
   */
  static createEmergency(): CitizenParameter {
    return {
      minimal_surplus: {
        [OutputType.FOOD]: -Infinity,
        [OutputType.SHIELD]: -Infinity,
        [OutputType.TRADE]: -Infinity,
        [OutputType.GOLD]: -Infinity,
        [OutputType.LUXURY]: -Infinity,
        [OutputType.SCIENCE]: -Infinity,
      },
      factor: {
        [OutputType.FOOD]: 1,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 1,
        [OutputType.GOLD]: 1,
        [OutputType.LUXURY]: 1,
        [OutputType.SCIENCE]: 1,
      },
      happy_factor: 1,
      max_growth: false,
      require_happy: false,
      allow_disorder: true,
      allow_specialists: true,
    };
  }

  /**
   * Create growth-focused parameters (prioritize food)
   */
  static createGrowthFocused(): CitizenParameter {
    const params = this.createDefault();
    params.max_growth = true;
    params.factor[OutputType.FOOD] = 3;
    params.factor[OutputType.SHIELD] = 1;
    params.factor[OutputType.TRADE] = 1;
    return params;
  }

  /**
   * Create production-focused parameters (prioritize shields)
   */
  static createProductionFocused(): CitizenParameter {
    const params = this.createDefault();
    params.factor[OutputType.FOOD] = 1;
    params.factor[OutputType.SHIELD] = 3;
    params.factor[OutputType.TRADE] = 1;
    return params;
  }

  /**
   * Create trade-focused parameters (prioritize trade/gold/science)
   */
  static createTradeFocused(): CitizenParameter {
    const params = this.createDefault();
    params.factor[OutputType.FOOD] = 1;
    params.factor[OutputType.SHIELD] = 1;
    params.factor[OutputType.TRADE] = 2;
    params.factor[OutputType.GOLD] = 2;
    params.factor[OutputType.SCIENCE] = 2;
    return params;
  }
}

/**
 * Utility functions for parameter manipulation
 */
export class CitizenParameterUtils {
  /**
   * Compare two parameters for equality
   */
  static areEqual(p1: CitizenParameter, p2: CitizenParameter): boolean {
    // Compare all fields for equality
    const outputTypes = Object.values(OutputType);

    for (const outputType of outputTypes) {
      if (
        p1.minimal_surplus[outputType] !== p2.minimal_surplus[outputType] ||
        p1.factor[outputType] !== p2.factor[outputType]
      ) {
        return false;
      }
    }

    return (
      p1.happy_factor === p2.happy_factor &&
      p1.max_growth === p2.max_growth &&
      p1.require_happy === p2.require_happy &&
      p1.allow_disorder === p2.allow_disorder &&
      p1.allow_specialists === p2.allow_specialists
    );
  }

  /**
   * Create a deep copy of parameters
   */
  static copy(src: CitizenParameter): CitizenParameter {
    return {
      minimal_surplus: { ...src.minimal_surplus },
      factor: { ...src.factor },
      happy_factor: src.happy_factor,
      max_growth: src.max_growth,
      require_happy: src.require_happy,
      allow_disorder: src.allow_disorder,
      allow_specialists: src.allow_specialists,
    };
  }
}
