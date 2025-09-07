/**
 * Ruleset loader service for loading and validating JSON-based rulesets
 * Provides type-safe, validated access to ruleset data with synchronous loading
 */

import { readFileSync } from 'fs';
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
  EffectsRulesetFileSchema,
  type EffectsRulesetFile,
  type Effect,
  NationsRulesetFileSchema,
  type NationsRulesetFile,
  type NationRuleset,
  type TraitRange,
  type NationsCompatibility,
  type Requirement,
  CitiesRulesetFileSchema,
  type CitiesRulesetFile,
  type CityStyle,
  type CityFoundingRules,
} from './schemas';
import { logger } from '@utils/logger';

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

  /**
   * Load terrain ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadTerrainRuleset(rulesetName: string = 'classic'): TerrainRulesetFile {
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
  getTerrains(rulesetName: string = 'classic'): Record<TerrainType, TerrainRuleset> {
    const rulesetFile = this.loadTerrainRuleset(rulesetName);
    return rulesetFile.terrains;
  }

  /**
   * Get a specific terrain definition
   */
  getTerrain(terrainType: TerrainType, rulesetName: string = 'classic'): TerrainRuleset {
    const terrains = this.getTerrains(rulesetName);
    const terrain = terrains[terrainType];

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
    rulesetName: string = 'classic'
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
    rulesetName: string = 'classic'
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
    rulesetName: string = 'classic'
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
    rulesetName: string = 'classic'
  ): TerrainType | undefined {
    const terrain = this.getTerrain(terrainType, rulesetName);
    return terrain.transformTo;
  }

  /**
   * Load buildings ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadBuildingsRuleset(rulesetName: string = 'classic'): BuildingsRulesetFile {
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
  getBuildings(rulesetName: string = 'classic'): Record<string, BuildingTypeRuleset> {
    const rulesetFile = this.loadBuildingsRuleset(rulesetName);
    return rulesetFile.buildings;
  }

  /**
   * Get a specific building definition
   */
  getBuilding(buildingId: string, rulesetName: string = 'classic'): BuildingTypeRuleset {
    const buildings = this.getBuildings(rulesetName);
    const building = buildings[buildingId];

    if (!building) {
      throw new Error(`Building '${buildingId}' not found in ruleset '${rulesetName}'`);
    }

    return building;
  }

  /**
   * Load techs ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadTechsRuleset(rulesetName: string = 'classic'): TechsRulesetFile {
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
  getTechs(rulesetName: string = 'classic'): Record<string, TechnologyRuleset> {
    const rulesetFile = this.loadTechsRuleset(rulesetName);
    return rulesetFile.techs;
  }

  /**
   * Get a specific technology definition
   */
  getTech(techId: string, rulesetName: string = 'classic'): TechnologyRuleset {
    const techs = this.getTechs(rulesetName);
    const tech = techs[techId];

    if (!tech) {
      throw new Error(`Technology '${techId}' not found in ruleset '${rulesetName}'`);
    }

    return tech;
  }

  /**
   * Load units ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadUnitsRuleset(rulesetName: string = 'classic'): UnitsRulesetFile {
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
  getUnits(rulesetName: string = 'classic'): Record<string, UnitTypeRuleset> {
    const rulesetFile = this.loadUnitsRuleset(rulesetName);
    return rulesetFile.units;
  }

  /**
   * Get a specific unit definition
   */
  getUnit(unitId: string, rulesetName: string = 'classic'): UnitTypeRuleset {
    const units = this.getUnits(rulesetName);
    const unit = units[unitId];

    if (!unit) {
      throw new Error(`Unit '${unitId}' not found in ruleset '${rulesetName}'`);
    }

    return unit;
  }

  /**
   * Load governments ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadGovernmentsRuleset(rulesetName: string = 'classic'): GovernmentsRulesetFile {
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
  getGovernments(rulesetName: string = 'classic'): Record<string, GovernmentRuleset> {
    const ruleset = this.loadGovernmentsRuleset(rulesetName);
    return ruleset.governments.types;
  }

  /**
   * Get a specific government from a ruleset
   */
  getGovernment(governmentId: string, rulesetName: string = 'classic'): GovernmentRuleset {
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
  getRevolutionGovernment(rulesetName: string = 'classic'): string {
    const ruleset = this.loadGovernmentsRuleset(rulesetName);
    return ruleset.governments.during_revolution;
  }

  /**
   * Load game rules and parameters ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadGameRulesRuleset(rulesetName: string = 'classic'): GameRulesetFile {
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
  getGameParameters(rulesetName: string = 'classic'): GameParameters {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.game_parameters;
  }

  /**
   * Get civstyle parameters from a ruleset
   */
  getCivstyle(rulesetName: string = 'classic'): Civstyle {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.civstyle;
  }

  /**
   * Get game options from a ruleset
   */
  getGameOptions(rulesetName: string = 'classic'): GameOptions {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.options;
  }

  /**
   * Get capabilities from a ruleset
   */
  getCapabilities(rulesetName: string = 'classic'): string[] {
    const ruleset = this.loadGameRulesRuleset(rulesetName);
    return ruleset.capabilities;
  }

  /**
   * Load effects ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadEffectsRuleset(rulesetName: string = 'classic'): EffectsRulesetFile {
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
  getEffects(rulesetName: string = 'classic'): Record<string, Effect> {
    const ruleset = this.loadEffectsRuleset(rulesetName);
    return ruleset.effects;
  }

  /**
   * Get a specific effect from a ruleset
   */
  getEffect(effectId: string, rulesetName: string = 'classic'): Effect {
    const effects = this.getEffects(rulesetName);
    const effect = effects[effectId];

    if (!effect) {
      throw new Error(`Effect '${effectId}' not found in ruleset '${rulesetName}'`);
    }

    return effect;
  }

  /**
   * Load nations ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadNationsRuleset(rulesetName: string = 'classic'): NationsRulesetFile {
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
  getNations(rulesetName: string = 'classic'): Record<string, NationRuleset> {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.nations;
  }

  /**
   * Get a specific nation from a ruleset
   */
  getNation(nationId: string, rulesetName: string = 'classic'): NationRuleset {
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
  getDefaultTraits(rulesetName: string = 'classic'): TraitRange {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.default_traits;
  }

  /**
   * Get nations compatibility settings from a ruleset
   */
  getNationsCompatibility(rulesetName: string = 'classic'): NationsCompatibility {
    const ruleset = this.loadNationsRuleset(rulesetName);
    return ruleset.compatibility;
  }

  /**
   * Utility method to evaluate requirements against a context
   * This is the core requirements system implementation
   */
  evaluateRequirements(
    requirements: Requirement[],
    context: {
      player?: any;
      city?: any;
      unit?: any;
      tile?: any;
      [key: string]: any;
    }
  ): boolean {
    if (!requirements || requirements.length === 0) {
      return true; // No requirements means always satisfied
    }

    // All requirements must be satisfied (AND logic)
    return requirements.every(req => this.evaluateRequirement(req, context));
  }

  /**
   * Evaluate a single requirement against a context
   */
  private evaluateRequirement(requirement: Requirement, context: any): boolean {
    const { type, name, present = true } = requirement;
    const satisfied = this.evaluateByType(type, name, context);
    return present ? satisfied : !satisfied;
  }

  private evaluateByType(type: string, name: string, context: any): boolean {
    const evaluators = this.getRequirementEvaluators();
    const fn = evaluators[type];
    if (!fn) {
      // Use central logger instead of console to satisfy lint rules
      logger.warn(`Unknown requirement type: ${type}`);
      return false;
    }
    return fn(name, context);
  }

  private getRequirementEvaluators(): Record<string, (name: string, context: any) => boolean> {
    return {
      Tech: (n, ctx) => ctx.player?.technologies?.includes(n) ?? false,
      Government: (n, ctx) => ctx.player?.government === n,
      Building: (n, ctx) => ctx.city?.buildings?.includes(n) ?? false,
      UnitType: (n, ctx) => ctx.unit?.type === n,
      UnitClass: (n, ctx) => ctx.unit?.unitClass === n,
      Terrain: (n, ctx) => ctx.tile?.terrain === n,
      TerrainClass: (_n, _ctx) => false, // Placeholder until class mapping exists
      NationGroup: (n, ctx) => ctx.player?.nationGroups?.includes(n) ?? false,
      Age: (n, ctx) => (ctx.unit?.age ?? 0) >= parseInt(n),
      Activity: (n, ctx) => ctx.unit?.activity === n,
      CityTile: (n, ctx) => (n === 'Center' ? (ctx.tile?.isCity ?? false) : false),
      Extra: (n, ctx) => ctx.tile?.extras?.includes(n) ?? false,
      UnitClassFlag: (n, ctx) => ctx.unit?.classFlags?.includes(n) ?? false,
      UnitTypeFlag: (n, ctx) => ctx.unit?.typeFlags?.includes(n) ?? false,
      Specialist: (n, ctx) => (ctx.city?.specialists?.[n] ?? 0) > 0,
      OutputType: (_n, _ctx) => true, // Placeholder - context dependent
      MaxUnitsOnTile: (n, ctx) => (ctx.tile?.unitCount ?? 0) <= parseInt(n),
    };
  }

  /**
   * Load cities ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadCitiesRuleset(rulesetName: string = 'classic'): CitiesRulesetFile {
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
  getCityStyles(rulesetName: string = 'classic'): Record<string, CityStyle> {
    const ruleset = this.loadCitiesRuleset(rulesetName);
    return ruleset.city_styles;
  }

  /**
   * Get a specific city style from a ruleset
   */
  getCityStyle(styleId: string, rulesetName: string = 'classic'): CityStyle {
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
  getCityFoundingRules(rulesetName: string = 'classic'): CityFoundingRules {
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
  }
}

// Export singleton instance for easy access
export const rulesetLoader = RulesetLoader.getInstance();
