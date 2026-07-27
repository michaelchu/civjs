/**
 * Economic System Constants
 * Game balance constants for the economic system
 *
 * @reference freeciv/data/classic/game.ruleset - economic settings
 * @reference freeciv-web/javascript/rates.js - tax rate constants
 */

import type { TaxRates, TaxRateConstraints } from '../types/EconomicTypes';

/**
 * Default tax rate allocation for new players
 * Classic begins at 100% science, then Despotism's 60% maximum rate
 * redistributes the excess to tax.
 */
export const DEFAULT_TAX_RATES: TaxRates = {
  tax: 40,
  luxury: 0,
  science: 60,
};

/**
 * Tax rate constraints following Freeciv rules
 */
export const TAX_RATE_CONSTRAINTS: TaxRateConstraints = {
  minRate: 0,
  maxRate: 100,
  increment: 10, // Freeciv uses 10% increments
  maxTotal: 100,
};

/**
 * Emergency economic thresholds
 */
export const ECONOMIC_THRESHOLDS = {
  /** Treasury level considered "low" */
  LOW_TREASURY: 10,
  /** Treasury level considered "critical" */
  CRITICAL_TREASURY: 0,
  /** Negative income warning threshold */
  NEGATIVE_INCOME_WARNING: -5,
  /** High upkeep percentage of income */
  HIGH_UPKEEP_THRESHOLD: 0.8, // 80% of income
} as const;

/**
 * Rush building cost multipliers
 * @reference freeciv/common/city.c city_buy_production()
 */
export const RUSH_BUILDING_MULTIPLIERS = {
  /** Base multiplier for rush cost calculation */
  BASE_MULTIPLIER: 2,
  /** Minimum gold cost for rushing */
  MINIMUM_RUSH_COST: 20,
  /** Maximum percentage of production that can be rushed in one payment */
  MAX_RUSH_PERCENTAGE: 1.0, // 100%
} as const;

/**
 * Trade to output conversion rates
 * Each trade point is converted based on tax rates
 */
export const TRADE_CONVERSION = {
  /** Trade points needed for 1 gold */
  TRADE_TO_GOLD_RATIO: 1,
  /** Trade points needed for 1 science */
  TRADE_TO_SCIENCE_RATIO: 1,
  /** Trade points needed for 1 luxury */
  TRADE_TO_LUXURY_RATIO: 1,
} as const;

/**
 * Economic warnings configuration
 */
export const WARNING_THRESHOLDS = {
  /** Show warning when treasury drops below this many turns of expenses */
  LOW_TREASURY_TURNS: 3,
  /** Show warning when upkeep exceeds this percentage of income */
  HIGH_UPKEEP_PERCENTAGE: 80,
  /** Show warning when gold income is negative for this many turns */
  NEGATIVE_INCOME_TURNS: 2,
} as const;

/**
 * Gold upkeep style configuration
 * @reference freeciv/server/settings.c gold_upkeep_style
 */
export const GOLD_UPKEEP_STYLES = {
  CITY: 'city', // City pays for both buildings and units
  MIXED: 'mixed', // City pays for buildings, nation pays for units
  NATION: 'nation', // Nation pays for both buildings and units
} as const;

export type GoldUpkeepStyle = (typeof GOLD_UPKEEP_STYLES)[keyof typeof GOLD_UPKEEP_STYLES];
