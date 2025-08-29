import { logger } from '../../utils/logger';
import { MapTile, TerrainType, TerrainProperty } from './MapTypes';

/**
 * River map state tracking for sophisticated river generation
 * @reference freeciv/server/generator/mapgen.c:115-118
 */
export interface RiverMapState {
  blocked: Set<number>; // Tiles marked as blocked for river placement
  ok: Set<number>; // Tiles marked as valid river tiles
}

export class RiverGenerator {
  private width: number;
  private height: number;
  private random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /**
   * Generate advanced river system using freeciv algorithm
   * @reference freeciv/server/generator/mapgen.c:906-950 make_rivers()
   */
  public async generateAdvancedRivers(tiles: MapTile[][], riverPct: number): Promise<void> {
    logger.info(`Starting advanced river generation with ${riverPct.toFixed(1)}% target density`);
    const startTime = Date.now();

    // Create river map state
    const riverMap: RiverMapState = {
      blocked: new Set<number>(),
      ok: new Set<number>(),
    };

    // FREECIV ALGORITHM: Calculate desirable river length using exact formula
    // @reference freeciv/server/generator/mapgen.c:915-924
    const mapNumTiles = this.width * this.height;
    const landPercent = this.calculateLandPercent(tiles);

    const desirableRiverLength = Math.floor((riverPct * mapNumTiles * landPercent) / 5325);

    // The number of river tiles that have been set
    let currentRiverLength = 0;

    // Iteration counter to prevent infinite loops
    let iterationCounter = 0;
    const RIVERS_MAXTRIES = 32767; // @reference freeciv/server/generator/mapgen.c

    logger.info(
      `Target river length: ${desirableRiverLength} tiles (${riverPct}% of ${mapNumTiles} tiles * ${landPercent}% land / 5325)`
    );

    // FREECIV MAIN LOOP: Generate rivers until target length reached
    // @reference freeciv/server/generator/mapgen.c:946-947
    while (currentRiverLength < desirableRiverLength && iterationCounter < RIVERS_MAXTRIES) {
      // Find suitable river spring location (highland preference)
      const springLocation = this.findRiverSpring(tiles, riverMap, iterationCounter);
      if (!springLocation) {
        break; // No more suitable spring places
      }

      // Reset river map before making a new river (freeciv line 993-994)
      riverMap.blocked.clear();
      riverMap.ok.clear();

      // Try to make a river. If it is OK, apply it to the map (freeciv lines 1012-1030)
      if (this.makeRiver(springLocation.x, springLocation.y, tiles, riverMap)) {
        // Apply all river tiles from rivermap.ok to actual map
        const riverTilesApplied = this.applyRiverMapToTiles(tiles, riverMap);
        currentRiverLength += riverTilesApplied;
      }

      iterationCounter++;
    }

    const endTime = Date.now();
    const landTiles = tiles.flat().filter(tile => this.isLandTile(tile.terrain)).length;
    const actualRiverPct = landTiles > 0 ? (currentRiverLength / landTiles) * 100 : 0;
    logger.info(
      `Advanced river generation completed: ${currentRiverLength}/${desirableRiverLength} river tiles (${actualRiverPct.toFixed(1)}% density) in ${iterationCounter} iterations, ${endTime - startTime}ms`
    );
  }

  /**
   * Calculate land percentage for freeciv formula
   * @reference freeciv/server/generator/mapgen.c:920 wld.map.server.landpercent
   */
  private calculateLandPercent(tiles: MapTile[][]): number {
    const totalTiles = this.width * this.height;
    const landTiles = tiles.flat().filter(tile => this.isLandTile(tile.terrain)).length;
    return Math.floor((landTiles / totalTiles) * 100);
  }

  /**
   * Find suitable river spring location using freeciv criteria
   * @reference freeciv/server/generator/mapgen.c:949-952 rand_map_pos_characteristic
   */
  private findRiverSpring(
    tiles: MapTile[][],
    riverMap: RiverMapState,
    iterationCounter: number
  ): { x: number; y: number } | null {
    // Try random locations to find suitable spring
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);

      if (this.isValidRiverSpring(x, y, tiles, riverMap, iterationCounter)) {
        return { x, y };
      }
    }

    return null; // No suitable spring found
  }

  /**
   * Check if location is valid for river spring using freeciv criteria
   * @reference freeciv/server/generator/mapgen.c:957-990
   */
  private isValidRiverSpring(
    x: number,
    y: number,
    tiles: MapTile[][],
    _riverMap: RiverMapState,
    iterationCounter: number
  ): boolean {
    const tile = tiles[x][y];
    const terrain = tile.terrain;
    const RIVERS_MAXTRIES = 32767;

    // Don't start a river on ocean
    if (!this.isLandTile(terrain)) {
      return false;
    }

    // Don't start a river on river (tile already has riverMask)
    if (tile.riverMask && tile.riverMask > 0) {
      return false;
    }

    // Count nearby rivers and ocean tiles
    const nearbyRivers = this.countRiverNearTile(x, y, tiles);
    const nearbyOcean = this.countOceanNearTile(x, y, tiles);

    // Don't start a river on a tile surrounded by > 1 river + ocean tile
    if (nearbyRivers + nearbyOcean > 1) {
      return false;
    }

    // Get terrain properties
    const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
    const frozen = tile.properties[TerrainProperty.FROZEN] || 0;
    const dry = tile.properties[TerrainProperty.DRY] || 0;

    // Count mountainous terrain nearby
    const nearbyMountainous = this.countMountainousNearTile(x, y, tiles);

    // Don't start a river on a tile that is surrounded by hills or mountains
    // unless it is hard to find somewhere else to start it
    if (nearbyMountainous >= 90 && iterationCounter < Math.floor((RIVERS_MAXTRIES / 10) * 5)) {
      return false;
    }

    // Don't start a river on hills unless it is hard to find somewhere else
    if (mountainous > 0 && iterationCounter < Math.floor((RIVERS_MAXTRIES / 10) * 6)) {
      return false;
    }

    // Don't start a river on arctic unless it is hard to find somewhere else
    if (frozen > 0 && iterationCounter < Math.floor((RIVERS_MAXTRIES / 10) * 8)) {
      return false;
    }

    // Don't start a river on desert unless it is hard to find somewhere else
    if (dry > 0 && iterationCounter < Math.floor((RIVERS_MAXTRIES / 10) * 9)) {
      return false;
    }

    return true;
  }

  /**
   * Count rivers near tile (freeciv: count_river_near_tile)
   */
  private countRiverNearTile(x: number, y: number, tiles: MapTile[][]): number {
    let count = 0;
    const cardinalDirs = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (tiles[nx][ny].riverMask && tiles[nx][ny].riverMask > 0) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Count ocean tiles near tile (freeciv: count_terrain_class_near_tile)
   */
  private countOceanNearTile(x: number, y: number, tiles: MapTile[][]): number {
    let count = 0;
    const cardinalDirs = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (!this.isLandTile(tiles[nx][ny].terrain)) {
          count++;
        }
      }
    }
    return count;
  }

  /**
   * Count mountainous terrain near tile (freeciv: count_terrain_property_near_tile)
   */
  private countMountainousNearTile(x: number, y: number, tiles: MapTile[][]): number {
    let totalMountainous = 0;
    const cardinalDirs = [
      { dx: 0, dy: -1 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const mountainous = tiles[nx][ny].properties[TerrainProperty.MOUNTAINOUS] || 0;
        totalMountainous += mountainous;
      }
    }
    return totalMountainous;
  }

  /**
   * Apply river tiles from riverMap to actual map tiles
   * @reference freeciv/server/generator/mapgen.c:1013-1030
   */
  private applyRiverMapToTiles(tiles: MapTile[][], riverMap: RiverMapState): number {
    let tilesApplied = 0;

    // Iterate through all tiles marked as river in rivermap.ok
    for (const tileIndex of riverMap.ok) {
      const x = tileIndex % this.width;
      const y = Math.floor(tileIndex / this.width);

      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        const tile = tiles[x][y];

        // Check if terrain can have rivers (freeciv: TER_CAN_HAVE_RIVER)
        if (!this.terrainCanHaveRiver(tile.terrain)) {
          // Change terrain to one that can have rivers (freeciv: pick_terrain_by_flag)
          const newTerrain = this.pickTerrainForRiver(tile.terrain);
          tile.terrain = newTerrain as TerrainType;
        }

        // Add river to tile
        const riverMask = this.generateRiverMask(x, y, tiles, riverMap);
        tile.riverMask = riverMask;

        tilesApplied++;
      }
    }

    return tilesApplied;
  }

  /**
   * Check if terrain can have rivers
   */
  private terrainCanHaveRiver(terrain: TerrainType): boolean {
    // Most land terrains can have rivers, except some special cases
    return this.isLandTile(terrain) && terrain !== 'mountains';
  }

  /**
   * Pick suitable terrain for river placement
   */
  private pickTerrainForRiver(originalTerrain: TerrainType): TerrainType {
    // Convert terrain to river-compatible type
    if (originalTerrain === 'mountains') {
      return 'hills';
    }
    if (originalTerrain === 'desert') {
      return 'plains';
    }
    return originalTerrain; // Most terrains are fine
  }

  /**
   * Generate individual river from spring point using freeciv algorithm
   * @reference freeciv/server/generator/mapgen.c:792-851 make_river()
   */
  private makeRiver(
    startX: number,
    startY: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): boolean {
    let currentX = startX;
    let currentY = startY;
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;

    while (iterations < maxIterations) {
      // Mark the current tile as river in rivermap (freeciv line 806)
      const tileIndex = currentY * this.width + currentX;
      riverMap.ok.add(tileIndex);

      // Test if the river is done (freeciv lines 812-820)
      if (this.isRiverComplete(currentX, currentY, tiles)) {
        return true; // River successfully completed
      }

      // Find next direction to continue the river (freeciv lines 822-851)
      const nextTile = this.findBestRiverDirection(currentX, currentY, tiles, riverMap);
      if (!nextTile) {
        return false; // River failed - got stuck
      }

      currentX = nextTile.x;
      currentY = nextTile.y;
      iterations++;
    }

    return false; // River failed - too many iterations
  }

  /**
   * Check if river is complete (reached water or existing river)
   * @reference freeciv/server/generator/mapgen.c:812-820
   */
  private isRiverComplete(x: number, y: number, tiles: MapTile[][]): boolean {
    // River ends if it connects to existing river
    if (this.countRiverNearTile(x, y, tiles) > 0) {
      return true;
    }

    // River ends if it reaches ocean
    if (this.countOceanNearTile(x, y, tiles) > 0) {
      return true;
    }

    // River ends at poles (frozen terrain at high latitude - simplified)
    const tile = tiles[x][y];
    const frozen = tile.properties[TerrainProperty.FROZEN] || 0;
    if (frozen > 80) {
      return true;
    }

    return false;
  }

  /**
   * Find best direction for river continuation using freeciv test functions
   * @reference freeciv/server/generator/mapgen.c:826-851
   */
  private findBestRiverDirection(
    x: number,
    y: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): { x: number; y: number } | null {
    const cardinalDirs = [
      { dx: 0, dy: -1 }, // North
      { dx: 1, dy: 0 }, // East
      { dx: 0, dy: 1 }, // South
      { dx: -1, dy: 0 }, // West
    ];

    let bestDirection: { x: number; y: number; score: number } | null = null;

    // Test each cardinal direction
    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      // Check bounds
      if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
        continue;
      }

      // Run river test functions (simplified version)
      const score = this.calculateRiverDirectionScore(nx, ny, tiles, riverMap);
      if (score >= 0 && (!bestDirection || score < bestDirection.score)) {
        bestDirection = { x: nx, y: ny, score };
      }
    }

    return bestDirection;
  }

  /**
   * Calculate score for river direction (lower is better)
   * Simplified version of freeciv test_funcs
   */
  private calculateRiverDirectionScore(
    x: number,
    y: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): number {
    const tileIndex = y * this.width + x;

    // Blocked tiles get worst score
    if (riverMap.blocked.has(tileIndex)) {
      return 1000;
    }

    // Already marked as river
    if (riverMap.ok.has(tileIndex)) {
      return 500;
    }

    const tile = tiles[x][y];

    // Ocean tiles get good score (river mouth)
    if (!this.isLandTile(tile.terrain)) {
      return 10;
    }

    // Prefer lower elevation (less mountainous)
    const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
    let score = mountainous;

    // Avoid dry terrain
    const dry = tile.properties[TerrainProperty.DRY] || 0;
    score += dry / 2;

    // Avoid frozen terrain
    const frozen = tile.properties[TerrainProperty.FROZEN] || 0;
    score += frozen / 2;

    return score;
  }

  /**
   * Generate river mask for connections
   */
  private generateRiverMask(
    x: number,
    y: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): number {
    let mask = 0;
    const tileIndex = y * this.width + x;

    // Mark as river tile
    riverMap.ok.add(tileIndex);

    // Check cardinal directions for connections
    const cardinalDirs = [
      { dx: 0, dy: -1, mask: 1 }, // North
      { dx: 1, dy: 0, mask: 2 }, // East
      { dx: 0, dy: 1, mask: 4 }, // South
      { dx: -1, dy: 0, mask: 8 }, // West
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const neighborTile = tiles[nx][ny];

        // Connect to existing rivers
        if (neighborTile.riverMask > 0) {
          mask |= dir.mask;
        }
        // Connect to ocean (river mouths)
        else if (!this.isLandTile(neighborTile.terrain)) {
          if (this.random() < 0.3) {
            // 30% chance to connect to ocean
            mask |= dir.mask;
          }
        }
        // Connect to suitable land tiles
        else if (this.isRiverSuitable(nx, ny, tiles)) {
          if (this.random() < 0.15) {
            // 15% chance to extend
            mask |= dir.mask;
          }
        }
      }
    }

    return mask;
  }

  /**
   * Check if a tile is suitable for river placement
   */
  private isRiverSuitable(x: number, y: number, tiles: MapTile[][]): boolean {
    const tile = tiles[x][y];

    // Prefer mountainous terrain
    const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
    if (mountainous > 30) {
      return true;
    }

    // Avoid dry terrain unless it's near water
    const dry = tile.properties[TerrainProperty.DRY] || 0;
    if (dry > 70) {
      return this.isNearWater(x, y, tiles);
    }

    // Generally suitable for temperate terrain
    return tile.terrain === 'grassland' || tile.terrain === 'plains' || tile.terrain === 'forest';
  }

  /**
   * Check if tile is near water
   */
  private isNearWater(x: number, y: number, tiles: MapTile[][]): boolean {
    const radius = 2;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (!this.isLandTile(terrain)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Check if terrain type is land (not water)
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }
}
