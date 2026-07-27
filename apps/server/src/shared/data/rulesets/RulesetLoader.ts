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
  StylesRulesetFileSchema,
  type StylesRulesetFile,
  type RulesetCityStyle,
} from './schemas';

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
   * Resolve `options.global_init_buildings` to canonical building ids.
   *
   * Freeciv parses this option into improvement ids while loading the ruleset
   * and refuses to load when a configured rule name matches no improvement, so
   * an unknown name is an error here rather than a silently skipped entry.
   * @reference reference/freeciv/server/ruleset/ruleload.c:1005-1049 lookup_building_list()
   * @reference reference/freeciv/server/ruleset/ruleload.c:6811-6816
   * @reference reference/freeciv/data/classic/game.ruleset:60-62
   */
  getGlobalInitBuildings(rulesetName: string = 'classic'): string[] {
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

  loadActionsRuleset(rulesetName: string = 'classic'): ActionsRulesetFile {
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

  getActionEnablers(rulesetName: string = 'classic'): ActionEnabler[] {
    return this.loadActionsRuleset(rulesetName).enablers;
  }

  getActionEnablersFor(action: string, rulesetName: string = 'classic'): ActionEnabler[] {
    const normalizedAction = this.normalizeRuleName(action);
    return this.getActionEnablers(rulesetName).filter(
      enabler => this.normalizeRuleName(enabler.action) === normalizedAction
    );
  }

  loadExtrasRuleset(rulesetName: string = 'classic'): ExtrasRulesetFile {
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

  getExtras(rulesetName: string = 'classic'): Record<string, ExtraRuleset> {
    return this.loadExtrasRuleset(rulesetName).extras;
  }

  getExtra(extraIdOrName: string, rulesetName: string = 'classic'): ExtraRuleset {
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
    rulesetName: string = 'classic'
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

  loadStylesRuleset(rulesetName: string = 'classic'): StylesRulesetFile {
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

  getRulesetCityStyles(rulesetName: string = 'classic'): Record<string, RulesetCityStyle> {
    return this.loadStylesRuleset(rulesetName).city_styles;
  }

  /**
   * Load every ruleset file and reject unresolved cross-file references.
   * Freeciv resolves named universals while loading rulesets and treats an
   * unknown rule name as a ruleset error.
   * @reference reference/freeciv/common/requirements.c:1108-1120
   */
  validateRuleset(rulesetName: string = 'classic'): void {
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

    for (const [unitId, unit] of Object.entries(units)) {
      if (!(unit.unit_class in unitClasses)) {
        errors.push(`Unit '${unitId}' unit class '${unit.unit_class}' does not exist`);
      }

      // CivJS ships Fanatics as a compatibility extension, while classic
      // explicitly omits Fundamentalism. Keep that one extension inert rather
      // than inventing a technology or government during validation work.
      // @reference reference/freeciv/data/classic/governments.ruleset:14-14
      // @reference reference/freeciv/data/classic/units.ruleset:344-345
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

    if (errors.length > 0) {
      throw new Error(`Ruleset '${rulesetName}' has invalid references:\n${errors.join('\n')}`);
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
    this.actionsCache.clear();
    this.extrasCache.clear();
    this.stylesCache.clear();
  }
}

// Export singleton instance for easy access
export const rulesetLoader = RulesetLoader.getInstance();
