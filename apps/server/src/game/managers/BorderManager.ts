/**
 * BorderManager - Integrates border system with game state
 * Ported from reference/freeciv/server/maphand.c and reference/freeciv/server/srv_main.c
 */

import { logger } from '@utils/logger';
import { BorderService, BorderSource } from '../services/BorderService';
import { BorderMode, BorderConfiguration, Tile, City, Extra } from '../../types/common';
import { MapManager } from './MapManager';

export interface BorderManagerConfig {
  borderConfig: BorderConfiguration;
  mapWidth: number;
  mapHeight: number;
  mapManager?: MapManager;
}

export class BorderManager {
  private borderService: BorderService;
  private config: BorderManagerConfig;

  constructor(config: BorderManagerConfig) {
    this.config = config;
    this.borderService = new BorderService(config.borderConfig, config.mapWidth, config.mapHeight);

    logger.info('BorderManager initialized', {
      borderMode: BorderMode[config.borderConfig.borderMode],
      borderCityRadius: config.borderConfig.borderCityRadiusSquared,
      borderSizeEffect: config.borderConfig.borderSizeEffect,
    });
  }

  /**
   * Initialize default border configuration
   * Based on reference/freeciv/server/settings.c default values
   */
  static createDefaultConfig(mapWidth: number, mapHeight: number): BorderManagerConfig {
    return {
      borderConfig: {
        borderMode: BorderMode.ENABLED,
        borderCityRadiusSquared: 17, // Default city radius squared (approximately 4 tiles)
        borderSizeEffect: 1, // Each city size adds 1 to border radius
        borderVision: false, // Borders don't provide vision by default
        borderStrengthPct: 0, // Base strength percentage bonus
        happyBorders: false, // Border crossings don't affect happiness by default
      },
      mapWidth,
      mapHeight,
    };
  }

  /**
   * Handle city founding - claim initial borders
   * Integrates with CityManager city founding process
   * Ported from reference/freeciv/server/citytools.c:create_city()
   */
  async onCityFounded(
    city: City,
    tiles: Record<string, Tile>,
    cities: Record<string, City>,
    extras?: Record<string, Extra>
  ): Promise<Record<string, Tile>> {
    if (this.config.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    logger.debug('Claiming borders for newly founded city', {
      cityId: city.id,
      cityName: city.name,
      position: { x: city.x, y: city.y },
      size: city.size,
    });

    const source: BorderSource = {
      id: city.id,
      playerId: city.playerId,
      x: city.x,
      y: city.y,
      type: 'city',
    };

    // Get radius for this city
    const radiusSquared = this.borderService.calculateBorderSourceRadiusSquared(
      source,
      city.size,
      extras
    );
    const radius = Math.ceil(Math.sqrt(radiusSquared));

    // Get actual map tiles in the border radius
    const mapTiles = this.mapTilesToBorderTiles(radius, city.x, city.y);

    // Merge with provided tiles (in case they have additional data)
    const allTiles = { ...mapTiles, ...tiles };

    // Calculate borders
    const updatedTiles = this.borderService.claimBorders(
      source,
      allTiles,
      cities,
      city.size,
      -1,
      extras
    );

    // Update the actual map with border data
    this.updateMapTiles(updatedTiles);

    return updatedTiles;
  }

  /**
   * Handle city growth - expand borders
   * Integrates with CityManager city growth process
   * Ported from reference/freeciv/server/cityturn.c:city_grow()
   */
  async onCityGrown(
    city: City,
    oldSize: number,
    tiles: Record<string, Tile>,
    cities: Record<string, City>,
    extras?: Record<string, Extra>
  ): Promise<Record<string, Tile>> {
    if (this.config.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    logger.debug('Updating borders for city growth', {
      cityId: city.id,
      cityName: city.name,
      oldSize,
      newSize: city.size,
    });

    const source: BorderSource = {
      id: city.id,
      playerId: city.playerId,
      x: city.x,
      y: city.y,
      type: 'city',
    };

    const oldRadiusSquared = this.borderService.calculateBorderSourceRadiusSquared(
      source,
      oldSize,
      extras
    );
    const newRadiusSquared = this.borderService.calculateBorderSourceRadiusSquared(
      source,
      city.size,
      extras
    );

    // If radius changed, update borders
    if (oldRadiusSquared !== newRadiusSquared) {
      return this.borderService.claimBorders(source, tiles, cities, city.size, -1, extras);
    }

    return tiles;
  }

  /**
   * Handle city destruction - clear borders
   * Integrates with CityManager city destruction process
   * Ported from reference/freeciv/server/citytools.c:remove_city()
   */
  async onCityDestroyed(
    city: City,
    tiles: Record<string, Tile>,
    _cities: Record<string, City>,
    extras?: Record<string, Extra>
  ): Promise<Record<string, Tile>> {
    if (this.config.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    logger.debug('Clearing borders for destroyed city', {
      cityId: city.id,
      cityName: city.name,
      position: { x: city.x, y: city.y },
    });

    const source: BorderSource = {
      id: city.id,
      playerId: city.playerId,
      x: city.x,
      y: city.y,
      type: 'city',
    };

    return this.borderService.clearBorders(source, tiles, city.size, extras);
  }

  /**
   * Check if unit can enter a tile based on border restrictions
   * Integrates with UnitManager movement validation
   * Ported from reference/freeciv/server/srv_main.c movement restriction checks
   */
  canUnitEnterTile(
    unitPlayerId: string,
    tileX: number,
    tileY: number,
    tiles: Record<string, Tile>,
    unitTypeFlags?: string[]
  ): { canEnter: boolean; reason?: string } {
    const tileKey = `${tileX},${tileY}`;
    const tile = tiles[tileKey];

    if (!tile || !tile.owner) {
      return { canEnter: true }; // No borders or unowned tile
    }

    if (tile.owner === unitPlayerId) {
      return { canEnter: true }; // Own territory
    }

    // Check for units with special border crossing abilities
    // This would need to be extended based on unit type flags
    if (unitTypeFlags?.includes('ENTER_BORDERS')) {
      return { canEnter: true };
    }

    return {
      canEnter: false,
      reason: 'Cannot enter foreign territory',
    };
  }

  /**
   * Check if city can be founded at location based on border restrictions
   * Integrates with CityManager city founding validation
   * Ported from reference/freeciv/server/citytools.c city founding checks
   */
  canFoundCityAt(
    playerId: string,
    tileX: number,
    tileY: number,
    tiles: Record<string, Tile>
  ): { canFound: boolean; reason?: string } {
    const tileKey = `${tileX},${tileY}`;
    const tile = tiles[tileKey];

    if (!tile || !tile.owner) {
      return { canFound: true }; // No borders or unowned tile
    }

    if (tile.owner === playerId) {
      return { canFound: true }; // Own territory
    }

    return {
      canFound: false,
      reason: 'Cannot found city on foreign territory - borders must be settled by force',
    };
  }

  /**
   * Recalculate all borders on the map
   * Called during turn processing or after major changes
   * Ported from reference/freeciv/server/maphand.c:map_calculate_borders()
   */
  async recalculateAllBorders(
    tiles: Record<string, Tile>,
    cities: Record<string, City>,
    extras?: Record<string, Extra>
  ): Promise<Record<string, Tile>> {
    if (this.config.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    logger.info('Recalculating all borders on map');
    return this.borderService.calculateAllBorders(tiles, cities, extras);
  }

  /**
   * Get border configuration
   */
  getBorderConfiguration(): BorderConfiguration {
    return { ...this.config.borderConfig };
  }

  /**
   * Update border configuration (for game settings changes)
   */
  updateBorderConfiguration(newConfig: Partial<BorderConfiguration>): void {
    this.config.borderConfig = { ...this.config.borderConfig, ...newConfig };
    this.borderService = new BorderService(
      this.config.borderConfig,
      this.config.mapWidth,
      this.config.mapHeight
    );

    logger.info('Border configuration updated', {
      borderMode: BorderMode[this.config.borderConfig.borderMode],
    });
  }

  /**
   * Get tiles owned by a specific player
   * Useful for territory reports and AI decisions
   */
  getPlayerTerritory(playerId: string, tiles: Record<string, Tile>): Tile[] {
    return Object.values(tiles).filter(tile => tile.owner === playerId);
  }

  /**
   * Get border strength at a specific tile
   * Useful for conflict resolution and AI decisions
   */
  getBorderStrengthAt(tileX: number, tileY: number, tiles: Record<string, Tile>): number {
    const tileKey = `${tileX},${tileY}`;
    const tile = tiles[tileKey];
    return tile?.borderStrength ?? 0;
  }

  /**
   * Convert MapTiles to BorderService tile format
   */
  private mapTilesToBorderTiles(
    radius: number,
    centerX: number,
    centerY: number
  ): Record<string, Tile> {
    const tiles: Record<string, Tile> = {};

    if (!this.config.mapManager) {
      return tiles;
    }

    const mapManager = this.config.mapManager;

    // Get tiles in radius around city
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;

        if (dx * dx + dy * dy <= radius * radius) {
          const mapTile = mapManager.getTile(x, y);
          if (mapTile) {
            const tileKey = `${x},${y}`;
            tiles[tileKey] = {
              x: mapTile.x,
              y: mapTile.y,
              terrain: mapTile.terrain,
              visible: mapTile.isVisible,
              known: mapTile.isExplored,
              resource: mapTile.resource,
              elevation: mapTile.elevation,
              riverMask: mapTile.riverMask,
              owner: mapTile.owner,
              claimer: mapTile.claimer,
              borderStrength: mapTile.borderStrength,
            };

            // Add city reference if present
            if (mapTile.cityId) {
              tiles[tileKey].city = mapTile.cityId;
            }
          }
        }
      }
    }

    return tiles;
  }

  /**
   * Update actual map tiles with border data
   */
  private updateMapTiles(updatedTiles: Record<string, Tile>): void {
    if (!this.config.mapManager) {
      return;
    }

    const mapManager = this.config.mapManager;

    for (const [, tile] of Object.entries(updatedTiles)) {
      // Update border properties on the actual map tile
      if (tile.owner !== undefined) {
        mapManager.updateTileProperty(tile.x, tile.y, 'owner', tile.owner);
      }
      if (tile.claimer !== undefined) {
        mapManager.updateTileProperty(tile.x, tile.y, 'claimer', tile.claimer);
      }
      if (tile.borderStrength !== undefined) {
        mapManager.updateTileProperty(tile.x, tile.y, 'borderStrength', tile.borderStrength);
      }
    }

    logger.debug('Updated map tiles with border data', {
      tilesUpdated: Object.keys(updatedTiles).length,
    });
  }
}
