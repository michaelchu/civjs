import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';
import { MapData, MapTile, MapStartpos } from './map/MapTypes';
import { HeightBasedMapService } from './map/HeightBasedMapService';
import { IslandMapService } from './map/IslandMapService';
import { FairIslandsService } from './map/FairIslandsService';
import { MapAccessService } from './map/MapAccessService';
import { ValidationResult } from './map/MapValidator';

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

/**
 * Refactored MapManager that coordinates specialized map generation services
 * This is the main coordinator class that delegates to appropriate services
 * Maintains 100% API compatibility with the original MapManager
 * @reference freeciv/server/generator/mapgen.c:1268-1427 map_fractal_generate()
 */
export class MapManager {
  private width: number;
  private height: number;
  private seed: string;
  private generator: string;
  private defaultGeneratorType: MapGeneratorType;
  private defaultStartPosMode: MapStartpos;
  private random: () => number;

  // Specialized services
  private heightBasedMapService: HeightBasedMapService;
  private islandMapService: IslandMapService;
  private fairIslandsService: FairIslandsService;
  private mapAccessService: MapAccessService;

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
    this.random = this.createSeededRandom(this.seed);

    // Initialize specialized services
    this.heightBasedMapService = new HeightBasedMapService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam
    );

    this.islandMapService = new IslandMapService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam
    );

    this.fairIslandsService = new FairIslandsService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam
    );

    this.mapAccessService = new MapAccessService(width, height);
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

    let mapData: MapData;

    try {
      // Implement freeciv's map_fractal_generate() routing logic
      // @reference freeciv/server/generator/mapgen.c:1315-1358
      // Handle FAIR generator with explicit fallback logic (matches freeciv behavior)
      if (generator === 'FAIR') {
        try {
          // Attempt fair islands generation, fallback to ISLAND if failed
          mapData = await this.fairIslandsService.generateMap(players);
        } catch (error) {
          if (error instanceof Error && error.message === 'FALLBACK_TO_ISLAND') {
            logger.info('Fair islands generation failed, falling back to ISLAND generator');
            // Explicit fallback to ISLAND (matches freeciv mapgen.c:1315-1318)
            // Use 'ALL' startpos mode for fair island fallback (maps to mapGenerator4)
            mapData = await this.islandMapService.generateMap(players, MapStartpos.ALL);
          } else {
            throw error;
          }
        }
      } else {
        // Handle other generators with standard routing
        switch (generator) {
          case 'ISLAND':
            // Use instance default startpos mode for island generation
            mapData = await this.islandMapService.generateMap(players, this.defaultStartPosMode);
            break;

          case 'RANDOM':
            mapData = await this.heightBasedMapService.generateMap(players, 'RANDOM');
            break;

          case 'FRACTURE':
            mapData = await this.heightBasedMapService.generateMap(players, 'FRACTURE');
            break;

          case 'SCENARIO':
            throw new Error(
              'SCENARIO generator not implemented - scenarios should be loaded from file'
            );

          case 'FRACTAL':
          default:
            mapData = await this.heightBasedMapService.generateMap(players, 'FRACTAL');
            break;
        }
      }

      // Set the map data in the access service for API compatibility
      this.mapAccessService.setMapData(mapData);

      logger.info('Map generation completed successfully', {
        generator,
        width: this.width,
        height: this.height,
        startingPositions: mapData.startingPositions.length,
      });
    } catch (error) {
      logger.error('Map generation failed', {
        generator,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Fractal height-based map generation (backward compatibility method)
   * @deprecated Use generateMap() with 'FRACTAL' type instead
   */
  public async generateMapFractal(players: Map<string, PlayerState>): Promise<void> {
    logger.warn('generateMapFractal() is deprecated, use generateMap() with FRACTAL type');
    return this.generateMap(players, 'FRACTAL');
  }

  /**
   * Island-based map generation (backward compatibility method)
   * @deprecated Use generateMap() with 'ISLAND' type instead
   */
  public async generateMapWithIslands(
    players: Map<string, PlayerState>,
    startPosMode: StartPosMode = MapStartpos.ALL
  ): Promise<void> {
    logger.warn('generateMapWithIslands() is deprecated, use generateMap() with ISLAND type');

    // Temporarily update the default start pos mode for this generation
    const originalStartPosMode = this.defaultStartPosMode;
    this.defaultStartPosMode = startPosMode;

    try {
      await this.generateMap(players, 'ISLAND');
    } finally {
      // Restore original start pos mode
      this.defaultStartPosMode = originalStartPosMode;
    }
  }

  /**
   * Pure random map generation (backward compatibility method)
   * @deprecated Use generateMap() with 'RANDOM' type instead
   */
  public async generateMapRandom(players: Map<string, PlayerState>): Promise<void> {
    logger.warn('generateMapRandom() is deprecated, use generateMap() with RANDOM type');
    return this.generateMap(players, 'RANDOM');
  }

  /**
   * Fracture map generation (backward compatibility method)
   * @deprecated Use generateMap() with 'FRACTURE' type instead
   */
  public async generateMapFracture(players: Map<string, PlayerState>): Promise<void> {
    logger.warn('generateMapFracture() is deprecated, use generateMap() with FRACTURE type');
    return this.generateMap(players, 'FRACTURE');
  }

  /**
   * Attempt fair islands generation (backward compatibility method)
   * @deprecated Use generateMap() with 'FAIR' type instead
   */
  public async attemptFairIslandsGeneration(players: Map<string, PlayerState>): Promise<boolean> {
    logger.warn('attemptFairIslandsGeneration() is deprecated, use generateMap() with FAIR type');

    try {
      await this.generateMap(players, 'FAIR');
      return true;
    } catch (error) {
      logger.warn('Fair islands generation failed', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  // === PUBLIC API METHODS (delegated to services) ===

  /**
   * Get current map data
   */
  public getMapData(): MapData | null {
    return this.mapAccessService.getMapData();
  }

  /**
   * Get the seed used for map generation
   */
  public getSeed(): string {
    return this.seed;
  }

  /**
   * Get a specific tile by coordinates
   */
  public getTile(x: number, y: number): MapTile | null {
    return this.mapAccessService.getTile(x, y);
  }

  /**
   * Get tiles visible from a position within radius
   */
  public getVisibleTiles(x: number, y: number, radius: number): MapTile[] {
    return this.mapAccessService.getVisibleTiles(x, y, radius);
  }

  /**
   * Update tile visibility for a player
   */
  public updateTileVisibility(playerId: string, x: number, y: number, radius: number): void {
    this.mapAccessService.updateTileVisibility(playerId, x, y, radius);
  }

  /**
   * Get neighboring tiles for a given position
   */
  public getNeighbors(x: number, y: number): MapTile[] {
    return this.mapAccessService.getNeighbors(x, y);
  }

  /**
   * Check if a position is valid within map bounds
   */
  public isValidPosition(x: number, y: number): boolean {
    return this.mapAccessService.isValidPosition(x, y);
  }

  /**
   * Update a specific property of a tile
   */
  public updateTileProperty(x: number, y: number, property: string, value: any): void {
    this.mapAccessService.updateTileProperty(x, y, property, value);
  }

  /**
   * Validate the current map data using the comprehensive validation system
   */
  public validateCurrentMap(players?: Map<string, PlayerState>): ValidationResult | null {
    return this.mapAccessService.validateCurrentMap(players);
  }

  /**
   * Get the map validator instance for advanced validation operations
   */
  public getMapValidator() {
    return this.mapAccessService.getMapValidator();
  }

  /**
   * Get movement cost for a tile
   */
  public getMovementCost(x: number, y: number, unitTypeId?: string): number {
    return this.mapAccessService.getMovementCost(x, y, unitTypeId);
  }

  /**
   * Calculate distance between two points
   */
  public getDistance(x1: number, y1: number, x2: number, y2: number): number {
    return this.mapAccessService.getDistance(x1, y1, x2, y2);
  }

  /**
   * Get tiles accessible within movement range
   */
  public getAccessibleTiles(
    x: number,
    y: number,
    movementPoints: number,
    unitTypeId?: string
  ): MapTile[] {
    return this.mapAccessService.getAccessibleTiles(x, y, movementPoints, unitTypeId);
  }

  /**
   * Validate map structure and properties
   */
  public validateMap(): { valid: boolean; issues: string[] } {
    return this.mapAccessService.validateMap();
  }

  // === UTILITY METHODS ===

  /**
   * Generate a random seed string
   */
  private generateSeed(): string {
    return (
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    );
  }

  /**
   * Create a seeded random number generator
   * @param seed String seed for reproducible random generation
   * @returns Function that returns random numbers [0, 1)
   */
  private createSeededRandom(seed: string): () => number {
    // Simple hash function to convert string to number
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Use the hash as seed for a simple PRNG
    let currentSeed = Math.abs(hash);

    return () => {
      // Linear congruential generator
      currentSeed = (currentSeed * 1103515245 + 12345) & 0x7fffffff;
      return currentSeed / 0x7fffffff;
    };
  }
}
