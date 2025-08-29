/**
 * Terrain ruleset configuration for CivJS
 * @reference freeciv/data/classic/terrain.ruleset
 * @reference freeciv/common/terrain.h:136-147
 *
 * This file defines the properties for each terrain type following
 * freeciv's terrain property system.
 *
 * Property definitions:
 * MG_COLD: Cold climate terrains
 * MG_DRY: Dry/arid terrains
 * MG_FOLIAGE: Terrains with vegetation
 * MG_FROZEN: Frozen/ice terrains
 * MG_GREEN: Green/fertile terrains
 * MG_MOUNTAINOUS: High elevation terrains
 * MG_OCEAN_DEPTH: Ocean depth (0-100)
 * MG_TEMPERATE: Temperate climate terrains
 * MG_TROPICAL: Tropical climate terrains
 * MG_WET: Wet/humid terrains
 */

import { TerrainType } from './MapTypes';

export enum MapgenTerrainProperty {
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

export interface TerrainRuleset {
  name: TerrainType;
  properties: Partial<Record<MapgenTerrainProperty, number>>;
  moveCost: number;
  defense: number;
  food: number;
  shields: number;
  trade: number;
  transformTo?: TerrainType;
  transformTime?: number;
  canHaveRiver?: boolean;
  notGenerated?: boolean; // TER_NOT_GENERATED flag
}

/**
 * Terrain configuration based on freeciv classic ruleset
 * @reference freeciv/data/classic/terrain.ruleset
 *
 * Values are taken directly from classic ruleset property definitions
 */
export const TERRAIN_RULESET: Record<TerrainType, TerrainRuleset> = {
  // Ocean terrains
  ocean: {
    name: 'ocean',
    properties: {
      [MapgenTerrainProperty.OCEAN_DEPTH]: 30,
    },
    moveCost: 1,
    defense: 10,
    food: 1,
    shields: 0,
    trade: 2,
  },
  deep_ocean: {
    name: 'deep_ocean',
    properties: {
      [MapgenTerrainProperty.OCEAN_DEPTH]: 80,
    },
    moveCost: 1,
    defense: 10,
    food: 1,
    shields: 0,
    trade: 2,
  },
  coast: {
    name: 'coast',
    properties: {
      [MapgenTerrainProperty.OCEAN_DEPTH]: 10,
    },
    moveCost: 1,
    defense: 10,
    food: 1,
    shields: 0,
    trade: 2,
  },
  lake: {
    name: 'lake',
    properties: {
      [MapgenTerrainProperty.OCEAN_DEPTH]: 5,
    },
    moveCost: 1,
    defense: 10,
    food: 2,
    shields: 0,
    trade: 2,
    notGenerated: true, // Lakes are created by special processes
  },

  // Arctic terrains
  tundra: {
    name: 'tundra',
    properties: {
      [MapgenTerrainProperty.COLD]: 50,
      [MapgenTerrainProperty.FROZEN]: 100, // Added for pickTerrain(FROZEN) calls
      // @reference freeciv/data/classic/terrain.ruleset:871
    },
    moveCost: 1,
    defense: 10,
    food: 1,
    shields: 0,
    trade: 0,
    transformTo: 'desert',
    transformTime: 24,
    canHaveRiver: true,
  },

  // Desert terrains
  desert: {
    name: 'desert',
    properties: {
      [MapgenTerrainProperty.DRY]: 100,
      [MapgenTerrainProperty.TROPICAL]: 50,
      [MapgenTerrainProperty.TEMPERATE]: 20,
      // @reference freeciv/data/classic/terrain.ruleset:509-510
    },
    moveCost: 1,
    defense: 10,
    food: 0,
    shields: 1,
    trade: 0,
    transformTo: 'plains',
    transformTime: 24,
    canHaveRiver: true,
  },

  // Forest terrains
  forest: {
    name: 'forest',
    properties: {
      [MapgenTerrainProperty.FOLIAGE]: 50,
      [MapgenTerrainProperty.TEMPERATE]: 50,
      [MapgenTerrainProperty.WET]: 20,
      [MapgenTerrainProperty.COLD]: 20,
      // @reference freeciv/data/classic/terrain.ruleset:563-566
    },
    moveCost: 2,
    defense: 15,
    food: 1,
    shields: 2,
    trade: 0,
    transformTo: 'plains',
    transformTime: 24,
    canHaveRiver: true,
  },
  jungle: {
    name: 'jungle',
    properties: {
      [MapgenTerrainProperty.FOLIAGE]: 50,
      [MapgenTerrainProperty.TROPICAL]: 50,
      [MapgenTerrainProperty.WET]: 50,
      // @reference freeciv/data/classic/terrain.ruleset:719-722
    },
    moveCost: 2,
    defense: 15,
    food: 1,
    shields: 0,
    trade: 0,
    transformTo: 'forest',
    transformTime: 24,
    canHaveRiver: true,
  },
  swamp: {
    name: 'swamp',
    properties: {
      [MapgenTerrainProperty.WET]: 100,
      // @reference freeciv/data/classic/terrain.ruleset:876
    },
    moveCost: 2,
    defense: 15,
    food: 1,
    shields: 0,
    trade: 0,
    transformTo: 'grassland',
    transformTime: 24,
    canHaveRiver: true,
  },

  // Plain terrains
  grassland: {
    name: 'grassland',
    properties: {
      [MapgenTerrainProperty.GREEN]: 50,
      [MapgenTerrainProperty.TEMPERATE]: 50,
      // @reference freeciv/data/classic/terrain.ruleset:617-618
    },
    moveCost: 1,
    defense: 10,
    food: 2,
    shields: 0,
    trade: 0,
    transformTo: 'forest',
    transformTime: 24,
    canHaveRiver: true,
  },
  plains: {
    name: 'plains',
    properties: {
      [MapgenTerrainProperty.GREEN]: 50,
      [MapgenTerrainProperty.TEMPERATE]: 50,
      // @reference freeciv/data/classic/terrain.ruleset:824-825
    },
    moveCost: 1,
    defense: 10,
    food: 1,
    shields: 1,
    trade: 0,
    transformTo: 'forest',
    transformTime: 24,
    canHaveRiver: true,
  },

  // Mountain terrains
  hills: {
    name: 'hills',
    properties: {
      [MapgenTerrainProperty.MOUNTAINOUS]: 30,
      [MapgenTerrainProperty.GREEN]: 50,
      // @reference freeciv/data/classic/terrain.ruleset:668-669
    },
    moveCost: 2,
    defense: 20,
    food: 1,
    shields: 2,
    trade: 0,
    transformTo: 'plains',
    transformTime: 24,
    canHaveRiver: true,
  },
  mountains: {
    name: 'mountains',
    properties: {
      [MapgenTerrainProperty.MOUNTAINOUS]: 70,
      // @reference freeciv/data/classic/terrain.ruleset:773
    },
    moveCost: 3,
    defense: 30,
    food: 0,
    shields: 1,
    trade: 0,
    transformTo: 'hills',
    transformTime: 24,
    canHaveRiver: true,
  },
};

/**
 * Pick a terrain based on weighted selection using terrain properties
 * @reference freeciv/server/generator/mapgen_utils.c:692-761 pick_terrain()
 *
 * This is an exact port of freeciv's pick_terrain function
 */
export function pickTerrain(
  target: MapgenTerrainProperty,
  prefer: MapgenTerrainProperty,
  avoid: MapgenTerrainProperty,
  random: () => number
): TerrainType {
  let sum = 0;
  const validTerrains: Array<{ terrain: TerrainType; weight: number }> = [];

  // Find the total weight - exact copy of freeciv logic
  for (const [terrainName, ruleset] of Object.entries(TERRAIN_RULESET)) {
    if (ruleset.notGenerated) continue; // Skip TER_NOT_GENERATED terrains

    // Check avoid condition
    if (avoid !== MapgenTerrainProperty.UNUSED && (ruleset.properties[avoid] ?? 0) > 0) {
      continue;
    }

    // Check prefer condition
    if (prefer !== MapgenTerrainProperty.UNUSED && (ruleset.properties[prefer] ?? 0) === 0) {
      continue;
    }

    // Calculate weight
    let weight: number;
    if (target !== MapgenTerrainProperty.UNUSED) {
      weight = ruleset.properties[target] ?? 0;
    } else {
      weight = 1;
    }

    if (weight > 0) {
      sum += weight;
      validTerrains.push({ terrain: terrainName as TerrainType, weight });
    }
  }

  // If no valid terrains found, drop requirements and try again
  // @reference freeciv/server/generator/mapgen_utils.c:743-760
  if (sum === 0) {
    if (prefer !== MapgenTerrainProperty.UNUSED) {
      // Drop prefer requirement
      return pickTerrain(target, MapgenTerrainProperty.UNUSED, avoid, random);
    } else if (avoid !== MapgenTerrainProperty.UNUSED) {
      // Drop avoid requirement
      return pickTerrain(target, prefer, MapgenTerrainProperty.UNUSED, random);
    } else {
      // Drop target requirement
      return pickTerrain(MapgenTerrainProperty.UNUSED, prefer, avoid, random);
    }
  }

  // Now pick - exact copy of freeciv selection
  // @reference freeciv/server/generator/mapgen_utils.c:717-741
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
  return TERRAIN_RULESET[terrain]?.properties ?? {};
}

/**
 * Check if a terrain has a specific property
 */
export function terrainHasProperty(terrain: TerrainType, property: MapgenTerrainProperty): boolean {
  const value = TERRAIN_RULESET[terrain]?.properties[property] ?? 0;
  return value > 0;
}

/**
 * Get terrain transform result
 */
export function getTerrainTransform(terrain: TerrainType): TerrainType | undefined {
  return TERRAIN_RULESET[terrain]?.transformTo;
}
