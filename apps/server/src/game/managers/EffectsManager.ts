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

import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { logger } from '@utils/logger';
import type { Effect, Requirement } from '@shared/data/rulesets/schemas';

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
  playerTechs?: Set<string>; // Player's researched technologies
  cityBuildings?: Set<string>; // Buildings in the city
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
  private requirementHandlers: Record<
    string,
    (req: Requirement, context: EffectContext) => RequirementResult
  > = {};

  constructor(rulesetName: string = 'classic') {
    this.rulesetName = rulesetName;
    this.initRequirementHandlers();
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
        logger.info(
          `Loaded ${Object.keys(effects).length} effects from ruleset '${this.rulesetName}'`
        );
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
      effects: [],
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
        source: this.getEffectSource(effect),
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
      // const relDistanceWaste = this.calculateEffect(EffectType.OUTPUT_WASTE_BY_REL_DISTANCE, context);
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
      maxUnits: martialLawMax.value,
    };
  }

  /**
   * Calculate comprehensive city happiness effects from government
   * Reference: freeciv city_happiness() in common/city.c
   */
  public calculateGovernmentHappiness(
    cityContext: EffectContext,
    cityPopulation: number,
    militaryUnitsInCity: number = 0,
    militaryUnitsAwayFromHome: number = 0
  ): {
    happyEffect: number;
    unhappyEffect: number;
    martialLawBonus: number;
    revolutionPenalty: number;
    sizeUnhappiness: number;
  } {
    // Base happiness effects from government
    const makeHappy = this.calculateEffect(EffectType.MAKE_HAPPY, cityContext);
    const makeContent = this.calculateEffect(EffectType.MAKE_CONTENT, cityContext);
    const forceContent = this.calculateEffect(EffectType.FORCE_CONTENT, cityContext);
    const noUnhappy = this.calculateEffect(EffectType.NO_UNHAPPY, cityContext);

    // Revolution unhappiness during anarchy
    const revolutionUnhappy = this.calculateEffect(EffectType.REVOLUTION_UNHAPPINESS, cityContext);

    // City size unhappiness (affects larger cities under certain governments)
    const cityUnhappySize = this.calculateEffect(EffectType.CITY_UNHAPPY_SIZE, cityContext);
    const sizeUnhappiness =
      cityPopulation > cityUnhappySize.value ? cityPopulation - cityUnhappySize.value : 0;

    // Military units unhappiness (Republic/Democracy)
    const unhappyFactor = this.calculateEffect(EffectType.UNHAPPY_FACTOR, cityContext);
    const militaryUnhappiness = militaryUnitsAwayFromHome * unhappyFactor.value;

    // Martial law happiness bonus
    const martialLaw = this.calculateMartialLaw(cityContext, militaryUnitsInCity);

    // Calculate total effects
    const happyEffect = makeHappy.value + makeContent.value;
    let unhappyEffect = sizeUnhappiness + militaryUnhappiness + revolutionUnhappy.value;

    // Apply force content (prevents unhappiness)
    if (forceContent.value > 0) {
      unhappyEffect = Math.max(0, unhappyEffect - forceContent.value);
    }

    // Apply no unhappy (eliminates all unhappiness)
    if (noUnhappy.value > 0) {
      unhappyEffect = 0;
    }

    return {
      happyEffect,
      unhappyEffect,
      martialLawBonus: martialLaw.happyBonus,
      revolutionPenalty: revolutionUnhappy.value,
      sizeUnhappiness,
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
    _playerTechs?: Set<string>
  ): RequirementResult {
    // Government-specific building requirements from freeciv
    const governmentBuildingReqs: Record<string, Requirement[]> = {
      police_station: [
        {
          type: 'Gov',
          name: 'communism',
          range: 'Player',
          present: false, // Cannot build under communism
        },
      ],
      courthouse: [
        {
          type: 'Tech',
          name: 'Code of Laws',
          range: 'Player',
        },
      ],
      palace: [
        {
          type: 'Gov',
          name: 'anarchy',
          range: 'Player',
          present: false, // Cannot build during anarchy
        },
      ],
    };

    const requirements = governmentBuildingReqs[buildingId];
    if (!requirements) {
      return { satisfied: true }; // No special requirements
    }

    // Evaluate each requirement
    for (const req of requirements) {
      const result = this.evaluateSingleRequirement(req, {
        ...context,
        government: governmentId,
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
    _context: EffectContext
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
  public evaluateRequirements(
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
   * Evaluate single requirement via handler map (reduces cyclomatic complexity)
   * Reference: freeciv is_req_active() in common/requirements.c
   */
  private evaluateSingleRequirement(
    requirement: Requirement,
    context: EffectContext
  ): RequirementResult {
    const handler = this.requirementHandlers[requirement.type] || this.handleUnknownRequirement;
    return handler(requirement, context);
  }

  private initRequirementHandlers(): void {
    const presentCheck = (actual: boolean, expectedPresent: boolean | undefined) =>
      actual === (expectedPresent !== false);

    this.requirementHandlers['Gov'] = (req, context) =>
      presentCheck(context.government === req.name, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `Government requirement not met: ${req.name}` };

    this.requirementHandlers['Government'] = this.requirementHandlers['Gov'];

    this.requirementHandlers['OutputType'] = (req, context) =>
      presentCheck(context.outputType === req.name, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `OutputType requirement not met: ${req.name}` };

    this.requirementHandlers['UnitType'] = (req, context) =>
      presentCheck(context.unitType === req.name, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `UnitType requirement not met: ${req.name}` };

    // Building requirement handler
    this.requirementHandlers['Building'] = (req, context) => {
      if (!context.cityBuildings) {
        // If no building context provided, assume requirement is not met
        return {
          satisfied: req.present === false, // Only satisfied if requirement is "NOT present"
          reason:
            req.present !== false
              ? `Building requirement cannot be evaluated: ${req.name}`
              : undefined,
        };
      }

      const hasBuilding = context.cityBuildings.has(req.name);
      return presentCheck(hasBuilding, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `Building requirement not met: ${req.name}` };
    };

    // Technology requirement handler
    this.requirementHandlers['Tech'] = (req, context) => {
      if (!context.playerTechs) {
        // If no tech context provided, assume requirement is not met
        return {
          satisfied: req.present === false, // Only satisfied if requirement is "NOT present"
          reason:
            req.present !== false ? `Tech requirement cannot be evaluated: ${req.name}` : undefined,
        };
      }

      // Map requirement names to our tech IDs (like in GovernmentManager)
      const techNameMap: Record<string, string> = {
        Monarchy: 'monarchy',
        'The Republic': 'the_republic',
        Communism: 'communism',
        Democracy: 'democracy',
        'Code of Laws': 'code_of_laws',
        'Ceremonial Burial': 'ceremonial_burial',
        Mysticism: 'mysticism',
      };

      const techId = techNameMap[req.name] || req.name.toLowerCase().replace(/\s+/g, '_');
      const hasTech = context.playerTechs.has(techId);

      return presentCheck(hasTech, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `Tech requirement not met: ${req.name}` };
    };

    this.requirementHandlers['Player'] = (req, context) =>
      presentCheck(context.playerId === req.name, req.present)
        ? { satisfied: true }
        : { satisfied: false, reason: `Player requirement not met: ${req.name}` };
  }

  private handleUnknownRequirement = (
    req: Requirement,
    _context: EffectContext
  ): RequirementResult => {
    logger.warn(`Unknown requirement type: ${req.type}`);
    return { satisfied: true };
  };

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
   * Check if a city is a government center (has Palace, Courthouse, etc.)
   * Reference: freeciv is_gov_center() in common/city.c
   */
  public isGovernmentCenter(cityContext: EffectContext): boolean {
    const govCenterEffect = this.calculateEffect(EffectType.GOV_CENTER, cityContext);
    return govCenterEffect.value > 0;
  }

  /**
   * Calculate distance to nearest government center for corruption calculation
   * Reference: freeciv nearest_gov_center() in common/city.c
   */
  public calculateDistanceToGovCenter(
    cityContext: EffectContext,
    playerCities?: Array<{ id: string; x: number; y: number; buildings?: Set<string> }>
  ): number {
    // If the city itself is a government center, distance is 0
    if (this.isGovernmentCenter(cityContext)) {
      return 0;
    }

    if (!playerCities || !cityContext.tileX || !cityContext.tileY) {
      return 10; // Default high distance if no city data available
    }

    let nearestDistance = Number.MAX_SAFE_INTEGER;

    for (const city of playerCities) {
      // Check if this city is a government center
      const otherCityContext: EffectContext = {
        ...cityContext,
        cityId: city.id,
        tileX: city.x,
        tileY: city.y,
        cityBuildings: city.buildings,
      };

      if (this.isGovernmentCenter(otherCityContext)) {
        // Calculate Manhattan distance (freeciv uses this for corruption)
        const distance =
          Math.abs(cityContext.tileX - city.x) + Math.abs(cityContext.tileY - city.y);
        nearestDistance = Math.min(nearestDistance, distance);
      }
    }

    return nearestDistance === Number.MAX_SAFE_INTEGER ? 10 : nearestDistance;
  }

  /**
   * Calculate corruption for a city based on government and distance
   * Reference: freeciv city_corruption() in common/city.c
   */
  public calculateCityCorruption(
    cityContext: EffectContext,
    tradeOutput: number,
    playerCities?: Array<{ id: string; x: number; y: number; buildings?: Set<string> }>
  ): { corruption: number; distanceToGovCenter: number } {
    const distanceToGovCenter = this.calculateDistanceToGovCenter(cityContext, playerCities);
    const corruption = this.calculateWaste(
      cityContext,
      OutputType.TRADE,
      tradeOutput,
      distanceToGovCenter
    );

    return {
      corruption,
      distanceToGovCenter,
    };
  }
}

// Export singleton instance
export const effectsManager = new EffectsManager();
