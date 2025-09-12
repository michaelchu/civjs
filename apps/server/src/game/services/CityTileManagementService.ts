import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { CityState, WorkableTile, SpecialistType } from '@game/managers/CityManager';
import type { MapManager } from '@game/managers/MapManager';

/**
 * CityTileManagementService - Manages city workable tiles and citizen assignments
 * @reference docs/refactor/REFACTORING_PLAN.md - CityManager refactoring
 *
 * Handles all city-tile related operations including:
 * - Workable tile initialization and management
 * - Citizen assignment to tiles
 * - Tile worker to specialist conversion
 * - City output calculations from worked tiles
 */
export class CityTileManagementService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private mapManager: MapManager,
    private CITY_MAP_DEFAULT_RADIUS_SQ: number
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityTileManagementService';
  }

  /**
   * Check if a tile is within the workable area of a city
   * @reference freeciv-web's city_map_includes_tile() and sq_map_distance()
   */
  private cityMapIncludesTile(tile: { x: number; y: number }, city: CityState): boolean {
    const dx = tile.x - city.x;
    const dy = tile.y - city.y;
    const distanceSq = dx * dx + dy * dy;
    // Use <= comparison like freeciv-web: sq_map_distance(a,e) > c
    return distanceSq <= this.CITY_MAP_DEFAULT_RADIUS_SQ;
  }

  /**
   * Calculate squared distance between two points
   * @reference Original CityManager.calculateSquaredDistance()
   */
  // Note: calculateSquaredDistance method removed as it's not currently used
  // It would be used for distance-based tile calculations

  /**
   * Initialize workable tiles for a newly founded city
   * @reference Original CityManager.initializeWorkableTiles()
   */
  public initializeWorkableTiles(city: CityState): void {
    if (!this.mapManager) {
      logger.warn('Cannot initialize workable tiles: MapManager not available, using fallback', {
        cityId: city.id,
      });
      // Provide fallback workable tiles with just city center
      city.workableTiles = [
        {
          x: city.x,
          y: city.y,
          isCenter: true,
          isWorked: true,
          isBlocked: false,
          outputs: { food: 2, shields: 1, trade: 1 },
        },
      ];
      return;
    }

    const mapData = this.mapManager.getMapData();
    if (!mapData) {
      logger.warn('Cannot initialize workable tiles: no map data available, using fallback', {
        cityId: city.id,
      });
      // Provide fallback workable tiles with just city center
      city.workableTiles = [
        {
          x: city.x,
          y: city.y,
          isCenter: true,
          isWorked: true,
          isBlocked: false,
          outputs: { food: 2, shields: 1, trade: 1 },
        },
      ];
      return;
    }

    city.workableTiles = [];

    // Generate all possible tiles within city radius
    // Calculate the linear radius from radius_sq, following freeciv-web's build_city_tile_map
    const linearRadius = Math.floor(Math.sqrt(this.CITY_MAP_DEFAULT_RADIUS_SQ));
    for (let dx = -linearRadius; dx <= linearRadius; dx++) {
      for (let dy = -linearRadius; dy <= linearRadius; dy++) {
        const tileX = city.x + dx;
        const tileY = city.y + dy;

        // Check if tile is within map bounds
        if (!this.mapManager.isValidPosition(tileX, tileY)) {
          continue;
        }

        // Check if tile is within workable radius
        if (!this.cityMapIncludesTile({ x: tileX, y: tileY }, city)) {
          continue;
        }

        const mapTile = this.mapManager.getTile(tileX, tileY);
        if (!mapTile) {
          continue;
        }

        // Create workable tile entry
        const workableTile: WorkableTile = {
          x: tileX,
          y: tileY,
          isWorked: false,
          isCenter: tileX === city.x && tileY === city.y,
          outputs: {
            food: this.calculateTileFood(mapTile),
            shields: this.calculateTileShields(mapTile),
            trade: this.calculateTileTradeFromTerrain(mapTile),
          },
          terrain: mapTile.terrain,
          resource: mapTile.resource,
          improvements: [], // Could be roads, irrigation, etc.
        };

        // City center is always worked
        if (workableTile.isCenter) {
          workableTile.isWorked = true;
        }

        city.workableTiles.push(workableTile);
      }
    }

    // Auto-assign citizens to work the best tiles based on population
    // Each citizen can work one tile (excluding the city center which is free)
    this.autoAssignCitizensToTiles(city);

    logger.info('Initialized workable tiles for city', {
      cityId: city.id,
      cityName: city.name,
      tilesCount: city.workableTiles.length,
      workedTiles: city.workableTiles.filter(t => t.isWorked).length,
    });
  }

  /**
   * Reassign citizens after city growth
   * Public method for CityManager to call when city grows
   */
  public reassignCitizensAfterGrowth(city: CityState): void {
    this.autoAssignCitizensToTiles(city);
  }

  /**
   * Automatically assign citizens to work the best available tiles
   * Citizens = population, but city center is worked for free
   */
  private autoAssignCitizensToTiles(city: CityState): void {
    if (!city.workableTiles) return;

    // Get tile scoring weights from ruleset (could be expanded later)
    // For now, we'll use a balanced approach that prioritizes growth
    const getTileScore = (tile: WorkableTile): number => {
      // Prioritize food for growth, then shields for production, then trade
      // This reflects typical city management strategy
      return tile.outputs.food * 3 + tile.outputs.shields * 2 + tile.outputs.trade;
    };

    // Sort tiles by total output (food + shields + trade), excluding city center
    const availableTiles = city.workableTiles
      .filter(t => !t.isCenter && !t.isBlocked)
      .sort((a, b) => getTileScore(b) - getTileScore(a));

    // Reset all non-center tiles to not worked
    city.workableTiles.forEach(tile => {
      if (!tile.isCenter) {
        tile.isWorked = false;
      }
    });

    // Assign citizens to best tiles (population - 1 because city center is free)
    const citizensToAssign = Math.max(0, city.population - 1);
    for (let i = 0; i < Math.min(citizensToAssign, availableTiles.length); i++) {
      availableTiles[i].isWorked = true;
    }
  }

  /**
   * Calculate food output from a map tile
   */
  private calculateTileFood(mapTile: any): number {
    // Basic terrain food values (simplified)
    const terrainFood: Record<string, number> = {
      grassland: 2,
      plains: 1,
      hills: 1,
      mountains: 0,
      desert: 0,
      tundra: 1,
      arctic: 0,
      swamp: 1,
      forest: 1,
      jungle: 1,
      ocean: 1,
      river: 2,
    };

    let food = terrainFood[mapTile.terrain] || 0;

    // Resource bonuses
    if (mapTile.resource) {
      const resourceFood: Record<string, number> = {
        wheat: 1,
        cattle: 1,
        fish: 2,
        game: 1,
      };
      food += resourceFood[mapTile.resource] || 0;
    }

    return food;
  }

  /**
   * Calculate shield output from a map tile
   */
  private calculateTileShields(mapTile: any): number {
    const terrainShields: Record<string, number> = {
      grassland: 0,
      plains: 1,
      hills: 1,
      mountains: 1,
      desert: 0,
      tundra: 0,
      arctic: 0,
      swamp: 0,
      forest: 2,
      jungle: 0,
      ocean: 0,
      river: 0,
    };

    let shields = terrainShields[mapTile.terrain] || 0;

    if (mapTile.resource) {
      const resourceShields: Record<string, number> = {
        coal: 2,
        iron: 2,
        gold: 1,
      };
      shields += resourceShields[mapTile.resource] || 0;
    }

    return shields;
  }

  /**
   * Calculate trade output from a map tile
   */
  private calculateTileTradeFromTerrain(mapTile: any): number {
    const terrainTrade: Record<string, number> = {
      grassland: 0,
      plains: 0,
      hills: 0,
      mountains: 0,
      desert: 0,
      tundra: 0,
      arctic: 0,
      swamp: 0,
      forest: 0,
      jungle: 0,
      ocean: 2,
      river: 1,
    };

    let trade = terrainTrade[mapTile.terrain] || 0;

    if (mapTile.resource) {
      const resourceTrade: Record<string, number> = {
        silk: 2,
        spice: 2,
        wine: 2,
      };
      trade += resourceTrade[mapTile.resource] || 0;
    }

    return trade;
  }

  /**
   * Assign a citizen to work a specific tile
   * @reference Original CityManager.assignCitizenToTile()
   */
  public async assignCitizenToTile(cityId: string, tileX: number, tileY: number): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn('Cannot assign citizen to tile: city not found', { cityId });
      return false;
    }

    if (!city.workableTiles) {
      logger.warn('Cannot assign citizen to tile: no workable tiles initialized', { cityId });
      return false;
    }

    const tile = city.workableTiles.find(t => t.x === tileX && t.y === tileY);
    if (!tile) {
      logger.warn('Cannot assign citizen to tile: tile not workable by this city', {
        cityId,
        tileX,
        tileY,
      });
      return false;
    }

    if (tile.isWorked) {
      logger.warn('Cannot assign citizen to tile: tile already worked', { cityId, tileX, tileY });
      return false;
    }

    // Note: Blocking logic would be handled by checking if other cities work this tile
    // For now, we'll skip the blocking check

    // Check if city has available workers
    const workedTiles = city.workableTiles.filter(t => t.isWorked && !t.isCenter).length;
    const totalSpecialists = Object.values(city.specialists).reduce((sum, count) => sum + count, 0);
    const availableWorkers = city.population - 1 - workedTiles - totalSpecialists; // -1 for city center

    if (availableWorkers <= 0) {
      logger.warn('Cannot assign citizen to tile: no available workers', { cityId });
      return false;
    }

    tile.isWorked = true;

    logger.info('Citizen assigned to tile', { cityId, tileX, tileY });
    return true;
  }

  /**
   * Convert a tile worker to a specialist
   * @reference Original CityManager.convertTileWorkerToSpecialist()
   */
  public async convertTileWorkerToSpecialist(
    cityId: string,
    tileX: number,
    tileY: number,
    specialistType: number
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      logger.warn('Cannot convert tile worker: city not found', { cityId });
      return false;
    }

    if (!city.workableTiles) {
      logger.warn('Cannot convert tile worker: no workable tiles', { cityId });
      return false;
    }

    const tile = city.workableTiles.find(t => t.x === tileX && t.y === tileY);
    if (!tile) {
      logger.warn('Cannot convert tile worker: tile not found', { cityId, tileX, tileY });
      return false;
    }

    if (!tile.isWorked || tile.isCenter) {
      logger.warn('Cannot convert tile worker: tile not worked by citizen or is city center', {
        cityId,
        tileX,
        tileY,
      });
      return false;
    }

    // Remove worker from tile
    tile.isWorked = false;

    // Add specialist
    const currentCount = city.specialists[specialistType as SpecialistType] || 0;
    city.specialists[specialistType as SpecialistType] = currentCount + 1;

    logger.info('Converted tile worker to specialist', {
      cityId,
      tileX,
      tileY,
      specialistType,
    });
    return true;
  }

  /**
   * Get all workable tiles for a city
   * @reference Original CityManager.getWorkableTiles()
   */
  public getWorkableTiles(cityId: string): WorkableTile[] | null {
    const city = this.cities.get(cityId);
    if (!city) {
      return null;
    }
    return city.workableTiles || [];
  }

  /**
   * Calculate city outputs from worked tiles only (without buildings/specialists)
   * @reference Original CityManager.calculateCityOutputs()
   */
  public calculateCityOutputs(cityId: string): {
    food: number;
    shields: number;
    trade: number;
  } {
    const city = this.cities.get(cityId);
    if (!city || !city.workableTiles) {
      return { food: 0, shields: 0, trade: 0 };
    }

    let food = 0;
    let shields = 0;
    let trade = 0;

    // Sum outputs from all worked tiles
    for (const tile of city.workableTiles) {
      if (tile.isWorked) {
        food += tile.outputs.food;
        shields += tile.outputs.shields;
        trade += tile.outputs.trade;
      }
    }

    return { food, shields, trade };
  }
}
