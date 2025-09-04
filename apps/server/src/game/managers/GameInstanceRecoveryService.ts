import { eq } from 'drizzle-orm';
import { DatabaseProvider } from '../../database';
import { games } from '../../database/schema';
import { GameInstance, PlayerState, TurnPhase } from '../GameManager';
import { BaseGameService } from './GameService';
import { logger } from '../../utils/logger';
import { CityManager } from '../CityManager';
import { MapManager } from '../MapManager';
import { PathfindingManager } from '../PathfindingManager';
import { ResearchManager } from '../ResearchManager';
import { TurnManager } from '../TurnManager';
import { UnitManager } from '../UnitManager';
import { VisibilityManager } from '../VisibilityManager';
import { Server as SocketServer } from 'socket.io';

/**
 * GameInstanceRecoveryService - Extracted game recovery operations from GameManager
 * @reference docs/refactor/REFACTORING_PLAN.md - Phase 1 GameManager refactoring
 *
 * Handles all game instance recovery and restoration including:
 * - Game instance recovery from database
 * - Map data restoration and deserialization
 * - Manager initialization and state restoration
 * - Database-to-memory synchronization
 */
export class GameInstanceRecoveryService extends BaseGameService {
  constructor(
    private databaseProvider: DatabaseProvider,
    private games: Map<string, GameInstance>,
    private playerToGame: Map<string, string>,
    private io: SocketServer,
    private foundCity: (
      gameId: string,
      playerId: string,
      name: string,
      x: number,
      y: number
    ) => Promise<string>,
    private requestPath: (
      playerId: string,
      unitId: string,
      targetX: number,
      targetY: number
    ) => Promise<any>,
    private createUnit: (
      gameId: string,
      playerId: string,
      unitType: string,
      x: number,
      y: number
    ) => Promise<string>,
    private broadcastToGame: (gameId: string, event: string, data: any) => void
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'GameInstanceRecoveryService';
  }

  /**
   * Recover a game instance from database storage
   * @reference Original GameManager.recoverGameInstance()
   */
  public async recoverGameInstance(gameId: string): Promise<GameInstance | null> {
    try {
      logger.info('Attempting to recover game instance from database', { gameId });

      // Get game from database with all related data
      const game = await this.databaseProvider.getDatabase().query.games.findFirst({
        where: eq(games.id, gameId),
        with: {
          players: true,
        },
      });

      if (!game || game.status !== 'active') {
        logger.warn('Game not found or not active, cannot recover', {
          gameId,
          found: !!game,
          status: game?.status,
        });
        return null;
      }

      // Check if map data exists in database
      if (!game.mapData || !game.mapSeed) {
        logger.warn('No map data found in database, cannot recover game instance', { gameId });
        return null;
      }

      logger.info('Recovering game instance with map data', {
        gameId,
        playerCount: game.players.length,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
      });

      // Reconstruct player state map
      const players = new Map<string, PlayerState>();
      for (const dbPlayer of game.players) {
        players.set(dbPlayer.id, {
          id: dbPlayer.id,
          userId: dbPlayer.userId,
          playerNumber: dbPlayer.playerNumber,
          civilization: dbPlayer.civilization,
          isReady: dbPlayer.isReady || false,
          hasEndedTurn: dbPlayer.hasEndedTurn || false,
          isConnected: dbPlayer.connectionStatus === 'connected',
          lastSeen: new Date(),
        });

        // Track player to game mapping
        this.playerToGame.set(dbPlayer.id, gameId);
      }

      // Extract terrain settings from stored game state
      const storedTerrainSettings = (game.gameState as any)?.terrainSettings;
      const temperatureParam = storedTerrainSettings?.temperature ?? 50;

      // Create MapManager and restore map data from database
      const mapManager = new MapManager(
        game.mapWidth,
        game.mapHeight,
        undefined,
        'recovered',
        undefined,
        undefined,
        false,
        temperatureParam
      );
      await this.restoreMapDataToManager(mapManager, game.mapData as any, game.mapSeed!);

      // Initialize managers (now that mapManager is available)
      const turnManager = new TurnManager(gameId, this.databaseProvider, this.io);
      const unitManager = new UnitManager(
        gameId,
        this.databaseProvider,
        game.mapWidth,
        game.mapHeight,
        mapManager,
        {
          foundCity: this.foundCity.bind(this),
          requestPath: this.requestPath.bind(this),
          broadcastUnitMoved: (gameId, unitId, x, y, movementLeft) => {
            this.broadcastToGame(gameId, 'unit_moved', { gameId, unitId, x, y, movementLeft });
          },
          getCityAt: (x: number, y: number) => {
            const city = cityManager.getCityAt(x, y);
            return city ? { playerId: city.playerId } : null;
          },
        }
      );

      // Initialize turn system with existing player IDs
      const playerIds = Array.from(players.keys());
      await turnManager.initializeTurn(playerIds);
      const cityManager = new CityManager(gameId, this.databaseProvider, undefined, {
        createUnit: (playerId: string, unitType: string, x: number, y: number) =>
          this.createUnit(gameId, playerId, unitType, x, y),
      });
      const researchManager = new ResearchManager(gameId, this.databaseProvider);
      const pathfindingManager = new PathfindingManager(game.mapWidth, game.mapHeight, mapManager);

      const visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);

      // Create recovered game instance
      const gameInstance: GameInstance = {
        id: gameId,
        config: {
          name: game.name,
          hostId: game.hostId,
          maxPlayers: game.maxPlayers,
          mapWidth: game.mapWidth,
          mapHeight: game.mapHeight,
          ruleset: game.ruleset || 'classic',
          turnTimeLimit: game.turnTimeLimit || undefined,
          victoryConditions: (game.victoryConditions as string[]) || [
            'conquest',
            'science',
            'culture',
          ],
        },
        state: 'active',
        currentTurn: game.currentTurn,
        turnPhase: game.turnPhase as TurnPhase,
        players,
        turnManager,
        mapManager,
        unitManager,
        visibilityManager,
        cityManager,
        researchManager,
        pathfindingManager,
        lastActivity: new Date(),
      };

      // Store the recovered game instance
      this.games.set(gameId, gameInstance);

      // Load data from database into managers
      await cityManager.loadCities();
      await unitManager.loadUnits();

      // Initialize research and visibility for all players
      for (const player of players.values()) {
        await researchManager.initializePlayerResearch(player.id);
        visibilityManager.initializePlayerVisibility(player.id);
        // Grant initial visibility around starting position
        visibilityManager.updatePlayerVisibility(player.id);
      }

      logger.info('Game instance recovered successfully', { gameId });
      return gameInstance;
    } catch (error) {
      logger.error('Failed to recover game instance:', error);
      return null;
    }
  }

  /**
   * Load a game from database into memory for testing purposes
   * @reference Original GameManager.loadGame()
   */
  public async loadGame(gameId: string): Promise<GameInstance | null> {
    // Check if game is already loaded
    const existingInstance = this.games.get(gameId);
    if (existingInstance) {
      return existingInstance;
    }

    // Try to recover from database
    return await this.recoverGameInstance(gameId);
  }

  /**
   * Restore map data from database to MapManager
   * @reference Original GameManager.restoreMapDataToManager()
   */
  private async restoreMapDataToManager(
    mapManager: MapManager,
    mapData: any,
    mapSeed: string
  ): Promise<void> {
    try {
      // Reconstruct full MapData from serialized database storage
      const restoredMapData = {
        width: mapData.width,
        height: mapData.height,
        seed: mapSeed,
        generatedAt: new Date(mapData.generatedAt),
        startingPositions: mapData.startingPositions || [],
        tiles: this.deserializeMapTiles(mapData.tiles, mapData.width, mapData.height),
      };

      // Set the restored map data directly in MapManager
      // This bypasses generation and uses the stored data
      (mapManager as any).mapData = restoredMapData;

      logger.info('Map data restored to manager', {
        width: restoredMapData.width,
        height: restoredMapData.height,
        startingPositions: restoredMapData.startingPositions.length,
      });
    } catch (error) {
      logger.error('Failed to restore map data to manager:', error);
      throw error;
    }
  }

  /**
   * Deserialize compressed map tiles from database storage
   * @reference Original GameManager.deserializeMapTiles()
   */
  private deserializeMapTiles(compressedTiles: any, width: number, height: number): any[][] {
    // Create empty tile array filled with ocean tiles - match generation pattern [x][y]
    const tiles: any[][] = [];

    for (let x = 0; x < width; x++) {
      tiles[x] = [];
      for (let y = 0; y < height; y++) {
        // Default ocean tile
        tiles[x][y] = {
          x,
          y,
          terrain: 'ocean',
          elevation: 0,
          riverMask: 0,
          continentId: 0,
          isExplored: false,
          isVisible: false,
          hasRoad: false,
          hasRailroad: false,
          improvements: [],
          unitIds: [],
          properties: {},
          temperature: 4, // TEMPERATE
          wetness: 50,
        };
      }
    }

    // Restore non-ocean tiles from compressed storage
    if (compressedTiles) {
      for (const [key, tileData] of Object.entries(compressedTiles)) {
        const [x, y] = key.split(',').map(Number);
        if (
          x >= 0 &&
          x < width &&
          y >= 0 &&
          y < height &&
          tileData &&
          typeof tileData === 'object'
        ) {
          tiles[x][y] = {
            ...tiles[x][y], // Keep default values
            ...(tileData as any), // Override with stored data
          };
        }
      }
    }

    return tiles;
  }
}
