import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile, MapStartpos, type MapGenerationOptions } from '@game/map/MapTypes';
import { HeightBasedMapService } from '@game/map/HeightBasedMapService';
import { IslandMapService } from '@game/map/IslandMapService';
import { FairIslandsService } from '@game/map/FairIslandsService';
import { MapAccessService } from '@game/map/MapAccessService';
import { ValidationResult } from '@game/map/MapValidator';
import { MapTopology, type MapTopologyOptions } from '@game/map/MapTopology';
import { FreecivScenarioLoader } from '@game/map/FreecivScenarioLoader';

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
  private scenarioLoader: FreecivScenarioLoader;
  private scenarioId: string;

  constructor(
    width: number,
    height: number,
    seed?: string,
    generator: string = 'random',
    defaultGeneratorType?: MapGeneratorType,
    defaultStartPosMode?: MapStartpos,
    cleanupTemperatureMapAfterUse: boolean = false,
    temperatureParam: number = 50,
    topologyOptions: MapTopologyOptions = {},
    scenarioId: string = 'earth-small',
    generationOptions: MapGenerationOptions = {}
  ) {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.generator = generator;
    this.defaultGeneratorType = defaultGeneratorType || 'FRACTAL';
    this.defaultStartPosMode = defaultStartPosMode ?? MapStartpos.DEFAULT;
    this.random = this.createSeededRandom(this.seed);
    this.scenarioId = scenarioId;
    this.scenarioLoader = new FreecivScenarioLoader();

    // Initialize specialized services
    this.heightBasedMapService = new HeightBasedMapService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam,
      topologyOptions,
      generationOptions
    );

    this.islandMapService = new IslandMapService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam,
      topologyOptions,
      generationOptions
    );

    this.fairIslandsService = new FairIslandsService(
      width,
      height,
      this.seed,
      this.generator,
      this.random,
      this.defaultStartPosMode,
      cleanupTemperatureMapAfterUse,
      temperatureParam,
      topologyOptions,
      generationOptions
    );

    this.mapAccessService = new MapAccessService(width, height, topologyOptions);
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
      const topology = this.mapAccessService.getTopology();
      mapData.topologyId ??= topology.topologyId;
      mapData.wrapId ??= topology.wrapId;

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
        try {
          return await this.islandMapService.generateMap(players, MapStartpos.ALL);
        } catch (islandError) {
          if (islandError instanceof Error && islandError.message === 'FALLBACK_TO_RANDOM') {
            logger.info('Island fallback is infeasible, falling back to RANDOM');
            return await this.generateHeightMapWithRetries(players, 'RANDOM');
          }
          throw islandError;
        }
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
        try {
          return await this.islandMapService.generateMap(players, this.defaultStartPosMode);
        } catch (error) {
          if (error instanceof Error && error.message === 'FALLBACK_TO_RANDOM') {
            logger.info('Island generation is infeasible, falling back to RANDOM');
            return await this.heightBasedMapService.generateMap(players, 'RANDOM');
          }
          throw error;
        }
      case 'RANDOM':
        return await this.generateHeightMapWithRetries(players, 'RANDOM');
      case 'FRACTURE':
        return await this.generateHeightMapWithRetries(players, 'FRACTURE');
      case 'SCENARIO':
        return this.scenarioLoader.loadScenario(this.scenarioId, players).mapData;
      case 'FRACTAL':
      default:
        return await this.generateHeightMapWithRetries(players, 'FRACTAL');
    }
  }

  private async generateHeightMapWithRetries(
    players: Map<string, PlayerState>,
    requested: 'RANDOM' | 'FRACTAL' | 'FRACTURE'
  ): Promise<MapData> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      const generator = attempt === 0 ? requested : 'RANDOM';
      try {
        return await this.heightBasedMapService.generateMap(players, generator);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!/starting|city-capable|no land/i.test(lastError.message)) throw lastError;
        logger.warn('Map generation produced no playable starts; retrying', {
          requested,
          generator,
          attempt: attempt + 1,
        });
      }
    }
    throw lastError ?? new Error(`Unable to generate a playable ${requested} map`);
  }

  // === PUBLIC API METHODS (delegated to services) ===

  /**
   * Get current map data
   */
  public getMapData(): MapData | null {
    return this.mapAccessService.getMapData();
  }

  public getTopology(): MapTopology {
    return this.mapAccessService.getTopology();
  }

  /**
   * Load previously generated map data, for example when restoring an active
   * game after a server restart.
   */
  public setMapData(mapData: MapData): void {
    this.mapAccessService.setMapData(mapData);
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
