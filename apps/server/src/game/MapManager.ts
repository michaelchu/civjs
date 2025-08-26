import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';
import { MapData, MapTile, TerrainType, TemperatureType, TerrainProperty } from './map/MapTypes';
import { FractalHeightGenerator } from './map/FractalHeightGenerator';
import { TemperatureMap } from './map/TemperatureMap';
import { TerrainSelectionEngine } from './map/TerrainSelectionEngine';
import { IslandGenerator, IslandGeneratorState, TerrainPercentages } from './map/IslandGenerator';
import { RiverGenerator } from './map/RiverGenerator';
import { ResourceGenerator } from './map/ResourceGenerator';
import { StartingPositionGenerator } from './map/StartingPositionGenerator';

// Re-export commonly used types for backward compatibility
export {
  MapData,
  MapTile,
  TerrainType,
  TemperatureType,
  TerrainProperty,
  ResourceType,
} from './map/MapTypes';

export class MapManager {
  private width: number;
  private height: number;
  private mapData: MapData | null = null;
  private seed: string;
  private generator: string;
  private random: () => number;

  // Sub-generators
  private heightGenerator: FractalHeightGenerator;
  private temperatureMap: TemperatureMap;
  private islandGenerator: IslandGenerator;
  private riverGenerator: RiverGenerator;
  private resourceGenerator: ResourceGenerator;
  private startingPositionGenerator: StartingPositionGenerator;

  // Default terrain percentages (from freeciv mapgen.c:1498-1512)
  private terrainPercentages: TerrainPercentages = {
    river: 15, // Base 15% river coverage
    mountain: 25, // 25% mountainous terrain
    desert: 20, // 20% arid terrain
    forest: 30, // 30% forested areas
    swamp: 10, // 10% wetlands
  };

  constructor(width: number, height: number, seed?: string, generator: string = 'random') {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.generator = generator;
    this.random = this.createSeededRandom(this.seed);

    // Initialize sub-generators with generator type
    this.heightGenerator = new FractalHeightGenerator(
      width,
      height,
      this.random,
      30,
      100,
      this.generator
    );
    this.temperatureMap = new TemperatureMap(width, height);
    this.islandGenerator = new IslandGenerator(width, height, this.random);
    this.riverGenerator = new RiverGenerator(width, height, this.random);
    this.resourceGenerator = new ResourceGenerator(width, height, this.random);
    this.startingPositionGenerator = new StartingPositionGenerator(width, height);
  }

  /**
   * Generate map using traditional fractal method
   */
  public async generateMap(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map', { width: this.width, height: this.height, seed: this.seed });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Generate height map
    this.heightGenerator.generateHeightMap();
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Generate temperature map
    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Convert height map to basic land/ocean (like freeciv make_land())
    this.makeLand(tiles);

    // Smooth ocean depths based on distance from land (like freeciv smooth_water_depth())
    this.smoothWaterDepth(tiles);

    // Generate terrain using terrain engine (only for land variety)
    await this.generateTerrain(tiles);

    // Generate continents (must come before remove tiny islands)
    await this.generateContinents(tiles);

    // Remove tiny islands after continent assignment (like freeciv sequence)
    this.removeTinyIslands(tiles);

    // Convert the continuous temperature values to discrete TemperatureType enum
    this.convertTemperatureToEnum(tiles);
    this.generateWetnessMap(tiles, this.random);

    // Generate rivers
    await this.riverGenerator.generateAdvancedRivers(tiles);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const generationTime = Date.now() - startTime;
    logger.info('Map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
    });
  }

  /**
   * Generate map using island-based algorithm
   */
  public async generateMapWithIslands(
    players: Map<string, PlayerState>,
    generatorType: 2 | 3 | 4 = 4
  ): Promise<void> {
    logger.info('Generating map with island system', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Generate elevation and temperature maps for proper climate-based terrain selection
    this.heightGenerator.generateHeightMap();
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Generate temperature map
    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Initialize world for island generation
    const state = this.islandGenerator.initializeWorldForIslands(tiles);

    // Initialize bucket system (call with islandMass=0 for initialization)
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);

    logger.info(`Using map generator ${generatorType} for ${players.size} players`);

    // Generate islands using specified generator algorithm
    switch (generatorType) {
      case 2:
        await this.mapGenerator2(state, tiles, players.size);
        break;
      case 3:
        await this.mapGenerator3(state, tiles, players.size);
        break;
      case 4:
      default:
        await this.mapGenerator4(state, tiles, players.size);
        break;
    }

    // Cleanup
    this.islandGenerator.cleanup();

    // Smooth ocean depths based on distance from land (like freeciv smooth_water_depth())
    this.smoothWaterDepth(tiles);

    // Generate climate data now that islands exist
    this.convertTemperatureToEnum(tiles);
    this.generateWetnessMap(tiles, this.random);

    // Fill remaining unplaced tiles with plains/grassland/tundra (like freeciv make_plains())
    this.makePlains(tiles);

    // Apply final terrain improvements
    this.applyBiomeTransitions(tiles, this.random);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const endTime = Date.now();
    logger.info(`Island-based map generation completed in ${endTime - startTime}ms`);
  }

  /**
   * Generate map using pure random height generation (freeciv MAPGEN_RANDOM)
   * @reference freeciv/server/generator/height_map.c make_random_hmap()
   */
  public async generateMapRandom(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map with pure random algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Generate pure random height map (like freeciv make_random_hmap)
    const smooth = Math.max(
      1,
      1 + Math.floor(Math.sqrt(this.width * this.height) / 10) - Math.floor(players.size / 4)
    );
    const heightMap: number[] = [];

    // Initialize with random values (INITIALIZE_ARRAY equivalent)
    for (let i = 0; i < this.width * this.height; i++) {
      heightMap[i] = Math.floor(this.random() * 1000 * smooth);
    }

    // Apply smoothing passes
    for (let s = 0; s < smooth; s++) {
      this.smoothHeightMap(heightMap);
    }

    // Normalize height map to 0-hmap_max_level range
    this.adjustHeightMap(heightMap, 0, 1000);

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Generate temperature map
    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Convert height map to basic land/ocean (like freeciv make_land())
    this.makeLand(tiles);

    // Smooth ocean depths based on distance from land
    this.smoothWaterDepth(tiles);

    // Generate terrain using terrain engine
    await this.generateTerrain(tiles);

    // Generate continents
    await this.generateContinents(tiles);

    // Remove tiny islands
    this.removeTinyIslands(tiles);

    // Convert temperature and generate wetness
    this.convertTemperatureToEnum(tiles);
    this.generateWetnessMap(tiles, this.random);

    // Generate rivers
    await this.riverGenerator.generateAdvancedRivers(tiles);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const generationTime = Date.now() - startTime;
    logger.info('Pure random map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
    });
  }

  /**
   * Generate map using fair islands algorithm (freeciv map_generate_fair_islands)
   * @reference freeciv/server/generator/mapgen.c map_generate_fair_islands()
   */
  public async generateMapFairIslands(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map with fair islands algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      playerCount: players.size,
    });

    // Fair islands is a complex algorithm that tries to create one large continent
    // with fair starting positions for all players. If it fails, it falls back to regular islands.
    // For now, we'll implement a simplified version that creates a large central landmass
    // with balanced starting positions.

    const startTime = Date.now();

    // Try to generate fair islands, with fallback to regular island generation
    try {
      // Initialize map structure
      const tiles: MapTile[][] = [];
      for (let x = 0; x < this.width; x++) {
        tiles[x] = [];
        for (let y = 0; y < this.height; y++) {
          tiles[x][y] = this.createBaseTile(x, y);
        }
      }

      // Create a large central continent using modified island generation
      // Generate elevation and temperature maps for proper climate-based terrain selection
      this.heightGenerator.generateHeightMap();
      const heightMap = this.heightGenerator.getHeightMap();

      // Apply height data to tiles
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          const index = y * this.width + x;
          tiles[x][y].elevation = heightMap[index];
        }
      }

      // Generate temperature map
      this.temperatureMap.createTemperatureMap(tiles, heightMap);

      // Apply temperature data to tiles
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
        }
      }

      // Initialize world for island generation
      const state = this.islandGenerator.initializeWorldForIslands(tiles);

      // Create one large central continent suitable for all players
      const largeContinentMass = Math.floor(state.totalMass * 0.7); // 70% of total land mass
      await this.islandGenerator.makeIsland(
        largeContinentMass,
        players.size,
        state,
        tiles,
        this.terrainPercentages,
        95 // Require at least 95% of requested size
      );

      // Add some smaller supplementary islands
      const smallIslandMass = Math.floor(state.totalMass * 0.1);
      for (let i = 0; i < Math.min(players.size, 3); i++) {
        await this.islandGenerator.makeIsland(
          smallIslandMass,
          0,
          state,
          tiles,
          this.terrainPercentages
        );
      }

      // Cleanup
      this.islandGenerator.cleanup();

      // Complete the generation process
      this.smoothWaterDepth(tiles);
      this.convertTemperatureToEnum(tiles);
      this.generateWetnessMap(tiles, this.random);
      this.makePlains(tiles);
      this.applyBiomeTransitions(tiles, this.random);

      await this.resourceGenerator.generateResources(tiles);

      const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
        tiles,
        players
      );

      this.mapData = {
        width: this.width,
        height: this.height,
        tiles,
        startingPositions,
        seed: this.seed,
        generatedAt: new Date(),
      };

      const generationTime = Date.now() - startTime;
      logger.info('Fair islands map generation completed', {
        width: this.width,
        height: this.height,
        generationTime,
      });
    } catch (error) {
      logger.warn('Fair islands generation failed, falling back to regular islands', { error });
      // Fallback to regular island generation
      await this.generateMapWithIslands(players, 4);
    }
  }

  /**
   * Generate map using fracture algorithm (freeciv make_fracture_map)
   * @reference freeciv/server/generator/fracture_map.c make_fracture_map()
   */
  public async generateMapFracture(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map with fracture algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Implement fracture map algorithm based on freeciv make_fracture_map()
    const numLandmass = 20 + 15 * Math.floor(Math.sqrt(this.width * this.height) / 10);
    const fracturePoints: Array<{ x: number; y: number }> = [];
    const landmasses: Array<{
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      elevation: number;
    }> = [];

    // Setup landmasses along the borders (these will be sunken to create ocean)
    let nn = 0;
    for (let x = 3; x < this.width; x += 5) {
      fracturePoints.push({ x, y: 3 });
      fracturePoints.push({ x, y: this.height - 3 });
      nn += 2;
    }
    for (let y = 3; y < this.height; y += 5) {
      fracturePoints.push({ x: 3, y });
      fracturePoints.push({ x: this.width - 3, y });
      nn += 2;
    }

    const borderPoints = nn;

    // Add random interior fracture points
    for (let i = 0; i < numLandmass; i++) {
      fracturePoints.push({
        x: Math.floor(this.random() * (this.width - 6)) + 3,
        y: Math.floor(this.random() * (this.height - 6)) + 3,
      });
    }

    // Initialize landmasses
    for (let i = 0; i < fracturePoints.length; i++) {
      landmasses.push({
        minX: this.width - 1,
        minY: this.height - 1,
        maxX: 0,
        maxY: 0,
        elevation: i < borderPoints ? 0 : Math.floor(this.random() * 1000), // Sink border masses
      });
    }

    // Assign cells to landmasses using expanding circles (Bresenham algorithm)
    const continentMap: number[][] = Array(this.width)
      .fill(null)
      .map(() => Array(this.height).fill(0));

    for (let radius = 1; radius < Math.floor(this.width / 2); radius++) {
      for (let i = 0; i < fracturePoints.length; i++) {
        this.assignFractureCircle(
          continentMap,
          fracturePoints[i].x,
          fracturePoints[i].y,
          radius,
          i + 1,
          landmasses[i]
        );
      }
    }

    // Create height map from fracture assignment
    const heightMap: number[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const continentId = continentMap[x][y];
        let elevation = continentId > 0 ? landmasses[continentId - 1].elevation : 0;

        // Add random fuzz
        if (elevation > 200) {
          // Shore level equivalent
          elevation += Math.floor(this.random() * 4) - 2;
        }
        if (elevation <= 200) {
          elevation = 201; // Ensure land stays above shore level
        }

        heightMap.push(elevation);
      }
    }

    // Normalize height map
    this.adjustHeightMap(heightMap, 0, 1000);

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
        tiles[x][y].continentId = continentMap[x][y];
      }
    }

    // Generate temperature map
    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Convert height map to basic land/ocean
    this.makeLand(tiles);

    // Complete the generation process
    this.smoothWaterDepth(tiles);
    await this.generateTerrain(tiles);
    await this.generateContinents(tiles);
    this.removeTinyIslands(tiles);
    this.convertTemperatureToEnum(tiles);
    this.generateWetnessMap(tiles, this.random);

    await this.riverGenerator.generateAdvancedRivers(tiles);
    await this.resourceGenerator.generateResources(tiles);

    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const generationTime = Date.now() - startTime;
    logger.info('Fracture map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
    });
  }

  private createBaseTile(x: number, y: number): MapTile {
    return {
      x,
      y,
      terrain: 'ocean',
      elevation: 0,
      riverMask: 0,
      continentId: 0,
      isExplored: false,
      isVisible: false,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      unitIds: [],
      properties: {},
      temperature: TemperatureType.TEMPERATE,
      wetness: 50,
    };
  }

  /**
   * Fill remaining unplaced tiles with plains/grassland/tundra based on climate
   * @reference freeciv/server/generator/mapgen.c make_plains() and make_plain()
   */
  private makePlains(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Only fill tiles that haven't been placed yet (still have default terrain)
        if (tile.terrain === 'grassland') {
          // Fill based on temperature like freeciv make_plain()
          if (tile.temperature === TemperatureType.FROZEN) {
            // Frozen: pick_terrain(MG_FROZEN, MG_UNUSED, MG_MOUNTAINOUS)
            tile.terrain = this.random() < 0.5 ? 'glacier' : 'snow';
          } else if (tile.temperature === TemperatureType.COLD) {
            // Cold: pick_terrain(MG_COLD, MG_UNUSED, MG_MOUNTAINOUS)
            tile.terrain = this.random() < 0.7 ? 'tundra' : 'plains';
          } else {
            // Temperate/Tropical: pick_terrain(MG_TEMPERATE, MG_GREEN, MG_MOUNTAINOUS)
            tile.terrain = this.random() < 0.6 ? 'grassland' : 'plains';
          }

          this.setTerrainProperties(tile);
        }
      }
    }
  }

  private async generateTerrain(
    tiles: MapTile[][],
    preserveSpecializedTerrain: boolean = false
  ): Promise<void> {
    // Apply smoothing passes for natural terrain transitions
    this.heightGenerator.applySmoothingPasses(2);

    const shoreLevel = this.heightGenerator.getShoreLevel();
    const mountainLevel = this.heightGenerator.getMountainLevel();

    logger.info('Height generation completed', {
      generator: this.generator,
      shoreLevel,
      mountainLevel,
    });

    // Create terrain engine with proper freeciv reference levels
    const terrainEngine = new TerrainSelectionEngine(this.random, shoreLevel, mountainLevel);

    // Phase 2: Assign terrain using property-based selection (following freeciv reference)
    // Only apply to land tiles - ocean/coast already set by makeLand()
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Only modify land tiles, leave ocean tiles as-is
        // If preserveSpecializedTerrain is true, only modify 'grassland' tiles
        if (!this.isOceanTerrain(tile.terrain)) {
          if (!preserveSpecializedTerrain || tile.terrain === 'grassland') {
            const selectedTerrain = terrainEngine.pickTerrain(
              tile.temperature,
              tile.wetness,
              tile.elevation
            );

            tile.terrain = selectedTerrain;
          }
        }

        // Set terrain properties based on selected terrain
        this.setTerrainProperties(tile);
      }
    }

    // Phase 3: Apply biome transition logic for more natural borders
    this.applyBiomeTransitions(tiles, this.random);
  }

  private setTerrainProperties(tile: MapTile): void {
    // Set terrain properties based on terrain type
    const terrainPropertyMap: Record<TerrainType, Partial<Record<TerrainProperty, number>>> = {
      // Water terrains
      ocean: { [TerrainProperty.OCEAN_DEPTH]: 0 },
      coast: { [TerrainProperty.OCEAN_DEPTH]: 32 },
      deep_ocean: { [TerrainProperty.OCEAN_DEPTH]: 87 },
      lake: { [TerrainProperty.WET]: 100 },

      // Land terrains
      desert: {
        [TerrainProperty.DRY]: 100,
        [TerrainProperty.TROPICAL]: 50,
        [TerrainProperty.TEMPERATE]: 20,
      },
      plains: {
        [TerrainProperty.COLD]: 20,
        [TerrainProperty.WET]: 20,
        [TerrainProperty.FOLIAGE]: 50,
        [TerrainProperty.TEMPERATE]: 50,
      },
      grassland: { [TerrainProperty.GREEN]: 50, [TerrainProperty.TEMPERATE]: 50 },
      forest: { [TerrainProperty.GREEN]: 50, [TerrainProperty.MOUNTAINOUS]: 30 },
      jungle: {
        [TerrainProperty.FOLIAGE]: 50,
        [TerrainProperty.TROPICAL]: 50,
        [TerrainProperty.WET]: 50,
      },
      hills: { [TerrainProperty.MOUNTAINOUS]: 70 },
      mountains: { [TerrainProperty.GREEN]: 50, [TerrainProperty.TEMPERATE]: 50 },
      swamp: {
        [TerrainProperty.WET]: 100,
        [TerrainProperty.TROPICAL]: 10,
        [TerrainProperty.TEMPERATE]: 10,
        [TerrainProperty.COLD]: 10,
      },
      tundra: { [TerrainProperty.COLD]: 50 },
      snow: { [TerrainProperty.FROZEN]: 100 },
      glacier: { [TerrainProperty.FROZEN]: 100 },
    };

    const properties = terrainPropertyMap[tile.terrain] || {};
    tile.properties = properties;
  }

  private async generateContinents(tiles: MapTile[][]): Promise<void> {
    let continentId = 1;
    const visited = new Set<string>();

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const key = `${x},${y}`;
        if (visited.has(key) || !this.isLandTile(tiles[x][y].terrain)) {
          continue;
        }

        // Flood fill to mark continent
        this.floodFillContinent(tiles, x, y, continentId, visited);
        continentId++;
      }
    }
  }

  private floodFillContinent(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    continentId: number,
    visited: Set<string>
  ): void {
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
        continue;
      }

      if (!this.isLandTile(tiles[x][y].terrain)) {
        continue;
      }

      visited.add(key);
      tiles[x][y].continentId = continentId;

      // Add neighbors to stack
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /**
   * Convert height map to basic land/ocean terrain (like freeciv make_land())
   * @reference freeciv/server/generator/mapgen.c make_land()
   */
  private makeLand(tiles: MapTile[][]): void {
    const shoreLevel = this.heightGenerator.getShoreLevel();
    console.log('DEBUG: makeLand - shoreLevel =', shoreLevel);

    let oceanCount = 0,
      landCount = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const elevation = tile.elevation;

        if (elevation < shoreLevel) {
          // All water starts as generic ocean - smooth_water_depth will assign depths
          // This matches freeciv which starts all water as TC_OCEAN
          tile.terrain = 'ocean';
          oceanCount++;
        } else {
          // Land areas - start with a basic land terrain
          // The terrain engine will add variety later
          tile.terrain = 'grassland'; // Temporary base terrain for land
          landCount++;
        }
      }
    }

    const totalTiles = this.width * this.height;
    console.log('DEBUG: makeLand initial terrain:');
    console.log(
      '  ocean (all water):',
      oceanCount,
      '(' + ((oceanCount / totalTiles) * 100).toFixed(1) + '%)'
    );
    console.log('  land:', landCount, '(' + ((landCount / totalTiles) * 100).toFixed(1) + '%)');
  }

  /**
   * Remove tiny islands (1x1 land tiles surrounded by water)
   * @reference freeciv/server/generator/mapgen.c remove_tiny_islands() and is_tiny_island()
   */
  private removeTinyIslands(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.isTinyIsland(tiles, x, y)) {
          // Convert tiny island to shallow ocean
          tiles[x][y].terrain = 'ocean';
          tiles[x][y].continentId = 0; // Ocean continent ID
        }
      }
    }
  }

  /**
   * Check if a tile is a tiny island (land surrounded by water on all sides including diagonals)
   * @reference freeciv/server/generator/mapgen.c is_tiny_island()
   */
  private isTinyIsland(tiles: MapTile[][], x: number, y: number): boolean {
    const tile = tiles[x][y];

    // Must be land tile (not ocean or frozen)
    if (this.isOceanTerrain(tile.terrain) || this.isFrozenTerrain(tile.terrain)) {
      return false;
    }

    // Check all adjacent tiles (including diagonals like freeciv adjc_iterate)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip center tile

        const nx = x + dx;
        const ny = y + dy;

        // Check bounds
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
          continue; // Treat out-of-bounds as ocean
        }

        // If any adjacent tile is NOT ocean, this is not a tiny island
        if (!this.isOceanTerrain(tiles[nx][ny].terrain)) {
          return false;
        }
      }
    }

    return true; // All adjacent tiles are ocean
  }

  /**
   * Check if terrain type is ocean
   */
  private isOceanTerrain(terrain: string): boolean {
    return terrain === 'ocean' || terrain === 'deep_ocean' || terrain === 'coast';
  }

  /**
   * Check if terrain type is frozen (excluded from tiny island detection)
   */
  private isFrozenTerrain(terrain: string): boolean {
    return terrain === 'glacier' || terrain === 'snow';
  }

  /**
   * Smooth water depth based on distance from land (like freeciv smooth_water_depth())
   * @reference freeciv/server/generator/mapgen_utils.c smooth_water_depth()
   * Creates natural coastal transitions: land -> coast -> ocean -> deep_ocean
   */
  private smoothWaterDepth(tiles: MapTile[][]): void {
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv reference
    const OCEAN_DEPTH_STEP = 25; // Distance step for ocean depth calculation (not used with custom depths)
    const OCEAN_DIST_MAX = Math.floor(TERRAIN_OCEAN_DEPTH_MAXIMUM / OCEAN_DEPTH_STEP); // = 4

    console.log('DEBUG: Starting smooth_water_depth()');

    // Debug: Count terrain types before processing
    const beforeCounts = { coast: 0, ocean: 0, deep_ocean: 0, land: 0 };
    const distanceDistribution: Record<number, number> = {};
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const terrain = tiles[x][y].terrain;
        if (terrain === 'coast') beforeCounts.coast++;
        else if (terrain === 'ocean') beforeCounts.ocean++;
        else if (terrain === 'deep_ocean') beforeCounts.deep_ocean++;
        else beforeCounts.land++;
      }
    }
    console.log('DEBUG: Before smoothWaterDepth:', beforeCounts);

    // First pass: Set ocean depths based on distance from land
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Skip non-ocean tiles
        if (!this.isOceanTerrain(tile.terrain)) {
          continue;
        }

        // Calculate distance to land - exact freeciv logic
        const distToLand = this.realDistanceToLand(tiles, x, y, OCEAN_DIST_MAX);

        // Track distance distribution
        distanceDistribution[distToLand] = (distanceDistribution[distToLand] || 0) + 1;

        // DEBUG: Sample a few tiles to understand distance calculation
        if ((x === 10 && y === 10) || (x === 40 && y === 25)) {
          console.log(`DEBUG: Tile (${x},${y}) terrain=${tile.terrain} distToLand=${distToLand}`);
        }

        let depth: number;
        if (distToLand <= OCEAN_DIST_MAX) {
          // Near land: use EXACT freeciv formula from mapgen_utils.c
          // ocean = pick_ocean(dist * OCEAN_DEPTH_STEP + fc_rand(OCEAN_DEPTH_RAND), ...);
          const OCEAN_DEPTH_RAND = 15;
          depth = distToLand * OCEAN_DEPTH_STEP + Math.floor(this.random() * OCEAN_DEPTH_RAND);
        } else {
          // Far from land: make it deep ocean
          // In freeciv, tiles beyond OCEAN_DIST_MAX remain as deep ocean
          depth = TERRAIN_OCEAN_DEPTH_MAXIMUM;
        }

        const isFrozen = this.isFrozenTerrain(tile.terrain);
        const newOceanType = this.pickOcean(depth, isFrozen);

        if (newOceanType && newOceanType !== tile.terrain) {
          if (x < 3 && y < 3) {
            console.log(`DEBUG: Tile (${x},${y}) changing from ${tile.terrain} to ${newOceanType}`);
          }
          tile.terrain = newOceanType as TerrainType;
        }
      }
    }

    // Debug: Show distance distribution and expected depth ranges
    console.log('DEBUG: Distance distribution:', distanceDistribution);
    console.log('DEBUG: Expected depths by distance:');
    console.log('  Distance 1: 25-39 → ocean (closest to 32)');
    console.log('  Distance 2: 50-64 → ocean/deep_ocean mix');
    console.log('  Distance 3: 75-89 → deep_ocean (closest to 87)');

    // Second pass: Smooth based on adjacent ocean types for continuity
    // Using exact freeciv most_adjacent_ocean_type() logic
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!this.isOceanTerrain(tile.terrain)) {
          continue;
        }

        const mostCommonAdjacentOcean = this.getMostAdjacentOceanType(tiles, x, y);
        if (mostCommonAdjacentOcean && mostCommonAdjacentOcean !== tile.terrain) {
          // Only change if there's strong consensus from neighbors (need 2/3 of the 8 adjacent tiles)
          tile.terrain = mostCommonAdjacentOcean as TerrainType;
        }
      }
    }

    // Debug: Count terrain types after processing
    const afterCounts = { coast: 0, ocean: 0, deep_ocean: 0, land: 0 };
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const terrain = tiles[x][y].terrain;
        if (terrain === 'coast') afterCounts.coast++;
        else if (terrain === 'ocean') afterCounts.ocean++;
        else if (terrain === 'deep_ocean') afterCounts.deep_ocean++;
        else afterCounts.land++;
      }
    }
    console.log('DEBUG: After smoothWaterDepth:', afterCounts);
    console.log(
      'DEBUG: Changes - Coast:',
      afterCounts.coast - beforeCounts.coast,
      'Ocean:',
      afterCounts.ocean - beforeCounts.ocean,
      'Deep Ocean:',
      afterCounts.deep_ocean - beforeCounts.deep_ocean
    );

    console.log('DEBUG: Completed smooth_water_depth()');
  }

  /**
   * Calculate real distance to nearest land tile
   * @reference freeciv/server/generator/mapgen_utils.c real_distance_to_land()
   * Exact copy of freeciv logic using square_dxy_iterate and map_vector_to_real_distance
   */
  private realDistanceToLand(
    tiles: MapTile[][],
    centerX: number,
    centerY: number,
    max: number
  ): number {
    // square_dxy_iterate: iterate through all tiles in a square with given center and radius
    for (let dx = -max; dx <= max; dx++) {
      for (let dy = -max; dy <= max; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;

        // Check bounds (freeciv automatically handles this in square_dxy_iterate)
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
          continue;
        }

        // if (terrain_type_terrain_class(tile_terrain(atile)) != TC_OCEAN)
        if (!this.isOceanTerrain(tiles[x][y].terrain)) {
          // return map_vector_to_real_distance(dx, dy);
          return this.mapVectorToRealDistance(dx, dy);
        }
      }
    }

    return max + 1;
  }

  /**
   * Return the "real" distance for a given vector
   * @reference freeciv/common/map.c map_vector_to_real_distance()
   * Exact copy of freeciv logic
   */
  private mapVectorToRealDistance(dx: number, dy: number): number {
    const absdx = Math.abs(dx);
    const absdy = Math.abs(dy);

    // For square maps (not hex), freeciv uses Chebyshev distance (max of dx, dy)
    // This is the standard "8-directional movement" distance
    return Math.max(absdx, absdy);
  }

  /**
   * Pick appropriate ocean terrain based on depth - exact freeciv algorithm
   * @reference freeciv/server/generator/mapgen_utils.c pick_ocean()
   * Finds terrain with ocean depth property closest to calculated depth
   */
  private pickOcean(depth: number, _isFrozen: boolean): string | null {
    // Freeciv ocean terrain types with their MG_OCEAN_DEPTH property values
    // From freeciv data/classic/terrain.ruleset:
    const oceanTerrains = [
      { type: 'coast', oceanDepth: 0 }, // property_ocean_depth = 0
      { type: 'ocean', oceanDepth: 32 }, // property_ocean_depth = 32
      { type: 'deep_ocean', oceanDepth: 87 }, // property_ocean_depth = 87
    ];

    let bestTerrain: string | null = null;
    let bestMatch = 100; // TERRAIN_OCEAN_DEPTH_MAXIMUM

    // Find terrain with closest ocean depth property to calculated depth
    for (const terrain of oceanTerrains) {
      const match = Math.abs(depth - terrain.oceanDepth);

      if (bestMatch > match) {
        bestMatch = match;
        bestTerrain = terrain.type;
      }
    }

    return bestTerrain;
  }

  /**
   * Get most common adjacent ocean type for smoothing
   * @reference freeciv/server/generator/mapgen_utils.c most_adjacent_ocean_type()
   * Exact copy of freeciv logic: needs 2/3 of adjacent tiles to be same type
   */
  private getMostAdjacentOceanType(tiles: MapTile[][], x: number, y: number): string | null {
    // Freeciv: const int need = 2 * MAP_NUM_VALID_DIRS / 3;
    // For square maps: MAP_NUM_VALID_DIRS = 8, so need = 2 * 8 / 3 = 5.33 → 5 when floored (freeciv uses integer division)
    const MAP_NUM_VALID_DIRS = 8;
    const need = Math.floor((2 * MAP_NUM_VALID_DIRS) / 3); // = 5, exact freeciv logic

    // Check all 8 adjacent directions (like freeciv adjc_iterate)
    const directions = [
      { dx: -1, dy: -1 }, // NW
      { dx: 0, dy: -1 }, // N
      { dx: 1, dy: -1 }, // NE
      { dx: -1, dy: 0 }, // W
      { dx: 1, dy: 0 }, // E
      { dx: -1, dy: 1 }, // SW
      { dx: 0, dy: 1 }, // S
      { dx: 1, dy: 1 }, // SE
    ];

    // Try each ocean terrain type and count how many adjacent tiles match
    const oceanTerrainTypes = ['coast', 'ocean', 'deep_ocean'];

    for (const terrainType of oceanTerrainTypes) {
      let count = 0;

      for (const dir of directions) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (terrain === terrainType) {
            count++;
            if (count >= need) {
              return terrainType; // Found enough matching neighbors
            }
          }
        }
      }
    }

    return null; // No terrain type has enough matching neighbors
  }

  /**
   * Convert continuous temperature values from TemperatureMap to discrete TemperatureType enum
   * Uses proper thresholds instead of crude latitude bands
   */
  private convertTemperatureToEnum(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Convert continuous temperature value to discrete enum (respects TemperatureMap)
        const tempValue = tile.temperature; // Keep the sophisticated value from TemperatureMap
        const MAX_COLATITUDE = 1000;

        // Use freeciv-based thresholds instead of crude latitude bands
        if (tempValue >= MAX_COLATITUDE * 0.8) {
          tile.temperature = TemperatureType.FROZEN;
        } else if (tempValue >= MAX_COLATITUDE * 0.5) {
          tile.temperature = TemperatureType.COLD;
        } else if (tempValue <= MAX_COLATITUDE * 0.25) {
          tile.temperature = TemperatureType.TROPICAL;
        } else {
          tile.temperature = TemperatureType.TEMPERATE;
        }

        // Optional: Add small amount of randomness (using built-in random for simplicity)
        if (Math.random() < 0.05) {
          const temps = [
            TemperatureType.FROZEN,
            TemperatureType.COLD,
            TemperatureType.TEMPERATE,
            TemperatureType.TROPICAL,
          ];
          tile.temperature = temps[Math.floor(Math.random() * temps.length)];
        }
      }
    }
  }

  private generateWetnessMap(tiles: MapTile[][], random: () => number): void {
    // Use default wetness base for better terrain variety
    const baseWetness = 50;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // Start with user's wetness setting
        let wetness = baseWetness;

        // Reduce water influence for better terrain variety
        wetness += this.calculateWetnessFromNearbyWater(tiles, x, y) * 0.3;

        // Add randomness for variety
        wetness += (random() - 0.5) * 40;

        tiles[x][y].wetness = Math.max(0, Math.min(100, wetness));
      }
    }
  }

  private applyBiomeTransitions(tiles: MapTile[][], random: () => number): void {
    // Simple biome transition smoothing
    const newTerrain = tiles.map(col => col.map(tile => ({ ...tile })));

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!this.isLandTile(tile.terrain)) continue;

        // Check neighbors for terrain consistency
        const neighbors = this.getNeighbors(tiles, x, y);
        const landNeighbors = neighbors.filter(n => this.isLandTile(n.terrain));

        if (landNeighbors.length > 0 && random() < 0.1) {
          // 10% chance to blend with neighbors
          const randomNeighbor = landNeighbors[Math.floor(random() * landNeighbors.length)];
          if (this.isClimateCompatible(tile, randomNeighbor)) {
            newTerrain[x][y].terrain = randomNeighbor.terrain;
          }
        }
      }
    }

    // Apply changes and update properties
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].terrain !== newTerrain[x][y].terrain) {
          tiles[x][y].terrain = newTerrain[x][y].terrain;
          this.setTerrainProperties(tiles[x][y]);
        }
      }
    }
  }

  private isClimateCompatible(tile1: MapTile, tile2: MapTile): boolean {
    return tile1.temperature === tile2.temperature || Math.abs(tile1.wetness - tile2.wetness) < 30;
  }

  private calculateWetnessFromNearbyWater(tiles: MapTile[][], x: number, y: number): number {
    let wetnessBonus = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (!this.isLandTile(terrain)) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            wetnessBonus += 20 / (1 + distance);
          }
        }
      }
    }
    return wetnessBonus;
  }

  private getNeighbors(tiles: MapTile[][], x: number, y: number): MapTile[] {
    const neighbors: MapTile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          neighbors.push(tiles[nx][ny]);
        }
      }
    }
    return neighbors;
  }

  // Map generator 2 - One large continent (from freeciv mapgenerator2)
  private async mapGenerator2(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Put 70% of land in big continents, 20% in medium, and 10% in small
    const bigfrac = 70,
      midfrac = 20,
      smallfrac = 10;
    const totalweight = playerCount + 2;

    // Create one large continent for most players
    const bigIslandMass = Math.floor((bigfrac * state.totalMass) / totalweight);
    await this.islandGenerator.makeIsland(
      bigIslandMass,
      1,
      state,
      tiles,
      this.terrainPercentages,
      95 // min 95% of requested size
    );

    // Create medium islands
    const mediumIslandMass = Math.floor((midfrac * state.totalMass) / totalweight);
    await this.islandGenerator.makeIsland(
      mediumIslandMass,
      0,
      state,
      tiles,
      this.terrainPercentages
    );

    // Create small islands for remaining players
    const smallIslandMass = Math.floor((smallfrac * state.totalMass) / totalweight);
    for (let i = 0; i < playerCount; i++) {
      await this.islandGenerator.makeIsland(
        smallIslandMass,
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }
  }

  // Map generator 3 - Several large islands (from freeciv mapgenerator3)
  private async mapGenerator3(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Create a few large islands suitable for multiple players each
    const maxMassDiv6 = 20;
    const bigIslands = Math.floor(Math.sqrt(playerCount)) || 1;

    let landmass = state.totalMass;
    const islandmass = Math.floor(landmass / bigIslands);
    let size = islandmass;

    // Create big islands for players
    for (let j = 0; j < bigIslands && j < 500; j++) {
      await this.islandGenerator.makeIsland(size, 1, state, tiles, this.terrainPercentages);

      landmass -= size;
      if (landmass < islandmass / maxMassDiv6) break;
    }

    // Add some smaller supplementary islands
    size = Math.floor((islandmass * 11) / 8);
    if (size < 2) size = 2;

    for (let j = 0; j < playerCount && j < 1500; j++) {
      await this.islandGenerator.makeIsland(size, 0, state, tiles, this.terrainPercentages);

      landmass -= size;
      if (landmass <= 0) break;
    }
  }

  // Map generator 4 - Many islands, fair distribution (from freeciv mapgenerator4)
  private async mapGenerator4(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    let bigweight = 70;

    // Adjust big island weight based on land percentage
    // (In freeciv this would be wld.map.server.landpercent)
    const landPercent = 30; // Our default 30% land coverage
    if (landPercent > 60) {
      bigweight = 30;
    } else if (landPercent > 40) {
      bigweight = 50;
    }

    const totalweight = bigweight + (100 - bigweight);
    let i = Math.floor(playerCount / 3);

    // Create some 3-player big islands
    if (i === 0 && playerCount > 2) {
      await this.islandGenerator.makeIsland(
        Math.floor((bigweight * 3 * state.totalMass) / totalweight),
        3,
        state,
        tiles,
        this.terrainPercentages
      );
    } else {
      i++;
    }

    // Create 2-player big islands
    while (--i > 0) {
      await this.islandGenerator.makeIsland(
        Math.floor((bigweight * 2 * state.totalMass) / totalweight),
        2,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    // Create small 1-player islands
    for (let j = 0; j < playerCount; j++) {
      await this.islandGenerator.makeIsland(
        Math.floor((20 * state.totalMass) / totalweight),
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    // Create tiny islands for variety
    for (let j = 0; j < playerCount; j++) {
      await this.islandGenerator.makeIsland(
        Math.floor((10 * state.totalMass) / totalweight),
        0,
        state,
        tiles,
        this.terrainPercentages
      );
    }
  }

  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }

  private generateSeed(): string {
    // Use multiple entropy sources for maximum uniqueness
    const timestamp = Date.now().toString(36);
    const random1 = Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15);

    // Use different entropy sources depending on environment
    let entropy: string;
    if (typeof performance !== 'undefined' && performance.now) {
      // Browser environment - use performance.now()
      entropy = performance.now().toString(36);
    } else if (typeof process !== 'undefined' && process.hrtime && process.hrtime.bigint) {
      // Node.js environment - use high-resolution time
      entropy = process.hrtime.bigint().toString(36);
    } else if (typeof process !== 'undefined' && process.pid) {
      // Node.js fallback - use process ID + additional randomness
      entropy = `${process.pid}-${Math.random().toString(36).substring(2)}`.replace(/\./g, '');
    } else {
      // Final fallback - use additional random values
      entropy = `${Math.random().toString(36)}-${Math.random().toString(36)}`.replace(/\./g, '');
    }

    return `${timestamp}-${random1}-${random2}-${entropy}`.replace(/\./g, '');
  }

  private createSeededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Linear congruential generator
    return () => {
      hash = (hash * 1664525 + 1013904223) & 0x7fffffff;
      return hash / 0x80000000;
    };
  }

  /**
   * Smooth a height map using freeciv's smooth_int_map algorithm
   * @reference freeciv/server/generator/mapgen_utils.c smooth_int_map()
   */
  private smoothHeightMap(heightMap: number[]): void {
    const smoothed = [...heightMap];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        let sum = 0;
        let count = 0;

        // Check all adjacent cells (8-directional)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
              const nindex = ny * this.width + nx;
              sum += heightMap[nindex];
              count++;
            }
          }
        }

        smoothed[index] = Math.floor(sum / count);
      }
    }

    // Copy smoothed values back
    for (let i = 0; i < heightMap.length; i++) {
      heightMap[i] = smoothed[i];
    }
  }

  /**
   * Adjust height map to specified range (freeciv adjust_int_map)
   * @reference freeciv/server/generator/mapgen_utils.c adjust_int_map()
   */
  private adjustHeightMap(heightMap: number[], minVal: number, maxVal: number): void {
    let currentMin = Math.min(...heightMap);
    let currentMax = Math.max(...heightMap);

    if (currentMin === currentMax) {
      // Avoid division by zero
      for (let i = 0; i < heightMap.length; i++) {
        heightMap[i] = minVal;
      }
      return;
    }

    const scale = (maxVal - minVal) / (currentMax - currentMin);

    for (let i = 0; i < heightMap.length; i++) {
      heightMap[i] = Math.floor((heightMap[i] - currentMin) * scale + minVal);
    }
  }

  /**
   * Assign fracture circle using Bresenham circle algorithm
   * @reference freeciv/server/generator/fracture_map.c circle_bresenham() and fmfill()
   */
  private assignFractureCircle(
    continentMap: number[][],
    centerX: number,
    centerY: number,
    radius: number,
    continentId: number,
    landmass: { minX: number; minY: number; maxX: number; maxY: number; elevation: number }
  ): void {
    if (radius === 0) return;

    let x = 0;
    let y = radius;
    let p = 3 - 2 * radius;

    while (y >= x) {
      // Fill 8 octants of the circle
      this.fillFractureArea(continentMap, centerX - x, centerY - y, continentId, landmass);
      this.fillFractureArea(continentMap, centerX - y, centerY - x, continentId, landmass);
      this.fillFractureArea(continentMap, centerX + y, centerY - x, continentId, landmass);
      this.fillFractureArea(continentMap, centerX + x, centerY - y, continentId, landmass);
      this.fillFractureArea(continentMap, centerX - x, centerY + y, continentId, landmass);
      this.fillFractureArea(continentMap, centerX - y, centerY + x, continentId, landmass);
      this.fillFractureArea(continentMap, centerX + y, centerY + x, continentId, landmass);
      this.fillFractureArea(continentMap, centerX + x, centerY + y, continentId, landmass);

      if (p < 0) {
        p += 4 * x++ + 6;
      } else {
        p += 4 * (x++ - y--) + 10;
      }
    }
  }

  /**
   * Fill fracture area in 3x3 pattern to avoid holes
   * @reference freeciv/server/generator/fracture_map.c fmfill()
   */
  private fillFractureArea(
    continentMap: number[][],
    x: number,
    y: number,
    continentId: number,
    landmass: { minX: number; minY: number; maxX: number; maxY: number; elevation: number }
  ): void {
    // Handle wrapping for x coordinate
    if (x < 0) {
      x = this.width + x;
    } else if (x >= this.width) {
      x = x - this.width;
    }

    // Fill 3x3 area around the point
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        let nx = x + dx;
        let ny = y + dy;

        // Handle x wrapping
        if (nx < 0) {
          nx = this.width + nx;
        } else if (nx >= this.width) {
          nx = nx - this.width;
        }

        // Clamp y coordinate
        if (ny < 0 || ny >= this.height) {
          continue;
        }

        // Only assign if not already assigned or if this landmass has higher elevation
        if (continentMap[nx][ny] === 0 || (continentMap[nx][ny] > 0 && landmass.elevation > 0)) {
          continentMap[nx][ny] = continentId;

          // Update landmass bounds
          landmass.minX = Math.min(landmass.minX, nx);
          landmass.maxX = Math.max(landmass.maxX, nx);
          landmass.minY = Math.min(landmass.minY, ny);
          landmass.maxY = Math.max(landmass.maxY, ny);
        }
      }
    }
  }

  // Public API methods
  public getMapData(): MapData | null {
    return this.mapData;
  }

  public getTile(x: number, y: number): MapTile | null {
    if (!this.mapData || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.mapData.tiles[x][y];
  }

  public getVisibleTiles(x: number, y: number, radius: number): MapTile[] {
    if (!this.mapData) return [];

    const visible: MapTile[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radius) {
            visible.push(this.mapData.tiles[nx][ny]);
          }
        }
      }
    }
    return visible;
  }

  public updateTileVisibility(_playerId: string, x: number, y: number, radius: number): void {
    if (!this.mapData) return;

    const visibleTiles = this.getVisibleTiles(x, y, radius);
    for (const tile of visibleTiles) {
      tile.isVisible = true;
      tile.isExplored = true;
    }
  }
}
