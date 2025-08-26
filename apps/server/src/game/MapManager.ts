/* eslint-disable complexity */
import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';

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

// Terrain property mappings from freeciv classic ruleset
// Each terrain has property values from 0-100 representing how much of that property it has
const TERRAIN_PROPERTY_MAP: Record<TerrainType, TerrainProperties> = {
  // Water terrains
  ocean: {
    [TerrainProperty.OCEAN_DEPTH]: 0,
  },
  coast: {
    [TerrainProperty.OCEAN_DEPTH]: 32,
  },
  deep_ocean: {
    [TerrainProperty.OCEAN_DEPTH]: 87,
  },
  lake: {
    [TerrainProperty.WET]: 100,
  },
  // Land terrains
  desert: {
    [TerrainProperty.DRY]: 100,
    [TerrainProperty.TROPICAL]: 50,
    [TerrainProperty.TEMPERATE]: 20,
  },
  plains: {
    [TerrainProperty.COLD]: 20,
    [TerrainProperty.WET]: 20,
    [TerrainProperty.FOLIAGE]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  grassland: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  forest: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.MOUNTAINOUS]: 30,
  },
  jungle: {
    [TerrainProperty.FOLIAGE]: 50,
    [TerrainProperty.TROPICAL]: 50,
    [TerrainProperty.WET]: 50,
  },
  hills: {
    [TerrainProperty.MOUNTAINOUS]: 70,
  },
  mountains: {
    [TerrainProperty.GREEN]: 50,
    [TerrainProperty.TEMPERATE]: 50,
  },
  swamp: {
    [TerrainProperty.WET]: 100,
    [TerrainProperty.TROPICAL]: 10,
    [TerrainProperty.TEMPERATE]: 10,
    [TerrainProperty.COLD]: 10,
  },
  tundra: {
    [TerrainProperty.COLD]: 50,
  },
  snow: {
    [TerrainProperty.FROZEN]: 100,
  },
  glacier: {
    [TerrainProperty.FROZEN]: 100,
  },
};

/**
 * Climate constants ported from freeciv reference
 * @reference freeciv/server/generator/temperature_map.h and mapgen_topology.h
 */
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude (freeciv: MAP_MAX_LATITUDE)
const ICE_BASE_LEVEL = 200; // Base level for polar ice formation (freeciv: ice_base_colatitude)
const DEFAULT_TEMPERATURE = 50; // Default temperature parameter 0-100 (freeciv: wld.map.server.temperature)

/**
 * Calculate cold temperature threshold based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.h:50-51
 * Original: #define COLD_LEVEL (MAX(0, MAX_COLATITUDE * (60*7 - wld.map.server.temperature * 6 ) / 700))
 */
function getColdLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.max(0, (MAX_COLATITUDE * (60 * 7 - temperature * 6)) / 700);
}

/**
 * Calculate tropical temperature threshold based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.h:52-54
 * Original: #define TROPICAL_LEVEL (MIN(MAX_COLATITUDE * 9 /10, MAX_COLATITUDE * (143*7 - wld.map.server.temperature * 10) / 700))
 */
function getTropicalLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.min((MAX_COLATITUDE * 9) / 10, (MAX_COLATITUDE * (143 * 7 - temperature * 10)) / 700);
}

/**
 * Phase 4: Fractal Height Generation System
 * Advanced height map generation using diamond-square algorithm and fracture maps
 * @reference freeciv/server/generator/height_map.c and fracture_map.c
 */

// Height map constants from freeciv reference
const HMAP_MAX_LEVEL = 1000; // Maximum height value (freeciv: hmap_max_level)
const HMAP_SHORE_LEVEL = 250; // Sea level threshold (freeciv: hmap_shore_level)
const DEFAULT_STEEPNESS = 30; // Terrain steepness parameter 0-100 (freeciv: wld.map.server.steepness)
const DEFAULT_FLATPOLES = 100; // Pole flattening parameter 0-100 (freeciv: wld.map.server.flatpoles)

// Landmass and fracture generation parameters
interface LandmassPoint {
  x: number;
  y: number;
}

/**
 * Advanced height map generator using fractal algorithms
 * Ported from freeciv's height_map.c and fracture_map.c
 */
class FractalHeightGenerator {
  private width: number;
  private height: number;
  private heightMap: number[];
  private random: () => number;
  private shoreLevel: number = HMAP_SHORE_LEVEL;
  private mountainLevel: number;
  private readonly steepness: number; // Used for mountain level calculation
  private flatpoles: number;

  constructor(
    width: number,
    height: number,
    random: () => number,
    steepness: number = DEFAULT_STEEPNESS,
    flatpoles: number = DEFAULT_FLATPOLES
  ) {
    this.width = width;
    this.height = height;
    this.heightMap = new Array(width * height).fill(0);
    this.random = random;
    this.steepness = steepness;
    this.flatpoles = flatpoles;

    // Calculate mountain level based on steepness parameter
    // Higher steepness = more mountains (lower mountain threshold)
    this.mountainLevel = Math.floor(
      ((HMAP_MAX_LEVEL - this.shoreLevel) * (100 - this.steepness)) / 100 + this.shoreLevel
    );
  }

  /**
   * Get height value at coordinates with bounds checking
   */
  private getHeight(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return 0;
    }
    return this.heightMap[y * this.width + x];
  }

  /**
   * Set height value at coordinates with bounds checking
   */
  private setHeight(x: number, y: number, value: number): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.heightMap[y * this.width + x] = Math.max(0, Math.min(HMAP_MAX_LEVEL, value));
    }
  }

  /**
   * Calculate pole flattening factor for realistic world geometry
   * @reference freeciv/server/generator/height_map.c:35-57
   */
  private getPoleFactor(x: number, y: number): number {
    const colatitude = this.getColatitude(x, y);
    let factor = 1.0;

    if (this.isNearMapEdge(x, y)) {
      // Map edge near pole: clamp to flat poles percentage
      factor = (100 - this.flatpoles) / 100.0;
    } else if (this.flatpoles > 0) {
      // Linear ramp down from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles)% at poles
      factor = 1 - ((1 - colatitude / (2.5 * ICE_BASE_LEVEL)) * this.flatpoles) / 100;
    }

    if (colatitude >= 2 * ICE_BASE_LEVEL) {
      // Band of low height to separate poles
      factor = Math.min(factor, 0.1);
    }

    return Math.max(0, factor);
  }

  /**
   * Calculate colatitude (distance from equator) for climate effects
   */
  private getColatitude(_x: number, y: number): number {
    const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);
    return latitudeFactor * MAX_COLATITUDE;
  }

  /**
   * Check if coordinates are near map edge
   */
  private isNearMapEdge(x: number, y: number): boolean {
    const edgeDistance = 3;
    return (
      x < edgeDistance ||
      y < edgeDistance ||
      x >= this.width - edgeDistance ||
      y >= this.height - edgeDistance
    );
  }

  /**
   * Diamond-Square algorithm implementation
   * @reference freeciv/server/generator/height_map.c:120-182
   */
  private diamondSquareRecursive(
    step: number,
    xl: number,
    yt: number,
    xr: number,
    yb: number
  ): void {
    // Base case: rectangle too small
    if (yb - yt <= 0 || xr - xl <= 0 || (yb - yt === 1 && xr - xl === 1)) {
      return;
    }

    // Handle map wrapping for edge coordinates
    const x1wrap = xr >= this.width ? 0 : xr;
    const y1wrap = yb >= this.height ? 0 : yb;

    // Get corner values
    const val = [
      [this.getHeight(xl, yt), this.getHeight(xl, y1wrap)],
      [this.getHeight(x1wrap, yt), this.getHeight(x1wrap, y1wrap)],
    ];

    // Calculate midpoint coordinates
    const midX = Math.floor((xl + xr) / 2);
    const midY = Math.floor((yt + yb) / 2);

    // Set midpoints of sides with random variation
    this.setMidpoint(midX, yt, (val[0][0] + val[1][0]) / 2, step);
    this.setMidpoint(midX, y1wrap, (val[0][1] + val[1][1]) / 2, step);
    this.setMidpoint(xl, midY, (val[0][0] + val[0][1]) / 2, step);
    this.setMidpoint(x1wrap, midY, (val[1][0] + val[1][1]) / 2, step);

    // Set center point with random variation
    const centerValue = (val[0][0] + val[0][1] + val[1][0] + val[1][1]) / 4;
    this.setMidpoint(midX, midY, centerValue, step);

    // Recursively process four quadrants with reduced step size
    const newStep = Math.floor((2 * step) / 3);
    this.diamondSquareRecursive(newStep, xl, yt, midX, midY);
    this.diamondSquareRecursive(newStep, xl, midY, midX, yb);
    this.diamondSquareRecursive(newStep, midX, yt, xr, midY);
    this.diamondSquareRecursive(newStep, midX, midY, xr, yb);
  }

  /**
   * Set midpoint value with pole flattening and random variation
   */
  private setMidpoint(x: number, y: number, baseValue: number, step: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }

    const colatitude = this.getColatitude(x, y);
    const randomVariation = this.random() * step - step / 2;
    let value = baseValue + randomVariation;

    // Apply pole flattening for realistic world geometry
    if (colatitude <= ICE_BASE_LEVEL / 2) {
      value = (value * (100 - this.flatpoles)) / 100;
    } else if (this.isNearMapEdge(x, y) || this.getHeight(x, y) !== 0) {
      // Don't overwrite existing values or map edges
      return;
    }

    this.setHeight(x, y, value);
  }

  /**
   * Generate fracture map with landmass points
   * Ported from freeciv's make_fracture_map() function
   * @reference freeciv/server/generator/fracture_map.c:55-150
   * @reference Original algorithm creates strategic landmass points with border ocean generation
   */
  public generateFractureMap(): void {
    // Calculate number of landmasses based on map size
    const mapSize = Math.sqrt(this.width * this.height);
    const numLandmass = Math.floor(20 + 15 * (mapSize / 50));

    const fracturePoints: LandmassPoint[] = [];

    // Place landmass points along map borders for ocean creation
    const borderSpacing = 5;

    // Top and bottom borders
    for (let x = 3; x < this.width; x += borderSpacing) {
      fracturePoints.push({ x, y: 3 });
      fracturePoints.push({ x, y: this.height - 4 });
    }

    // Left and right borders
    for (let y = 3; y < this.height; y += borderSpacing) {
      fracturePoints.push({ x: 3, y });
      fracturePoints.push({ x: this.width - 4, y });
    }

    // Add random interior landmass points
    const borderPoints = fracturePoints.length;
    for (let i = 0; i < numLandmass; i++) {
      fracturePoints.push({
        x: Math.floor(this.random() * (this.width - 6)) + 3,
        y: Math.floor(this.random() * (this.height - 6)) + 3,
      });
    }

    // Create landmass regions around fracture points
    for (let i = 0; i < fracturePoints.length; i++) {
      const point = fracturePoints[i];
      const isBorderPoint = i < borderPoints;

      // Border points create ocean (low elevation), interior points create land
      const baseElevation = isBorderPoint ? 0 : Math.floor(this.random() * HMAP_MAX_LEVEL);
      const radius = Math.floor(8 + this.random() * 12);

      this.createCircularLandmass(point.x, point.y, radius, baseElevation);
    }
  }

  /**
   * Create circular landmass region using Bresenham circle algorithm
   */
  private createCircularLandmass(
    centerX: number,
    centerY: number,
    radius: number,
    elevation: number
  ): void {
    // Fill circular area with specified elevation
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

        if (distance <= radius) {
          // Smooth falloff from center to edge
          const falloff = 1 - distance / radius;
          const adjustedElevation = Math.floor(elevation * falloff * falloff);

          if (this.getHeight(x, y) < adjustedElevation) {
            this.setHeight(x, y, adjustedElevation);
          }
        }
      }
    }
  }

  /**
   * Generate sophisticated height map using diamond-square and fracture algorithms
   */
  public generateHeightMap(): void {
    // Step 1: Initialize with fracture map for landmass shapes
    this.generateFractureMap();

    // Step 2: Apply diamond-square algorithm for fractal detail
    const initialStep = Math.floor(HMAP_MAX_LEVEL / 4);
    const divisions = 4; // Number of initial blocks

    // Set up initial corner values for diamond-square
    for (let x = 0; x < divisions; x++) {
      for (let y = 0; y < divisions; y++) {
        const blockX = Math.floor((x * this.width) / divisions);
        const blockY = Math.floor((y * this.height) / divisions);
        const cornerValue = Math.floor(this.random() * HMAP_MAX_LEVEL);

        this.setHeight(blockX, blockY, cornerValue);
      }
    }

    // Apply diamond-square recursively on each block
    for (let x = 0; x < divisions; x++) {
      for (let y = 0; y < divisions; y++) {
        const xl = Math.floor((x * this.width) / divisions);
        const yt = Math.floor((y * this.height) / divisions);
        const xr = Math.floor(((x + 1) * this.width) / divisions);
        const yb = Math.floor(((y + 1) * this.height) / divisions);

        this.diamondSquareRecursive(initialStep, xl, yt, xr, yb);
      }
    }

    // Step 3: Apply pole flattening for realistic world geometry
    this.normalizeHeightMapPoles();

    // Step 4: Add final random variation
    for (let i = 0; i < this.heightMap.length; i++) {
      const fuzz = Math.floor(this.random() * 8) - 4;
      this.heightMap[i] = Math.max(0, Math.min(HMAP_MAX_LEVEL, 8 * this.heightMap[i] + fuzz));
    }

    // Step 5: Normalize to final height range
    this.normalizeHeightMap();
  }

  /**
   * Apply pole flattening for realistic world geometry
   * @reference freeciv/server/generator/height_map.c:65-75
   */
  private normalizeHeightMapPoles(): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const colatitude = this.getColatitude(x, y);

        if (colatitude <= 2.5 * ICE_BASE_LEVEL) {
          const poleFactor = this.getPoleFactor(x, y);
          const currentHeight = this.getHeight(x, y);
          this.setHeight(x, y, currentHeight * poleFactor);
        } else if (this.isNearMapEdge(x, y)) {
          // Near map edge but not near pole - set to ocean
          this.setHeight(x, y, 0);
        }
      }
    }
  }

  /**
   * Normalize height map to proper elevation range (0-255 for tile.elevation)
   */
  private normalizeHeightMap(): void {
    // Find current min/max heights
    let minHeight = HMAP_MAX_LEVEL;
    let maxHeight = 0;

    for (const height of this.heightMap) {
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }

    // Normalize to 0-255 range
    const range = maxHeight - minHeight;
    if (range > 0) {
      for (let i = 0; i < this.heightMap.length; i++) {
        this.heightMap[i] = Math.floor(((this.heightMap[i] - minHeight) / range) * 255);
      }
    }
  }

  /**
   * Apply smoothing passes to height map
   */
  public applySmoothingPasses(passes: number = 2): void {
    for (let pass = 0; pass < passes; pass++) {
      const newHeightMap = [...this.heightMap];

      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const neighbors = [
            this.getHeight(x - 1, y - 1),
            this.getHeight(x, y - 1),
            this.getHeight(x + 1, y - 1),
            this.getHeight(x - 1, y),
            this.getHeight(x, y),
            this.getHeight(x + 1, y),
            this.getHeight(x - 1, y + 1),
            this.getHeight(x, y + 1),
            this.getHeight(x + 1, y + 1),
          ];

          const avgHeight = neighbors.reduce((sum, h) => sum + h, 0) / neighbors.length;
          newHeightMap[y * this.width + x] = Math.floor(avgHeight);
        }
      }

      this.heightMap = newHeightMap;
    }
  }

  /**
   * Get the generated height map
   */
  public getHeightMap(): number[] {
    return [...this.heightMap];
  }

  /**
   * Get shore level threshold for water/land classification
   */
  public getShoreLevel(): number {
    return Math.floor((this.shoreLevel / HMAP_MAX_LEVEL) * 255);
  }

  /**
   * Get mountain level threshold for elevation-based terrain
   */
  public getMountainLevel(): number {
    return Math.floor((this.mountainLevel / HMAP_MAX_LEVEL) * 255);
  }
}

/**
 * Enhanced TemperatureMap class - Sophisticated climate generation system
 * @reference freeciv/server/generator/temperature_map.c
 * Ported from freeciv's temperature map generation algorithms including:
 * - create_tmap() function (lines 119-179)
 * - Temperature distribution adjustment logic
 * - Climate-aware terrain placement
 */
class TemperatureMap {
  private temperatureMap: number[];
  private width: number;
  private height: number;
  private temperatureParam: number;

  constructor(width: number, height: number, temperatureParam: number = DEFAULT_TEMPERATURE) {
    this.width = width;
    this.height = height;
    this.temperatureParam = temperatureParam;
    this.temperatureMap = new Array(width * height);
  }

  /**
   * Calculate colatitude for a tile (0 = equator, MAX_COLATITUDE = pole)
   * @reference freeciv/server/generator/mapgen_topology.c:map_colatitude()
   * Simplified latitude calculation for rectangular maps
   */
  private mapColatitude(_x: number, y: number): number {
    const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);
    return Math.floor(latitudeFactor * MAX_COLATITUDE);
  }

  /**
   * Count ocean tiles around a position (simplified version of count_terrain_class_near_tile)
   * @reference freeciv/common/terrain.c:637-660 count_terrain_class_near_tile()
   * Used for ocean proximity temperature moderation effects
   */
  private countOceanNearTile(tiles: MapTile[][], x: number, y: number): number {
    let oceanCount = 0;
    const radius = 2;
    let totalCount = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          totalCount++;
          const tile = tiles[nx][ny];
          if (
            tile.terrain === 'ocean' ||
            tile.terrain === 'coast' ||
            tile.terrain === 'deep_ocean' ||
            tile.terrain === 'lake'
          ) {
            oceanCount++;
          }
        }
      }
    }

    return totalCount > 0 ? Math.floor((oceanCount * 100) / totalCount) : 0;
  }

  /**
   * Create sophisticated temperature map based on freeciv's create_tmap function
   * @reference freeciv/server/generator/temperature_map.c:119-179 create_tmap()
   * Implements:
   * - Latitude-based base temperature (line 131)
   * - Elevation cooling effects (lines 137-138)
   * - Ocean proximity temperature moderation (lines 139-144)
   * - Temperature distribution adjustment (lines 150-157)
   * - Discrete temperature type conversion (lines 160-172)
   */
  public createTemperatureMap(tiles: MapTile[][], heightMap: number[], real: boolean = true): void {
    const maxHeight = Math.max(...heightMap);
    const shoreLevel = maxHeight * 0.3; // Approximate shore level

    // Initialize base temperature from colatitude
    for (let i = 0; i < this.width * this.height; i++) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const baseTemp = this.mapColatitude(x, y);

      if (!real) {
        this.temperatureMap[i] = baseTemp;
      } else {
        // High land can be 30% cooler
        const heightFactor =
          (-0.3 * Math.max(0, heightMap[i] - shoreLevel)) / (maxHeight - shoreLevel);

        // Near ocean temperature can be 15% more "temperate"
        const oceanCount = this.countOceanNearTile(tiles, x, y);
        const temperateFactor =
          (0.15 *
            (this.temperatureParam / 100 - baseTemp / MAX_COLATITUDE) *
            2 *
            Math.min(50, oceanCount)) /
          100;

        this.temperatureMap[i] = Math.floor(
          baseTemp * (1.0 + temperateFactor) * (1.0 + heightFactor)
        );
      }
    }

    // Adjust to get evenly distributed frequencies (simplified adjust_int_map)
    this.adjustTemperatureDistribution();

    // Convert to discrete temperature types
    this.convertToTemperatureTypes();
  }

  /**
   * Adjust temperature distribution for better balance
   * @reference freeciv/server/generator/temperature_map.c:154-157
   * Original: adjust_int_map(temperature_map, MIN_REAL_COLATITUDE, MAX_REAL_COLATITUDE)
   * Simplified implementation for even temperature distribution
   */
  private adjustTemperatureDistribution(): void {
    const minTemp = Math.min(...this.temperatureMap);
    const maxTemp = Math.max(...this.temperatureMap);

    if (maxTemp <= minTemp) return;

    const range = maxTemp - minTemp;
    const targetMin = MAX_COLATITUDE * 0.1;
    const targetMax = MAX_COLATITUDE * 0.9;
    const targetRange = targetMax - targetMin;

    for (let i = 0; i < this.temperatureMap.length; i++) {
      const normalized = (this.temperatureMap[i] - minTemp) / range;
      this.temperatureMap[i] = Math.floor(targetMin + normalized * targetRange);
    }
  }

  /**
   * Convert continuous temperatures to discrete types (TT_FROZEN, TT_COLD, etc.)
   * @reference freeciv/server/generator/temperature_map.c:160-172
   * Original temperature type assignment logic with TROPICAL_LEVEL, COLD_LEVEL thresholds
   */
  private convertToTemperatureTypes(): void {
    const coldLevel = getColdLevel(this.temperatureParam);
    const tropicalLevel = getTropicalLevel(this.temperatureParam);

    for (let i = 0; i < this.temperatureMap.length; i++) {
      const temp = this.temperatureMap[i];

      if (temp >= tropicalLevel) {
        this.temperatureMap[i] = TemperatureType.TROPICAL;
      } else if (temp >= coldLevel) {
        this.temperatureMap[i] = TemperatureType.TEMPERATE;
      } else if (temp >= 2 * ICE_BASE_LEVEL) {
        this.temperatureMap[i] = TemperatureType.COLD;
      } else {
        this.temperatureMap[i] = TemperatureType.FROZEN;
      }
    }
  }

  // Get temperature type for a tile
  public getTemperature(x: number, y: number): TemperatureType {
    const index = y * this.width + x;
    if (index < 0 || index >= this.temperatureMap.length) {
      return TemperatureType.TEMPERATE;
    }
    return this.temperatureMap[index];
  }

  /**
   * Check if tile has specific temperature type (like tmap_is function)
   * @reference freeciv/server/generator/temperature_map.c:85-88 tmap_is()
   * Original: return BOOL_VAL(tmap(ptile) & (tt))
   */
  public hasTemperatureType(x: number, y: number, tempType: TemperatureType): boolean {
    const tileTemp = this.getTemperature(x, y);
    return (tileTemp & tempType) !== 0;
  }

  /**
   * Check if any neighbor has specific temperature type
   * @reference freeciv/server/generator/temperature_map.c:93-102 is_temperature_type_near()
   * Original: adjc_iterate checking for temperature type in adjacent tiles
   */
  public hasTemperatureTypeNear(x: number, y: number, tempType: TemperatureType): boolean {
    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x >= 0 &&
        neighbor.x < this.width &&
        neighbor.y >= 0 &&
        neighbor.y < this.height
      ) {
        if (this.hasTemperatureType(neighbor.x, neighbor.y, tempType)) {
          return true;
        }
      }
    }
    return false;
  }
}

// Terrain selection lists for different terrain categories (from freeciv reference)
const TERRAIN_SELECTORS: TerrainSelector[] = [
  // Forest terrains
  {
    terrain: 'forest',
    weight: 50,
    target: TerrainProperty.GREEN,
    prefer: TerrainProperty.FOLIAGE,
    avoid: TerrainProperty.DRY,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'jungle',
    weight: 40,
    target: TerrainProperty.TROPICAL,
    prefer: TerrainProperty.WET,
    avoid: TerrainProperty.COLD,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.NDRY,
  },
  // Desert terrains
  {
    terrain: 'desert',
    weight: 60,
    target: TerrainProperty.DRY,
    prefer: TerrainProperty.TROPICAL,
    avoid: TerrainProperty.WET,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.DRY,
  },
  // Mountain terrains
  {
    terrain: 'mountains',
    weight: 30,
    target: TerrainProperty.MOUNTAINOUS,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.WET,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'hills',
    weight: 40,
    target: TerrainProperty.MOUNTAINOUS,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  // Swamp terrains
  {
    terrain: 'swamp',
    weight: 25,
    target: TerrainProperty.WET,
    prefer: TerrainProperty.TROPICAL,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TROPICAL,
    wetCondition: WetnessCondition.NDRY,
  },
  // Grassland/plains
  {
    terrain: 'grassland',
    weight: 50,
    target: TerrainProperty.GREEN,
    prefer: TerrainProperty.TEMPERATE,
    avoid: TerrainProperty.DRY,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.NDRY,
  },
  {
    terrain: 'plains',
    weight: 45,
    target: TerrainProperty.TEMPERATE,
    prefer: TerrainProperty.FOLIAGE,
    avoid: TerrainProperty.FROZEN,
    tempCondition: TemperatureType.TEMPERATE,
    wetCondition: WetnessCondition.ALL,
  },
  // Cold terrains
  {
    terrain: 'tundra',
    weight: 40,
    target: TerrainProperty.COLD,
    prefer: TerrainProperty.GREEN,
    avoid: TerrainProperty.TROPICAL,
    tempCondition: TemperatureType.COLD,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'snow',
    weight: 35,
    target: TerrainProperty.FROZEN,
    prefer: TerrainProperty.COLD,
    avoid: TerrainProperty.GREEN,
    tempCondition: TemperatureType.FROZEN,
    wetCondition: WetnessCondition.ALL,
  },
  {
    terrain: 'glacier',
    weight: 30,
    target: TerrainProperty.FROZEN,
    prefer: TerrainProperty.COLD,
    avoid: TerrainProperty.TROPICAL,
    tempCondition: TemperatureType.FROZEN,
    wetCondition: WetnessCondition.ALL,
  },
];

class TerrainSelectionEngine {
  private random: () => number;

  constructor(random: () => number) {
    this.random = random;
  }

  /**
   * Enhanced terrain selection using sophisticated climate-based algorithms
   * @reference freeciv/server/generator/mapgen.c:pickTerrain logic and terrain placement algorithms
   * Combines multiple freeciv approaches:
   * - Climate-based terrain selection (mapgen.c terrain placement)
   * - Property-based terrain fitness scoring
   * - Elevation and climate synergy bonuses
   */
  public pickTerrain(
    tileTemp: TemperatureType,
    tileWetness: number,
    elevation: number
  ): TerrainType {
    // Water terrains based on elevation and climate (Phase 3 enhancement)
    if (elevation < 10) return 'deep_ocean';
    if (elevation < 20) return 'ocean';
    if (elevation < 30) return 'coast';

    // Enhanced inland water placement with climate consideration
    if (elevation < 50 && tileWetness > 80) {
      // Higher chance of lakes in temperate zones
      const lakeChance = tileTemp & TemperatureType.TEMPERATE ? 0.08 : 0.05;
      if (this.random() < lakeChance) {
        return 'lake';
      }
    }

    // Special climate-based terrain rules
    if (tileTemp & TemperatureType.FROZEN) {
      // Polar regions - prefer glacier over snow in high elevations
      if (elevation > 150) {
        return this.random() < 0.7 ? 'glacier' : 'snow';
      } else {
        return this.random() < 0.3 ? 'glacier' : 'snow';
      }
    }

    // Find matching terrain selectors
    const candidates: Array<{ terrain: TerrainType; score: number }> = [];

    for (const selector of TERRAIN_SELECTORS) {
      // Check temperature condition match
      if (!(tileTemp & selector.tempCondition)) {
        continue;
      }

      // Check wetness condition
      const isDry = tileWetness < 30;
      if (selector.wetCondition === WetnessCondition.DRY && !isDry) continue;
      if (selector.wetCondition === WetnessCondition.NDRY && isDry) continue;

      // Enhanced terrain fitness scoring (Phase 3)
      const properties = TERRAIN_PROPERTY_MAP[selector.terrain];
      let score = selector.weight;

      // Temperature-climate matching bonus (stronger influence)
      if (tileTemp & selector.tempCondition) {
        score *= 1.3; // 30% bonus for matching temperature
      }

      // Target property bonus
      const targetValue = properties[selector.target] || 0;
      score += targetValue * 0.6; // Increased importance

      // Prefer property bonus
      const preferValue = properties[selector.prefer] || 0;
      score += preferValue * 0.4; // Increased importance

      // Avoid property penalty
      const avoidValue = properties[selector.avoid] || 0;
      score -= avoidValue * 0.5; // Stronger penalty

      // Climate-elevation synergy bonuses
      if (selector.terrain === 'mountains' || selector.terrain === 'hills') {
        score += Math.max(0, elevation - 100) * 0.25;
        // Cold mountains get extra bonus
        if (tileTemp & (TemperatureType.COLD | TemperatureType.FROZEN)) {
          score *= 1.2;
        }
      }

      // Tropical wetness synergy
      if (
        tileTemp & TemperatureType.TROPICAL &&
        (selector.terrain === 'jungle' || selector.terrain === 'swamp')
      ) {
        if (tileWetness > 60) {
          score *= 1.4; // Strong synergy bonus
        }
      }

      // Desert-arid synergy
      if (selector.terrain === 'desert' && tileWetness < 30) {
        score *= 1.3;
      }

      // Forest placement enhancement
      if (selector.terrain === 'forest') {
        if (tileTemp & TemperatureType.TEMPERATE && tileWetness > 40 && tileWetness < 80) {
          score *= 1.25; // Optimal forest conditions
        }
      }

      if (score > 0) {
        candidates.push({ terrain: selector.terrain, score });
      }
    }

    // Weighted random selection
    if (candidates.length === 0) {
      // Fallback to simple terrain based on temperature and wetness
      if (tileTemp === TemperatureType.FROZEN) return 'snow';
      if (tileTemp === TemperatureType.COLD) return 'tundra';
      if (tileWetness > 70) return 'grassland';
      if (tileWetness < 30) return 'desert';
      return 'plains';
    }

    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    let randomValue = this.random() * totalScore;

    for (const candidate of candidates) {
      randomValue -= candidate.score;
      if (randomValue <= 0) {
        return candidate.terrain;
      }
    }

    // Fallback
    return candidates[0].terrain;
  }
}

// Phase 5: Advanced Terrain Placement - Island Generation System
// Port from freeciv/server/generator/mapgen.c:2094-2500

// Generator state tracking for island-based generation
interface IslandGeneratorState {
  isleIndex: number;
  totalMass: number;
  n: number; // North boundary
  s: number; // South boundary
  e: number; // East boundary
  w: number; // West boundary
  heightMap: number[][];
  placedMap: boolean[][]; // Tracks which tiles have been placed
}

// Terrain percentage configuration (matches freeciv defaults)
interface TerrainPercentages {
  river: number;
  mountain: number;
  desert: number;
  forest: number;
  swamp: number;
}

// Bucket state for terrain distribution (replaces static variables)
interface BucketState {
  balance: number;
  lastPlaced: number;
  riverBucket: number;
  mountainBucket: number;
  desertBucket: number;
  forestBucket: number;
  swampBucket: number;
  tileFactor: number;
}

// Bucket-based terrain distribution system (for future use)
// interface TerrainBucket {
//   value: number;
//   terrain: TerrainType[];
//   weight: number[];
//   coastChance: number; // Percentage chance to place near coast
// }

// Island terrain selection lists (port from island_terrain_init())
class IslandTerrainLists {
  forest: TerrainSelector[];
  desert: TerrainSelector[];
  mountain: TerrainSelector[];
  swamp: TerrainSelector[];
  initialized: boolean = false;

  constructor() {
    this.forest = [];
    this.desert = [];
    this.mountain = [];
    this.swamp = [];
  }

  initialize(): void {
    if (this.initialized) return;

    // Forest terrain selection (from freeciv mapgen.c:2018-2030)
    this.forest = [
      {
        terrain: 'forest',
        weight: 50,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.FOLIAGE,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'jungle',
        weight: 60,
        target: TerrainProperty.FOLIAGE,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.COLD,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'plains',
        weight: 30,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.MOUNTAINOUS,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'grassland',
        weight: 40,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.WET,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
    ];

    // Desert terrain selection (from freeciv mapgen.c:2033-2045)
    this.desert = [
      {
        terrain: 'desert',
        weight: 80,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.DRY,
      },
      {
        terrain: 'tundra',
        weight: 60,
        target: TerrainProperty.COLD,
        prefer: TerrainProperty.DRY,
        avoid: TerrainProperty.TROPICAL,
        tempCondition: TemperatureType.COLD,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'plains',
        weight: 20,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.DRY,
      },
      {
        terrain: 'hills',
        weight: 30,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.MOUNTAINOUS,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.DRY,
      },
    ];

    // Mountain terrain selection (from freeciv mapgen.c:2048-2054)
    this.mountain = [
      {
        terrain: 'mountains',
        weight: 70,
        target: TerrainProperty.MOUNTAINOUS,
        prefer: TerrainProperty.COLD,
        avoid: TerrainProperty.OCEAN_DEPTH,
        tempCondition: TemperatureType.COLD,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'hills',
        weight: 60,
        target: TerrainProperty.MOUNTAINOUS,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.OCEAN_DEPTH,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.ALL,
      },
    ];

    // Swamp terrain selection (from freeciv mapgen.c:2057-2066)
    this.swamp = [
      {
        terrain: 'swamp',
        weight: 80,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.MOUNTAINOUS,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'jungle',
        weight: 50,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.FOLIAGE,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'grassland',
        weight: 30,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.GREEN,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
    ];

    this.initialized = true;
  }

  cleanup(): void {
    this.forest = [];
    this.desert = [];
    this.mountain = [];
    this.swamp = [];
    this.initialized = false;
  }
}

export class MapManager {
  private width: number;
  private height: number;
  private mapData: MapData | null = null;
  private seed: string;
  private temperatureMap: TemperatureMap;

  // Phase 5: Island generation system
  private islandTerrainLists: IslandTerrainLists;
  private terrainPercentages: TerrainPercentages;
  private random: () => number;
  private bucketState?: BucketState;

  constructor(width: number, height: number, seed?: string) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.temperatureMap = new TemperatureMap(width, height);
    this.random = this.createSeededRandom(this.seed);

    // Initialize island generation system
    this.islandTerrainLists = new IslandTerrainLists();

    // Default terrain percentages (from freeciv mapgen.c:1498-1512)
    // These will be calculated based on map settings in production
    this.terrainPercentages = {
      river: 15, // Base 15% river coverage
      mountain: 25, // 25% mountainous terrain
      desert: 20, // 20% arid terrain
      forest: 30, // 30% forested areas
      swamp: 10, // 10% wetlands
    };
  }

  public async generateMap(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map', { width: this.width, height: this.height, seed: this.seed });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Generate terrain using Perlin noise-like algorithm
    await this.generateTerrain(tiles);

    // Generate continents
    await this.generateContinents(tiles);

    // Place rivers
    await this.generateRivers(tiles);

    // Place resources
    await this.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.generateStartingPositions(tiles, players);

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const generationTime = Date.now() - startTime;
    logger.info('Map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
    });
  }

  private createBaseTile(x: number, y: number): MapTile {
    return {
      x,
      y,
      terrain: 'ocean',
      elevation: 0,
      riverMask: 0,
      continentId: 0,
      isExplored: false,
      isVisible: false,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      unitIds: [],
      // Phase 2: Initialize property system
      properties: {},
      temperature: TemperatureType.TEMPERATE,
      wetness: 50,
    };
  }

  private async generateTerrain(tiles: MapTile[][]): Promise<void> {
    const random = this.createSeededRandom(this.seed);
    const terrainSelector = new TerrainSelectionEngine(random);

    // Phase 2: Generate climate data first
    this.generateClimateData(tiles, random);

    // Phase 4: Generate sophisticated height map using fractal algorithms
    logger.info('Generating fractal height map with diamond-square and fracture algorithms');
    const heightGenerator = new FractalHeightGenerator(this.width, this.height, random);

    // Generate sophisticated height map
    heightGenerator.generateHeightMap();

    // Apply smoothing passes for natural terrain transitions
    heightGenerator.applySmoothingPasses(2);

    // Get generated height map and apply to tiles
    const generatedHeights = heightGenerator.getHeightMap();
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].elevation = generatedHeights[y * this.width + x];
      }
    }

    logger.info('Fractal height generation completed', {
      shoreLevel: heightGenerator.getShoreLevel(),
      mountainLevel: heightGenerator.getMountainLevel(),
    });

    // Phase 2: Assign terrain using property-based selection
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const selectedTerrain = terrainSelector.pickTerrain(
          tile.temperature,
          tile.wetness,
          tile.elevation
        );

        tile.terrain = selectedTerrain;

        // Set terrain properties based on selected terrain
        tile.properties = { ...TERRAIN_PROPERTY_MAP[selectedTerrain] };
      }
    }

    // Phase 3: Apply biome transition logic for more natural borders
    this.applyBiomeTransitions(tiles, random);
  }

  /**
   * Apply biome transition logic for natural climate boundaries (Phase 3)
   * @reference freeciv approach to terrain smoothing and climate transitions
   * Inspired by freeciv's terrain placement smoothing algorithms in mapgen.c
   * Creates natural borders between different climate zones and terrain types
   */
  private applyBiomeTransitions(tiles: MapTile[][], random: () => number): void {
    const transitionRules: Array<{
      from: TerrainType[];
      to: TerrainType;
      transitionTerrain: TerrainType;
      chance: number;
    }> = [
      // Forest to grassland transitions
      {
        from: ['forest'],
        to: 'grassland',
        transitionTerrain: 'plains',
        chance: 0.4,
      },
      // Desert to grassland transitions
      {
        from: ['desert'],
        to: 'grassland',
        transitionTerrain: 'plains',
        chance: 0.5,
      },
      // Snow to tundra transitions
      {
        from: ['snow', 'glacier'],
        to: 'tundra',
        transitionTerrain: 'tundra',
        chance: 0.6,
      },
      // Tundra to forest transitions
      {
        from: ['tundra'],
        to: 'forest',
        transitionTerrain: 'plains',
        chance: 0.3,
      },
      // Jungle to grassland transitions
      {
        from: ['jungle'],
        to: 'grassland',
        transitionTerrain: 'forest',
        chance: 0.3,
      },
    ];

    // Apply transitions in multiple passes for gradual effect
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          this.applyTransitionRuleToTile(tiles, x, y, transitionRules, random);
        }
      }
    }

    // Smooth isolated terrain patches (anti-fragmentation)
    this.smoothTerrainPatches(tiles);
  }

  /**
   * Apply transition rule to a single tile (extracted to reduce complexity)
   * Helper function for applyBiomeTransitions to reduce nesting depth
   */
  private applyTransitionRuleToTile(
    tiles: MapTile[][],
    x: number,
    y: number,
    transitionRules: Array<{
      from: TerrainType[];
      to: TerrainType;
      transitionTerrain: TerrainType;
      chance: number;
    }>,
    random: () => number
  ): void {
    const tile = tiles[x][y];
    if (!this.isLandTile(tile.terrain)) return;

    const neighbors = this.getNeighbors(tiles, x, y).filter(n => this.isLandTile(n.terrain));

    for (const rule of transitionRules) {
      if (rule.from.includes(tile.terrain)) {
        // Check if we're adjacent to the target terrain
        const hasTargetNeighbor = neighbors.some(n => n.terrain === rule.to);

        if (hasTargetNeighbor && random() < rule.chance) {
          // Apply transition
          tile.terrain = rule.transitionTerrain;
          tile.properties = { ...TERRAIN_PROPERTY_MAP[rule.transitionTerrain] };
          break; // Only apply one transition per tile
        }
      }
    }
  }

  /**
   * Remove small isolated terrain patches for more coherent biomes
   * @reference Inspired by freeciv's terrain smoothing approaches
   * Eliminates terrain fragmentation for more realistic biome formation
   */
  private smoothTerrainPatches(tiles: MapTile[][]): void {
    const minPatchSize = 3; // Minimum size for terrain patches

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        this.smoothIsolatedTile(tiles, x, y, minPatchSize);
      }
    }
  }

  /**
   * Smooth a single isolated tile (extracted to reduce complexity)
   * Helper function for smoothTerrainPatches to reduce nesting depth
   */
  private smoothIsolatedTile(tiles: MapTile[][], x: number, y: number, minPatchSize: number): void {
    const tile = tiles[x][y];
    if (!this.isLandTile(tile.terrain)) return;

    const neighbors = this.getNeighbors(tiles, x, y).filter(n => this.isLandTile(n.terrain));
    const sameTerrainNeighbors = neighbors.filter(n => n.terrain === tile.terrain).length;

    // If isolated or very small patch, convert to most common neighbor terrain
    if (sameTerrainNeighbors < minPatchSize) {
      const mostCommonTerrain = this.findMostCommonNeighborTerrain(neighbors, tile.terrain);

      // Apply the change if it makes sense climatically
      if (this.isClimaticallyCompatible(tile, mostCommonTerrain)) {
        tile.terrain = mostCommonTerrain;
        tile.properties = { ...TERRAIN_PROPERTY_MAP[mostCommonTerrain] };
      }
    }
  }

  /**
   * Find the most common terrain type among neighbors
   * Helper function for terrain patch smoothing
   */
  private findMostCommonNeighborTerrain(neighbors: MapTile[], fallback: TerrainType): TerrainType {
    const terrainCounts = new Map<TerrainType, number>();

    for (const neighbor of neighbors) {
      const count = terrainCounts.get(neighbor.terrain) || 0;
      terrainCounts.set(neighbor.terrain, count + 1);
    }

    // Find most common neighbor terrain
    let mostCommonTerrain = fallback;
    let maxCount = 0;

    for (const [terrain, count] of terrainCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonTerrain = terrain;
      }
    }

    return mostCommonTerrain;
  }

  /**
   * Check if terrain change makes climatic sense
   * @reference Based on freeciv's climate-terrain compatibility logic
   * Prevents unrealistic terrain combinations (e.g., tropical terrain in frozen zones)
   */
  private isClimaticallyCompatible(tile: MapTile, newTerrain: TerrainType): boolean {
    const currentClimate = tile.temperature;
    const newProperties = TERRAIN_PROPERTY_MAP[newTerrain];

    // Don't place tropical terrain in frozen zones
    if (currentClimate & TemperatureType.FROZEN && newProperties[TerrainProperty.TROPICAL]) {
      return false;
    }

    // Don't place frozen terrain in tropical zones
    if (currentClimate & TemperatureType.TROPICAL && newProperties[TerrainProperty.FROZEN]) {
      return false;
    }

    // Check wetness compatibility
    const isDryClimate = tile.wetness < 30;
    const isWetTerrain =
      newProperties[TerrainProperty.WET] && newProperties[TerrainProperty.WET] > 50;

    if (isDryClimate && isWetTerrain) {
      return false; // Don't place wet terrain in dry areas
    }

    return true;
  }

  private generateClimateData(tiles: MapTile[][], random: () => number): void {
    // Phase 3: Create height map for temperature calculations
    const heightMap = new Array(this.width * this.height);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        heightMap[y * this.width + x] = tiles[x][y].elevation;
      }
    }

    // Generate sophisticated temperature map using enhanced TemperatureMap class
    this.temperatureMap.createTemperatureMap(tiles, heightMap, true);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        tile.temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Enhanced wetness generation with climate zone awareness
    this.generateWetnessMap(tiles, random);

    // Smooth wetness for more realistic patterns
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const neighbors = this.getNeighbors(tiles, x, y);
          const avgWetness =
            neighbors.reduce((sum, tile) => sum + tile.wetness, tiles[x][y].wetness) /
            (neighbors.length + 1);
          tiles[x][y].wetness = Math.round(avgWetness);
        }
      }
    }
  }

  // Enhanced wetness generation with climate-aware patterns
  private generateWetnessMap(tiles: MapTile[][], random: () => number): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Base wetness influenced by temperature zones
        let baseWetness = 50;
        if (tile.temperature & TemperatureType.TROPICAL) {
          baseWetness = 70; // Tropical areas tend to be wetter
        } else if (tile.temperature & TemperatureType.FROZEN) {
          baseWetness = 30; // Frozen areas are drier
        } else if (tile.temperature & TemperatureType.COLD) {
          baseWetness = 40; // Cold areas are moderately dry
        }

        // Continental effect - drier inland
        const distanceFromEdge = Math.min(x, y, this.width - x - 1, this.height - y - 1);
        const continentalEffect = Math.max(0, (distanceFromEdge - 10) * 2);

        // Elevation effect - higher areas can be drier
        const elevationEffect = Math.max(0, (tile.elevation - 100) * 0.1);

        // Add randomness
        const noise = (random() - 0.5) * 40;

        tile.wetness = Math.max(
          0,
          Math.min(100, baseWetness - continentalEffect - elevationEffect + noise)
        );
      }
    }
  }

  private async generateContinents(tiles: MapTile[][]): Promise<void> {
    let continentId = 1;
    const visited = new Set<string>();

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const key = `${x},${y}`;

        if (!visited.has(key) && this.isLandTile(tile.terrain)) {
          this.floodFillContinent(tiles, x, y, continentId, visited);
          continentId++;
        }
      }
    }
  }

  private floodFillContinent(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    continentId: number,
    visited: Set<string>
  ): void {
    const stack = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key) || !this.isValidCoord(x, y)) {
        continue;
      }

      const tile = tiles[x][y];
      if (!this.isLandTile(tile.terrain)) {
        continue;
      }

      visited.add(key);
      tile.continentId = continentId;

      // Add neighbors to stack
      const neighbors = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ];

      for (const neighbor of neighbors) {
        if (!visited.has(`${neighbor.x},${neighbor.y}`)) {
          stack.push(neighbor);
        }
      }
    }
  }

  private async generateRivers(tiles: MapTile[][]): Promise<void> {
    const random = this.createSeededRandom(this.seed);
    const riverCount = Math.floor((this.width * this.height) / 800); // About 1 river per 800 tiles

    for (let i = 0; i < riverCount; i++) {
      // Start rivers from high elevation areas
      let startX, startY;
      let attempts = 0;

      do {
        startX = Math.floor(random() * this.width);
        startY = Math.floor(random() * this.height);
        attempts++;
      } while (
        attempts < 100 &&
        (tiles[startX][startY].elevation < 100 || !this.isLandTile(tiles[startX][startY].terrain))
      );

      if (attempts < 100) {
        this.generateRiverPath(tiles, startX, startY, random);
      }
    }
  }

  private generateRiverPath(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    random: () => number
  ): void {
    let x = startX;
    let y = startY;
    const maxLength = 20;
    let length = 0;

    const visited = new Set<string>();

    while (length < maxLength && this.isValidCoord(x, y)) {
      const key = `${x},${y}`;
      if (visited.has(key)) break;
      visited.add(key);

      const tile = tiles[x][y];
      if (tile.terrain === 'ocean' || tile.terrain === 'coast') break;

      // Find direction to flow (towards lower elevation)
      const neighbors = [
        { x: x - 1, y, dir: 8 }, // West
        { x: x + 1, y, dir: 2 }, // East
        { x, y: y - 1, dir: 1 }, // North
        { x, y: y + 1, dir: 4 }, // South
      ].filter(n => this.isValidCoord(n.x, n.y));

      if (neighbors.length === 0) break;

      // Sort by elevation (prefer lower)
      neighbors.sort((a, b) => tiles[a.x][a.y].elevation - tiles[b.x][b.y].elevation);

      // Add some randomness but bias towards lower elevation
      const next =
        random() < 0.7 ? neighbors[0] : neighbors[Math.floor(random() * neighbors.length)];

      // Set river mask on current tile
      tile.riverMask |= next.dir;

      x = next.x;
      y = next.y;
      length++;
    }
  }

  private async generateResources(tiles: MapTile[][]): Promise<void> {
    const random = this.createSeededRandom(this.seed);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!this.isLandTile(tile.terrain) || random() > 0.15) {
          // 15% chance of resource
          continue;
        }

        // Assign resource based on terrain
        const possibleResources = this.getResourcesForTerrain(tile.terrain);
        if (possibleResources.length > 0) {
          const resourceIndex = Math.floor(random() * possibleResources.length);
          tile.resource = possibleResources[resourceIndex];
        }
      }
    }
  }

  private getResourcesForTerrain(terrain: TerrainType): ResourceType[] {
    const resourceMap: Record<TerrainType, ResourceType[]> = {
      ocean: ['fish'],
      coast: ['fish'],
      deep_ocean: ['fish'],
      lake: ['fish'],
      grassland: ['wheat', 'cattle', 'horses'],
      plains: ['horses', 'wheat', 'cattle'],
      desert: ['gold', 'gems', 'oil'],
      tundra: ['horses', 'iron', 'oil', 'uranium'],
      snow: ['oil', 'uranium'],
      glacier: ['oil', 'uranium'],
      forest: ['spices', 'silk'],
      jungle: ['spices', 'gems', 'gold'],
      swamp: ['spices', 'oil'],
      hills: ['iron', 'copper', 'gold', 'gems', 'horses'],
      mountains: ['iron', 'copper', 'gold', 'gems', 'uranium'],
    };

    return resourceMap[terrain] || [];
  }

  private async generateStartingPositions(
    tiles: MapTile[][],
    players: Map<string, PlayerState>
  ): Promise<Array<{ x: number; y: number; playerId: string }>> {
    const positions: Array<{ x: number; y: number; playerId: string }> = [];
    const playerIds = Array.from(players.keys());

    // Find suitable starting locations
    const candidatePositions: Array<{ x: number; y: number; score: number }> = [];

    for (let x = 5; x < this.width - 5; x++) {
      for (let y = 5; y < this.height - 5; y++) {
        const tile = tiles[x][y];

        if (!this.isStartingSuitableTerrain(tile.terrain)) {
          continue;
        }

        const score = this.evaluateStartingPosition(tiles, x, y);
        if (score > 50) {
          candidatePositions.push({ x, y, score });
        }
      }
    }

    // Sort by score descending
    candidatePositions.sort((a, b) => b.score - a.score);

    // Select positions with minimum distance between players
    const minDistance = Math.max(
      8,
      Math.floor(Math.sqrt((this.width * this.height) / playerIds.length))
    );

    for (const playerId of playerIds) {
      let bestPosition = null;

      for (const candidate of candidatePositions) {
        // Check minimum distance from existing positions
        const tooClose = positions.some(pos => {
          const dx = pos.x - candidate.x;
          const dy = pos.y - candidate.y;
          return Math.sqrt(dx * dx + dy * dy) < minDistance;
        });

        if (!tooClose) {
          bestPosition = candidate;
          break;
        }
      }

      if (bestPosition) {
        positions.push({ x: bestPosition.x, y: bestPosition.y, playerId });
        logger.debug('Assigned starting position', {
          playerId,
          x: bestPosition.x,
          y: bestPosition.y,
          score: bestPosition.score,
        });
      } else {
        // Fallback: use any available position or create emergency position
        if (candidatePositions.length > 0) {
          const fallback = candidatePositions[positions.length % candidatePositions.length];
          positions.push({ x: fallback.x, y: fallback.y, playerId });
          logger.warn('Used fallback starting position', {
            playerId,
            x: fallback.x,
            y: fallback.y,
          });
        } else {
          // Emergency: place at safe coordinates if no candidates found
          const emergencyX = Math.min(5 + positions.length, this.width - 6);
          const emergencyY = Math.min(5 + positions.length, this.height - 6);
          positions.push({ x: emergencyX, y: emergencyY, playerId });
          logger.warn('Used emergency starting position', {
            playerId,
            x: emergencyX,
            y: emergencyY,
          });
        }
      }
    }

    return positions;
  }

  private isStartingSuitableTerrain(terrain: TerrainType): boolean {
    return ['grassland', 'plains', 'forest', 'hills'].includes(terrain);
  }

  /**
   * Enhanced climate-aware starting position evaluation (Phase 3)
   * @reference freeciv/server/generator/startpos.c starting position evaluation algorithms
   * Enhanced with climate diversity bonuses and temperature-terrain synergies
   * Based on freeciv's approach but adds climate variety as a strategic factor
   */
  private evaluateStartingPosition(tiles: MapTile[][], x: number, y: number): number {
    let score = 0;
    const radius = 3;
    const centerTile = tiles[x][y];

    // Climate base score - temperate zones are best for starting
    const climateScore = this.getClimateScore(x, y);
    score += climateScore * 0.4; // Climate is 40% of base score

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (!this.isValidCoord(nx, ny)) continue;

        const tile = tiles[nx][ny];
        const distance = Math.sqrt(dx * dx + dy * dy);
        const weight = Math.max(0, 1 - distance / radius);

        // Enhanced terrain scoring with climate consideration
        let terrainScore = this.getTerrainStartingScore(tile);

        // Climate synergy bonuses
        if (tile.temperature & TemperatureType.TEMPERATE) {
          terrainScore *= 1.2; // Temperate zones are ideal
        } else if (tile.temperature & TemperatureType.TROPICAL) {
          terrainScore *= 1.1; // Tropical can be productive
        } else if (tile.temperature & TemperatureType.COLD) {
          terrainScore *= 0.8; // Cold zones are challenging
        } else if (tile.temperature & TemperatureType.FROZEN) {
          terrainScore *= 0.5; // Frozen zones are very challenging
        }

        score += terrainScore * weight;

        // Enhanced resource bonus with climate consideration
        if (tile.resource) {
          let resourceScore = 15;

          // Some resources are better in certain climates
          if (tile.resource === 'wheat' && tile.temperature & TemperatureType.TEMPERATE) {
            resourceScore *= 1.3; // Wheat thrives in temperate zones
          } else if (tile.resource === 'spices' && tile.temperature & TemperatureType.TROPICAL) {
            resourceScore *= 1.3; // Spices from tropical regions
          }

          score += resourceScore * weight;
        }

        // River bonus (enhanced for climate)
        if (tile.riverMask > 0) {
          let riverScore = 8;
          // Rivers are more valuable in arid climates
          if (tile.wetness < 40) {
            riverScore *= 1.5;
          }
          score += riverScore * weight;
        }

        // Climate diversity bonus (access to different biomes is good)
        if (distance <= 2) {
          const centerClimate = centerTile.temperature;
          if (tile.temperature !== centerClimate) {
            score += 3 * weight; // Bonus for climate variety nearby
          }
        }
      }
    }

    // Penalty for extreme climates without variety
    const nearbyClimateVariety = this.hasClimateVariety(x, y);
    if (!nearbyClimateVariety) {
      if (centerTile.temperature & (TemperatureType.FROZEN | TemperatureType.TROPICAL)) {
        score *= 0.7; // Penalty for monotonous extreme climates
      }
    }

    // Bonus for climate transition zones (more strategic options)
    if (nearbyClimateVariety) {
      score += 10;
    }

    return Math.max(0, score);
  }

  private getTerrainStartingScore(tile: MapTile): number {
    const terrainScores: Record<TerrainType, number> = {
      grassland: 12, // Increased - excellent for starting
      plains: 10, // Increased - very good base terrain
      forest: 8, // Good for production
      hills: 6, // Good for mining/defense
      coast: 4, // Decent for fishing/trade
      jungle: 3, // Can be cleared for good land
      swamp: 2, // Poor but can be improved
      tundra: 2, // Cold but manageable
      desert: 1, // Harsh conditions
      mountains: 1, // Very poor for starting cities
      glacier: 0, // Extremely harsh
      snow: 0, // Extremely harsh
      lake: -1, // Water tile
      deep_ocean: -5,
      ocean: -5,
    };

    return terrainScores[tile.terrain] || 0;
  }

  private getNeighbors(tiles: MapTile[][], x: number, y: number): MapTile[] {
    const neighbors: MapTile[] = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (this.isValidCoord(nx, ny)) {
          neighbors.push(tiles[nx][ny]);
        }
      }
    }

    return neighbors;
  }

  private isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private generateSeed(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  private createSeededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Linear congruential generator
    return () => {
      hash = (hash * 1664525 + 1013904223) & 0x7fffffff;
      return hash / 0x80000000;
    };
  }

  public getMapData(): MapData | null {
    return this.mapData;
  }

  public getTile(x: number, y: number): MapTile | null {
    if (!this.mapData || !this.isValidCoord(x, y)) {
      return null;
    }
    return this.mapData.tiles[x][y];
  }

  public getVisibleTiles(x: number, y: number, radius: number): MapTile[] {
    if (!this.mapData) return [];

    const visible: MapTile[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (this.isValidCoord(nx, ny)) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radius) {
            visible.push(this.mapData.tiles[nx][ny]);
          }
        }
      }
    }

    return visible;
  }

  public updateTileVisibility(_playerId: string, x: number, y: number, radius: number): void {
    if (!this.mapData) return;

    const visibleTiles = this.getVisibleTiles(x, y, radius);
    for (const tile of visibleTiles) {
      tile.isVisible = true;
      tile.isExplored = true;
    }
  }

  /**
   * Climate zone mapping functions (Phase 3)
   * @reference Based on freeciv temperature type system
   * Maps temperature types to human-readable climate zone names
   */
  public getClimateZone(x: number, y: number): string {
    const tile = this.getTile(x, y);
    if (!tile) return 'temperate';

    if (tile.temperature & TemperatureType.FROZEN) {
      return 'frozen';
    } else if (tile.temperature & TemperatureType.COLD) {
      return 'cold';
    } else if (tile.temperature & TemperatureType.TROPICAL) {
      return 'tropical';
    } else {
      return 'temperate';
    }
  }

  public isClimateZoneNear(x: number, y: number, zone: string): boolean {
    return this.temperatureMap.hasTemperatureTypeNear(x, y, this.getTemperatureTypeFromZone(zone));
  }

  private getTemperatureTypeFromZone(zone: string): TemperatureType {
    switch (zone) {
      case 'frozen':
        return TemperatureType.FROZEN;
      case 'cold':
        return TemperatureType.COLD;
      case 'tropical':
        return TemperatureType.TROPICAL;
      default:
        return TemperatureType.TEMPERATE;
    }
  }

  /**
   * Enhanced climate-aware terrain evaluation
   * @reference Based on freeciv's starting position evaluation with climate considerations
   * Evaluates climate suitability for settlements and strategic gameplay
   */
  public getClimateScore(x: number, y: number): number {
    const tile = this.getTile(x, y);
    if (!tile) return 0;

    let score = 50; // Base score

    // Temperature zone scoring
    if (tile.temperature & TemperatureType.TEMPERATE) {
      score += 20; // Most balanced climate
    } else if (tile.temperature & TemperatureType.TROPICAL) {
      score += 10; // Good for growth
    } else if (tile.temperature & TemperatureType.COLD) {
      score -= 10; // Challenging but manageable
    } else if (tile.temperature & TemperatureType.FROZEN) {
      score -= 20; // Harsh climate
    }

    // Wetness scoring
    if (tile.wetness > 60) {
      score += 10; // Good water availability
    } else if (tile.wetness < 30) {
      score -= 15; // Arid conditions
    }

    // Climate transition zones (more interesting)
    const hasVariedClimate = this.hasClimateVariety(x, y);
    if (hasVariedClimate) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  private hasClimateVariety(x: number, y: number): boolean {
    const centerTemp = this.temperatureMap.getTemperature(x, y);
    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x >= 0 &&
        neighbor.x < this.width &&
        neighbor.y >= 0 &&
        neighbor.y < this.height
      ) {
        const neighborTemp = this.temperatureMap.getTemperature(neighbor.x, neighbor.y);
        if (neighborTemp !== centerTemp) {
          return true; // Found climate variety
        }
      }
    }
    return false;
  }

  // Phase 5: Island Generation System Implementation
  // Port from freeciv/server/generator/mapgen.c:2094-2500

  /**
   * Generate map using island-based algorithm (Phase 5 entry point)
   * @param generatorType Type of generator (2, 3, or 4) - defaults to 4
   */
  public async generateMapWithIslands(
    players: Map<string, PlayerState>,
    generatorType: 2 | 3 | 4 = 4
  ): Promise<void> {
    logger.info('Generating map with island system', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Initialize climate and height data first (from Phase 4)
    this.generateClimateData(tiles, this.random);
    this.generateWetnessMap(tiles, this.random);

    // Initialize world for island generation
    const state = this.initializeWorldForIslands(tiles);

    // Initialize bucket system
    this.makeIsland(0, 0, state, tiles, 0);

    logger.info(`Using map generator ${generatorType} for ${players.size} players`);

    // Generate islands using specified generator algorithm
    switch (generatorType) {
      case 2:
        this.mapGenerator2(state, tiles, players.size);
        break;
      case 3:
        this.mapGenerator3(state, tiles, players.size);
        break;
      case 4:
      default:
        this.mapGenerator4(state, tiles, players.size);
        break;
    }

    // Cleanup terrain lists
    this.islandTerrainLists.cleanup();

    // Apply final terrain improvements
    this.applyBiomeTransitions(tiles, this.random);

    // Generate resources
    await this.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.generateStartingPositions(tiles, players);

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const endTime = Date.now();
    logger.info(`Island-based map generation completed in ${endTime - startTime}ms`);
  }

  /**
   * Initialize the world for island-based generation (port from initworld())
   */
  private initializeWorldForIslands(tiles: MapTile[][]): IslandGeneratorState {
    // Fill all tiles with deep ocean initially
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].terrain = 'deep_ocean';
        tiles[x][y].continentId = 0;
      }
    }

    // Initialize state
    const state: IslandGeneratorState = {
      isleIndex: 1,
      totalMass: Math.floor((this.width * this.height * 30) / 100), // 30% land coverage
      n: 0,
      s: this.height,
      e: this.width,
      w: 0,
      heightMap: Array(this.width)
        .fill(null)
        .map(() => Array(this.height).fill(0)),
      placedMap: Array(this.width)
        .fill(null)
        .map(() => Array(this.height).fill(false)),
    };

    // Initialize terrain selection lists
    this.islandTerrainLists.initialize();

    return state;
  }

  /**
   * Core make_island function (port from freeciv mapgen.c:2094-2202)
   */
  private makeIsland(
    islandMass: number,
    _starters: number,
    state: IslandGeneratorState,
    tiles: MapTile[][],
    minSpecificIslandSize: number = 10
  ): boolean {
    // Static buckets for terrain distribution (like freeciv's bucket system)
    // Convert to instance variables for TypeScript compatibility
    if (!this.bucketState) {
      this.bucketState = {
        balance: 0,
        lastPlaced: 0,
        riverBucket: 0,
        mountainBucket: 0,
        desertBucket: 0,
        forestBucket: 0,
        swampBucket: 0,
        tileFactor: 0,
      };
    }

    const buckets = this.bucketState;

    if (islandMass === 0) {
      // Initialization call (islemass == 0 case from freeciv)
      buckets.balance = 0;
      state.isleIndex = 1; // Start with continent 1

      if (state.totalMass > 3000) {
        logger.info('High landmass - this may take a few seconds.');
      }

      // Calculate terrain distribution factor
      const totalPercent =
        this.terrainPercentages.river +
        this.terrainPercentages.mountain +
        this.terrainPercentages.desert +
        this.terrainPercentages.forest +
        this.terrainPercentages.swamp;

      const normalizedPercent = totalPercent <= 90 ? 100 : (totalPercent * 11) / 10;
      buckets.tileFactor = Math.floor(state.totalMass / normalizedPercent);

      // Initialize buckets with random offsets (like freeciv)
      buckets.riverBucket = -Math.floor(this.random() * state.totalMass);
      buckets.mountainBucket = -Math.floor(this.random() * state.totalMass);
      buckets.desertBucket = -Math.floor(this.random() * state.totalMass);
      buckets.forestBucket = -Math.floor(this.random() * state.totalMass);
      buckets.swampBucket = -Math.floor(this.random() * state.totalMass);
      buckets.lastPlaced = state.totalMass;

      return true;
    }

    // Actual island creation
    islandMass = Math.max(0, islandMass - buckets.balance);

    // Don't create islands we can't place
    if (islandMass > buckets.lastPlaced + 1 + Math.floor(buckets.lastPlaced / 50)) {
      islandMass = buckets.lastPlaced + 1 + Math.floor(buckets.lastPlaced / 50);
    }

    // Size limits based on map dimensions
    const maxHeight = Math.pow(this.height - 6, 2);
    const maxWidth = Math.pow(this.width - 2, 2);

    if (islandMass > maxHeight) {
      islandMass = maxHeight;
    }
    if (islandMass > maxWidth) {
      islandMass = maxWidth;
    }

    let currentSize = islandMass;
    if (currentSize <= 0) {
      return false;
    }

    logger.debug(`Creating island ${state.isleIndex}`);

    // Try to place the island with decreasing size until successful
    while (!this.createIsland(currentSize, state, tiles)) {
      if (currentSize < (islandMass * minSpecificIslandSize) / 100) {
        return false;
      }
      currentSize--;
    }

    currentSize++;
    buckets.lastPlaced = currentSize;

    // Update balance
    if (currentSize * 10 > islandMass) {
      buckets.balance = currentSize - islandMass;
    } else {
      buckets.balance = 0;
    }

    logger.debug(
      `Island ${state.isleIndex}: planned=${islandMass}, placed=${currentSize}, balance=${buckets.balance}`
    );

    // Distribute terrain using bucket system
    const terrainFactor = currentSize * buckets.tileFactor;

    // Rivers first
    buckets.riverBucket += this.terrainPercentages.river * terrainFactor;
    this.fillIslandRivers(1, buckets.riverBucket, state, tiles);

    // Forest terrain
    buckets.forestBucket += this.terrainPercentages.forest * terrainFactor;
    this.fillIsland(60, buckets.forestBucket, this.islandTerrainLists.forest, state, tiles);

    // Desert terrain
    buckets.desertBucket += this.terrainPercentages.desert * terrainFactor;
    this.fillIsland(40, buckets.desertBucket, this.islandTerrainLists.desert, state, tiles);

    // Mountain terrain
    buckets.mountainBucket += this.terrainPercentages.mountain * terrainFactor;
    this.fillIsland(20, buckets.mountainBucket, this.islandTerrainLists.mountain, state, tiles);

    // Swamp terrain
    buckets.swampBucket += this.terrainPercentages.swamp * terrainFactor;
    this.fillIsland(80, buckets.swampBucket, this.islandTerrainLists.swamp, state, tiles);

    state.isleIndex++;
    return true;
  }

  /**
   * Create island shape using height map (port from create_island())
   */
  private createIsland(
    islandMass: number,
    state: IslandGeneratorState,
    tiles: MapTile[][]
  ): boolean {
    const tries = islandMass * (2 + Math.floor(islandMass / 20)) + 99;
    let remainingMass = islandMass - 1;

    // Clear height map
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        state.heightMap[x][y] = 0;
      }
    }

    // Start from center
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    state.heightMap[centerX][centerY] = 1;

    // Initialize bounds
    state.n = centerY - 1;
    state.s = centerY + 2;
    state.w = centerX - 1;
    state.e = centerX + 2;

    let attempts = tries;
    while (remainingMass > 0 && attempts > 0) {
      // Pick random position within current bounds
      const x = Math.floor(this.random() * (state.e - state.w)) + state.w;
      const y = Math.floor(this.random() * (state.s - state.n)) + state.n;

      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        if (state.heightMap[x][y] === 0 && this.countAdjacentElevatedTiles(x, y, state) > 0) {
          state.heightMap[x][y] = 1;
          remainingMass--;

          // Expand bounds if necessary
          if (y >= state.s - 1 && state.s < this.height - 2) state.s++;
          if (x >= state.e - 1 && state.e < this.width - 2) state.e++;
          if (y <= state.n && state.n > 2) state.n--;
          if (x <= state.w && state.w > 2) state.w--;
        }
      }

      // Fill holes when getting close to completion
      if (remainingMass < Math.floor(islandMass / 10)) {
        remainingMass = this.fillIslandHoles(remainingMass, state);
      }

      attempts--;
    }

    if (attempts <= 0) {
      logger.warn(`create_island ended early with ${remainingMass}/${islandMass} remaining`);
    }

    // Apply height map to actual terrain
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (state.heightMap[x][y] > 0) {
          tiles[x][y].terrain = 'grassland'; // Default land terrain
          tiles[x][y].continentId = state.isleIndex;
          state.placedMap[x][y] = false; // Mark as land but not terrain-placed yet
        }
      }
    }

    return remainingMass <= Math.floor(islandMass / 4); // Success if we placed at least 75%
  }

  private countAdjacentElevatedTiles(x: number, y: number, state: IslandGeneratorState): number {
    let count = 0;
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (state.heightMap[nx][ny] > 0) count++;
      }
    }
    return count;
  }

  /**
   * Fill island with specific terrain type (port from fill_island())
   */
  private fillIsland(
    coastChance: number,
    bucket: number,
    terrainSelectors: TerrainSelector[],
    state: IslandGeneratorState,
    tiles: MapTile[][]
  ): void {
    if (bucket <= 0 || terrainSelectors.length === 0) {
      return;
    }

    const capacity = state.totalMass;
    let tilesToPlace = Math.floor(bucket / capacity) + 1;
    bucket -= tilesToPlace * capacity;

    const originalTiles = tilesToPlace;
    const maxAttempts = tilesToPlace * (state.s - state.n) * (state.e - state.w);

    // Calculate total weight for weighted selection
    const totalWeight = terrainSelectors.reduce((sum, sel) => sum + sel.weight, 0);
    if (totalWeight <= 0) return;

    let attempts = Math.abs(maxAttempts);
    while (tilesToPlace > 0 && attempts > 0) {
      // Pick random position within island bounds
      const x = Math.floor(this.random() * (state.e - state.w)) + state.w;
      const y = Math.floor(this.random() * (state.s - state.n)) + state.n;

      if (
        x >= 0 &&
        x < this.width &&
        y >= 0 &&
        y < this.height &&
        tiles[x][y].continentId === state.isleIndex &&
        !state.placedMap[x][y]
      ) {
        // Weighted terrain selection
        const selector = this.selectTerrainFromList(terrainSelectors, totalWeight);
        if (!selector) {
          attempts--;
          continue;
        }

        // Check climate conditions
        const tile = tiles[x][y];
        if (
          !this.testTemperatureCondition(tile.temperature, selector.tempCondition) ||
          !this.testWetnessCondition(tile.wetness, selector.wetCondition)
        ) {
          attempts--;
          continue;
        }

        // Get terrain using property-based selection
        const terrain = this.selectTerrainByProperties(
          tile,
          selector.target,
          selector.prefer,
          selector.avoid
        );

        // Apply placement rules (contiguity and coast distance)
        const shouldPlace =
          (tilesToPlace * 3 > originalTiles * 2 || // Place more aggressively when quota is high
            this.random() < 0.5 || // 50% random chance
            this.isTerrainNearby(x, y, terrain, tiles)) && // Encourage contiguous placement
          (!this.isCoastNearby(x, y, tiles) || this.random() * 100 < coastChance); // Coast distance rule

        if (shouldPlace) {
          tiles[x][y].terrain = terrain;
          state.placedMap[x][y] = true;
          tilesToPlace--;

          logger.debug(`[fill_island] placed terrain '${terrain}' at (${x}, ${y})`);
        }
      }

      attempts--;
    }
  }

  private fillIslandRivers(
    _coastChance: number,
    bucket: number,
    state: IslandGeneratorState,
    tiles: MapTile[][]
  ): void {
    if (bucket <= 0) return;

    const capacity = state.totalMass;
    let tilesToPlace = Math.floor(bucket / capacity) + 1;

    let attempts = tilesToPlace * 10;
    while (tilesToPlace > 0 && attempts > 0) {
      const x = Math.floor(this.random() * (state.e - state.w)) + state.w;
      const y = Math.floor(this.random() * (state.s - state.n)) + state.n;

      if (
        x >= 0 &&
        x < this.width &&
        y >= 0 &&
        y < this.height &&
        tiles[x][y].continentId === state.isleIndex &&
        tiles[x][y].riverMask === 0
      ) {
        // Simple river placement - could be enhanced with flow algorithms
        tiles[x][y].riverMask = this.generateRiverMask(x, y, tiles);
        tilesToPlace--;
      }
      attempts--;
    }
  }

  private selectTerrainFromList(
    terrainSelectors: TerrainSelector[],
    totalWeight: number
  ): TerrainSelector | null {
    let randomValue = this.random() * totalWeight;

    for (const selector of terrainSelectors) {
      randomValue -= selector.weight;
      if (randomValue <= 0) {
        return selector;
      }
    }
    return terrainSelectors[0]; // Fallback
  }

  private testTemperatureCondition(tileTemp: TemperatureType, condition: TemperatureType): boolean {
    return (tileTemp & condition) !== 0;
  }

  private testWetnessCondition(wetness: number, condition: WetnessCondition): boolean {
    switch (condition) {
      case WetnessCondition.DRY:
        return wetness < 30;
      case WetnessCondition.NDRY:
        return wetness >= 30;
      case WetnessCondition.ALL:
      default:
        return true;
    }
  }

  private selectTerrainByProperties(
    _tile: MapTile,
    target: TerrainProperty,
    prefer: TerrainProperty,
    avoid: TerrainProperty
  ): TerrainType {
    // Use existing terrain selection logic with property weights
    const candidates: Array<{ terrain: TerrainType; score: number }> = [];

    for (const terrain of Object.keys(TERRAIN_PROPERTY_MAP) as TerrainType[]) {
      const properties = TERRAIN_PROPERTY_MAP[terrain];

      let score = properties[target] || 0;
      score += (properties[prefer] || 0) * 0.5;
      score -= (properties[avoid] || 0) * 0.8;

      if (score > 0) {
        candidates.push({ terrain, score });
      }
    }

    if (candidates.length === 0) {
      return 'grassland'; // Safe fallback
    }

    // Weighted selection
    const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
    let randomValue = this.random() * totalScore;

    for (const candidate of candidates) {
      randomValue -= candidate.score;
      if (randomValue <= 0) {
        return candidate.terrain;
      }
    }

    return candidates[0].terrain;
  }

  private isTerrainNearby(x: number, y: number, terrain: TerrainType, tiles: MapTile[][]): boolean {
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (tiles[nx][ny].terrain === terrain) return true;
      }
    }
    return false;
  }

  private isCoastNearby(x: number, y: number, tiles: MapTile[][]): boolean {
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const terrain = tiles[nx][ny].terrain;
        if (terrain === 'ocean' || terrain === 'coast' || terrain === 'deep_ocean') {
          return true;
        }
      }
    }
    return false;
  }

  private fillIslandHoles(remainingMass: number, state: IslandGeneratorState): number {
    for (let y = state.n; y < state.s; y++) {
      for (let x = state.w; x < state.e; x++) {
        if (
          state.heightMap[x][y] === 0 &&
          remainingMass > 0 &&
          this.countAdjacentElevatedTiles(x, y, state) === 4
        ) {
          state.heightMap[x][y] = 1;
          remainingMass--;
        }
      }
    }
    return remainingMass;
  }

  private generateRiverMask(x: number, y: number, _tiles: MapTile[][]): number {
    // Simple river mask generation - could be enhanced
    let mask = 0;
    const neighbors = [
      [x, y - 1, 1], // North = 1
      [x + 1, y, 2], // East = 2
      [x, y + 1, 4], // South = 4
      [x - 1, y, 8], // West = 8
    ];

    for (const [nx, ny, bit] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (this.random() < 0.3) {
          // 30% chance for river connection
          mask |= bit;
        }
      }
    }

    return mask;
  }

  // Phase 5: Generator Algorithm Implementations
  // Port from freeciv/server/generator/mapgen.c:2245-2500

  /**
   * Map Generator 2: Fair Islands (from freeciv mapgenerator2())
   * Creates one large island per player with fair distribution
   */
  private mapGenerator2(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): void {
    const totalWeight = 100 * playerCount;
    let bigFrac = 70; // 70% big islands
    const midFrac = 20; // 20% medium islands
    const smallFrac = 10; // 10% small islands
    let done = false;

    logger.info('Generator 2: Fair Islands - creating one big island per player');

    // Fall back for high land percentage
    if ((this.width * this.height * 30) / 100 > (this.width * this.height * 85) / 100) {
      logger.warn('Generator 2: High land percentage, using simplified approach');
    }

    while (!done && bigFrac > midFrac) {
      done = true;

      // Create one big island for each player
      for (let i = playerCount; i > 0; i--) {
        const islandSize = Math.floor((bigFrac * state.totalMass) / totalWeight);
        if (!this.makeIsland(islandSize, 1, state, tiles, 95)) {
          // Couldn't make island 95% of desired size, reduce big islands
          bigFrac -= 10;
          done = false;
          logger.debug(`Generator 2: Reducing big island size to ${bigFrac}%`);
          break;
        }
      }
    }

    // Create medium islands
    const mediumCount = Math.floor(playerCount / 2);
    for (let i = 0; i < mediumCount; i++) {
      const islandSize = Math.floor((midFrac * state.totalMass) / totalWeight);
      this.makeIsland(islandSize, 0, state, tiles, 50);
    }

    // Create small islands
    const smallCount = playerCount;
    for (let i = 0; i < smallCount; i++) {
      const islandSize = Math.floor((smallFrac * state.totalMass) / totalWeight);
      this.makeIsland(islandSize, 0, state, tiles, 25);
    }
  }

  /**
   * Map Generator 3: Archipelago (from freeciv mapgenerator3())
   * Creates archipelago-style maps with varied island sizes
   */
  private mapGenerator3(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): void {
    logger.info('Generator 3: Archipelago - creating varied island sizes');

    // Fall back for extreme cases
    if ((this.width * this.height * 30) / 100 > (this.width * this.height * 80) / 100) {
      logger.warn('Generator 3: High land percentage, using fallback');
      return this.mapGenerator4(state, tiles, playerCount);
    }

    if (this.width < 40 || this.height < 40) {
      logger.warn('Generator 3: Map too small, using fallback');
      return this.mapGenerator4(state, tiles, playerCount);
    }

    const bigIslands = playerCount;
    let landmass = Math.floor((this.width * (this.height - 6) * 30) / 100);

    // Subtract arctic regions
    if (landmass > 3 * this.height + playerCount * 3) {
      landmass -= 3 * this.height;
    }

    // Calculate island mass with size constraints
    const maxMassDiv6 = 20;
    let islandMass = Math.floor(landmass / (3 * bigIslands));

    if (islandMass < 4 * maxMassDiv6) {
      islandMass = Math.floor(landmass / (2 * bigIslands));
    }

    if (islandMass < 3 * maxMassDiv6 && playerCount * 2 < landmass) {
      islandMass = Math.floor(landmass / bigIslands);
    }

    // Apply size limits
    islandMass = Math.max(2, Math.min(maxMassDiv6 * 6, islandMass));

    logger.debug(`Generator 3: Island mass = ${islandMass} for ${bigIslands} big islands`);

    // Create big islands for players
    for (let i = 0; i < bigIslands; i++) {
      if (!this.makeIsland(islandMass, 1, state, tiles, 85)) {
        logger.warn(`Generator 3: Failed to create big island ${i + 1}`);
      }
    }

    // Create additional smaller islands to fill remaining landmass
    const remainingLandmass = state.totalMass - bigIslands * islandMass;
    const smallIslandCount = Math.max(1, Math.floor(remainingLandmass / 50));

    for (let i = 0; i < smallIslandCount; i++) {
      const smallSize = Math.floor(remainingLandmass / smallIslandCount);
      this.makeIsland(smallSize, 0, state, tiles, 30);
    }
  }

  /**
   * Map Generator 4: Teams (from freeciv mapgenerator4())
   * Creates team-oriented maps with shared large islands
   */
  private mapGenerator4(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): void {
    logger.info('Generator 4: Teams - creating team-oriented island layout');

    // Fall back for single player or high land percentage
    if (
      playerCount < 2 ||
      (this.width * this.height * 30) / 100 > (this.width * this.height * 80) / 100
    ) {
      logger.warn('Generator 4: Invalid conditions, using simple generation');
      // Simple fallback - create basic islands
      const numIslands = Math.max(2, Math.min(6, playerCount + 1));
      const islandSize = Math.floor(state.totalMass / numIslands);

      for (let i = 0; i < numIslands; i++) {
        const starters = i < playerCount ? 1 : 0;
        this.makeIsland(islandSize, starters, state, tiles);
      }
      return;
    }

    // Adjust big island weight based on land percentage
    let bigWeight = 70;
    const landPercent = 30; // Our default land percentage

    if (landPercent > 60) {
      bigWeight = 30;
    } else if (landPercent > 40) {
      bigWeight = 50;
    }

    const spares = Math.max(0, Math.floor((landPercent - 5) / 30));
    const totalWeight = (30 + bigWeight) * playerCount;

    logger.debug(
      `Generator 4: bigWeight=${bigWeight}, totalWeight=${totalWeight}, spares=${spares}`
    );

    // Create large team islands
    let teamIslands = Math.floor(playerCount / 2);
    if (playerCount % 2 === 1) {
      // Odd number of players - create one 3-player island
      const tripleIslandSize = Math.floor((bigWeight * 3 * state.totalMass) / totalWeight);
      this.makeIsland(tripleIslandSize, 3, state, tiles);
    } else {
      teamIslands++;
    }

    // Create pair islands
    while (--teamIslands > 0) {
      const pairIslandSize = Math.floor((bigWeight * 2 * state.totalMass) / totalWeight);
      this.makeIsland(pairIslandSize, 2, state, tiles);
    }

    // Create medium solo islands
    for (let i = playerCount; i > 0; i--) {
      const soloIslandSize = Math.floor((20 * state.totalMass) / totalWeight);
      this.makeIsland(soloIslandSize, 0, state, tiles);
    }

    // Create small additional islands
    for (let i = playerCount; i > 0; i--) {
      const smallIslandSize = Math.floor((10 * state.totalMass) / totalWeight);
      this.makeIsland(smallIslandSize, 0, state, tiles);
    }
  }

  /**
   * Fair Islands Generator - ensures balanced starting positions
   * Simplified port from freeciv map_generate_fair_islands()
   */
  public async generateFairIslandsMap(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating fair islands map with balanced starting positions', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      playerCount: players.size,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Initialize climate and height data first (from Phase 4)
    this.generateClimateData(tiles, this.random);
    this.generateWetnessMap(tiles, this.random);

    // Initialize world for island generation
    const state = this.initializeWorldForIslands(tiles);

    // Initialize bucket system
    this.makeIsland(0, 0, state, tiles, 0);

    // Fair island generation logic
    const playersPerIsland = this.calculatePlayersPerIsland(players.size);
    const numMainIslands = Math.ceil(players.size / playersPerIsland);
    const mainIslandSize = Math.floor((state.totalMass * 0.7) / numMainIslands);

    logger.info(
      `Fair Islands: Creating ${numMainIslands} main islands for ${players.size} players (${playersPerIsland} per island)`
    );

    // Create main islands with fair distribution
    for (let i = 0; i < numMainIslands; i++) {
      const playersOnThisIsland = Math.min(playersPerIsland, players.size - i * playersPerIsland);

      if (!this.makeIsland(mainIslandSize, playersOnThisIsland, state, tiles, 90)) {
        logger.warn(`Fair Islands: Failed to create main island ${i + 1}`);
      }
    }

    // Create smaller secondary islands for balance
    const remainingMass = state.totalMass - numMainIslands * mainIslandSize;
    const numSecondaryIslands = Math.min(6, Math.floor(remainingMass / 100));

    for (let i = 0; i < numSecondaryIslands; i++) {
      const secondarySize = Math.floor(remainingMass / numSecondaryIslands);
      this.makeIsland(secondarySize, 0, state, tiles, 50);
    }

    // Cleanup terrain lists
    this.islandTerrainLists.cleanup();

    // Apply final terrain improvements
    this.applyBiomeTransitions(tiles, this.random);

    // Generate resources
    await this.generateResources(tiles);

    // Find suitable starting positions with fairness evaluation
    const startingPositions = await this.generateFairStartingPositions(tiles, players);

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const endTime = Date.now();
    logger.info(`Fair islands map generation completed in ${endTime - startTime}ms`);
  }

  /**
   * Calculate optimal players per island for fair distribution
   */
  private calculatePlayersPerIsland(playerCount: number): number {
    // Try to fit 2 or 3 players per island for optimal gameplay
    if (playerCount % 3 === 0 && playerCount <= 12) {
      return 3; // 3 players per island works for 3, 6, 9, 12 players
    }
    if (playerCount % 2 === 0) {
      return 2; // 2 players per island for even numbers
    }
    if (playerCount <= 5) {
      return 1; // Single player islands for small games
    }

    // For odd numbers > 5, use mixed approach
    return 2; // Default to pairs with one extra island
  }

  /**
   * Generate fair starting positions with distance and quality evaluation
   * Port from freeciv startpos.c evaluation logic
   */
  private async generateFairStartingPositions(
    tiles: MapTile[][],
    players: Map<string, PlayerState>
  ): Promise<Array<{ x: number; y: number; playerId: string }>> {
    const startingPositions: Array<{ x: number; y: number; playerId: string }> = [];
    const playerIds = Array.from(players.keys());
    const minDistanceBetweenPlayers = Math.max(
      8,
      Math.floor(Math.min(this.width, this.height) / 6)
    );

    logger.info(
      `Evaluating starting positions with minimum distance: ${minDistanceBetweenPlayers}`
    );

    for (const playerId of playerIds) {
      const position = this.findBestStartingPosition(
        tiles,
        startingPositions,
        minDistanceBetweenPlayers
      );

      if (position) {
        startingPositions.push({ ...position, playerId });
        logger.debug(
          `Player ${playerId} assigned starting position (${position.x}, ${position.y})`
        );
      } else {
        logger.warn(`Could not find suitable starting position for player ${playerId}`);
        // Fallback to a random land position
        const fallback = this.findRandomLandPosition(tiles);
        if (fallback) {
          startingPositions.push({ ...fallback, playerId });
        }
      }
    }

    return startingPositions;
  }

  /**
   * Find the best starting position using freeciv evaluation criteria
   */
  private findBestStartingPosition(
    tiles: MapTile[][],
    existingPositions: Array<{ x: number; y: number }>,
    minDistance: number
  ): { x: number; y: number } | null {
    let bestPosition: { x: number; y: number; score: number } | null = null;
    const attempts = 1000;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);
      const tile = tiles[x][y];

      // Must be land
      if (!this.isLandTile(tile.terrain)) {
        continue;
      }

      // Check distance from existing starting positions
      if (!this.isValidDistanceFromOthers(x, y, existingPositions, minDistance)) {
        continue;
      }

      // Evaluate position quality
      const score = this.evaluateStartingPositionQuality(tiles, x, y);

      if (!bestPosition || score > bestPosition.score) {
        bestPosition = { x, y, score };
      }

      // If we found a very good position, use it
      if (score > 80) {
        break;
      }
    }

    return bestPosition ? { x: bestPosition.x, y: bestPosition.y } : null;
  }

  /**
   * Evaluate starting position quality based on freeciv criteria
   */
  private evaluateStartingPositionQuality(tiles: MapTile[][], x: number, y: number): number {
    let score = 50; // Base score

    const tile = tiles[x][y];

    // Terrain type scoring
    switch (tile.terrain) {
      case 'grassland':
        score += 20;
        break;
      case 'plains':
        score += 15;
        break;
      case 'forest':
        score += 10;
        break;
      case 'desert':
        score -= 15;
        break;
      case 'tundra':
        score -= 10;
        break;
      case 'snow':
      case 'glacier':
        score -= 25;
        break;
      case 'swamp':
        score -= 5;
        break;
    }

    // Climate scoring
    if (tile.temperature & TemperatureType.TEMPERATE) {
      score += 15;
    } else if (tile.temperature & TemperatureType.TROPICAL) {
      score += 10;
    } else if (tile.temperature & TemperatureType.COLD) {
      score -= 10;
    } else if (tile.temperature & TemperatureType.FROZEN) {
      score -= 20;
    }

    // Wetness scoring (moderate wetness is best)
    if (tile.wetness > 40 && tile.wetness < 70) {
      score += 10;
    } else if (tile.wetness < 20 || tile.wetness > 80) {
      score -= 10;
    }

    // Check surrounding area quality (3x3 around starting position)
    let landTiles = 0;
    let goodTiles = 0;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (this.isValidCoord(nx, ny)) {
          const neighborTile = tiles[nx][ny];

          if (this.isLandTile(neighborTile.terrain)) {
            landTiles++;

            if (['grassland', 'plains', 'forest'].includes(neighborTile.terrain)) {
              goodTiles++;
            }
          }
        }
      }
    }

    // Bonus for having good surrounding area
    score += (goodTiles / 25) * 20; // Up to 20 bonus points

    // Penalty for too much water nearby
    if (landTiles < 15) {
      score -= (15 - landTiles) * 2;
    }

    // Check for nearby resources
    if (tile.resource) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if position is valid distance from other starting positions
   */
  private isValidDistanceFromOthers(
    x: number,
    y: number,
    existingPositions: Array<{ x: number; y: number }>,
    minDistance: number
  ): boolean {
    for (const pos of existingPositions) {
      const distance = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
      if (distance < minDistance) {
        return false;
      }
    }
    return true;
  }

  /**
   * Find a random land position as fallback
   */
  private findRandomLandPosition(tiles: MapTile[][]): { x: number; y: number } | null {
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);

      if (this.isLandTile(tiles[x][y].terrain)) {
        return { x, y };
      }
    }

    return null;
  }

  /**
   * Check if terrain type is land (not water)
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }
}
