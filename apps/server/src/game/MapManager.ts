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

  // Select terrain based on tile properties, temperature, and wetness
  public pickTerrain(
    tileTemp: TemperatureType,
    tileWetness: number,
    elevation: number
  ): TerrainType {
    // Water terrains based on elevation (like phase 1 but with properties)
    if (elevation < 10) return 'deep_ocean';
    if (elevation < 20) return 'ocean';
    if (elevation < 30) return 'coast';

    // Occasional inland lakes in low wet areas
    if (elevation < 50 && tileWetness > 80 && this.random() < 0.05) {
      return 'lake';
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

      // Calculate terrain fitness score
      const properties = TERRAIN_PROPERTY_MAP[selector.terrain];
      let score = selector.weight;

      // Target property bonus
      const targetValue = properties[selector.target] || 0;
      score += targetValue * 0.5;

      // Prefer property bonus
      const preferValue = properties[selector.prefer] || 0;
      score += preferValue * 0.3;

      // Avoid property penalty
      const avoidValue = properties[selector.avoid] || 0;
      score -= avoidValue * 0.4;

      // Elevation modifiers
      if (selector.terrain === 'mountains' || selector.terrain === 'hills') {
        score += Math.max(0, elevation - 100) * 0.2;
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

  constructor(width: number, height: number, seed?: string) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
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
  }

  private generateClimateData(tiles: MapTile[][], random: () => number): void {
    // Generate temperature map based on latitude (y position)
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Calculate latitude factor (0 = equator, 1 = poles)
        const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);

        // Base temperature zones with some randomness
        const tempNoise = (random() - 0.5) * 0.3;
        const adjustedLatitude = Math.max(0, Math.min(1, latitudeFactor + tempNoise));

        if (adjustedLatitude < 0.2) {
          tile.temperature = TemperatureType.TROPICAL;
        } else if (adjustedLatitude < 0.5) {
          tile.temperature = TemperatureType.TEMPERATE;
        } else if (adjustedLatitude < 0.8) {
          tile.temperature = TemperatureType.COLD;
        } else {
          tile.temperature = TemperatureType.FROZEN;
        }

        // Generate wetness map with some continental effects
        const distanceFromEdge = Math.min(x, y, this.width - x - 1, this.height - y - 1);
        const continentalEffect = Math.max(0, (distanceFromEdge - 10) * 2); // Drier inland
        const baseWetness = 50 + (random() - 0.5) * 60; // 20-80 base range
        tile.wetness = Math.max(0, Math.min(100, baseWetness - continentalEffect));
      }
    }

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

  private evaluateStartingPosition(tiles: MapTile[][], x: number, y: number): number {
    let score = 0;
    const radius = 3;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (!this.isValidCoord(nx, ny)) continue;

        const tile = tiles[nx][ny];
        const distance = Math.sqrt(dx * dx + dy * dy);
        const weight = Math.max(0, 1 - distance / radius);

        // Terrain scoring
        const terrainScores: Record<TerrainType, number> = {
          grassland: 10,
          plains: 8,
          forest: 6,
          hills: 4,
          coast: 3,
          jungle: 2,
          swamp: 2,
          desert: 1,
          tundra: 1,
          glacier: 0,
          snow: 0,
          mountains: 0,
          lake: -2,
          deep_ocean: -5,
          ocean: -5,
        };

        score += terrainScores[tile.terrain] * weight;

        // Resource bonus
        if (tile.resource) {
          score += 15 * weight;
        }

        // River bonus
        if (tile.riverMask > 0) {
          score += 8 * weight;
        }
      }
    }

    return score;
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
}
