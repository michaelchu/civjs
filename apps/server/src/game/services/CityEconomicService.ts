/**
 * CityEconomicService - Handles city-level economic calculations
 *
 * Calculates gold production and costs for individual cities, integrating with:
 * - CitizenManagement system for specialist gold production
 * - Building upkeep costs
 * - Trade route economics
 * - Unit upkeep (if paid by city vs nation)
 *
 * This service complements the existing city services architecture while
 * avoiding bloating CityManager.ts (already 1,977 lines).
 *
 * @reference freeciv/common/city.c - city economic calculations
 * @reference freeciv-web/javascript/city.js - city production system
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { type CityState, SpecialistType } from '@game/managers/CityManager';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import type { UnitSupportData } from '@game/managers/UnitSupportManager';
import type { CityEconomicOutput } from '@game/systems/Economic/types/EconomicTypes';
import {
  GOLD_UPKEEP_STYLES,
  type GoldUpkeepStyle,
} from '@game/systems/Economic/constants/EconomicConstants';
import { rulesetBuildingsService } from './RulesetBuildingsService';

/**
 * City economic calculation parameters
 */
export interface CityEconomicParams {
  /** City state data */
  city: CityState;
  /** Units supported by this city */
  supportedUnits: UnitSupportData[];
  /** Current government type */
  government: string;
  /** Gold upkeep payment style */
  goldUpkeepStyle: GoldUpkeepStyle;
  /** Distance from capital (for corruption) */
  distanceFromCapital?: number;
}

/**
 * Detailed city economic breakdown
 */
export interface CityEconomicBreakdown extends CityEconomicOutput {
  /** Detailed breakdown of gold sources */
  goldSources: {
    /** Gold from Tax Collector specialists */
    specialists: number;
    /** Gold from trade route bonuses */
    tradeRoutes: number;
    /** Gold from building effects */
    buildings: number;
    /** Gold from other sources */
    other: number;
  };

  /** Detailed breakdown of costs */
  costBreakdown: {
    /** Individual building upkeep costs */
    buildings: Array<{
      buildingId: string;
      name: string;
      upkeep: number;
    }>;
    /** Unit upkeep costs (if city pays) */
    units: Array<{
      unitId: string;
      unitType: string;
      goldUpkeep: number;
    }>;
  };

  /** Corruption and waste calculations */
  corruption: {
    /** Original trade before corruption */
    originalTrade: number;
    /** Trade lost to corruption */
    tradeLost: number;
    /** Corruption percentage */
    corruptionRate: number;
  };
}

/**
 * CityEconomicService handles city-level economic calculations
 */
export class CityEconomicService extends BaseGameService {
  constructor(
    _gameId: string,
    private readonly effectsManager: EffectsManager
  ) {
    super(logger);
    // gameId stored for future use if needed
  }

  getServiceName(): string {
    return 'CityEconomicService';
  }

  /**
   * Calculate basic economic output for a city
   */
  public calculateCityEconomicOutput(params: CityEconomicParams): CityEconomicOutput {
    const { city, supportedUnits, goldUpkeepStyle } = params;

    // Calculate raw trade (base city production + trade routes)
    const rawTrade = this.calculateCityTrade(city);

    // CityManager already stores trade after the single authoritative
    // calculateCityCorruption pass; this reporting service must not deduct it
    // again.
    const netTrade = rawTrade;

    // Calculate direct gold production (specialists, buildings)
    const directGold = this.calculateDirectGoldProduction(city);

    // Calculate building upkeep costs
    const buildingUpkeep = this.calculateBuildingUpkeep(city);

    // Calculate unit upkeep costs (if city pays)
    const unitUpkeep = this.calculateUnitUpkeep(supportedUnits, goldUpkeepStyle);

    return {
      cityId: city.id,
      playerId: city.playerId,
      rawTrade,
      netTrade,
      tradeConversion: {
        gold: 0, // Will be filled by EconomicManager based on tax rates
        luxury: 0,
        science: 0,
      },
      directGold,
      totalGoldProduced: directGold, // Trade conversion added by EconomicManager
      costs: {
        buildingUpkeep,
        unitUpkeep,
        total: buildingUpkeep + unitUpkeep,
      },
      netGoldContribution: directGold - buildingUpkeep - unitUpkeep,
    };
  }

  /**
   * Calculate detailed economic breakdown for a city
   */
  public calculateDetailedEconomicBreakdown(params: CityEconomicParams): CityEconomicBreakdown {
    const basicOutput = this.calculateCityEconomicOutput(params);
    const { city, supportedUnits, goldUpkeepStyle } = params;

    // Calculate detailed gold sources
    const goldSources = {
      specialists: this.calculateSpecialistGold(city),
      tradeRoutes: this.calculateTradeRouteGold(city),
      buildings: this.calculateBuildingGoldBonus(city),
      other: 0,
    };

    // Calculate detailed cost breakdown
    const costBreakdown = {
      buildings: this.getBuildingUpkeepBreakdown(city),
      units: this.getUnitUpkeepBreakdown(supportedUnits, goldUpkeepStyle),
    };

    // Calculate corruption details
    const corruption = {
      originalTrade: basicOutput.rawTrade,
      tradeLost: basicOutput.rawTrade - basicOutput.netTrade,
      corruptionRate:
        basicOutput.rawTrade > 0
          ? (basicOutput.rawTrade - basicOutput.netTrade) / basicOutput.rawTrade
          : 0,
    };

    return {
      ...basicOutput,
      goldSources,
      costBreakdown,
      corruption,
    };
  }

  /**
   * Calculate base trade production for a city
   */
  private calculateCityTrade(city: CityState): number {
    // Base trade from worked tiles (would integrate with CitizenManagement)
    let baseTrade = city.tradePerTurn || 0;

    // Add trade route bonuses
    baseTrade += this.calculateTradeRouteValue(city);

    return baseTrade;
  }

  /**
   * Calculate direct gold production (not from trade conversion)
   */
  private calculateDirectGoldProduction(city: CityState): number {
    let directGold = 0;

    // Gold from specialists
    directGold += this.calculateSpecialistGold(city);

    // Gold from building effects
    directGold += this.calculateBuildingGoldBonus(city);

    // Gold from trade routes (immediate gold bonus, not trade)
    directGold += this.calculateTradeRouteGold(city);

    // Gold from terrain and improvements (mines, special resources)
    directGold += this.calculateTerrainGoldProduction(city);

    return directGold;
  }

  /**
   * Calculate gold production from specialists
   */
  private calculateSpecialistGold(city: CityState): number {
    const taxCollectorCount = city.specialists?.[SpecialistType.TAX_COLLECTOR] || 0;
    return taxCollectorCount * this.getTaxCollectorOutputValue(city);
  }

  private getTaxCollectorOutputValue(city: CityState): number {
    return this.effectsManager.calculateEffect(EffectType.SPECIALIST_OUTPUT, {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
      specialist: 'taxman',
      outputType: OutputType.GOLD,
    }).value;
  }

  /**
   * Calculate gold bonuses from buildings
   */
  private calculateBuildingGoldBonus(city: CityState): number {
    const outputBonus = this.effectsManager.calculateEffect(EffectType.OUTPUT_BONUS, {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
      outputType: OutputType.GOLD,
    });

    return Math.floor(((city.tradePerTurn || 0) * outputBonus.value) / 100);
  }

  /**
   * Calculate gold from trade routes
   */
  private calculateTradeRouteGold(_city: CityState): number {
    // Trade routes primarily provide trade points, not direct gold
    // This would integrate with CityTradeRouteService
    return 0; // Placeholder - actual implementation would check active trade routes
  }

  /**
   * Calculate trade route trade value
   */
  private calculateTradeRouteValue(city: CityState): number {
    // This would integrate with the existing CityTradeRouteService
    // For now, return a simple calculation
    const tradeRouteCount = city.tradeRoutes?.length || 0;
    return tradeRouteCount * 2; // Simple placeholder: 2 trade per route
  }

  /**
   * Calculate direct gold production from terrain and improvements (STUB)
   * @reference freeciv/common/city.c - tile gold calculations
   * TODO: Integrate with MapManager and TerrainManager for actual tile data
   */
  private calculateTerrainGoldProduction(city: CityState): number {
    // STUB: Simulate gold production from mines and special resources
    // In a real implementation, this would:
    // 1. Get worked tiles from CitizenManagement
    // 2. Check each tile for improvements (mines) and special resources
    // 3. Calculate gold output based on terrain + improvement combinations

    // Simplified calculation based on city size (placeholder)
    const population = city.population || 1;

    // Assume some cities have mines/gold resources based on simple heuristics
    let terrainGold = 0;

    // Hills and mountains might have mines producing gold
    // For now, add 1 gold per 3 population to simulate mining potential
    terrainGold += Math.floor(population / 3);

    // Cities near rivers or coast might have additional trade-to-gold conversion
    // This is a simplified stub - real implementation would check actual terrain
    if (city.name?.includes('River') || city.name?.includes('Coast')) {
      terrainGold += 1;
    }

    // Special resources stub: some cities might have gold deposits
    // In real implementation, this would check tile special resources
    if (city.id && city.id.charCodeAt(0) % 4 === 0) {
      terrainGold += 2; // Simulate cities with gold mines/deposits
    }

    return terrainGold;
  }

  /**
   * Calculate building upkeep costs for a city
   */
  private calculateBuildingUpkeep(city: CityState): number {
    let totalUpkeep = 0;

    if (city.buildings) {
      const buildingTypes = rulesetBuildingsService.getBuildingTypes(
        this.effectsManager.getRulesetName()
      );
      for (const buildingId of city.buildings) {
        totalUpkeep += buildingTypes[buildingId]?.upkeep ?? 0;
      }
    }

    return totalUpkeep;
  }

  /**
   * Calculate unit upkeep costs (if city pays)
   */
  private calculateUnitUpkeep(
    supportedUnits: UnitSupportData[],
    goldUpkeepStyle: GoldUpkeepStyle
  ): number {
    // Only calculate if city pays for unit upkeep
    if (goldUpkeepStyle === GOLD_UPKEEP_STYLES.NATION) {
      return 0; // Nation pays all unit upkeep
    }

    if (goldUpkeepStyle === GOLD_UPKEEP_STYLES.MIXED) {
      return 0; // Nation pays unit upkeep, city pays building upkeep
    }

    // CITY style - city pays for both units and buildings
    let totalUpkeep = 0;
    for (const unit of supportedUnits) {
      totalUpkeep += unit.upkeep.gold;
    }

    return totalUpkeep;
  }

  /**
   * Get detailed building upkeep breakdown
   */
  private getBuildingUpkeepBreakdown(city: CityState): Array<{
    buildingId: string;
    name: string;
    upkeep: number;
  }> {
    const breakdown: Array<{ buildingId: string; name: string; upkeep: number }> = [];

    if (city.buildings) {
      const buildingTypes = rulesetBuildingsService.getBuildingTypes(
        this.effectsManager.getRulesetName()
      );
      for (const buildingId of city.buildings) {
        const building = buildingTypes[buildingId];
        const upkeep = building?.upkeep ?? 0;
        if (upkeep > 0) {
          breakdown.push({
            buildingId,
            name: building.name,
            upkeep,
          });
        }
      }
    }

    return breakdown;
  }

  /**
   * Get detailed unit upkeep breakdown
   */
  private getUnitUpkeepBreakdown(
    supportedUnits: UnitSupportData[],
    goldUpkeepStyle: GoldUpkeepStyle
  ): Array<{
    unitId: string;
    unitType: string;
    goldUpkeep: number;
  }> {
    const breakdown: Array<{ unitId: string; unitType: string; goldUpkeep: number }> = [];

    // Only include units if city pays for them
    if (goldUpkeepStyle === GOLD_UPKEEP_STYLES.CITY) {
      for (const unit of supportedUnits) {
        if (unit.upkeep.gold > 0) {
          breakdown.push({
            unitId: unit.unitId,
            unitType: unit.unitType,
            goldUpkeep: unit.upkeep.gold,
          });
        }
      }
    }

    return breakdown;
  }

  /**
   * Calculate economic efficiency metrics for a city
   */
  public calculateCityEconomicEfficiency(params: CityEconomicParams): {
    tradeEfficiency: number; // Trade per population
    goldEfficiency: number; // Gold per population
    upkeepRatio: number; // Upkeep as percentage of production
    netIncomePerPop: number; // Net economic contribution per citizen
  } {
    const breakdown = this.calculateDetailedEconomicBreakdown(params);
    const population = params.city.population || 1;

    const tradeEfficiency = breakdown.rawTrade / population;
    const goldEfficiency = breakdown.totalGoldProduced / population;
    const upkeepRatio =
      breakdown.totalGoldProduced > 0 ? breakdown.costs.total / breakdown.totalGoldProduced : 0;
    const netIncomePerPop = breakdown.netGoldContribution / population;

    return {
      tradeEfficiency,
      goldEfficiency,
      upkeepRatio,
      netIncomePerPop,
    };
  }

  /**
   * Recommend economic improvements for a city
   */
  public recommendEconomicImprovements(params: CityEconomicParams): Array<{
    type: 'building' | 'specialist' | 'trade_route';
    recommendation: string;
    expectedBenefit: number;
    reasoning: string;
  }> {
    const breakdown = this.calculateDetailedEconomicBreakdown(params);
    const recommendations: Array<{
      type: 'building' | 'specialist' | 'trade_route';
      recommendation: string;
      expectedBenefit: number;
      reasoning: string;
    }> = [];

    // Recommend buildings
    if (!params.city.buildings?.includes('marketplace') && breakdown.rawTrade >= 4) {
      recommendations.push({
        type: 'building',
        recommendation: 'Build Marketplace',
        expectedBenefit: Math.floor(breakdown.rawTrade * 0.5),
        reasoning: 'Marketplace provides 50% gold bonus from trade',
      });
    }

    if (
      params.city.buildings?.includes('marketplace') &&
      !params.city.buildings?.includes('bank') &&
      breakdown.rawTrade >= 8
    ) {
      recommendations.push({
        type: 'building',
        recommendation: 'Build Bank',
        expectedBenefit: Math.floor(breakdown.rawTrade * 0.5),
        reasoning: 'Bank provides additional 50% gold bonus with Marketplace',
      });
    }

    // Recommend specialists
    if (breakdown.rawTrade > breakdown.totalGoldProduced) {
      recommendations.push({
        type: 'specialist',
        recommendation: 'Add Tax Collector',
        expectedBenefit: this.getTaxCollectorOutputValue(params.city),
        reasoning: 'Tax Collectors provide guaranteed gold income',
      });
    }

    return recommendations;
  }
}
