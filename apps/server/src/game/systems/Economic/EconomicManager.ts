/**
 * EconomicManager - Main orchestrator for the economic system
 *
 * Coordinates all economic operations including:
 * - Tax rate management
 * - Treasury operations
 * - Turn-by-turn economic processing
 * - Economic analysis and recommendations
 *
 * Follows the existing CivJS Manager pattern established by CityManager,
 * TurnManager, etc. Orchestrates services rather than containing business logic.
 *
 * @reference freeciv/server/cityturn.c - economic turn processing
 * @reference freeciv-web/javascript/rates.js - economic UI interactions
 */

import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { TaxRateService } from './services/TaxRateService';
import { TreasuryService } from './services/TreasuryService';
import type {
  TaxRateChangeRequest,
  TaxRateValidation,
  TaxRateRecommendation,
} from './types/TaxRateTypes';
import type {
  TaxRates,
  PlayerEconomicSummary,
  CityEconomicOutput,
  EconomicWarning,
  RushBuildingCalculation,
  GoldTransaction,
  GoldSpendingType,
} from './types/EconomicTypes';
// Economic constants available but not currently used in this manager

/**
 * EconomicManager orchestrates all economic systems
 */
export class EconomicManager {
  private gameId: string;
  private taxRateService: TaxRateService;
  private treasuryService: TreasuryService;
  private isInitialized = false;

  constructor(gameId: string, databaseProvider: DatabaseProvider) {
    this.gameId = gameId;

    // Initialize services
    this.taxRateService = new TaxRateService(gameId);
    this.treasuryService = new TreasuryService(gameId, databaseProvider);

    logger.info('EconomicManager initialized', {
      gameId,
    });
  }

  /**
   * Initialize economic system for game start
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('EconomicManager already initialized', {
        gameId: this.gameId,
      });
      return;
    }

    logger.info('Initializing economic system', {
      gameId: this.gameId,
    });

    // Economic system is ready
    this.isInitialized = true;

    logger.info('Economic system initialized successfully', {
      gameId: this.gameId,
    });
  }

  /**
   * Initialize economic data for a new player
   */
  public async initializePlayer(
    playerId: string,
    startingGold: number = 50,
    customTaxRates?: TaxRates
  ): Promise<void> {
    logger.info('Initializing player economic data', {
      gameId: this.gameId,
      playerId,
      startingGold,
      customTaxRates,
    });

    // Initialize tax rates
    this.taxRateService.initializePlayerTaxRates(playerId, customTaxRates);

    // Set starting gold
    await this.treasuryService.setPlayerGold(playerId, startingGold);

    logger.info('Player economic data initialized', {
      gameId: this.gameId,
      playerId,
      taxRates: this.taxRateService.getPlayerTaxRates(playerId),
      gold: await this.treasuryService.getPlayerGold(playerId),
    });
  }

  // ============================================================================
  // Tax Rate Management
  // ============================================================================

  /**
   * Get current tax rates for a player
   */
  public getPlayerTaxRates(playerId: string): TaxRates {
    return this.taxRateService.getPlayerTaxRates(playerId);
  }

  /**
   * Set new tax rates for a player
   */
  public setPlayerTaxRates(request: TaxRateChangeRequest): TaxRateValidation {
    const validation = this.taxRateService.setPlayerTaxRates(request);

    if (validation.isValid) {
      logger.info('Tax rates updated successfully', {
        gameId: this.gameId,
        playerId: request.playerId,
        newRates: request.newRates,
      });
    } else {
      logger.warn('Tax rate change rejected', {
        gameId: this.gameId,
        playerId: request.playerId,
        newRates: request.newRates,
        error: validation.error,
      });
    }

    return validation;
  }

  /**
   * Get tax rate recommendation for a player
   */
  public getTaxRateRecommendation(
    playerId: string,
    economicSummary: PlayerEconomicSummary
  ): TaxRateRecommendation {
    return this.taxRateService.generateTaxRateRecommendation(playerId, economicSummary);
  }

  /**
   * Convert trade points to outputs for a player
   */
  public convertTradeToOutputs(
    playerId: string,
    tradePoints: number
  ): { gold: number; luxury: number; science: number } {
    return this.taxRateService.convertTradeToOutputs(playerId, tradePoints);
  }

  // ============================================================================
  // Treasury Management
  // ============================================================================

  /**
   * Get current gold amount for a player
   */
  public async getPlayerGold(playerId: string): Promise<number> {
    return this.treasuryService.getPlayerGold(playerId);
  }

  /**
   * Add gold to player treasury
   */
  public async addPlayerGold(
    playerId: string,
    amount: number,
    description: string,
    metadata?: { cityId?: string; turn?: number }
  ): Promise<boolean> {
    return this.treasuryService.addGold(
      playerId,
      amount,
      'RUSH_PRODUCTION' as GoldSpendingType, // Default type, could be parameterized
      description,
      metadata
    );
  }

  /**
   * Spend gold from player treasury
   */
  public async spendPlayerGold(
    playerId: string,
    amount: number,
    description: string,
    metadata?: { cityId?: string; turn?: number }
  ): Promise<{ success: boolean; newBalance?: number; error?: string }> {
    return this.treasuryService.spendGold(
      playerId,
      amount,
      'RUSH_PRODUCTION' as GoldSpendingType, // Default type, could be parameterized
      description,
      metadata
    );
  }

  // ============================================================================
  // Turn Processing
  // ============================================================================

  /**
   * Process economic calculations for a single city
   * Called by CityManager or TurnProcessingService
   */
  public calculateCityEconomicOutput(
    cityId: string,
    playerId: string,
    rawTrade: number,
    directGold: number = 0,
    buildingUpkeep: number = 0,
    unitUpkeep: number = 0,
    authoritativeGold?: number
  ): CityEconomicOutput {
    // Convert trade based on player's tax rates
    const tradeConversion = this.taxRateService.convertTradeToOutputs(playerId, rawTrade);

    const totalGoldProduced = authoritativeGold ?? tradeConversion.gold + directGold;
    const totalCosts = buildingUpkeep + unitUpkeep;
    const netGoldContribution = totalGoldProduced - totalCosts;

    return {
      cityId,
      playerId,
      rawTrade,
      netTrade: rawTrade, // No corruption calculation yet
      tradeConversion,
      directGold:
        authoritativeGold === undefined ? directGold : authoritativeGold - tradeConversion.gold,
      totalGoldProduced,
      costs: {
        buildingUpkeep,
        unitUpkeep,
        total: totalCosts,
      },
      netGoldContribution,
    };
  }

  /**
   * Process turn-end economic calculations for a player
   */
  public async processTurnEconomics(
    playerId: string,
    cityOutputs: CityEconomicOutput[],
    turn: number
  ): Promise<PlayerEconomicSummary> {
    const goldAtTurnStart = await this.treasuryService.getPlayerGold(playerId);
    const taxRates = this.taxRateService.getPlayerTaxRates(playerId);

    // Calculate totals
    const totals = {
      goldProduced: cityOutputs.reduce((sum, city) => sum + city.totalGoldProduced, 0),
      tradeGenerated: cityOutputs.reduce((sum, city) => sum + city.rawTrade, 0),
      buildingUpkeep: cityOutputs.reduce((sum, city) => sum + city.costs.buildingUpkeep, 0),
      unitUpkeep: cityOutputs.reduce((sum, city) => sum + city.costs.unitUpkeep, 0),
      netGoldChange: cityOutputs.reduce((sum, city) => sum + city.netGoldContribution, 0),
    };

    const goldAtTurnEnd = goldAtTurnStart + totals.netGoldChange;

    const economicSummary: PlayerEconomicSummary = {
      playerId,
      turn,
      taxRates,
      goldAtTurnStart,
      cities: cityOutputs,
      totals,
      goldAtTurnEnd,
      warnings: [], // Will be populated by treasury service
    };

    // Process treasury changes and warnings
    await this.treasuryService.processTurnGoldAccumulation(playerId, economicSummary);

    // Get updated warnings
    economicSummary.warnings = this.treasuryService.getEconomicWarnings(playerId);

    logger.debug('Processed turn economics', {
      gameId: this.gameId,
      playerId,
      turn,
      totals,
      goldChange: `${goldAtTurnStart} → ${goldAtTurnEnd} (${totals.netGoldChange >= 0 ? '+' : ''}${totals.netGoldChange})`,
    });

    return economicSummary;
  }

  // ============================================================================
  // Rush Building System
  // ============================================================================

  /**
   * Calculate rush building cost for a city
   */
  public async getRushBuildingCalculation(
    playerId: string,
    cityId: string,
    productionTarget: string,
    currentProgress: number,
    totalCost: number
  ): Promise<RushBuildingCalculation> {
    return this.treasuryService.getRushBuildingCalculation(
      playerId,
      cityId,
      productionTarget,
      currentProgress,
      totalCost
    );
  }

  /**
   * Execute rush building purchase
   */
  public async executeRushBuilding(
    playerId: string,
    cityId: string,
    rushCalculation: RushBuildingCalculation
  ): Promise<{ success: boolean; error?: string }> {
    return this.treasuryService.executeRushBuilding(playerId, cityId, rushCalculation);
  }

  // ============================================================================
  // Economic Analysis
  // ============================================================================

  /**
   * Get economic warnings for a player
   */
  public getEconomicWarnings(playerId: string): EconomicWarning[] {
    return this.treasuryService.getEconomicWarnings(playerId);
  }

  /**
   * Get transaction history for a player
   */
  public getTransactionHistory(playerId: string, limit?: number): GoldTransaction[] {
    return this.treasuryService.getTransactionHistory(playerId, limit);
  }

  /**
   * Get comprehensive economic status for a player
   */
  public async getPlayerEconomicStatus(playerId: string): Promise<{
    currentGold: number;
    taxRates: TaxRates;
    warnings: EconomicWarning[];
    recentTransactions: GoldTransaction[];
    treasuryStats: any;
  }> {
    const [currentGold, treasuryStats] = await Promise.all([
      this.treasuryService.getPlayerGold(playerId),
      this.treasuryService.getTreasuryStatistics(playerId),
    ]);

    return {
      currentGold,
      taxRates: this.taxRateService.getPlayerTaxRates(playerId),
      warnings: this.treasuryService.getEconomicWarnings(playerId),
      recentTransactions: this.treasuryService.getTransactionHistory(playerId, 10),
      treasuryStats,
    };
  }

  // ============================================================================
  // Cleanup and Utilities
  // ============================================================================

  /**
   * Reset economic data for game restart
   */
  public async resetEconomicData(): Promise<void> {
    this.taxRateService.resetAllTaxRates();
    this.treasuryService.resetAllTreasuryData();

    logger.info('Economic data reset', {
      gameId: this.gameId,
    });
  }

  /**
   * Get economic system health status
   */
  public getSystemStatus(): {
    isInitialized: boolean;
    gameId: string;
    services: string[];
  } {
    return {
      isInitialized: this.isInitialized,
      gameId: this.gameId,
      services: [this.taxRateService.getServiceName(), this.treasuryService.getServiceName()],
    };
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.resetEconomicData();
    this.isInitialized = false;

    logger.info('EconomicManager cleaned up', {
      gameId: this.gameId,
    });
  }
}
