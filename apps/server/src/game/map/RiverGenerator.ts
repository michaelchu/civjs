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
   * Generate advanced river system
   */
  public async generateAdvancedRivers(tiles: MapTile[][]): Promise<void> {
    logger.info('Starting advanced river generation');
    const startTime = Date.now();

    // Create river map state
    const riverMap: RiverMapState = {
      blocked: new Set<number>(),
      ok: new Set<number>(),
    };

    // Calculate number of rivers based on map size
    const landTiles = tiles.flat().filter(tile => this.isLandTile(tile.terrain)).length;

    const targetRivers = Math.floor(landTiles * 0.15); // 15% river coverage

    let riversPlaced = 0;
    let attempts = targetRivers * 20; // Allow many attempts

    while (riversPlaced < targetRivers && attempts > 0) {
      const x = Math.floor(this.random() * this.width);
      const y = Math.floor(this.random() * this.height);

      if (this.canPlaceRiver(x, y, tiles, riverMap)) {
        const riverMask = this.generateRiverMask(x, y, tiles, riverMap);
        if (riverMask > 0) {
          tiles[x][y].riverMask = riverMask;
          this.convertTerrainForRiver(tiles[x][y]);
          riversPlaced++;
        }
      }

      attempts--;
    }

    const endTime = Date.now();
    logger.info(
      `Advanced river generation completed: ${riversPlaced}/${targetRivers} rivers placed in ${
        endTime - startTime
      }ms`
    );
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
