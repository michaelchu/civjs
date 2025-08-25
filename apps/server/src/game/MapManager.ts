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

// Climate constants (from freeciv reference - temperature_map.h and mapgen_topology.h)
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude
const ICE_BASE_LEVEL = 200; // Base level for polar ice formation
const DEFAULT_TEMPERATURE = 50; // Default temperature parameter (0-100)

// Calculate climate levels based on temperature parameter
function getColdLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.max(0, MAX_COLATITUDE * (60 * 7 - temperature * 6) / 700);
}

function getTropicalLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.min(
    MAX_COLATITUDE * 9 / 10,
    MAX_COLATITUDE * (143 * 7 - temperature * 10) / 700
  );
}

// Enhanced TemperatureMap class (from freeciv temperature_map.c)
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

  // Calculate colatitude for a tile (0 = equator, MAX_COLATITUDE = pole)
  private mapColatitude(x: number, y: number): number {
    const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);
    return Math.floor(latitudeFactor * MAX_COLATITUDE);
  }

  // Count ocean tiles around a position (simplified version of count_terrain_class_near_tile)
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
          if (tile.terrain === 'ocean' || tile.terrain === 'coast' || 
              tile.terrain === 'deep_ocean' || tile.terrain === 'lake') {
            oceanCount++;
          }
        }
      }
    }

    return totalCount > 0 ? Math.floor((oceanCount * 100) / totalCount) : 0;
  }

  // Create sophisticated temperature map (from freeciv create_tmap function)
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
        const heightFactor = -0.3 * Math.max(0, heightMap[i] - shoreLevel) / (maxHeight - shoreLevel);

        // Near ocean temperature can be 15% more "temperate"
        const oceanCount = this.countOceanNearTile(tiles, x, y);
        const temperateFactor = (0.15 * (this.temperatureParam / 100 - baseTemp / MAX_COLATITUDE) 
                                * 2 * Math.min(50, oceanCount) / 100);

        this.temperatureMap[i] = Math.floor(baseTemp * (1.0 + temperateFactor) * (1.0 + heightFactor));
      }
    }

    // Adjust to get evenly distributed frequencies (simplified adjust_int_map)
    this.adjustTemperatureDistribution();

    // Convert to discrete temperature types
    this.convertToTemperatureTypes();
  }

  // Adjust temperature distribution for better balance
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

  // Convert continuous temperatures to discrete types (TT_FROZEN, TT_COLD, etc.)
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

  // Check if tile has specific temperature type (like tmap_is function)
  public hasTemperatureType(x: number, y: number, tempType: TemperatureType): boolean {
    const tileTemp = this.getTemperature(x, y);
    return (tileTemp & tempType) !== 0;
  }

  // Check if any neighbor has specific temperature type
  public hasTemperatureTypeNear(x: number, y: number, tempType: TemperatureType): boolean {
    const neighbors = [
      { x: x - 1, y }, { x: x + 1, y },
      { x, y: y - 1 }, { x, y: y + 1 }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x >= 0 && neighbor.x < this.width && 
          neighbor.y >= 0 && neighbor.y < this.height) {
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

  // Enhanced terrain selection using sophisticated climate-based algorithms
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
      const lakeChance = (tileTemp & TemperatureType.TEMPERATE) ? 0.08 : 0.05;
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
      if ((tileTemp & TemperatureType.TROPICAL) && 
          (selector.terrain === 'jungle' || selector.terrain === 'swamp')) {
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
        if ((tileTemp & TemperatureType.TEMPERATE) && tileWetness > 40 && tileWetness < 80) {
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

export class MapManager {
  private width: number;
  private height: number;
  private mapData: MapData | null = null;
  private seed: string;
  private temperatureMap: TemperatureMap;

  constructor(width: number, height: number, seed?: string) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.temperatureMap = new TemperatureMap(width, height);
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
    const random = this.createSeededRandom();
    const terrainSelector = new TerrainSelectionEngine(random);

    // Phase 2: Generate climate data first
    this.generateClimateData(tiles, random);

    // Generate elevation map
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // Simple elevation based on distance from edges and random noise
        const edgeDistance = Math.min(x, y, this.width - x - 1, this.height - y - 1);
        const baseElevation = Math.max(0, edgeDistance - 5) * 4;
        const noise = (random() - 0.5) * 80;
        tiles[x][y].elevation = Math.max(0, Math.min(255, baseElevation + noise));
      }
    }

    // Apply smoothing pass
    for (let pass = 0; pass < 3; pass++) {
      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const neighbors = this.getNeighbors(tiles, x, y);
          const avgElevation =
            neighbors.reduce((sum, tile) => sum + tile.elevation, tiles[x][y].elevation) /
            (neighbors.length + 1);
          tiles[x][y].elevation = Math.round(avgElevation);
        }
      }
    }

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

  // Apply biome transition logic for natural climate boundaries (Phase 3)
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
        chance: 0.4
      },
      // Desert to grassland transitions  
      {
        from: ['desert'],
        to: 'grassland',
        transitionTerrain: 'plains',
        chance: 0.5
      },
      // Snow to tundra transitions
      {
        from: ['snow', 'glacier'],
        to: 'tundra',
        transitionTerrain: 'tundra',
        chance: 0.6
      },
      // Tundra to forest transitions
      {
        from: ['tundra'],
        to: 'forest',
        transitionTerrain: 'plains',
        chance: 0.3
      },
      // Jungle to grassland transitions
      {
        from: ['jungle'],
        to: 'grassland',
        transitionTerrain: 'forest',
        chance: 0.3
      }
    ];

    // Apply transitions in multiple passes for gradual effect
    for (let pass = 0; pass < 2; pass++) {
      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const tile = tiles[x][y];
          if (!this.isLandTile(tile)) continue;

          const neighbors = this.getNeighbors(tiles, x, y).filter(n => this.isLandTile(n));
          
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
      }
    }

    // Smooth isolated terrain patches (anti-fragmentation)
    this.smoothTerrainPatches(tiles);
  }

  // Remove small isolated terrain patches for more coherent biomes
  private smoothTerrainPatches(tiles: MapTile[][]): void {
    const minPatchSize = 3; // Minimum size for terrain patches
    
    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!this.isLandTile(tile)) continue;

        const neighbors = this.getNeighbors(tiles, x, y).filter(n => this.isLandTile(n));
        const sameTerrainNeighbors = neighbors.filter(n => n.terrain === tile.terrain).length;
        
        // If isolated or very small patch, convert to most common neighbor terrain
        if (sameTerrainNeighbors < minPatchSize) {
          const terrainCounts = new Map<TerrainType, number>();
          
          for (const neighbor of neighbors) {
            const count = terrainCounts.get(neighbor.terrain) || 0;
            terrainCounts.set(neighbor.terrain, count + 1);
          }
          
          // Find most common neighbor terrain
          let mostCommonTerrain = tile.terrain;
          let maxCount = 0;
          
          for (const [terrain, count] of terrainCounts) {
            if (count > maxCount) {
              maxCount = count;
              mostCommonTerrain = terrain;
            }
          }
          
          // Apply the change if it makes sense climatically
          if (this.isClimaticallyCompatible(tile, mostCommonTerrain)) {
            tile.terrain = mostCommonTerrain;
            tile.properties = { ...TERRAIN_PROPERTY_MAP[mostCommonTerrain] };
          }
        }
      }
    }
  }

  // Check if terrain change makes climatic sense
  private isClimaticallyCompatible(tile: MapTile, newTerrain: TerrainType): boolean {
    const currentClimate = tile.temperature;
    const newProperties = TERRAIN_PROPERTY_MAP[newTerrain];
    
    // Don't place tropical terrain in frozen zones
    if ((currentClimate & TemperatureType.FROZEN) && newProperties[TerrainProperty.TROPICAL]) {
      return false;
    }
    
    // Don't place frozen terrain in tropical zones
    if ((currentClimate & TemperatureType.TROPICAL) && newProperties[TerrainProperty.FROZEN]) {
      return false;
    }
    
    // Check wetness compatibility
    const isDryClimate = tile.wetness < 30;
    const isWetTerrain = newProperties[TerrainProperty.WET] && newProperties[TerrainProperty.WET] > 50;
    
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

        if (!visited.has(key) && this.isLandTile(tile)) {
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
      if (!this.isLandTile(tile)) {
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
    const random = this.createSeededRandom();
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
        (tiles[startX][startY].elevation < 100 || !this.isLandTile(tiles[startX][startY]))
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
    const random = this.createSeededRandom();

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!this.isLandTile(tile) || random() > 0.15) {
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

  // Enhanced climate-aware starting position evaluation (Phase 3)
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
          if (tile.resource === 'wheat' && (tile.temperature & TemperatureType.TEMPERATE)) {
            resourceScore *= 1.3; // Wheat thrives in temperate zones
          } else if (tile.resource === 'spices' && (tile.temperature & TemperatureType.TROPICAL)) {
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
      grassland: 12,  // Increased - excellent for starting
      plains: 10,     // Increased - very good base terrain  
      forest: 8,      // Good for production
      hills: 6,       // Good for mining/defense
      coast: 4,       // Decent for fishing/trade
      jungle: 3,      // Can be cleared for good land
      swamp: 2,       // Poor but can be improved
      tundra: 2,      // Cold but manageable
      desert: 1,      // Harsh conditions
      mountains: 1,   // Very poor for starting cities
      glacier: 0,     // Extremely harsh
      snow: 0,        // Extremely harsh
      lake: -1,       // Water tile
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

  private isLandTile(tile: MapTile): boolean {
    return (
      tile.terrain !== 'ocean' &&
      tile.terrain !== 'coast' &&
      tile.terrain !== 'deep_ocean' &&
      tile.terrain !== 'lake'
    );
  }

  private isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  private createSeededRandom(): () => number {
    // Simple seeded random number generator
    let seed = this.stringToSeed(this.seed);

    return function () {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  }

  private stringToSeed(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  private generateSeed(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
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

  // Climate zone mapping functions (Phase 3)
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
      case 'frozen': return TemperatureType.FROZEN;
      case 'cold': return TemperatureType.COLD;
      case 'tropical': return TemperatureType.TROPICAL;
      default: return TemperatureType.TEMPERATE;
    }
  }

  // Enhanced climate-aware terrain evaluation
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
      { x: x - 1, y }, { x: x + 1, y },
      { x, y: y - 1 }, { x, y: y + 1 }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x >= 0 && neighbor.x < this.width && 
          neighbor.y >= 0 && neighbor.y < this.height) {
        const neighborTemp = this.temperatureMap.getTemperature(neighbor.x, neighbor.y);
        if (neighborTemp !== centerTemp) {
          return true; // Found climate variety
        }
      }
    }
    return false;
  }
}
