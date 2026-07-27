import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState, BUILDING_TYPES } from '@game/managers/CityManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';

/**
 * CityProductionService - Manages city production buy/rush mechanics
 * @reference docs/refactor/REFACTORING_PLAN.md - CityManager refactoring
 *
 * Handles all production rush/buy operations including:
 * - Buy cost calculations
 * - Rush production execution
 * - Buy production validation
 * - Production buy information
 */
export class CityProductionService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private buildingTypes: typeof BUILDING_TYPES,
    private getPlayerGold: (playerId: string) => Promise<number>,
    private spendPlayerGold: (playerId: string, amount: number) => Promise<boolean>
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityProductionService';
  }

  /**
   * Calculate the cost to buy/rush current production
   * @reference Original CityManager.calculateBuyCost()
   */
  public calculateBuyCost(cityId: string): {
    canBuy: boolean;
    goldCost: number;
    shieldsRemaining: number;
    reason?: string;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        canBuy: false,
        goldCost: 0,
        shieldsRemaining: 0,
        reason: 'City not found',
      };
    }

    if (!city.currentProduction || !city.productionType) {
      return {
        canBuy: false,
        goldCost: 0,
        shieldsRemaining: 0,
        reason: 'No active production',
      };
    }

    let totalCost: number;

    if (city.productionType === 'unit') {
      const unitType = UNIT_TYPES[city.currentProduction];
      if (!unitType) {
        return {
          canBuy: false,
          goldCost: 0,
          shieldsRemaining: 0,
          reason: 'Unknown unit type',
        };
      }
      totalCost = unitType.cost;
    } else if (city.productionType === 'building') {
      const building = this.buildingTypes[city.currentProduction];
      if (!building) {
        return {
          canBuy: false,
          goldCost: 0,
          shieldsRemaining: 0,
          reason: 'Unknown building type',
        };
      }
      totalCost = building.cost;
    } else {
      return {
        canBuy: false,
        goldCost: 0,
        shieldsRemaining: 0,
        reason: 'Invalid production type',
      };
    }

    const productionStock = city.productionStock ?? city.shieldStock ?? 0;
    const shieldsRemaining = Math.max(0, totalCost - productionStock);

    // Freeciv charges different rush premiums for units and improvements,
    // then doubles the price when no shields have been accumulated.
    // @reference reference/freeciv/common/improvement.c:306-326
    // @reference reference/freeciv/common/unittype.c:1517-1537
    let goldCost =
      city.productionType === 'unit'
        ? 2 * shieldsRemaining + Math.floor((shieldsRemaining * shieldsRemaining) / 20)
        : 2 * shieldsRemaining;
    if (productionStock === 0) {
      goldCost *= 2;
    }

    return {
      canBuy: shieldsRemaining > 0,
      goldCost,
      shieldsRemaining,
    };
  }

  /**
   * Buy/rush the current production
   * @reference Original CityManager.buyProduction()
   */
  public async buyProduction(
    cityId: string,
    playerId: string
  ): Promise<{
    success: boolean;
    goldSpent: number;
    completed: boolean;
    reason?: string;
  }> {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        success: false,
        goldSpent: 0,
        completed: false,
        reason: 'City not found',
      };
    }

    // Validate ownership
    if (city.playerId !== playerId) {
      return {
        success: false,
        goldSpent: 0,
        completed: false,
        reason: 'City not owned by player',
      };
    }

    // Calculate buy cost
    const buyCost = this.calculateBuyCost(cityId);
    if (!buyCost.canBuy) {
      return {
        success: false,
        goldSpent: 0,
        completed: false,
        reason: buyCost.reason || 'Cannot buy production',
      };
    }

    // Check player has enough gold
    const playerGold = await this.getPlayerGold(playerId);
    if (playerGold < buyCost.goldCost) {
      return {
        success: false,
        goldSpent: 0,
        completed: false,
        reason: `Insufficient gold: need ${buyCost.goldCost}, have ${playerGold}`,
      };
    }

    // Spend the gold
    const goldSpent = await this.spendPlayerGold(playerId, buyCost.goldCost);
    if (!goldSpent) {
      return {
        success: false,
        goldSpent: 0,
        completed: false,
        reason: 'Failed to spend gold',
      };
    }

    // Complete the production
    let totalCost = 0;
    if (city.productionType === 'unit' && city.currentProduction) {
      const unitType = UNIT_TYPES[city.currentProduction];
      totalCost = unitType?.cost || 0;
    } else if (city.productionType === 'building' && city.currentProduction) {
      const building = this.buildingTypes[city.currentProduction];
      totalCost = building?.cost || 0;
    }

    // Buying fills the same authoritative stock consumed by turn processing.
    // Keep the legacy alias synchronized while callers migrate.
    // @reference reference/freeciv/server/cityhand.c:348-356
    city.productionStock = totalCost;
    city.shieldStock = totalCost;
    city.turnsToComplete = 0;

    logger.info('Production rushed with gold', {
      cityId,
      cityName: city.name,
      playerId,
      production: city.currentProduction,
      productionType: city.productionType,
      goldCost: buyCost.goldCost,
      shieldsRemaining: buyCost.shieldsRemaining,
    });

    return {
      success: true,
      goldSpent: buyCost.goldCost,
      completed: true,
    };
  }

  /**
   * Check if production can be bought
   * @reference Original CityManager.canBuyProduction()
   */
  public async canBuyProduction(
    cityId: string,
    playerId: string
  ): Promise<{
    canBuy: boolean;
    reason?: string;
    goldCost?: number;
  }> {
    const city = this.cities.get(cityId);
    if (!city) {
      return { canBuy: false, reason: 'City not found' };
    }

    if (city.playerId !== playerId) {
      return { canBuy: false, reason: 'City not owned by player' };
    }

    if (!city.currentProduction || !city.productionType) {
      return { canBuy: false, reason: 'No active production' };
    }

    // Check if city has bought production this turn (would be tracked in full implementation)
    // For now, we'll allow multiple buys per turn

    const buyCost = this.calculateBuyCost(cityId);
    if (!buyCost.canBuy) {
      return { canBuy: false, reason: buyCost.reason };
    }

    const playerGold = await this.getPlayerGold(playerId);
    if (playerGold < buyCost.goldCost) {
      return {
        canBuy: false,
        reason: `Insufficient gold: need ${buyCost.goldCost}, have ${playerGold}`,
        goldCost: buyCost.goldCost,
      };
    }

    return {
      canBuy: true,
      goldCost: buyCost.goldCost,
    };
  }

  /**
   * Get production buy information
   * @reference Original CityManager.getProductionBuyInfo()
   */
  public async getProductionBuyInfo(cityId: string): Promise<{
    hasProduction: boolean;
    productionName: string;
    productionType: string;
    totalCost: number;
    shieldStock: number;
    shieldsRemaining: number;
    goldCost: number;
    canAfford: boolean;
    playerGold: number;
  }> {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        hasProduction: false,
        productionName: '',
        productionType: '',
        totalCost: 0,
        shieldStock: 0,
        shieldsRemaining: 0,
        goldCost: 0,
        canAfford: false,
        playerGold: 0,
      };
    }

    if (!city.currentProduction || !city.productionType) {
      return {
        hasProduction: false,
        productionName: '',
        productionType: '',
        totalCost: 0,
        shieldStock: city.productionStock ?? city.shieldStock ?? 0,
        shieldsRemaining: 0,
        goldCost: 0,
        canAfford: false,
        playerGold: await this.getPlayerGold(city.playerId),
      };
    }

    let productionName = '';
    let totalCost = 0;

    if (city.productionType === 'unit') {
      const unitType = UNIT_TYPES[city.currentProduction];
      if (unitType) {
        productionName = unitType.name;
        totalCost = unitType.cost;
      }
    } else if (city.productionType === 'building') {
      const building = this.buildingTypes[city.currentProduction];
      if (building) {
        productionName = building.name;
        totalCost = building.cost;
      }
    }

    const shieldStock = city.productionStock ?? city.shieldStock ?? 0;
    const shieldsRemaining = Math.max(0, totalCost - shieldStock);
    const goldCost = shieldsRemaining * 2;
    const playerGold = await this.getPlayerGold(city.playerId);

    return {
      hasProduction: true,
      productionName,
      productionType: city.productionType,
      totalCost,
      shieldStock,
      shieldsRemaining,
      goldCost,
      canAfford: playerGold >= goldCost && shieldsRemaining > 0,
      playerGold,
    };
  }

  /**
   * Get rush buy multiplier based on government type
   * Different governments have different rush buy costs
   */
  public getRushBuyMultiplier(governmentType: string): number {
    const multipliers: Record<string, number> = {
      despotism: 2.0, // Standard cost
      monarchy: 2.0, // Standard cost
      republic: 3.0, // More expensive
      democracy: 4.0, // Most expensive
      communism: 2.0, // Standard cost
      fundamentalism: 2.0, // Standard cost
    };

    return multipliers[governmentType] || 2.0;
  }

  /**
   * Calculate adjusted buy cost based on government
   */
  public calculateAdjustedBuyCost(
    cityId: string,
    governmentType: string
  ): {
    canBuy: boolean;
    goldCost: number;
    baseGoldCost: number;
    shieldsRemaining: number;
    multiplier: number;
    reason?: string;
  } {
    const baseCost = this.calculateBuyCost(cityId);
    if (!baseCost.canBuy) {
      return {
        ...baseCost,
        baseGoldCost: baseCost.goldCost,
        multiplier: 1.0,
      };
    }

    const multiplier = this.getRushBuyMultiplier(governmentType);
    const adjustedGoldCost = Math.floor(baseCost.goldCost * multiplier);

    return {
      canBuy: true,
      goldCost: adjustedGoldCost,
      baseGoldCost: baseCost.goldCost,
      shieldsRemaining: baseCost.shieldsRemaining,
      multiplier,
    };
  }
}
