import { logger } from '@utils/logger';
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

    // Test 2: Height preference (prefer downhill, or ocean if river is long enough)
    const currentElevation = tiles[x][y].elevation;
    let bestHeightScore = Number.MAX_SAFE_INTEGER;

    for (const candidate of validDirections) {
      const neighborTile = tiles[candidate.x][candidate.y];
      let heightScore = 0;

      if (!this.isLandTile(neighborTile.terrain)) {
        // Ocean - penalize if river is too short
        heightScore = currentLength < 5 ? 500 : 0;
      } else {
        // Land - prefer flowing downhill
        if (neighborTile.elevation >= currentElevation) {
          heightScore = neighborTile.elevation - currentElevation + 1;
        }
      }

      bestHeightScore = Math.min(bestHeightScore, heightScore);
    }

    validDirections = validDirections.filter(candidate => {
      const neighborTile = tiles[candidate.x][candidate.y];
      let heightScore = 0;

      if (!this.isLandTile(neighborTile.terrain)) {
        heightScore = currentLength < 5 ? 500 : 0;
      } else {
        if (neighborTile.elevation >= currentElevation) {
          heightScore = neighborTile.elevation - currentElevation + 1;
        }
      }

      return heightScore === bestHeightScore;
    });

    if (validDirections.length === 0) return null;

    // Test 3: Terrain suitability
    let bestTerrainScore = Number.MAX_SAFE_INTEGER;

    for (const candidate of validDirections) {
      const terrainScore = this.isRiverSuitable(candidate.x, candidate.y, tiles) ? 0 : 1;
      bestTerrainScore = Math.min(bestTerrainScore, terrainScore);
    }

    validDirections = validDirections.filter(candidate => {
      const terrainScore = this.isRiverSuitable(candidate.x, candidate.y, tiles) ? 0 : 1;
      return terrainScore === bestTerrainScore;
    });

    if (validDirections.length === 0) return null;

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
}
