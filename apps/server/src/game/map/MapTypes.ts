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
}

// Temperature types for climate-based terrain selection
export enum TemperatureType {
  FROZEN = 1,
  COLD = 2,
  TEMPERATE = 4,
  TROPICAL = 8,
}

// Wetness conditions for terrain selection
export enum WetnessCondition {
  DRY = 'dry',
  NDRY = 'not_dry', // not dry
  WET = 'wet',
  ALL = 'all',
}

// Terrain property values (0-100) for each terrain type
export type TerrainProperties = {
  [key in TerrainProperty]?: number;
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

export type TerrainType =
  | 'ocean'
  | 'coast'
  | 'deep_ocean'
  | 'lake'
  | 'grassland'
  | 'plains'
  | 'desert'
  | 'tundra'
  | 'snow'
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
  elevation: number; // 0-255 for height
  continentId: number;
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
