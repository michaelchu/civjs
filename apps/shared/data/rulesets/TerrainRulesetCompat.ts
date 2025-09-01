/**
 * Backward compatibility wrapper for TerrainRuleset
 * Provides the same synchronous API as the original TerrainRuleset.ts
 * while using the new JSON-based ruleset system underneath
 */

import { rulesetLoader } from './RulesetLoader';
import type { TerrainType, MapgenTerrainProperty, TerrainRuleset } from './schemas';

// Re-export types for compatibility
export { MapgenTerrainProperty, TerrainType, TerrainRuleset };

// Legacy enum for backward compatibility
export enum MapgenTerrainPropertyEnum {
  COLD = 'MG_COLD',
  DRY = 'MG_DRY',
  FOLIAGE = 'MG_FOLIAGE',
  FROZEN = 'MG_FROZEN',
  GREEN = 'MG_GREEN',
  MOUNTAINOUS = 'MG_MOUNTAINOUS',
  OCEAN_DEPTH = 'MG_OCEAN_DEPTH',
  TEMPERATE = 'MG_TEMPERATE',
  TROPICAL = 'MG_TROPICAL',
  WET = 'MG_WET',
  UNUSED = 'MG_UNUSED',
}

/**
 * Runtime terrain ruleset cache - loaded once at initialization
 * Provides synchronous access after async loading is complete
 */
class TerrainRulesetManager {
  private static instance: TerrainRulesetManager;
  private terrainRuleset: Record<TerrainType, TerrainRuleset> | null = null;
  private initPromise: Promise<void> | null = null;

  static getInstance(): TerrainRulesetManager {
    if (!TerrainRulesetManager.instance) {
      TerrainRulesetManager.instance = new TerrainRulesetManager();
    }
    return TerrainRulesetManager.instance;
  }

  /**
   * Initialize the terrain ruleset - must be called once at startup
   */
  async initialize(rulesetName: string = 'classic'): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInitialize(rulesetName);
    return this.initPromise;
  }

  private async _doInitialize(rulesetName: string): Promise<void> {
    try {
      this.terrainRuleset = await rulesetLoader.getTerrains(rulesetName);
    } catch (error) {
      throw new Error(`Failed to initialize terrain ruleset: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get the loaded terrain ruleset (synchronous access after initialization)
   */
  getTerrainRuleset(): Record<TerrainType, TerrainRuleset> {
    if (!this.terrainRuleset) {
      throw new Error('TerrainRuleset not initialized. Call initialize() first.');
    }
    return this.terrainRuleset;
  }

  /**
   * Check if the ruleset is initialized
   */
  isInitialized(): boolean {
    return this.terrainRuleset !== null;
  }

  /**
   * Clear the cache (useful for testing)
   */
  reset(): void {
    this.terrainRuleset = null;
    this.initPromise = null;
  }
}

const terrainManager = TerrainRulesetManager.getInstance();

/**
 * Initialize terrain ruleset - call this once at application startup
 */
export async function initializeTerrainRuleset(rulesetName: string = 'classic'): Promise<void> {
  return terrainManager.initialize(rulesetName);
}

/**
 * Get terrain ruleset (synchronous, backward-compatible API)
 * Must call initializeTerrainRuleset() first
 */
export function getTerrainRuleset(): Record<TerrainType, TerrainRuleset> {
  return terrainManager.getTerrainRuleset();
}

/**
 * Legacy TERRAIN_RULESET constant for backward compatibility
 * This will be populated after initialization
 */
export const TERRAIN_RULESET = new Proxy({} as Record<TerrainType, TerrainRuleset>, {
  get(_target, prop) {
    if (typeof prop === 'string') {
      const ruleset = terrainManager.getTerrainRuleset();
      return ruleset[prop as TerrainType];
    }
    return undefined;
  },
  ownKeys() {
    const ruleset = terrainManager.getTerrainRuleset();
    return Object.keys(ruleset);
  },
  has(_target, prop) {
    if (typeof prop === 'string') {
      const ruleset = terrainManager.getTerrainRuleset();
      return prop in ruleset;
    }
    return false;
  }
});

/**
 * Pick terrain based on weighted selection - backward-compatible synchronous API
 * @reference freeciv/server/generator/mapgen_utils.c:692-761 pick_terrain()
 */
export function pickTerrain(
  target: MapgenTerrainProperty,
  prefer: MapgenTerrainProperty,
  avoid: MapgenTerrainProperty,
  random: () => number
): TerrainType {
  const terrainRuleset = terrainManager.getTerrainRuleset();
  
  let sum = 0;
  const validTerrains: Array<{ terrain: TerrainType; weight: number }> = [];

  // Find the total weight - exact copy of freeciv logic
  for (const [terrainName, ruleset] of Object.entries(terrainRuleset)) {
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
      return pickTerrain(target, 'MG_UNUSED', avoid, random);
    } else if (avoid !== 'MG_UNUSED') {
      // Drop avoid requirement
      return pickTerrain(target, prefer, 'MG_UNUSED', random);
    } else {
      // Drop target requirement
      return pickTerrain('MG_UNUSED', prefer, avoid, random);
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
export function getTerrainProperties(
  terrain: TerrainType
): Partial<Record<MapgenTerrainProperty, number>> {
  const ruleset = terrainManager.getTerrainRuleset();
  return ruleset[terrain]?.properties ?? {};
}

/**
 * Check if a terrain has a specific property
 */
export function terrainHasProperty(terrain: TerrainType, property: MapgenTerrainProperty): boolean {
  const value = getTerrainProperties(terrain)[property] ?? 0;
  return value > 0;
}

/**
 * Get terrain transform result
 */
export function getTerrainTransform(terrain: TerrainType): TerrainType | undefined {
  const ruleset = terrainManager.getTerrainRuleset();
  return ruleset[terrain]?.transformTo;
}

/**
 * Utility function to check if ruleset is initialized
 */
export function isTerrainRulesetInitialized(): boolean {
  return terrainManager.isInitialized();
}

/**
 * Reset terrain ruleset (useful for testing)
 */
export function resetTerrainRuleset(): void {
  terrainManager.reset();
}