import { logger } from '@utils/logger';
import { UnitManager } from '@game/managers/UnitManager';
import { MapManager } from '@game/managers/MapManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { MapTile } from '@game/map/MapTypes';

export type RememberedTile = Pick<
  MapTile,
  | 'x'
  | 'y'
  | 'terrain'
  | 'resource'
  | 'elevation'
  | 'riverMask'
  | 'hasRoad'
  | 'hasRailroad'
  | 'improvements'
  | 'cityId'
  | 'owner'
  | 'claimer'
  | 'continentId'
>;

export interface PlayerVisibility {
  playerId: string;
  exploredTiles: Set<string>; // tiles that have been seen before
  visibleTiles: Set<string>; // tiles currently visible
  invisibleDetectionTiles: Set<string>;
  subsurfaceDetectionTiles: Set<string>;
  lastSeenByTile: Map<string, Date>;
  rememberedTiles: Map<string, RememberedTile>;
  lastUpdated: Date;
}

export interface TileVisibility {
  isExplored: boolean; // has been seen before
  isVisible: boolean; // currently visible
  lastSeen?: Date; // when was it last seen
}

export type PlayerTechsProvider = (playerId: string) => ReadonlySet<string>;
export type SharedVisionProvider = (playerId: string) => ReadonlySet<string>;
export type CityVisionProvider = (
  playerId: string
) => ReadonlyArray<{ x: number; y: number; visionRadiusSq?: number }>;
export type VisibilityPersistence = (
  playerId: string,
  exploredTiles: string[],
  visibleTiles: string[],
  lastSeenByTile: Record<string, string>,
  rememberedTiles: Record<string, RememberedTile>
) => Promise<void>;

export class VisibilityManager {
  private gameId: string;
  private playerVisibility: Map<string, PlayerVisibility> = new Map();
  private unitManager: UnitManager;
  private mapManager: MapManager;
  private effectsManager: EffectsManager;
  private playerTechsProvider: PlayerTechsProvider;
  private sharedVisionProvider: SharedVisionProvider = () => new Set();
  private cityVisionProvider: CityVisionProvider = () => [];
  private visibilityPersistence?: VisibilityPersistence;
  private persistenceQueues = new Map<string, Promise<void>>();
  private lastQueuedSnapshots = new Map<string, string>();
  private readonly initialVisionRadiusSq = rulesetLoader.getGameParameters().init_vis_radius_sq;

  constructor(
    gameId: string,
    unitManager: UnitManager,
    mapManager: MapManager,
    effectsManager: EffectsManager = new EffectsManager(),
    playerTechsProvider: PlayerTechsProvider = () => new Set(),
    visibilityPersistence?: VisibilityPersistence
  ) {
    this.gameId = gameId;
    this.unitManager = unitManager;
    this.mapManager = mapManager;
    this.effectsManager = effectsManager;
    this.playerTechsProvider = playerTechsProvider;
    this.visibilityPersistence = visibilityPersistence;
  }

  public setSharedVisionProvider(provider: SharedVisionProvider): void {
    this.sharedVisionProvider = provider;
  }

  public setCityVisionProvider(provider: CityVisionProvider): void {
    this.cityVisionProvider = provider;
  }

  /**
   * Initialize visibility for a new player
   */
  public initializePlayerVisibility(playerId: string): void {
    const visibility: PlayerVisibility = {
      playerId,
      exploredTiles: new Set(),
      visibleTiles: new Set(),
      invisibleDetectionTiles: new Set(),
      subsurfaceDetectionTiles: new Set(),
      lastSeenByTile: new Map(),
      rememberedTiles: new Map(),
      lastUpdated: new Date(),
    };

    this.playerVisibility.set(playerId, visibility);
    logger.debug(`Initialized visibility for player ${playerId}`);
  }

  public restorePlayerVisibility(
    playerId: string,
    exploredTiles: Iterable<string>,
    visibleTiles: Iterable<string> = [],
    lastSeenByTile: Readonly<Record<string, string | Date>> = {},
    rememberedTiles: Readonly<Record<string, RememberedTile>> = {}
  ): void {
    const restoredLastSeen = new Map<string, Date>();
    for (const [tile, value] of Object.entries(lastSeenByTile)) {
      const timestamp = value instanceof Date ? value : new Date(value);
      if (!Number.isNaN(timestamp.getTime())) restoredLastSeen.set(tile, timestamp);
    }
    this.playerVisibility.set(playerId, {
      playerId,
      exploredTiles: new Set(exploredTiles),
      visibleTiles: new Set(visibleTiles),
      invisibleDetectionTiles: new Set(),
      subsurfaceDetectionTiles: new Set(),
      lastSeenByTile: restoredLastSeen,
      rememberedTiles: new Map(Object.entries(rememberedTiles)),
      lastUpdated: new Date(),
    });
  }

  /**
   * Update visibility for a player based on their units
   */
  public updatePlayerVisibility(playerId: string): void {
    let visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      visibility = this.playerVisibility.get(playerId)!;
    }

    // Clear current visibility
    visibility.visibleTiles.clear();
    visibility.invisibleDetectionTiles.clear();
    visibility.subsurfaceDetectionTiles.clear();

    const visionSources = new Set([playerId, ...this.sharedVisionProvider(playerId)]);
    for (const sourcePlayerId of visionSources) {
      this.addUnitVision(sourcePlayerId, visibility);
      this.addCityVision(sourcePlayerId, visibility);
    }

    const observedAt = new Date();
    for (const tileKey of visibility.visibleTiles) {
      visibility.exploredTiles.add(tileKey);
      visibility.lastSeenByTile.set(tileKey, observedAt);
      const [x, y] = tileKey.split(',').map(Number);
      const tile = this.mapManager.getTile(x, y);
      if (tile) visibility.rememberedTiles.set(tileKey, this.rememberTile(tile));
    }

    visibility.lastUpdated = observedAt;
    this.queuePersistence(visibility);
    logger.debug(
      `Updated visibility for player ${playerId}: ${visibility.visibleTiles.size} visible, ${visibility.exploredTiles.size} explored`
    );
  }

  private addUnitVision(sourcePlayerId: string, visibility: PlayerVisibility): void {
    for (const unit of this.unitManager.getPlayerUnits(sourcePlayerId)) {
      const unitType = this.unitManager.getUnitType(unit.unitTypeId);
      if (!unitType) continue;

      const tile = this.mapManager.getTile(unit.x, unit.y);
      if (!tile) continue;

      // Freeciv combines the unit's base sight with effects active at its
      // current tile (for example, the classic mountain-vision effect).
      // @reference reference/freeciv/server/unittools.c:4983-5010
      const visionEffect = this.effectsManager.calculateEffect(EffectType.UNIT_VISION_RADIUS_SQ, {
        playerId: sourcePlayerId,
        unitId: unit.id,
        unitType: unit.unitTypeId,
        unitClass: unitType.rulesetUnitClass,
        unitTypeFlags: new Set(unitType.flags),
        unitActivity: unit.activity?.type,
        tileX: unit.x,
        tileY: unit.y,
        tileTerrain: tile.terrain,
        tileExtras: new Set(tile.improvements),
        tileIsCityCenter: Boolean(tile.cityId),
        maxUnitsOnTile: tile.unitIds.length,
        playerTechs: new Set(this.playerTechsProvider(sourcePlayerId)),
      });
      const unitVisibleTiles = this.calculateTileVisibility(
        unit.x,
        unit.y,
        (unitType.vision_radius_sq || unitType.sight) + visionEffect.value
      );

      for (const tileKey of unitVisibleTiles) {
        visibility.visibleTiles.add(tileKey);
      }
      const detectionTiles = this.calculateTileVisibility(
        unit.x,
        unit.y,
        Math.min(2, Math.max(0, (unitType.vision_radius_sq || unitType.sight) + visionEffect.value))
      );
      for (const tileKey of detectionTiles) {
        visibility.invisibleDetectionTiles.add(tileKey);
        visibility.subsurfaceDetectionTiles.add(tileKey);
      }
    }
  }

  private addCityVision(sourcePlayerId: string, visibility: PlayerVisibility): void {
    for (const city of this.cityVisionProvider(sourcePlayerId)) {
      // Freeciv city_refresh_vision() uses a base main-vision radius of 2,
      // represented as radius_sq 5 by the classic city-map geometry.
      const cityVisibleTiles = this.calculateTileVisibility(
        city.x,
        city.y,
        city.visionRadiusSq ?? this.initialVisionRadiusSq
      );
      for (const tileKey of cityVisibleTiles) visibility.visibleTiles.add(tileKey);
      for (const tileKey of this.calculateTileVisibility(city.x, city.y, 2)) {
        visibility.invisibleDetectionTiles.add(tileKey);
        visibility.subsurfaceDetectionTiles.add(tileKey);
      }
    }
  }

  /**
   * Calculate which tiles are visible from a position
   * @param visionRadiusSq - freeciv vision_radius_sq value (distance squared)
   */
  private calculateTileVisibility(
    centerX: number,
    centerY: number,
    visionRadiusSq: number
  ): Set<string> {
    const visibleTiles = new Set<string>();
    const mapData = this.mapManager.getMapData();
    if (!mapData) return visibleTiles;

    const topology = this.mapManager.getTopology();
    for (let x = 0; x < mapData.width; x++) {
      for (let y = 0; y < mapData.height; y++) {
        if (topology.squaredDistance(centerX, centerY, x, y) <= visionRadiusSq) {
          visibleTiles.add(`${x},${y}`);
        }
      }
    }

    return visibleTiles;
  }

  /**
   * Get tiles that are currently visible to a player
   */
  public getVisibleTiles(playerId: string): Set<string> {
    const visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      return new Set();
    }

    return new Set(visibility.visibleTiles);
  }

  /**
   * Get tiles that have been explored by a player
   */
  public getExploredTiles(playerId: string): Set<string> {
    const visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      return new Set();
    }

    return new Set(visibility.exploredTiles);
  }

  public getDetectionTiles(playerId: string): { invisible: Set<string>; subsurface: Set<string> } {
    const visibility = this.playerVisibility.get(playerId);
    return {
      invisible: new Set(visibility?.invisibleDetectionTiles ?? []),
      subsurface: new Set(visibility?.subsurfaceDetectionTiles ?? []),
    };
  }

  public getRememberedTiles(playerId: string): Map<string, RememberedTile> {
    return new Map(this.playerVisibility.get(playerId)?.rememberedTiles ?? []);
  }

  public grantExploredTiles(playerId: string, tiles: Iterable<string>): Set<string> {
    let visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      visibility = this.playerVisibility.get(playerId)!;
    }
    const observedAt = new Date();
    for (const tile of tiles) {
      visibility.exploredTiles.add(tile);
      visibility.lastSeenByTile.set(tile, observedAt);
      const [x, y] = tile.split(',').map(Number);
      const mapTile = this.mapManager.getTile(x, y);
      if (mapTile) visibility.rememberedTiles.set(tile, this.rememberTile(mapTile));
    }
    visibility.lastUpdated = observedAt;
    this.queuePersistence(visibility);
    return new Set(visibility.exploredTiles);
  }

  public replaceExploredTiles(playerId: string, tiles: Iterable<string>): void {
    let visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      visibility = this.playerVisibility.get(playerId)!;
    }
    const replacement = new Set(tiles);
    visibility.exploredTiles = replacement;
    for (const tile of [...visibility.lastSeenByTile.keys()]) {
      if (!replacement.has(tile)) visibility.lastSeenByTile.delete(tile);
    }
    for (const tile of [...visibility.rememberedTiles.keys()]) {
      if (!replacement.has(tile)) visibility.rememberedTiles.delete(tile);
    }
    visibility.lastUpdated = new Date();
    this.queuePersistence(visibility);
  }

  /**
   * Permanently reveal a circular area, as used by classic hut map scrolls.
   * @reference reference/freeciv/data/default/default.lua:133-143
   */
  public revealArea(
    playerId: string,
    centerX: number,
    centerY: number,
    radiusSquared: number
  ): Set<string> {
    let visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      visibility = this.playerVisibility.get(playerId)!;
    }
    const revealed = this.calculateTileVisibility(centerX, centerY, radiusSquared);
    const observedAt = new Date();
    for (const tile of revealed) {
      visibility.exploredTiles.add(tile);
      visibility.lastSeenByTile.set(tile, observedAt);
      const [x, y] = tile.split(',').map(Number);
      const mapTile = this.mapManager.getTile(x, y);
      if (mapTile) visibility.rememberedTiles.set(tile, this.rememberTile(mapTile));
    }
    visibility.lastUpdated = observedAt;
    this.queuePersistence(visibility);
    return new Set(visibility.exploredTiles);
  }

  private queuePersistence(visibility: PlayerVisibility): void {
    if (!this.visibilityPersistence) return;

    const exploredTiles = [...visibility.exploredTiles].sort();
    const visibleTiles = [...visibility.visibleTiles].sort();
    const lastSeenByTile = Object.fromEntries(
      [...visibility.lastSeenByTile.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tile, timestamp]) => [tile, timestamp.toISOString()])
    );
    const rememberedTiles = Object.fromEntries(
      [...visibility.rememberedTiles.entries()].sort(([left], [right]) => left.localeCompare(right))
    );
    const snapshot = JSON.stringify([exploredTiles, visibleTiles, lastSeenByTile, rememberedTiles]);
    if (this.lastQueuedSnapshots.get(visibility.playerId) === snapshot) return;
    this.lastQueuedSnapshots.set(visibility.playerId, snapshot);

    const previous = this.persistenceQueues.get(visibility.playerId) ?? Promise.resolve();
    const next = previous
      .then(() =>
        this.visibilityPersistence!(
          visibility.playerId,
          exploredTiles,
          visibleTiles,
          lastSeenByTile,
          rememberedTiles
        )
      )
      .catch(error => {
        if (this.lastQueuedSnapshots.get(visibility.playerId) === snapshot) {
          this.lastQueuedSnapshots.delete(visibility.playerId);
        }
        logger.error('Failed to persist player visibility', {
          gameId: this.gameId,
          playerId: visibility.playerId,
          error: error instanceof Error ? error.message : error,
        });
      });
    this.persistenceQueues.set(visibility.playerId, next);
  }

  /**
   * Check if a tile is visible to a player
   */
  public isTileVisible(playerId: string, x: number, y: number): boolean {
    const visibleTiles = this.getVisibleTiles(playerId);
    return visibleTiles.has(`${x},${y}`);
  }

  /**
   * Check if a tile has been explored by a player
   */
  public isTileExplored(playerId: string, x: number, y: number): boolean {
    const exploredTiles = this.getExploredTiles(playerId);
    return exploredTiles.has(`${x},${y}`);
  }

  /**
   * Get visibility info for a specific tile
   */
  public getTileVisibility(playerId: string, x: number, y: number): TileVisibility {
    const visibility = this.playerVisibility.get(playerId);
    const tileKey = `${x},${y}`;
    const isVisible = visibility?.visibleTiles.has(tileKey) ?? false;
    const isExplored = visibility?.exploredTiles.has(tileKey) ?? false;

    return {
      isExplored,
      isVisible,
      lastSeen: visibility?.lastSeenByTile.get(tileKey),
    };
  }

  /**
   * Get filtered map data that only includes tiles the player can see
   */
  public getPlayerMapView(playerId: string) {
    const mapData = this.mapManager.getMapData();
    if (!mapData) return null;

    const visibleTiles = this.getVisibleTiles(playerId);
    const exploredTiles = this.getExploredTiles(playerId);

    // Filter tiles based on what player can see
    const filteredTiles: any[][] = [];
    for (let x = 0; x < mapData.width; x++) {
      filteredTiles[x] = [];
      for (let y = 0; y < mapData.height; y++) {
        const tile = mapData.tiles[x][y]; // tiles array is [x][y] (column-major)
        const tileKey = `${x},${y}`;
        const isVisible = visibleTiles.has(tileKey);
        const isExplored = exploredTiles.has(tileKey);

        if (!isExplored) {
          // Completely unknown tile
          filteredTiles[x][y] = {
            x,
            y,
            terrain: 'unknown',
            isVisible: false,
            isExplored: false,
          };
        } else if (!isVisible) {
          // Previously explored but not currently visible (fog of war)
          filteredTiles[x][y] = {
            ...(this.playerVisibility.get(playerId)?.rememberedTiles.get(tileKey) ?? {
              x,
              y,
              terrain: tile.terrain,
            }),
            isVisible: false,
            isExplored: true,
          };
        } else {
          // Currently visible
          filteredTiles[x][y] = {
            ...tile,
            isVisible: true,
            isExplored: true,
          };
        }
      }
    }

    return {
      ...mapData,
      tiles: filteredTiles,
    };
  }

  private rememberTile(tile: MapTile): RememberedTile {
    return {
      x: tile.x,
      y: tile.y,
      terrain: tile.terrain,
      resource: tile.resource,
      elevation: tile.elevation,
      riverMask: tile.riverMask,
      hasRoad: tile.hasRoad,
      hasRailroad: tile.hasRailroad,
      improvements: [...tile.improvements],
      cityId: tile.cityId,
      owner: tile.owner,
      claimer: tile.claimer,
      continentId: tile.continentId,
    };
  }

  /**
   * Update visibility for all players (called after unit movement)
   */
  public updateAllPlayersVisibility(playerIds: string[]): void {
    for (const playerId of playerIds) {
      this.updatePlayerVisibility(playerId);
    }
  }

  /**
   * Handle when a unit moves (update visibility)
   */
  public onUnitMoved(playerId: string): void {
    this.updatePlayerVisibility(playerId);
  }

  /**
   * Handle when a unit is created (update visibility)
   */
  public onUnitCreated(playerId: string): void {
    this.updatePlayerVisibility(playerId);
  }

  /**
   * Handle when a unit is destroyed (update visibility)
   */
  public onUnitDestroyed(playerId: string): void {
    this.updatePlayerVisibility(playerId);
  }

  /**
   * Get all visibility data for debugging
   */
  public getDebugInfo(): any {
    const playerData: any = {};

    for (const [playerId, visibility] of this.playerVisibility) {
      playerData[playerId] = {
        visibleTileCount: visibility.visibleTiles.size,
        exploredTileCount: visibility.exploredTiles.size,
        lastUpdated: visibility.lastUpdated,
      };
    }

    return {
      gameId: this.gameId,
      players: playerData,
    };
  }

  /**
   * Clear all visibility data (for game cleanup)
   */
  public cleanup(): void {
    this.playerVisibility.clear();
    logger.debug(`Visibility manager cleaned up for game ${this.gameId}`);
  }
}
