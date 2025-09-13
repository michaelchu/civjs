/**
 * TreasuryService - Handles player gold accumulation and spending
 *
 * Manages the player's treasury including:
 * - Gold accumulation from cities each turn
 * - Gold spending on upkeep, rush building, etc.
 * - Treasury warnings and economic alerts
 * - Transaction history and auditing
 *
 * @reference freeciv/server/cityturn.c - treasury management
 * @reference freeciv/common/city.c - gold calculations
 */

import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { players } from '@database/schema';
import { eq } from 'drizzle-orm';
import { BaseGameService } from '@game/orchestrators/GameService';
import {
  PlayerEconomicSummary,
  EconomicWarning,
  EconomicWarningType,
  GoldTransaction,
  GoldSpendingType,
  RushBuildingCalculation,
} from '../types/EconomicTypes';
import { ECONOMIC_THRESHOLDS, RUSH_BUILDING_MULTIPLIERS } from '../constants/EconomicConstants';

/**
 * TreasuryService manages player gold and economic transactions
 */
export class TreasuryService extends BaseGameService {
  private gameId: string;
  private databaseProvider: DatabaseProvider;
  private transactionHistory: Map<string, GoldTransaction[]> = new Map();
  private economicWarnings: Map<string, EconomicWarning[]> = new Map();

  constructor(gameId: string, databaseProvider: DatabaseProvider) {
    super(logger);
    this.gameId = gameId;
    this.databaseProvider = databaseProvider;
  }

  getServiceName(): string {
    return 'TreasuryService';
  }

  /**
   * Get current gold amount for a player
   */
  public async getPlayerGold(playerId: string): Promise<number> {
    try {
      const db = this.databaseProvider.getDatabase();
      const [player] = await db
        .select({ gold: players.gold })
        .from(players)
        .where(eq(players.id, playerId))
        .limit(1);

      return player?.gold ?? 0;
    } catch (error) {
      logger.error(`Failed to get player gold for ${playerId}`, {
        gameId: this.gameId,
        playerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Set player gold amount (direct database update)
   */
  public async setPlayerGold(playerId: string, amount: number): Promise<boolean> {
    try {
      const db = this.databaseProvider.getDatabase();
      const clampedAmount = Math.max(0, Math.floor(amount)); // Ensure non-negative integer

      await db.update(players).set({ gold: clampedAmount }).where(eq(players.id, playerId));

      logger.debug(`Updated player gold`, {
        gameId: this.gameId,
        playerId,
        newAmount: clampedAmount,
      });

      return true;
    } catch (error) {
      logger.error(`Failed to set player gold for ${playerId}`, {
        gameId: this.gameId,
        playerId,
        amount,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Add gold to player treasury (with transaction record)
   */
  public async addGold(
    playerId: string,
    amount: number,
    type: GoldSpendingType,
    description: string,
    metadata?: { cityId?: string; unitId?: string; turn?: number }
  ): Promise<boolean> {
    const currentGold = await this.getPlayerGold(playerId);
    const newAmount = currentGold + amount;

    const success = await this.setPlayerGold(playerId, newAmount);

    if (success) {
      // Record transaction
      await this.recordTransaction(playerId, amount, type, description, metadata);

      logger.info(`Added gold to player treasury`, {
        gameId: this.gameId,
        playerId,
        amount,
        previousGold: currentGold,
        newGold: newAmount,
        type,
        description,
      });
    }

    return success;
  }

  /**
   * Spend gold from player treasury (with validation)
   */
  public async spendGold(
    playerId: string,
    amount: number,
    type: GoldSpendingType,
    description: string,
    metadata?: { cityId?: string; unitId?: string; turn?: number },
    allowDebt: boolean = false
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    const currentGold = await this.getPlayerGold(playerId);

    if (!allowDebt && currentGold < amount) {
      return {
        success: false,
        error: `Insufficient gold: have ${currentGold}, need ${amount}`,
      };
    }

    const newAmount = currentGold - amount;
    const success = await this.setPlayerGold(playerId, Math.max(0, newAmount));

    if (success) {
      // Record transaction as negative amount
      await this.recordTransaction(playerId, -amount, type, description, metadata);

      logger.info(`Spent gold from player treasury`, {
        gameId: this.gameId,
        playerId,
        amount,
        previousGold: currentGold,
        newGold: Math.max(0, newAmount),
        type,
        description,
      });

      return {
        success: true,
        newBalance: Math.max(0, newAmount),
      };
    }

    return {
      success: false,
      error: 'Database update failed',
    };
  }

  /**
   * Process turn-end gold accumulation for a player
   */
  public async processTurnGoldAccumulation(
    playerId: string,
    economicSummary: PlayerEconomicSummary
  ): Promise<boolean> {
    const { totals, turn } = economicSummary;
    const netGoldChange = totals.netGoldChange;

    if (netGoldChange !== 0) {
      const type =
        netGoldChange > 0 ? GoldSpendingType.BUILDING_UPKEEP : GoldSpendingType.UNIT_UPKEEP;
      const description = `Turn ${turn} economic processing: ${netGoldChange > 0 ? 'income' : 'expenses'}`;

      const success = await this.addGold(playerId, netGoldChange, type, description, { turn });

      if (success) {
        // Update economic warnings
        await this.updateEconomicWarnings(playerId, economicSummary);
      }

      return success;
    }

    return true; // No change needed
  }

  /**
   * Calculate rush building cost
   */
  public calculateRushCost(
    currentProgress: number,
    totalCost: number,
    rushMultiplier: number = RUSH_BUILDING_MULTIPLIERS.BASE_MULTIPLIER
  ): number {
    const remainingCost = Math.max(0, totalCost - currentProgress);
    const baseRushCost = remainingCost * rushMultiplier;

    return Math.max(RUSH_BUILDING_MULTIPLIERS.MINIMUM_RUSH_COST, baseRushCost);
  }

  /**
   * Get rush building calculation for a city
   */
  public async getRushBuildingCalculation(
    playerId: string,
    cityId: string,
    productionTarget: string,
    currentProgress: number,
    totalCost: number
  ): Promise<RushBuildingCalculation> {
    const playerGold = await this.getPlayerGold(playerId);
    const rushCost = this.calculateRushCost(currentProgress, totalCost);

    return {
      cityId,
      productionTarget,
      currentProgress,
      totalCost,
      remainingCost: totalCost - currentProgress,
      rushCost,
      canAfford: playerGold >= rushCost,
      playerGold,
    };
  }

  /**
   * Execute rush building purchase
   */
  public async executeRushBuilding(
    playerId: string,
    cityId: string,
    rushCalculation: RushBuildingCalculation
  ): Promise<{ success: boolean; error?: string }> {
    const { rushCost, productionTarget } = rushCalculation;

    const spendResult = await this.spendGold(
      playerId,
      rushCost,
      GoldSpendingType.RUSH_PRODUCTION,
      `Rush building: ${productionTarget} in city ${cityId}`,
      { cityId }
    );

    if (spendResult.success) {
      logger.info(`Rush building completed`, {
        gameId: this.gameId,
        playerId,
        cityId,
        productionTarget,
        rushCost,
        remainingGold: spendResult.newBalance,
      });
    }

    return spendResult;
  }

  /**
   * Record a gold transaction
   */
  private async recordTransaction(
    playerId: string,
    amount: number,
    type: GoldSpendingType,
    description: string,
    metadata?: { cityId?: string; unitId?: string; turn?: number }
  ): Promise<void> {
    const transaction: GoldTransaction = {
      id: `${this.gameId}-${playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      playerId,
      amount,
      type,
      description,
      turn: metadata?.turn ?? 0,
      cityId: metadata?.cityId,
      unitId: metadata?.unitId,
      timestamp: new Date(),
    };

    // Store in memory (could be extended to database storage)
    const playerTransactions = this.transactionHistory.get(playerId) || [];
    playerTransactions.push(transaction);

    // Keep only last 100 transactions per player
    if (playerTransactions.length > 100) {
      playerTransactions.splice(0, playerTransactions.length - 100);
    }

    this.transactionHistory.set(playerId, playerTransactions);
  }

  /**
   * Get transaction history for a player
   */
  public getTransactionHistory(playerId: string, limit: number = 50): GoldTransaction[] {
    const transactions = this.transactionHistory.get(playerId) || [];
    return transactions.slice(-limit).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Update economic warnings for a player
   */
  private async updateEconomicWarnings(
    playerId: string,
    economicSummary: PlayerEconomicSummary
  ): Promise<void> {
    const warnings: EconomicWarning[] = [];
    const { goldAtTurnEnd, totals } = economicSummary;

    // Low treasury warning
    if (goldAtTurnEnd <= ECONOMIC_THRESHOLDS.LOW_TREASURY) {
      const severity =
        goldAtTurnEnd <= ECONOMIC_THRESHOLDS.CRITICAL_TREASURY ? 'critical' : 'warning';
      warnings.push({
        type: EconomicWarningType.LOW_TREASURY,
        severity,
        message: `Treasury is ${severity === 'critical' ? 'critically' : ''} low: ${goldAtTurnEnd} gold`,
        suggestion: 'Consider increasing tax rates or reducing expenses',
      });
    }

    // Negative income warning
    if (totals.netGoldChange < ECONOMIC_THRESHOLDS.NEGATIVE_INCOME_WARNING) {
      warnings.push({
        type: EconomicWarningType.NEGATIVE_INCOME,
        severity: 'warning',
        message: `Negative income: ${totals.netGoldChange} gold per turn`,
        suggestion: 'Increase tax rates or reduce unit/building upkeep',
      });
    }

    // High upkeep warning
    const totalUpkeep = totals.buildingUpkeep + totals.unitUpkeep;
    const upkeepPercentage = totals.goldProduced > 0 ? totalUpkeep / totals.goldProduced : 1;

    if (upkeepPercentage >= ECONOMIC_THRESHOLDS.HIGH_UPKEEP_THRESHOLD) {
      warnings.push({
        type: EconomicWarningType.HIGH_UPKEEP,
        severity: 'warning',
        message: `High upkeep costs: ${Math.round(upkeepPercentage * 100)}% of income`,
        suggestion: 'Consider selling buildings or disbanding units',
      });
    }

    this.economicWarnings.set(playerId, warnings);
  }

  /**
   * Get current economic warnings for a player
   */
  public getEconomicWarnings(playerId: string): EconomicWarning[] {
    return this.economicWarnings.get(playerId) || [];
  }

  /**
   * Clear economic warnings for a player
   */
  public clearEconomicWarnings(playerId: string): void {
    this.economicWarnings.delete(playerId);
  }

  /**
   * Get treasury statistics for debugging/admin
   */
  public async getTreasuryStatistics(playerId: string): Promise<{
    currentGold: number;
    transactionCount: number;
    recentIncome: number;
    recentExpenses: number;
    warningCount: number;
  }> {
    const currentGold = await this.getPlayerGold(playerId);
    const transactions = this.getTransactionHistory(playerId, 10);
    const warnings = this.getEconomicWarnings(playerId);

    const recentIncome = transactions
      .filter(t => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const recentExpenses = transactions
      .filter(t => t.amount < 0)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    return {
      currentGold,
      transactionCount: transactions.length,
      recentIncome,
      recentExpenses,
      warningCount: warnings.length,
    };
  }

  /**
   * Reset all treasury data (for game restart/cleanup)
   */
  public resetAllTreasuryData(): void {
    this.transactionHistory.clear();
    this.economicWarnings.clear();

    logger.info('Reset all treasury data', {
      gameId: this.gameId,
    });
  }
}
