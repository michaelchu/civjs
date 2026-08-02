/**
 * @module server/game/systems/Economic/types/TaxRateTypes
 * Tax Rate System Types
 * Specific types for tax rate allocation and validation
 *
 * @reference freeciv-web/javascript/rates.js - tax rate slider system
 */

/**
 * Tax rate validation result
 */
export interface TaxRateValidation {
  /** Whether the rates are valid */
  isValid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Warning message if suboptimal */
  warning?: string;
}

/**
 * Tax rate change request
 */
export interface TaxRateChangeRequest {
  /** Player making the request */
  playerId: string;
  /** New tax rates */
  newRates: {
    tax: number;
    luxury: number;
    science: number;
  };
  /** Whether to apply immediately or queue for next turn */
  immediate?: boolean;
}

// TaxRateConstraints is defined in EconomicTypes.ts to avoid circular imports

/**
 * Tax rate recommendation
 */
export interface TaxRateRecommendation {
  /** Recommended tax rate */
  tax: number;
  /** Recommended luxury rate */
  luxury: number;
  /** Recommended science rate */
  science: number;
  /** Reason for recommendation */
  reason: string;
  /** Expected outcomes */
  expectedOutcome: {
    /** Expected gold per turn */
    goldPerTurn: number;
    /** Expected science per turn */
    sciencePerTurn: number;
    /** Expected luxury effect on happiness */
    happinessEffect: number;
  };
}

/**
 * Tax rate lock state
 * Players can lock specific rates to prevent automatic adjustment
 */
export interface TaxRateLocks {
  /** Whether tax rate is locked */
  taxLocked: boolean;
  /** Whether luxury rate is locked */
  luxuryLocked: boolean;
  /** Whether science rate is locked */
  scienceLocked: boolean;
}

/**
 * Tax rate history entry
 */
export interface TaxRateHistoryEntry {
  /** Turn when rates were changed */
  turn: number;
  /** Previous rates */
  previousRates: {
    tax: number;
    luxury: number;
    science: number;
  };
  /** New rates */
  newRates: {
    tax: number;
    luxury: number;
    science: number;
  };
  /** Reason for change */
  reason: string;
  /** Whether change was player-initiated or automatic */
  automatic: boolean;
}
