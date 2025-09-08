/**
 * Border Service - Handles territory claims and border calculations
 * Ported from reference/freeciv/common/borders.c and reference/freeciv/server/maphand.c
 */

import { BorderMode, BorderConfiguration, Tile, City, Extra } from '../../types/common.js';

export interface BorderSource {
  id: string; // cityId or extraId
  playerId: string;
  x: number;
  y: number;
  type: 'city' | 'base';
}

export class BorderService {
  private borderConfig: BorderConfiguration;
  private mapWidth: number;
  private mapHeight: number;

  constructor(borderConfig: BorderConfiguration, mapWidth: number, mapHeight: number) {
    this.borderConfig = borderConfig;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
  }

  /**
   * Calculate border radius squared from border source tile
   * Ported from reference/freeciv/common/borders.c:tile_border_source_radius_sq()
   */
  calculateBorderSourceRadiusSquared(source: BorderSource, citySize?: number, extras?: Record<string, Extra>): number {
    if (this.borderConfig.borderMode === BorderMode.DISABLED) {
      return 0;
    }

    let radiusSquared = 0;

    if (source.type === 'city' && citySize !== undefined) {
      radiusSquared = this.borderConfig.borderCityRadiusSquared;
      
      // Limit the addition due to city size. A city size of 60 or more is
      // possible with a city radius of 5 (radius_sq = 26).
      const CITY_MAP_MAX_RADIUS_SQ = 26;
      radiusSquared += Math.min(citySize, CITY_MAP_MAX_RADIUS_SQ) * this.borderConfig.borderSizeEffect;
    } else if (source.type === 'base' && extras) {
      // Check for territory claiming bases/extras
      for (const extra of Object.values(extras)) {
        if (extra.borderSquared !== undefined && extra.borderSquared > -1) {
          radiusSquared = extra.borderSquared;
          break;
        }
      }
    }

    return radiusSquared;
  }

  /**
   * Calculate border source strength
   * Ported from reference/freeciv/common/borders.c:tile_border_source_strength()
   */
  calculateBorderSourceStrength(source: BorderSource, citySize?: number): number {
    if (this.borderConfig.borderMode === BorderMode.DISABLED) {
      return 0;
    }

    let strength = 0;

    if (source.type === 'city' && citySize !== undefined) {
      strength = (citySize + 2) * (100 + this.borderConfig.borderStrengthPct) / 100;
    } else if (source.type === 'base') {
      // Base strength 100 / 100 = 1
      strength = (100 + this.borderConfig.borderStrengthPct) / 100;
    }

    return strength;
  }

  /**
   * Calculate border strength at a specific tile from a border source
   * Ported from reference/freeciv/common/borders.c:tile_border_strength()
   */
  calculateBorderStrengthAtTile(
    tileX: number, 
    tileY: number, 
    source: BorderSource, 
    citySize?: number
  ): number {
    const fullStrength = this.calculateBorderSourceStrength(source, citySize);
    const squaredDistance = this.calculateSquaredDistance(tileX, tileY, source.x, source.y);

    if (squaredDistance > 0) {
      return (fullStrength * fullStrength) / squaredDistance;
    } else {
      return Number.MAX_SAFE_INTEGER; // FC_INFINITY equivalent
    }
  }

  /**
   * Check if a tile position is a border source
   * Ported from reference/freeciv/common/borders.c:is_border_source()
   */
  isBorderSource(tile: Tile, cities: Record<string, City>, extras?: Record<string, Extra>): boolean {
    // Check if tile has a city
    if (tile.city) {
      return true;
    }

    // Check if tile has territory-claiming extras
    if (tile.owner && extras) {
      for (const extra of Object.values(extras)) {
        if (extra.borderSquared !== undefined && extra.borderSquared > -1) {
          // Would need to check if this tile actually has this extra
          // This would require extending Tile interface to track extras
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Calculate squared distance between two points (handles map wrapping if needed)
   * Ported from reference/freeciv/common/map.c:sq_map_distance()
   */
  private calculateSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    
    // Handle map wrapping if implemented
    // For now, simple distance calculation
    return dx * dx + dy * dy;
  }

  /**
   * Get all tiles within a circular radius from center point
   * Ported from reference/freeciv/common/map.c:circle_dxyr_iterate
   */
  getTilesInRadius(centerX: number, centerY: number, radiusSquared: number): Array<{x: number, y: number}> {
    const tiles: Array<{x: number, y: number}> = [];
    
    // Calculate the maximum linear distance we need to check
    const maxRadius = Math.ceil(Math.sqrt(radiusSquared));
    
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dy = -maxRadius; dy <= maxRadius; dy++) {
        const distanceSquared = dx * dx + dy * dy;
        
        if (distanceSquared <= radiusSquared) {
          const tileX = centerX + dx;
          const tileY = centerY + dy;
          
          // Check map boundaries
          if (tileX >= 0 && tileX < this.mapWidth && tileY >= 0 && tileY < this.mapHeight) {
            tiles.push({ x: tileX, y: tileY });
          }
        }
      }
    }
    
    return tiles;
  }

  /**
   * Claim borders for a specific border source
   * Ported from reference/freeciv/server/maphand.c:map_claim_border()
   */
  claimBorders(
    source: BorderSource, 
    tiles: Record<string, Tile>, 
    cities: Record<string, City>,
    citySize?: number,
    radiusSquared: number = -1,
    extras?: Record<string, Extra>
  ): Record<string, Tile> {
    if (this.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    if (radiusSquared < 0) {
      radiusSquared = this.calculateBorderSourceRadiusSquared(source, citySize, extras);
    }

    const tilesToClaim = this.getTilesInRadius(source.x, source.y, radiusSquared);
    const updatedTiles = { ...tiles };

    for (const tilePos of tilesToClaim) {
      const tileKey = `${tilePos.x},${tilePos.y}`;
      const tile = updatedTiles[tileKey];
      
      if (!tile) continue;

      const currentClaimer = tile.claimer;
      const newStrength = this.calculateBorderStrengthAtTile(tilePos.x, tilePos.y, source, citySize);

      // Check if we should claim this tile
      const shouldClaim = !currentClaimer || 
                         !tile.borderStrength || 
                         newStrength > tile.borderStrength;

      if (shouldClaim) {
        updatedTiles[tileKey] = {
          ...tile,
          owner: source.playerId,
          claimer: source.id,
          borderStrength: newStrength
        };
      }
    }

    return updatedTiles;
  }

  /**
   * Clear borders for a specific border source
   * Ported from reference/freeciv/server/maphand.c:map_clear_border()
   */
  clearBorders(
    source: BorderSource, 
    tiles: Record<string, Tile>, 
    citySize?: number,
    extras?: Record<string, Extra>
  ): Record<string, Tile> {
    const radiusSquared = this.calculateBorderSourceRadiusSquared(source, citySize, extras);
    const tilesToCheck = this.getTilesInRadius(source.x, source.y, radiusSquared);
    const updatedTiles = { ...tiles };

    for (const tilePos of tilesToCheck) {
      const tileKey = `${tilePos.x},${tilePos.y}`;
      const tile = updatedTiles[tileKey];
      
      if (tile && tile.claimer === source.id) {
        updatedTiles[tileKey] = {
          ...tile,
          owner: undefined,
          claimer: undefined,
          borderStrength: undefined
        };
      }
    }

    return updatedTiles;
  }

  /**
   * Calculate borders for entire map
   * Ported from reference/freeciv/server/maphand.c:map_calculate_borders()
   */
  calculateAllBorders(
    tiles: Record<string, Tile>, 
    cities: Record<string, City>,
    extras?: Record<string, Extra>
  ): Record<string, Tile> {
    if (this.borderConfig.borderMode === BorderMode.DISABLED) {
      return tiles;
    }

    console.log('Calculating borders for entire map');
    
    let updatedTiles = { ...tiles };

    // First pass: Clear all existing borders
    for (const tileKey in updatedTiles) {
      updatedTiles[tileKey] = {
        ...updatedTiles[tileKey],
        owner: undefined,
        claimer: undefined,
        borderStrength: undefined
      };
    }

    // Second pass: Claim borders for all border sources
    for (const tileKey in updatedTiles) {
      const tile = updatedTiles[tileKey];
      
      if (this.isBorderSource(tile, cities, extras)) {
        const city = tile.city ? cities[tile.city] : undefined;
        
        if (city) {
          const source: BorderSource = {
            id: city.id,
            playerId: city.playerId,
            x: tile.x,
            y: tile.y,
            type: 'city'
          };
          
          updatedTiles = this.claimBorders(source, updatedTiles, cities, city.size, -1, extras);
        }
        // Handle bases/extras claiming territory here if needed
      }
    }

    return updatedTiles;
  }
}