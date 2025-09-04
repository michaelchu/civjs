import { logger } from '../../utils/logger';
import { PlayerState } from '../GameManager';
import { MapData, MapTile } from './MapTypes';
import { BaseMapGenerationService } from './BaseMapGenerationService';
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
    this.heightGenerator.generateHeightMap();
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

    this.heightGenerator.generateRandomHeightMap(players.size);
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
      fracturePoints.push({ x, y: this.width - 3 });
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

    // Generate fracture-based height map
    await this.generateFractureHeightMap(tiles, fracturePoints, landmasses, borderPoints);

    // Apply height-based terrain generation
    const heightMap = this.extractHeightMapFromTiles(tiles);
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
    const validationResult = this.validateMap(tiles, players);

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
  private async generateFractureHeightMap(
    tiles: MapTile[][],
    fracturePoints: Array<{ x: number; y: number }>,
    landmasses: Array<{
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      elevation: number;
    }>,
    borderPoints: number
  ): Promise<void> {
    // Set all to land first
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].terrain = 'grassland';
        tiles[x][y].elevation = 100; // Default land elevation
      }
    }

    // Create landmasses based on fracture points
    for (let i = 0; i < fracturePoints.length; i++) {
      const point = fracturePoints[i];
      let size = 0;
      let isOcean = false;

      if (i < borderPoints) {
        // Border points become ocean (size = 0 elevation)
        size = 0;
        isOcean = true;
      } else {
        // Interior points become land of varying sizes
        size = Math.floor(this.random() * 30) + 10;
        isOcean = false;
      }

      // Calculate landmass bounds
      const landmass = {
        minX: Math.max(0, point.x - size),
        minY: Math.max(0, point.y - size),
        maxX: Math.min(this.width - 1, point.x + size),
        maxY: Math.min(this.height - 1, point.y + size),
        elevation: isOcean ? 0 : Math.floor(this.random() * 100) + 50,
      };

      landmasses.push(landmass);

      // Apply fracture circle around each point
      for (let dx = -size; dx <= size; dx++) {
        for (let dy = -size; dy <= size; dy++) {
          const x = point.x + dx;
          const y = point.y + dy;
          if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= size) {
              tiles[x][y].elevation = landmass.elevation;
              // Only set elevation - let makeLand() handle terrain and continent assignment
              // based on elevation values, just like FRACTAL and RANDOM generators
            }
          }
        }
      }
    }

    logger.debug('Generated fracture height map', {
      totalPoints: fracturePoints.length,
      borderPoints,
      interiorPoints: fracturePoints.length - borderPoints,
      landmasses: landmasses.length,
      reference: 'freeciv/server/generator/mapgen.c make_fracture_map()',
    });
  }

  /**
   * Extract height map array from tile elevations
   * Used for fracture generation where heights are set directly on tiles
   */
  private extractHeightMapFromTiles(tiles: MapTile[][]): number[] {
    const heightMap: number[] = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = y * this.width + x;
        heightMap[index] = tiles[x][y].elevation;
      }
    }

    return heightMap;
  }

  /**
   * Override to return current tiles for land percentage calculation
   */
  protected getMapTiles(): MapTile[][] | null {
    // This will be set by the concrete implementation
    // For now return null as base behavior
    return null;
  }
}
