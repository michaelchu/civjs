/**
 * Unit Support Manager - Unit upkeep cost system
 * Direct port of freeciv unit support calculations
 * 
 * Handles government-specific unit support costs including:
 * - Free unit support per city
 * - Shield/food/gold upkeep costs
 * - Government upkeep modifiers
 * - Unhappiness from military units away from home
 * 
 * Reference: /reference/freeciv/common/city.c city_support()
 */

import { logger } from '../utils/logger';
import { EffectsManager, EffectType, OutputType, EffectContext } from './EffectsManager';

// Unit upkeep cost structure - matches freeciv O_LAST output types
export interface UnitUpkeep {
  food: number;
  shield: number;
  gold: number;
}

// Unit support calculation result
export interface UnitSupportResult {
  totalUnitsSupported: number;
  freeUnitsSupported: number;
  unitsRequiringUpkeep: number;
  upkeepCosts: UnitUpkeep;
  happinessEffect: number; // Unhappiness from units away from home
}

// Gold upkeep style - matches freeciv game settings
export enum GoldUpkeepStyle {
  CITY = 'city',        // City pays for both buildings and units
  MIXED = 'mixed',      // City pays for buildings, nation pays for units  
  NATION = 'nation'     // Nation pays for both buildings and units
}

// Unit support data (placeholder - will be integrated with UnitManager)
export interface UnitSupportData {
  unitId: string;
  unitType: string;
  homeCity: string;
  currentLocation: string;
  upkeep: UnitUpkeep;
  isAwayFromHome: boolean;
  isMilitaryUnit: boolean;
}

/**
 * UnitSupportManager - Government-specific unit support costs
 * Direct port of freeciv unit support system architecture
 */
export class UnitSupportManager {
  private effectsManager: EffectsManager;
  private goldUpkeepStyle: GoldUpkeepStyle = GoldUpkeepStyle.CITY;
  private foodCostPerCitizen = 2; // Default food cost per citizen

  constructor(effectsManager: EffectsManager) {
    this.effectsManager = effectsManager;
  }

  /**
   * Set gold upkeep style (game setting)
   * Reference: freeciv game.info.gold_upkeep_style
   */
  public setGoldUpkeepStyle(style: GoldUpkeepStyle): void {
    this.goldUpkeepStyle = style;
    logger.debug(`Gold upkeep style set to: ${style}`);
  }

  /**
   * Set food cost per citizen (game setting)
   * Reference: freeciv game.info.food_cost
   */
  public setFoodCostPerCitizen(cost: number): void {
    this.foodCostPerCitizen = cost;
    logger.debug(`Food cost per citizen set to: ${cost}`);
  }

  /**
   * Calculate unit support costs for a city
   * Reference: freeciv city_support() function
   */
  public calculateCityUnitSupport(
    cityId: string,
    playerId: string,
    currentGovernment: string,
    cityPopulation: number,
    unitsSupported: UnitSupportData[]
  ): UnitSupportResult {
    const context: EffectContext = {
      playerId,
      cityId,
      government: currentGovernment
    };

    // Initialize result
    const result: UnitSupportResult = {
      totalUnitsSupported: unitsSupported.length,
      freeUnitsSupported: 0,
      unitsRequiringUpkeep: 0,
      upkeepCosts: { food: 0, shield: 0, gold: 0 },
      happinessEffect: 0
    };

    // Calculate free unit support per city by government
    const freeShieldUnits = this.effectsManager.calculateUnitSupport(
      { ...context, outputType: OutputType.SHIELD },
      OutputType.SHIELD,
      unitsSupported.length
    );

    const freeFoodUnits = this.effectsManager.calculateUnitSupport(
      { ...context, outputType: OutputType.FOOD },
      OutputType.FOOD,
      unitsSupported.length
    );

    const freeGoldUnits = this.effectsManager.calculateUnitSupport(
      { ...context, outputType: OutputType.GOLD },
      OutputType.GOLD,
      unitsSupported.length
    );

    // Calculate upkeep costs for each unit
    let shieldUnitsRequiringSupport = 0;
    let foodUnitsRequiringSupport = 0;
    let goldUnitsRequiringSupport = 0;
    let militaryUnhappiness = 0;

    for (const unit of unitsSupported) {
      // Count units requiring shield support
      if (unit.upkeep.shield > 0) {
        shieldUnitsRequiringSupport++;
      }

      // Count units requiring food support
      if (unit.upkeep.food > 0) {
        foodUnitsRequiringSupport++;
      }

      // Count units requiring gold support (depends on upkeep style)
      if (unit.upkeep.gold > 0 && this.shouldCityPayGoldUpkeep()) {
        goldUnitsRequiringSupport++;
      }

      // Calculate military unhappiness from units away from home
      if (unit.isMilitaryUnit && unit.isAwayFromHome) {
        militaryUnhappiness += this.calculateMilitaryUnhappiness(
          context,
          unit.unitType
        );
      }
    }

    // Apply free unit support
    const shieldUnitsNeedingSupport = Math.max(0, shieldUnitsRequiringSupport - freeShieldUnits);
    const foodUnitsNeedingSupport = Math.max(0, foodUnitsRequiringSupport - freeFoodUnits);
    const goldUnitsNeedingSupport = Math.max(0, goldUnitsRequiringSupport - freeGoldUnits);

    // Calculate total upkeep costs
    result.upkeepCosts.shield = shieldUnitsNeedingSupport;
    result.upkeepCosts.food = foodUnitsNeedingSupport;
    result.upkeepCosts.gold = goldUnitsNeedingSupport;

    // Add citizen food consumption
    result.upkeepCosts.food += cityPopulation * this.foodCostPerCitizen;

    // Apply government upkeep modifiers
    result.upkeepCosts = this.applyGovernmentUpkeepModifiers(
      context,
      result.upkeepCosts
    );

    // Calculate free units supported
    result.freeUnitsSupported = Math.min(
      unitsSupported.length,
      Math.min(freeShieldUnits, Math.min(freeFoodUnits, freeGoldUnits))
    );
    result.unitsRequiringUpkeep = unitsSupported.length - result.freeUnitsSupported;
    result.happinessEffect = militaryUnhappiness;

    return result;
  }

  /**
   * Calculate military unhappiness from units away from home
   * Reference: freeciv city_unit_unhappiness()
   */
  private calculateMilitaryUnhappiness(
    context: EffectContext,
    _unitType: string
  ): number {
    // Republic: 1 unhappy per military unit away from home
    // Democracy: 2 unhappy per military unit away from home
    // Other governments: 0 unhappy

    if (context.government === 'republic') {
      return 1;
    } else if (context.government === 'democracy') {
      return 2;
    }
    return 0;
  }

  /**
   * Apply government-specific upkeep modifiers
   * Reference: freeciv upkeep percentage effects
   */
  private applyGovernmentUpkeepModifiers(
    context: EffectContext,
    baseCosts: UnitUpkeep
  ): UnitUpkeep {
    const modifiedCosts = { ...baseCosts };

    // Apply shield upkeep percentage modifier
    const shieldUpkeepPct = this.effectsManager.calculateEffect(
      EffectType.UPKEEP_PCT,
      { ...context, outputType: OutputType.SHIELD }
    );
    if (shieldUpkeepPct.value !== 100) {
      modifiedCosts.shield = Math.floor((modifiedCosts.shield * shieldUpkeepPct.value) / 100);
    }

    // Apply food upkeep percentage modifier
    const foodUpkeepPct = this.effectsManager.calculateEffect(
      EffectType.UPKEEP_PCT,
      { ...context, outputType: OutputType.FOOD }
    );
    if (foodUpkeepPct.value !== 100) {
      modifiedCosts.food = Math.floor((modifiedCosts.food * foodUpkeepPct.value) / 100);
    }

    // Apply gold upkeep percentage modifier
    const goldUpkeepPct = this.effectsManager.calculateEffect(
      EffectType.UPKEEP_PCT,
      { ...context, outputType: OutputType.GOLD }
    );
    if (goldUpkeepPct.value !== 100) {
      modifiedCosts.gold = Math.floor((modifiedCosts.gold * goldUpkeepPct.value) / 100);
    }

    return modifiedCosts;
  }

  /**
   * Check if city should pay gold upkeep based on game settings
   * Reference: freeciv gold_upkeep_style logic
   */
  private shouldCityPayGoldUpkeep(): boolean {
    return this.goldUpkeepStyle === GoldUpkeepStyle.CITY ||
           this.goldUpkeepStyle === GoldUpkeepStyle.MIXED;
  }

  /**
   * Calculate national unit support costs
   * Used when goldUpkeepStyle is NATION or MIXED
   */
  public calculateNationalUnitSupport(
    playerId: string,
    currentGovernment: string,
    allPlayerUnits: UnitSupportData[]
  ): UnitUpkeep {
    const context: EffectContext = {
      playerId,
      government: currentGovernment
    };

    let nationalCosts: UnitUpkeep = { food: 0, shield: 0, gold: 0 };

    // Calculate gold costs if nation pays for units
    if (this.goldUpkeepStyle === GoldUpkeepStyle.NATION ||
        this.goldUpkeepStyle === GoldUpkeepStyle.MIXED) {
      
      for (const unit of allPlayerUnits) {
        nationalCosts.gold += unit.upkeep.gold;
      }

      // Apply national upkeep modifiers
      const goldUpkeepPct = this.effectsManager.calculateEffect(
        EffectType.UPKEEP_PCT,
        { ...context, outputType: OutputType.GOLD }
      );
      
      if (goldUpkeepPct.value !== 100) {
        nationalCosts.gold = Math.floor((nationalCosts.gold * goldUpkeepPct.value) / 100);
      }
    }

    return nationalCosts;
  }

  /**
   * Get unit support summary for a player
   * Useful for UI display and debugging
   */
  public getPlayerUnitSupportSummary(
    playerId: string,
    currentGovernment: string,
    citiesData: Array<{
      cityId: string;
      population: number;
      unitsSupported: UnitSupportData[];
    }>
  ): {
    totalUnitsSupported: number;
    totalCityUpkeepCosts: UnitUpkeep;
    totalNationalUpkeepCosts: UnitUpkeep;
    totalMilitaryUnhappiness: number;
  } {
    let totalUnits = 0;
    let totalCityUpkeep: UnitUpkeep = { food: 0, shield: 0, gold: 0 };
    let totalMilitaryUnhappiness = 0;
    let allPlayerUnits: UnitSupportData[] = [];

    // Calculate city-based support costs
    for (const cityData of citiesData) {
      const citySupport = this.calculateCityUnitSupport(
        cityData.cityId,
        playerId,
        currentGovernment,
        cityData.population,
        cityData.unitsSupported
      );

      totalUnits += citySupport.totalUnitsSupported;
      totalCityUpkeep.food += citySupport.upkeepCosts.food;
      totalCityUpkeep.shield += citySupport.upkeepCosts.shield;
      totalCityUpkeep.gold += citySupport.upkeepCosts.gold;
      totalMilitaryUnhappiness += citySupport.happinessEffect;
      
      allPlayerUnits.push(...cityData.unitsSupported);
    }

    // Calculate national support costs
    const nationalUpkeep = this.calculateNationalUnitSupport(
      playerId,
      currentGovernment,
      allPlayerUnits
    );

    return {
      totalUnitsSupported: totalUnits,
      totalCityUpkeepCosts: totalCityUpkeep,
      totalNationalUpkeepCosts: nationalUpkeep,
      totalMilitaryUnhappiness
    };
  }

  /**
   * Check if player can afford unit support costs
   */
  public canAffordUnitSupport(
    playerId: string,
    currentGovernment: string,
    availableResources: UnitUpkeep,
    citiesData: Array<{
      cityId: string;
      population: number;
      unitsSupported: UnitSupportData[];
    }>
  ): { canAfford: boolean; shortfall: UnitUpkeep } {
    const summary = this.getPlayerUnitSupportSummary(
      playerId,
      currentGovernment,
      citiesData
    );

    const totalRequired: UnitUpkeep = {
      food: summary.totalCityUpkeepCosts.food,
      shield: summary.totalCityUpkeepCosts.shield,
      gold: summary.totalCityUpkeepCosts.gold + summary.totalNationalUpkeepCosts.gold
    };

    const shortfall: UnitUpkeep = {
      food: Math.max(0, totalRequired.food - availableResources.food),
      shield: Math.max(0, totalRequired.shield - availableResources.shield),
      gold: Math.max(0, totalRequired.gold - availableResources.gold)
    };

    const canAfford = shortfall.food === 0 && shortfall.shield === 0 && shortfall.gold === 0;

    return { canAfford, shortfall };
  }
}

// Export types (already exported above)
// export {
//   UnitUpkeep,
//   UnitSupportResult,
//   UnitSupportData,
//   GoldUpkeepStyle
// };