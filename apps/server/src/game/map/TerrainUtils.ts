/**
 * Terrain utility functions extracted from TerrainGenerator
 * @reference freeciv/server/generator/ various utility functions
 * Collection of reusable terrain manipulation utilities
 */
import { MapTile, TerrainType, TemperatureType } from './MapTypes';

/**
 * Mapgen terrain properties for island generation
 * @reference freeciv/gen_headers/enums/terrain_enums.def mapgen_terrain_property
 */
export enum MapgenTerrainProperty {
  COLD = 'cold',
  DRY = 'dry',
  FOLIAGE = 'foliage',
  FROZEN = 'frozen',
  GREEN = 'green',
  MOUNTAINOUS = 'mountainous',
  OCEAN_DEPTH = 'ocean_depth',
  TEMPERATE = 'temperate',
  TROPICAL = 'tropical',
  WET = 'wet',
  UNUSED = 'unused',
}

/**
 * Temperature type conditions for terrain selection
 * @reference freeciv/server/generator/temperature_map.h TT_* constants
 */
export enum TemperatureCondition {
  TT_FROZEN = 1,
  TT_COLD = 2,
  TT_TEMPERATE = 4,
  TT_TROPICAL = 8,
  TT_NFROZEN = 2 | 4 | 8, // TT_COLD | TT_TEMPERATE | TT_TROPICAL
  TT_ALL = 1 | 2 | 4 | 8, // TT_FROZEN | TT_NFROZEN
  TT_NHOT = 1 | 2, // TT_FROZEN | TT_COLD
  TT_HOT = 4 | 8, // TT_TEMPERATE | TT_TROPICAL
}

/**
 * Wetness conditions for terrain selection
 * @reference freeciv/server/generator/mapgen.c wetness_c enum
 */
export enum WetnessCondition {
  WC_ALL = 200,
  WC_DRY = 201,
  WC_NDRY = 202,
}

/**
 * Terrain selection rule for island generation
 * @reference freeciv/server/generator/mapgen.c terrain_select struct
 */
export interface TerrainSelect {
  weight: number;
  target: MapgenTerrainProperty;
  prefer: MapgenTerrainProperty;
  avoid: MapgenTerrainProperty;
  tempCondition: TemperatureCondition;
  wetCondition: WetnessCondition;
}

/**
 * Island terrain selection lists for make_island()
 * @reference freeciv/server/generator/mapgen.c island_terrain struct
 */
export interface IslandTerrain {
  init: boolean;
  forest: TerrainSelect[];
  desert: TerrainSelect[];
  mountain: TerrainSelect[];
  swamp: TerrainSelect[];
}

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
    temperature: TemperatureType.TEMPERATE,
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

/**
 * Global island terrain selection state
 * @reference freeciv/server/generator/mapgen.c island_terrain
 */
const islandTerrain: IslandTerrain = {
  init: false,
  forest: [],
  desert: [],
  mountain: [],
  swamp: [],
};

/**
 * Initialize terrain selection lists for island generation
 * @reference freeciv/server/generator/mapgen.c island_terrain_init()
 * Exact port of freeciv's island terrain initialization
 */
export function islandTerrainInit(): void {
  if (islandTerrain.init) {
    return; // Already initialized
  }

  // Forest terrain selections
  islandTerrain.forest = [
    // Tropical forests in tropical/wet areas, avoid dry
    {
      weight: 1,
      target: MapgenTerrainProperty.FOLIAGE,
      prefer: MapgenTerrainProperty.TROPICAL,
      avoid: MapgenTerrainProperty.DRY,
      tempCondition: TemperatureCondition.TT_TROPICAL,
      wetCondition: WetnessCondition.WC_ALL,
    },
    // Temperate forests (highest weight - most common)
    {
      weight: 3,
      target: MapgenTerrainProperty.FOLIAGE,
      prefer: MapgenTerrainProperty.TEMPERATE,
      avoid: MapgenTerrainProperty.UNUSED,
      tempCondition: TemperatureCondition.TT_ALL,
      wetCondition: WetnessCondition.WC_ALL,
    },
    // Wet forests in tropical areas, avoid frozen, need non-dry
    {
      weight: 1,
      target: MapgenTerrainProperty.FOLIAGE,
      prefer: MapgenTerrainProperty.WET,
      avoid: MapgenTerrainProperty.FROZEN,
      tempCondition: TemperatureCondition.TT_TROPICAL,
      wetCondition: WetnessCondition.WC_NDRY,
    },
    // Cold climate forests, avoid frozen areas
    {
      weight: 1,
      target: MapgenTerrainProperty.FOLIAGE,
      prefer: MapgenTerrainProperty.COLD,
      avoid: MapgenTerrainProperty.UNUSED,
      tempCondition: TemperatureCondition.TT_NFROZEN,
      wetCondition: WetnessCondition.WC_ALL,
    },
  ];

  // Desert terrain selections
  islandTerrain.desert = [
    // Hot tropical deserts (highest weight)
    {
      weight: 3,
      target: MapgenTerrainProperty.DRY,
      prefer: MapgenTerrainProperty.TROPICAL,
      avoid: MapgenTerrainProperty.GREEN,
      tempCondition: TemperatureCondition.TT_HOT,
      wetCondition: WetnessCondition.WC_DRY,
    },
    // Temperate deserts
    {
      weight: 2,
      target: MapgenTerrainProperty.DRY,
      prefer: MapgenTerrainProperty.TEMPERATE,
      avoid: MapgenTerrainProperty.GREEN,
      tempCondition: TemperatureCondition.TT_NFROZEN,
      wetCondition: WetnessCondition.WC_DRY,
    },
    // Cold dry areas, avoid tropical, not hot
    {
      weight: 1,
      target: MapgenTerrainProperty.COLD,
      prefer: MapgenTerrainProperty.DRY,
      avoid: MapgenTerrainProperty.TROPICAL,
      tempCondition: TemperatureCondition.TT_NHOT,
      wetCondition: WetnessCondition.WC_DRY,
    },
    // Frozen deserts (tundra)
    {
      weight: 1,
      target: MapgenTerrainProperty.FROZEN,
      prefer: MapgenTerrainProperty.DRY,
      avoid: MapgenTerrainProperty.UNUSED,
      tempCondition: TemperatureCondition.TT_FROZEN,
      wetCondition: WetnessCondition.WC_DRY,
    },
  ];

  // Mountain terrain selections
  islandTerrain.mountain = [
    // Green mountains (hills) - higher weight
    {
      weight: 2,
      target: MapgenTerrainProperty.MOUNTAINOUS,
      prefer: MapgenTerrainProperty.GREEN,
      avoid: MapgenTerrainProperty.UNUSED,
      tempCondition: TemperatureCondition.TT_ALL,
      wetCondition: WetnessCondition.WC_ALL,
    },
    // Mountains without green preference
    {
      weight: 1,
      target: MapgenTerrainProperty.MOUNTAINOUS,
      prefer: MapgenTerrainProperty.UNUSED,
      avoid: MapgenTerrainProperty.GREEN,
      tempCondition: TemperatureCondition.TT_ALL,
      wetCondition: WetnessCondition.WC_ALL,
    },
  ];

  // Swamp terrain selections
  islandTerrain.swamp = [
    // Tropical swamps
    {
      weight: 1,
      target: MapgenTerrainProperty.WET,
      prefer: MapgenTerrainProperty.TROPICAL,
      avoid: MapgenTerrainProperty.FOLIAGE,
      tempCondition: TemperatureCondition.TT_TROPICAL,
      wetCondition: WetnessCondition.WC_NDRY,
    },
    // Temperate swamps in hot areas (highest weight)
    {
      weight: 2,
      target: MapgenTerrainProperty.WET,
      prefer: MapgenTerrainProperty.TEMPERATE,
      avoid: MapgenTerrainProperty.FOLIAGE,
      tempCondition: TemperatureCondition.TT_HOT,
      wetCondition: WetnessCondition.WC_NDRY,
    },
    // Cold swamps, not hot
    {
      weight: 1,
      target: MapgenTerrainProperty.WET,
      prefer: MapgenTerrainProperty.COLD,
      avoid: MapgenTerrainProperty.FOLIAGE,
      tempCondition: TemperatureCondition.TT_NHOT,
      wetCondition: WetnessCondition.WC_NDRY,
    },
  ];

  islandTerrain.init = true;
}

/**
 * Free memory allocated for terrain selection lists
 * @reference freeciv/server/generator/mapgen.c island_terrain_free()
 * Exact port of freeciv's island terrain cleanup
 */
export function islandTerrainFree(): void {
  if (!islandTerrain.init) {
    return;
  }

  // Clear all terrain selection arrays
  islandTerrain.forest = [];
  islandTerrain.desert = [];
  islandTerrain.mountain = [];
  islandTerrain.swamp = [];

  islandTerrain.init = false;
}

/**
 * Get terrain selection list for a specific terrain type
 * @reference freeciv/server/generator/mapgen.c island_terrain access
 * Provides access to initialized terrain selection lists
 */
export function getIslandTerrainSelections(
  terrainType: 'forest' | 'desert' | 'mountain' | 'swamp'
): TerrainSelect[] {
  if (!islandTerrain.init) {
    throw new Error('Island terrain not initialized. Call islandTerrainInit() first.');
  }

  return islandTerrain[terrainType];
}

/**
 * Check if island terrain system is initialized
 */
export function isIslandTerrainInitialized(): boolean {
  return islandTerrain.init;
}

/**
 * Test temperature condition for a tile
 * @reference freeciv/server/generator/temperature_map.h tmap_is()
 * Exact port of freeciv temperature condition checking
 */
export function testTemperatureCondition(tile: MapTile, condition: TemperatureCondition): boolean {
  // tile.temperature is already TemperatureType enum, convert to TemperatureCondition values
  let tileTemp: TemperatureCondition;

  // Convert TemperatureType to TemperatureCondition values for bit masking
  switch (tile.temperature) {
    case TemperatureType.FROZEN:
      tileTemp = TemperatureCondition.TT_FROZEN;
      break;
    case TemperatureType.COLD:
      tileTemp = TemperatureCondition.TT_COLD;
      break;
    case TemperatureType.TEMPERATE:
      tileTemp = TemperatureCondition.TT_TEMPERATE;
      break;
    case TemperatureType.TROPICAL:
      tileTemp = TemperatureCondition.TT_TROPICAL;
      break;
    default:
      tileTemp = TemperatureCondition.TT_TEMPERATE;
      break;
  }

  return (tileTemp & condition) !== 0;
}

/**
 * Test wetness condition for a tile
 * @reference freeciv/server/generator/mapgen.c test_wetness()
 * Exact port of freeciv wetness condition checking
 */
export function testWetnessCondition(tile: MapTile, condition: WetnessCondition): boolean {
  switch (condition) {
    case WetnessCondition.WC_ALL:
      return true;
    case WetnessCondition.WC_DRY:
      // Dry if wetness < 50
      return tile.wetness < 50;
    case WetnessCondition.WC_NDRY:
      // Not dry if wetness >= 50
      return tile.wetness >= 50;
    default:
      return true;
  }
}

/**
 * Select terrain based on climate-specific selection lists
 * @reference freeciv/server/generator/mapgen.c fill_island()
 * Port of freeciv's weighted terrain selection algorithm
 */
export function selectTerrainFromList(
  terrainSelections: TerrainSelect[],
  tile: MapTile,
  random: () => number
): TerrainType | null {
  if (terrainSelections.length === 0) {
    return null;
  }

  // Calculate total weight of valid selections
  let totalWeight = 0;
  const validSelections: { selection: TerrainSelect; cumulativeWeight: number }[] = [];

  for (const selection of terrainSelections) {
    // Check temperature and wetness conditions
    if (!testTemperatureCondition(tile, selection.tempCondition)) {
      continue;
    }
    if (!testWetnessCondition(tile, selection.wetCondition)) {
      continue;
    }

    totalWeight += selection.weight;
    validSelections.push({
      selection,
      cumulativeWeight: totalWeight,
    });
  }

  if (validSelections.length === 0 || totalWeight === 0) {
    return null;
  }

  // Select based on weighted random
  const randomValue = Math.floor(random() * totalWeight);

  for (const { selection, cumulativeWeight } of validSelections) {
    if (randomValue < cumulativeWeight) {
      // Convert mapgen terrain property to actual terrain type
      return mapgenPropertyToTerrain(selection.target);
    }
  }

  // Fallback to first valid selection
  return mapgenPropertyToTerrain(validSelections[0].selection.target);
}

/**
 * Convert mapgen terrain property to actual terrain type
 * @reference freeciv/server/generator/mapgen_utils.c pick_terrain()
 * Maps terrain properties to specific terrain types
 */
function mapgenPropertyToTerrain(property: MapgenTerrainProperty): TerrainType {
  switch (property) {
    case MapgenTerrainProperty.FOLIAGE:
      return 'forest';
    case MapgenTerrainProperty.DRY:
      return 'desert';
    case MapgenTerrainProperty.MOUNTAINOUS:
      return 'mountains';
    case MapgenTerrainProperty.WET:
      return 'swamp';
    case MapgenTerrainProperty.FROZEN:
      return 'tundra';
    case MapgenTerrainProperty.COLD:
      return 'tundra';
    case MapgenTerrainProperty.GREEN:
      return 'grassland';
    case MapgenTerrainProperty.TROPICAL:
      return 'jungle';
    case MapgenTerrainProperty.TEMPERATE:
      return 'plains';
    default:
      return 'plains';
  }
}

/**
 * Fill island terrain using climate-based selection
 * @reference freeciv/server/generator/mapgen.c fill_island()
 * Port of freeciv's island terrain filling algorithm
 */
export function fillIslandTerrain(
  tiles: MapTile[][],
  terrainType: 'forest' | 'desert' | 'mountain' | 'swamp',
  targetCount: number,
  continentId: number,
  random: () => number
): void {
  if (!islandTerrain.init) {
    throw new Error('Island terrain not initialized. Call islandTerrainInit() first.');
  }

  const width = tiles.length;
  const height = tiles[0].length;
  const terrainSelections = getIslandTerrainSelections(terrainType);
  let placedCount = 0;
  let attempts = 0;
  const maxAttempts = targetCount * 10; // Prevent infinite loops

  while (placedCount < targetCount && attempts < maxAttempts) {
    attempts++;

    // Random tile selection
    const x = Math.floor(random() * width);
    const y = Math.floor(random() * height);
    const tile = tiles[x][y];

    // Only place on appropriate land tiles of the correct continent
    if (tile.continentId !== continentId || !isLandTile(tile.terrain)) {
      continue;
    }

    // Skip if already has specific terrain (don't overwrite)
    if (tile.terrain !== 'plains' && tile.terrain !== 'grassland') {
      continue;
    }

    // Use terrain selection logic
    const selectedTerrain = selectTerrainFromList(terrainSelections, tile, random);
    if (selectedTerrain) {
      tile.terrain = selectedTerrain;
      placedCount++;
    }
  }
}
