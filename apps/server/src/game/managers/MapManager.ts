import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile, MapStartpos } from '@game/map/MapTypes';
import { HeightBasedMapService } from '@game/map/HeightBasedMapService';
import { IslandMapService } from '@game/map/IslandMapService';
import { FairIslandsService } from '@game/map/FairIslandsService';
import { MapAccessService } from '@game/map/MapAccessService';
import { ValidationResult } from '@game/map/MapValidator';

// Generator types based on freeciv map_generator enum
export type MapGeneratorType = 'FRACTAL' | 'ISLAND' | 'RANDOM' | 'FAIR' | 'FRACTURE' | 'SCENARIO';

export {
  MapStartpos,
  MapData,
  MapTile,
  TerrainType,
  TemperatureType,
  TerrainProperty,
  ResourceType,
} from '@game/map/MapTypes';

/**
 * Refactored MapManager that coordinates specialized map generation services
 * This is the main coordinator class that delegates to appropriate services
 * Refactored MapManager with modern service-based architecture
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
    const generator = generatorType || this.defaultGeneratorType;

    logger.info('Generating map', {
      width: this.width,
      height: this.height,
      seed: this.seed,
      generator,
      reference: 'freeciv/server/generator/mapgen.c:1268-1427',
    });

    try {
      const mapData =
        generator === 'FAIR'
          ? await this.generateFairMap(players)
          : await this.generateByType(players, generator);

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

  private async generateFairMap(players: Map<string, PlayerState>): Promise<MapData> {
    try {
      return await this.fairIslandsService.generateMap(players);
    } catch (error) {
      if (error instanceof Error && error.message === 'FALLBACK_TO_ISLAND') {
        logger.info('Fair islands generation failed, falling back to ISLAND generator');
        return await this.islandMapService.generateMap(players, MapStartpos.ALL);
      }
      throw error;
    }
  }

  private async generateByType(
    players: Map<string, PlayerState>,
    generator: MapGeneratorType
  ): Promise<MapData> {
    switch (generator) {
      case 'ISLAND':
        return await this.islandMapService.generateMap(players, this.defaultStartPosMode);
      case 'RANDOM':
        return await this.heightBasedMapService.generateMap(players, 'RANDOM');
      case 'FRACTURE':
        return await this.heightBasedMapService.generateMap(players, 'FRACTURE');
      case 'SCENARIO':
        throw new Error(
          'SCENARIO generator not implemented - scenarios should be loaded from file'
        );
      case 'FRACTAL':
      default:
        return await this.heightBasedMapService.generateMap(players, 'FRACTAL');
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
