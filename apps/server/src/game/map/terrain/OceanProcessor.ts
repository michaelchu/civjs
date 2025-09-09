/**
 * Ocean and water processing algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c ocean and water processing
 * Handles ocean depth smoothing, ocean type selection, and water body identification
 */
import { MapTile, TerrainType } from '@game/map/MapTypes';
import { isOceanTerrain, isFrozenTerrain, isLandTile } from '@game/map/TerrainUtils';

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
   * Smooth water depth for realistic ocean depth transitions
   * @reference freeciv/server/generator/mapgen_utils.c:591 smooth_water_depth()
   * Enhanced implementation matching freeciv's two-phase approach
   */
  public smoothWaterDepth(tiles: MapTile[][]): void {
    // Constants from freeciv reference
    const OCEAN_DEPTH_STEP = 25;
    const OCEAN_DEPTH_RAND = 15;
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100;
    const OCEAN_DIST_MAX = Math.floor(TERRAIN_OCEAN_DEPTH_MAXIMUM / OCEAN_DEPTH_STEP);

    // Phase 1: Distance-based depth assignment (freeciv first pass)
    // "First, improve the coasts."
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!isOceanTerrain(tile.terrain)) {
          continue;
        }

        const dist = this.realDistanceToLand(tiles, x, y, OCEAN_DIST_MAX);
        if (dist <= OCEAN_DIST_MAX) {
          // Calculate depth based on distance to land with randomness
          const depth = dist * OCEAN_DEPTH_STEP + Math.floor(this.random() * OCEAN_DEPTH_RAND);
          const isFrozen = isFrozenTerrain(tile.terrain);
          const newOceanType = this.pickOceanByDepth(depth, isFrozen);

          if (newOceanType && newOceanType !== tile.terrain) {
            tile.terrain = newOceanType as TerrainType;
          }
        }
      }
    }

    // Phase 2: Adjacent type smoothing (freeciv second pass)
    // "Now, try to have something more continuous."
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!isOceanTerrain(tile.terrain)) {
          continue;
        }

        const mostCommonOcean = this.mostAdjacentOceanType(tiles, x, y);
        if (mostCommonOcean && mostCommonOcean !== tile.terrain) {
          tile.terrain = mostCommonOcean as TerrainType;
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
   * Calculate real distance to nearest land tile
   * @reference freeciv/server/generator/mapgen_utils.c:550 real_distance_to_land()
   * Enhanced implementation using proper euclidean distance calculation
   */
  private realDistanceToLand(
    tiles: MapTile[][],
    x: number,
    y: number,
    maxDistance: number
  ): number {
    // Search in expanding squares (like freeciv square_dxy_iterate)
    for (let distance = 1; distance <= maxDistance; distance++) {
      for (let dx = -distance; dx <= distance; dx++) {
        for (let dy = -distance; dy <= distance; dy++) {
          // Only check the perimeter of the current distance square
          if (Math.abs(dx) !== distance && Math.abs(dy) !== distance) {
            continue;
          }

          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            if (isLandTile(tiles[nx][ny].terrain)) {
              // Return real euclidean distance (like freeciv map_vector_to_real_distance)
              return Math.sqrt(dx * dx + dy * dy);
            }
          }
        }
      }
    }

    return maxDistance + 1;
  }

  /**
   * Pick ocean terrain based on depth (freeciv-compliant depth thresholds)
   * @reference freeciv/server/generator/mapgen_utils.c:608 pick_ocean()
   * Uses freeciv's depth-based terrain selection with proper thresholds
   */
  private pickOceanByDepth(depth: number, _isFrozen: boolean): string | null {
    // Freeciv-based depth thresholds for ocean terrain types
    // These values are tuned to create natural coastal transitions

    if (depth <= 25) {
      return 'coast'; // Shallow coastal waters
    } else if (depth <= 50) {
      return 'ocean'; // Medium depth ocean
    } else {
      return 'deep_ocean'; // Deep ocean waters
    }

    // Note: Frozen ocean handling would go here in full implementation
    // For now, we focus on the depth-based selection
  }

  /**
   * Determines what is the most popular ocean type around (freeciv 2/3 majority rule)
   * @reference freeciv/server/generator/mapgen_utils.c:565 most_adjacent_ocean_type()
   * Exact implementation of freeciv's adjacent ocean type detection
   */
  private mostAdjacentOceanType(tiles: MapTile[][], x: number, y: number): string | null {
    // freeciv: const int need = 2 * MAP_NUM_VALID_DIRS / 3;
    // MAP_NUM_VALID_DIRS is typically 8 (8 directions), so need = 5.33 -> 5
    const need = Math.floor((2 * 8) / 3); // Require 5 out of 8 neighbors (2/3 majority)

    const oceanTerrainTypes = ['coast', 'ocean', 'deep_ocean'];

    for (const terrainType of oceanTerrainTypes) {
      let count = 0;

      // Check all 8 adjacent tiles (like freeciv adjc_iterate)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue; // Skip center

          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            if (tiles[nx][ny].terrain === terrainType) {
              count++;
              if (count >= need) {
                return terrainType; // Early return when threshold met
              }
            }
          }
        }
      }
    }

    return null; // No terrain type has 2/3 majority
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
