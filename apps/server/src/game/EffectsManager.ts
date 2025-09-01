/**
 * Effects Manager - Centralized system for calculating game effects
 * Based on freeciv common/effects.c and effects.h
 * 
 * Handles government-specific effects including:
 * - Corruption/waste calculations
 * - Happiness and martial law
 * - Unit support costs
 * - Building requirements
 * - Civic policies (multipliers)
 * 
 * Reference: /reference/freeciv/common/effects.c
 */

import { rulesetLoader } from '../shared/data/rulesets/RulesetLoader';
import { logger } from '../utils/logger';
import type { Effect, Requirement } from '../shared/data/rulesets/schemas';

// Core effect types from freeciv - directly ported from effects_enums.def
export enum EffectType {
  // Government-specific corruption effects
  OUTPUT_WASTE = 'Output_Waste',
  OUTPUT_WASTE_BY_DISTANCE = 'Output_Waste_By_Distance',
  OUTPUT_WASTE_BY_REL_DISTANCE = 'Output_Waste_By_Rel_Distance',
  OUTPUT_WASTE_PCT = 'Output_Waste_Pct',
  
  // Government center effects (Palace, Courthouse)
  GOV_CENTER = 'Gov_Center',
  
  // Happiness and martial law effects
  MAKE_HAPPY = 'Make_Happy',
  MAKE_CONTENT = 'Make_Content',
  MAKE_CONTENT_MIL = 'Make_Content_Mil',
  MAKE_CONTENT_MIL_PER = 'Make_Content_Mil_Per',
  FORCE_CONTENT = 'Force_Content',
  NO_UNHAPPY = 'No_Unhappy',
  MARTIAL_LAW_BY_UNIT = 'Martial_Law_By_Unit',
  MARTIAL_LAW_MAX = 'Martial_Law_Max',
  CITY_UNHAPPY_SIZE = 'City_Unhappy_Size',
  REVOLUTION_UNHAPPINESS = 'Revolution_Unhappiness',
  
  // Unit support cost effects
  UPKEEP_FREE = 'Upkeep_Free',
  UNIT_UPKEEP_FREE_PER_CITY = 'Unit_Upkeep_Free_Per_City',
  UPKEEP_PCT = 'Upkeep_Pct',
  UNHAPPY_FACTOR = 'Unhappy_Factor',
  SHIELD2GOLD_PCT = 'Shield2Gold_Pct',
  
  // Building and specialist effects
  SPECIALIST_OUTPUT = 'Specialist_Output',
  OUTPUT_BONUS = 'Output_Bonus',
  OUTPUT_BONUS_2 = 'Output_Bonus_2',
  
  // General effects
  ANY_GOVERNMENT = 'Any_Government',
  NO_ANARCHY = 'No_Anarchy',
  HAS_SENATE = 'Has_Senate',
}

// Output types for effect calculations
export enum OutputType {
  FOOD = 'food',
  SHIELD = 'shield', 
  TRADE = 'trade',
  GOLD = 'gold',
  SCIENCE = 'science',
  LUXURY = 'luxury',
}

// Context for effect evaluation - matches freeciv req_context
export interface EffectContext {
  playerId?: string;
  cityId?: string;
  unitId?: string;
  tileX?: number;
  tileY?: number;
  buildingId?: string;
  government?: string;
  outputType?: OutputType;
  specialist?: string;
  unitType?: string;
}

// Requirement evaluation result
export interface RequirementResult {
  satisfied: boolean;
  reason?: string;
}

// Effect calculation result with breakdown
export interface EffectResult {
  value: number;
  effects: Array<{
    effectId: string;
    type: EffectType;
    value: number;
    source: string;
  }>;
}

/**
 * EffectsManager - Centralized effects calculation system
 * Direct port of freeciv effects system architecture
 */
export class EffectsManager {
  private effectsCache = new Map<string, Record<string, Effect>>();
  private rulesetName: string;

  constructor(rulesetName: string = 'classic') {
    this.rulesetName = rulesetName;
  }

  /**
   * Get all effects for current ruleset
   * Reference: freeciv effects_cache_init()
   */
  private getEffects(): Record<string, Effect> {
    if (!this.effectsCache.has(this.rulesetName)) {
      try {
        const effects = rulesetLoader.getEffects(this.rulesetName);
        this.effectsCache.set(this.rulesetName, effects);
        logger.info(`Loaded ${Object.keys(effects).length} effects from ruleset '${this.rulesetName}'`);
      } catch (error) {
        logger.error(`Failed to load effects for ruleset '${this.rulesetName}':`, error);
        this.effectsCache.set(this.rulesetName, {});
      }
    }
    return this.effectsCache.get(this.rulesetName)!;
  }

  /**
   * Calculate total effect value for given type and context
   * Reference: freeciv get_city_bonus(), get_player_bonus(), etc.
   */
  public calculateEffect(
    effectType: EffectType,
    context: EffectContext,
    multiplierValue?: number
  ): EffectResult {
    const effects = this.getEffects();
    const result: EffectResult = {
      value: 0,
      effects: []
    };

    // Find all effects matching the type
    for (const [effectId, effect] of Object.entries(effects)) {
      if (effect.type !== effectType) {
        continue;
      }

      // Check if requirements are satisfied
      const reqResult = this.evaluateRequirements(effect.reqs || [], context);
      if (!reqResult.satisfied) {
        continue;
      }

      // Apply multiplier if present (for civic policies)
      let effectValue = effect.value;
      if (multiplierValue !== undefined) {
        effectValue = this.applyMultiplier(effectValue, multiplierValue);
      }

      result.value += effectValue;
      result.effects.push({
        effectId,
        type: effectType,
        value: effectValue,
        source: this.getEffectSource(effect)
      });
    }

    return result;
  }

  /**
   * Get corruption/waste value for a city
   * Reference: freeciv city_waste() in common/city.c
   */
  public calculateWaste(
    cityContext: EffectContext,
    outputType: OutputType,
    totalOutput: number,
    distanceToGovCenter?: number
  ): number {
    const context = { ...cityContext, outputType };

    // Base waste percentage
    const baseWaste = this.calculateEffect(EffectType.OUTPUT_WASTE, context);
    let wasteLevel = (baseWaste.value * totalOutput) / 100;

    // Distance-based waste (if government center exists)
    if (distanceToGovCenter !== undefined && distanceToGovCenter > 0) {
      const distanceWaste = this.calculateEffect(EffectType.OUTPUT_WASTE_BY_DISTANCE, context);
      wasteLevel += (distanceWaste.value * distanceToGovCenter * totalOutput) / 10000;
      
      // Relative distance waste (scales with map size)
      const relDistanceWaste = this.calculateEffect(EffectType.OUTPUT_WASTE_BY_REL_DISTANCE, context);
      // TODO: Implement relative distance calculation when map size data available
    }

    // Apply waste reduction effects
    const wasteReduction = this.calculateEffect(EffectType.OUTPUT_WASTE_PCT, context);
    if (wasteReduction.value > 0) {
      wasteLevel = (wasteLevel * wasteReduction.value) / 100;
    }

    return Math.min(Math.max(Math.floor(wasteLevel), 0), totalOutput);
  }

  /**
   * Calculate martial law happiness bonus
   * Reference: freeciv get_city_bonus() for martial law effects
   */
  public calculateMartialLaw(
    cityContext: EffectContext,
    militaryUnitsInCity: number
  ): { happyBonus: number; maxUnits: number } {
    // Martial law effectiveness per unit
    const martialLawPerUnit = this.calculateEffect(EffectType.MARTIAL_LAW_BY_UNIT, cityContext);
    
    // Maximum units that can provide martial law
    const martialLawMax = this.calculateEffect(EffectType.MARTIAL_LAW_MAX, cityContext);
    
    const effectiveUnits = Math.min(militaryUnitsInCity, martialLawMax.value);
    const happyBonus = effectiveUnits * martialLawPerUnit.value;

    return {
      happyBonus,
      maxUnits: martialLawMax.value
    };
  }

  /**
   * Calculate unit support costs
   * Reference: freeciv city_support() calculations
   */
  public calculateUnitSupport(
    cityContext: EffectContext,
    outputType: OutputType,
    unitsSupported: number
  ): number {
    const context = { ...cityContext, outputType };

    // Free units per city based on government
    const freeUnits = this.calculateEffect(EffectType.UNIT_UPKEEP_FREE_PER_CITY, context);
    
    // Units requiring support
    const supportedUnits = Math.max(0, unitsSupported - freeUnits.value);
    
    // Base support cost (usually 1 per unit)
    let supportCost = supportedUnits;
    
    // Apply upkeep percentage modifier
    const upkeepPct = this.calculateEffect(EffectType.UPKEEP_PCT, context);
    if (upkeepPct.value !== 100) {
      supportCost = (supportCost * upkeepPct.value) / 100;
    }

    return Math.max(0, Math.floor(supportCost));
  }

  /**
   * Check if building can be built based on government requirements
   * Reference: freeciv can_player_build_improvement_direct()
   */
  public canBuildWithGovernment(
    buildingId: string,
    governmentId: string,
    context: EffectContext,
    playerTechs?: Set<string>
  ): RequirementResult {
    // Government-specific building requirements from freeciv
    const governmentBuildingReqs: Record<string, Requirement[]> = {
      'police_station': [
        {
          type: 'Gov',
          name: 'communism',
          range: 'Player',
          present: false // Cannot build under communism
        }
      ],
      'courthouse': [
        {
          type: 'Tech',
          name: 'Code of Laws',
          range: 'Player'
        }
      ],
      'palace': [
        {
          type: 'Gov',
          name: 'anarchy',
          range: 'Player',
          present: false // Cannot build during anarchy
        }
      ]
    };

    const requirements = governmentBuildingReqs[buildingId];
    if (!requirements) {
      return { satisfied: true }; // No special requirements
    }

    // Evaluate each requirement
    for (const req of requirements) {
      const result = this.evaluateSingleRequirement(req, {
        ...context,
        government: governmentId
      });
      if (!result.satisfied) {
        return result;
      }
    }

    return { satisfied: true };
  }

  /**
   * Get building effects based on current government
   * Some buildings have different effects under different governments
   * Reference: freeciv building effects with government requirements
   */
  public getBuildingGovernmentEffects(
    buildingId: string,
    governmentId: string,
    context: EffectContext
  ): Record<string, number> {
    const effects: Record<string, number> = {};

    // Government-specific building effects from freeciv
    switch (buildingId) {
      case 'police_station':
        if (governmentId === 'democracy') {
          effects.happiness = 2; // Extra happiness under democracy
        } else if (governmentId === 'republic') {
          effects.happiness = 1; // Standard happiness under republic
        }
        break;

      case 'courthouse':
        // Courthouse reduces corruption (acts as secondary government center)
        if (governmentId !== 'democracy') {
          effects.corruptionReduction = 50; // 50% corruption reduction
        }
        break;

      case 'palace':
        // Palace is always the primary government center
        effects.governmentCenter = 1;
        effects.corruptionReduction = 100; // Complete corruption immunity
        break;

      case 'temple':
        if (governmentId === 'monarchy' || governmentId === 'despotism') {
          effects.happiness = 1; // Base temple happiness
        }
        break;
    }

    return effects;
  }

  /**
   * Evaluate requirements for an effect
   * Reference: freeciv are_reqs_active() in common/requirements.c
   */
  private evaluateRequirements(
    requirements: Requirement[],
    context: EffectContext
  ): RequirementResult {
    for (const req of requirements) {
      const result = this.evaluateSingleRequirement(req, context);
      if (!result.satisfied) {
        return result;
      }
    }
    return { satisfied: true };
  }

  /**
   * Evaluate single requirement
   * Reference: freeciv is_req_active() in common/requirements.c
   */
  private evaluateSingleRequirement(
    requirement: Requirement,
    context: EffectContext
  ): RequirementResult {
    const isPresent = requirement.present !== false; // Default to true if not specified

    switch (requirement.type) {
      case 'Gov':
      case 'Government':
        const hasGovernment = context.government === requirement.name;
        if (hasGovernment !== isPresent) {
          return { 
            satisfied: false, 
            reason: `Government requirement not met: ${requirement.name}` 
          };
        }
        break;

      case 'OutputType':
        const hasOutputType = context.outputType === requirement.name;
        if (hasOutputType !== isPresent) {
          return { 
            satisfied: false, 
            reason: `OutputType requirement not met: ${requirement.name}` 
          };
        }
        break;

      case 'UnitType':
        const hasUnitType = context.unitType === requirement.name;
        if (hasUnitType !== isPresent) {
          return { 
            satisfied: false, 
            reason: `UnitType requirement not met: ${requirement.name}` 
          };
        }
        break;

      case 'Building':
        // TODO: Check if city has building when building system is integrated
        break;

      case 'Tech':
        // TODO: Check if player has technology when integrated with research system
        break;

      case 'Player':
        const hasPlayer = context.playerId === requirement.name;
        if (hasPlayer !== isPresent) {
          return { 
            satisfied: false, 
            reason: `Player requirement not met: ${requirement.name}` 
          };
        }
        break;

      // Add more requirement types as needed
      default:
        logger.warn(`Unknown requirement type: ${requirement.type}`);
        break;
    }

    return { satisfied: true };
  }

  /**
   * Apply multiplier to effect value (for civic policies)
   * Reference: freeciv player_multiplier_effect_value() in common/multipliers.c
   */
  private applyMultiplier(effectValue: number, multiplierValue: number): number {
    // Multiplier formula from freeciv: (value + offset) * (factor / 100)
    // For now, simple multiplication - will enhance when PolicyManager is implemented
    return Math.floor(effectValue * (multiplierValue / 100));
  }

  /**
   * Get source description for an effect (for debugging)
   */
  private getEffectSource(effect: Effect): string {
    // Extract source from requirements or use effect ID
    const govReq = effect.reqs?.find(req => req.type === 'Gov' || req.type === 'Government');
    if (govReq) {
      return `Government: ${govReq.name}`;
    }
    
    const buildingReq = effect.reqs?.find(req => req.type === 'Building');
    if (buildingReq) {
      return `Building: ${buildingReq.name}`;
    }

    return effect.comment || 'Unknown';
  }

  /**
   * Clear effects cache (for testing or ruleset changes)
   */
  public clearCache(): void {
    this.effectsCache.clear();
  }

  /**
   * Get all government centers (Palace, Courthouse) for corruption calculations
   * Reference: freeciv nearest_gov_center() in common/city.c
   */
  public getGovernmentCenters(playerContext: EffectContext): string[] {
    // TODO: This will be implemented when integrated with CityManager
    // Should return list of cities with Gov_Center effect
    return [];
  }
}

// Export singleton instance
export const effectsManager = new EffectsManager();