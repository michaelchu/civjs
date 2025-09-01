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
  NationsRulesetFileSchema,
  type NationsRulesetFile,
  type NationRuleset,
  GameRulesetFileSchema,
  type GameRulesetFile,
  EffectsRulesetFileSchema,
  type EffectsRulesetFile,
  type Effect,
  type Requirement
} from './schemas';

export class RulesetLoader {
  private static instance: RulesetLoader;
  private terrainCache = new Map<string, TerrainRulesetFile>();
  private buildingsCache = new Map<string, BuildingsRulesetFile>();
  private techsCache = new Map<string, TechsRulesetFile>();
  private unitsCache = new Map<string, UnitsRulesetFile>();
  private governmentsCache = new Map<string, GovernmentsRulesetFile>();
  private nationsCache = new Map<string, NationsRulesetFile>();
  private gameRulesCache = new Map<string, GameRulesetFile>();
  private effectsCache = new Map<string, EffectsRulesetFile>();
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

    // Find the total weight - exact copy of freeciv logic
    for (const [terrainName, ruleset] of Object.entries(terrains)) {
      if (ruleset.notGenerated) continue; // Skip TER_NOT_GENERATED terrains

      // Check avoid condition
      if (avoid !== 'MG_UNUSED' && (ruleset.properties?.[avoid] ?? 0) > 0) {
        continue;
      }

      // Check prefer condition
      if (prefer !== 'MG_UNUSED' && (ruleset.properties?.[prefer] ?? 0) === 0) {
        continue;
      }

      // Calculate weight
      let weight: number;
      if (target !== 'MG_UNUSED') {
        weight = ruleset.properties?.[target] ?? 0;
      } else {
        weight = 1;
      }

      if (weight > 0) {
        sum += weight;
        validTerrains.push({ terrain: terrainName as TerrainType, weight });
      }
    }

    // If no valid terrains found, drop requirements and try again
    if (sum === 0) {
      if (prefer !== 'MG_UNUSED') {
        // Drop prefer requirement
        return this.pickTerrain(target, 'MG_UNUSED', avoid, random, rulesetName);
      } else if (avoid !== 'MG_UNUSED') {
        // Drop avoid requirement
        return this.pickTerrain(target, prefer, 'MG_UNUSED', random, rulesetName);
      } else {
        // Drop target requirement
        return this.pickTerrain('MG_UNUSED', prefer, avoid, random, rulesetName);
      }
    }

    // Now pick - exact copy of freeciv selection
    let pick = Math.floor(random() * sum);
    for (const { terrain, weight } of validTerrains) {
      if (pick < weight) {
        return terrain;
      }
      pick -= weight;
    }

    // Fallback (should never reach here)
    return 'grassland';
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
    if (this.governmentsCache.has(rulesetName)) {
      return this.governmentsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'governments.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = GovernmentsRulesetFileSchema.parse(rawData);
      
      // Cache the validated data
      this.governmentsCache.set(rulesetName, validatedData);
      
      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load governments ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load governments ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all government definitions for a ruleset
   */
  getGovernments(rulesetName: string = 'classic'): Record<string, GovernmentRuleset> {
    const rulesetFile = this.loadGovernmentsRuleset(rulesetName);
    return rulesetFile.governments.types;
  }

  /**
   * Get a specific government definition
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
   * Get the revolution government name
   */
  getRevolutionGovernment(rulesetName: string = 'classic'): string {
    const rulesetFile = this.loadGovernmentsRuleset(rulesetName);
    return rulesetFile.governments.during_revolution;
  }

  /**
   * Load nations ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadNationsRuleset(rulesetName: string = 'classic'): NationsRulesetFile {
    // Check cache first
    if (this.nationsCache.has(rulesetName)) {
      return this.nationsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'nations.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = NationsRulesetFileSchema.parse(rawData);
      
      // Cache the validated data
      this.nationsCache.set(rulesetName, validatedData);
      
      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load nations ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load nations ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all nation definitions for a ruleset
   */
  getNations(rulesetName: string = 'classic'): Record<string, NationRuleset> {
    const rulesetFile = this.loadNationsRuleset(rulesetName);
    return rulesetFile.nations;
  }

  /**
   * Get a specific nation definition
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
   * Get default government for nations
   */
  getDefaultGovernment(rulesetName: string = 'classic'): string {
    const rulesetFile = this.loadNationsRuleset(rulesetName);
    return rulesetFile.compatibility.default_government;
  }

  /**
   * Load game rules ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadGameRulesRuleset(rulesetName: string = 'classic'): GameRulesetFile {
    // Check cache first
    if (this.gameRulesCache.has(rulesetName)) {
      return this.gameRulesCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'game.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = GameRulesetFileSchema.parse(rawData);
      
      // Cache the validated data
      this.gameRulesCache.set(rulesetName, validatedData);
      
      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load game rules ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load game rules ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get game civstyle configuration
   */
  getCivStyle(rulesetName: string = 'classic') {
    const rulesetFile = this.loadGameRulesRuleset(rulesetName);
    return rulesetFile.civstyle;
  }

  /**
   * Get global initialization options
   */
  getGlobalInitOptions(rulesetName: string = 'classic') {
    const rulesetFile = this.loadGameRulesRuleset(rulesetName);
    return rulesetFile.options;
  }

  /**
   * Load effects ruleset for a specific ruleset variant (e.g., 'classic', 'civ2')
   */
  loadEffectsRuleset(rulesetName: string = 'classic'): EffectsRulesetFile {
    // Check cache first
    if (this.effectsCache.has(rulesetName)) {
      return this.effectsCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'effects.json');
      const fileContent = readFileSync(filePath, 'utf-8');
      const rawData = JSON.parse(fileContent);

      // Validate with Zod schema
      const validatedData = EffectsRulesetFileSchema.parse(rawData);
      
      // Cache the validated data
      this.effectsCache.set(rulesetName, validatedData);
      
      return validatedData;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to load effects ruleset '${rulesetName}': ${error.message}`);
      }
      throw new Error(`Failed to load effects ruleset '${rulesetName}': Unknown error`);
    }
  }

  /**
   * Get all effect definitions for a ruleset
   */
  getEffects(rulesetName: string = 'classic'): Record<string, Effect> {
    const rulesetFile = this.loadEffectsRuleset(rulesetName);
    return rulesetFile.effects;
  }

  /**
   * Get a specific effect definition
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
   * Check if requirements are met (basic implementation)
   * @reference reference/freeciv/common/requirements.c
   */
  checkRequirements(requirements: Requirement[], context: any = {}): boolean {
    if (!requirements || requirements.length === 0) {
      return true;
    }

    return requirements.every(req => {
      // Basic requirement checking - can be extended
      switch (req.type) {
        case 'Tech':
          return context.techs?.includes(req.name) ?? false;
        case 'Building':
          return context.buildings?.includes(req.name) ?? false;
        case 'Government':
          return context.government === req.name;
        case 'Nation':
          return context.nation === req.name;
        default:
          // Unknown requirement types default to true for now
          return true;
      }
    });
  }

  /**
   * Get effects that match specific requirements
   */
  getActiveEffects(rulesetName: string = 'classic', context: any = {}): Effect[] {
    const effects = this.getEffects(rulesetName);
    
    return Object.values(effects).filter(effect => {
      return this.checkRequirements(effect.reqs || [], context);
    });
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
    this.nationsCache.clear();
    this.gameRulesCache.clear();
    this.effectsCache.clear();
  }
}

// Export singleton instance for easy access
export const rulesetLoader = RulesetLoader.getInstance();