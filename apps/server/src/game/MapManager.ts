import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';
import { MapData, MapTile, MapStartpos } from './map/MapTypes';
import { FractalHeightGenerator } from './map/FractalHeightGenerator';
import { TemperatureMap } from './map/TemperatureMap';
import { IslandGenerator, IslandGeneratorState, TerrainPercentages } from './map/IslandGenerator';
import { RiverGenerator } from './map/RiverGenerator';
import { ResourceGenerator } from './map/ResourceGenerator';
import { StartingPositionGenerator } from './map/StartingPositionGenerator';
import { TerrainGenerator } from './map/TerrainGenerator';
import { MapValidator, ValidationResult, Position } from './map/MapValidator';
import {
  assignFractureCircle,
  adjustHeightMap,
  createBaseTile,
  islandTerrainInit,
  fillIslandTerrain,
} from './map/TerrainUtils';

// Generator types based on freeciv map_generator enum
export type MapGeneratorType = 'FRACTAL' | 'ISLAND' | 'RANDOM' | 'FAIR' | 'FRACTURE' | 'SCENARIO';

// Re-export MapStartpos from MapTypes for backward compatibility
export { MapStartpos } from './map/MapTypes';

// Legacy type alias - prefer MapStartpos
export type StartPosMode = MapStartpos;

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
  private defaultStartPosMode: MapStartpos;
  private random: () => number;

  // Sub-generators
  private heightGenerator: FractalHeightGenerator;
  private temperatureMap: TemperatureMap;
  private islandGenerator: IslandGenerator;
  private riverGenerator: RiverGenerator;
  private resourceGenerator: ResourceGenerator;
  private startingPositionGenerator: StartingPositionGenerator;
  private terrainGenerator: TerrainGenerator;

  // Validation system
  private mapValidator: MapValidator;

  // Temperature map generation tracking
  private temperatureMapGenerated: boolean = false;

  // Optional memory optimization - cleanup temperature map after use
  private cleanupTemperatureMapAfterUse: boolean = false;

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
    defaultGeneratorType?: MapGeneratorType,
    defaultStartPosMode?: MapStartpos,
    cleanupTemperatureMapAfterUse: boolean = false,
    temperatureParam: number = 50
  ) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.generator = generator;
    this.defaultGeneratorType = defaultGeneratorType || 'FRACTAL';
    this.defaultStartPosMode = defaultStartPosMode || MapStartpos.ALL;
    this.cleanupTemperatureMapAfterUse = cleanupTemperatureMapAfterUse;
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
    this.temperatureMap = new TemperatureMap(width, height, temperatureParam);
    this.islandGenerator = new IslandGenerator(width, height, this.random);
    this.riverGenerator = new RiverGenerator(width, height, this.random);
    this.resourceGenerator = new ResourceGenerator(width, height, this.random);
    this.startingPositionGenerator = new StartingPositionGenerator(width, height);
    this.terrainGenerator = new TerrainGenerator(width, height, this.random, this.generator);

    // Initialize validation system
    this.mapValidator = new MapValidator(width, height);
  }

  // Phase 2: createTemperatureMap removed - temperature map creation now handled inside makeLand()

  /**
   * Optional cleanup of temperature map to optimize memory usage
   * @reference freeciv/server/generator/mapgen.c:1480 destroy_tmap()
   * Can be called after terrain generation is complete to free memory
   */
  private cleanupTemperatureMap(): void {
    if (this.cleanupTemperatureMapAfterUse && this.temperatureMapGenerated) {
      logger.debug('Cleaning up temperature map to optimize memory usage', {
        reference: 'freeciv/server/generator/mapgen.c:1480',
      });
      // Temperature map data is already applied to tiles, so we can reset the generator
      this.temperatureMapGenerated = false;
      // Note: The actual TemperatureMap cleanup would need to be implemented in the TemperatureMap class
    }
  }

  // Phase 2: ensureTemperatureMap removed - temperature map creation now handled inside makeLand()

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
      // Use 'ALL' startpos mode for fair island fallback (maps to mapGenerator4)
      return this.generateMapWithIslands(players, MapStartpos.ALL);
    }

    // Handle other generators with standard routing
    switch (generator) {
      case 'ISLAND':
        // Use instance default startpos mode for island generation
        return this.generateMapWithIslands(players, this.defaultStartPosMode);

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

    // Use exact freeciv terrain generation with Phase 1 integration
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    await this.terrainGenerator.makeLand(
      tiles,
      heightMap,
      {
        landpercent: 30,
        steepness: 50,
        wetness: 50,
        temperature: 50,
      },
      this.heightGenerator,
      this.temperatureMap,
      this.riverGenerator
    );

    // Final elevation normalization to 0-255 range after makeLand() processing
    this.normalizeElevationsToDisplayRange(tiles);

    // Phase 1 & 2 fix: All terrain generation steps now handled inside makeLand()
    // - Pole renormalization (Phase 1)
    // - Temperature map creation (Phase 1)
    // - River generation (Phase 1)
    // - Height assignment and continent assignment (Phase 2 order fix)

    // Post-makeLand() processing - only operations that must happen after full terrain is assigned
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Phase 2 fix: Temperature map and rivers already handled inside makeLand()
    // Only convert to enum format for compatibility
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Optional cleanup of temperature map to optimize memory usage
    this.cleanupTemperatureMap();

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players,
      this.defaultStartPosMode
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

    // Validate generated map for quality assurance
    const validationResult = this.mapValidator.validateMap(tiles, startingPositions, players, {
      generationTimeMs: generationTime,
    });

    logger.info('Fractal map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
      reference: 'freeciv/server/generator/mapgen.c:1343-1348',
    });
  }

  /**
   * Island-based map generation orchestration using freeciv generators 2/3/4
   * @reference freeciv/server/generator/mapgen.c mapGenerator2/3/4()
   * @reference freeciv/server/generator/mapgen.c:1320-1341 MAPSTARTPOS routing
   * Coordinates freeciv island generation algorithms with startpos-based routing
   */
  public async generateMapWithIslands(
    players: Map<string, PlayerState>,
    startPosMode: StartPosMode = MapStartpos.ALL
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

    // Generate elevation for height-based terrain selection
    this.heightGenerator.generateHeightMap();
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Initialize island terrain selection system (like freeciv island_terrain_init())
    islandTerrainInit();

    // Initialize world for island generation
    const state = this.islandGenerator.initializeWorldForIslands(tiles);

    // Initialize bucket system (call with islandMass=0 for initialization)
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);

    logger.info(`Using startpos mode '${startPosMode}' for ${players.size} players`, {
      reference: 'freeciv/server/generator/mapgen.c:1320-1341',
    });

    // Generate islands using startpos-based routing (freeciv MAPSTARTPOS logic)
    // @reference freeciv/server/generator/mapgen.c:1320-1341
    switch (startPosMode) {
      case MapStartpos.VARIABLE:
        // MAPSTARTPOS_VARIABLE uses mapgenerator2 (70% big / 20% medium / 10% small)
        await this.mapGenerator2(state, tiles, players.size);
        break;
      case MapStartpos.DEFAULT:
      case MapStartpos.SINGLE:
        // MAPSTARTPOS_DEFAULT || MAPSTARTPOS_SINGLE uses mapgenerator3 (several large islands)
        await this.mapGenerator3(state, tiles, players.size);
        break;
      case MapStartpos.TWO_ON_THREE:
      case MapStartpos.ALL:
      default:
        // MAPSTARTPOS_2or3 || MAPSTARTPOS_ALL uses mapgenerator4 (many fair islands)
        await this.mapGenerator4(state, tiles, players.size);
        break;
    }

    // Cleanup
    this.islandGenerator.cleanup();

    // NOTE: Don't call islandTerrainFree() here as it breaks subsequent map generations
    // Island terrain state should persist across multiple generations in the same session
    // Original freeciv calls this only on server shutdown, not after each map generation

    // Phase 1 & 2 fix: Island generation handles its own temperature map creation during island generation
    // No external temperature map creation needed - islands use different flow than height-based generators

    // Post-island-generation processing - only operations that must happen after islands are placed
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Phase 2 fix: Temperature map already handled during island generation
    // Only convert to enum format for compatibility
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

    // Optional cleanup of temperature map to optimize memory usage
    this.cleanupTemperatureMap();

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players,
      this.defaultStartPosMode
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
    const generationTime = endTime - startTime;

    // Validate generated map for quality assurance
    const validationResult = this.mapValidator.validateMap(tiles, startingPositions, players, {
      generationTimeMs: generationTime,
    });

    logger.info('Island-based map generation completed', {
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
    });
  }

  /**
   * Normalize all tile elevations to the 0-255 display range after terrain generation
   * This ensures proper elevation display and prevents issues with UI rendering
   * Called after makeLand() which may modify elevations through pole renormalization
   */
  private normalizeElevationsToDisplayRange(tiles: MapTile[][]): void {
    // Find current min/max elevations
    let minElevation = Infinity;
    let maxElevation = -Infinity;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const elevation = tiles[x][y].elevation;
        minElevation = Math.min(minElevation, elevation);
        maxElevation = Math.max(maxElevation, elevation);
      }
    }

    // Avoid division by zero
    if (minElevation === maxElevation) {
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          tiles[x][y].elevation = 127; // Mid-range value
        }
      }
      return;
    }

    // Normalize to 0-255 range
    const scale = 255 / (maxElevation - minElevation);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const normalizedElevation = Math.floor((tiles[x][y].elevation - minElevation) * scale);
        tiles[x][y].elevation = Math.max(0, Math.min(255, normalizedElevation));
      }
    }
  }

  /**
   * Enhanced fair islands pre-validation with comprehensive feasibility checks
   * @reference freeciv/server/generator/mapgen.c:3389-3520 map_generate_fair_islands()
   * Implements exact freeciv landmass calculation and validation logic with enhancements
   * @param players Map of player states to validate
   * @param startPosMode Startpos mode to influence island distribution logic
   * @returns true if fair islands can be generated, false if fallback needed
   */
  private validateFairIslands(
    players: Map<string, PlayerState>,
    startPosMode: StartPosMode = MapStartpos.ALL
  ): boolean {
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

    // @reference freeciv/server/generator/mapgen.c:3419-3444
    // Calculate players_per_island based on startpos mode (freeciv MAPSTARTPOS logic)
    switch (startPosMode) {
      case MapStartpos.TWO_ON_THREE: {
        // MAPSTARTPOS_2or3: Prefer 2-3 players per island
        const maybe2 = playerCount % 2 === 0;
        const maybe3 = playerCount % 3 === 0;
        if (maybe3) {
          playersPerIsland = 3;
        } else if (maybe2) {
          playersPerIsland = 2;
        }
        // else playersPerIsland remains 1
        break;
      }
      case MapStartpos.ALL:
        // MAPSTARTPOS_ALL: Flexible island distribution, prefer larger groups
        if (playerCount >= 6 && playerCount % 3 === 0) {
          playersPerIsland = 3;
        } else if (playerCount >= 4 && playerCount % 2 === 0) {
          playersPerIsland = 2;
        }
        // else playersPerIsland remains 1
        break;
      case MapStartpos.VARIABLE:
        // MAPSTARTPOS_VARIABLE: Variable island sizes, prefer single players with some larger islands
        playersPerIsland = 1; // Primarily single-player islands
        break;
      case MapStartpos.DEFAULT:
      case MapStartpos.SINGLE:
        // MAPSTARTPOS_DEFAULT/SINGLE: One player per island
        playersPerIsland = 1;
        break;
      default:
        playersPerIsland = 1;
    }

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

    // Enhanced feasibility checks with freeciv-compliant logic
    // @reference freeciv/server/generator/mapgen.c:3492-3509
    const islandmass2 = Math.floor((playermass * 2) / 10);
    const islandmass3 = Math.floor(playermass / 10);
    const finalIslandmass2 = islandmass2 < minIslandSize ? minIslandSize : islandmass2;
    const finalIslandmass3 = islandmass3 < minIslandSize ? minIslandSize : islandmass3;

    // Basic feasibility check - if we can't create minimum viable islands, fail
    if (playermass <= 0 || islandmass1 <= minIslandSize) {
      logger.warn('Fair islands validation failed: insufficient landmass', {
        playerCount,
        playermass,
        islandmass1,
        islandmass2: finalIslandmass2,
        islandmass3: finalIslandmass3,
        minIslandSize,
        mapNumTiles,
        landPercent,
        reference: 'freeciv/server/generator/mapgen.c:3492-3501',
      });
      return false;
    }

    // Enhanced validation: check if total required land mass is feasible
    // Calculate total required land based on freeciv fair islands algorithm
    const totalRequiredLand =
      islandmass1 * Math.ceil(playerCount / playersPerIsland) + // Main islands
      finalIslandmass2 * playerCount + // Medium islands
      finalIslandmass3 * playerCount; // Small islands
    const availableLand = Math.floor((mapNumTiles * landPercent) / 100);

    if (totalRequiredLand > availableLand * 1.2) {
      // Allow 20% overage for placement flexibility
      logger.warn('Fair islands validation failed: total land requirement exceeds map capacity', {
        totalRequiredLand,
        availableLand,
        capacityRatio: totalRequiredLand / availableLand,
        playerCount,
        playersPerIsland,
        reference: 'Enhanced validation based on freeciv/server/generator/mapgen.c:3545-3680',
      });
      return false;
    }

    // Enhanced validation: check map size constraints for fair placement
    // Minimum map size should allow reasonable island spacing
    const minMapDimension = Math.min(this.width, this.height);
    const expectedIslandCount = Math.ceil(playerCount / playersPerIsland);
    const minSpacing = Math.floor(minMapDimension / Math.ceil(Math.sqrt(expectedIslandCount)));

    if (minSpacing < 8) {
      // Freeciv typically needs at least 8-10 tiles between major islands
      logger.warn('Fair islands validation failed: insufficient map size for island spacing', {
        minMapDimension,
        expectedIslandCount,
        minSpacing,
        recommendedSpacing: 8,
        reference: 'Enhanced validation for fair island placement spacing',
      });
      return false;
    }

    logger.debug('Enhanced fair islands validation passed (freeciv-compliant)', {
      playerCount,
      playersPerIsland,
      playermass,
      islandmass1,
      islandmass2: finalIslandmass2,
      islandmass3: finalIslandmass3,
      totalRequiredLand,
      availableLand,
      capacityRatio: totalRequiredLand / availableLand,
      minSpacing,
      maxIterations,
      startPosMode,
      reference: 'freeciv/server/generator/mapgen.c:3389-3520',
    });

    return true;
  }

  /**
   * Enhanced fair islands generation with retry logic and adaptive parameters
   * @reference freeciv/server/generator/mapgen.c:1315-1318 fallback logic
   * @reference freeciv/server/generator/mapgen.c:3689-3702 iteration and parameter adaptation
   * Implements freeciv pattern with enhanced retry mechanics and progressive parameter adjustment
   * @param players Map of player states
   * @returns true if fair islands generation succeeded, false if fallback needed (like freeciv)
   */
  public async attemptFairIslandsGeneration(players: Map<string, PlayerState>): Promise<boolean> {
    const maxAttempts = 3; // Allow multiple attempts with parameter adjustment
    const startTime = Date.now();
    let attempt = 0;

    // @reference freeciv/server/generator/mapgen.c:1316
    // !map_generate_fair_islands() - pre-validation equivalent
    // Use 'ALL' startpos mode for fair islands validation (maps to mapGenerator4)
    if (!this.validateFairIslands(players, MapStartpos.ALL)) {
      logger.info(
        'Enhanced fair islands pre-validation failed (equivalent to early return FALSE)',
        {
          reference: 'freeciv/server/generator/mapgen.c:1316',
        }
      );
      return false;
    }

    // Enhanced retry logic with adaptive parameters (inspired by freeciv iteration logic)
    while (attempt < maxAttempts) {
      attempt++;

      try {
        logger.info(`Fair islands generation attempt ${attempt}/${maxAttempts}`, {
          players: players.size,
          reference: 'Enhanced retry logic with adaptive parameters',
        });

        // Apply adaptive parameters based on attempt number
        // @reference freeciv/server/generator/mapgen.c:3689-3702 parameter reduction logic
        const parameterAdjustment = this.calculateParameterAdjustment(attempt, maxAttempts);
        const adjustedTerrainPercentages = this.adjustTerrainPercentages(parameterAdjustment);

        // Store original percentages for restoration
        const originalPercentages = { ...this.terrainPercentages };
        this.terrainPercentages = adjustedTerrainPercentages;

        // @reference freeciv/server/generator/mapgen.c:3523-3753
        // Fair islands algorithm attempts with iteration limits
        // Use 'ALL' startpos mode for fair islands (equivalent to mapgenerator4)
        const generationTimeout = 30000 + (attempt - 1) * 10000; // Increase timeout for later attempts
        const generationPromise = this.generateMapWithIslands(players, MapStartpos.ALL);
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('Fair islands generation timeout')), generationTimeout);
        });

        await Promise.race([generationPromise, timeoutPromise]);

        // Restore original percentages
        this.terrainPercentages = originalPercentages;

        // Enhanced post-generation validation equivalent to freeciv's done check
        if (!this.validateGeneratedFairMap(players)) {
          logger.warn(
            `Fair islands attempt ${attempt} failed post-validation (equivalent to !done)`,
            {
              attempt,
              maxAttempts,
              parameterAdjustment,
              reference: 'freeciv/server/generator/mapgen.c:3699-3703',
            }
          );

          if (attempt < maxAttempts) {
            logger.info('Retrying fair islands generation with adjusted parameters');
            continue; // Try again with different parameters
          }
          return false;
        }

        const generationTime = Date.now() - startTime;
        logger.info(
          `Enhanced fair islands generation succeeded on attempt ${attempt} (equivalent to return TRUE)`,
          {
            attempt,
            generationTime,
            parameterAdjustment,
            reference: 'freeciv/server/generator/mapgen.c:3754',
          }
        );
        return true;
      } catch (error) {
        // Restore original percentages on error
        const originalPercentages = { ...this.terrainPercentages };
        this.terrainPercentages = originalPercentages;

        logger.warn(`Fair islands attempt ${attempt} failed with error`, {
          attempt,
          maxAttempts,
          error: error instanceof Error ? error.message : error,
          reference: 'freeciv/server/generator/mapgen.c:3699-3703',
        });

        if (attempt < maxAttempts) {
          logger.info('Retrying fair islands generation after error');
          continue; // Try again
        }
      }
    }

    const totalTime = Date.now() - startTime;
    logger.warn(
      `Fair islands generation failed after ${maxAttempts} attempts (equivalent to return FALSE)`,
      {
        attempts: maxAttempts,
        totalTime,
        reference: 'Enhanced retry logic based on freeciv iteration pattern',
      }
    );
    return false;
  }

  /**
   * Enhanced post-generation quality validation for fair islands maps
   * @reference freeciv/server/generator/mapgen.c:3699-3703 fair islands validation
   * Implements comprehensive quality checks including island distribution and resource balance
   * @param players Map of player states
   * @returns true if the generated map meets fair distribution requirements, false otherwise
   */
  private validateGeneratedFairMap(players: Map<string, PlayerState>): boolean {
    if (!this.mapData) {
      logger.warn('No map data available for post-generation validation');
      return false;
    }

    const { tiles, startingPositions } = this.mapData;
    const playerCount = players.size;

    // Basic validation: ensure we have starting positions for all players
    if (!startingPositions || startingPositions.length < playerCount) {
      logger.warn('Insufficient starting positions for fair islands validation', {
        required: playerCount,
        generated: startingPositions?.length || 0,
        reference: 'Post-generation validation requirement',
      });
      return false;
    }

    // Enhanced validation: Island size distribution analysis
    // @reference freeciv/server/generator/mapgen.c fair island size requirements
    const islandSizes = this.analyzeIslandSizes(tiles);
    const sortedIslandSizes = islandSizes.sort((a, b) => b - a);

    if (sortedIslandSizes.length === 0) {
      logger.warn('No islands found in generated map', {
        reference: 'Post-generation island analysis',
      });
      return false;
    }

    // Validate that we have sufficient major islands for players
    // Major islands should accommodate the planned players per island distribution
    const majorIslands = sortedIslandSizes.filter(size => size >= 20); // Minimum viable island size
    const expectedMajorIslands = Math.ceil(playerCount / this.getPlayersPerIslandForValidation());

    if (majorIslands.length < expectedMajorIslands) {
      logger.warn('Insufficient major islands for fair distribution', {
        majorIslands: majorIslands.length,
        expectedMajorIslands,
        playerCount,
        reference: 'Post-generation major island count validation',
      });
      return false;
    }

    // Enhanced validation: Starting position distance validation
    const positionDistances = this.calculateStartingPositionDistances(startingPositions);
    if (positionDistances.length > 0) {
      const minDistance = Math.min(...positionDistances);
      const avgDistance = positionDistances.reduce((a, b) => a + b, 0) / positionDistances.length;

      // Minimum distance should be reasonable to prevent unfair clustering
      const minMapDimension = Math.min(this.width, this.height);
      const expectedMinDistance = minMapDimension / (playerCount * 0.8); // Allow some clustering

      if (minDistance < expectedMinDistance) {
        logger.warn('Starting positions too close together for fair play', {
          minDistance: Math.round(minDistance),
          expectedMinDistance: Math.round(expectedMinDistance),
          avgDistance: Math.round(avgDistance),
          reference: 'Post-generation starting position distance validation',
        });
        return false;
      }
    }

    // Enhanced validation: Resource balance verification
    // Ensure each major island has reasonable resource distribution
    const resourceBalance = this.validateResourceBalance(tiles, startingPositions);
    if (!resourceBalance.balanced) {
      logger.warn('Resource distribution imbalance detected', {
        issues: resourceBalance.issues,
        reference: 'Post-generation resource balance validation',
      });
      return false;
    }

    logger.debug('Enhanced fair islands post-generation validation passed', {
      playerCount,
      startingPositions: startingPositions.length,
      majorIslands: majorIslands.length,
      islandSizes: sortedIslandSizes.slice(0, 5), // Top 5 islands
      minDistance: positionDistances.length > 0 ? Math.round(Math.min(...positionDistances)) : 0,
      avgDistance:
        positionDistances.length > 0
          ? Math.round(positionDistances.reduce((a, b) => a + b, 0) / positionDistances.length)
          : 0,
      resourceBalance: resourceBalance.score,
      reference: 'Enhanced post-generation validation',
    });

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

    // CRITICAL DEBUGGING: Use FractalHeightGenerator's generateRandomHeightMap() instead of local generation
    logger.info(
      'DEBUG: Using FractalHeightGenerator.generateRandomHeightMap() for proper random mode',
      {
        reference: 'freeciv/server/generator/height_map.c:101-113',
      }
    );

    // Generate height map using the proper generator
    this.heightGenerator.generateRandomHeightMap(players.size);
    const heightMap = this.heightGenerator.getHeightMap();

    // Use exact freeciv terrain generation with Phase 1 integration
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    await this.terrainGenerator.makeLand(
      tiles,
      heightMap,
      {
        landpercent: 30,
        steepness: 50,
        wetness: 50,
        temperature: 50,
      },
      this.heightGenerator,
      this.temperatureMap,
      this.riverGenerator
    );

    // Final elevation normalization to 0-255 range after makeLand() processing
    this.normalizeElevationsToDisplayRange(tiles);

    // Phase 1 & 2 fix: All terrain generation steps now handled inside makeLand()
    // - Pole renormalization (Phase 1)
    // - Temperature map creation (Phase 1)
    // - River generation (Phase 1)
    // - Height assignment and continent assignment (Phase 2 order fix)

    // Post-makeLand() processing - only operations that must happen after full terrain is assigned
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Phase 2 fix: Temperature map and rivers already handled inside makeLand()
    // Only convert to enum format for compatibility
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Optional cleanup of temperature map to optimize memory usage
    this.cleanupTemperatureMap();

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players,
      this.defaultStartPosMode
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

    // Validate generated map for quality assurance
    const validationResult = this.mapValidator.validateMap(tiles, startingPositions, players, {
      generationTimeMs: generationTime,
    });

    logger.info('Pure random map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
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

    // Use exact freeciv terrain generation with Phase 1 integration
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    await this.terrainGenerator.makeLand(
      tiles,
      heightMap,
      {
        landpercent: 30,
        steepness: 50,
        wetness: 50,
        temperature: 50,
      },
      this.heightGenerator,
      this.temperatureMap,
      this.riverGenerator
    );

    // Final elevation normalization to 0-255 range after makeLand() processing
    this.normalizeElevationsToDisplayRange(tiles);

    // Phase 1 & 2 fix: All terrain generation steps now handled inside makeLand()
    // - Temperature map creation (Phase 1)
    // - River generation (Phase 1)
    // - Height assignment and continent assignment (Phase 2 order fix)

    // Apply fracture-specific continent data to tiles after makeLand() processing
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const continentId = continentMap[x][y];
        // If assigned to a landmass with elevation 0 (ocean), use continent ID 0
        // @reference freeciv/common/tile.c:371 ocean has negative continent ID, we use 0 for simplification
        if (continentId > 0 && landmasses[continentId - 1].elevation === 0) {
          tiles[x][y].continentId = 0;
        } else {
          tiles[x][y].continentId = continentId;
        }
      }
    }

    // Post-makeLand() processing - only operations that must happen after full terrain is assigned
    this.terrainGenerator.smoothWaterDepth(tiles);

    // Turn small oceans into lakes (like freeciv regenerate_lakes())
    // @reference freeciv/server/generator/mapgen.c:1381
    this.terrainGenerator.regenerateLakes(tiles);

    // Phase 2 fix: Temperature map and rivers already handled inside makeLand()
    // Only convert to enum format for compatibility
    this.terrainGenerator.convertTemperatureToEnum(tiles);
    this.terrainGenerator.generateWetnessMap(tiles);
    await this.resourceGenerator.generateResources(tiles);

    // Optional cleanup of temperature map to optimize memory usage
    this.cleanupTemperatureMap();

    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players,
      this.defaultStartPosMode
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

    // Validate generated map for quality assurance
    const validationResult = this.mapValidator.validateMap(tiles, startingPositions, players, {
      generationTimeMs: generationTime,
    });

    logger.info('Fracture map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
    });
  }

  /**
   * Calculate current land percentage of the map
   * @reference freeciv/server/generator/mapgen.c:2260-2265
   * Helper method for landpercent validation in island generators
   * @returns current land percentage (0-100)
   */
  private getLandPercent(): number {
    // Default land percentage setting (matches freeciv wld.map.server.landpercent)
    // In our implementation, we use 30% as the target, but this could be configurable
    return 30; // TODO: Make this configurable or calculate dynamically from actual terrain
  }

  /**
   * Large continent generation with 70% big / 20% medium / 10% small landmass
   * @reference freeciv/server/generator/mapgen.c mapgenerator2()
   * Exact copy of freeciv mapgenerator2 algorithm with validation fallbacks
   */
  private async mapGenerator2(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Landpercent validation fallback (freeciv mapgen.c:2260-2265)
    if (this.getLandPercent() > 85) {
      logger.warn('Landpercent too high for mapGenerator2, falling back to random generator', {
        landpercent: this.getLandPercent(),
        reference: 'freeciv/server/generator/mapgen.c:2260-2265',
      });
      // Convert tiles back to player map for fallback
      const playersMap = new Map<string, PlayerState>();
      for (let i = 0; i < playerCount; i++) {
        playersMap.set(`player_${i}`, { id: `player_${i}` } as PlayerState);
      }
      return this.generateMapRandom(playersMap);
    }

    // Size validation fallback - minimum 30x30 for mapGenerator2 (large continents)
    if (this.width < 30 || this.height < 30) {
      logger.warn('Map too small for mapGenerator2 large continents, using mapGenerator4', {
        width: this.width,
        height: this.height,
        minSize: 30,
        reference: 'freeciv/server/generator/mapgen.c size requirements for large continents',
      });
      return this.mapGenerator4(state, tiles, playerCount);
    }

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
    // Landpercent validation fallback (freeciv mapgen.c:2260-2265)
    if (this.getLandPercent() > 85) {
      logger.warn('Landpercent too high for mapGenerator3, falling back to random generator', {
        landpercent: this.getLandPercent(),
        reference: 'freeciv/server/generator/mapgen.c:2260-2265',
      });
      // Convert tiles back to player map for fallback
      const playersMap = new Map<string, PlayerState>();
      for (let i = 0; i < playerCount; i++) {
        playersMap.set(`player_${i}`, { id: `player_${i}` } as PlayerState);
      }
      return this.generateMapRandom(playersMap);
    }

    // Size validation fallback - minimum 40x40 for mapGenerator3
    if (this.width < 40 || this.height < 40) {
      logger.warn('Map too small for mapGenerator3, using mapGenerator4', {
        width: this.width,
        height: this.height,
        minSize: 40,
        reference: 'freeciv/server/generator/mapgen.c size requirements',
      });
      return this.mapGenerator4(state, tiles, playerCount);
    }
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
    // Landpercent validation fallback (freeciv mapgen.c:2260-2265)
    if (this.getLandPercent() > 85) {
      logger.warn('Landpercent too high for mapGenerator4, falling back to random generator', {
        landpercent: this.getLandPercent(),
        reference: 'freeciv/server/generator/mapgen.c:2260-2265',
      });
      // Convert tiles back to player map for fallback
      const playersMap = new Map<string, PlayerState>();
      for (let i = 0; i < playerCount; i++) {
        playersMap.set(`player_${i}`, { id: `player_${i}` } as PlayerState);
      }
      return this.generateMapRandom(playersMap);
    }

    // Size validation warning - minimum 20x20 recommended for mapGenerator4
    if (this.width < 20 || this.height < 20) {
      logger.warn('Map very small for mapGenerator4, island distribution may be limited', {
        width: this.width,
        height: this.height,
        recommendedMinSize: 20,
        reference: 'freeciv/server/generator/mapgen.c size recommendations',
      });
    }

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

  public getSeed(): string {
    return this.seed;
  }

  /**
   * Get a specific tile by coordinates
   * @param x X coordinate
   * @param y Y coordinate
   * @returns MapTile or null if coordinates are invalid or no map data
   */
  public getTile(x: number, y: number): MapTile | null {
    if (!this.mapData || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.mapData.tiles[x][y];
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
   * Get neighboring tiles for a given position
   * @param x X coordinate
   * @param y Y coordinate
   * @returns Array of neighboring MapTiles
   */
  public getNeighbors(x: number, y: number): MapTile[] {
    if (!this.mapData) return [];

    const neighbors: MapTile[] = [];
    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.isValidPosition(nx, ny)) {
        neighbors.push(this.mapData.tiles[nx][ny]);
      }
    }

    return neighbors;
  }

  /**
   * Check if a position is valid within map bounds
   * @param x X coordinate
   * @param y Y coordinate
   * @returns true if position is valid, false otherwise
   */
  public isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Update a specific property of a tile
   * @param x X coordinate
   * @param y Y coordinate
   * @param property Property name to update
   * @param value New value for the property
   */
  public updateTileProperty(x: number, y: number, property: string, value: any): void {
    if (!this.mapData || !this.isValidPosition(x, y)) return;

    const tile = this.mapData.tiles[x][y];
    (tile as any)[property] = value;
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

  /**
   * Validate the current map data using the comprehensive validation system
   * @param players Optional player states for enhanced validation context
   * @returns Comprehensive validation result with metrics and issues
   */
  public validateCurrentMap(players?: Map<string, PlayerState>): ValidationResult | null {
    if (!this.mapData) {
      logger.warn('Cannot validate map: no map data available');
      return null;
    }

    logger.debug('Validating current map data', {
      width: this.width,
      height: this.height,
      startingPositions: this.mapData.startingPositions.length,
      players: players?.size || 0,
    });

    return this.mapValidator.validateMap(
      this.mapData.tiles,
      this.mapData.startingPositions,
      players
    );
  }

  /**
   * Get the map validator instance for advanced validation operations
   * @returns MapValidator instance
   */
  public getMapValidator(): MapValidator {
    return this.mapValidator;
  }

  /**
   * Calculate parameter adjustment factor based on retry attempt
   * @reference freeciv/server/generator/mapgen.c:3689-3702 landmass reduction logic
   * Implements progressive parameter reduction similar to freeciv's retry mechanism
   * @param attempt Current attempt number (1-based)
   * @param maxAttempts Maximum number of attempts
   * @returns Parameter adjustment factor (0.0 to 1.0)
   */
  private calculateParameterAdjustment(attempt: number, _maxAttempts: number): number {
    // @reference freeciv/server/generator/mapgen.c:3690-3691
    // islandmass1 = (islandmass1 * 99) / 100;
    // Progressive reduction: 99% -> 98% -> 97% etc.
    const reductionPerAttempt = 0.01; // 1% reduction per attempt
    const baseReduction = 1.0 - (attempt - 1) * reductionPerAttempt;

    // Ensure we don't go below 90% of original parameters
    return Math.max(0.9, baseReduction);
  }

  /**
   * Adjust terrain percentages for retry attempts to improve success rate
   * @reference freeciv/server/generator/mapgen.c:3689-3702 parameter adaptation
   * @param adjustmentFactor Factor to adjust parameters (0.0 to 1.0)
   * @returns Adjusted terrain percentages
   */
  private adjustTerrainPercentages(adjustmentFactor: number): TerrainPercentages {
    return {
      river: Math.floor(this.terrainPercentages.river * adjustmentFactor),
      mountain: Math.floor(this.terrainPercentages.mountain * adjustmentFactor),
      desert: Math.floor(this.terrainPercentages.desert * adjustmentFactor),
      forest: Math.floor(this.terrainPercentages.forest * adjustmentFactor),
      swamp: Math.floor(this.terrainPercentages.swamp * adjustmentFactor),
    };
  }

  /**
   * Get players per island setting for validation purposes
   * @returns Expected players per island based on current configuration
   */
  private getPlayersPerIslandForValidation(): number {
    // Default to single player per island for validation
    // This matches the fair islands default behavior
    return 1;
  }

  /**
   * Analyze island sizes in the generated map
   * @param tiles Generated map tiles
   * @returns Array of island sizes (tile counts per continent)
   */
  private analyzeIslandSizes(tiles: MapTile[][]): number[] {
    const continentSizes: Record<number, number> = {};

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.continentId > 0) {
          // Land tiles have positive continent IDs
          continentSizes[tile.continentId] = (continentSizes[tile.continentId] || 0) + 1;
        }
      }
    }

    return Object.values(continentSizes);
  }

  /**
   * Calculate distances between all starting positions
   * @param positions Array of starting positions
   * @returns Array of distances between position pairs
   */
  private calculateStartingPositionDistances(positions: Position[]): number[] {
    const distances: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const pos1 = positions[i];
        const pos2 = positions[j];
        const distance = Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
        distances.push(distance);
      }
    }

    return distances;
  }

  // Phase 2: assignHeightToTiles removed - height assignment now handled inside makeLand()

  /**
   * Validate resource balance across major starting areas
   * @param tiles Generated map tiles
   * @param positions Starting positions to check
   * @returns Resource balance analysis result
   */
  private validateResourceBalance(
    tiles: MapTile[][],
    positions: Position[]
  ): { balanced: boolean; score: number; issues: string[] } {
    const issues: string[] = [];
    const resourceCounts: Record<string, number> = {};

    // Check resources within starting radius of each position
    const checkRadius = 3;
    let totalResourcesFound = 0;
    let positionsWithoutResources = 0;

    positions.forEach((pos, index) => {
      let positionResourceCount = 0;

      for (let dx = -checkRadius; dx <= checkRadius; dx++) {
        for (let dy = -checkRadius; dy <= checkRadius; dy++) {
          const x = pos.x + dx;
          const y = pos.y + dy;

          if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= checkRadius) {
              const tile = tiles[x][y];
              if (tile.resource) {
                resourceCounts[tile.resource] = (resourceCounts[tile.resource] || 0) + 1;
                positionResourceCount++;
                totalResourcesFound++;
              }
            }
          }
        }
      }

      if (positionResourceCount === 0) {
        positionsWithoutResources++;
        issues.push(`Starting position ${index + 1} has no nearby resources`);
      }
    });

    // Calculate balance score
    let score = 100;

    // Penalize positions without resources
    const resourcelessRatio = positionsWithoutResources / positions.length;
    if (resourcelessRatio > 0.3) {
      // More than 30% without resources is problematic
      score -= 40;
      issues.push(
        `Too many starting positions (${Math.round(
          resourcelessRatio * 100
        )}%) lack nearby resources`
      );
    }

    // Check overall resource availability
    const avgResourcesPerPosition = totalResourcesFound / positions.length;
    if (avgResourcesPerPosition < 1) {
      score -= 30;
      issues.push(
        `Low average resources per starting position: ${avgResourcesPerPosition.toFixed(1)}`
      );
    }

    const balanced = score >= 70;

    return {
      balanced,
      score,
      issues,
    };
  }

  /**
   * Get movement cost for a tile
   * @reference freeciv/common/movement.c map_move_cost_unit()
   * @param x tile x coordinate
   * @param y tile y coordinate
   * @param unitTypeId optional unit type for specific movement rules
   * @returns movement cost in fragments, or -1 if impassable
   */
  public getMovementCost(x: number, y: number, unitTypeId?: string): number {
    const tile = this.getTile(x, y);
    if (!tile) return -1;

    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const { getTerrainMovementCost } = require('./constants/MovementConstants');
    return getTerrainMovementCost(tile.terrain, unitTypeId);
  }

  /**
   * Calculate distance between two points using Manhattan distance
   * @reference freeciv/common/map.c map_distance()
   * @param x1 first point x coordinate
   * @param y1 first point y coordinate
   * @param x2 second point x coordinate
   * @param y2 second point y coordinate
   * @returns distance between the two points
   */
  public getDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);

    // Handle wrapping for world maps (simplified for now)
    const wrappedDx = Math.min(dx, this.width - dx);
    const wrappedDy = Math.min(dy, this.height - dy);

    return Math.max(wrappedDx, wrappedDy);
  }

  /**
   * Get tiles accessible within movement range
   * @reference freeciv/common/aicore/path_finding.c pf_create_map()
   * @param x starting x coordinate
   * @param y starting y coordinate
   * @param movementPoints available movement points
   * @param unitTypeId unit type for movement rules
   * @returns array of accessible tiles
   */
  public getAccessibleTiles(
    x: number,
    y: number,
    movementPoints: number,
    unitTypeId?: string
  ): MapTile[] {
    const accessibleTiles: MapTile[] = [];
    const visited = new Set<string>();
    const queue: Array<{ x: number; y: number; remainingMoves: number }> = [
      { x, y, remainingMoves: movementPoints * 3 },
    ]; // Convert to movement fragments

    visited.add(`${x},${y}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Add current tile to accessible tiles
      const tile = this.getTile(current.x, current.y);
      if (tile) {
        accessibleTiles.push(tile);
      }

      // Check all neighboring tiles
      const neighbors = this.getNeighbors(current.x, current.y);
      for (const neighbor of neighbors) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (visited.has(key)) continue;

        const moveCost = this.getMovementCost(neighbor.x, neighbor.y, unitTypeId);
        if (moveCost < 0) continue; // Impassable

        const remainingAfterMove = current.remainingMoves - moveCost;
        if (remainingAfterMove >= 0) {
          visited.add(key);
          queue.push({
            x: neighbor.x,
            y: neighbor.y,
            remainingMoves: remainingAfterMove,
          });
        }
      }
    }

    return accessibleTiles;
  }

  /**
   * Validate map structure and properties
   * @reference freeciv/server/maphand.c map_fractal_generate()
   * @returns validation result with issues found
   */
  public validateMap(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check map dimensions
    if (this.width < 1 || this.height < 1) {
      issues.push('Invalid map dimensions');
    }

    // Check if map is generated
    if (!this.mapData || this.mapData.tiles.length === 0) {
      issues.push('Map not generated');
      return { valid: false, issues };
    }

    // Check tile count matches dimensions
    const expectedTileCount = this.width * this.height;
    if (this.mapData.tiles.length !== expectedTileCount) {
      issues.push(
        `Tile count mismatch: expected ${expectedTileCount}, got ${this.mapData.tiles.length}`
      );
    }

    // Check for valid terrain types
    const validTerrains = [
      'ocean',
      'coast',
      'deep_ocean',
      'lake',
      'plains',
      'grassland',
      'desert',
      'tundra',
      'hills',
      'forest',
      'jungle',
      'swamp',
      'mountains',
    ];
    let invalidTerrainCount = 0;

    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        if (!validTerrains.includes(tile.terrain)) {
          invalidTerrainCount++;
        }
      }
    }

    if (invalidTerrainCount > 0) {
      issues.push(`${invalidTerrainCount} tiles have invalid terrain types`);
    }

    // Check for reasonable terrain distribution
    let oceanTiles = 0;
    let totalTiles = 0;

    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        totalTiles++;
        if (['ocean', 'deep_ocean'].includes(tile.terrain)) {
          oceanTiles++;
        }
      }
    }

    const oceanRatio = oceanTiles / totalTiles;

    if (oceanRatio > 0.8) {
      issues.push('Map is mostly ocean (>80%)');
    } else if (oceanRatio < 0.2) {
      issues.push('Map has very little water (<20%)');
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
