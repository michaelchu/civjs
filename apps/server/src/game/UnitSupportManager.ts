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
  public calculateCityUnitSupport(\n    cityId: string,\n    playerId: string,\n    currentGovernment: string,\n    cityPopulation: number,\n    unitsSupported: UnitSupportData[]\n  ): UnitSupportResult {\n    const context: EffectContext = {\n      playerId,\n      cityId,\n      government: currentGovernment\n    };\n\n    // Initialize result\n    const result: UnitSupportResult = {\n      totalUnitsSupported: unitsSupported.length,\n      freeUnitsSupported: 0,\n      unitsRequiringUpkeep: 0,\n      upkeepCosts: { food: 0, shield: 0, gold: 0 },\n      happinessEffect: 0\n    };\n\n    // Calculate free unit support per city by government\n    const freeShieldUnits = this.effectsManager.calculateUnitSupport(\n      { ...context, outputType: OutputType.SHIELD },\n      OutputType.SHIELD,\n      unitsSupported.length\n    );\n\n    const freeFoodUnits = this.effectsManager.calculateUnitSupport(\n      { ...context, outputType: OutputType.FOOD },\n      OutputType.FOOD,\n      unitsSupported.length\n    );\n\n    const freeGoldUnits = this.effectsManager.calculateUnitSupport(\n      { ...context, outputType: OutputType.GOLD },\n      OutputType.GOLD,\n      unitsSupported.length\n    );\n\n    // Calculate upkeep costs for each unit\n    let shieldUnitsRequiringSupport = 0;\n    let foodUnitsRequiringSupport = 0;\n    let goldUnitsRequiringSupport = 0;\n    let militaryUnhappiness = 0;\n\n    for (const unit of unitsSupported) {\n      // Count units requiring shield support\n      if (unit.upkeep.shield > 0) {\n        shieldUnitsRequiringSupport++;\n      }\n\n      // Count units requiring food support\n      if (unit.upkeep.food > 0) {\n        foodUnitsRequiringSupport++;\n      }\n\n      // Count units requiring gold support (depends on upkeep style)\n      if (unit.upkeep.gold > 0 && this.shouldCityPayGoldUpkeep()) {\n        goldUnitsRequiringSupport++;\n      }\n\n      // Calculate military unhappiness from units away from home\n      if (unit.isMilitaryUnit && unit.isAwayFromHome) {\n        militaryUnhappiness += this.calculateMilitaryUnhappiness(\n          context,\n          unit.unitType\n        );\n      }\n    }\n\n    // Apply free unit support\n    const shieldUnitsNeedingSupport = Math.max(0, shieldUnitsRequiringSupport - freeShieldUnits);\n    const foodUnitsNeedingSupport = Math.max(0, foodUnitsRequiringSupport - freeFoodUnits);\n    const goldUnitsNeedingSupport = Math.max(0, goldUnitsRequiringSupport - freeGoldUnits);\n\n    // Calculate total upkeep costs\n    result.upkeepCosts.shield = shieldUnitsNeedingSupport;\n    result.upkeepCosts.food = foodUnitsNeedingSupport;\n    result.upkeepCosts.gold = goldUnitsNeedingSupport;\n\n    // Add citizen food consumption\n    result.upkeepCosts.food += cityPopulation * this.foodCostPerCitizen;\n\n    // Apply government upkeep modifiers\n    result.upkeepCosts = this.applyGovernmentUpkeepModifiers(\n      context,\n      result.upkeepCosts\n    );\n\n    // Calculate free units supported\n    result.freeUnitsSupported = Math.min(\n      unitsSupported.length,\n      Math.min(freeShieldUnits, Math.min(freeFoodUnits, freeGoldUnits))\n    );\n    result.unitsRequiringUpkeep = unitsSupported.length - result.freeUnitsSupported;\n    result.happinessEffect = militaryUnhappiness;\n\n    return result;\n  }\n\n  /**\n   * Calculate military unhappiness from units away from home\n   * Reference: freeciv city_unit_unhappiness()\n   */\n  private calculateMilitaryUnhappiness(\n    context: EffectContext,\n    unitType: string\n  ): number {\n    // Republic: 1 unhappy per military unit away from home\n    // Democracy: 2 unhappy per military unit away from home\n    // Other governments: 0 unhappy\n\n    if (context.government === 'republic') {\n      return 1;\n    } else if (context.government === 'democracy') {\n      return 2;\n    }\n    return 0;\n  }\n\n  /**\n   * Apply government-specific upkeep modifiers\n   * Reference: freeciv upkeep percentage effects\n   */\n  private applyGovernmentUpkeepModifiers(\n    context: EffectContext,\n    baseCosts: UnitUpkeep\n  ): UnitUpkeep {\n    const modifiedCosts = { ...baseCosts };\n\n    // Apply shield upkeep percentage modifier\n    const shieldUpkeepPct = this.effectsManager.calculateEffect(\n      EffectType.UPKEEP_PCT,\n      { ...context, outputType: OutputType.SHIELD }\n    );\n    if (shieldUpkeepPct.value !== 100) {\n      modifiedCosts.shield = Math.floor((modifiedCosts.shield * shieldUpkeepPct.value) / 100);\n    }\n\n    // Apply food upkeep percentage modifier\n    const foodUpkeepPct = this.effectsManager.calculateEffect(\n      EffectType.UPKEEP_PCT,\n      { ...context, outputType: OutputType.FOOD }\n    );\n    if (foodUpkeepPct.value !== 100) {\n      modifiedCosts.food = Math.floor((modifiedCosts.food * foodUpkeepPct.value) / 100);\n    }\n\n    // Apply gold upkeep percentage modifier\n    const goldUpkeepPct = this.effectsManager.calculateEffect(\n      EffectType.UPKEEP_PCT,\n      { ...context, outputType: OutputType.GOLD }\n    );\n    if (goldUpkeepPct.value !== 100) {\n      modifiedCosts.gold = Math.floor((modifiedCosts.gold * goldUpkeepPct.value) / 100);\n    }\n\n    return modifiedCosts;\n  }\n\n  /**\n   * Check if city should pay gold upkeep based on game settings\n   * Reference: freeciv gold_upkeep_style logic\n   */\n  private shouldCityPayGoldUpkeep(): boolean {\n    return this.goldUpkeepStyle === GoldUpkeepStyle.CITY ||\n           this.goldUpkeepStyle === GoldUpkeepStyle.MIXED;\n  }\n\n  /**\n   * Calculate national unit support costs\n   * Used when goldUpkeepStyle is NATION or MIXED\n   */\n  public calculateNationalUnitSupport(\n    playerId: string,\n    currentGovernment: string,\n    allPlayerUnits: UnitSupportData[]\n  ): UnitUpkeep {\n    const context: EffectContext = {\n      playerId,\n      government: currentGovernment\n    };\n\n    let nationalCosts: UnitUpkeep = { food: 0, shield: 0, gold: 0 };\n\n    // Calculate gold costs if nation pays for units\n    if (this.goldUpkeepStyle === GoldUpkeepStyle.NATION ||\n        this.goldUpkeepStyle === GoldUpkeepStyle.MIXED) {\n      \n      for (const unit of allPlayerUnits) {\n        nationalCosts.gold += unit.upkeep.gold;\n      }\n\n      // Apply national upkeep modifiers\n      const goldUpkeepPct = this.effectsManager.calculateEffect(\n        EffectType.UPKEEP_PCT,\n        { ...context, outputType: OutputType.GOLD }\n      );\n      \n      if (goldUpkeepPct.value !== 100) {\n        nationalCosts.gold = Math.floor((nationalCosts.gold * goldUpkeepPct.value) / 100);\n      }\n    }\n\n    return nationalCosts;\n  }\n\n  /**\n   * Get unit support summary for a player\n   * Useful for UI display and debugging\n   */\n  public getPlayerUnitSupportSummary(\n    playerId: string,\n    currentGovernment: string,\n    citiesData: Array<{\n      cityId: string;\n      population: number;\n      unitsSupported: UnitSupportData[];\n    }>\n  ): {\n    totalUnitsSupported: number;\n    totalCityUpkeepCosts: UnitUpkeep;\n    totalNationalUpkeepCosts: UnitUpkeep;\n    totalMilitaryUnhappiness: number;\n  } {\n    let totalUnits = 0;\n    let totalCityUpkeep: UnitUpkeep = { food: 0, shield: 0, gold: 0 };\n    let totalMilitaryUnhappiness = 0;\n    let allPlayerUnits: UnitSupportData[] = [];\n\n    // Calculate city-based support costs\n    for (const cityData of citiesData) {\n      const citySupport = this.calculateCityUnitSupport(\n        cityData.cityId,\n        playerId,\n        currentGovernment,\n        cityData.population,\n        cityData.unitsSupported\n      );\n\n      totalUnits += citySupport.totalUnitsSupported;\n      totalCityUpkeep.food += citySupport.upkeepCosts.food;\n      totalCityUpkeep.shield += citySupport.upkeepCosts.shield;\n      totalCityUpkeep.gold += citySupport.upkeepCosts.gold;\n      totalMilitaryUnhappiness += citySupport.happinessEffect;\n      \n      allPlayerUnits.push(...cityData.unitsSupported);\n    }\n\n    // Calculate national support costs\n    const nationalUpkeep = this.calculateNationalUnitSupport(\n      playerId,\n      currentGovernment,\n      allPlayerUnits\n    );\n\n    return {\n      totalUnitsSupported: totalUnits,\n      totalCityUpkeepCosts: totalCityUpkeep,\n      totalNationalUpkeepCosts: nationalUpkeep,\n      totalMilitaryUnhappiness\n    };\n  }\n\n  /**\n   * Check if player can afford unit support costs\n   */\n  public canAffordUnitSupport(\n    playerId: string,\n    currentGovernment: string,\n    availableResources: UnitUpkeep,\n    citiesData: Array<{\n      cityId: string;\n      population: number;\n      unitsSupported: UnitSupportData[];\n    }>\n  ): { canAfford: boolean; shortfall: UnitUpkeep } {\n    const summary = this.getPlayerUnitSupportSummary(\n      playerId,\n      currentGovernment,\n      citiesData\n    );\n\n    const totalRequired: UnitUpkeep = {\n      food: summary.totalCityUpkeepCosts.food,\n      shield: summary.totalCityUpkeepCosts.shield,\n      gold: summary.totalCityUpkeepCosts.gold + summary.totalNationalUpkeepCosts.gold\n    };\n\n    const shortfall: UnitUpkeep = {\n      food: Math.max(0, totalRequired.food - availableResources.food),\n      shield: Math.max(0, totalRequired.shield - availableResources.shield),\n      gold: Math.max(0, totalRequired.gold - availableResources.gold)\n    };\n\n    const canAfford = shortfall.food === 0 && shortfall.shield === 0 && shortfall.gold === 0;\n\n    return { canAfford, shortfall };\n  }\n}\n\nexport {\n  UnitUpkeep,\n  UnitSupportResult,\n  UnitSupportData,\n  GoldUpkeepStyle\n};