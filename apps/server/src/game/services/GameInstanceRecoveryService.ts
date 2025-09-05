import { eq } from 'drizzle-orm';
import { DatabaseProvider } from '@database';
import { games } from '@database/schema';
import { GameInstance, PlayerState, TurnPhase, GameState } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';
import { CityManager } from '@game/managers/CityManager';
import { MapManager } from '@game/managers/MapManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { ResearchManager } from '@game/managers/ResearchManager';
import { TurnManager } from '@game/managers/TurnManager';
import { UnitManager } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';
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

      const game = await this.fetchGameRecord(gameId);
      if (!game) return null;

      logger.info('Recovering game instance with map data', {
        gameId,
        playerCount: game.players.length,
        mapSize: `${game.mapWidth}x${game.mapHeight}`,
      });

      const players = this.buildPlayersMap(game, gameId);

      const mapManager = await this.createAndRestoreMapManager(game);

      const managers = await this.createManagers(gameId, game, mapManager, players);

      const gameInstance = this.buildRecoveredGameInstance(gameId, game, players, managers);

      this.games.set(gameId, gameInstance);

      await this.loadDataIntoManagers(managers);

      await this.initializeResearchAndVisibility(
        players,
        managers.researchManager,
        managers.visibilityManager
      );

      logger.info('Game instance recovered successfully', { gameId });
      return gameInstance;
    } catch (error) {
      logger.error('Failed to recover game instance:', error);
      return null;
    }
  }

  private async fetchGameRecord(gameId: string): Promise<any | null> {
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    if (!game || game.status !== 'active') {
      logger.warn('Game not found or not active, cannot recover', {
        gameId,
        found: !!game,
        status: game?.status,
      });
      return null;
    }

    if (!game.mapData || !game.mapSeed) {
      logger.warn('No map data found in database, cannot recover game instance', { gameId });
      return null;
    }
    return game;
  }

  private buildPlayersMap(game: any, gameId: string): Map<string, PlayerState> {
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
      this.playerToGame.set(dbPlayer.id, gameId);
    }
    return players;
  }

  private async createAndRestoreMapManager(game: any): Promise<MapManager> {
    const storedTerrainSettings = (game.gameState as any)?.terrainSettings;
    const temperatureParam = storedTerrainSettings?.temperature ?? 50;
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
    return mapManager;
  }

  private async createManagers(
    gameId: string,
    game: any,
    mapManager: MapManager,
    players: Map<string, PlayerState>
  ): Promise<{
    turnManager: TurnManager;
    unitManager: UnitManager;
    cityManager: CityManager;
    researchManager: ResearchManager;
    pathfindingManager: PathfindingManager;
    visibilityManager: VisibilityManager;
  }> {
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
        broadcastUnitMoved: (gid, unitId, x, y, movementLeft) => {
          this.broadcastToGame(gid, 'unit_moved', { gameId: gid, unitId, x, y, movementLeft });
        },
        getCityAt: (x: number, y: number) => {
          const city = cityManager.getCityAt(x, y);
          return city ? { playerId: city.playerId } : null;
        },
      }
    );

    const playerIds = Array.from(players.keys());
    await turnManager.initializeTurn(playerIds);

    const cityManager = new CityManager(gameId, this.databaseProvider, undefined, {
      createUnit: (playerId: string, unitType: string, x: number, y: number) =>
        this.createUnit(gameId, playerId, unitType, x, y),
    });
    const researchManager = new ResearchManager(gameId, this.databaseProvider);
    const pathfindingManager = new PathfindingManager(game.mapWidth, game.mapHeight, mapManager);
    const visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);

    return {
      turnManager,
      unitManager,
      cityManager,
      researchManager,
      pathfindingManager,
      visibilityManager,
    };
  }

  private buildRecoveredGameInstance(
    gameId: string,
    game: any,
    players: Map<string, PlayerState>,
    managers: {
      turnManager: TurnManager;
      unitManager: UnitManager;
      cityManager: CityManager;
      researchManager: ResearchManager;
      pathfindingManager: PathfindingManager;
      visibilityManager: VisibilityManager;
    }
  ): GameInstance {
    return {
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
      state: game.status as GameState,
      currentTurn: game.currentTurn,
      turnPhase: game.turnPhase as TurnPhase,
      players,
      turnManager: managers.turnManager,
      mapManager:
        (managers.unitManager as any).mapManager ||
        (managers as any).mapManager ||
        managers.turnManager, // placeholder, mapManager is referenced separately
      unitManager: managers.unitManager,
      visibilityManager: managers.visibilityManager,
      cityManager: managers.cityManager,
      researchManager: managers.researchManager,
      pathfindingManager: managers.pathfindingManager,
      lastActivity: new Date(),
    } as unknown as GameInstance;
  }

  private async loadDataIntoManagers(managers: {
    cityManager: CityManager;
    unitManager: UnitManager;
  }): Promise<void> {
    await managers.cityManager.loadCities();
    await managers.unitManager.loadUnits();
  }

  private async initializeResearchAndVisibility(
    players: Map<string, PlayerState>,
    researchManager: ResearchManager,
    visibilityManager: VisibilityManager
  ): Promise<void> {
    for (const player of players.values()) {
      await researchManager.initializePlayerResearch(player.id);
      visibilityManager.initializePlayerVisibility(player.id);
      visibilityManager.updatePlayerVisibility(player.id);
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
        tiles[x][y] = this.createDefaultTile(x, y);
      }
    }

    // Restore non-ocean tiles from compressed storage
    if (compressedTiles) {
      for (const [key, tileData] of Object.entries(compressedTiles)) {
        const [x, y] = key.split(',').map(Number);
        if (this.isValidTileKey(x, y, width, height, tileData)) {
          tiles[x][y] = this.applyTileData(tiles[x][y], tileData as any);
        }
      }
    }

    return tiles;
  }

  private createDefaultTile(x: number, y: number): any {
    return {
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

  private isValidTileKey(
    x: number,
    y: number,
    width: number,
    height: number,
    tileData: unknown
  ): boolean {
    return this.isWithinBounds(x, y, width, height) && !!tileData && typeof tileData === 'object';
  }

  private isWithinBounds(x: number, y: number, width: number, height: number): boolean {
    return x >= 0 && x < width && y >= 0 && y < height;
  }

  private applyTileData(baseTile: any, tileData: any): any {
    return {
      ...baseTile, // Keep default values
      ...tileData, // Override with stored data
    };
  }
}
