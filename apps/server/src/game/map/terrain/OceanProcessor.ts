/**
 * Ocean and water processing algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c ocean and water processing
 * Handles ocean depth smoothing, ocean type selection, and water body identification
 */
import { MapTile, TerrainType } from '../MapTypes';
import { isOceanTerrain, isFrozenTerrain, isLandTile } from '../TerrainUtils';

/**
 * Handles ocean depth processing, water body identification, and ocean terrain selection
 * Extracted from TerrainGenerator for better separation of concerns
 * @reference freeciv/server/generator/mapgen.c ocean processing logic
 */
export class OceanProcessor {
  private width: number;
  private height: number;
  private random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /**
   * Process a single tile for ocean type assignment based on depth
   */
  private processOceanTileByDepth(tile: MapTile): void {
    if (!isOceanTerrain(tile.terrain)) {
      return;
    }

    // Calculate depth based on elevation (lower elevation = deeper)
    const elevation = tile.elevation || 0;
    const depth = Math.max(0, 255 - elevation);

    // Determine if tile should be frozen
    const isFrozen = isFrozenTerrain(tile.terrain);
    const newOceanType = this.pickOcean(depth, isFrozen);

    if (newOceanType && newOceanType !== tile.terrain) {
      tile.terrain = newOceanType as TerrainType;
    }
  }

  /**
   * Process a single tile for ocean type smoothing
   */
  private processOceanTileSmoothing(tiles: MapTile[][], x: number, y: number): void {
    const tile = tiles[x][y];

    if (!isOceanTerrain(tile.terrain)) {
      return;
    }

    const mostCommonAdjacentOcean = this.getMostAdjacentOceanType(tiles, x, y);
    if (!mostCommonAdjacentOcean || mostCommonAdjacentOcean === tile.terrain) {
      return;
    }

    // Apply smoothing with some randomness to avoid uniform patches
    if (this.random() < 0.6) {
      tile.terrain = mostCommonAdjacentOcean as TerrainType;
    }
  }

  /**
   * Process a single tile for distance-based ocean type assignment
   */
  private processOceanTileDistanceBased(tiles: MapTile[][], x: number, y: number): void {
    const tile = tiles[x][y];

    if (!isOceanTerrain(tile.terrain)) {
      return;
    }

    const distanceToCoast = this.calculateDistanceToCoast(tiles, x, y);

    // Deep ocean should be further from coast
    if (distanceToCoast > 3 && tile.terrain === 'coast' && this.random() < 0.4) {
      tile.terrain = 'ocean' as TerrainType;
    } else if (distanceToCoast > 6 && tile.terrain === 'ocean' && this.random() < 0.3) {
      tile.terrain = 'deep_ocean' as TerrainType;
    }
  }

  /**
   * Smooth water depth for realistic ocean depth transitions
   * @reference freeciv/server/generator/mapgen.c ocean depth processing
   */
  public smoothWaterDepth(tiles: MapTile[][]): void {
    const maxPasses = 3;

    for (let pass = 0; pass < maxPasses; pass++) {
      // Pass 1: Set ocean types based on depth
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          this.processOceanTileByDepth(tiles[x][y]);
        }
      }

      // Pass 2: Smooth transitions between adjacent ocean types
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          this.processOceanTileSmoothing(tiles, x, y);
        }
      }

      // Pass 3: Distance-based smoothing from coast
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          this.processOceanTileDistanceBased(tiles, x, y);
        }
      }
    }
  }

  /**
   * Check if a tile has ocean neighbors
   */
  public hasOceanNeighbor(tiles: MapTile[][], x: number, y: number): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (isOceanTerrain(tiles[nx][ny].terrain)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Check if there's land at the given coordinates
   */
  private isCoordinateInBoundsWithLand(tiles: MapTile[][], x: number, y: number): boolean {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }
    return isLandTile(tiles[x][y].terrain);
  }

  /**
   * Check if land exists at perimeter of search square at given distance
   */
  private findLandAtDistance(
    tiles: MapTile[][],
    centerX: number,
    centerY: number,
    distance: number
  ): boolean {
    for (let dx = -distance; dx <= distance; dx++) {
      for (let dy = -distance; dy <= distance; dy++) {
        // Only check perimeter of search square
        if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) {
          continue;
        }

        const nx = centerX + dx;
        const ny = centerY + dy;

        if (this.isCoordinateInBoundsWithLand(tiles, nx, ny)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Calculate distance to nearest coastal land
   */
  private calculateDistanceToCoast(tiles: MapTile[][], x: number, y: number): number {
    const maxSearchDistance = 10;

    for (let distance = 1; distance <= maxSearchDistance; distance++) {
      if (this.findLandAtDistance(tiles, x, y, distance)) {
        return distance;
      }
    }

    return maxSearchDistance;
  }

  /**
   * Pick appropriate ocean type based on depth and temperature
   * @reference freeciv/server/generator/mapgen.c ocean type selection
   */
  private pickOcean(depth: number, _isFrozen: boolean): string | null {
    // Ocean type selection based on depth
    // Shallow areas become coast, medium becomes ocean, deep becomes deep_ocean
    const oceanTerrains = [
      { type: 'coast', minDepth: 0, maxDepth: 80 },
      { type: 'ocean', minDepth: 60, maxDepth: 180 },
      { type: 'deep_ocean', minDepth: 150, maxDepth: 255 },
    ];

    let bestTerrain: string | null = null;
    let bestScore = -1;

    for (const terrain of oceanTerrains) {
      if (depth >= terrain.minDepth && depth <= terrain.maxDepth) {
        const score =
          Math.random() * 100 +
          (terrain.maxDepth - Math.abs(depth - (terrain.minDepth + terrain.maxDepth) / 2));
        if (score > bestScore) {
          bestScore = score;
          bestTerrain = terrain.type;
        }
      }
    }

    return bestTerrain;
  }

  /**
   * Get the most common adjacent ocean type for smoothing
   * @reference freeciv/server/generator/mapgen.c ocean smoothing
   */
  private getMostAdjacentOceanType(tiles: MapTile[][], x: number, y: number): string | null {
    const oceanTypeCounts: Record<string, number> = {};

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborTerrain = tiles[nx][ny].terrain;
          if (isOceanTerrain(neighborTerrain)) {
            oceanTypeCounts[neighborTerrain] = (oceanTypeCounts[neighborTerrain] || 0) + 1;
          }
        }
      }
    }

    // Find most common ocean type, preferring deeper waters
    const oceanTerrainTypes = ['coast', 'ocean', 'deep_ocean'];
    let mostCommon: string | null = null;
    let maxCount = 0;

    for (const terrainType of oceanTerrainTypes) {
      const count = oceanTypeCounts[terrainType] || 0;
      if (count > maxCount || (count === maxCount && terrainType === 'deep_ocean')) {
        maxCount = count;
        mostCommon = terrainType;
      }
    }

    return maxCount >= 2 ? mostCommon : null; // Require at least 2 neighbors
  }

  /**
   * Identify separate ocean bodies for lake generation
   * @reference freeciv/server/generator/mapgen.c ocean body identification
   */
  public identifyOceanBodies(tiles: MapTile[][]): Array<{ tiles: MapTile[]; id: number }> {
    const visited: boolean[][] = Array(this.width)
      .fill(null)
      .map(() => Array(this.height).fill(false));

    const oceanBodies: Array<{ tiles: MapTile[]; id: number }> = [];
    let oceanBodyId = 1;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!isOceanTerrain(tile.terrain)) continue;
        if (visited[x][y]) continue;

        const oceanTiles: MapTile[] = [];
        this.floodFillOceanBody(tiles, x, y, visited, oceanTiles);

        if (oceanTiles.length > 0) {
          oceanBodies.push({
            tiles: oceanTiles,
            id: oceanBodyId++,
          });
        }
      }
    }

    return oceanBodies;
  }

  /**
   * Flood fill to identify connected ocean tiles
   * @reference freeciv/server/generator/mapgen.c flood fill for ocean bodies
   */
  private floodFillOceanBody(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    visited: boolean[][],
    oceanTiles: MapTile[]
  ): void {
    const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;

      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      if (visited[x][y]) continue;

      const tile = tiles[x][y];
      if (!isOceanTerrain(tile.terrain)) {
        continue;
      }

      visited[x][y] = true;
      oceanTiles.push(tile);

      // Add neighboring tiles to stack
      stack.push({ x: x - 1, y });
      stack.push({ x: x + 1, y });
      stack.push({ x, y: y - 1 });
      stack.push({ x, y: y + 1 });
    }
  }

  /**
   * Regenerate small ocean bodies as lakes
   * @reference freeciv/server/generator/mapgen.c lake generation
   */
  public regenerateLakes(tiles: MapTile[][]): void {
    const oceanBodies = this.identifyOceanBodies(tiles);

    // Convert small ocean bodies to lakes
    oceanBodies.forEach(oceanBody => {
      // Small ocean bodies (< 20 tiles) become lakes
      if (oceanBody.tiles.length < 20) {
        oceanBody.tiles.forEach(tile => {
          const currentTerrain = tile.terrain;

          // Only convert if it makes sense climatically
          if (!isFrozenTerrain(currentTerrain)) {
            tile.terrain = 'lake' as TerrainType;
          }
        });
      }
    });
  }
}
