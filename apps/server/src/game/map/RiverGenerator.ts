import { logger } from '@utils/logger';
import { MapTile, TerrainType } from './MapTypes';

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
   * Generate advanced river system with flowing networks
   * Port of Freeciv's make_rivers() function - density-based approach
   * @reference freeciv/server/generator/mapgen.c:make_rivers()
   */
  public async generateAdvancedRivers(tiles: MapTile[][]): Promise<void> {
    logger.info('Starting Freeciv-style river generation');
    const startTime = Date.now();

    // Create river map state
    const riverMap: RiverMapState = {
      blocked: new Set<number>(),
      ok: new Set<number>(),
    };

    // Calculate target river density (port of Freeciv formula)
    const mapArea = this.width * this.height;
    const riverPct = 50; // Default river percentage (0-100)
    const landPercent = this.calculateLandPercent(tiles);

    const desirableRiverLength = Math.floor(
      (riverPct * mapArea * landPercent) / 5325 // Freeciv's magic number
    );

    let currentRiverLength = 0;
    let iterationCounter = 0;
    const maxTries = 32767; // RIVERS_MAXTRIES from Freeciv

    logger.info(
      `Target river density: ${desirableRiverLength} tiles (${riverPct}% of ${mapArea} tiles, ${landPercent}% land)`
    );

    // Main river generation loop (like Freeciv)
    while (currentRiverLength < desirableRiverLength && iterationCounter < maxTries) {
      // Find a suitable starting position (Freeciv's criteria)
      const startPos = this.findFreecivRiverStartPosition(tiles, iterationCounter, maxTries);
      if (!startPos) {
        break; // No more suitable starting positions
      }

      logger.debug(
        `Found river start at (${startPos.x}, ${startPos.y}), iteration ${iterationCounter}`
      );

      // Reset river map for this river (like Freeciv)
      riverMap.blocked.clear();
      riverMap.ok.clear();

      // Block existing rivers from different types (simplified - we only have one type)
      this.blockExistingRivers(tiles, riverMap);

      // Try to generate a river
      const riverLength = this.generateRiverNetwork(startPos.x, startPos.y, tiles, riverMap);

      if (riverLength > 0) {
        // Apply river to map (like Freeciv)
        this.applyRiverToMap(tiles, riverMap);
        currentRiverLength += riverLength;
        logger.debug(
          `River applied: ${riverLength} tiles. Total: ${currentRiverLength}/${desirableRiverLength}`
        );
      } else {
        logger.debug('River generation failed (stuck in helix or no valid path)');
      }

      iterationCounter++;
    }

    // After generating all rivers, calculate connection masks
    this.calculateRiverConnections(tiles);

    const endTime = Date.now();
    logger.info(
      `Freeciv-style river generation completed: ${currentRiverLength} river tiles (target: ${desirableRiverLength}) in ${iterationCounter} iterations, ${endTime - startTime}ms`
    );
  }

  /**
   * Check if terrain type is land (not water)
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }

  /**
   * Mark river blocks for advanced placement
   */
  public riverBlockMark(riverMap: RiverMapState, x: number, y: number): void {
    const tileIndex = y * this.width + x;
    riverMap.blocked.add(tileIndex);
  }

  /**
   * Check if river density is acceptable in area
   */
  public checkNearbyRiverDensity(startX: number, startY: number, tiles: MapTile[][]): boolean {
    const radius = 5;
    let riverCount = 0;
    let totalCount = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = startX + dx;
        const y = startY + dy;

        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          totalCount++;
          if (tiles[x][y].riverMask > 0) {
            riverCount++;
          }
        }
      }
    }

    const density = riverCount / totalCount;
    return density < 0.25; // Max 25% river density in local area
  }

  /**
   * Find suitable starting position for river network - port of Freeciv's approach
   * @reference freeciv/server/generator/mapgen.c:make_rivers()
   */

  /**
   * Generate a flowing river network from start position to ocean
   * Port of Freeciv's make_river function structure
   * @reference freeciv/server/generator/mapgen.c:make_river()
   */
  private generateRiverNetwork(
    startX: number,
    startY: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): number {
    let currentX = startX;
    let currentY = startY;
    let length = 0;
    const maxLength = 300; // Increased for longer rivers (Freeciv default)

    while (length < maxLength) {
      // Mark the current tile in river map (like Freeciv) - don't apply to map yet
      const tileIndex = currentY * this.width + currentX;
      riverMap.ok.add(tileIndex);
      length++;

      logger.debug(`River tile ${length} placed at (${currentX}, ${currentY})`);

      // Test if the river is done (Freeciv termination conditions)
      // This checks AFTER placing the current tile, like Freeciv
      if (this.shouldTerminateRiver(currentX, currentY, tiles, riverMap)) {
        logger.debug(`River terminated at (${currentX}, ${currentY}) after ${length} tiles`);
        break;
      }

      // Try to find next position
      const nextPos = this.findNextRiverPosition(currentX, currentY, tiles, riverMap, length);

      if (!nextPos) {
        // No valid directions found - river ends here
        logger.debug(`River ended naturally at (${currentX}, ${currentY}) - no valid directions`);
        break;
      }

      // Block previous position to prevent backtracking (like Freeciv's river_blockmark)
      this.riverBlockmark(riverMap, currentX, currentY);

      currentX = nextPos.x;
      currentY = nextPos.y;
    }

    return length;
  }

  /**
   * Find next position for river to flow - port of Freeciv's make_river algorithm
   * @reference freeciv/server/generator/mapgen.c:make_river()
   */
  private findNextRiverPosition(
    x: number,
    y: number,
    tiles: MapTile[][],
    riverMap: RiverMapState,
    currentLength: number
  ): { x: number; y: number } | null {
    const directions = [
      { dx: 0, dy: -1 }, // North
      { dx: 1, dy: 0 }, // East
      { dx: 0, dy: 1 }, // South
      { dx: -1, dy: 0 }, // West
    ];

    // Track valid directions (Freeciv style)
    let validDirections: { x: number; y: number; dir: number }[] = [];

    // Step 1: Mark all available cardinal directions as candidates
    for (let i = 0; i < directions.length; i++) {
      const dir = directions[i];
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const tileIndex = ny * this.width + nx;
        // Don't flow through blocked positions (like Freeciv)
        if (!riverMap.blocked.has(tileIndex)) {
          validDirections.push({ x: nx, y: ny, dir: i });
        }
      }
    }

    if (validDirections.length === 0) return null;

    // Step 2: Apply FATAL tests - eliminate directions that fail
    // Test 1: Grid test (FATAL in Freeciv)
    validDirections = validDirections.filter(candidate => {
      const gridResult = this.riverTestRivergrid(candidate.x, candidate.y, tiles);
      return gridResult === 0; // Only keep directions that don't form grids
    });

    if (validDirections.length === 0) {
      return null; // All directions would create grids - abort river
    }

    // Step 3: Apply NON-FATAL tests using Freeciv's approach
    // For each test, find the best value and eliminate worse directions

    // Apply all non-fatal tests in sequence (matching Freeciv's test_funcs array)
    const nonFatalTests = [
      this.riverTestHighlands.bind(this),
      this.riverTestAdjacentOcean.bind(this),
      this.riverTestAdjacentRiver.bind(this),
      this.riverTestAdjacentHighlands.bind(this),
      this.riverTestSwamp.bind(this),
      this.riverTestAdjacentSwamp.bind(this),
      (x: number, y: number, tiles: MapTile[][]) =>
        this.riverTestHeightMap(x, y, tiles, currentLength),
    ];

    for (const testFunc of nonFatalTests) {
      if (validDirections.length === 0) break;

      // Find best score for this test
      let bestScore = Number.MAX_SAFE_INTEGER;
      for (const candidate of validDirections) {
        const score = testFunc(candidate.x, candidate.y, tiles);
        bestScore = Math.min(bestScore, score);
      }

      // Filter to keep only directions with best score
      validDirections = validDirections.filter(candidate => {
        const score = testFunc(candidate.x, candidate.y, tiles);
        return score === bestScore;
      });
    }

    // Step 4: Randomly choose from remaining valid directions
    const chosen = validDirections[Math.floor(this.random() * validDirections.length)];
    return { x: chosen.x, y: chosen.y };
  }

  /**
   * River grid test - port of Freeciv's river_test_rivergrid() function.
   * @reference freeciv/server/generator/mapgen.c:river_test_rivergrid()
   * @param x - x coordinate to check
   * @param y - y coordinate to check
   * @param tiles - map tiles array
   * @returns 0 if no grid, 1 if grid would be formed
   */
  private riverTestRivergrid(x: number, y: number, tiles: MapTile[][]): number {
    // Count cardinal river connections if we place a river here
    let riverConnections = 0;

    const cardinalDirs = [
      { dx: 0, dy: -1 }, // North
      { dx: 1, dy: 0 }, // East
      { dx: 0, dy: 1 }, // South
      { dx: -1, dy: 0 }, // West
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const neighborTile = tiles[nx][ny];
        // Count existing rivers (but not ocean)
        if (neighborTile.riverMask > 0) {
          riverConnections++;
        }
      }
    }

    // Return 1 if more than 1 cardinal river connection (grid pattern), 0 otherwise
    return riverConnections > 1 ? 1 : 0;
  }

  /**
   * Calculate river connection masks for all river tiles after network generation
   */
  private calculateRiverConnections(tiles: MapTile[][]): void {
    // This method is now mainly used for cleanup/validation
    // The main river mask calculation is done in calculateFlowBasedRiverMasks
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].riverMask > 0) {
          // Only recalculate if mask is the temporary value (1)
          if (tiles[x][y].riverMask === 1) {
            tiles[x][y].riverMask = this.calculateRiverMaskForTile(tiles, x, y);
          }
        }
      }
    }
  }

  /**
   * Calculate river connection mask for a specific tile
   */
  private calculateRiverMaskForTile(tiles: MapTile[][], x: number, y: number): number {
    let mask = 0;

    // Check cardinal directions for river connections
    const cardinalDirs = [
      { dx: 0, dy: -1, mask: 1 }, // North
      { dx: 1, dy: 0, mask: 2 }, // East
      { dx: 0, dy: 1, mask: 4 }, // South
      { dx: -1, dy: 0, mask: 8 }, // West
    ];

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (this.shouldConnectToNeighbor(tiles, nx, ny)) {
        mask |= dir.mask;
      }
    }

    return mask;
  }

  /**
   * Check if river should connect to neighbor tile
   * Now more restrictive to avoid grid patterns - only connect along flow paths
   */
  private shouldConnectToNeighbor(tiles: MapTile[][], nx: number, ny: number): boolean {
    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
      return false;
    }

    const neighborTile = tiles[nx][ny];

    // Only connect to ocean (river outlets) - don't auto-connect to other rivers
    // River-to-river connections are now handled by flow-based calculation
    return !this.isLandTile(neighborTile.terrain);
  }

  // ========== FREECIV NON-FATAL TEST FUNCTIONS ==========

  /**
   * Port of Freeciv's river_test_highlands
   * @reference freeciv/server/generator/mapgen.c:river_test_highlands
   */
  private riverTestHighlands(x: number, y: number, tiles: MapTile[][]): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 1;
    const tile = tiles[x][y];

    // Return 1 for mountainous terrain, 0 for others (prefer non-mountains)
    return tile.terrain === 'mountains' || tile.terrain === 'hills' ? 1 : 0;
  }

  /**
   * Port of Freeciv's river_test_adjacent_ocean
   * @reference freeciv/server/generator/mapgen.c:river_test_adjacent_ocean
   */
  private riverTestAdjacentOcean(x: number, y: number, tiles: MapTile[][]): number {
    let oceanCount = 0;
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
          oceanCount++;
        }
      }
    }

    // Return 100 - oceanCount to prefer tiles closer to ocean
    return 100 - oceanCount;
  }

  /**
   * Port of Freeciv's river_test_adjacent_river
   * @reference freeciv/server/generator/mapgen.c:river_test_adjacent_river
   */
  private riverTestAdjacentRiver(x: number, y: number, tiles: MapTile[][]): number {
    let riverCount = 0;
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
        if (tiles[nx][ny].riverMask > 0) {
          riverCount++;
        }
      }
    }

    // Return 100 - riverCount to prefer tiles closer to existing rivers
    return 100 - riverCount;
  }

  /**
   * Port of Freeciv's river_test_adjacent_highlands
   * @reference freeciv/server/generator/mapgen.c:river_test_adjacent_highlands
   */
  private riverTestAdjacentHighlands(x: number, y: number, tiles: MapTile[][]): number {
    let highlandSum = 0;
    const allDirs = [
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ];

    for (const dir of allDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const tile = tiles[nx][ny];
        if (tile.terrain === 'mountains' || tile.terrain === 'hills') {
          highlandSum += 1;
        }
      }
    }

    return highlandSum;
  }

  /**
   * Port of Freeciv's river_test_swamp
   * @reference freeciv/server/generator/mapgen.c:river_test_swamp
   */
  private riverTestSwamp(x: number, y: number, tiles: MapTile[][]): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 10000;
    const tile = tiles[x][y];

    // Prefer swamp terrain (return low value for swamp)
    return tile.terrain === 'swamp' ? 0 : 1;
  }

  /**
   * Port of Freeciv's river_test_adjacent_swamp
   * @reference freeciv/server/generator/mapgen.c:river_test_adjacent_swamp
   */
  private riverTestAdjacentSwamp(x: number, y: number, tiles: MapTile[][]): number {
    let swampSum = 0;
    const allDirs = [
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ];

    for (const dir of allDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const tile = tiles[nx][ny];
        if (tile.terrain === 'swamp') {
          swampSum += 1;
        }
      }
    }

    // Return high value minus swamp count to prefer areas near swamps
    return 10000 - swampSum;
  }

  /**
   * Port of Freeciv's river_test_height_map - MOST IMPORTANT for natural flow
   * @reference freeciv/server/generator/mapgen.c:river_test_height_map
   */
  private riverTestHeightMap(
    x: number,
    y: number,
    tiles: MapTile[][],
    currentLength: number
  ): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 10000;
    const tile = tiles[x][y];

    // Ocean tiles get special handling - only allow if river is long enough
    if (!this.isLandTile(tile.terrain)) {
      return currentLength < 5 ? 500 : 0;
    }

    // For land tiles, return elevation directly (lower elevation = lower score = preferred)
    return Math.floor(tile.elevation);
  }

  /**
   * Check if river should terminate (port of Freeciv termination conditions)
   * @reference freeciv/server/generator/mapgen.c:812-816
   */
  private shouldTerminateRiver(
    x: number,
    y: number,
    tiles: MapTile[][],
    _riverMap: RiverMapState
  ): boolean {
    const riverCount = this.countRiverNearTile(x, y, tiles);
    const oceanCount = this.countOceanNearTile(x, y, tiles);

    logger.debug(`Termination check at (${x}, ${y}): rivers=${riverCount}, ocean=${oceanCount}`);

    // 1. Check if river connects to existing river (not including tiles in current river)
    if (riverCount > 0) {
      logger.debug(`River terminating: connects to existing river`);
      return true;
    }

    // 2. Check if river reaches ocean
    if (oceanCount > 0) {
      logger.debug(`River terminating: reaches ocean`);
      return true;
    }

    // 3. Polar regions (simplified - no polar logic in our implementation yet)
    // if (tile_terrain(ptile)->property[MG_FROZEN] > 0 && map_colatitude(ptile) < 0.8 * COLD_LEVEL)

    return false;
  }

  /**
   * Count river tiles cardinally adjacent to this position
   * @reference freeciv/common/road.c:count_river_near_tile
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
        if (tiles[nx][ny].riverMask > 0) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Count ocean tiles cardinally adjacent to this position
   * @reference freeciv/server/generator/mapgen.c:813-814
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
   * Block mark for river generation (port of Freeciv's river_blockmark)
   * @reference freeciv/server/generator/mapgen.c:river_blockmark
   */
  private riverBlockmark(riverMap: RiverMapState, x: number, y: number): void {
    // Block the current tile
    const tileIndex = y * this.width + x;
    riverMap.blocked.add(tileIndex);

    // Block all cardinal adjacent tiles
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
        const adjacentIndex = ny * this.width + nx;
        riverMap.blocked.add(adjacentIndex);
      }
    }
  }

  /**
   * Calculate land percentage for river density formula
   * @reference freeciv/server/generator/mapgen.c:920
   */
  private calculateLandPercent(tiles: MapTile[][]): number {
    let landTiles = 0;
    const totalTiles = this.width * this.height;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.isLandTile(tiles[x][y].terrain)) {
          landTiles++;
        }
      }
    }

    return Math.floor((landTiles * 100) / totalTiles);
  }

  /**
   * Find suitable river starting position using Freeciv's complex criteria
   * @reference freeciv/server/generator/mapgen.c:949-990
   */
  private findFreecivRiverStartPosition(
    tiles: MapTile[][],
    iterationCounter: number,
    maxTries: number
  ): { x: number; y: number } | null {
    // Try up to 1000 random positions to find a suitable one
    for (let attempt = 0; attempt < 1000; attempt++) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);

      // Check if this position meets Freeciv's criteria
      if (this.isFreecivSuitableRiverStart(tiles, x, y, iterationCounter, maxTries)) {
        return { x, y };
      }
    }

    return null; // No suitable position found
  }

  /**
   * Check if position is suitable for river start using Freeciv's exact criteria
   * @reference freeciv/server/generator/mapgen.c:957-990
   */
  private isFreecivSuitableRiverStart(
    tiles: MapTile[][],
    x: number,
    y: number,
    iterationCounter: number,
    maxTries: number
  ): boolean {
    const tile = tiles[x][y];

    // Don't start a river on ocean
    if (!this.isLandTile(tile.terrain)) {
      return false;
    }

    // Don't start a river on existing river
    if (tile.riverMask > 0) {
      return false;
    }

    // Don't start a river on a tile surrounded by > 1 river + ocean tile
    const nearbyRivers = this.countRiverNearTile(x, y, tiles);
    const nearbyOcean = this.countOceanNearTile(x, y, tiles);

    // Allow starting positions further from ocean - be more permissive initially
    if (nearbyRivers + nearbyOcean > 1) {
      return false;
    }

    // Additional check: prefer starting positions that are not immediately adjacent to ocean
    // This helps prevent 1-tile rivers
    if (nearbyOcean > 0 && iterationCounter < (maxTries / 10) * 3) {
      return false; // Early iterations: avoid starting next to ocean
    }

    // Don't start a river on a tile surrounded by hills/mountains (unless desperate)
    const nearbyMountainous = this.countMountainousNearTile(x, y, tiles);
    if (nearbyMountainous >= 90 && iterationCounter < (maxTries / 10) * 5) {
      return false;
    }

    // Don't start a river on hills unless desperate
    if (
      (tile.terrain === 'hills' || tile.terrain === 'mountains') &&
      iterationCounter < (maxTries / 10) * 6
    ) {
      return false;
    }

    // Don't start a river on desert unless desperate
    if (tile.terrain === 'desert' && iterationCounter < (maxTries / 10) * 9) {
      return false;
    }

    // Prefer starting rivers at higher elevations (mountains flow to sea)
    // Only enforce this in early iterations to allow fallback
    if (tile.elevation < 50 && iterationCounter < (maxTries / 10) * 2) {
      return false; // Early iterations: prefer high elevation starts
    }

    return true;
  }

  /**
   * Count mountainous terrain near tile
   * @reference freeciv/server/generator/mapgen.c:973-975
   */
  private countMountainousNearTile(x: number, y: number, tiles: MapTile[][]): number {
    let count = 0;
    const allDirs = [
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ];

    for (const dir of allDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const tile = tiles[nx][ny];
        if (tile.terrain === 'mountains' || tile.terrain === 'hills') {
          count += 10; // Freeciv uses property values, we approximate
        }
      }
    }

    return count;
  }

  /**
   * Block existing rivers from map (simplified for single river type)
   * @reference freeciv/server/generator/mapgen.c:998-1006
   */
  private blockExistingRivers(_tiles: MapTile[][], _riverMap: RiverMapState): void {
    // In Freeciv, this blocks other river types. We have only one type, so this is simplified.
    // This function could be used to block existing rivers if we had multiple river types.
  }

  /**
   * Apply generated river to the map
   * @reference freeciv/server/generator/mapgen.c:1013-1030
   */
  private applyRiverToMap(tiles: MapTile[][], riverMap: RiverMapState): void {
    for (const tileIndex of riverMap.ok) {
      const y = Math.floor(tileIndex / this.width);
      const x = tileIndex % this.width;

      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        const tile = tiles[x][y];

        // Change terrain if needed (like Freeciv)
        if (tile.terrain === 'desert') {
          tile.terrain = 'plains'; // Make terrain suitable for rivers
        } else if (tile.terrain === 'mountains') {
          tile.terrain = 'hills'; // Mountains become hills near rivers
        }

        // Mark as river
        tile.riverMask = 1; // Will be properly calculated later
      }
    }
  }
}
