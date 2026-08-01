import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile } from './MapTypes';
import { BaseMapGenerationService } from './BaseMapGenerationService';
import { getMapSqSize } from './MapGenerationUtils';
// import { assignFractureCircle } from './TerrainUtils'; // Not used in current implementation

/**
 * Height-based map generation service for FRACTAL, RANDOM, and FRACTURE generators
 * These generators use height maps as the primary terrain generation method
 * @reference freeciv/server/generator/mapgen.c:1343-1348 MAPGEN_FRACTAL
 * @reference freeciv/server/generator/height_map.c height-based generation
 */
export class HeightBasedMapService extends BaseMapGenerationService {
  /**
   * Generate map using height-based algorithms
   * Routes to specific height-based generation methods
   */
  public async generateMap(
    players: Map<string, PlayerState>,
    generatorType?: 'FRACTAL' | 'RANDOM' | 'FRACTURE'
  ): Promise<MapData> {
    const actualGeneratorType = generatorType || 'FRACTAL';
    this.heightGenerator.setGenerator(actualGeneratorType);
    this.terrainGenerator.setGenerator(actualGeneratorType);
    logger.info('Starting height-based map generation', {
      generator: generatorType,
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    switch (actualGeneratorType) {
      case 'FRACTAL':
        return this.generateFractalMap(players, startTime);
      case 'RANDOM':
        return this.generateRandomMap(players, startTime);
      case 'FRACTURE':
        return this.generateFractureMap(players, startTime);
      default:
        throw new Error(`Unsupported height-based generator: ${actualGeneratorType}`);
    }
  }

  /**
   * Fractal height-based map generation
   * @reference freeciv/server/generator/mapgen.c:1343-1348 MAPGEN_FRACTAL case
   * Uses pseudo-fractal height map generation with make_pseudofractal1_hmap equivalent
   */
  private async generateFractalMap(
    players: Map<string, PlayerState>,
    startTime: number
  ): Promise<MapData> {
    logger.info('Generating map with fractal algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      reference: 'freeciv/server/generator/mapgen.c:1343-1348',
    });

    // Initialize map structure
    const tiles = this.initializeTiles();

    // Generate height map
    this.heightGenerator.generateHeightMap(players.size, this.defaultStartPosMode);
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height-based terrain generation
    await this.applyHeightBasedTerrain(tiles, heightMap);

    // Complete map generation with post-processing
    return this.completeMapGeneration(tiles, players, startTime, 'fractal');
  }

  /**
   * Pure random map generation
   * @reference freeciv/server/generator/height_map.c:101-113 random height generation
   */
  private async generateRandomMap(
    players: Map<string, PlayerState>,
    startTime: number
  ): Promise<MapData> {
    logger.info('Generating map with pure random algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    // Initialize map structure
    const tiles = this.initializeTiles();

    // Generate random height map using proper generator
    logger.info(
      'DEBUG: Using FractalHeightGenerator.generateRandomHeightMap() for proper random mode',
      {
        reference: 'freeciv/server/generator/height_map.c:101-113',
      }
    );

    this.heightGenerator.generateRandomHeightMap(players.size, this.defaultStartPosMode);
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height-based terrain generation
    await this.applyHeightBasedTerrain(tiles, heightMap);

    // Complete map generation with post-processing
    return this.completeMapGeneration(tiles, players, startTime, 'random');
  }

  /**
   * Fracture map generation with landmass points
   * @reference freeciv/server/generator/mapgen.c make_fracture_map()
   */
  private async generateFractureMap(
    players: Map<string, PlayerState>,
    startTime: number
  ): Promise<MapData> {
    logger.info('Generating map with fracture algorithm', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    // Initialize map structure
    const tiles = this.initializeTiles();

    // Implement fracture map algorithm based on freeciv make_fracture_map()
    const numLandmass = 20 + 15 * getMapSqSize(this.width, this.height);
    const fracturePoints: Array<{ x: number; y: number }> = [];
    const insetX = Math.min(3, Math.floor((this.width - 1) / 2));
    const insetY = Math.min(3, Math.floor((this.height - 1) / 2));

    // Setup landmasses along the borders (these will be sunken to create ocean).
    for (let x = insetX; x < this.width; x += 5) {
      fracturePoints.push({ x, y: insetY });
    }
    for (let x = insetX; x < this.width; x += 5) {
      fracturePoints.push({ x, y: this.height - insetY });
    }
    for (let y = insetY; y < this.height; y += 5) {
      fracturePoints.push({ x: insetX, y });
    }
    for (let y = insetY; y < this.height; y += 5) {
      fracturePoints.push({ x: this.width - insetX, y });
    }

    const borderPoints = fracturePoints.length;

    // Add random interior fracture points
    for (let i = 0; i < numLandmass; i++) {
      fracturePoints.push({
        x:
          this.width > 6
            ? Math.floor(this.random() * (this.width - 6)) + 3
            : Math.floor(this.random() * this.width),
        y:
          this.height > 6
            ? Math.floor(this.random() * (this.height - 6)) + 3
            : Math.floor(this.random() * this.height),
      });
    }

    // Generate fracture-based height map
    const heightMap = this.generateFractureHeightMap(fracturePoints, borderPoints);

    // Apply height-based terrain generation
    await this.applyHeightBasedTerrain(tiles, heightMap);

    // Complete map generation with post-processing
    return this.completeMapGeneration(tiles, players, startTime, 'fracture');
  }

  /**
   * Apply height-based terrain generation common to all height-based generators
   * @reference freeciv/server/generator/mapgen.c makeLand() integration
   */
  private async applyHeightBasedTerrain(tiles: MapTile[][], heightMap: number[]): Promise<void> {
    // Use exact freeciv terrain generation with Phase 1 integration
    this.terrainGenerator.heightMapToMap(tiles, heightMap);
    await this.terrainGenerator.makeLand(
      tiles,
      heightMap,
      {
        landpercent: this.generationOptions.landPercent,
        steepness: this.generationOptions.steepness,
        wetness: this.generationOptions.wetness,
        temperature: this.generationOptions.temperature,
        riverDensity: this.generationOptions.riverDensity,
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
    this.terrainGenerator.generateWetnessMap(tiles, this.generationOptions.wetness);
  }

  /**
   * Complete map generation with post-processing and validation
   * Common completion pattern for all height-based generators
   */
  private async completeMapGeneration(
    tiles: MapTile[][],
    players: Map<string, PlayerState>,
    startTime: number,
    generatorType: string
  ): Promise<MapData> {
    // Post-process the map with resources and starting positions
    const mapData = await this.postProcessMap(tiles, players);

    // Generation time and type are already set in map data

    const generationTime = Date.now() - startTime;

    // Validate generated map for quality assurance
    const validationResult = this.validateMap(tiles, players, mapData.startingPositions);
    const dominantContinent = validationResult.issues.find(
      issue =>
        issue.category === 'continent' && issue.message === 'Single continent dominates the map'
    );
    // A dominant continent is expected at intentionally high land settings.
    // Reject it only for sparse/normal worlds, where it indicates the small-
    // and standard-map pangaea regression this guard is designed to catch.
    if (
      dominantContinent &&
      this.width * this.height >= 1000 &&
      this.generationOptions.landPercent <= 30
    ) {
      throw new Error(
        `Map quality rejected: dominant continent (${String(
          dominantContinent.details?.largestContinentRatio ?? 'unknown'
        )}%)`
      );
    }

    logger.info(`${generatorType} map generation completed`, {
      width: this.width,
      height: this.height,
      generationTime,
      validation: {
        passed: validationResult.passed,
        score: validationResult.score,
        issues: validationResult.issues.length,
      },
      reference: 'freeciv/server/generator/mapgen.c height-based generation',
    });

    return mapData;
  }

  /**
   * Generate fracture-based height map using fracture points
   * @reference freeciv/server/generator/mapgen.c make_fracture_map()
   */
  private generateFractureHeightMap(
    fracturePoints: Array<{ x: number; y: number }>,
    borderPoints: number
  ): number[] {
    const shoreLevel = 700;
    const elevations = fracturePoints.map((_, index) =>
      index < borderPoints ? 0 : Math.floor(this.random() * 1000)
    );
    const rawHeightMap = new Array(this.width * this.height).fill(0);

    // Freeciv expands circles from every fracture point until every cell is
    // claimed. Assigning each cell to its nearest point is the equivalent
    // Voronoi result; array order provides the same deterministic tie-break.
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let owner = 0;
        let ownerDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < fracturePoints.length; index++) {
          const point = fracturePoints[index];
          const distance = this.topology.squaredDistance(x, y, point.x, point.y);
          if (distance < ownerDistance) {
            owner = index;
            ownerDistance = distance;
          }
        }
        rawHeightMap[y * this.width + x] = elevations[owner];
      }
    }

    // Match make_fracture_map(): retain high-mass variation, collapse all
    // lower masses to one ocean shelf, and adjust back to the hmap range.
    for (let index = 0; index < rawHeightMap.length; index++) {
      if (rawHeightMap[index] > shoreLevel) {
        rawHeightMap[index] += Math.floor(this.random() * 4) - 2;
      }
      if (rawHeightMap[index] <= shoreLevel) {
        rawHeightMap[index] = shoreLevel + 1;
      }
    }

    this.heightGenerator.adjustIntMapFiltered(rawHeightMap, 0, 255);
    const heightMap = rawHeightMap;

    logger.debug('Generated fracture height map', {
      totalPoints: fracturePoints.length,
      borderPoints,
      interiorPoints: fracturePoints.length - borderPoints,
      reference: 'freeciv/server/generator/mapgen.c make_fracture_map()',
    });
    return heightMap;
  }
}
