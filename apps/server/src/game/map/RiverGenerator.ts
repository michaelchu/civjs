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
   */
  public async generateAdvancedRivers(tiles: MapTile[][]): Promise<void> {
    logger.info('Starting advanced river generation');
    const startTime = Date.now();

    // Create river map state
    const riverMap: RiverMapState = {
      blocked: new Set<number>(),
      ok: new Set<number>(),
    };

    // Calculate number of river networks based on map size (fewer networks, longer rivers)
    const mapArea = this.width * this.height;
    const targetNetworks = Math.max(3, Math.floor(Math.sqrt(mapArea) / 8)); // Scale with map size

    let networksCreated = 0;
    let totalRiverTiles = 0;

    // Generate river networks from high elevation to ocean
    for (
      let attempt = 0;
      attempt < targetNetworks * 10 && networksCreated < targetNetworks;
      attempt++
    ) {
      const startPos = this.findRiverStartPosition(tiles);
      if (startPos) {
        const networkLength = this.generateRiverNetwork(startPos.x, startPos.y, tiles, riverMap);
        if (networkLength > 0) {
          networksCreated++;
          totalRiverTiles += networkLength;
        }
      }
    }

    // After generating networks, calculate connection masks for all river tiles
    this.calculateRiverConnections(tiles);

    const endTime = Date.now();
    logger.info(
      `Advanced river generation completed: ${networksCreated} networks with ${totalRiverTiles} total river tiles in ${
        endTime - startTime
      }ms`
    );
  }

  /**
   * Convert terrain to be more suitable for rivers
   */
  private convertTerrainForRiver(tile: MapTile): void {
    // Convert desert near rivers to more fertile land
    if (tile.terrain === 'desert') {
      tile.terrain = 'plains';
    }
    // Swamps can stay as swamps (natural for rivers)
    // Mountains become hills when rivers flow through
    else if (tile.terrain === 'mountains') {
      if (this.random() < 0.4) {
        tile.terrain = 'hills';
      }
    }
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
  private findRiverStartPosition(tiles: MapTile[][]): { x: number; y: number } | null {
    const maxTries = 100;

    for (let attempt = 0; attempt < maxTries; attempt++) {
      // Pick random position
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);
      const tile = tiles[x][y];

      // Simple check: land tile with no existing river and reasonable elevation
      if (this.isLandTile(tile.terrain) && tile.riverMask === 0 && tile.elevation > 50) {
        return { x, y };
      }
    }

    return null; // No suitable position found
  }

  /**
   * Generate a flowing river network from start position to ocean
   */
  private generateRiverNetwork(
    startX: number,
    startY: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): number {
    const riverPath: { x: number; y: number; fromDirection?: number }[] = [];
    let currentX = startX;
    let currentY = startY;
    let length = 0;
    const maxLength = 30; // Prevent infinite loops
    let prevX = -1;
    let prevY = -1;

    while (length < maxLength) {
      // Store the previous position to track flow direction
      const prevPosX = prevX;
      const prevPosY = prevY;
      prevX = currentX;
      prevY = currentY;

      // Mark current tile as river with temporary mask (will be recalculated based on flow)
      tiles[currentX][currentY].riverMask = 1; // Will be properly set later

      // Store direction this segment came from for flow calculation
      let fromDirection = -1;
      if (prevPosX >= 0 && prevPosY >= 0) {
        const dx = currentX - prevPosX;
        const dy = currentY - prevPosY;
        if (dy === -1)
          fromDirection = 4; // came from South
        else if (dx === 1)
          fromDirection = 8; // came from West
        else if (dy === 1)
          fromDirection = 1; // came from North
        else if (dx === -1) fromDirection = 2; // came from East
      }

      riverPath.push({ x: currentX, y: currentY, fromDirection });
      this.convertTerrainForRiver(tiles[currentX][currentY]);
      length++;

      // Try to find next position (flow downhill toward ocean)
      const nextPos = this.findNextRiverPosition(
        currentX,
        currentY,
        tiles,
        new Set(riverPath.map(p => `${p.x},${p.y}`)),
        length
      );
      if (!nextPos) break;

      currentX = nextPos.x;
      currentY = nextPos.y;

      // Stop if we reached ocean
      if (!this.isLandTile(tiles[currentX][currentY].terrain)) {
        break;
      }
    }

    // River masks will be calculated later in calculateRiverConnections

    // Mark all positions in river map
    for (const pos of riverPath) {
      const tileIndex = pos.y * this.width + pos.x;
      riverMap.ok.add(tileIndex);
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
    visited: Set<string>,
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
      const key = `${nx},${ny}`;

      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !visited.has(key)) {
        const neighborTile = tiles[nx][ny];
        // Don't flow through existing rivers
        if (neighborTile.riverMask === 0) {
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
}
