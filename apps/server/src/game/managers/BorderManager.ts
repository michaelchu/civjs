/**
 * BorderManager - Port of Freeciv border system to CivJS
 *
 * Handles territorial borders, tile ownership, and border strength calculations
 * based on cities and extra structures (forts, bases).
 *
 * @reference freeciv/common/borders.c - Core border calculation logic
 * @reference docs/BORDER_SYSTEM_PORT_PLAN.md - Implementation plan Phase 1.1
 */

import { logger } from '@utils/logger';
import type { MapManager } from '@game/managers/MapManager';
import type { CityManager } from '@game/managers/CityManager';
import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';
import {
  BORDERS_ENABLED,
  BORDER_DEFAULT_CITY_RADIUS_SQ,
  BORDER_DEFAULT_SIZE_EFFECT,
  BORDER_DEFAULT_STRENGTH_PCT,
  CITY_MAP_MAX_RADIUS_SQ,
  FC_INFINITY,
} from '@game/constants/BorderConstants';
import type { BorderSource, TileOwnership, BorderUpdate } from '../../types/shared/BorderTypes';

interface GameSettings {
  borders: number; // BORDERS_DISABLED or BORDERS_ENABLED
  borderCityRadiusSq: number;
  borderSizeEffect: number;
  borderStrengthPct: number;
}

interface BorderChangeCallbacks {
  onBorderUpdate?: (update: BorderUpdate) => void;
  onBorderSourceAdded?: (source: BorderSource) => void;
  onBorderSourceRemoved?: (x: number, y: number) => void;
}

export class BorderManager {
  private mapManager: MapManager;
  private cityManager: CityManager;
  private effectsManager: EffectsManager;
  private gameSettings: GameSettings;
  private callbacks: BorderChangeCallbacks = {};

  // Cached border data for performance
  private borderSources: Map<string, BorderSource> = new Map();
  private tileOwnership: Map<string, TileOwnership> = new Map();

  constructor(
    mapManager: MapManager,
    cityManager: CityManager,
    effectsManager: EffectsManager,
    gameSettings?: Partial<GameSettings>
  ) {
    this.mapManager = mapManager;
    this.cityManager = cityManager;
    this.effectsManager = effectsManager;
    this.gameSettings = {
      borders: BORDERS_ENABLED,
      borderCityRadiusSq: BORDER_DEFAULT_CITY_RADIUS_SQ,
      borderSizeEffect: BORDER_DEFAULT_SIZE_EFFECT,
      borderStrengthPct: BORDER_DEFAULT_STRENGTH_PCT,
      ...gameSettings,
    };

    logger.info('BorderManager initialized', {
      bordersEnabled: this.gameSettings.borders === BORDERS_ENABLED,
      cityRadiusSq: this.gameSettings.borderCityRadiusSq,
    });
  }

  /**
   * Set callback functions for border changes
   */
  setCallbacks(callbacks: BorderChangeCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Check if borders are enabled in game settings
   * @reference freeciv/common/borders.c:38-40
   */
  private areBordersEnabled(): boolean {
    return this.gameSettings.borders === BORDERS_ENABLED;
  }

  /**
   * Generate cache key for tile coordinates
   */
  private getTileKey(x: number, y: number): string {
    return `${x},${y}`;
  }

  /**
   * Calculate squared distance between two tiles
   * @reference freeciv/common/borders.c:104
   */
  private getSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  /**
   * Check if a tile is a border source (city or territory-claiming extra)
   * @reference freeciv/common/borders.c:116-133
   */
  isBorderSource(x: number, y: number): boolean {
    if (!this.areBordersEnabled()) {
      return false;
    }

    // Check if tile has a city
    const tile = this.mapManager.getTile(x, y);
    if (tile?.cityId) {
      return true;
    }

    // Check for territory-claiming extras (forts, bases)
    // TODO: Implement when extras system is available
    // This would check tile.improvements for territory-claiming extras

    return false;
  }

  /**
   * Calculate border radius for a border source tile
   * @reference freeciv/common/borders.c:33-64
   */
  getBorderSourceRadius(source: BorderSource): number {
    if (!this.areBordersEnabled()) {
      return 0;
    }

    let radiusSq = 0;

    if (source.type === 'city') {
      const city = this.cityManager.getCityAt(source.x, source.y);
      radiusSq =
        this.gameSettings.borderCityRadiusSq +
        Math.min(city?.size ?? 0, CITY_MAP_MAX_RADIUS_SQ) * this.gameSettings.borderSizeEffect;

      logger.debug('City border radius calculation', {
        x: source.x,
        y: source.y,
        citySize: city?.size ?? 0,
        baseRadiusSq: this.gameSettings.borderCityRadiusSq,
        sizeEffect: this.gameSettings.borderSizeEffect,
        radiusSq,
        effectiveRadius: Math.sqrt(radiusSq),
      });
    } else if (source.type === 'fort' || source.type === 'extra') {
      // TODO: Implement when extras system is available
      // Would get radius from base/extra definition
      radiusSq = 1; // Default small radius for now
    }

    return radiusSq;
  }

  /**
   * Calculate border strength for a border source tile
   * @reference freeciv/common/borders.c:69-96
   */
  getBorderSourceStrength(source: BorderSource): number {
    if (!this.areBordersEnabled()) {
      return 0;
    }

    let strength = 0;

    if (source.type === 'city') {
      const city = this.cityManager.getCityAt(source.x, source.y);
      if (city && city.size > 0) {
        const citySize = city.size;
        // Get culture-based border strength bonus from buildings/effects
        const cultureBonus = this.getCultureBorderBonus(source.x, source.y);

        // Freeciv formula: (city_size + 2) * (100 + border_strength_pct) / 100
        strength = ((citySize + 2) * (100 + cultureBonus)) / 100;

        logger.debug('City border strength calculation', {
          x: source.x,
          y: source.y,
          citySize,
          cultureBonus,
          strength,
        });
      }
    } else if (source.type === 'fort' || source.type === 'extra') {
      // Freeciv reference: Base strength 100 / 100 = 1 plus tile effects
      // For extras, use tile-based border strength effects
      const tileBonus = this.getTileBorderBonus(source.x, source.y);
      strength = (100 + tileBonus) / 100;
    }

    return strength;
  }

  /**
   * Calculate border strength at a specific tile from a border source
   * @reference freeciv/common/borders.c:101-111
   */
  getTileBorderStrength(x: number, y: number, source: BorderSource): number {
    const fullStrength = this.getBorderSourceStrength(source);
    const sqDist = this.getSquaredDistance(x, y, source.x, source.y);

    if (sqDist > 0) {
      return (fullStrength * fullStrength) / sqDist;
    } else {
      return FC_INFINITY; // Source tile itself has infinite strength
    }
  }

  /**
   * Calculate tile ownership based on competing border sources
   * @reference freeciv border calculation algorithm
   */
  calculateTileOwnership(x: number, y: number): TileOwnership {
    if (!this.areBordersEnabled()) {
      return { x, y, playerId: null, strength: 0, claimedBy: null };
    }

    let strongestSource: BorderSource | null = null;
    let maxStrength = 0;
    const debugInfo: any[] = [];

    // Check all border sources that could reach this tile
    for (const [, source] of this.borderSources) {
      const distance = this.getSquaredDistance(x, y, source.x, source.y);
      const sourceRadiusSq = this.getBorderSourceRadius(source);
      const withinRadius = distance <= sourceRadiusSq; // Compare squared distance with radius_sq directly

      if (withinRadius) {
        const tileStrength = this.getTileBorderStrength(x, y, source);
        debugInfo.push({
          sourcePos: { x: source.x, y: source.y },
          distance,
          radius: sourceRadiusSq,
          strength: tileStrength,
          isStrongest: tileStrength > maxStrength,
        });

        if (tileStrength > maxStrength) {
          maxStrength = tileStrength;
          strongestSource = source;
        }
      }
    }

    const result = {
      x,
      y,
      playerId: strongestSource?.playerId || null,
      strength: maxStrength,
      claimedBy: strongestSource,
    };

    // Log detailed calculation for tiles around cities
    const distanceFromAnyCity =
      this.borderSources.size > 0
        ? Math.min(
            ...Array.from(this.borderSources.values()).map(source =>
              this.getSquaredDistance(x, y, source.x, source.y)
            )
          )
        : Infinity;

    if (this.borderSources.size > 0 && (distanceFromAnyCity <= 25 || maxStrength > 0)) {
      logger.debug('🧮 Tile ownership calculation', {
        tile: { x, y },
        borderSourcesCount: this.borderSources.size,
        distanceFromNearestCity: Math.sqrt(distanceFromAnyCity),
        candidateSources: debugInfo,
        allSources: Array.from(this.borderSources.values()).map(s => ({
          pos: { x: s.x, y: s.y },
          radius: this.getBorderSourceRadius(s),
          strength: this.getBorderSourceStrength(s),
        })),
        result: {
          owner: result.playerId,
          strength: result.strength,
          claimedBy: result.claimedBy ? { x: result.claimedBy.x, y: result.claimedBy.y } : null,
        },
      });
    }

    return result;
  }

  /**
   * Get the owner of a specific tile
   */
  getTileOwner(x: number, y: number): string | null {
    const key = this.getTileKey(x, y);
    const ownership = this.tileOwnership.get(key);

    if (!ownership) {
      // Calculate on-demand if not cached
      const calculated = this.calculateTileOwnership(x, y);
      this.tileOwnership.set(key, calculated);
      // Update the tile in MapManager
      this.updateTileOwnership(x, y, calculated.playerId);
      return calculated.playerId;
    }

    return ownership.playerId;
  }

  /**
   * Update tile ownership in MapManager
   */
  private updateTileOwnership(x: number, y: number, ownerId: string | null): void {
    const tile = this.mapManager.getTile(x, y);
    if (tile) {
      tile.owner = ownerId || undefined;
    }
  }

  /**
   * Get all border sources that could influence a tile
   */
  getBorderingSources(x: number, y: number): BorderSource[] {
    const sources: BorderSource[] = [];

    for (const [, source] of this.borderSources) {
      const distance = this.getSquaredDistance(x, y, source.x, source.y);
      const sourceRadiusSq = this.getBorderSourceRadius(source);

      if (distance <= sourceRadiusSq) {
        // Compare squared distance with radius_sq directly
        sources.push(source);
      }
    }

    return sources;
  }

  /**
   * Check if a tile is on a border (adjacent to different player's territory)
   */
  isOnBorder(x: number, y: number): boolean {
    const owner = this.getTileOwner(x, y);

    // Check adjacent tiles for different ownership
    const directions = [
      { dx: 0, dy: -1 }, // North
      { dx: 1, dy: 0 }, // East
      { dx: 0, dy: 1 }, // South
      { dx: -1, dy: 0 }, // West
    ];

    for (const { dx, dy } of directions) {
      const adjX = x + dx;
      const adjY = y + dy;

      if (this.isValidCoordinate(adjX, adjY)) {
        const adjOwner = this.getTileOwner(adjX, adjY);
        if (adjOwner !== owner) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Create and add the canonical border source for a city.
   */
  addCityBorderSource(city: { id: string; x: number; y: number; playerId: string }): void {
    const source: BorderSource = {
      x: city.x,
      y: city.y,
      playerId: city.playerId,
      type: 'city',
      strength: 0,
      radius: 0,
      cityId: city.id,
    };
    source.radius = this.getBorderSourceRadius(source);
    source.strength = this.getBorderSourceStrength(source);
    this.addBorderSource(source);
  }

  /**
   * Add a new border source (city founding, fort construction)
   */
  addBorderSource(source: BorderSource): void {
    const key = this.getTileKey(source.x, source.y);

    // Check if a border source already exists at this location
    if (this.borderSources.has(key)) {
      logger.warn('Border source already exists at location', {
        x: source.x,
        y: source.y,
        existingType: this.borderSources.get(key)?.type,
        newType: source.type,
      });
      return;
    }

    this.borderSources.set(key, source);

    logger.info('🏘️ Adding border source for city', {
      source,
      bordersEnabled: this.areBordersEnabled(),
      gameSettings: this.gameSettings,
    });

    // Calculate radius and strength for debugging
    const actualRadius = this.getBorderSourceRadius(source);
    const actualStrength = this.getBorderSourceStrength(source);
    logger.info('🔍 Border source calculations', {
      x: source.x,
      y: source.y,
      providedRadius: source.radius,
      calculatedRadius: actualRadius,
      providedStrength: source.strength,
      calculatedStrength: actualStrength,
      cityCulture: this.getCityCulture(source.x, source.y),
    });

    // Update borders around this source and collect changes
    const borderUpdate = this.updateBordersAroundTileWithUpdate(source.x, source.y, actualRadius);
    borderUpdate.sources = [source];

    logger.info('🌍 Border update generated', {
      tilesUpdated: borderUpdate.tiles.length,
      affectedPlayers: borderUpdate.affectedPlayers,
      sourcesCount: borderUpdate.sources.length,
    });

    // Trigger callbacks
    this.callbacks.onBorderSourceAdded?.(source);
    this.callbacks.onBorderUpdate?.(borderUpdate);
  }

  /**
   * Remove a border source (city destruction, fort removal)
   */
  removeBorderSource(x: number, y: number): void {
    const key = this.getTileKey(x, y);
    const source = this.borderSources.get(key);

    if (source) {
      this.borderSources.delete(key);
      logger.debug('Removed border source', { x, y, type: source.type });

      // Update borders around former source and collect changes
      const borderUpdate = this.updateBordersAroundTileWithUpdate(x, y, source.radius);
      borderUpdate.removedSources = [{ x, y }];

      // Trigger callbacks
      this.callbacks.onBorderSourceRemoved?.(x, y);
      this.callbacks.onBorderUpdate?.(borderUpdate);
    }
  }

  /**
   * Update borders around a specific tile
   */
  updateBordersAroundTile(centerX: number, centerY: number, radius?: number): void {
    const borderUpdate = this.updateBordersAroundTileWithUpdate(centerX, centerY, radius);
    if (borderUpdate.tiles.length > 0) {
      this.callbacks.onBorderUpdate?.(borderUpdate);
    }
  }

  /**
   * Update borders around a tile and return the changes for network synchronization
   */
  private updateBordersAroundTileWithUpdate(
    centerX: number,
    centerY: number,
    radius?: number
  ): BorderUpdate {
    const updateRadius = radius || BORDER_DEFAULT_CITY_RADIUS_SQ;
    const updatedTiles: TileOwnership[] = [];
    const affectedPlayers: Set<string> = new Set();

    // Update ownership for all tiles within radius
    // Convert radius_sq to linear radius for iteration bounds
    const linearRadius = Math.floor(Math.sqrt(updateRadius));
    for (let x = centerX - linearRadius; x <= centerX + linearRadius; x++) {
      for (let y = centerY - linearRadius; y <= centerY + linearRadius; y++) {
        if (this.isValidCoordinate(x, y)) {
          const key = this.getTileKey(x, y);
          const oldOwnership = this.tileOwnership.get(key);
          const newOwnership = this.calculateTileOwnership(x, y);

          this.tileOwnership.set(key, newOwnership);
          updatedTiles.push(newOwnership);

          // Update tile ownership in map
          this.updateTileOwnership(x, y, newOwnership.playerId);

          // Track affected players for network updates
          if (oldOwnership?.playerId !== null && oldOwnership?.playerId !== undefined) {
            affectedPlayers.add(oldOwnership.playerId);
          }
          if (newOwnership.playerId !== null && newOwnership.playerId !== undefined) {
            affectedPlayers.add(newOwnership.playerId);
          }
        }
      }
    }

    logger.debug('Updated borders around tile with tracking', {
      centerX,
      centerY,
      radius: updateRadius,
      updatedCount: updatedTiles.length,
      affectedPlayers: Array.from(affectedPlayers),
    });

    return {
      tiles: updatedTiles,
      sources: [], // Will be set by caller if needed
      removedSources: [], // Will be set by caller if needed
      affectedPlayers: Array.from(affectedPlayers),
    };
  }

  /**
   * Recalculate all borders for a specific player
   */
  recalculateBordersForPlayer(playerId: string): void {
    logger.info('Recalculating borders for player', { playerId });
    this.recalculateAllBorders();
  }

  /**
   * Recalculate the authoritative ownership map after culture, source, or
   * strength changes and broadcast every changed tile.
   */
  recalculateAllBorders(): BorderUpdate {
    const mapData = this.mapManager.getMapData();
    const changedTiles: TileOwnership[] = [];
    const affectedPlayers = new Set<string>();

    if (!mapData) {
      return { tiles: [], sources: [], removedSources: [], affectedPlayers: [] };
    }

    for (const source of this.borderSources.values()) {
      source.radius = this.getBorderSourceRadius(source);
      source.strength = this.getBorderSourceStrength(source);
    }

    for (let x = 0; x < mapData.width; x++) {
      for (let y = 0; y < mapData.height; y++) {
        const key = this.getTileKey(x, y);
        const previous = this.tileOwnership.get(key);
        const next = this.calculateTileOwnership(x, y);

        this.tileOwnership.set(key, next);
        this.updateTileOwnership(x, y, next.playerId);

        if (this.didOwnershipChange(previous, next)) {
          changedTiles.push(next);
          this.recordAffectedPlayers(affectedPlayers, previous, next);
        }
      }
    }

    const update: BorderUpdate = {
      tiles: changedTiles,
      sources: Array.from(this.borderSources.values()),
      removedSources: [],
      affectedPlayers: Array.from(affectedPlayers),
    };
    if (changedTiles.length > 0) {
      this.callbacks.onBorderUpdate?.(update);
    }
    return update;
  }

  private didOwnershipChange(previous: TileOwnership | undefined, next: TileOwnership): boolean {
    if (!previous) return next.playerId !== null;
    if (previous.playerId !== next.playerId) return true;
    if (previous.claimedBy?.x !== next.claimedBy?.x) return true;
    if (previous.claimedBy?.y !== next.claimedBy?.y) return true;
    return previous.playerId !== null && previous.strength !== next.strength;
  }

  private recordAffectedPlayers(
    affectedPlayers: Set<string>,
    previous: TileOwnership | undefined,
    next: TileOwnership
  ): void {
    if (previous?.playerId) affectedPlayers.add(previous.playerId);
    if (next.playerId) affectedPlayers.add(next.playerId);
  }

  /**
   * Get culture-based border strength bonus for a city
   * @reference freeciv/common/borders.c:82 get_city_bonus(pcity, EFT_BORDER_STRENGTH_PCT)
   */
  private getCultureBorderBonus(x: number, y: number): number {
    const city = this.cityManager.getCityAt(x, y);
    if (!city) {
      return 0;
    }

    const context: EffectContext = {
      cityId: city.id,
      playerId: city.playerId,
      tileX: x,
      tileY: y,
      cityBuildings: new Set(city.buildings || []),
    };

    const borderStrengthEffect = this.effectsManager.calculateEffect(
      EffectType.BORDER_STRENGTH_PCT,
      context
    );

    return borderStrengthEffect.value;
  }

  /**
   * Get tile-based border strength bonus for extras (forts, bases)
   * @reference freeciv/common/borders.c:89 get_tile_bonus(ptile, EFT_BORDER_STRENGTH_PCT)
   */
  private getTileBorderBonus(x: number, y: number): number {
    // For now, return 0 since extras system is not yet implemented
    // When extras are implemented, this should check tile extras and calculate
    // border strength effects similar to getCultureBorderBonus but for tile context
    const tile = this.mapManager.getTile(x, y);
    if (!tile) {
      return 0;
    }

    // TODO: Implement when extras/improvements system is available
    // const context: EffectContext = {
    //   tileX: x,
    //   tileY: y,
    //   tileExtras: new Set(tile.extras || []),
    // };
    // return this.effectsManager.calculateEffect(EffectType.BORDER_STRENGTH_PCT, context).value;

    return 0; // No tile-based border bonuses yet
  }

  private getCityCulture(x: number, y: number): number {
    const city = this.cityManager.getCityAt(x, y);
    return city?.history ?? 0;
  }

  /**
   * Check if coordinates are valid on the map
   */
  private isValidCoordinate(x: number, y: number): boolean {
    const mapData = this.mapManager.getMapData();
    if (!mapData) {
      return false;
    }
    return x >= 0 && y >= 0 && x < mapData.width && y < mapData.height;
  }

  /**
   * Get all current border sources
   */
  getAllBorderSources(): BorderSource[] {
    return Array.from(this.borderSources.values());
  }

  /**
   * Get all current tile ownership data
   */
  getAllTileOwnership(): TileOwnership[] {
    return Array.from(this.tileOwnership.values());
  }

  /**
   * Clear all cached border data (for game reset)
   */
  clearBorderData(): void {
    this.borderSources.clear();
    this.tileOwnership.clear();
    logger.info('Border data cleared');
  }
}
