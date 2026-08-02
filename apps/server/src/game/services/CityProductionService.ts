/**
 * @module server/game/services/CityProductionService
 * Provides the server-side City Production Service service.
 */
import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { BuildingCatalog, CityState } from '@game/cities/CityTypes';
import { type UnitType, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';

/**
 * CityProductionService - Manages city production buy/rush mechanics
 * Handles all production rush/buy operations including:
 * - Buy cost calculations
 * - Rush production execution
 * - Buy production validation
 * - Production buy information
 */
export class CityProductionService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private buildingTypes: BuildingCatalog,
    private getPlayerGold: (playerId: string) => Promise<number>,
    private spendPlayerGold: (playerId: string, amount: number) => Promise<boolean>,
    private readonly unitTypes: Record<string, UnitType> = rulesetUnitsService.getUnitTypes(),
    private readonly effectsManager: EffectsManager = new EffectsManager()
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
    if (!city) return this.invalidBuyCost('City not found');
    if (!city.currentProduction || !city.productionType)
      return this.invalidBuyCost('No active production');
    if (city.currentProduction === 'capitalization')
      return this.invalidBuyCost('Wealth is an ongoing conversion and cannot be rushed');
    const target = this.getBuyTarget(city);
    if (!target) return this.invalidBuyCost('Invalid production target');
    const totalCost = target.cost;

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

    goldCost = this.applyBuildingBuyPremium(city, goldCost);

    return {
      canBuy: shieldsRemaining > 0,
      goldCost,
      shieldsRemaining,
    };
  }

  private invalidBuyCost(reason: string): {
    canBuy: boolean;
    goldCost: number;
    shieldsRemaining: number;
    reason: string;
  } {
    return { canBuy: false, goldCost: 0, shieldsRemaining: 0, reason };
  }

  private getBuyTarget(city: CityState): { cost: number; building?: any } | undefined {
    if (city.productionType === 'unit') {
      const unit = this.unitTypes[city.currentProduction!];
      return unit ? { cost: unit.cost } : undefined;
    }
    if (city.productionType === 'building') {
      const building = this.buildingTypes[city.currentProduction!];
      return building ? { cost: building.cost, building } : undefined;
    }
    return undefined;
  }

  private applyBuildingBuyPremium(city: CityState, goldCost: number): number {
    if (city.productionType !== 'building') return goldCost;
    const building = this.buildingTypes[city.currentProduction!];
    const premium = this.effectsManager.calculateEffect(EffectType.BUILDING_BUY_COST_PCT, {
      playerId: city.playerId,
      buildingId: building.id,
      buildingGenus: building.genus,
    }).value;
    return Math.floor((goldCost * (100 + premium)) / 100);
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
    if (!city) return this.failedBuy('City not found');

    // Validate ownership
    if (city.playerId !== playerId) return this.failedBuy('City not owned by player');

    // Calculate buy cost
    const buyCost = this.calculateBuyCost(cityId);
    if (!buyCost.canBuy) return this.failedBuy(buyCost.reason || 'Cannot buy production');

    // Check player has enough gold
    const playerGold = await this.getPlayerGold(playerId);
    if (playerGold < buyCost.goldCost)
      return this.failedBuy(`Insufficient gold: need ${buyCost.goldCost}, have ${playerGold}`);

    // Spend the gold
    const goldSpent = await this.spendPlayerGold(playerId, buyCost.goldCost);
    if (!goldSpent) return this.failedBuy('Failed to spend gold');

    // Complete the production
    const totalCost = this.getBuyTarget(city)?.cost ?? 0;

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

  private failedBuy(reason: string): {
    success: false;
    goldSpent: number;
    completed: false;
    reason: string;
  } {
    return { success: false, goldSpent: 0, completed: false, reason };
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
    if (!city) return this.emptyBuyInfo(0);

    if (!city.currentProduction || !city.productionType) {
      return this.emptyBuyInfo(
        city.productionStock ?? city.shieldStock ?? 0,
        await this.getPlayerGold(city.playerId)
      );
    }

    const { productionName, totalCost } = this.getProductionBuyTarget(city);

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

  private getProductionBuyTarget(city: CityState): { productionName: string; totalCost: number } {
    const target = this.getBuyTarget(city);
    return {
      productionName: target?.building?.name ?? this.unitTypes[city.currentProduction!]?.name ?? '',
      totalCost: target?.cost ?? 0,
    };
  }

  private emptyBuyInfo(shieldStock: number, playerGold = 0): any {
    return {
      hasProduction: false,
      productionName: '',
      productionType: '',
      totalCost: 0,
      shieldStock,
      shieldsRemaining: 0,
      goldCost: 0,
      canAfford: false,
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
