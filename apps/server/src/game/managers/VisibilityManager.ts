import { logger } from '@utils/logger';
import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { MapManager } from '@game/managers/MapManager';

export interface PlayerVisibility {
  playerId: string;
  exploredTiles: Set<string>; // tiles that have been seen before
  visibleTiles: Set<string>; // tiles currently visible
  lastUpdated: Date;
}

export interface TileVisibility {
  isExplored: boolean; // has been seen before
  isVisible: boolean; // currently visible
  lastSeen?: Date; // when was it last seen
}

export class VisibilityManager {
  private gameId: string;
  private playerVisibility: Map<string, PlayerVisibility> = new Map();
  private unitManager: UnitManager;
  private mapManager: MapManager;

  constructor(gameId: string, unitManager: UnitManager, mapManager: MapManager) {
    this.gameId = gameId;
    this.unitManager = unitManager;
    this.mapManager = mapManager;
  }

  /**
   * Initialize visibility for a new player
   */
  public initializePlayerVisibility(playerId: string): void {
    const visibility: PlayerVisibility = {
      playerId,
      exploredTiles: new Set(),
      visibleTiles: new Set(),
      lastUpdated: new Date(),
    };

    this.playerVisibility.set(playerId, visibility);
    logger.debug(`Initialized visibility for player ${playerId}`);
  }

  /**
   * Update visibility for a player based on their units
   */
  public updatePlayerVisibility(playerId: string): void {
    const visibility = this.playerVisibility.get(playerId);
    if (!visibility) {
      this.initializePlayerVisibility(playerId);
      return;
    }

    // Clear current visibility
    visibility.visibleTiles.clear();

    // Get all player units
    const playerUnits = this.unitManager.getPlayerUnits(playerId);

    // Calculate visibility from each unit
    for (const unit of playerUnits) {
      const unitType = UNIT_TYPES[unit.unitTypeId];
      if (!unitType) continue;

      const visibleTiles = this.calculateTileVisibility(unit.x, unit.y, unitType.sight);

      for (const tileKey of visibleTiles) {
        visibility.visibleTiles.add(tileKey);
        visibility.exploredTiles.add(tileKey);
      }
    }

    visibility.lastUpdated = new Date();
    logger.debug(
      `Updated visibility for player ${playerId}: ${visibility.visibleTiles.size} visible, ${visibility.exploredTiles.size} explored`
    );
  }

  /**
   * Calculate which tiles are visible from a position
   */
  private calculateTileVisibility(
    centerX: number,
    centerY: number,
    sightRange: number
  ): Set<string> {
    const visibleTiles = new Set<string>();
    const mapData = this.mapManager.getMapData();
    if (!mapData) return visibleTiles;

    // Simple circular sight range (could be enhanced with line-of-sight later)
    for (let x = centerX - sightRange; x <= centerX + sightRange; x++) {
      for (let y = centerY - sightRange; y <= centerY + sightRange; y++) {
        // Check bounds manually since isValidCoord is private
        if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) continue;

        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distance <= sightRange) {
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
    const isVisible = this.isTileVisible(playerId, x, y);
    const isExplored = this.isTileExplored(playerId, x, y);

    return {
      isExplored,
      isVisible,
      lastSeen: isExplored ? new Date() : undefined, // simplified for now
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
            x,
            y,
            terrain: tile.terrain,
            isVisible: false,
            isExplored: true,
            // Don't show current units or dynamic info
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
