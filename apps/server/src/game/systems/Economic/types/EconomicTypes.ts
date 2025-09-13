/**
 * Economic System Types
 * Core interfaces and types for the economic game system
 *
 * @reference freeciv/common/city.h - economic calculations
 * @reference freeciv-web/javascript/rates.js - tax rate system
 */

// OutputType from GameConstants is available for future use

/**
 * Tax rate allocation for trade conversion
 * Rates must sum to 100% and be in increments of 10%
 */
export interface TaxRates {
  /** Percentage of trade converted to gold (0-100) */
  tax: number;
  /** Percentage of trade converted to luxury (0-100) */
  luxury: number;
  /** Percentage of trade converted to science (0-100) */
  science: number;
}

/**
 * Tax rate adjustment constraints
 */
export interface TaxRateConstraints {
  /** Minimum rate for any category (usually 0) */
  minRate: number;
  /** Maximum rate for any category (usually 100) */
  maxRate: number;
  /** Rate increment step (usually 10) */
  increment: number;
  /** Maximum total rate (usually 100) */
  maxTotal: number;
  /** Government-specific constraints */
  governmentModifiers?: {
    /** Some governments limit luxury rates */
    maxLuxury?: number;
    /** Some governments limit tax rates */
    maxTax?: number;
    /** Some governments have minimum science */
    minScience?: number;
  };
}

/**
 * Economic output from a single city per turn
 */
export interface CityEconomicOutput {
  /** City identifier */
  cityId: string;
  /** Player who owns the city */
  playerId: string;

  /** Raw trade points generated before conversion */
  rawTrade: number;
  /** Trade points after corruption/waste */
  netTrade: number;

  /** Trade converted to different outputs based on tax rates */
  tradeConversion: {
    gold: number;
    luxury: number;
    science: number;
  };

  /** Direct gold production (from specialists, buildings) */
  directGold: number;

  /** Total gold produced this turn */
  totalGoldProduced: number;

  /** Gold costs this turn */
  costs: {
    /** Building upkeep costs */
    buildingUpkeep: number;
    /** Unit upkeep costs (if city pays) */
    unitUpkeep: number;
    /** Total costs */
    total: number;
  };

  /** Net gold contribution (production - costs) */
  netGoldContribution: number;
}

/**
 * Player-wide economic summary per turn
 */
export interface PlayerEconomicSummary {
  /** Player identifier */
  playerId: string;
  /** Turn number */
  turn: number;

  /** Current tax rates */
  taxRates: TaxRates;

  /** Gold treasury at start of turn */
  goldAtTurnStart: number;

  /** Per-city economic breakdown */
  cities: CityEconomicOutput[];

  /** Aggregated totals */
  totals: {
    /** Total gold produced across all cities */
    goldProduced: number;
    /** Total trade generated */
    tradeGenerated: number;
    /** Total building upkeep costs */
    buildingUpkeep: number;
    /** Total unit upkeep costs */
    unitUpkeep: number;
    /** Net gold change this turn */
    netGoldChange: number;
  };

  /** Gold treasury at end of turn */
  goldAtTurnEnd: number;

  /** Economic warnings/events */
  warnings: EconomicWarning[];
}

/**
 * Economic warnings for player attention
 */
export interface EconomicWarning {
  type: EconomicWarningType;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  /** Related city ID if applicable */
  cityId?: string;
  /** Suggested action */
  suggestion?: string;
}

export enum EconomicWarningType {
  LOW_TREASURY = 'low_treasury',
  NEGATIVE_INCOME = 'negative_income',
  HIGH_UPKEEP = 'high_upkeep',
  INEFFICIENT_TAX_RATES = 'inefficient_tax_rates',
  BUILDING_UPKEEP_BURDEN = 'building_upkeep_burden',
  UNIT_UPKEEP_BURDEN = 'unit_upkeep_burden',
}

/**
 * Building upkeep cost information
 */
export interface BuildingUpkeep {
  /** Building type identifier */
  buildingId: string;
  /** Building display name */
  name: string;
  /** Gold cost per turn */
  upkeepCost: number;
  /** Whether this building can be sold */
  canSell: boolean;
  /** Gold received if sold */
  sellValue?: number;
}

/**
 * Economic configuration for game balance
 */
export interface EconomicConfig {
  /** Default tax rates for new players */
  defaultTaxRates: TaxRates;
  /** Minimum allowed rate for any category */
  minTaxRate: number;
  /** Maximum allowed rate for any category */
  maxTaxRate: number;
  /** Tax rate adjustment increment */
  taxRateIncrement: number;
  /** Base corruption rate (0-1) */
  baseCorruptionRate: number;
  /** Maximum treasury warnings threshold */
  lowTreasuryThreshold: number;
}

/**
 * Gold spending action types
 */
export enum GoldSpendingType {
  RUSH_PRODUCTION = 'rush_production',
  UNIT_UPKEEP = 'unit_upkeep',
  BUILDING_UPKEEP = 'building_upkeep',
  DIPLOMACY = 'diplomacy',
  EMERGENCY_PRODUCTION = 'emergency_production',
}

/**
 * Gold spending transaction record
 */
export interface GoldTransaction {
  /** Transaction identifier */
  id: string;
  /** Player who spent/received gold */
  playerId: string;
  /** Amount (positive = received, negative = spent) */
  amount: number;
  /** Type of transaction */
  type: GoldSpendingType;
  /** Description of transaction */
  description: string;
  /** Turn when transaction occurred */
  turn: number;
  /** Related city ID if applicable */
  cityId?: string;
  /** Related unit ID if applicable */
  unitId?: string;
  /** Timestamp */
  timestamp: Date;
}

/**
 * Rush building calculation result
 */
export interface RushBuildingCalculation {
  /** City identifier */
  cityId: string;
  /** Current production target */
  productionTarget: string;
  /** Production points already accumulated */
  currentProgress: number;
  /** Total production points needed */
  totalCost: number;
  /** Remaining production points needed */
  remainingCost: number;
  /** Gold cost to rush (complete immediately) */
  rushCost: number;
  /** Whether player can afford the rush cost */
  canAfford: boolean;
  /** Player's current gold */
  playerGold: number;
}
