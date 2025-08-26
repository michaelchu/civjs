import { logger } from '../../utils/logger';
import {
  MapTile,
  TerrainSelector,
  TerrainProperty,
  TemperatureType,
  WetnessCondition,
} from './MapTypes';

// Generator state tracking for island-based generation
export interface IslandGeneratorState {
  isleIndex: number;
  totalMass: number;
  n: number; // North boundary
  s: number; // South boundary
  e: number; // East boundary
  w: number; // West boundary
  heightMap: number[][];
  placedMap: boolean[][]; // Tracks which tiles have been placed
}

// Terrain percentage configuration (matches freeciv defaults)
export interface TerrainPercentages {
  river: number;
  mountain: number;
  desert: number;
  forest: number;
  swamp: number;
}

// Bucket state for terrain distribution (replaces static variables)
export interface BucketState {
  balance: number;
  lastPlaced: number;
  riverBucket: number;
  mountainBucket: number;
  desertBucket: number;
  forestBucket: number;
  swampBucket: number;
  tileFactor: number;
}

// Island terrain selection lists (port from island_terrain_init())
export class IslandTerrainLists {
  forest: TerrainSelector[];
  desert: TerrainSelector[];
  mountain: TerrainSelector[];
  swamp: TerrainSelector[];
  initialized: boolean = false;

  constructor() {
    this.forest = [];
    this.desert = [];
    this.mountain = [];
    this.swamp = [];
  }

  cleanup(): void {
    this.forest = [];
    this.desert = [];
    this.mountain = [];
    this.swamp = [];
    this.initialized = false;
  }

  initialize(): void {
    if (this.initialized) return;

    // Forest terrain selection (from freeciv mapgen.c:2018-2030)
    this.forest = [
      {
        terrain: 'forest',
        weight: 50,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.FOLIAGE,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'jungle',
        weight: 60,
        target: TerrainProperty.FOLIAGE,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.COLD,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'plains',
        weight: 30,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.MOUNTAINOUS,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'grassland',
        weight: 40,
        target: TerrainProperty.GREEN,
        prefer: TerrainProperty.WET,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
    ];

    // Desert terrain selection (from freeciv mapgen.c:2033-2045)
    this.desert = [
      {
        terrain: 'desert',
        weight: 80,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.DRY,
      },
      {
        terrain: 'tundra',
        weight: 60,
        target: TerrainProperty.COLD,
        prefer: TerrainProperty.DRY,
        avoid: TerrainProperty.TROPICAL,
        tempCondition: TemperatureType.COLD,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'plains',
        weight: 20,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.DRY,
      },
      {
        terrain: 'hills',
        weight: 30,
        target: TerrainProperty.DRY,
        prefer: TerrainProperty.MOUNTAINOUS,
        avoid: TerrainProperty.WET,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.DRY,
      },
    ];

    // Mountain terrain selection (from freeciv mapgen.c:2048-2054)
    this.mountain = [
      {
        terrain: 'mountains',
        weight: 70,
        target: TerrainProperty.MOUNTAINOUS,
        prefer: TerrainProperty.COLD,
        avoid: TerrainProperty.OCEAN_DEPTH,
        tempCondition: TemperatureType.COLD,
        wetCondition: WetnessCondition.ALL,
      },
      {
        terrain: 'hills',
        weight: 60,
        target: TerrainProperty.MOUNTAINOUS,
        prefer: TerrainProperty.TEMPERATE,
        avoid: TerrainProperty.OCEAN_DEPTH,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.ALL,
      },
    ];

    // Swamp terrain selection (from freeciv mapgen.c:2057-2066)
    this.swamp = [
      {
        terrain: 'swamp',
        weight: 80,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.TROPICAL,
        avoid: TerrainProperty.MOUNTAINOUS,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'jungle',
        weight: 50,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.FOLIAGE,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TROPICAL,
        wetCondition: WetnessCondition.NDRY,
      },
      {
        terrain: 'grassland',
        weight: 30,
        target: TerrainProperty.WET,
        prefer: TerrainProperty.GREEN,
        avoid: TerrainProperty.DRY,
        tempCondition: TemperatureType.TEMPERATE,
        wetCondition: WetnessCondition.NDRY,
      },
    ];

    this.initialized = true;
  }
}

export class IslandGenerator {
  private width: number;
  private height: number;
  private random: () => number;
  private terrainLists: IslandTerrainLists;
  private bucketState?: BucketState;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.terrainLists = new IslandTerrainLists();
  }

  /**
   * Initialize the world for island-based generation (port from initworld())
   */
  public initializeWorldForIslands(tiles: MapTile[][]): IslandGeneratorState {
    // Fill all tiles with deep ocean initially
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].terrain = 'deep_ocean';
        tiles[x][y].continentId = 0;
      }
    }

    // Initialize state
    const state: IslandGeneratorState = {
      isleIndex: 1,
      totalMass: Math.floor((this.width * this.height * 30) / 100), // 30% land coverage
      n: 0,
      s: this.height,
      e: this.width,
      w: 0,
      heightMap: Array(this.width)
        .fill(null)
        .map(() => Array(this.height).fill(0)),
      placedMap: Array(this.width)
        .fill(null)
        .map(() => Array(this.height).fill(false)),
    };

    // Initialize terrain selection lists
    this.terrainLists.initialize();

    return state;
  }

  /**
   * Core make_island function (port from freeciv mapgen.c:2094-2202)
   */
  public async makeIsland(
    islandMass: number,
    _starters: number,
    state: IslandGeneratorState,
    tiles: MapTile[][],
    terrainPercentages: TerrainPercentages,
    minSpecificIslandSize: number = 10
  ): Promise<boolean> {
    // Static buckets for terrain distribution (like freeciv's bucket system)
    if (!this.bucketState) {
      this.bucketState = {
        balance: 0,
        lastPlaced: 0,
        riverBucket: 0,
        mountainBucket: 0,
        desertBucket: 0,
        forestBucket: 0,
        swampBucket: 0,
        tileFactor: 0,
      };
    }

    const buckets = this.bucketState;

    if (islandMass === 0) {
      // Initialization call (islemass == 0 case from freeciv)
      buckets.balance = 0;
      state.isleIndex = 1; // Start with continent 1

      if (state.totalMass > 3000) {
        logger.info('High landmass - this may take a few seconds.');
      }

      // Calculate terrain distribution factor
      const totalPercent =
        terrainPercentages.river +
        terrainPercentages.mountain +
        terrainPercentages.desert +
        terrainPercentages.forest +
        terrainPercentages.swamp;

      const normalizedPercent = totalPercent <= 90 ? 100 : (totalPercent * 11) / 10;
      buckets.tileFactor = Math.floor(state.totalMass / normalizedPercent);

      // Initialize buckets with random offsets (like freeciv)
      buckets.riverBucket = -Math.floor(this.random() * state.totalMass);
      buckets.mountainBucket = -Math.floor(this.random() * state.totalMass);
      buckets.desertBucket = -Math.floor(this.random() * state.totalMass);
      buckets.forestBucket = -Math.floor(this.random() * state.totalMass);
      buckets.swampBucket = -Math.floor(this.random() * state.totalMass);
      buckets.lastPlaced = state.totalMass;

      return true;
    }

    // Actual island creation
    islandMass = Math.max(0, islandMass - buckets.balance);

    // Don't create islands we can't place
    if (islandMass > buckets.lastPlaced + 1 + Math.floor(buckets.lastPlaced / 50)) {
      islandMass = buckets.lastPlaced + 1 + Math.floor(buckets.lastPlaced / 50);
    }

    // Size limits based on map dimensions
    const maxHeight = Math.pow(this.height - 6, 2);
    const maxWidth = Math.pow(this.width - 2, 2);

    if (islandMass > maxHeight) {
      islandMass = maxHeight;
    }
    if (islandMass > maxWidth) {
      islandMass = maxWidth;
    }

    let currentSize = islandMass;
    if (currentSize <= 0) {
      return false;
    }

    logger.debug(`Creating island ${state.isleIndex}`);

    // Try to place the island with decreasing size until successful
    while (!this.createIsland(currentSize, state, tiles)) {
      if (currentSize < (islandMass * minSpecificIslandSize) / 100) {
        return false;
      }
      currentSize--;
    }

    currentSize++;
    buckets.lastPlaced = currentSize;

    // Update balance
    if (currentSize * 10 > islandMass) {
      buckets.balance = currentSize - islandMass;
    } else {
      buckets.balance = 0;
    }

    logger.debug(
      `Island ${state.isleIndex}: planned=${islandMass}, placed=${currentSize}, balance=${buckets.balance}`
    );

    // Distribute terrain using bucket system
    const terrainFactor = currentSize * buckets.tileFactor;

    // Forest terrain
    buckets.forestBucket += terrainPercentages.forest * terrainFactor;
    buckets.forestBucket = this.fillIsland(
      60,
      buckets.forestBucket,
      this.terrainLists.forest,
      state,
      tiles
    );

    // Desert terrain
    buckets.desertBucket += terrainPercentages.desert * terrainFactor;
    buckets.desertBucket = this.fillIsland(
      40,
      buckets.desertBucket,
      this.terrainLists.desert,
      state,
      tiles
    );

    // Mountain terrain
    buckets.mountainBucket += terrainPercentages.mountain * terrainFactor;
    buckets.mountainBucket = this.fillIsland(
      20,
      buckets.mountainBucket,
      this.terrainLists.mountain,
      state,
      tiles
    );

    // Swamp terrain
    buckets.swampBucket += terrainPercentages.swamp * terrainFactor;
    buckets.swampBucket = this.fillIsland(
      80,
      buckets.swampBucket,
      this.terrainLists.swamp,
      state,
      tiles
    );

    state.isleIndex++;
    return true;
  }

  /**
   * Create island shape using height map (port from create_island())
   */
  private createIsland(
    islandMass: number,
    state: IslandGeneratorState,
    tiles: MapTile[][]
  ): boolean {
    const tries = islandMass * (2 + Math.floor(islandMass / 20)) + 99;
    let remainingMass = islandMass - 1;

    // Clear height map
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        state.heightMap[x][y] = 0;
      }
    }

    // Start from center
    const centerX = Math.floor(this.width / 2);
    const centerY = Math.floor(this.height / 2);
    state.heightMap[centerX][centerY] = 1;

    // Initialize bounds
    state.n = centerY - 1;
    state.s = centerY + 2;
    state.w = centerX - 1;
    state.e = centerX + 2;

    let attempts = tries;
    while (remainingMass > 0 && attempts > 0) {
      // Pick random position within current bounds
      const x = Math.floor(this.random() * (state.e - state.w)) + state.w;
      const y = Math.floor(this.random() * (state.s - state.n)) + state.n;

      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        if (state.heightMap[x][y] === 0 && this.countAdjacentElevatedTiles(x, y, state) > 0) {
          state.heightMap[x][y] = 1;
          remainingMass--;

          // Expand bounds if necessary
          if (y >= state.s - 1 && state.s < this.height - 2) state.s++;
          if (x >= state.e - 1 && state.e < this.width - 2) state.e++;
          if (y <= state.n && state.n > 2) state.n--;
          if (x <= state.w && state.w > 2) state.w--;
        }
      }

      // Fill holes when getting close to completion
      if (remainingMass < Math.floor(islandMass / 10)) {
        remainingMass = this.fillIslandHoles(remainingMass, state);
      }

      attempts--;
    }

    // Apply the island to the actual tile map
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (state.heightMap[x][y] > 0) {
          tiles[x][y].terrain = 'grassland'; // Default land terrain
          tiles[x][y].continentId = state.isleIndex;
          tiles[x][y].elevation = 128; // Mid-level elevation
        }
      }
    }

    return remainingMass <= 0;
  }

  /**
   * Count adjacent elevated tiles
   */
  private countAdjacentElevatedTiles(x: number, y: number, state: IslandGeneratorState): number {
    let count = 0;
    const neighbors = [
      [x - 1, y - 1],
      [x, y - 1],
      [x + 1, y - 1],
      [x - 1, y],
      [x + 1, y],
      [x - 1, y + 1],
      [x, y + 1],
      [x + 1, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (state.heightMap[nx][ny] > 0) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Fill holes in the island
   */
  private fillIslandHoles(remainingMass: number, state: IslandGeneratorState): number {
    for (let x = state.w + 1; x < state.e - 1; x++) {
      for (let y = state.n + 1; y < state.s - 1; y++) {
        if (remainingMass <= 0) break;

        if (state.heightMap[x][y] === 0 && this.countAdjacentElevatedTiles(x, y, state) >= 4) {
          state.heightMap[x][y] = 1;
          remainingMass--;
        }
      }
      if (remainingMass <= 0) break;
    }

    return remainingMass;
  }

  /**
   * Fill island with specific terrain types (port from freeciv fill_island)
   */
  private fillIsland(
    coastDistance: number,
    bucket: number,
    terrainList: TerrainSelector[],
    state: IslandGeneratorState,
    tiles: MapTile[][]
  ): number {
    console.log(
      `DEBUG: fillIsland called - coastDistance=${coastDistance}, bucket=${bucket}, terrainList.length=${terrainList.length}`
    );
    if (bucket <= 0 || terrainList.length === 0) {
      console.log(
        `DEBUG: fillIsland early return - bucket=${bucket}, terrainList.length=${terrainList.length}`
      );
      return bucket;
    }

    const capac = state.totalMass;
    let tilesToPlace = Math.floor(bucket / capac);
    tilesToPlace++;
    const remainingBucket = bucket - tilesToPlace * capac;
    console.log(
      `DEBUG: fillIsland - capac=${capac}, tilesToPlace=${tilesToPlace}, remainingBucket=${remainingBucket}`
    );

    // Calculate total weight of terrain selections
    let totalWeight = 0;
    for (const selector of terrainList) {
      totalWeight += selector.weight;
    }

    let i = tilesToPlace;
    const failsafe = i * (state.s - state.n) * (state.e - state.w);
    let attempts = 0;

    while (i > 0 && attempts < failsafe) {
      // Get random position from island bounds
      const x = Math.floor(this.random() * (state.e - state.w)) + state.w;
      const y = Math.floor(this.random() * (state.s - state.n)) + state.n;

      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        // Check if this is a land tile on our current continent
        if (tiles[x][y].continentId === state.isleIndex && !state.placedMap[x][y]) {
          // Select terrain based on weighted probability
          const selector = this.selectTerrainByWeight(terrainList, totalWeight);
          if (!selector) {
            attempts++;
            continue;
          }

          // Check environmental conditions (temperature, wetness)
          if (!this.checkTerrainConditions(tiles[x][y], selector)) {
            if (attempts < 10) {
              // Only log first few attempts to avoid spam
              console.log(
                `DEBUG: Terrain ${selector.terrain} rejected at (${x},${y}) - tile temp=${tiles[x][y].temperature} vs required=${selector.tempCondition}, tile wetness=${tiles[x][y].wetness} vs required=${selector.wetCondition}`
              );
            }
            attempts++;
            continue;
          }

          // Check coastal proximity rules
          const isNearCoast = this.isCoastNearby(x, y, tiles);
          const shouldPlace = !isNearCoast || this.random() * 100 < coastDistance;

          // Additional placement logic for terrain contiguity
          const hasNeighborTerrain = this.hasNeighborWithTerrain(x, y, tiles, selector.terrain);
          const shouldPlaceContiguous =
            i * 3 > tilesToPlace * 2 || this.random() * 100 < 50 || hasNeighborTerrain;

          if (shouldPlace && shouldPlaceContiguous) {
            console.log(`DEBUG: Placing terrain ${selector.terrain} at (${x},${y})`);
            tiles[x][y].terrain = selector.terrain;
            state.placedMap[x][y] = true;
            i--;
          }
        }
      }

      attempts++;
    }

    console.log(`DEBUG: fillIsland completed - placed ${tilesToPlace - i} tiles, remaining=${i}`);
    return remainingBucket;
  }

  /**
   * Select terrain based on weighted probability
   */
  private selectTerrainByWeight(
    terrainList: TerrainSelector[],
    totalWeight: number
  ): TerrainSelector | null {
    if (totalWeight === 0) return null;

    const randomValue = this.random() * totalWeight;
    let currentWeight = 0;

    for (const selector of terrainList) {
      currentWeight += selector.weight;
      if (randomValue <= currentWeight) {
        return selector;
      }
    }

    // Fallback to last item
    return terrainList[terrainList.length - 1];
  }

  /**
   * Check if terrain conditions are met (temperature, wetness)
   */
  private checkTerrainConditions(tile: MapTile, selector: TerrainSelector): boolean {
    // Check temperature condition using bitwise AND like freeciv
    if (selector.tempCondition !== undefined) {
      if ((tile.temperature & selector.tempCondition) === 0) {
        return false;
      }
    }

    // Check wetness condition
    if (selector.wetCondition !== undefined) {
      switch (selector.wetCondition) {
        case WetnessCondition.DRY:
          if (tile.wetness > 33) return false;
          break;
        case WetnessCondition.NDRY:
          if (tile.wetness <= 33) return false;
          break;
        case WetnessCondition.WET:
          if (tile.wetness < 66) return false;
          break;
        case WetnessCondition.ALL:
          // Any wetness is acceptable
          break;
      }
    }

    return true;
  }

  /**
   * Check if there's a neighboring tile with the same terrain
   */
  private hasNeighborWithTerrain(
    x: number,
    y: number,
    tiles: MapTile[][],
    terrain: string
  ): boolean {
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        if (tiles[nx][ny].terrain === terrain) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if coast is nearby
   */
  private isCoastNearby(x: number, y: number, tiles: MapTile[][]): boolean {
    const radius = 1; // Adjacent tiles only for coastal check
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (terrain === 'coast' || terrain === 'ocean' || terrain === 'deep_ocean') {
            return true;
          }
        }
      }
    }
    return false;
  }

  public cleanup(): void {
    this.terrainLists.cleanup();
  }
}
