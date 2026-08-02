/**
 * @module server/game/managers/EffectsManager
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

import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
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
  OUTPUT_ADD_TILE = 'Output_Add_Tile',
  OUTPUT_INC_TILE = 'Output_Inc_Tile',
  OUTPUT_INC_TILE_CELEBRATE = 'Output_Inc_Tile_Celebrate',
  OUTPUT_PENALTY_TILE = 'Output_Penalty_Tile',
  SIZE_ADJ = 'Size_Adj',
  SIZE_UNLIMIT = 'Size_Unlimit',
  RAPTURE_GROW = 'Rapture_Grow',
  MAX_RATES = 'Max_Rates',
  MAX_TRADE_ROUTES = 'Max_Trade_Routes',
  POLLU_POP_PCT = 'Pollu_Pop_Pct',
  POLLU_POP_PCT_2 = 'Pollu_Pop_Pct_2',
  POLLU_PROD_PCT = 'Pollu_Prod_Pct',
  GIVE_IMMEDIATE_TECH = 'Give_Imm_Tech',
  TECH_PARASITE = 'Tech_Parasite',
  UNIT_VISION_RADIUS_SQ = 'Unit_Vision_Radius_Sq',
  UNIT_NO_LOSE_POP = 'Unit_No_Lose_Pop',
  FORTIFY_DEFENSE_BONUS = 'Fortify_Defense_Bonus',
  DEFEND_BONUS = 'Defend_Bonus',
  GROWTH_FOOD = 'Growth_Food',
  SHRINK_FOOD = 'Shrink_Food',
  VETERAN_BUILD = 'Veteran_Build',
  HP_REGEN = 'HP_Regen',
  MIN_HP_PCT = 'Min_HP_Pct',
  HP_REGEN_2 = 'HP_Regen_2',
  RETIRE_PCT = 'Retire_Pct',
  TECH_UPKEEP_FREE = 'Tech_Upkeep_Free',
  TECH_COST_FACTOR = 'Tech_Cost_Factor',
  TECH_LEAKAGE = 'Tech_Leakage',
  HAVE_EMBASSIES = 'Have_Embassies',
  BUILDING_BUY_COST_PCT = 'Building_Buy_Cost_Pct',
  AIRLIFT = 'Airlift',
  MOVE_BONUS = 'Move_Bonus',
  UNIT_SHIELD_VALUE_PCT = 'Unit_Shield_Value_Pct',
  ACTION_SUCCESS_ACTOR_MOVE_COST = 'Action_Success_Actor_Move_Cost',
  UNIT_BRIBE_COST_PCT = 'Unit_Bribe_Cost_Pct',
  INCITE_COST_PCT = 'Incite_Cost_Pct',
  INSPIRE_PARTISANS = 'Inspire_Partisans',
  ENABLE_NUKE = 'Enable_Nuke',

  // Culture system effects (freeciv culture.c and effects_enums.def)
  PERFORMANCE = 'Performance', // EFT_PERFORMANCE (123) - Immediate culture boost
  HISTORY = 'History', // EFT_HISTORY (124) - Culture generation per turn
  NATION_PERFORMANCE = 'National_Performance', // EFT_NATION_PERFORMANCE (125) - National culture boost
  NATION_HISTORY = 'National_History', // EFT_NATION_HISTORY (126) - National culture generation
  CULTURE_PCT = 'Culture_Pct', // EFT_CULTURE_PCT (167) - Percentage modifier for culture

  // Border and vision effects related to culture
  BORDER_VISION = 'Border_Vision', // EFT_BORDER_VISION (136)
  BORDER_STRENGTH_PCT = 'Border_Strength_Pct', // EFT_BORDER_STRENGTH_PCT (154)

  // General effects
  ANY_GOVERNMENT = 'Any_Government',
  NO_ANARCHY = 'No_Anarchy',
  HAS_SENATE = 'Has_Senate',
  NO_DIPLOMACY = 'No_Diplomacy',
  TURN_YEARS = 'Turn_Years',
  TURN_FRAGMENTS = 'Turn_Fragments',
  SLOW_DOWN_TIMELINE = 'Slow_Down_Timeline',
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
  playerIsAI?: boolean;
  aiLevel?: string;
  cityId?: string;
  unitId?: string;
  tileX?: number;
  tileY?: number;
  mapWidth?: number;
  mapHeight?: number;
  buildingId?: string;
  action?: string;
  buildingGenus?: string;
  government?: string;
  outputType?: OutputType;
  specialist?: string;
  unitType?: string;
  unitClass?: string;
  unitClassFlags?: Set<string>;
  unitTypeFlags?: Set<string>;
  unitActivity?: string;
  unitHasHomeCity?: boolean;
  tileTerrain?: string;
  tileTerrainClass?: string;
  tileTerrainFlags?: Set<string>;
  adjacentTerrainClasses?: Set<string>;
  adjacentTerrainFlags?: Set<string>;
  tileExtras?: Set<string>;
  tileIsCityCenter?: boolean;
  maxUnitsOnTile?: number;
  playerNationGroups?: Set<string>;
  age?: number;
  cityCelebrating?: boolean;
  currentYear?: number;
  playerTechs?: Set<string>; // Player's researched technologies
  worldTechs?: Set<string>; // Technologies known by at least one player
  playerBuildings?: Set<string>; // Buildings owned anywhere by the player
  worldBuildings?: Set<string>; // Buildings owned anywhere in the world
  cityBuildings?: Set<string>; // Buildings in the city
  cityPopulation?: number;
  /** Current culture values supplied by the owning runtime context. */
  cityCulture?: number;
  playerCulture?: number;
  playerCulturesInRange?: number[];
  tradeRouteCulture?: number;
  tradeRouteCultures?: number[];
}

function singleCultureValue(value: number | undefined): number[] | undefined {
  return value === undefined ? undefined : [value];
}

function tradeRouteCultureValues(context: EffectContext): number[] | undefined {
  const cultures = [
    ...(context.cityCulture === undefined ? [] : [context.cityCulture]),
    ...(context.tradeRouteCultures ?? []),
  ];
  return cultures.length > 0 ? cultures : singleCultureValue(context.tradeRouteCulture);
}

function playerCultureValues(context: EffectContext): number[] | undefined {
  return context.playerCulture === undefined
    ? context.playerCulturesInRange
    : [context.playerCulture];
}

const cultureRangeResolvers: Record<string, (context: EffectContext) => number[] | undefined> = {
  city: context => singleCultureValue(context.cityCulture),
  traderoute: tradeRouteCultureValues,
  player: playerCultureValues,
  team: context => context.playerCulturesInRange,
  alliance: context => context.playerCulturesInRange,
  world: context => context.playerCulturesInRange,
};

function cultureValuesForRange(range: string, context: EffectContext): number[] | undefined {
  return cultureRangeResolvers[range]?.(context);
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

export interface EffectCoverage {
  total: number;
  runtimeSupported: number;
  retainedForFutureRuntimeSupport: number;
  unsupportedTypes: string[];
}

/**
 * EffectsManager - Centralized effects calculation system
 * Direct port of freeciv effects system architecture
 */
export class EffectsManager {
  private effectsCache = new Map<string, Record<string, Effect>>();
  private rulesetName: string;
  private rulesetLoader: Pick<RulesetLoader, 'getEffects'>;
  private realDistanceProvider?: (x1: number, y1: number, x2: number, y2: number) => number;
  private requirementHandlers: Record<
    string,
    (req: Requirement, context: EffectContext) => RequirementResult
  > = {};

  constructor(
    rulesetName: string = 'classic',
    ruleset: Pick<RulesetLoader, 'getEffects'> = rulesetLoader
  ) {
    this.rulesetName = rulesetName;
    this.rulesetLoader = ruleset;
    this.initRequirementHandlers();
  }

  public setRealDistanceProvider(
    provider: (x1: number, y1: number, x2: number, y2: number) => number
  ): void {
    this.realDistanceProvider = provider;
  }

  public getRulesetName(): string {
    return this.rulesetName;
  }

  /**
   * Report which retained ruleset effects have executable CivJS effect
   * handlers. This keeps unimplemented Freeciv effects visible to tests and
   * tooling instead of silently dropping them during conversion.
   */
  public getEffectCoverage(): EffectCoverage {
    const executableTypes = new Set<string>(Object.values(EffectType));
    const effects = Object.values(this.getEffects());
    const unsupportedTypes = [
      ...new Set(
        effects.filter(effect => !executableTypes.has(effect.type)).map(effect => effect.type)
      ),
    ].sort();
    const runtimeSupported = effects.filter(effect => executableTypes.has(effect.type)).length;
    return {
      total: effects.length,
      runtimeSupported,
      retainedForFutureRuntimeSupport: effects.length - runtimeSupported,
      unsupportedTypes,
    };
  }

  /**
   * Get all effects for current ruleset
   * Reference: freeciv effects_cache_init()
   */
  private getEffects(): Record<string, Effect> {
    if (!this.effectsCache.has(this.rulesetName)) {
      try {
        const effects = this.rulesetLoader.getEffects(this.rulesetName);
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
    let wasteLevel = baseWaste.value;

    // Distance-based waste (if government center exists)
    if (distanceToGovCenter !== undefined && distanceToGovCenter > 0) {
      const distanceWaste = this.calculateEffect(EffectType.OUTPUT_WASTE_BY_DISTANCE, context);
      wasteLevel += Math.floor((distanceWaste.value * distanceToGovCenter) / 100);

      const relativeDistanceWaste = this.calculateEffect(
        EffectType.OUTPUT_WASTE_BY_REL_DISTANCE,
        context
      );
      if (relativeDistanceWaste.value > 0 && context.mapWidth && context.mapHeight) {
        // Freeciv normalizes relative corruption to a standard 50-tile map.
        // @reference reference/freeciv/common/city.c:3291-3309
        wasteLevel += Math.floor(
          (relativeDistanceWaste.value * 50 * distanceToGovCenter) /
            100 /
            Math.max(context.mapWidth, context.mapHeight)
        );
      }
    }

    // Convert the percentage to an integer penalty before applying reductions.
    // Freeciv performs integer division at both stages.
    // @reference reference/freeciv/common/city.c:3321-3327 city_waste()
    let penaltyWaste = Math.floor((totalOutput * wasteLevel) / 100);

    // Apply waste reduction effects
    const wasteReduction = this.calculateEffect(EffectType.OUTPUT_WASTE_PCT, context);
    if (wasteReduction.value > 0) {
      penaltyWaste -= Math.floor((penaltyWaste * wasteReduction.value) / 100);
    }

    return Math.min(Math.max(penaltyWaste, 0), totalOutput);
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
    // @reference reference/freeciv/common/requirements.c:6495-6535
    // Freeciv evaluates every requirement against the supplied context. Missing
    // context is not permission to apply an effect, so unsupported requirements
    // must fail closed rather than silently granting their effects.
    this.requirementHandlers['Gov'] = (req, context) =>
      this.requirementResult('Government', req, this.matches(context.government, req.name));

    this.requirementHandlers['Government'] = this.requirementHandlers['Gov'];

    this.requirementHandlers['OutputType'] = (req, context) =>
      this.requirementResult('OutputType', req, this.matches(context.outputType, req.name));

    this.requirementHandlers['UnitType'] = (req, context) =>
      this.requirementResult('UnitType', req, this.matches(context.unitType, req.name));
    this.requirementHandlers['Action'] = (req, context) =>
      this.requirementResult('Action', req, this.matches(context.action, req.name));

    // Building requirement handler
    this.requirementHandlers['Building'] = (req, context) => {
      const buildings =
        req.range === 'World'
          ? context.worldBuildings
          : req.range === 'Player'
            ? context.playerBuildings
            : context.cityBuildings;
      return this.requirementResult('Building', req, this.cityHasBuilding(buildings, req.name));
    };
    this.requirementHandlers['BuildingFlag'] = (req, context) => {
      const buildings = req.range === 'Player' ? context.playerBuildings : context.cityBuildings;
      return this.requirementResult(
        'BuildingFlag',
        req,
        this.cityHasBuildingFlag(buildings, req.name)
      );
    };
    this.requirementHandlers['BuildingGenus'] = (req, context) =>
      this.requirementResult('BuildingGenus', req, this.matches(context.buildingGenus, req.name));

    // Technology requirement handler
    this.requirementHandlers['Tech'] = (req, context) => {
      const techs = req.range === 'World' ? context.worldTechs : context.playerTechs;
      return this.requirementResult('Tech', req, this.setContains(techs, req.name));
    };
    // Government ruleset requirements use the lowercase spelling.
    // @reference reference/freeciv/data/classic/governments.ruleset
    this.requirementHandlers['tech'] = this.requirementHandlers['Tech'];

    this.requirementHandlers['Player'] = (req, context) =>
      this.requirementResult('Player', req, this.matches(context.playerId, req.name));

    this.requirementHandlers['UnitClass'] = (req, context) =>
      this.requirementResult('UnitClass', req, this.matches(context.unitClass, req.name));
    this.requirementHandlers['UnitClassFlag'] = (req, context) =>
      this.requirementResult(
        'UnitClassFlag',
        req,
        this.setContains(context.unitClassFlags, req.name)
      );
    this.requirementHandlers['UnitTypeFlag'] = (req, context) =>
      this.requirementResult(
        'UnitTypeFlag',
        req,
        this.setContains(context.unitTypeFlags, req.name)
      );
    // @reference reference/freeciv/common/requirements.c:4803-4828
    this.requirementHandlers['UnitState'] = (req, context) =>
      this.requirementResult(
        'UnitState',
        req,
        this.matches(req.name, 'HasHomeCity') === true ? context.unitHasHomeCity : undefined
      );
    this.requirementHandlers['Activity'] = (req, context) =>
      this.requirementResult('Activity', req, this.matches(context.unitActivity, req.name));
    this.requirementHandlers['Terrain'] = (req, context) =>
      this.requirementResult('Terrain', req, this.matches(context.tileTerrain, req.name));
    this.requirementHandlers['TerrainClass'] = (req, context) =>
      this.requirementResult(
        'TerrainClass',
        req,
        req.range === 'Adjacent'
          ? this.setContains(context.adjacentTerrainClasses, req.name)
          : this.matches(context.tileTerrainClass, req.name)
      );
    this.requirementHandlers['TerrainFlag'] = (req, context) =>
      this.requirementResult(
        'TerrainFlag',
        req,
        req.range === 'Adjacent'
          ? this.setContains(context.adjacentTerrainFlags, req.name)
          : this.setContains(context.tileTerrainFlags, req.name)
      );
    this.requirementHandlers['AI'] = (req, context) =>
      this.requirementResult(
        'AI',
        req,
        context.playerIsAI === true && this.matches(context.aiLevel, req.name)
      );
    this.requirementHandlers['Extra'] = (req, context) =>
      this.requirementResult('Extra', req, this.setContains(context.tileExtras, req.name));
    this.requirementHandlers['CityTile'] = (req, context) =>
      this.requirementResult(
        'CityTile',
        req,
        this.matches(req.name, 'Center') === false
          ? false
          : context.tileIsCityCenter === undefined
            ? undefined
            : context.tileIsCityCenter
      );
    this.requirementHandlers['Specialist'] = (req, context) =>
      this.requirementResult('Specialist', req, this.matches(context.specialist, req.name));
    this.requirementHandlers['MaxUnitsOnTile'] = (req, context) =>
      this.requirementResult(
        'MaxUnitsOnTile',
        req,
        context.maxUnitsOnTile === undefined
          ? undefined
          : context.maxUnitsOnTile <= Number(req.name)
      );
    this.requirementHandlers['MinSize'] = (req, context) =>
      this.requirementResult(
        'MinSize',
        req,
        context.cityPopulation === undefined
          ? undefined
          : context.cityPopulation >= Number(req.name)
      );
    // @reference reference/freeciv/common/requirements.c:2776-2838
    // Freeciv evaluates MinCulture in the shared requirement evaluator. The
    // effects path is synchronous, so callers provide the already-calculated
    // value for the relevant requirement range in the effect context.
    this.requirementHandlers['MinCulture'] = (req, context) => {
      const range = this.normaliseRuleName(req.range);
      const cultures = cultureValuesForRange(range, context);
      const required = Number(req.name);
      const matches =
        Number.isFinite(required) && cultures !== undefined
          ? cultures.some(culture => culture >= required)
          : undefined;
      return this.requirementResult('MinCulture', req, matches);
    };
    this.requirementHandlers['NationGroup'] = (req, context) =>
      this.requirementResult(
        'NationGroup',
        req,
        this.setContains(context.playerNationGroups, req.name)
      );
    this.requirementHandlers['Age'] = (req, context) =>
      this.requirementResult(
        'Age',
        req,
        context.age === undefined ? undefined : context.age >= Number(req.name)
      );
    this.requirementHandlers['MinYear'] = (req, context) =>
      this.requirementResult(
        'MinYear',
        req,
        context.currentYear === undefined ? undefined : context.currentYear >= Number(req.name)
      );
    this.requirementHandlers['CityStatus'] = (req, context) =>
      this.requirementResult(
        'CityStatus',
        req,
        this.matches(req.name, 'Celebration') ? context.cityCelebrating : undefined
      );
  }

  private requirementResult(
    type: string,
    req: Requirement,
    actual: boolean | undefined
  ): RequirementResult {
    const satisfied = actual !== undefined && actual === (req.present !== false);
    return satisfied
      ? { satisfied: true }
      : { satisfied: false, reason: `${type} requirement not met: ${req.name}` };
  }

  private matches(actual: string | undefined, expected: string): boolean | undefined {
    return actual === undefined
      ? undefined
      : this.normaliseRuleName(actual) === this.normaliseRuleName(expected);
  }

  private setContains(values: Set<string> | undefined, expected: string): boolean | undefined {
    return values === undefined
      ? undefined
      : [...values].some(value => this.matches(value, expected));
  }

  /**
   * Saved cities use stable building IDs, while classic effects.ruleset names
   * improvements by their display name (for example `walls` / `City Walls`).
   */
  private cityHasBuilding(
    buildings: Set<string> | undefined,
    expected: string
  ): boolean | undefined {
    if (buildings === undefined) return undefined;
    if (buildings.size === 0) return false;
    if (this.setContains(buildings, expected)) return true;

    const rulesetBuildings = rulesetBuildingsService.getBuildingTypes(this.rulesetName);
    return [...buildings].some(buildingId => {
      const building = rulesetBuildings[buildingId];
      return building !== undefined && this.matches(building.name, expected) === true;
    });
  }

  private cityHasBuildingFlag(
    buildings: Set<string> | undefined,
    expected: string
  ): boolean | undefined {
    if (buildings === undefined) return undefined;
    if (buildings.size === 0) return false;

    const rulesetBuildings = rulesetBuildingsService.getBuildingTypes(this.rulesetName);
    return [...buildings].some(buildingId => {
      const building =
        rulesetBuildings[buildingId] ??
        Object.values(rulesetBuildings).find(candidate => this.matches(candidate.name, buildingId));
      return building?.flags.some(flag => this.matches(flag, expected)) ?? false;
    });
  }

  private normaliseRuleName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private handleUnknownRequirement = (
    req: Requirement,
    _context: EffectContext
  ): RequirementResult => {
    logger.warn(`Unsupported requirement type: ${req.type}`);
    return { satisfied: false, reason: `Unsupported requirement type: ${req.type}` };
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
    const govReq = effect.reqs?.find(req => req.type === 'Gov');
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
   *
   * A null result means the player owns no government center. The caller must
   * then apply Freeciv's waste-all rule when distance waste is active.
   * @reference reference/freeciv/common/city.c:2287-2314 nearest_gov_center()
   * @reference reference/freeciv/common/city.c:3296-3299 city_waste()
   */
  public calculateDistanceToGovCenter(
    cityContext: EffectContext,
    playerCities?: Array<{ id: string; x: number; y: number; buildings?: Set<string> }>
  ): number | null {
    // Check the special case that the city itself is a government center
    // before iterating over the owner's cities.
    // @reference reference/freeciv/common/city.c:2294-2299
    if (this.isGovernmentCenter(cityContext)) {
      return 0;
    }

    if (!playerCities || cityContext.tileX === undefined || cityContext.tileY === undefined) {
      return null;
    }

    let nearestDistance = Number.MAX_SAFE_INTEGER;

    for (const city of playerCities) {
      // Do not recheck the current city
      // @reference reference/freeciv/common/city.c:2302
      if (city.id === cityContext.cityId) {
        continue;
      }

      // Only cities whose own building context activates Gov_Center count.
      const otherCityContext: EffectContext = {
        ...cityContext,
        cityId: city.id,
        tileX: city.x,
        tileY: city.y,
        cityBuildings: city.buildings,
      };

      if (this.isGovernmentCenter(otherCityContext)) {
        // real_map_distance() reduces to MAX(|dx|, |dy|) on the square
        // topology CivJS uses, matching the Chebyshev distance already applied
        // to citymindist.
        // @reference reference/freeciv/common/map.c:623-654 map_vector_to_real_distance()
        const distance = this.realDistanceProvider
          ? this.realDistanceProvider(cityContext.tileX, cityContext.tileY, city.x, city.y)
          : Math.max(Math.abs(cityContext.tileX - city.x), Math.abs(cityContext.tileY - city.y));
        nearestDistance = Math.min(nearestDistance, distance);
      }
    }

    return nearestDistance === Number.MAX_SAFE_INTEGER ? null : nearestDistance;
  }

  /**
   * Calculate corruption for a city based on government and distance
   * Reference: freeciv city_corruption() in common/city.c
   */
  public calculateCityCorruption(
    cityContext: EffectContext,
    tradeOutput: number,
    playerCities?: Array<{ id: string; x: number; y: number; buildings?: Set<string> }>
  ): { corruption: number; distanceToGovCenter: number | null } {
    const distanceToGovCenter = this.calculateDistanceToGovCenter(cityContext, playerCities);
    const tradeContext = { ...cityContext, outputType: OutputType.TRADE };
    const hasDistanceWaste =
      this.calculateEffect(EffectType.OUTPUT_WASTE_BY_DISTANCE, tradeContext).value > 0 ||
      this.calculateEffect(EffectType.OUTPUT_WASTE_BY_REL_DISTANCE, tradeContext).value > 0;
    // Freeciv wastes all eligible output when distance corruption is active but
    // the player owns no government center.
    // @reference reference/freeciv/common/city.c:3292-3302 city_waste()
    if (distanceToGovCenter === null && hasDistanceWaste) {
      return { corruption: tradeOutput, distanceToGovCenter };
    }

    const corruption = this.calculateWaste(
      cityContext,
      OutputType.TRADE,
      tradeOutput,
      distanceToGovCenter ?? undefined
    );

    return {
      corruption,
      distanceToGovCenter,
    };
  }
}

export const effectsManager = new EffectsManager();
