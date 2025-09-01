/**
 * Ruleset loader service for loading and validating JSON-based rulesets
 * Provides type-safe, validated access to ruleset data with async loading
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { TerrainRulesetFileSchema, type TerrainRulesetFile, type TerrainRuleset, type TerrainType, type MapgenTerrainProperty } from './schemas';

export class RulesetLoader {
  private static instance: RulesetLoader;
  private terrainCache = new Map<string, TerrainRulesetFile>();
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
  async loadTerrainRuleset(rulesetName: string = 'classic'): Promise<TerrainRulesetFile> {
    // Check cache first
    if (this.terrainCache.has(rulesetName)) {
      return this.terrainCache.get(rulesetName)!;
    }

    try {
      const filePath = join(this.baseDir, rulesetName, 'terrain.json');
      const fileContent = await fs.readFile(filePath, 'utf-8');
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
  async getTerrains(rulesetName: string = 'classic'): Promise<Record<TerrainType, TerrainRuleset>> {
    const rulesetFile = await this.loadTerrainRuleset(rulesetName);
    return rulesetFile.terrains;
  }

  /**
   * Get a specific terrain definition
   */
  async getTerrain(terrainType: TerrainType, rulesetName: string = 'classic'): Promise<TerrainRuleset> {
    const terrains = await this.getTerrains(rulesetName);
    const terrain = terrains[terrainType];
    
    if (!terrain) {
      throw new Error(`Terrain type '${terrainType}' not found in ruleset '${rulesetName}'`);
    }
    
    return terrain;
  }

  /**
   * Pick terrain based on weighted selection - async version of original function
   * @reference apps/server/src/game/map/TerrainRuleset.ts:269-333
   */
  async pickTerrain(
    target: MapgenTerrainProperty,
    prefer: MapgenTerrainProperty,
    avoid: MapgenTerrainProperty,
    random: () => number,
    rulesetName: string = 'classic'
  ): Promise<TerrainType> {
    const terrains = await this.getTerrains(rulesetName);
    
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
  async getTerrainProperties(
    terrainType: TerrainType, 
    rulesetName: string = 'classic'
  ): Promise<Partial<Record<MapgenTerrainProperty, number>>> {
    const terrain = await this.getTerrain(terrainType, rulesetName);
    return terrain.properties ?? {};
  }

  /**
   * Check if a terrain has a specific property
   */
  async terrainHasProperty(
    terrainType: TerrainType, 
    property: MapgenTerrainProperty,
    rulesetName: string = 'classic'
  ): Promise<boolean> {
    const properties = await this.getTerrainProperties(terrainType, rulesetName);
    const value = properties[property] ?? 0;
    return value > 0;
  }

  /**
   * Get terrain transform result
   */
  async getTerrainTransform(
    terrainType: TerrainType,
    rulesetName: string = 'classic'
  ): Promise<TerrainType | undefined> {
    const terrain = await this.getTerrain(terrainType, rulesetName);
    return terrain.transformTo;
  }

  /**
   * Clear all cached rulesets (useful for testing)
   */
  clearCache(): void {
    this.terrainCache.clear();
  }
}

// Export singleton instance for easy access
export const rulesetLoader = RulesetLoader.getInstance();