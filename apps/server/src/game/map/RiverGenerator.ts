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

/**
 * River test function definition
 * @reference freeciv/server/generator/mapgen.c:684-687
 */
interface RiverTestFunction {
  func: (riverMap: RiverMapState, x: number, y: number, tiles: MapTile[][]) => number;
  fatal: boolean; // If true, non-zero result aborts river generation
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
    
    const desirableRiverLength = Math.floor(
      (riverPct * mapNumTiles * landPercent) / 5325
    );

    // The number of river tiles that have been set
    let currentRiverLength = 0;
    
    // Iteration counter to prevent infinite loops  
    let iterationCounter = 0;
    const RIVERS_MAXTRIES = 32767; // @reference freeciv/server/generator/mapgen.c

    logger.info(`Target river length: ${desirableRiverLength} tiles (${riverPct}% of ${mapNumTiles} tiles * ${landPercent}% land / 5325)`);

    // FREECIV MAIN LOOP: Generate rivers until target length reached
    // @reference freeciv/server/generator/mapgen.c:946-947
    while (currentRiverLength < desirableRiverLength && iterationCounter < RIVERS_MAXTRIES) {
      
      // Find suitable river spring location (highland preference)
      const springLocation = this.findRiverSpring(tiles, riverMap);
      if (!springLocation) {
        break; // No more suitable spring places
      }

      // Generate individual river from spring
      const riverLength = await this.makeRiver(springLocation.x, springLocation.y, tiles, riverMap);
      currentRiverLength += riverLength;
      
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
  private findRiverSpring(tiles: MapTile[][], riverMap: RiverMapState): {x: number, y: number} | null {
    // Try to find highland locations first (prefer mountains/hills)
    const maxAttempts = 100;
    let bestCandidate: {x: number, y: number, score: number} | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);

      if (!this.canPlaceRiver(x, y, tiles, riverMap)) {
        continue;
      }

      const tile = tiles[x][y];
      
      // Score based on elevation/mountainous property (higher is better for river springs)
      const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
      const score = mountainous;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { x, y, score };
      }

      // Accept good candidates early
      if (score > 70) {
        return { x, y };
      }
    }

    return bestCandidate;
  }

  /**
   * Generate individual river from spring point
   * @reference freeciv/server/generator/mapgen.c:991-1050 make_river()
   */
  private async makeRiver(startX: number, startY: number, tiles: MapTile[][], riverMap: RiverMapState): Promise<number> {
    let riverLength = 0;
    let currentX = startX;
    let currentY = startY;
    const maxRiverLength = 50; // Prevent infinite rivers
    
    // Mark starting tile
    if (this.canPlaceRiver(currentX, currentY, tiles, riverMap)) {
      const riverMask = this.generateRiverMask(currentX, currentY, tiles, riverMap);
      if (riverMask > 0) {
        tiles[currentX][currentY].riverMask = riverMask;
        this.convertTerrainForRiver(tiles[currentX][currentY]);
        riverLength++;
      }
    }

    // Extend river towards lower elevation or water
    while (riverLength < maxRiverLength) {
      const nextTile = this.findNextRiverTile(currentX, currentY, tiles, riverMap);
      if (!nextTile) {
        break; // River reached water or no valid continuation
      }

      currentX = nextTile.x;
      currentY = nextTile.y;

      const riverMask = this.generateRiverMask(currentX, currentY, tiles, riverMap);
      if (riverMask > 0) {
        tiles[currentX][currentY].riverMask = riverMask;
        this.convertTerrainForRiver(tiles[currentX][currentY]);
        riverLength++;
      }

      // Stop if we reached water (river mouth)
      if (!this.isLandTile(tiles[currentX][currentY].terrain)) {
        break;
      }
    }

    return riverLength;
  }

  /**
   * Find next tile in river path (flow towards lower elevation/water)
   */
  private findNextRiverTile(x: number, y: number, tiles: MapTile[][], riverMap: RiverMapState): {x: number, y: number} | null {
    const cardinalDirs = [
      { dx: 0, dy: -1 }, // North  
      { dx: 1, dy: 0 },  // East
      { dx: 0, dy: 1 },  // South
      { dx: -1, dy: 0 }  // West
    ];

    let bestCandidate: {x: number, y: number, priority: number} | null = null;

    for (const dir of cardinalDirs) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
        continue;
      }

      const neighborTile = tiles[nx][ny];
      
      // Priority: Ocean > Coast > Land with existing rivers > Suitable land
      let priority = 0;
      
      if (!this.isLandTile(neighborTile.terrain)) {
        priority = 100; // Highest priority - river mouth
      } else if (neighborTile.riverMask > 0) {
        priority = 80;  // Connect to existing river
      } else if (this.canPlaceRiver(nx, ny, tiles, riverMap)) {
        // Lower elevation preferred (simplified - could use height map)
        const mountainous = neighborTile.properties[TerrainProperty.MOUNTAINOUS] || 0;
        priority = 50 - Math.floor(mountainous / 2); // Lower mountainous = higher priority
      }

      if (priority > 0 && (!bestCandidate || priority > bestCandidate.priority)) {
        bestCandidate = { x: nx, y: ny, priority };
      }
    }

    return bestCandidate;
  }

  /**
   * Check if a river can be placed at the given coordinates
   */
  private canPlaceRiver(
    x: number,
    y: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): boolean {
    // Check bounds
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return false;
    }

    const tile = tiles[x][y];

    // Must be on land
    if (!this.isLandTile(tile.terrain)) {
      return false;
    }

    // Can't already have a river
    if (tile.riverMask > 0) {
      return false;
    }

    // Run all river tests
    for (const test of this.riverTestFunctions) {
      const result = test.func(riverMap, x, y, tiles);
      if (result > 0 && test.fatal) {
        return false;
      }
    }

    return true;
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
   * River test functions array
   */
  private get riverTestFunctions(): RiverTestFunction[] {
    return [
      {
        func: this.riverTestBlocked,
        fatal: true,
      },
      {
        func: this.riverTestRiverGrid,
        fatal: true,
      },
      {
        func: this.riverTestHighlands,
        fatal: false,
      },
    ];
  }

  /**
   * Test if river placement is blocked
   */
  private riverTestBlocked = (
    riverMap: RiverMapState,
    x: number,
    y: number,
    _tiles: MapTile[][]
  ): number => {
    const tileIndex = y * this.width + x;
    if (riverMap.blocked.has(tileIndex)) {
      return 1;
    }

    // Check if all cardinal neighbors are blocked
    const cardinalDirs = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];

    for (const [dx, dy] of cardinalDirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        const neighborIndex = ny * this.width + nx;
        if (!riverMap.blocked.has(neighborIndex)) {
          return 0;
        }
      }
    }

    return 1; // All neighbors blocked
  };

  /**
   * Test river grid to avoid too many river connections
   */
  private riverTestRiverGrid = (
    _riverMap: RiverMapState,
    x: number,
    y: number,
    tiles: MapTile[][]
  ): number => {
    let riverCount = 0;
    const cardinalDirs = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];

    for (const [dx, dy] of cardinalDirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (tiles[nx][ny].riverMask > 0) {
          riverCount++;
        }
      }
    }

    return riverCount > 1 ? 1 : 0;
  };

  /**
   * Test highland suitability for rivers
   */
  private riverTestHighlands = (
    _riverMap: RiverMapState,
    x: number,
    y: number,
    tiles: MapTile[][]
  ): number => {
    const tile = tiles[x][y];
    const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;

    // Higher values indicate better suitability
    // Return 0 for good suitability, higher values for less suitable
    return Math.max(0, 50 - mountainous);
  };

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
}
