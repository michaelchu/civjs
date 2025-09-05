/**
 * Height map processing algorithms extracted from TerrainGenerator
 * @reference freeciv/server/generator/height_map.c
 * @reference freeciv/server/generator/mapgen.c
 *
 * This class handles height map to tile conversion, pole normalization,
 * and height-based terrain processing algorithms from freeciv.
 */
import { MapTile } from '@game/map/MapTypes';
import { TemperatureMap } from '@game/map/TemperatureMap';

export class HeightMapProcessor {
  private width: number;
  private height: number;

  constructor(width: number, height: number, _random: () => number) {
    this.width = width;
    this.height = height;
    // _random parameter kept for future extensibility but not currently used
  }

  /**
   * Copy height map values to tile altitude properties
   * @reference freeciv/server/generator/height_map.c height_map_to_map()
   * Exact copy of freeciv height map transfer algorithm
   */
  public heightMapToMap(tiles: MapTile[][], heightMap: number[]): void {
    // Copy height map values to tile altitude
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }
    // Note: wld.map.altitude_info = TRUE; is implicit in our implementation
  }

  /**
   * Check if the map has polar regions requiring normalization
   * @reference freeciv/server/generator/mapgen.c HAS_POLES macro
   */
  public hasPoles(): boolean {
    // For now, assume all maps have poles unless specifically disabled
    // In freeciv, this checks for wld.map.server.world_edges
    return true;
  }

  /**
   * Normalize height map at poles to prevent excessive land formation
   * @reference freeciv/server/generator/height_map.c:165-172 normalize_hmap_poles()
   * Exact copy of freeciv pole normalization algorithm
   */
  public normalizeHmapPoles(heightMap: number[], _tiles: MapTile[][]): void {
    const ICE_BASE_LEVEL = 200; // From freeciv mapgen_topology.h
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500

    // Create TemperatureMap instance for colatitude calculation
    const tempMap = new TemperatureMap(this.width, this.height);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        const colatitude = tempMap.mapColatitude(x, y);

        if (colatitude <= POLAR_THRESHOLD) {
          // Apply pole factor to reduce height
          // @reference freeciv/server/generator/height_map.c:165-170
          const poleFactor = this.hmapPoleFactor(colatitude, x, y);
          heightMap[index] = Math.floor(heightMap[index] * poleFactor);
        } else if (this.nearSingularity(x, y)) {
          // Near map edge but not near pole - set to minimum height
          // @reference freeciv/server/generator/height_map.c:170-171
          heightMap[index] = 0;
        }
      }
    }
  }

  /**
   * Renormalize height map at poles after terrain generation
   * @reference freeciv/server/generator/height_map.c:178-192 renormalize_hmap_poles()
   * Exact copy of freeciv pole renormalization algorithm
   */
  public renormalizeHmapPoles(heightMap: number[], _tiles: MapTile[][]): void {
    const ICE_BASE_LEVEL = 200;
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500

    // Create TemperatureMap instance for colatitude calculation
    const tempMap = new TemperatureMap(this.width, this.height);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;

        if (heightMap[index] === 0) {
          // Nothing left to restore
          // @reference freeciv/server/generator/height_map.c:181-182
          continue;
        }

        const colatitude = tempMap.mapColatitude(x, y);

        if (colatitude <= POLAR_THRESHOLD) {
          const factor = this.hmapPoleFactor(colatitude, x, y);

          if (factor > 0) {
            // Invert the previously applied function
            // @reference freeciv/server/generator/height_map.c:186-189
            heightMap[index] = Math.floor(heightMap[index] / factor);
          }
        }
      }
    }
  }

  /**
   * Calculate local average elevation around a given position
   * @reference freeciv/server/generator/fracture_map.c:268-284 local_ave_elevation()
   * Used for terrain smoothing and placement decisions
   * Uses square_iterate with radius 3 (7x7 neighborhood) from freeciv
   */
  public localAveElevation(heightMap: number[], x: number, y: number): number {
    let ele = 0;
    let count = 0;

    // Check 7x7 neighborhood (radius 3) to match freeciv's square_iterate(ptile, 3)
    // @reference freeciv/server/generator/fracture_map.c:274-277
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const index = ny * this.width + nx;
          ele += heightMap[index];
          count++;
        }
      }
    }

    return count > 0 ? ele / count : 0;
  }

  /**
   * Apply height-based constraints to prevent unrealistic terrain formations
   * Used internally by terrain generation algorithms
   */
  public validateHeightConstraints(
    tiles: MapTile[][],
    heightMap: number[],
    shoreLevel: number
  ): boolean {
    let validTiles = 0;
    let totalTiles = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        const tileHeight = heightMap[index];
        totalTiles++;

        // Check if height matches expected terrain type
        if (tileHeight < shoreLevel && tiles[x][y].terrain.includes('ocean')) {
          validTiles++;
        } else if (tileHeight >= shoreLevel && !tiles[x][y].terrain.includes('ocean')) {
          validTiles++;
        }
      }
    }

    // Return true if at least 90% of tiles have consistent height-terrain mapping
    return validTiles / totalTiles >= 0.9;
  }

  /**
   * Calculate height reduction factor for polar regions
   * @reference freeciv/server/generator/height_map.c:133-150 hmap_pole_factor()
   * Used internally by pole normalization methods
   */
  private hmapPoleFactor(colatitude: number, x: number, y: number): number {
    const ICE_BASE_LEVEL = 200;
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500
    const flatpoles = 100; // Default flatpoles parameter (0-100)
    let factor = 1.0;

    if (this.nearSingularity(x, y)) {
      // Map edge near pole: clamp to what linear ramp would give us at pole
      // @reference freeciv/server/generator/height_map.c:138-141
      factor = (100 - flatpoles) / 100.0;
    } else if (flatpoles > 0) {
      // Linear ramp down from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles) % at the poles
      // @reference freeciv/server/generator/height_map.c:142-145
      factor = 1 - ((1 - colatitude / POLAR_THRESHOLD) * flatpoles) / 100;
    }

    // Additional reduction for separate poles (simplified)
    // @reference freeciv/server/generator/height_map.c:146-150
    if (colatitude >= 2 * ICE_BASE_LEVEL) {
      factor = Math.min(factor, 0.1);
    }

    return Math.max(0, factor);
  }

  /**
   * Check if position is near map edge singularity
   * @reference freeciv/server/generator/mapgen_topology.c:53-56 near_singularity()
   * Used for pole processing edge cases
   */
  private nearSingularity(x: number, y: number): boolean {
    const CITY_MAP_DEFAULT_RADIUS = 2; // From freeciv
    const edgeDistance = Math.min(x, this.width - 1 - x, y, this.height - 1 - y);
    return edgeDistance <= CITY_MAP_DEFAULT_RADIUS;
  }

  /**
   * Get height statistics for debugging and validation
   */
  public getHeightStatistics(heightMap: number[]): {
    min: number;
    max: number;
    avg: number;
    median: number;
  } {
    const sortedHeights = [...heightMap].sort((a, b) => a - b);
    const min = sortedHeights[0];
    const max = sortedHeights[sortedHeights.length - 1];
    const avg = heightMap.reduce((sum, h) => sum + h, 0) / heightMap.length;
    const median = sortedHeights[Math.floor(sortedHeights.length / 2)];

    return { min, max, avg, median };
  }
}
