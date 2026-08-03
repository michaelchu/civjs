/**
 * @module server/shared/data/rulesets/RulesetLoader
 * Ruleset loader service for loading and validating JSON-based rulesets
 * Provides type-safe, validated access to ruleset data with synchronous loading
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  TerrainRulesetFileSchema,
  type TerrainRulesetFile,
  type TerrainRuleset,
  type TerrainType,
  type MapgenTerrainProperty,
  BuildingsRulesetFileSchema,
  type BuildingsRulesetFile,
  type BuildingTypeRuleset,
  TechsRulesetFileSchema,
  type TechsRulesetFile,
  type TechnologyRuleset,
  UnitsRulesetFileSchema,
  type UnitsRulesetFile,
  type UnitTypeRuleset,
  GovernmentsRulesetFileSchema,
  type GovernmentsRulesetFile,
  type GovernmentRuleset,
  GameRulesetFileSchema,
  type GameRulesetFile,
  type GameParameters,
  type Civstyle,
  type GameOptions,
  type CombatRules,
  type BorderRules,
  type CultureRules,
  type CalendarRules,
  type TradeRules,
  EffectsRulesetFileSchema,
  type EffectsRulesetFile,
  type Effect,
  NationsRulesetFileSchema,
  type NationsRulesetFile,
  type NationRuleset,
  type TraitRange,
  type NationsCompatibility,
  CitiesRulesetFileSchema,
  type CitiesRulesetFile,
  type CityStyle,
  type CityFoundingRules,
  ActionsRulesetFileSchema,
  type ActionsRulesetFile,
  type ActionEnabler,
  ExtrasRulesetFileSchema,
  type ExtrasRulesetFile,
  type ExtraRuleset,
  type ResourceRuleset,
  StylesRulesetFileSchema,
  type StylesRulesetFile,
  type RulesetCityStyle,
} from './schemas';
import {
  DEFAULT_RULESET,
  SUPPORTED_RULESETS,
  isSupportedRuleset,
  requireSupportedRuleset,
} from './defaultRuleset';

export class RulesetLoader {
  private static instance: RulesetLoader;
  private terrainCache = new Map<string, TerrainRulesetFile>();
  private buildingsCache = new Map<string, BuildingsRulesetFile>();
  private techsCache = new Map<string, TechsRulesetFile>();
  private unitsCache = new Map<string, UnitsRulesetFile>();
  private governmentsCache = new Map<string, GovernmentsRulesetFile>();
  private gameRulesCache = new Map<string, GameRulesetFile>();
  private effectsCache = new Map<string, EffectsRulesetFile>();
  private nationsCache = new Map<string, NationsRulesetFile>();
  private citiesCache = new Map<string, CitiesRulesetFile>();
  private actionsCache = new Map<string, ActionsRulesetFile>();
  private extrasCache = new Map<string, ExtrasRulesetFile>();
  private stylesCache = new Map<string, StylesRulesetFile>();
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    // Use apps/shared/data/rulesets as base directory
    // Default to the directory where this file is located
    this.baseDir = baseDir || __dirname;
  }

  static getInstance(baseDir?: string): RulesetLoader {
    if (!RulesetLoader.instance) {
      RulesetLoader.instance = new RulesetLoader(baseDir);
    }
    return RulesetLoader.instance;
  }

  /** Return the installed CivJS gameplay rulesets. */
  getAvailableRulesets(): string[] {
    return SUPPORTED_RULESETS.filter(name => this.hasCompleteRulesetData(name));
  }

  hasRuleset(rulesetName: string): boolean {
    return isSupportedRuleset(rulesetName) && this.hasCompleteRulesetData(rulesetName);
  }

  private hasCompleteRulesetData(rulesetName: string): boolean {
    return [
      'terrain.json',
      'buildings.json',
      'techs.json',
      'units.json',
      'governments.json',
      'game.json',
      'effects.json',
      'nations.json',
    ].every(file => existsSync(join(this.baseDir, rulesetName, file)));
  }

  private requireInstalledRuleset(rulesetName: string): string {
    const supportedRuleset = requireSupportedRuleset(rulesetName);
    if (!this.hasCompleteRulesetData(supportedRuleset)) {
      throw new Error(`Ruleset '${supportedRuleset}' is not installed completely.`);
    }
    return supportedRuleset;
  }

  /** Load the active Civ2Civ3 terrain ruleset. */
  loadTerrainRuleset(rulesetName: string = DEFAULT_RULESET): TerrainRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    if (this.terrainCache.has(rulesetName)) {
      return this.terrainCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'terrain.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = TerrainRulesetFileSchema.parse(rawData);

      // Cache the validated data
      this.terrainCache.set(rulesetName, validatedData);

      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load terrain ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load terrain ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all terrain definitions for a ruleset
   */
  getTerrains(rulesetName: string = DEFAULT_RULESET): Record<TerrainType, TerrainRuleset> {
    const rulesetFile = this.loadTerrainRuleset(rulesetName);
    return rulesetFile.terrains as Record<TerrainType, TerrainRuleset>;
  }

  /**
   * Get a specific terrain definition
   */
  getTerrain(terrainType: TerrainType, rulesetName: string = DEFAULT_RULESET): TerrainRuleset {
    const terrains = this.getTerrains(rulesetName);
    // `coast` remains an internal map-generation label. C2C3 represents
    // those shallow coastal tiles with its Ocean terrain.
    const catalogueType = terrainType === 'coast' ? 'ocean' : terrainType;
    const terrain = terrains[catalogueType];

    if (!terrain) {
      throw new Error(`Terrain type '${terrainType}' not found in ruleset '${rulesetName}'`);
    }

    return terrain;
  }

  /**
   * Pick terrain based on weighted selection - synchronous version of original function
   * @reference apps/server/src/game/map/TerrainRuleset.ts:269-333
   */
  pickTerrain(
    target: MapgenTerrainProperty,
    prefer: MapgenTerrainProperty,
    avoid: MapgenTerrainProperty,
    random: () => number,
    rulesetName: string = DEFAULT_RULESET
  ): TerrainType {
    const terrains = this.getTerrains(rulesetName);

    let sum = 0;
    const validTerrains: Array<{ terrain: TerrainType; weight: number }> = [];

    for (const [terrainName, ruleset] of Object.entries(terrains)) {
      if (ruleset.notGenerated) continue; // Skip TER_NOT_GENERATED terrains
      if (this.isTerrainAvoided(ruleset, avoid)) continue;
      if (!this.matchesPrefer(ruleset, prefer)) continue;

      const weight = this.computeTerrainWeight(ruleset, target);
      if (weight > 0) {
        sum += weight;
        validTerrains.push({ terrain: terrainName as TerrainType, weight });
      }
    }

    if (sum === 0) {
      return this.relaxPickConstraints(target, prefer, avoid, random, rulesetName);
    }

    return this.selectTerrainByWeight(validTerrains, sum, random) ?? 'grassland';
  }

  private isTerrainAvoided(ruleset: TerrainRuleset, avoid: MapgenTerrainProperty): boolean {
    return avoid !== 'MG_UNUSED' && (ruleset.properties?.[avoid] ?? 0) > 0;
  }

  private matchesPrefer(ruleset: TerrainRuleset, prefer: MapgenTerrainProperty): boolean {
    return prefer === 'MG_UNUSED' || (ruleset.properties?.[prefer] ?? 0) > 0;
  }

  private computeTerrainWeight(ruleset: TerrainRuleset, target: MapgenTerrainProperty): number {
    return target !== 'MG_UNUSED' ? (ruleset.properties?.[target] ?? 0) : 1;
  }

  private relaxPickConstraints(
    target: MapgenTerrainProperty,
    prefer: MapgenTerrainProperty,
    avoid: MapgenTerrainProperty,
    random: () => number,
    rulesetName: string
  ): TerrainType {
    if (prefer !== 'MG_UNUSED') {
      return this.pickTerrain(target, 'MG_UNUSED', avoid, random, rulesetName);
    }
    if (avoid !== 'MG_UNUSED') {
      return this.pickTerrain(target, prefer, 'MG_UNUSED', random, rulesetName);
    }
    return this.pickTerrain('MG_UNUSED', prefer, avoid, random, rulesetName);
  }

  private selectTerrainByWeight(
    validTerrains: Array<{ terrain: TerrainType; weight: number }>,
    sum: number,
    random: () => number
  ): TerrainType | null {
    let pick = Math.floor(random() * sum);
    for (const { terrain, weight } of validTerrains) {
      if (pick < weight) return terrain;
      pick -= weight;
    }
    return null;
  }

  /**
   * Get terrain properties for a given terrain type
   */
  getTerrainProperties(
    terrainType: TerrainType,
    rulesetName: string = DEFAULT_RULESET
  ): Partial<Record<MapgenTerrainProperty, number>> {
    const terrain = this.getTerrain(terrainType, rulesetName);
    return terrain.properties ?? {};
  }

  /**
   * Check if a terrain has a specific property
   */
  terrainHasProperty(
    terrainType: TerrainType,
    property: MapgenTerrainProperty,
    rulesetName: string = DEFAULT_RULESET
  ): boolean {
    const properties = this.getTerrainProperties(terrainType, rulesetName);
    const value = properties[property] ?? 0;
    return value > 0;
  }

  /**
   * Get terrain transform result
   */
  getTerrainTransform(
    terrainType: TerrainType,
    rulesetName: string = DEFAULT_RULESET
  ): TerrainType | undefined {
    const terrain = this.getTerrain(terrainType, rulesetName);
    return terrain.transformTo;
  }

  /**
   * Load the installed C2C3 buildings ruleset.
   */
  loadBuildingsRuleset(rulesetName: string = DEFAULT_RULESET): BuildingsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    if (this.buildingsCache.has(rulesetName)) {
      return this.buildingsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'buildings.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = BuildingsRulesetFileSchema.parse(rawData);

      // Cache the validated data
      this.buildingsCache.set(rulesetName, validatedData);

      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load buildings ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load buildings ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all building definitions for a ruleset
   */
  getBuildings(rulesetName: string = DEFAULT_RULESET): Record<string, BuildingTypeRuleset> {
    const rulesetFile = this.loadBuildingsRuleset(rulesetName);
    return rulesetFile.buildings;
  }

  /**
   * Get a specific building definition
   */
  getBuilding(buildingId: string, rulesetName: string = DEFAULT_RULESET): BuildingTypeRuleset {
    const buildings = this.getBuildings(rulesetName);
    const building = buildings[buildingId];

    if (!building) {
      throw new Error(`Building '${buildingId}' not found in ruleset '${rulesetName}'`);
    }

    return building;
  }

  /**
   * Load the installed C2C3 technology ruleset.
   */
  loadTechsRuleset(rulesetName: string = DEFAULT_RULESET): TechsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    if (this.techsCache.has(rulesetName)) {
      return this.techsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'techs.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = TechsRulesetFileSchema.parse(rawData);

      // Cache the validated data
      this.techsCache.set(rulesetName, validatedData);

      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load techs ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load techs ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all technology definitions for a ruleset
   */
  getTechs(rulesetName: string = DEFAULT_RULESET): Record<string, TechnologyRuleset> {
    const rulesetFile = this.loadTechsRuleset(rulesetName);
    return rulesetFile.techs;
  }

  /**
   * Get a specific technology definition
   */
  getTech(techId: string, rulesetName: string = DEFAULT_RULESET): TechnologyRuleset {
    const techs = this.getTechs(rulesetName);
    const tech = techs[techId];

    if (!tech) {
      throw new Error(`Technology '${techId}' not found in ruleset '${rulesetName}'`);
    }

    return tech;
  }

  /**
   * Load the installed C2C3 unit ruleset.
   */
  loadUnitsRuleset(rulesetName: string = DEFAULT_RULESET): UnitsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    if (this.unitsCache.has(rulesetName)) {
      return this.unitsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'units.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = UnitsRulesetFileSchema.parse(rawData);

      // Cache the validated data
      this.unitsCache.set(rulesetName, validatedData);

      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load units ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load units ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all unit definitions for a ruleset
   */
  getUnits(rulesetName: string = DEFAULT_RULESET): Record<string, UnitTypeRuleset> {
    const rulesetFile = this.loadUnitsRuleset(rulesetName);
    return rulesetFile.units;
  }

  /**
   * Get a specific unit definition
   */
  getUnit(unitId: string, rulesetName: string = DEFAULT_RULESET): UnitTypeRuleset {
    const units = this.getUnits(rulesetName);
    const unit = units[unitId];

    if (!unit) {
      throw new Error(`Unit '${unitId}' not found in ruleset '${rulesetName}'`);
    }

    return unit;
  }

  /**
   * Load the installed C2C3 government ruleset.
   */
  loadGovernmentsRuleset(rulesetName: string = DEFAULT_RULESET): GovernmentsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    const cached = this.governmentsCache.get(rulesetName);
    if (cached) {
      return cached;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'governments.json');
      const fileContent = readFileSync(filePath, 'utf8');
      const rawData = JSON.parse(fileContent);

      // Validate using Zod schema
      const governmentsRuleset = GovernmentsRulesetFileSchema.parse(rawData);

      // Cache and return
      this.governmentsCache.set(rulesetName, governmentsRuleset);
      return governmentsRuleset;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load governments ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load governments ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all governments from a ruleset
   */
  getGovernments(rulesetName: string = DEFAULT_RULESET): Record<string, GovernmentRuleset> {
    const ruleset = this.loadGovernmentsRuleset(rulesetName);
    return ruleset.governments.types;
  }

  /**
   * Get a specific government from a ruleset
   */
  getGovernment(governmentId: string, rulesetName: string = DEFAULT_RULESET): GovernmentRuleset {
    const governments = this.getGovernments(rulesetName);
    const government = governments[governmentId];

    if (!government) {
      throw new Error(`Government '${governmentId}' not found in ruleset '${rulesetName}'`);
    }

    return government;
  }

  /**
   * Get the revolution government type from a ruleset
   */
  getRevolutionGovernment(rulesetName: string = DEFAULT_RULESET): string {
    const ruleset = this.loadGovernmentsRuleset(rulesetName);
    return ruleset.governments.during_revolution;
  }

  /**
   * Load the installed C2C3 game rules and parameters.
   */
  loadGameRulesRuleset(rulesetName: string = DEFAULT_RULESET): GameRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    const cached = this.gameRulesCache.get(rulesetName);
    if (cached) {
      return cached;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'game.json');
      const fileContent = readFileSync(filePath, 'utf8');
      const rawData = JSON.parse(fileContent);

      // Validate using Zod schema
      const gameRuleset = GameRulesetFileSchema.parse(rawData);

      // Cache and return
      this.gameRulesCache.set(rulesetName, gameRuleset);
      return gameRuleset;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load game rules ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load game rules ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get game parameters from a ruleset
   */
  getGameParameters(rulesetName: string = DEFAULT_RULESET): GameParameters {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.game_parameters;
  }

  /**
   * Get civstyle parameters from a ruleset
   */
  getCivstyle(rulesetName: string = DEFAULT_RULESET): Civstyle {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.civstyle;
  }

  getCombatRules(rulesetName: string = DEFAULT_RULESET): CombatRules {
    return this.loadGameRulesRuleset(rulesetName).combat_rules;
  }

  getBorderRules(rulesetName: string = DEFAULT_RULESET): BorderRules {
    return this.loadGameRulesRuleset(rulesetName).borders;
  }

  getCultureRules(rulesetName: string = DEFAULT_RULESET): CultureRules {
    return this.loadGameRulesRuleset(rulesetName).culture;
  }

  getCalendarRules(rulesetName: string = DEFAULT_RULESET): CalendarRules {
    return this.loadGameRulesRuleset(rulesetName).calendar;
  }

  getTradeRules(rulesetName: string = DEFAULT_RULESET): TradeRules {
    return this.loadGameRulesRuleset(rulesetName).trade;
  }

  /**
   * Get game options from a ruleset
   */
  getGameOptions(rulesetName: string = DEFAULT_RULESET): GameOptions {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.options;
  }

  /**
   * Resolve `options.global_init_buildings` to canonical building ids.
   *
   * Freeciv parses this option into improvement ids while loading the ruleset
   * and refuses to load when a configured rule name matches no improvement, so
   * an unknown name is an error here rather than a silently skipped entry.
   * @reference reference/freeciv/server/ruleset/ruleload.c:1005-1049 lookup_building_list()
   * @reference reference/freeciv/server/ruleset/ruleload.c:6811-6816
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:60-62
   */
  getGlobalInitBuildings(rulesetName: string = DEFAULT_RULESET): string[] {
    const configured = this.getGameOptions(rulesetName).global_init_buildings;
    const ruleNames = configured
      .split(',')
      .map(entry =>
        entry
          .trim()
          .replace(/^"(.*)"$/, '$1')
          .trim()
      )
      .filter(entry => entry.length > 0);

    if (ruleNames.length === 0) {
      return [];
    }

    const buildings = this.getBuildings(rulesetName);
    return ruleNames.map(ruleName => {
      const normalized = this.normalizeRuleName(ruleName);
      const match = Object.entries(buildings).find(
        ([buildingId, building]) =>
          this.normalizeRuleName(buildingId) === normalized ||
          this.normalizeRuleName(building.id) === normalized ||
          this.normalizeRuleName(building.name) === normalized
      );

      if (!match) {
        throw new Error(
          `Ruleset '${rulesetName}' options.global_init_buildings: couldn't match '${ruleName}'`
        );
      }

      return match[1].id;
    });
  }

  /**
   * Resolve `options.global_init_techs` to canonical technology ids.
   *
   * Freeciv resolves the rule names while loading the ruleset, then grants
   * these technologies before the random `techlevel` grants at game start.
   * Keep an invalid name fatal instead of silently omitting a gameplay rule.
   * @reference reference/freeciv/server/ruleset/ruleload.c:941-995 lookup_tech_list()
   * @reference reference/freeciv/server/ruleset/ruleload.c:6805-6815
   * @reference reference/freeciv/server/techtools.c:1188-1219
   */
  getGlobalInitTechnologies(rulesetName: string = DEFAULT_RULESET): string[] {
    const configured = this.getGameOptions(rulesetName).global_init_techs;
    const ruleNames = configured
      .split(',')
      .map(entry =>
        entry
          .trim()
          .replace(/^"(.*)"$/, '$1')
          .trim()
      )
      .filter(entry => entry.length > 0);

    if (ruleNames.length === 0) return [];

    const technologies = this.getTechs(rulesetName);
    return ruleNames.map(ruleName => {
      const normalized = this.normalizeRuleName(ruleName);
      const match = Object.entries(technologies).find(
        ([technologyId, technology]) =>
          this.normalizeRuleName(technologyId) === normalized ||
          this.normalizeRuleName(technology.id) === normalized ||
          this.normalizeRuleName(technology.name) === normalized ||
          this.normalizeRuleName(technology.internal_name ?? '') === normalized
      );

      if (!match) {
        throw new Error(
          `Ruleset '${rulesetName}' options.global_init_techs: couldn't match '${ruleName}'`
        );
      }

      return match[1].id;
    });
  }

  /**
   * Get capabilities from a ruleset
   */
  getCapabilities(rulesetName: string = DEFAULT_RULESET): string[] {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.capabilities;
  }

  /**
   * Load the installed C2C3 effects ruleset.
   */
  loadEffectsRuleset(rulesetName: string = DEFAULT_RULESET): EffectsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    const cached = this.effectsCache.get(rulesetName);
    if (cached) {
      return cached;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'effects.json');
      const fileContent = readFileSync(filePath, 'utf8');
      const rawData = JSON.parse(fileContent);

      // Validate using Zod schema
      const effectsRuleset = EffectsRulesetFileSchema.parse(rawData);

      // Cache and return
      this.effectsCache.set(rulesetName, effectsRuleset);
      return effectsRuleset;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load effects ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load effects ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all effects from a ruleset
   */
  getEffects(rulesetName: string = DEFAULT_RULESET): Record<string, Effect> {
    const ruleset = this.loadEffectsRuleset(rulesetName);
    return ruleset.effects;
  }

  /**
   * Get a specific effect from a ruleset
   */
  getEffect(effectId: string, rulesetName: string = DEFAULT_RULESET): Effect {
    const effects = this.getEffects(rulesetName);
    const effect = effects[effectId];

    if (!effect) {
      throw new Error(`Effect '${effectId}' not found in ruleset '${rulesetName}'`);
    }

    return effect;
  }

  /**
   * Load the installed C2C3 nations ruleset.
   */
  loadNationsRuleset(rulesetName: string = DEFAULT_RULESET): NationsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    const cached = this.nationsCache.get(rulesetName);
    if (cached) {
      return cached;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'nations.json');
      const fileContent = readFileSync(filePath, 'utf8');
      const rawData = JSON.parse(fileContent);

      // Validate using Zod schema
      const nationsRuleset = NationsRulesetFileSchema.parse(rawData);

      // Cache and return
      this.nationsCache.set(rulesetName, nationsRuleset);
      return nationsRuleset;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load nations ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load nations ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all nations from a ruleset
   */
  getNations(rulesetName: string = DEFAULT_RULESET): Record<string, NationRuleset> {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.nations;
  }

  /**
   * Resolve the active Freeciv nation-set value. An empty setting selects the
   * first ruleset-declared set, matching nation_set_by_setting_value().
   * @reference reference/freeciv/common/nation.c:881-905
   */
  resolveNationSet(rulesetName: string = DEFAULT_RULESET, setting?: string): string | undefined {
    const nationSets = Object.values(this.loadNationsRuleset(rulesetName).nation_sets)
      .map(nationSet => nationSet.rule_name)
      .filter((ruleName): ruleName is string => typeof ruleName === 'string');

    if (nationSets.length === 0) {
      if (setting?.trim()) {
        throw new Error(`Ruleset '${rulesetName}' does not define nation set '${setting}'`);
      }
      return undefined;
    }

    const requested = setting?.trim();
    if (!requested) return nationSets[0];
    if (!nationSets.includes(requested)) {
      throw new Error(`Nation set '${requested}' is not defined by ruleset '${rulesetName}'`);
    }
    return requested;
  }

  /**
   * Return the nations legal in a Freeciv nation set. Rulesets converted
   * before nation-set metadata existed retain their complete catalogue.
   * @reference reference/freeciv/server/ruleset/ruleload.c:5187-5285
   */
  getNationsForSet(
    rulesetName: string = DEFAULT_RULESET,
    setting?: string
  ): Record<string, NationRuleset> {
    const activeSet = this.resolveNationSet(rulesetName, setting);
    const nations = this.getNations(rulesetName);
    if (!activeSet) return nations;

    return Object.fromEntries(
      Object.entries(nations).filter(([, nation]) =>
        nation.sets ? nation.sets.includes(activeSet) : true
      )
    );
  }

  /**
   * Get a specific nation from a ruleset
   */
  getNation(nationId: string, rulesetName: string = DEFAULT_RULESET): NationRuleset {
    const nations = this.getNations(rulesetName);
    const nation = nations[nationId];

    if (!nation) {
      throw new Error(`Nation '${nationId}' not found in ruleset '${rulesetName}'`);
    }

    return nation;
  }

  /**
   * Get default traits from a nations ruleset
   */
  getDefaultTraits(rulesetName: string = DEFAULT_RULESET): TraitRange {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.default_traits;
  }

  /**
   * Get nations compatibility settings from a ruleset
   */
  getNationsCompatibility(rulesetName: string = DEFAULT_RULESET): NationsCompatibility {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.compatibility;
  }

  loadActionsRuleset(rulesetName: string = DEFAULT_RULESET): ActionsRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    const cached = this.actionsCache.get(rulesetName);
    if (cached) return cached;
    try {
      const rawData = JSON.parse(
        readFileSync(join(this.baseDir, rulesetName, 'actions.json'), 'utf8')
      );
      const ruleset = ActionsRulesetFileSchema.parse(rawData);
      this.actionsCache.set(rulesetName, ruleset);
      return ruleset;
    } catch (error) {
      throw new Error(
        `Failed to load actions ruleset '${rulesetName}': ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  getActionEnablers(rulesetName: string = DEFAULT_RULESET): ActionEnabler[] {
    return this.loadActionsRuleset(rulesetName).enablers;
  }

  getActionEnablersFor(action: string, rulesetName: string = DEFAULT_RULESET): ActionEnabler[] {
    const normalizedAction = this.normalizeRuleName(action);
    return this.getActionEnablers(rulesetName).filter(
      enabler => this.normalizeRuleName(enabler.action) === normalizedAction
    );
  }

  loadExtrasRuleset(rulesetName: string = DEFAULT_RULESET): ExtrasRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    const cached = this.extrasCache.get(rulesetName);
    if (cached) return cached;
    try {
      const rawData = JSON.parse(
        readFileSync(join(this.baseDir, rulesetName, 'extras.json'), 'utf8')
      );
      const ruleset = ExtrasRulesetFileSchema.parse(rawData);
      this.extrasCache.set(rulesetName, ruleset);
      return ruleset;
    } catch (error) {
      throw new Error(
        `Failed to load extras ruleset '${rulesetName}': ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  getExtras(rulesetName: string = DEFAULT_RULESET): Record<string, ExtraRuleset> {
    return this.loadExtrasRuleset(rulesetName).extras;
  }

  getBases(rulesetName: string = DEFAULT_RULESET): Record<string, Record<string, unknown>> {
    return this.loadExtrasRuleset(rulesetName).bases;
  }

  getBaseForExtra(
    extraIdOrName: string,
    rulesetName: string = DEFAULT_RULESET
  ): Record<string, unknown> | undefined {
    const normalized = this.normalizeRuleName(extraIdOrName);
    return Object.values(this.getBases(rulesetName)).find(
      base => this.normalizeRuleName(String(base.extra ?? '')) === normalized
    );
  }

  getResources(rulesetName: string = DEFAULT_RULESET): Record<string, ResourceRuleset> {
    return this.loadExtrasRuleset(rulesetName).resources;
  }

  getResource(resourceIdOrName: string, rulesetName: string = DEFAULT_RULESET): ResourceRuleset {
    const normalized = this.normalizeRuleName(resourceIdOrName);
    const match = Object.entries(this.getResources(rulesetName)).find(
      ([id, resource]) =>
        this.normalizeRuleName(id.replace(/^resource_/, '')) === normalized ||
        this.normalizeRuleName(String(resource.extra ?? '')) === normalized
    );
    if (!match) {
      throw new Error(`Resource '${resourceIdOrName}' not found in ruleset '${rulesetName}'`);
    }
    return match[1];
  }

  getExtra(extraIdOrName: string, rulesetName: string = DEFAULT_RULESET): ExtraRuleset {
    const normalized = this.normalizeRuleName(extraIdOrName);
    const match = Object.entries(this.getExtras(rulesetName)).find(
      ([id, extra]) =>
        this.normalizeRuleName(id) === normalized ||
        this.normalizeRuleName(extra.name) === normalized ||
        (extra.rule_name ? this.normalizeRuleName(extra.rule_name) === normalized : false)
    );
    if (!match) {
      throw new Error(`Extra '${extraIdOrName}' not found in ruleset '${rulesetName}'`);
    }
    return match[1];
  }

  getTerrainExtraRemovalTime(
    terrainIdOrName: string,
    extraIdOrName: string,
    rulesetName: string = DEFAULT_RULESET
  ): number | undefined {
    const normalizedTerrain = this.normalizeRuleName(terrainIdOrName);
    const normalizedExtra = this.normalizeRuleName(extraIdOrName);
    const terrainAliases: Record<string, string> = { tundra: 'tundra', glacier: 'glacier' };
    const expectedTerrain = terrainAliases[normalizedTerrain] ?? normalizedTerrain;
    const settings = Object.values(this.loadExtrasRuleset(rulesetName).terrain_extra_settings).find(
      entry => this.normalizeRuleName(entry.terrain) === expectedTerrain
    );
    return settings?.extra_settings.find(
      entry => this.normalizeRuleName(entry.extra) === normalizedExtra
    )?.removal_time;
  }

  loadStylesRuleset(rulesetName: string = DEFAULT_RULESET): StylesRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    const cached = this.stylesCache.get(rulesetName);
    if (cached) return cached;
    try {
      const rawData = JSON.parse(
        readFileSync(join(this.baseDir, rulesetName, 'styles.json'), 'utf8')
      );
      const ruleset = StylesRulesetFileSchema.parse(rawData);
      this.stylesCache.set(rulesetName, ruleset);
      return ruleset;
    } catch (error) {
      throw new Error(
        `Failed to load styles ruleset '${rulesetName}': ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  getRulesetCityStyles(rulesetName: string = DEFAULT_RULESET): Record<string, RulesetCityStyle> {
    return this.loadStylesRuleset(rulesetName).city_styles;
  }

  /**
   * Load every ruleset file and reject unresolved cross-file references.
   * Freeciv resolves named universals while loading rulesets and treats an
   * unknown rule name as a ruleset error.
   * @reference reference/freeciv/common/requirements.c:1108-1120
   */
  validateRuleset(rulesetName: string = DEFAULT_RULESET): void {
    const terrains = this.loadTerrainRuleset(rulesetName).terrains;
    const unitsRuleset = this.loadUnitsRuleset(rulesetName);
    const units = unitsRuleset.units;
    const unitClasses = unitsRuleset.unit_classes;
    const buildings = this.loadBuildingsRuleset(rulesetName).buildings;
    const techs = this.loadTechsRuleset(rulesetName).techs;
    const governments = this.loadGovernmentsRuleset(rulesetName).governments;
    const effects = this.loadEffectsRuleset(rulesetName).effects;
    const actions = this.loadActionsRuleset(rulesetName);
    const extrasRuleset = this.loadExtrasRuleset(rulesetName);
    const styles = this.loadStylesRuleset(rulesetName);

    // Loading the remaining files here makes validateRuleset the single schema
    // integrity entry point even though they do not contribute entity indexes.
    this.loadGameRulesRuleset(rulesetName);
    this.loadNationsRuleset(rulesetName);
    this.loadCitiesRuleset(rulesetName);

    const terrainNames = this.buildRuleNameIndex(terrains);
    const unitNames = this.buildRuleNameIndex(units);
    const buildingNames = this.buildRuleNameIndex(buildings);
    const techNames = this.buildRuleNameIndex(techs);
    const governmentNames = this.buildRuleNameIndex(governments.types);
    const extraNames = this.buildRuleNameIndex(extrasRuleset.extras);
    const styleNames = this.buildRuleNameIndex(styles.nation_styles);
    // Freeciv's Glacier is represented by CivJS's tundra terrain identifier.
    terrainNames.add('glacier');
    const errors: string[] = [];

    this.validateCoreReferences(
      errors,
      units,
      unitClasses,
      techNames,
      unitNames,
      buildings,
      buildingNames,
      effects,
      terrainNames,
      governmentNames
    );
    /*
    for (const [unitId, unit] of Object.entries(units)) {
      if (!(unit.unit_class in unitClasses)) {
        errors.push(`Unit '${unitId}' unit class '${unit.unit_class}' does not exist`);
      }

      // CivJS ships Fanatics as a compatibility extension, while C2C3
      // explicitly omits Fundamentalism. Keep that one extension inert rather
      // than inventing a technology or government during validation work.
      // @reference reference/freeciv/data/civ2civ3/governments.ruleset:14-14
      // @reference reference/freeciv/data/civ2civ3/units.ruleset:344-345
      const isKnownFanaticsExtension =
        unitId === 'fanatic' &&
        unit.required_tech !== undefined &&
        this.normalizeRuleName(unit.required_tech) === 'fundamentalism';
      if (!isKnownFanaticsExtension) {
        this.validateReference(
          errors,
          `Unit '${unitId}' required technology`,
          unit.required_tech,
          techNames
        );
      }
      this.validateReference(
        errors,
        `Unit '${unitId}' required technology`,
        unit.requiredTech,
        techNames
      );
      this.validateReference(errors, `Unit '${unitId}' obsolete unit`, unit.obsolete_by, unitNames);
      this.validateReference(
        errors,
        `Unit '${unitId}' conversion unit`,
        unit.convert_to,
        unitNames
      );
    }

    for (const [buildingId, building] of Object.entries(buildings)) {
      this.validateReference(
        errors,
        `Building '${buildingId}' required technology`,
        building.requiredTech,
        techNames
      );
      for (const prerequisite of building.requires ?? []) {
        this.validateReference(
          errors,
          `Building '${buildingId}' prerequisite`,
          prerequisite,
          buildingNames
        );
      }
    }

    for (const [effectId, effect] of Object.entries(effects)) {
      for (const requirement of effect.reqs ?? []) {
        const namesByType: Partial<Record<string, Set<string>>> = {
          Building: buildingNames,
          Gov: governmentNames,
          Government: governmentNames,
          Tech: techNames,
          Terrain: terrainNames,
          UnitType: unitNames,
        };
        const validNames = namesByType[requirement.type];
        if (validNames) {
          this.validateReference(
            errors,
            `Effect '${effectId}' ${requirement.type} requirement`,
            requirement.name,
            validNames
          );
        }
      }
    }
    */

    const requirementIndexes: Partial<Record<string, Set<string>>> = {
      Building: buildingNames,
      Extra: extraNames,
      Gov: governmentNames,
      Style: styleNames,
      Tech: techNames,
      tech: techNames,
      Terrain: terrainNames,
      UnitClass: new Set(
        Object.entries(unitClasses).flatMap(([id, unitClass]) => [
          this.normalizeRuleName(id),
          this.normalizeRuleName(unitClass.name),
        ])
      ),
    };
    const validateRequirements = (
      owner: string,
      requirements: Array<{ type: string; name: string }>
    ): void => {
      for (const requirement of requirements) {
        const index = requirementIndexes[requirement.type];
        if (index) {
          this.validateReference(
            errors,
            `${owner} ${requirement.type} requirement`,
            requirement.name,
            index
          );
        }
      }
    };

    validateRequirements('Auto attack', actions.auto_attack.if_attacker);
    for (const enabler of actions.enablers) {
      validateRequirements(`Action enabler '${enabler.id}' actor`, enabler.actor_reqs);
      validateRequirements(`Action enabler '${enabler.id}' target`, enabler.target_reqs);
    }
    for (const [extraId, extra] of Object.entries(extrasRuleset.extras)) {
      validateRequirements(`Extra '${extraId}'`, extra.reqs ?? []);
    }
    for (const [resourceId, resource] of Object.entries(extrasRuleset.resources)) {
      this.validateReference(
        errors,
        `Resource '${resourceId}' reveal technology`,
        resource.reveal_tech,
        techNames
      );
    }
    for (const [styleId, style] of Object.entries(styles.city_styles)) {
      validateRequirements(`City style '${styleId}'`, style.reqs);
    }
    for (const [styleId, style] of Object.entries(styles.music_styles)) {
      validateRequirements(`Music style '${styleId}'`, style.reqs);
    }

    this.validateReference(
      errors,
      'Government during_revolution',
      governments.during_revolution,
      governmentNames
    );
    for (const [governmentId, government] of Object.entries(governments.types)) {
      this.validateReference(
        errors,
        `Government '${governmentId}' ai_better`,
        government.ai_better,
        governmentNames
      );
      for (const requirement of government.reqs ?? []) {
        if (requirement.type === 'Tech' || requirement.type === 'tech') {
          this.validateReference(
            errors,
            `Government '${governmentId}' technology requirement`,
            requirement.name,
            techNames
          );
        }
      }
    }

    try {
      this.getGlobalInitBuildings(rulesetName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    try {
      this.getGlobalInitTechnologies(rulesetName);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    if (errors.length > 0) {
      throw new Error(`Ruleset '${rulesetName}' has invalid references:\n${errors.join('\n')}`);
    }
  }

  private validateCoreReferences(
    errors: string[],
    units: Record<string, any>,
    unitClasses: Record<string, any>,
    techNames: Set<string>,
    unitNames: Set<string>,
    buildings: Record<string, any>,
    buildingNames: Set<string>,
    effects: Record<string, any>,
    terrainNames: Set<string>,
    governmentNames: Set<string>
  ): void {
    for (const [unitId, unit] of Object.entries(units)) {
      if (!(unit.unit_class in unitClasses))
        errors.push(`Unit '${unitId}' unit class '${unit.unit_class}' does not exist`);
      const fanatics =
        unitId === 'fanatic' &&
        unit.required_tech !== undefined &&
        this.normalizeRuleName(unit.required_tech) === 'fundamentalism';
      if (!fanatics)
        this.validateReference(
          errors,
          `Unit '${unitId}' required technology`,
          unit.required_tech,
          techNames
        );
      this.validateReference(
        errors,
        `Unit '${unitId}' required technology`,
        unit.requiredTech,
        techNames
      );
      this.validateReference(errors, `Unit '${unitId}' obsolete unit`, unit.obsolete_by, unitNames);
      this.validateReference(
        errors,
        `Unit '${unitId}' conversion unit`,
        unit.convert_to,
        unitNames
      );
    }
    for (const [buildingId, building] of Object.entries(buildings)) {
      this.validateReference(
        errors,
        `Building '${buildingId}' required technology`,
        building.requiredTech,
        techNames
      );
      for (const prerequisite of building.requires ?? [])
        this.validateReference(
          errors,
          `Building '${buildingId}' prerequisite`,
          prerequisite,
          buildingNames
        );
    }
    const namesByType: Partial<Record<string, Set<string>>> = {
      Building: buildingNames,
      Gov: governmentNames,
      Government: governmentNames,
      Tech: techNames,
      Terrain: terrainNames,
      UnitType: unitNames,
    };
    for (const [effectId, effect] of Object.entries(effects)) {
      for (const requirement of effect.reqs ?? []) {
        const validNames = namesByType[requirement.type];
        if (validNames)
          this.validateReference(
            errors,
            `Effect '${effectId}' ${requirement.type} requirement`,
            requirement.name,
            validNames
          );
      }
    }
  }

  private buildRuleNameIndex(
    entries: Record<
      string,
      { id?: string; name: string; internal_name?: string; rule_name?: string }
    >
  ): Set<string> {
    const names = new Set<string>();
    for (const [key, entry] of Object.entries(entries)) {
      for (const name of [key, entry.id, entry.name, entry.internal_name, entry.rule_name]) {
        if (name) names.add(this.normalizeRuleName(name));
      }
    }
    return names;
  }

  private validateReference(
    errors: string[],
    label: string,
    reference: string | undefined,
    validNames: Set<string>
  ): void {
    if (reference && !validNames.has(this.normalizeRuleName(reference))) {
      errors.push(`${label} '${reference}' does not exist`);
    }
  }

  private normalizeRuleName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Load the installed C2C3 cities ruleset.
   */
  loadCitiesRuleset(rulesetName: string = DEFAULT_RULESET): CitiesRulesetFile {
    rulesetName = this.requireInstalledRuleset(rulesetName);
    // Check cache first
    const cached = this.citiesCache.get(rulesetName);
    if (cached) {
      return cached;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'cities.json');
      const fileContent = readFileSync(filePath, 'utf8');
      const rawData = JSON.parse(fileContent);

      // Validate using Zod schema
      const citiesRuleset = CitiesRulesetFileSchema.parse(rawData);

      // Cache and return
      this.citiesCache.set(rulesetName, citiesRuleset);
      return citiesRuleset;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load cities ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load cities ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all city styles from a ruleset
   */
  getCityStyles(rulesetName: string = DEFAULT_RULESET): Record<string, CityStyle> {
    const styles = this.getRulesetCityStyles(rulesetName);
    return Object.fromEntries(
      Object.entries(styles).map(([id, style]) => [
        id.replace(/^citystyle_/, ''),
        {
          name: style.name,
          graphic: style.graphic,
          graphic_alt: style.graphic_alt,
          citizens_graphic: style.citizens_graphic,
          techreq: style.reqs.find(
            requirement => requirement.type.toLowerCase() === 'tech' && requirement.present
          )?.name,
        },
      ])
    );
  }

  /**
   * Get a specific city style from a ruleset
   */
  getCityStyle(styleId: string, rulesetName: string = DEFAULT_RULESET): CityStyle {
    const styles = this.getCityStyles(rulesetName);
    const style = styles[styleId];

    if (!style) {
      throw new Error(`City style '${styleId}' not found in ruleset '${rulesetName}'`);
    }

    return style;
  }

  /**
   * Get city founding rules from a ruleset
   */
  getCityFoundingRules(rulesetName: string = DEFAULT_RULESET): CityFoundingRules {
    const ruleset = this.loadCitiesRuleset(rulesetName);
    return ruleset.founding_rules;
  }

  /**
   * Clear all cached rulesets (useful for testing)
   */
  clearCache(): void {
    this.terrainCache.clear();
    this.buildingsCache.clear();
    this.techsCache.clear();
    this.unitsCache.clear();
    this.governmentsCache.clear();
    this.gameRulesCache.clear();
    this.effectsCache.clear();
    this.nationsCache.clear();
    this.citiesCache.clear();
    this.actionsCache.clear();
    this.extrasCache.clear();
    this.stylesCache.clear();
  }
}

export const rulesetLoader = RulesetLoader.getInstance();
