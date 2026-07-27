/**
 * TaxRateService - Handles tax rate allocation and validation
 *
 * Manages the core economic mechanic of converting trade points into
 * gold, luxury, and science based on player-set tax rates.
 *
 * @reference freeciv-web/javascript/rates.js - tax rate system implementation
 * @reference freeciv/common/city.c - trade distribution calculations
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type {
  TaxRateValidation,
  TaxRateChangeRequest,
  TaxRateRecommendation,
  TaxRateLocks,
} from '../types/TaxRateTypes';
import type { TaxRates, TaxRateConstraints, PlayerEconomicSummary } from '../types/EconomicTypes';
import { DEFAULT_TAX_RATES, TAX_RATE_CONSTRAINTS } from '../constants/EconomicConstants';
import { distributeTrade } from '../TradeDistribution';

/**
 * TaxRateService handles all tax rate operations
 * - Validates tax rate changes
 * - Converts trade to gold/luxury/science
 * - Provides tax rate recommendations
 * - Manages rate change history
 */
export class TaxRateService extends BaseGameService {
  private gameId: string;
  private playerTaxRates: Map<string, TaxRates> = new Map();
  private playerTaxLocks: Map<string, TaxRateLocks> = new Map();
  private maxRateProvider: (playerId: string) => number = () => 60;

  constructor(gameId: string) {
    super(logger);
    this.gameId = gameId;
  }

  getServiceName(): string {
    return 'TaxRateService';
  }

  public setMaxRateProvider(provider: (playerId: string) => number): void {
    this.maxRateProvider = provider;
  }

  /**
   * Initialize tax rates for a new player
   */
  public initializePlayerTaxRates(playerId: string, customRates?: TaxRates): void {
    const rates = customRates || { ...DEFAULT_TAX_RATES };
    this.playerTaxRates.set(playerId, rates);

    // Initialize with no locks
    this.playerTaxLocks.set(playerId, {
      taxLocked: false,
      luxuryLocked: false,
      scienceLocked: false,
    });

    logger.info(`Initialized tax rates for player ${playerId}`, {
      gameId: this.gameId,
      playerId,
      rates,
    });
  }

  /**
   * Get current tax rates for a player
   */
  public getPlayerTaxRates(playerId: string): TaxRates {
    const rates = this.playerTaxRates.get(playerId);
    if (!rates) {
      // Return default rates if not found
      logger.warn(`Tax rates not found for player ${playerId}, using defaults`);
      return { ...DEFAULT_TAX_RATES };
    }
    return { ...rates };
  }

  /**
   * Validate tax rate configuration
   */
  public validateTaxRates(
    rates: TaxRates,
    constraints: TaxRateConstraints = TAX_RATE_CONSTRAINTS
  ): TaxRateValidation {
    const { tax, luxury, science } = rates;
    const { minRate, maxRate, increment, maxTotal } = constraints;

    // Check individual rate bounds
    if (tax < minRate || tax > maxRate) {
      return {
        isValid: false,
        error: `Tax rate must be between ${minRate}% and ${maxRate}%`,
      };
    }

    if (luxury < minRate || luxury > maxRate) {
      return {
        isValid: false,
        error: `Luxury rate must be between ${minRate}% and ${maxRate}%`,
      };
    }

    if (science < minRate || science > maxRate) {
      return {
        isValid: false,
        error: `Science rate must be between ${minRate}% and ${maxRate}%`,
      };
    }

    // Check increments (must be multiples of increment)
    if (tax % increment !== 0 || luxury % increment !== 0 || science % increment !== 0) {
      return {
        isValid: false,
        error: `All rates must be multiples of ${increment}%`,
      };
    }

    // Check total equals 100%
    const total = tax + luxury + science;
    if (total !== maxTotal) {
      return {
        isValid: false,
        error: `Total rate allocation must equal ${maxTotal}% (currently ${total}%)`,
      };
    }

    // Check for warnings (optional optimality checks)
    let warning: string | undefined;
    if (tax === 0 && luxury === 0) {
      warning = 'Consider allocating some trade to gold or luxury for economic balance';
    } else if (science === 0) {
      warning = 'No science allocation will halt technological progress';
    } else if (tax < 20 && luxury < 20) {
      warning = 'Very low gold and luxury may cause economic and happiness issues';
    }

    return {
      isValid: true,
      warning,
    };
  }

  /**
   * Set new tax rates for a player
   */
  public setPlayerTaxRates(request: TaxRateChangeRequest): TaxRateValidation {
    const { playerId, newRates } = request;

    // Validate the new rates
    const validation = this.validateTaxRates(newRates, {
      ...TAX_RATE_CONSTRAINTS,
      maxRate: this.maxRateProvider(playerId),
    });
    if (!validation.isValid) {
      return validation;
    }

    // Update player rates
    this.playerTaxRates.set(playerId, { ...newRates });

    logger.info(`Updated tax rates for player ${playerId}`, {
      gameId: this.gameId,
      playerId,
      newRates,
      immediate: request.immediate,
    });

    return validation;
  }

  /**
   * Convert trade points to outputs based on tax rates
   */
  public convertTradeToOutputs(
    playerId: string,
    tradePoints: number
  ): { gold: number; luxury: number; science: number } {
    const rates = this.getPlayerTaxRates(playerId);
    return distributeTrade(tradePoints, rates);
  }

  /**
   * Generate tax rate recommendations based on economic situation
   */
  public generateTaxRateRecommendation(
    playerId: string,
    economicSummary: PlayerEconomicSummary
  ): TaxRateRecommendation {
    const currentRates = this.getPlayerTaxRates(playerId);
    const { totals, goldAtTurnEnd } = economicSummary;

    let recommendedTax = currentRates.tax;
    let recommendedLuxury = currentRates.luxury;
    let recommendedScience = currentRates.science;
    let reason = 'Current rates are balanced';

    // Analyze economic situation and adjust recommendations
    if (goldAtTurnEnd < 20) {
      // Low treasury - recommend increasing tax
      recommendedTax = Math.min(70, currentRates.tax + 20);
      recommendedScience = Math.max(10, currentRates.science - 10);
      recommendedLuxury = Math.max(10, currentRates.luxury - 10);
      reason = 'Low treasury detected - increasing tax rate for gold income';
    } else if (totals.goldProduced > totals.buildingUpkeep + totals.unitUpkeep + 50) {
      // Excess gold - can afford more science
      recommendedScience = Math.min(60, currentRates.science + 10);
      recommendedTax = Math.max(20, currentRates.tax - 10);
      reason = 'Strong gold income - increasing science for faster research';
    } else if (totals.netGoldChange < -10) {
      // Negative income - emergency tax adjustment
      recommendedTax = Math.min(80, currentRates.tax + 30);
      recommendedLuxury = Math.max(0, currentRates.luxury - 15);
      recommendedScience = Math.max(0, currentRates.science - 15);
      reason = 'Negative income crisis - maximizing tax rate';
    }

    // Ensure recommendations are valid
    const total = recommendedTax + recommendedLuxury + recommendedScience;
    if (total !== 100) {
      // Adjust to ensure total equals 100
      const diff = 100 - total;
      recommendedTax += diff;
    }

    // Calculate expected outcomes
    const totalTrade = totals.tradeGenerated;

    const expectedOutcome = {
      goldPerTurn: Math.floor((totalTrade * recommendedTax) / 100),
      sciencePerTurn: Math.floor((totalTrade * recommendedScience) / 100),
      happinessEffect: Math.floor((totalTrade * recommendedLuxury) / 100 / 2), // Simplified happiness calculation
    };

    return {
      tax: recommendedTax,
      luxury: recommendedLuxury,
      science: recommendedScience,
      reason,
      expectedOutcome,
    };
  }

  /**
   * Get tax rate locks for a player
   */
  public getPlayerTaxLocks(playerId: string): TaxRateLocks {
    const locks = this.playerTaxLocks.get(playerId);
    if (!locks) {
      return {
        taxLocked: false,
        luxuryLocked: false,
        scienceLocked: false,
      };
    }
    return { ...locks };
  }

  /**
   * Set tax rate locks for a player
   */
  public setPlayerTaxLocks(playerId: string, locks: TaxRateLocks): void {
    this.playerTaxLocks.set(playerId, { ...locks });

    logger.debug(`Updated tax rate locks for player ${playerId}`, {
      gameId: this.gameId,
      playerId,
      locks,
    });
  }

  /**
   * Calculate optimal tax rates automatically (respecting locks)
   */
  public calculateOptimalRates(
    playerId: string,
    economicSummary: PlayerEconomicSummary,
    respectLocks: boolean = true
  ): TaxRates {
    const currentRates = this.getPlayerTaxRates(playerId);
    const locks = respectLocks
      ? this.getPlayerTaxLocks(playerId)
      : {
          taxLocked: false,
          luxuryLocked: false,
          scienceLocked: false,
        };

    // Start with current rates
    let optimalTax = currentRates.tax;
    let optimalLuxury = currentRates.luxury;
    let optimalScience = currentRates.science;

    // Apply automatic optimizations if not locked
    const recommendation = this.generateTaxRateRecommendation(playerId, economicSummary);

    if (!locks.taxLocked) {
      optimalTax = recommendation.tax;
    }
    if (!locks.luxuryLocked) {
      optimalLuxury = recommendation.luxury;
    }
    if (!locks.scienceLocked) {
      optimalScience = recommendation.science;
    }

    // Ensure total is 100% by adjusting unlocked rates
    const total = optimalTax + optimalLuxury + optimalScience;
    if (total !== 100) {
      const diff = 100 - total;

      // Distribute difference among unlocked rates
      const unlockedRates = [];
      if (!locks.taxLocked) unlockedRates.push('tax');
      if (!locks.luxuryLocked) unlockedRates.push('luxury');
      if (!locks.scienceLocked) unlockedRates.push('science');

      if (unlockedRates.length > 0) {
        const adjustmentPerRate = Math.floor(diff / unlockedRates.length);
        let remainder = diff - adjustmentPerRate * unlockedRates.length;

        if (unlockedRates.includes('tax')) {
          optimalTax += adjustmentPerRate + (remainder > 0 ? 1 : 0);
          remainder = Math.max(0, remainder - 1);
        }
        if (unlockedRates.includes('luxury')) {
          optimalLuxury += adjustmentPerRate + (remainder > 0 ? 1 : 0);
          remainder = Math.max(0, remainder - 1);
        }
        if (unlockedRates.includes('science')) {
          optimalScience += adjustmentPerRate + (remainder > 0 ? 1 : 0);
        }
      }
    }

    return {
      tax: Math.max(0, Math.min(100, optimalTax)),
      luxury: Math.max(0, Math.min(100, optimalLuxury)),
      science: Math.max(0, Math.min(100, optimalScience)),
    };
  }

  /**
   * Reset all players' tax rates (for game restart/cleanup)
   */
  public resetAllTaxRates(): void {
    this.playerTaxRates.clear();
    this.playerTaxLocks.clear();

    logger.info('Reset all tax rates', {
      gameId: this.gameId,
    });
  }
}
