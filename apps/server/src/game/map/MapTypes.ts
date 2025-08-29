// Terrain properties from freeciv reference (gen_headers/enums/terrain_enums.def)
export enum TerrainProperty {
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
  UNUSED = 'unused', // MG_UNUSED from freeciv
}

// Temperature types for climate-based terrain selection
export enum TemperatureType {
  FROZEN = 1,
  COLD = 2,
  TEMPERATE = 4,
  TROPICAL = 8,
}

// Composite temperature types (bitwise combinations) - matches freeciv
// @reference freeciv/server/generator/temperature_map.h:31-34
export const TemperatureFlags = {
  TT_NFROZEN: TemperatureType.COLD | TemperatureType.TEMPERATE | TemperatureType.TROPICAL, // 14 (2|4|8)
  TT_ALL:
    TemperatureType.FROZEN |
    TemperatureType.COLD |
    TemperatureType.TEMPERATE |
    TemperatureType.TROPICAL, // 15 (1|2|4|8)
  TT_NHOT: TemperatureType.FROZEN | TemperatureType.COLD, // 3 (1|2) - not hot
  TT_HOT: TemperatureType.TEMPERATE | TemperatureType.TROPICAL, // 12 (4|8) - hot regions
} as const;

// Wetness conditions for terrain selection
export enum WetnessCondition {
  DRY = 'dry',
  NDRY = 'not_dry', // not dry
  WET = 'wet',
  ALL = 'all',
}

// Terrain property values (0-100) for each terrain type
export type TerrainProperties =
  | {
      [key in TerrainProperty]?: number;
    }
  | {
      [key: string]: number | undefined;
    };

// Terrain selection criteria for weighted selection
export interface TerrainSelector {
  terrain: TerrainType;
  weight: number;
  target: TerrainProperty;
  prefer: TerrainProperty;
  avoid: TerrainProperty;
  tempCondition: TemperatureType;
  wetCondition: WetnessCondition;
}

/**
 * Map generator types from freeciv reference
 * @source freeciv/common/map_types.h:46-53
 */
export enum MapGenerator {
  SCENARIO = 0, // MAPGEN_SCENARIO
  RANDOM = 1, // MAPGEN_RANDOM
  FRACTAL = 2, // MAPGEN_FRACTAL
  ISLAND = 3, // MAPGEN_ISLAND
  FAIR = 4, // MAPGEN_FAIR
  FRACTURE = 5, // MAPGEN_FRACTURE
}

/**
 * Map starting position types from freeciv reference
 * @source freeciv/common/map_types.h:55-61
 */
export enum MapStartpos {
  DEFAULT = 0, // MAPSTARTPOS_DEFAULT - Generator's choice
  SINGLE = 1, // MAPSTARTPOS_SINGLE - One player per continent
  TWO_ON_THREE = 2, // MAPSTARTPOS_2or3 - Two on three players per continent
  ALL = 3, // MAPSTARTPOS_ALL - All players on a single continent
  VARIABLE = 4, // MAPSTARTPOS_VARIABLE - Depending on size of continents
}

export type TerrainType =
  | 'ocean'
  | 'coast'
  | 'deep_ocean'
  | 'lake'
  | 'grassland'
  | 'plains'
  | 'desert'
  | 'tundra'
  | 'glacier'
  | 'forest'
  | 'jungle'
  | 'swamp'
  | 'hills'
  | 'mountains';

export type ResourceType =
  | 'wheat'
  | 'cattle'
  | 'fish'
  | 'horses'
  | 'iron'
  | 'copper'
  | 'gold'
  | 'gems'
  | 'spices'
  | 'silk'
  | 'oil'
  | 'uranium';

export interface MapTile {
  x: number;
  y: number;
  terrain: TerrainType;
  resource?: ResourceType;
  riverMask: number; // Bitfield for river connections (N, E, S, W)
  elevation: number; // 0-255 CivJS range (converted from freeciv's 0-1000 internal processing)
  continentId: number; // 0 for oceans, positive for land continents (CivJS web-optimized approach)
  isExplored: boolean;
  isVisible: boolean;
  hasRoad: boolean;
  hasRailroad: boolean;
  improvements: string[];
  cityId?: string;
  unitIds: string[];
  // Phase 2: Terrain properties framework
  properties: TerrainProperties;
  temperature: TemperatureType;
  wetness: number; // 0-100, higher = more wet
}

export interface MapData {
  width: number;
  height: number;
  tiles: MapTile[][];
  startingPositions: Array<{ x: number; y: number; playerId: string }>;
  seed: string;
  generatedAt: Date;
}
