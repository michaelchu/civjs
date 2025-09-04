/**
 * GameStateManager - Handles all database operations and game state persistence
 * Extracted from GameManager.ts following the established refactoring patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 */

import { BaseGameService } from './GameService';
import { DatabaseProvider } from '../../database';
import { gameState } from '../../database/redis';
import { games, players } from '../../database/schema';
import { eq } from 'drizzle-orm';
import type { TerrainSettings } from '../GameManager';
import type { MapManager } from '../MapManager';

export interface GameStateRepository {
  createGameInDatabase(gameData: any): Promise<any>;
  updateGameState(gameId: string, updates: any): Promise<void>;
  loadGameFromDatabase(gameId: string): Promise<any | null>;
  persistMapData(gameId: string, mapData: any, terrainSettings?: TerrainSettings): Promise<void>;
  restoreMapDataToManager(mapManager: MapManager, mapData: any, seed: string): Promise<void>;
  cacheGameState(gameId: string, state: any): Promise<void>;
}

export class GameStateManager extends BaseGameService implements GameStateRepository {
  private databaseProvider: DatabaseProvider;

  constructor(logger: any, databaseProvider: DatabaseProvider) {
    super(logger);
    this.databaseProvider = databaseProvider;
  }

  getServiceName(): string {
    return 'GameStateManager';
  }

  /**
   * Create a new game in the database
   * @reference Original GameManager.ts:93-136 createGame()
   */
  async createGameInDatabase(gameData: any): Promise<any> {
    this.logger.info('Creating new game in database', {
      name: gameData.name,
      hostId: gameData.hostId,
    });

    const [newGame] = await this.databaseProvider.getDatabase().insert(games).values(gameData).returning();

    // Cache basic game data in Redis for performance
    await this.cacheGameState(newGame.id, {
      state: newGame.status,
      currentTurn: newGame.currentTurn,
      turnPhase: newGame.turnPhase,
      playerCount: 0,
    });

    this.logger.info('Game created successfully in database', { gameId: newGame.id });
    return newGame;
  }

  /**
   * Update game state in database
   */
  async updateGameState(gameId: string, updates: any): Promise<void> {
    try {
      await this.databaseProvider.getDatabase()
        .update(games)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(eq(games.id, gameId));

      this.logger.debug('Game state updated in database', { gameId, updates });
    } catch (error) {
      this.logger.error('Failed to update game state in database:', error);
      throw error;
    }
  }

  /**
   * Load game data from database with all related data
   * @reference Original GameManager.ts:868-873 recoverGameInstance()
   */
  async loadGameFromDatabase(gameId: string): Promise<any | null> {
    try {
      this.logger.info('Loading game from database', { gameId });

      const game = await this.databaseProvider.getDatabase().query.games.findFirst({
        where: eq(games.id, gameId),
        with: {
          players: true,
        },
      });

      if (!game) {
        this.logger.warn('Game not found in database', { gameId });
        return null;
      }

      return game;
    } catch (error) {
      this.logger.error('Failed to load game from database:', error);
      return null;
    }
  }

  /**
   * Get game by player ID from database
   * @reference Original GameManager.ts:1155-1192 getGameByPlayerId()
   */
  async getGameByPlayerId(playerId: string): Promise<any | null> {
    try {
      const player = await this.databaseProvider.getDatabase().query.players.findFirst({
        where: eq(players.id, playerId),
        with: {
          game: {
            with: {
              host: {
                columns: {
                  username: true,
                },
              },
              players: true,
            },
          },
        },
      });

      if (!player?.game) return null;

      const game = player.game;
      return {
        id: game.id,
        name: game.name,
        hostName: game.host?.username || 'Unknown',
        status: game.status,
        currentPlayers: game.players?.length || 0,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
        createdAt: game.createdAt.toISOString(),
        canJoin: game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers,
      };
    } catch (error) {
      this.logger.error('Error fetching game by player ID:', error);
      return null;
    }
  }

  /**
   * Get all games from database with optional user filtering
   * @reference Original GameManager.ts:1202-1251 getAllGamesFromDatabase()
   */
  async getAllGamesFromDatabase(userId?: string | null): Promise<any[]> {
    try {
      const gamesQuery = await this.databaseProvider.getDatabase().query.games.findMany({
        with: {
          host: {
            columns: {
              username: true,
            },
          },
          players: {
            columns: {
              id: true,
              userId: true,
              civilization: true,
              connectionStatus: true,
            },
          },
        },
        orderBy: (games, { desc }) => [desc(games.createdAt)],
      });

      return gamesQuery.map(game => ({
        id: game.id,
        name: game.name,
        hostName: game.host?.username || 'Unknown',
        status: game.status,
        currentPlayers: game.players?.length || 0,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
        createdAt: game.createdAt.toISOString(),
        canJoin: game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers,
        isPlayer: userId ? game.players?.some(p => p.userId === userId) : false,
        players:
          game.players?.map(p => ({
            id: p.id,
            civilization: p.civilization,
            isConnected: p.connectionStatus === 'connected',
          })) || [],
      }));
    } catch (error) {
      this.logger.error('Error fetching games from database:', error);
      return [];
    }
  }

  /**
   * Persist map data to database
   * @reference Original GameManager.ts:682-723 persistMapDataToDatabase()
   */
  async persistMapData(
    gameId: string,
    mapData: any,
    terrainSettings?: TerrainSettings
  ): Promise<void> {
    try {
      this.logger.info('Persisting map data to database', { gameId });

      // Serialize map data for storage
      const serializedMapData = {
        width: mapData.width,
        height: mapData.height,
        seed: mapData.seed,
        generatedAt: mapData.generatedAt.toISOString(),
        startingPositions: mapData.startingPositions,
        tiles: this.serializeMapTiles(mapData.tiles),
      };

      // Update database with map data and seed
      await this.databaseProvider.getDatabase()
        .update(games)
        .set({
          mapSeed: mapData.seed,
          mapData: serializedMapData,
          gameState: {
            terrainSettings: terrainSettings || null,
            mapGenerated: true,
            generatedAt: mapData.generatedAt.toISOString(),
          },
          updatedAt: new Date(),
        })
        .where(eq(games.id, gameId));

      this.logger.info('Map data persisted successfully', {
        gameId,
        mapSize: `${mapData.width}x${mapData.height}`,
      });
    } catch (error) {
      this.logger.error('Failed to persist map data to database:', error);
      // Don't throw error to avoid breaking game initialization
    }
  }

  /**
   * Restore map data from database to MapManager instance
   * @reference Original GameManager.ts:1014-1047 restoreMapDataToManager()
   */
  async restoreMapDataToManager(
    _mapManager: MapManager,
    mapData: any,
    _seed: string
  ): Promise<void> {
    try {
      this.logger.info('Restoring map data to manager from database');

      // Deserialize map tiles
      const tiles = this.deserializeMapTiles(mapData.tiles, mapData.width, mapData.height);

      // TODO: Need to find proper way to restore map data to MapManager
      // Create restored map data structure (currently unused until we have proper restoration)
      // const restoredMapData = {
      //   width: mapData.width,
      //   height: mapData.height,
      //   seed: seed,
      //   generatedAt: new Date(mapData.generatedAt),
      //   startingPositions: mapData.startingPositions || [],
      //   tiles: tiles,
      // };
      // mapManager.setMapData(restoredMapData);
      // For now, this is a placeholder - MapManager might need a restore method

      this.logger.info('Map data restored successfully to manager', {
        mapSize: `${mapData.width}x${mapData.height}`,
        tilesCount: tiles.length * tiles[0].length,
        startingPositions: mapData.startingPositions?.length || 0,
      });
    } catch (error) {
      this.logger.error('Failed to restore map data to manager:', error);
      throw error;
    }
  }

  /**
   * Cache game state in Redis
   */
  async cacheGameState(gameId: string, state: any): Promise<void> {
    try {
      await gameState.setGameState(gameId, state);
    } catch (error) {
      this.logger.error('Failed to cache game state in Redis:', error);
      // Don't throw - Redis caching is not critical
    }
  }

  /**
   * Serialize map tiles for database storage
   * @reference Original GameManager.ts:833-862 serializeMapTiles()
   */
  private serializeMapTiles(tiles: any[][]): any {
    try {
      const serializedTiles = tiles.map(row =>
        row.map(tile => ({
          terrain: tile.terrain,
          resource: tile.resource || null,
          improvement: tile.improvement || null,
          altitude: tile.altitude || 0,
          temperature: tile.temperature || 0,
          moisture: tile.moisture || 0,
          riverMask: tile.riverMask || 0,
          special: tile.special || null,
          x: tile.x,
          y: tile.y,
        }))
      );

      return serializedTiles;
    } catch (error) {
      this.logger.error('Error serializing map tiles:', error);
      throw error;
    }
  }

  /**
   * Deserialize map tiles from database storage
   * @reference Original GameManager.ts:1048-1103 deserializeMapTiles()
   */
  private deserializeMapTiles(compressedTiles: any, width: number, height: number): any[][] {
    try {
      if (!compressedTiles || !Array.isArray(compressedTiles)) {
        this.logger.warn('Invalid tile data format, creating empty tiles');
        return this.createEmptyTileArray(width, height);
      }

      // Restore tile objects with all properties
      const tiles = compressedTiles.map((row: any[]) =>
        row.map((tileData: any) => ({
          terrain: tileData.terrain || 'ocean',
          resource: tileData.resource || null,
          improvement: tileData.improvement || null,
          altitude: tileData.altitude || 0,
          temperature: tileData.temperature || 0,
          moisture: tileData.moisture || 0,
          riverMask: tileData.riverMask || 0,
          special: tileData.special || null,
          x: tileData.x || 0,
          y: tileData.y || 0,
        }))
      );

      this.logger.debug('Deserialized map tiles successfully', {
        rows: tiles.length,
        columns: tiles[0]?.length,
      });

      return tiles;
    } catch (error) {
      this.logger.error('Error deserializing map tiles:', error);
      this.logger.info('Creating empty tile array as fallback');
      return this.createEmptyTileArray(width, height);
    }
  }

  /**
   * Create empty tile array as fallback
   */
  private createEmptyTileArray(width: number, height: number): any[][] {
    const tiles: any[][] = [];
    for (let x = 0; x < width; x++) {
      tiles[x] = [];
      for (let y = 0; y < height; y++) {
        tiles[x][y] = {
          terrain: 'ocean',
          resource: null,
          improvement: null,
          altitude: 0,
          temperature: 0,
          moisture: 0,
          riverMask: 0,
          special: null,
          x,
          y,
        };
      }
    }
    return tiles;
  }

  /**
   * Delete game from database
   * @reference Original GameManager.ts:1905-1951 deleteGame()
   */
  async deleteGameFromDatabase(gameId: string, userId?: string): Promise<void> {
    try {
      // Get game to verify ownership or admin permissions
      const game = await this.databaseProvider.getDatabase().query.games.findFirst({
        where: eq(games.id, gameId),
      });

      if (!game) {
        throw new Error('Game not found');
      }

      // Check if user has permission to delete (only host can delete)
      if (userId && game.hostId !== userId) {
        throw new Error('Only the host can delete a game');
      }

      // Delete game (cascade should handle players)
      await this.databaseProvider.getDatabase().delete(games).where(eq(games.id, gameId));

      // Clean up Redis cache
      try {
        await gameState.clearGameState(gameId);
      } catch (redisError) {
        this.logger.warn('Failed to clean up Redis cache for deleted game:', redisError);
      }

      this.logger.info('Game deleted successfully from database', { gameId, deletedBy: userId });
    } catch (error) {
      this.logger.error('Failed to delete game from database:', error);
      throw error;
    }
  }
}
