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
   * @reference Original CityManager.cityMapIncludesTile()
   */
  private cityMapIncludesTile(tile: { x: number; y: number }, city: CityState): boolean {
    const dx = tile.x - city.x;
    const dy = tile.y - city.y;
    const distanceSq = dx * dx + dy * dy;
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
    const mapData = this.mapManager.getMapData();
    if (!mapData) {
      logger.warn('Cannot initialize workable tiles: no map data available', { cityId: city.id });
      return;
    }

    city.workableTiles = [];

    // Generate all possible tiles within city radius
    for (let dx = -this.CITY_MAP_DEFAULT_RADIUS_SQ; dx <= this.CITY_MAP_DEFAULT_RADIUS_SQ; dx++) {
      for (let dy = -this.CITY_MAP_DEFAULT_RADIUS_SQ; dy <= this.CITY_MAP_DEFAULT_RADIUS_SQ; dy++) {
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

    logger.info('Initialized workable tiles for city', {
      cityId: city.id,
      cityName: city.name,
      tilesCount: city.workableTiles.length,
    });
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
