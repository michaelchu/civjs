/**
 * Economic System Constants
 * Game balance constants for the economic system
 *
 * @reference freeciv/data/classic/game.ruleset - economic settings
 * @reference freeciv-web/javascript/rates.js - tax rate constants
 */

import type { EconomicConfig, TaxRates, TaxRateConstraints } from '../types/EconomicTypes';

/**
 * Default tax rate allocation for new players
 * Matches Freeciv default: 50% tax, 20% luxury, 30% science
 */
export const DEFAULT_TAX_RATES: TaxRates = {
  tax: 50,
  luxury: 20,
  science: 30,
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
 * Building upkeep costs
 * @reference freeciv/data/classic/buildings.ruleset
 */
export const BUILDING_UPKEEP_COSTS = {
  // Basic buildings
  granary: 1,
  barracks: 1,
  temple: 1,
  marketplace: 1,
  library: 1,
  walls: 1,

  // Advanced buildings
  bank: 2,
  university: 3,
  factory: 4,
  power_plant: 4,
  research_lab: 3,
  cathedral: 3,
  colosseum: 4,

  // Infrastructure
  aqueduct: 2,
  sewer_system: 2,
  harbor: 1,
  airport: 3,

  // Wonders (higher upkeep)
  hanging_gardens: 0, // Most wonders have no upkeep in classic ruleset
  great_library: 0,
  lighthouse: 0,
  oracle: 0,
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
 * Corruption and waste constants
 * @reference freeciv/common/city.c city_corruption()
 */
export const CORRUPTION_CONSTANTS = {
  /** Base corruption rate (0-1) */
  BASE_CORRUPTION: 0.0,
  /** Corruption increase per tile distance from capital */
  DISTANCE_CORRUPTION_FACTOR: 0.02,
  /** Maximum corruption percentage */
  MAX_CORRUPTION: 0.75, // 75%
  /** Government corruption modifiers */
  GOVERNMENT_MODIFIERS: {
    despotism: 1.5, // Higher corruption
    monarchy: 1.0, // Normal corruption
    republic: 0.7, // Lower corruption
    democracy: 0.5, // Lowest corruption
  },
} as const;

/**
 * Specialist gold production
 * @reference freeciv/data/classic/game.ruleset specialist definitions
 */
export const SPECIALIST_GOLD_OUTPUT = {
  /** Tax Collector gold output per specialist */
  TAX_COLLECTOR_GOLD: 3,
  /** Merchant trade output (convertible to gold) */
  MERCHANT_TRADE: 3,
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
 * Default economic configuration
 */
export const DEFAULT_ECONOMIC_CONFIG: EconomicConfig = {
  defaultTaxRates: DEFAULT_TAX_RATES,
  minTaxRate: TAX_RATE_CONSTRAINTS.minRate,
  maxTaxRate: TAX_RATE_CONSTRAINTS.maxRate,
  taxRateIncrement: TAX_RATE_CONSTRAINTS.increment,
  baseCorruptionRate: CORRUPTION_CONSTANTS.BASE_CORRUPTION,
  lowTreasuryThreshold: ECONOMIC_THRESHOLDS.LOW_TREASURY,
};

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
