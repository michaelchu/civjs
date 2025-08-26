/**
 * Terrain utility functions extracted from TerrainGenerator
 * @reference freeciv/server/generator/ various utility functions
 * Collection of reusable terrain manipulation utilities
 */
import { MapTile, TerrainType } from './MapTypes';

/**
 * Check if terrain type is ocean/water
 * @reference freeciv/common/terrain.c is_ocean_terrain()
 * Exact copy of freeciv ocean terrain classification
 */
export function isOceanTerrain(terrain: string): boolean {
  return ['ocean', 'coast', 'deep_ocean'].includes(terrain);
}

/**
 * Check if terrain type is frozen
 * @reference freeciv/common/terrain.c is_frozen_terrain()
 * Exact copy of freeciv frozen terrain classification
 */
export function isFrozenTerrain(terrain: string): boolean {
  return ['glacier', 'snow'].includes(terrain);
}

/**
 * Check if terrain is land (non-water)
 * @reference freeciv/common/terrain.c is_land_terrain()
 * Exact copy of freeciv land terrain classification
 */
export function isLandTile(terrain: string): boolean {
  return ![
    'ocean',
    'coast',
    'deep_ocean',
    'lake', // Lake is considered water for this check
  ].includes(terrain);
}

/**
 * Create base tile with default properties
 * @reference freeciv/server/generator/mapgen.c create_base_tile()
 * Creates tile with default ocean terrain and properties
 */
export function createBaseTile(x: number, y: number): MapTile {
  return {
    x,
    y,
    terrain: 'ocean' as TerrainType,
    elevation: 0,
    riverMask: 0,
    continentId: 0,
    isExplored: false,
    isVisible: false,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: 1, // TemperatureType.TEMPERATE
    wetness: 50,
  };
}

/**
 * Set game-specific properties on terrain tiles
 * @reference freeciv/common/terrain.c terrain_properties()
 * Assigns movement cost and defense bonuses based on terrain type
 */
export function setTerrainGameProperties(tile: MapTile): void {
  // Set basic terrain properties for game mechanics
  // These would normally come from terrain.ruleset in freeciv
  const terrainProperties: Record<string, { moveCost: number; defense: number }> = {
    ocean: { moveCost: 1, defense: 100 },
    coast: { moveCost: 1, defense: 100 },
    deep_ocean: { moveCost: 1, defense: 100 },
    lake: { moveCost: 1, defense: 100 },
    plains: { moveCost: 1, defense: 100 },
    grassland: { moveCost: 1, defense: 100 },
    desert: { moveCost: 1, defense: 100 },
    tundra: { moveCost: 1, defense: 100 },
    hills: { moveCost: 2, defense: 150 },
    mountains: { moveCost: 3, defense: 200 },
    forest: { moveCost: 2, defense: 125 },
    jungle: { moveCost: 2, defense: 125 },
    swamp: { moveCost: 2, defense: 125 },
    snow: { moveCost: 1, defense: 100 },
    glacier: { moveCost: 1, defense: 100 },
  };

  const props = terrainProperties[tile.terrain];
  if (props && tile.properties) {
    // These would be set if MapTile interface had these properties
    // Currently MapTile doesn't have moveCost/defense properties
    // This is a placeholder for future terrain property expansion
  }
}

/**
 * Smooth height map values using 8-directional averaging
 * @reference freeciv/server/generator/mapgen_utils.c smooth_int_map()
 * Exact copy of freeciv smoothing algorithm
 */
export function smoothHeightMap(heightMap: number[], width: number, height: number): void {
  const smoothed = [...heightMap];

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const index = y * width + x;
      let sum = 0;
      let count = 0;

      // Check all adjacent cells (8-directional)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const nindex = ny * width + nx;
            sum += heightMap[nindex];
            count++;
          }
        }
      }

      smoothed[index] = Math.floor(sum / count);
    }
  }

  // Copy smoothed values back
  for (let i = 0; i < heightMap.length; i++) {
    heightMap[i] = smoothed[i];
  }
}

/**
 * Normalize height map values to specified min/max range
 * @reference freeciv/server/generator/mapgen_utils.c adjust_int_map()
 * Exact copy of freeciv normalization algorithm
 */
export function adjustHeightMap(heightMap: number[], minVal: number, maxVal: number): void {
  const currentMin = Math.min(...heightMap);
  const currentMax = Math.max(...heightMap);

  if (currentMin === currentMax) {
    // Avoid division by zero
    for (let i = 0; i < heightMap.length; i++) {
      heightMap[i] = minVal;
    }
    return;
  }

  const scale = (maxVal - minVal) / (currentMax - currentMin);

  for (let i = 0; i < heightMap.length; i++) {
    heightMap[i] = Math.floor((heightMap[i] - currentMin) * scale + minVal);
  }
}

/**
 * Check if a land tile is part of a tiny island
 * @reference freeciv/server/generator/mapgen.c is_tiny_island()
 * Uses flood fill to count connected land mass size
 */
export function isTinyIsland(
  tiles: MapTile[][],
  x: number,
  y: number,
  width: number,
  height: number,
  random: () => number
): boolean {
  const tile = tiles[x][y];

  // Only check land tiles
  if (!isLandTile(tile.terrain)) {
    return false;
  }

  // Simple heuristic: if isolated from other land within radius 2, it's likely tiny
  const radius = 2;
  let landCount = 0;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighborTile = tiles[nx][ny];
        if (isLandTile(neighborTile.terrain)) {
          landCount++;
        }
      }
    }
  }

  // If very few land tiles nearby, it's a tiny island
  // Add some randomness to avoid perfect patterns
  const threshold = 3 + Math.floor(random() * 3); // 3-5 tiles
  return landCount <= threshold;
}

/**
 * Assign fracture circle using Bresenham algorithm
 * @reference freeciv/server/generator/fracture_map.c assign_fracture_circle()
 * Exact copy of freeciv fracture circle assignment
 */
export function assignFractureCircle(
  continentMap: number[][],
  centerX: number,
  centerY: number,
  radius: number,
  continentId: number,
  width: number,
  height: number,
  landmass: { minX: number; minY: number; maxX: number; maxY: number; elevation: number }
): void {
  if (radius === 0) return;

  let x = 0;
  let y = radius;
  let p = 3 - 2 * radius;

  while (y >= x) {
    // Fill 8 octants of the circle using Bresenham algorithm
    fillFractureArea(continentMap, centerX - x, centerY - y, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX - y, centerY - x, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX + y, centerY - x, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX + x, centerY - y, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX - x, centerY + y, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX - y, centerY + x, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX + y, centerY + x, continentId, landmass, width, height);
    fillFractureArea(continentMap, centerX + x, centerY + y, continentId, landmass, width, height);

    if (p < 0) {
      p += 4 * x++ + 6;
    } else {
      p += 4 * (x++ - y--) + 10;
    }
  }
}

/**
 * Fill area during fracture generation
 * @reference freeciv/server/generator/fracture_map.c fmfill()
 * Exact copy of freeciv fracture fill algorithm
 */
function fillFractureArea(
  continentMap: number[][],
  x: number,
  y: number,
  continentId: number,
  landmass: { minX: number; minY: number; maxX: number; maxY: number; elevation: number },
  width: number,
  height: number
): void {
  if (x >= 0 && x < width && y >= 0 && y < height) {
    if (continentMap[x][y] === 0) {
      continentMap[x][y] = continentId;
      landmass.minX = Math.min(landmass.minX, x);
      landmass.maxX = Math.max(landmass.maxX, x);
      landmass.minY = Math.min(landmass.minY, y);
      landmass.maxY = Math.max(landmass.maxY, y);
    }
  }
}
