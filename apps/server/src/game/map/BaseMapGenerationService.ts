import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile, MapStartpos } from './MapTypes';
import { FractalHeightGenerator } from './FractalHeightGenerator';
import { TemperatureMap } from './TemperatureMap';
import { IslandGenerator, TerrainPercentages } from './IslandGenerator';
import { RiverGenerator } from './RiverGenerator';
import { ResourceGenerator } from './ResourceGenerator';
import { StartingPositionGenerator } from './StartingPositionGenerator';
import { TerrainGenerator } from './TerrainGenerator';
import { MapValidator, ValidationResult } from './MapValidator';
import { createBaseTile } from './TerrainUtils';

/**
 * Base abstract service class for map generation services
 * Provides shared functionality and patterns used across different map generation strategies
 * @reference freeciv/server/generator/mapgen.c - shared map generation utilities
 */
export abstract class BaseMapGenerationService {
  protected width: number;
  protected height: number;
  protected random: () => number;
  protected seed: string;
  protected generator: string;
  protected defaultStartPosMode: MapStartpos;

  // Sub-generators - shared across all map generation services
  protected heightGenerator: FractalHeightGenerator;
  protected temperatureMap: TemperatureMap;
  protected islandGenerator: IslandGenerator;
  protected riverGenerator: RiverGenerator;
  protected resourceGenerator: ResourceGenerator;
  protected startingPositionGenerator: StartingPositionGenerator;
  protected terrainGenerator: TerrainGenerator;
  protected mapValidator: MapValidator;

  // Temperature map generation tracking
  protected temperatureMapGenerated: boolean = false;
  protected cleanupTemperatureMapAfterUse: boolean = false;

  // Default terrain percentages (from freeciv mapgen.c:1498-1512)
  protected terrainPercentages: TerrainPercentages = {
    river: 15, // Base 15% river coverage
    mountain: 25, // 25% mountainous terrain
    desert: 20, // 20% arid terrain
    forest: 30, // 30% forested areas
    swamp: 10, // 10% wetlands
  };

  constructor(
    width: number,
    height: number,
    seed: string,
    generator: string,
    random: () => number,
    defaultStartPosMode: MapStartpos,
    cleanupTemperatureMapAfterUse: boolean = false,
    temperatureParam: number = 50
  ) {
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.generator = generator;
    this.random = random;
    this.defaultStartPosMode = defaultStartPosMode;
    this.cleanupTemperatureMapAfterUse = cleanupTemperatureMapAfterUse;

    // Initialize sub-generators with shared parameters
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
    this.mapValidator = new MapValidator(width, height);
  }

  /**
   * Abstract method to be implemented by specific map generation services
   */
  public abstract generateMap(players: Map<string, PlayerState>): Promise<MapData>;

  /**
   * Initialize base tile structure for the map
   * @reference freeciv/server/generator/mapgen.c:1269-1280 initialize map tiles
   */
  protected initializeTiles(): MapTile[][] {
    const tiles: MapTile[][] = [];

    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = createBaseTile(x, y);
      }
    }

    logger.debug('Initialized map tile grid', {
      width: this.width,
      height: this.height,
      totalTiles: this.width * this.height,
      reference: 'freeciv/server/generator/mapgen.c:1269-1280',
    });

    return tiles;
  }

  /**
   * Post-process the map with resources and starting positions
   * Common pattern across all map generation types
   * @reference freeciv/server/generator/mapgen.c:1380-1427 post-processing
   */
  protected async postProcessMap(
    tiles: MapTile[][],
    players: Map<string, PlayerState>
  ): Promise<MapData> {
    logger.info('Post-processing generated map', {
      reference: 'freeciv/server/generator/mapgen.c:1380-1427',
    });

    // Generate resources on the map
    await this.resourceGenerator.generateResources(tiles);
    logger.debug('Generated resources on map');

    // Generate starting positions for players
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players,
      this.defaultStartPosMode
    );
    logger.debug('Generated starting positions', { count: startingPositions.length });

    // Clean up temperature map if configured
    this.cleanupTemperatureMap();

    return {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };
  }

  /**
   * Optional cleanup of temperature map to optimize memory usage
   * @reference freeciv/server/generator/mapgen.c:1480 destroy_tmap()
   */
  protected cleanupTemperatureMap(): void {
    if (this.cleanupTemperatureMapAfterUse && this.temperatureMapGenerated) {
      logger.debug('Cleaning up temperature map to optimize memory usage', {
        reference: 'freeciv/server/generator/mapgen.c:1480',
      });
      this.temperatureMapGenerated = false;
    }
  }

  /**
   * Normalize elevations to display range for consistent rendering
   * @reference freeciv/server/generator/mapgen.c:1350-1360 normalize heights
   */
  protected normalizeElevationsToDisplayRange(tiles: MapTile[][]): void {
    let minElevation = Number.MAX_SAFE_INTEGER;
    let maxElevation = Number.MIN_SAFE_INTEGER;

    // Find min and max elevations
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const elevation = tiles[x][y].elevation;
        minElevation = Math.min(minElevation, elevation);
        maxElevation = Math.max(maxElevation, elevation);
      }
    }

    // Normalize to 0-255 range for consistent display
    const range = maxElevation - minElevation;
    if (range > 0) {
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          tiles[x][y].elevation = Math.floor(
            ((tiles[x][y].elevation - minElevation) / range) * 255
          );
        }
      }
    }

    logger.debug('Normalized elevations to display range', {
      originalRange: `${minElevation}-${maxElevation}`,
      normalizedRange: '0-255',
      reference: 'freeciv/server/generator/mapgen.c:1350-1360',
    });
  }

  /**
   * Calculate land percentage of the generated map
   * @reference freeciv/server/generator/mapgen.c:1450-1465 calculate land ratio
   */
  protected getLandPercent(tiles?: MapTile[][]): number {
    const mapTiles = tiles || this.getMapTiles();
    if (!mapTiles) return 0;

    let landTiles = 0;
    let totalTiles = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        totalTiles++;
        if (mapTiles[x][y].terrain !== 'ocean') {
          landTiles++;
        }
      }
    }

    const landPercent = totalTiles > 0 ? (landTiles / totalTiles) * 100 : 0;

    logger.debug('Calculated land percentage', {
      landTiles,
      totalTiles,
      landPercent: landPercent.toFixed(2) + '%',
      reference: 'freeciv/server/generator/mapgen.c:1450-1465',
    });

    return landPercent;
  }

  /**
   * Validate the generated map using the map validator
   * Common validation pattern across all generators
   */
  protected validateMap(tiles: MapTile[][], players: Map<string, PlayerState>): ValidationResult {
    const startingPositions = tiles.length > 0 ? [] : []; // Empty array for now
    return this.mapValidator.validateMap(tiles, startingPositions, players);
  }

  /**
   * Get the current map tiles - to be implemented by concrete classes if needed
   */
  protected getMapTiles(): MapTile[][] | null {
    // Default implementation returns null - concrete classes can override
    return null;
  }

  /**
   * Calculate parameter adjustment for generation attempts
   * Common pattern used in fair islands and other iterative generation
   * @reference freeciv/server/generator/mapgen.c:1200-1220 parameter adjustment
   */
  protected calculateParameterAdjustment(attempt: number, maxAttempts: number): number {
    // Progressive adjustment: start at 1.0, gradually increase to 1.5 by final attempt
    const baseAdjustment = 1.0;
    const maxAdjustment = 1.5;
    const progress = attempt / Math.max(1, maxAttempts - 1);

    return baseAdjustment + (maxAdjustment - baseAdjustment) * progress;
  }

  /**
   * Adjust terrain percentages based on generation parameters
   * @reference freeciv/server/generator/mapgen.c:1498-1512 terrain distribution
   */
  protected adjustTerrainPercentages(adjustmentFactor: number): TerrainPercentages {
    return {
      river: Math.max(5, Math.min(30, this.terrainPercentages.river * adjustmentFactor)),
      mountain: Math.max(10, Math.min(40, this.terrainPercentages.mountain * adjustmentFactor)),
      desert: Math.max(5, Math.min(35, this.terrainPercentages.desert * adjustmentFactor)),
      forest: Math.max(15, Math.min(50, this.terrainPercentages.forest * adjustmentFactor)),
      swamp: Math.max(2, Math.min(20, this.terrainPercentages.swamp * adjustmentFactor)),
    };
  }
}
