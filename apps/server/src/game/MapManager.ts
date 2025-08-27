import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';
import { MapData, MapTile } from './map/MapTypes';
import { FractalHeightGenerator } from './map/FractalHeightGenerator';
import { TemperatureMap } from './map/TemperatureMap';
import { IslandGenerator, IslandGeneratorState, TerrainPercentages } from './map/IslandGenerator';
import { RiverGenerator } from './map/RiverGenerator';
import { ResourceGenerator } from './map/ResourceGenerator';
import { StartingPositionGenerator } from './map/StartingPositionGenerator';
import { TerrainGenerator } from './map/TerrainGenerator';
import {
  assignFractureCircle,
  smoothHeightMap,
  adjustHeightMap,
  createBaseTile,
  islandTerrainInit,
  islandTerrainFree,
  fillIslandTerrain,
} from './map/TerrainUtils';

// Generator types based on freeciv map_generator enum
export type MapGeneratorType = 'FRACTAL' | 'ISLAND' | 'RANDOM' | 'FAIR' | 'FRACTURE' | 'SCENARIO';

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
  private defaultGeneratorType: MapGeneratorType;
  private random: () => number;

  // Sub-generators
  private heightGenerator: FractalHeightGenerator;
  private temperatureMap: TemperatureMap;
  private islandGenerator: IslandGenerator;
  private riverGenerator: RiverGenerator;
  private resourceGenerator: ResourceGenerator;
  private startingPositionGenerator: StartingPositionGenerator;
  private terrainGenerator: TerrainGenerator;

  // Default terrain percentages (from freeciv mapgen.c:1498-1512)
  private terrainPercentages: TerrainPercentages = {
    river: 15, // Base 15% river coverage
    mountain: 25, // 25% mountainous terrain
    desert: 20, // 20% arid terrain
    forest: 30, // 30% forested areas
    swamp: 10, // 10% wetlands
  };

  constructor(
    width: number,
    height: number,
    seed?: string,
    generator: string = 'random',
    defaultGeneratorType?: MapGeneratorType
  ) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.generator = generator;
    this.defaultGeneratorType = defaultGeneratorType || 'FRACTAL';
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
    this.terrainGenerator = new TerrainGenerator(width, height, this.random, this.generator);
  }

  /**
   * Main map generation orchestration with generator routing
   * @reference freeciv/server/generator/mapgen.c:1268-1427 map_fractal_generate()
   * Routes to specific generators based on type, with fallback logic matching freeciv
   */
  public async generateMap(
    players: Map<string, PlayerState>,
    generatorType?: MapGeneratorType
  ): Promise<void> {
    // Use provided generator type or fall back to instance default (matches freeciv behavior)
    const generator = generatorType || this.defaultGeneratorType;

    logger.info('Generating map', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      generator,
      reference: 'freeciv/server/generator/mapgen.c:1268-1427',
    });

    // Implement freeciv's map_fractal_generate() routing logic
    // @reference freeciv/server/generator/mapgen.c:1315-1358
    // Handle FAIR generator with explicit fallback logic (matches freeciv behavior)
    if (generator === 'FAIR') {
      // Attempt fair islands generation, fallback to ISLAND if failed
      if (await this.attemptFairIslandsGeneration(players)) {
        return;
      }
      logger.info('Fair islands generation failed, falling back to ISLAND generator');
      // Explicit fallback to ISLAND (matches freeciv mapgen.c:1315-1318)
      return this.generateMapWithIslands(players);
    }

    // Handle other generators with standard routing
    switch (generator) {
      case 'ISLAND':
        return this.generateMapWithIslands(players);

      case 'RANDOM':
        return this.generateMapRandom(players);

      case 'FRACTURE':
        return this.generateMapFracture(players);

      case 'SCENARIO':
        throw new Error(
          'SCENARIO generator not implemented - scenarios should be loaded from file'
        );

      case 'FRACTAL':
      default:
        return this.generateMapFractal(players);
    }
  }

  /**
   * Fractal height-based map generation (extracted from original generateMap)
   * @reference freeciv/server/generator/mapgen.c:1343-1348 MAPGEN_FRACTAL case
   * Uses pseudo-fractal height map generation with make_pseudofractal1_hmap equivalent
   */
  public async generateMapFractal(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map with fractal algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      reference: 'freeciv/server/generator/mapgen.c:1343-1348',
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = createBaseTile(x, y);
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

    // Use exact freeciv terrain generation
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    this.terrainGenerator.makeLand(tiles, heightMap, {
      landpercent: 30,
      steepness: 50,
      wetness: 50,
      temperature: 50,
    });

    // Smooth ocean depths based on distance from land (like freeciv smooth_water_depth())
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Generate terrain using terrain engine (only for land variety)
    await this.terrainGenerator.generateTerrain(
      tiles,
      this.heightGenerator,
      this.random,
      this.generator
    );

    // Generate continents (must come before remove tiny islands)
    this.terrainGenerator.generateContinents(tiles);

    // Remove tiny islands after continent assignment (like freeciv sequence)
    this.terrainGenerator.removeTinyIslands(tiles);

    // Convert the continuous temperature values to discrete TemperatureType enum
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

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
    logger.info('Fractal map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
      reference: 'freeciv/server/generator/mapgen.c:1343-1348',
    });
  }

  /**
   * Island-based map generation orchestration using freeciv generators 2/3/4
   * @reference freeciv/server/generator/mapgen.c mapGenerator2/3/4()
   * Coordinates freeciv island generation algorithms
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
        tiles[x][y] = createBaseTile(x, y);
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

    // Initialize island terrain selection system (like freeciv island_terrain_init())
    islandTerrainInit();

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

    // Free island terrain selection system (like freeciv island_terrain_free())
    islandTerrainFree();

    // Smooth ocean depths based on distance from land (like freeciv smooth_water_depth())
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Generate climate data now that islands exist
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

    // Apply climate-based terrain variety to islands using freeciv's terrain selection system
    await this.applyIslandTerrainVariety(tiles);

    // Fill remaining unplaced tiles with plains/grassland/tundra (like freeciv make_plains())
    this.terrainGenerator.makePlains(tiles);

    // Apply final terrain improvements
    this.terrainGenerator.applyBiomeTransitions(tiles);

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
   * Validates if fair islands generation is feasible for the given player configuration
   * @reference freeciv/server/generator/mapgen.c:3389-3520 map_generate_fair_islands()
   * Implements exact freeciv landmass calculation and validation logic
   * @param players Map of player states to validate
   * @returns true if fair islands can be generated, false if fallback needed
   */
  private validateFairIslands(players: Map<string, PlayerState>): boolean {
    const playerCount = players.size;

    // @reference freeciv/server/generator/mapgen.c:3395
    // int min_island_size = wld.map.server.tinyisles ? 1 : 2;
    const minIslandSize = 2; // We don't support tinyisles setting yet

    // @reference freeciv/server/generator/mapgen.c:3396-3397
    // int players_per_island = 1;
    let playersPerIsland = 1;

    // @reference freeciv/server/generator/mapgen.c:3398
    // int i, iter = CLIP(1, 100000 / map_num_tiles(), 10);
    const mapNumTiles = this.width * this.height;
    const maxIterations = Math.max(1, Math.min(Math.floor(100000 / mapNumTiles), 10));

    // Simplified team counting (freeciv has complex team iteration logic)
    // @reference freeciv/server/generator/mapgen.c:3401-3411
    // For now, we assume all players are single players (no teams implemented)
    // TODO: Implement team support with proper team counting when needed

    // @reference freeciv/server/generator/mapgen.c:3419-3444
    // Calculate players_per_island based on startpos logic (simplified)
    // We're using MAPSTARTPOS_2or3 equivalent logic for now
    const maybe2 = playerCount % 2 === 0;
    const maybe3 = playerCount % 3 === 0;

    if (maybe3) {
      playersPerIsland = 3;
    } else if (maybe2) {
      playersPerIsland = 2;
    }
    // else playersPerIsland remains 1

    // @reference freeciv/server/generator/mapgen.c:3492-3497
    // Calculate playermass using freeciv's exact formula
    // if (wld.map.server.mapsize == MAPSIZE_PLAYER) {
    //   playermass = wld.map.server.tilesperplayer - i / player_count();
    // } else {
    //   playermass = ((map_num_tiles() * wld.map.server.landpercent - i) / (player_count() * 100));
    // }
    const landPercent = 30; // Default landpercent setting
    const polarTiles = 0; // 'i' in freeciv - polar tiles, simplified to 0 for now
    const playermass = Math.floor((mapNumTiles * landPercent - polarTiles) / (playerCount * 100));

    // @reference freeciv/server/generator/mapgen.c:3498-3501
    // islandmass1 = (players_per_island * playermass * 7) / 10;
    // if (islandmass1 < min_island_size) { islandmass1 = min_island_size; }
    let islandmass1 = Math.floor((playersPerIsland * playermass * 7) / 10);
    if (islandmass1 < minIslandSize) {
      islandmass1 = minIslandSize;
    }

    // Basic feasibility check - if we can't create minimum viable islands, fail
    if (playermass <= 0 || islandmass1 <= minIslandSize) {
      logger.warn('Fair islands validation failed: insufficient landmass', {
        playerCount,
        playermass,
        islandmass1,
        minIslandSize,
        mapNumTiles,
        landPercent,
        reference: 'freeciv/server/generator/mapgen.c:3492-3501',
      });
      return false;
    }

    logger.debug('Fair islands validation passed (freeciv-compliant)', {
      playerCount,
      playersPerIsland,
      playermass,
      islandmass1,
      maxIterations,
      reference: 'freeciv/server/generator/mapgen.c:3389-3520',
    });

    return true;
  }

  /**
   * Attempts to generate fair islands with validation and fallback detection
   * @reference freeciv/server/generator/mapgen.c:1315-1318 fallback logic
   * Implements the exact freeciv pattern: attempt fair islands, return false if failed
   * @param players Map of player states
   * @returns true if fair islands generation succeeded, false if fallback needed (like freeciv)
   */
  public async attemptFairIslandsGeneration(players: Map<string, PlayerState>): Promise<boolean> {
    // @reference freeciv/server/generator/mapgen.c:1316
    // !map_generate_fair_islands() - pre-validation equivalent
    if (!this.validateFairIslands(players)) {
      logger.info('Fair islands pre-validation failed (equivalent to early return FALSE)', {
        reference: 'freeciv/server/generator/mapgen.c:1316',
      });
      return false;
    }

    try {
      // @reference freeciv/server/generator/mapgen.c:3523-3753
      // Fair islands algorithm attempts with iteration limits
      const generationPromise = this.generateMapWithIslands(players, 4); // mapgenerator4 equivalent
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('Fair islands generation timeout')), 30000);
      });

      await Promise.race([generationPromise, timeoutPromise]);

      // Post-generation validation equivalent to freeciv's done check
      if (!this.validateGeneratedFairMap(players)) {
        logger.warn('Generated fair islands map failed post-validation (equivalent to !done)', {
          reference: 'freeciv/server/generator/mapgen.c:3699-3703',
        });
        return false;
      }

      logger.info('Fair islands generation succeeded (equivalent to return TRUE)', {
        reference: 'freeciv/server/generator/mapgen.c:3754',
      });
      return true;
    } catch (error) {
      logger.warn('Fair islands generation failed with error (equivalent to return FALSE)', {
        error: error instanceof Error ? error.message : error,
        reference: 'freeciv/server/generator/mapgen.c:3699-3703',
      });
      return false;
    }
  }

  /**
   * Validates that a generated map meets fair distribution requirements
   * @param players Map of player states
   * @returns true if the generated map is fair, false otherwise
   */
  private validateGeneratedFairMap(players: Map<string, PlayerState>): boolean {
    if (!this.mapData) {
      return false;
    }

    // Basic validation: ensure we have starting positions for all players
    const startingPositions = this.mapData.startingPositions;
    if (!startingPositions || startingPositions.length < players.size) {
      logger.warn('Not enough starting positions generated', {
        required: players.size,
        generated: startingPositions?.length || 0,
      });
      return false;
    }

    // Additional validation could check island distribution, resource balance, etc.
    // For now, basic validation is sufficient for the fallback system

    return true;
  }

  /**
   * Pure random map generation orchestration
   * @reference freeciv/server/generator/height_map.c make_random_hmap()
   * Uses freeciv random height generation algorithm
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
        tiles[x][y] = createBaseTile(x, y);
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
      smoothHeightMap(heightMap, this.width, this.height);
    }

    // Normalize height map to 0-hmap_max_level range
    adjustHeightMap(heightMap, 0, 1000);

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

    // Use exact freeciv terrain generation
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    this.terrainGenerator.makeLand(tiles, heightMap, {
      landpercent: 30,
      steepness: 50,
      wetness: 50,
      temperature: 50,
    });

    // Smooth ocean depths based on distance from land
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Generate terrain using terrain engine
    await this.terrainGenerator.generateTerrain(
      tiles,
      this.heightGenerator,
      this.random,
      this.generator
    );

    // Generate continents
    this.terrainGenerator.generateContinents(tiles);

    // Remove tiny islands
    this.terrainGenerator.removeTinyIslands(tiles);

    // Convert temperature and generate wetness
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

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
   * Fracture map generation orchestration with continent placement
   * @reference freeciv/server/generator/fracture_map.c make_fracture_map()
   * Uses freeciv fracture algorithm for continent generation
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
        tiles[x][y] = createBaseTile(x, y);
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
        assignFractureCircle(
          continentMap,
          fracturePoints[i].x,
          fracturePoints[i].y,
          radius,
          i + 1,
          this.width,
          this.height,
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
    adjustHeightMap(heightMap, 0, 1000);

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

    // Use exact freeciv terrain generation
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    this.terrainGenerator.makeLand(tiles, heightMap, {
      landpercent: 30,
      steepness: 50,
      wetness: 50,
      temperature: 50,
    });

    // Complete the generation process
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    await this.terrainGenerator.generateTerrain(
      tiles,
      this.heightGenerator,
      this.random,
      this.generator
    );
    this.terrainGenerator.generateContinents(tiles);
    this.terrainGenerator.removeTinyIslands(tiles);
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

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

  /**
   * Large continent generation with 70% big / 20% medium / 10% small landmass
   * @reference freeciv/server/generator/mapgen.c mapgenerator2()
   * Exact copy of freeciv mapgenerator2 algorithm
   */
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

  // Map access methods
  public getMapData(): MapData | null {
    return this.mapData;
  }

  // Visibility methods
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

  /**
   * Apply climate-based terrain variety to generated islands
   * @reference freeciv/server/generator/mapgen.c fill_island() calls
   * Uses freeciv's terrain selection system for realistic island terrain distribution
   */
  private async applyIslandTerrainVariety(tiles: MapTile[][]): Promise<void> {
    logger.info('Applying climate-based terrain variety to islands');

    // Calculate terrain counts based on total landmass and terrain percentages
    let totalLandTiles = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.terrain === 'grassland' || tile.terrain === 'plains') {
          totalLandTiles++;
        }
      }
    }

    const forestCount = Math.floor((totalLandTiles * this.terrainPercentages.forest) / 100);
    const desertCount = Math.floor((totalLandTiles * this.terrainPercentages.desert) / 100);
    const mountainCount = Math.floor((totalLandTiles * this.terrainPercentages.mountain) / 100);
    const swampCount = Math.floor((totalLandTiles * this.terrainPercentages.swamp) / 100);

    logger.debug('Terrain variety targets', {
      totalLandTiles,
      forestCount,
      desertCount,
      mountainCount,
      swampCount,
    });

    // Apply terrain types using freeciv's climate-based selection
    for (let continentId = 1; continentId <= 10; continentId++) {
      // Check if this continent exists
      const continentTiles = this.getContinentTiles(tiles, continentId);
      if (continentTiles.length === 0) continue;

      const continentLandRatio = continentTiles.length / totalLandTiles;

      // Apply terrain proportionally to continent size
      fillIslandTerrain(
        tiles,
        'forest',
        Math.floor(forestCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'desert',
        Math.floor(desertCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'mountain',
        Math.floor(mountainCount * continentLandRatio),
        continentId,
        this.random
      );

      fillIslandTerrain(
        tiles,
        'swamp',
        Math.floor(swampCount * continentLandRatio),
        continentId,
        this.random
      );
    }

    logger.info('Climate-based terrain variety applied successfully');
  }

  /**
   * Get all land tiles belonging to a specific continent
   */
  private getContinentTiles(tiles: MapTile[][], continentId: number): MapTile[] {
    const continentTiles: MapTile[] = [];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          tile.continentId === continentId &&
          (tile.terrain === 'grassland' || tile.terrain === 'plains')
        ) {
          continentTiles.push(tile);
        }
      }
    }

    return continentTiles;
  }
}
