/**
 * Terrain ruleset configuration for CivJS
 * @reference freeciv/data/classic/terrain.ruleset
 * @reference freeciv/common/terrain.h:136-147
 *
 * This file provides direct access to JSON-based rulesets with synchronous API.
 * Terrain data is loaded from src/shared/data/rulesets/classic/terrain.json
 */

import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import type {
  MapgenTerrainProperty,
  TerrainType,
  TerrainRuleset,
} from '@shared/data/rulesets/schemas';

// Re-export types for backward compatibility
export { MapgenTerrainProperty, TerrainType, TerrainRuleset };

// Legacy enum for backward compatibility with existing code
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
 * Pick terrain based on weighted selection - synchronous API
 * @reference freeciv/server/generator/mapgen_utils.c:692-761 pick_terrain()
 */
export function pickTerrain(
  target: MapgenTerrainProperty,
  prefer: MapgenTerrainProperty,
  avoid: MapgenTerrainProperty,
  random: () => number,
  rulesetName: string = DEFAULT_RULESET
): TerrainType {
  return rulesetLoader.pickTerrain(target, prefer, avoid, random, rulesetName);
}

/**
 * Get terrain properties for a given terrain type
 */
export function getTerrainProperties(
  terrain: TerrainType,
  rulesetName: string = DEFAULT_RULESET
): Partial<Record<MapgenTerrainProperty, number>> {
  return rulesetLoader.getTerrainProperties(terrain, rulesetName);
}

/**
 * Check if a terrain has a specific property
 */
export function terrainHasProperty(
  terrain: TerrainType,
  property: MapgenTerrainProperty,
  rulesetName: string = DEFAULT_RULESET
): boolean {
  return rulesetLoader.terrainHasProperty(terrain, property, rulesetName);
}

/**
 * Get terrain transform result
 */
export function getTerrainTransform(
  terrain: TerrainType,
  rulesetName: string = DEFAULT_RULESET
): TerrainType | undefined {
  return rulesetLoader.getTerrainTransform(terrain, rulesetName);
}

// Re-export the rulesetLoader instance for direct access to all rulesets
export { rulesetLoader };
