import { logger } from '@utils/logger';
import type { CityState } from './CityManager';

// Border calculation constants from Freeciv
// Reference: freeciv/common/borders.c and freeciv/common/game.h
export enum BordersMode {
  DISABLED = 'disabled',
  ENABLED = 'enabled',
  SEE_INSIDE = 'see_inside',
  EXPAND = 'expand'
}

// Game settings for borders (following Freeciv defaults)
export interface BorderSettings {
  borders: BordersMode;
  borderCityRadiusSq: number; // Default border radius squared for cities
  borderSizeEffect: number; // How much city size affects border radius
}

// Default border settings matching Freeciv classic ruleset
export const DEFAULT_BORDER_SETTINGS: BorderSettings = {
  borders: BordersMode.ENABLED,
  borderCityRadiusSq: 5, // Radius squared = 5 (radius ~2.2 tiles)
  borderSizeEffect: 1, // Each population point adds to border strength
};

export interface TilePosition {
  x: number;
  y: number;
}

export interface BorderSource {
  position: TilePosition;
  playerId: string;
  sourceType: 'city' | 'base';
  sourceId: string;
  strength: number;
  radiusSq: number;
}

/**
 * BorderManager - Manages territorial borders following authentic Freeciv logic
 * 
 * Port of Freeciv border system from reference/freeciv/common/borders.c
 * Key functions ported:
 * - tile_border_source_radius_sq() - Calculate border radius from sources
 * - tile_border_source_strength() - Calculate border claiming strength
 * - is_border_source() - Determine if tile is a border source
 * 
 * Border claiming rules (from Freeciv):
 * 1. Cities are primary border sources
 * 2. Border radius = base radius + city size effect
 * 3. Border strength = (city size + 2) for conflict resolution
 * 4. Distance affects strength: strength² / distance²
 */
export class BorderManager {
  private gameId: string;
  private settings: BorderSettings;
  private tileOwnership: Map<string, string> = new Map(); // tileKey -> playerId
  private borderSources: Map<string, BorderSource> = new Map(); // sourceId -> BorderSource

  constructor(gameId: string, settings?: Partial<BorderSettings>) {
    this.gameId = gameId;
    this.settings = { ...DEFAULT_BORDER_SETTINGS, ...settings };
  }

  /**
   * Calculate border radius squared from a border source
   * Reference: freeciv/common/borders.c:33-64 tile_border_source_radius_sq()
   */
  private calculateBorderRadiusSq(source: BorderSource): number {
    if (this.settings.borders === BordersMode.DISABLED) {
      return 0;
    }

    let radiusSq = this.settings.borderCityRadiusSq;

    if (source.sourceType === 'city') {
      // City size effect on border radius
      // In Freeciv: radius_sq += MIN(city_size, CITY_MAP_MAX_RADIUS_SQ) * border_size_effect
      // For now, we'll use a simplified approach - will be enhanced when city size is integrated
      radiusSq += Math.min(5, 26) * this.settings.borderSizeEffect; // Placeholder
    }

    return radiusSq;
  }

  /**
   * Calculate border source strength
   * Reference: freeciv/common/borders.c:69-96 tile_border_source_strength()
   */
  private calculateBorderStrength(source: BorderSource, citySize?: number): number {
    if (this.settings.borders === BordersMode.DISABLED) {
      return 0;
    }

    let strength = 0;

    if (source.sourceType === 'city') {
      // City strength: (city_size + 2) * (100 + border_strength_bonus) / 100
      const size = citySize || 1; // Default to size 1 if not provided
      strength = (size + 2) * 100 / 100; // No bonus effects for now
    } else {
      // Base strength for forts/bases: 100 / 100 = 1
      strength = 100 / 100;
    }

    return strength;
  }

  /**
   * Calculate border strength at a specific distance from source
   * Reference: freeciv/common/borders.c:101-111 tile_border_strength()
   */
  private calculateBorderStrengthAtDistance(
    source: BorderSource, 
    targetPos: TilePosition,
    citySize?: number
  ): number {
    const fullStrength = this.calculateBorderStrength(source, citySize);
    const sqDistance = this.calculateSquareDistance(source.position, targetPos);

    if (sqDistance > 0) {
      return (fullStrength * fullStrength) / sqDistance;
    } else {
      return Number.MAX_SAFE_INTEGER; // Infinite strength at source location
    }
  }

  /**
   * Calculate squared distance between two positions (Freeciv square distance)
   */
  private calculateSquareDistance(pos1: TilePosition, pos2: TilePosition): number {
    const dx = Math.abs(pos1.x - pos2.x);
    const dy = Math.abs(pos1.y - pos2.y);
    return dx * dx + dy * dy;
  }

  /**
   * Check if a position is a border source
   * Reference: freeciv/common/borders.c:116-133 is_border_source()
   */
  isBorderSource(position: TilePosition): boolean {
    const sourceKey = `${position.x},${position.y}`;
    return Array.from(this.borderSources.values()).some(
      source => `${source.position.x},${source.position.y}` === sourceKey
    );
  }

  /**
   * Add a city as a border source
   * Called when cities are founded or grow
   */
  addCityBorderSource(city: CityState): void {
    const source: BorderSource = {
      position: { x: city.x, y: city.y },
      playerId: city.playerId,
      sourceType: 'city',
      sourceId: city.id,
      strength: this.calculateBorderStrength({ 
        position: { x: city.x, y: city.y },
        playerId: city.playerId,
        sourceType: 'city',
        sourceId: city.id,
        strength: 0,
        radiusSq: 0
      }, city.population),
      radiusSq: this.calculateBorderRadiusSq({
        position: { x: city.x, y: city.y },
        playerId: city.playerId,
        sourceType: 'city',
        sourceId: city.id,
        strength: 0,
        radiusSq: 0
      })
    };

    this.borderSources.set(city.id, source);
    
    // Claim borders around the city
    this.claimBorders(source, city.population);
    
    logger.info('Added city border source', {
      cityId: city.id,
      playerId: city.playerId,
      position: source.position,
      radiusSq: source.radiusSq,
      strength: source.strength
    });
  }

  /**
   * Remove a border source (when city is destroyed)
   */
  removeBorderSource(sourceId: string): void {
    const source = this.borderSources.get(sourceId);
    if (source) {
      this.borderSources.delete(sourceId);
      
      // Recalculate all borders since this source is gone
      this.recalculateAllBorders();
      
      logger.info('Removed border source', { sourceId, position: source.position });
    }
  }

  /**
   * Claim borders around a border source
   * Reference: Freeciv border claiming logic
   */
  private claimBorders(source: BorderSource, citySize?: number): void {
    const radiusSq = source.radiusSq;
    
    // Iterate through all tiles within the border radius
    for (let dx = -Math.ceil(Math.sqrt(radiusSq)); dx <= Math.ceil(Math.sqrt(radiusSq)); dx++) {
      for (let dy = -Math.ceil(Math.sqrt(radiusSq)); dy <= Math.ceil(Math.sqrt(radiusSq)); dy++) {
        const targetPos: TilePosition = {
          x: source.position.x + dx,
          y: source.position.y + dy
        };
        
        const sqDistance = this.calculateSquareDistance(source.position, targetPos);
        
        // Skip tiles outside border radius
        if (sqDistance > radiusSq) {
          continue;
        }
        
        const tileKey = `${targetPos.x},${targetPos.y}`;
        const currentOwner = this.tileOwnership.get(tileKey);
        
        // If unowned, claim it
        if (!currentOwner) {
          this.tileOwnership.set(tileKey, source.playerId);
          continue;
        }
        
        // If owned by same player, skip
        if (currentOwner === source.playerId) {
          continue;
        }
        
        // Border conflict - resolve by strength
        const currentStrengthAtTile = this.getBestBorderStrengthForPlayer(targetPos, currentOwner);
        const newStrengthAtTile = this.calculateBorderStrengthAtDistance(source, targetPos, citySize);
        
        if (newStrengthAtTile > currentStrengthAtTile) {
          this.tileOwnership.set(tileKey, source.playerId);
          logger.debug('Border tile claimed by stronger source', {
            position: targetPos,
            previousOwner: currentOwner,
            newOwner: source.playerId,
            previousStrength: currentStrengthAtTile,
            newStrength: newStrengthAtTile
          });
        }
      }
    }
  }

  /**
   * Get the best border strength a player has at a specific position
   */
  private getBestBorderStrengthForPlayer(position: TilePosition, playerId: string): number {
    let bestStrength = 0;
    
    for (const source of this.borderSources.values()) {
      if (source.playerId === playerId) {
        const strength = this.calculateBorderStrengthAtDistance(source, position);
        bestStrength = Math.max(bestStrength, strength);
      }
    }
    
    return bestStrength;
  }

  /**
   * Recalculate all borders from scratch
   * Called when border sources change or settings update
   */
  recalculateAllBorders(): void {
    logger.info('Recalculating all borders', { gameId: this.gameId });
    
    // Clear existing ownership
    this.tileOwnership.clear();
    
    // Reclaim borders from all sources
    for (const source of this.borderSources.values()) {
      this.claimBorders(source);
    }
  }

  /**
   * Get tile owner
   */
  getTileOwner(x: number, y: number): string | null {
    const tileKey = `${x},${y}`;
    return this.tileOwnership.get(tileKey) || null;
  }

  /**
   * Get all tiles owned by a player
   */
  getPlayerTiles(playerId: string): TilePosition[] {
    const tiles: TilePosition[] = [];
    
    for (const [tileKey, owner] of this.tileOwnership.entries()) {
      if (owner === playerId) {
        const [x, y] = tileKey.split(',').map(Number);
        tiles.push({ x, y });
      }
    }
    
    return tiles;
  }

  /**
   * Get all border sources
   */
  getBorderSources(): BorderSource[] {
    return Array.from(this.borderSources.values());
  }

  /**
   * Update border settings
   */
  updateSettings(settings: Partial<BorderSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.recalculateAllBorders();
    logger.info('Updated border settings', { gameId: this.gameId, settings: this.settings });
  }

  /**
   * Get debug information
   */
  getDebugInfo(): any {
    return {
      gameId: this.gameId,
      settings: this.settings,
      borderSourceCount: this.borderSources.size,
      ownedTileCount: this.tileOwnership.size,
      borderSources: Array.from(this.borderSources.values()).map(source => ({
        sourceId: source.sourceId,
        playerId: source.playerId,
        position: source.position,
        strength: source.strength,
        radiusSq: source.radiusSq
      }))
    };
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.tileOwnership.clear();
    this.borderSources.clear();
    logger.debug(`Border manager cleaned up for game ${this.gameId}`);
  }
}