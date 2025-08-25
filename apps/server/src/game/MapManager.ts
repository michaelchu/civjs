/* eslint-disable complexity */
import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';

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
}

export interface MapData {
  width: number;
  height: number;
  tiles: MapTile[][];
  startingPositions: Array<{ x: number; y: number; playerId: string }>;
  seed: string;
  generatedAt: Date;
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
    };
  }

  private async generateTerrain(tiles: MapTile[][]): Promise<void> {
    // Simple terrain generation using elevation-based rules
    // In a real implementation, you'd use Perlin noise or similar

    const random = this.createSeededRandom();

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

    // Assign terrain based on elevation
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const elevation = tile.elevation;
        const randomFactor = random();

        if (elevation < 10) {
          tile.terrain = 'deep_ocean';
        } else if (elevation < 20) {
          tile.terrain = 'ocean';
        } else if (elevation < 30) {
          tile.terrain = 'coast';
        } else if (elevation < 80) {
          // Low elevation - fertile areas
          const isNearEdge = x < 5 || y < 5 || x > this.width - 6 || y > this.height - 6;
          if (randomFactor < 0.35) tile.terrain = 'grassland';
          else if (randomFactor < 0.6) tile.terrain = 'plains';
          else if (randomFactor < 0.75) tile.terrain = 'forest';
          else if (randomFactor < 0.85) tile.terrain = 'jungle';
          else if (!isNearEdge && elevation < 40) tile.terrain = 'swamp'; // Inland swamps in very low areas
          else if (!isNearEdge && randomFactor < 0.95) tile.terrain = 'lake'; // Occasional inland lakes
          else tile.terrain = 'grassland';
        } else if (elevation < 150) {
          // Medium elevation
          if (randomFactor < 0.3) tile.terrain = 'plains';
          else if (randomFactor < 0.5) tile.terrain = 'hills';
          else if (randomFactor < 0.7) tile.terrain = 'desert';
          else tile.terrain = 'forest';
        } else if (elevation < 200) {
          // High elevation
          const isNearPole = y < 10 || y > this.height - 11; // Simple pole approximation
          if (isNearPole && randomFactor < 0.3) tile.terrain = 'glacier';
          else if (randomFactor < 0.5) tile.terrain = 'hills';
          else if (randomFactor < 0.7) tile.terrain = 'mountains';
          else if (randomFactor < 0.9) tile.terrain = 'tundra';
          else tile.terrain = 'snow';
        } else {
          // Very high elevation
          const isNearPole = y < 10 || y > this.height - 11; // Simple pole approximation
          if (isNearPole && randomFactor < 0.4) tile.terrain = 'glacier';
          else if (randomFactor < 0.7) tile.terrain = 'mountains';
          else if (randomFactor < 0.9) tile.terrain = 'tundra';
          else tile.terrain = 'snow';
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
          desert: 1,
          tundra: 1,
          snow: 0,
          mountains: 0,
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
    return tile.terrain !== 'ocean' && tile.terrain !== 'coast' && 
           tile.terrain !== 'deep_ocean' && tile.terrain !== 'lake';
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
