import { GameInstance } from '../GameManager';
import { BaseGameService } from './GameService';
import { logger } from '../../utils/logger';

/**
 * VisibilityMapService - Extracted visibility and map operations from GameManager
 * @reference docs/refactor/REFACTORING_PLAN.md - Phase 1 GameManager refactoring
 *
 * Handles all visibility and map-related operations including:
 * - Player visibility management and updates
 * - Tile visibility queries and map view access
 * - Player visible tiles computation
 * - Map data access and coordination
 */
export class VisibilityMapService extends BaseGameService {
  constructor(private games: Map<string, GameInstance>) {
    super(logger);
  }

  getServiceName(): string {
    return 'VisibilityMapService';
  }

  /**
   * Get a player's map view with visibility information
   * @reference Original GameManager.getPlayerMapView()
   */
  public getPlayerMapView(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.visibilityManager.getPlayerMapView(playerId);
  }

  /**
   * Get visibility status for a specific tile
   * @reference Original GameManager.getTileVisibility()
   */
  public getTileVisibility(gameId: string, playerId: string, x: number, y: number) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.visibilityManager.getTileVisibility(playerId, x, y);
  }

  /**
   * Update a player's visibility based on their units and cities
   * @reference Original GameManager.updatePlayerVisibility()
   */
  public updatePlayerVisibility(gameId: string, playerId: string): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
  }

  /**
   * Get basic map data information (dimensions, starting positions, etc.)
   * @reference Original GameManager.getMapData()
   */
  public getMapData(gameId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found in memory - the game may need to be restarted');
    }

    const mapData = gameInstance.mapManager.getMapData();
    if (!mapData) {
      throw new Error('Map not generated yet');
    }

    return {
      width: mapData.width,
      height: mapData.height,
      startingPositions: mapData.startingPositions,
      seed: mapData.seed,
      generatedAt: mapData.generatedAt,
    };
  }

  /**
   * Get tiles visible to a player (typically around starting position initially)
   * @reference Original GameManager.getPlayerVisibleTiles()
   */
  public getPlayerVisibleTiles(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Get player's starting position if they don't have units yet
    const mapData = gameInstance.mapManager.getMapData();
    const startPos = mapData?.startingPositions.find(pos => pos.playerId === playerId);

    if (!startPos) {
      throw new Error('Player starting position not found');
    }

    const visibleTiles = gameInstance.mapManager.getVisibleTiles(
      startPos.x,
      startPos.y,
      2 // Initial sight radius
    );

    return visibleTiles.map(tile => ({
      x: tile.x,
      y: tile.y,
      terrain: tile.terrain,
      resource: tile.resource,
      elevation: tile.elevation,
      riverMask: tile.riverMask,
      continentId: tile.continentId,
      isExplored: true,
      isVisible: true,
      hasRoad: tile.hasRoad,
      hasRailroad: tile.hasRailroad,
      improvements: tile.improvements,
      cityId: tile.cityId,
      unitIds: tile.unitIds,
    }));
  }
}
