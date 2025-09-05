/**
 * GameLifecycleManager - Handles game creation, initialization, starting, and cleanup
 * Extracted from GameManager.ts following the established refactoring patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 */

import { BaseGameService } from './GameService';
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { games } from '@database/schema';
import { eq } from 'drizzle-orm';
import serverConfig from '@config';
import { TurnManager } from '@game/managers/TurnManager';
import { MapManager, MapGeneratorType } from '@game/managers/MapManager';
import { UnitManager } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';
import { CityManager } from '@game/managers/CityManager';
import { ResearchManager } from '@game/managers/ResearchManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { MapStartpos } from '@game/map/MapTypes';
import type { Server as SocketServer } from 'socket.io';
import type {
  GameConfig,
  GameInstance,
  PlayerState,
  TerrainSettings,
} from '@game/managers/GameManager';

export interface GameLifecycleService {
  createGame(gameConfig: GameConfig): Promise<string>;
  startGame(gameId: string, hostId: string): Promise<void>;
  deleteGame(gameId: string, userId?: string): Promise<void>;
  cleanupInactiveGames(): Promise<void>;
  initializeGameInstance(
    gameId: string,
    game: any,
    terrainSettings?: TerrainSettings
  ): Promise<GameInstance>;
}

export class GameLifecycleManager extends BaseGameService implements GameLifecycleService {
  private io: SocketServer;
  private databaseProvider: DatabaseProvider;
  private games: Map<string, GameInstance>;
  private onBroadcast?: (gameId: string, event: string, data: any) => void;
  private onPersistMapData?: (
    gameId: string,
    mapData: any,
    terrainSettings?: TerrainSettings
  ) => Promise<void>;
  private onCreateStartingUnits?: (
    gameId: string,
    mapData: any,
    unitManager: any,
    players: Map<string, PlayerState>
  ) => Promise<void>;
  private onFoundCity?: (
    gameId: string,
    playerId: string,
    name: string,
    x: number,
    y: number
  ) => Promise<string>;
  // private _onRequestPath - removed, delegating to GameManager instead
  private onBroadcastMapData?: (gameId: string, mapData: any) => void;

  constructor(
    io: SocketServer,
    databaseProvider: DatabaseProvider,
    games: Map<string, GameInstance>,
    onBroadcast?: (gameId: string, event: string, data: any) => void,
    onPersistMapData?: (
      gameId: string,
      mapData: any,
      terrainSettings?: TerrainSettings
    ) => Promise<void>,
    onCreateStartingUnits?: (
      gameId: string,
      mapData: any,
      unitManager: any,
      players: Map<string, PlayerState>
    ) => Promise<void>,
    onFoundCity?: (
      gameId: string,
      playerId: string,
      name: string,
      x: number,
      y: number
    ) => Promise<string>,
    // _onRequestPath removed - delegating to GameManager instead
    onBroadcastMapData?: (gameId: string, mapData: any) => void
  ) {
    super(logger);
    this.io = io;
    this.databaseProvider = databaseProvider;
    this.games = games;
    this.onBroadcast = onBroadcast;
    this.onPersistMapData = onPersistMapData;
    this.onCreateStartingUnits = onCreateStartingUnits;
    this.onFoundCity = onFoundCity;
    // this._onRequestPath removed - delegating to GameManager instead
    this.onBroadcastMapData = onBroadcastMapData;
  }

  getServiceName(): string {
    return 'GameLifecycleManager';
  }

  /**
   * Create a new game with specified configuration
   * @reference Original GameManager.ts:93-136 createGame()
   */
  async createGame(gameConfig: GameConfig): Promise<string> {
    this.logger.info('Creating new game', { name: gameConfig.name, hostId: gameConfig.hostId });

    // Prepare game data for database
    const gameData = {
      name: gameConfig.name,
      hostId: gameConfig.hostId,
      gameType: gameConfig.gameType || 'multiplayer',
      maxPlayers: gameConfig.maxPlayers || 8,
      mapWidth: gameConfig.mapWidth || 80,
      mapHeight: gameConfig.mapHeight || 50,
      ruleset: gameConfig.ruleset || 'classic',
      turnTimeLimit: gameConfig.turnTimeLimit,
      victoryConditions: gameConfig.victoryConditions || ['conquest', 'science', 'culture'],
      gameState: {
        terrainSettings: gameConfig.terrainSettings || {
          generator: 'random',
          landmass: 'normal',
          huts: 15,
          temperature: 50,
          wetness: 50,
          rivers: 50,
          resources: 'normal',
        },
      },
    };

    const [newGame] = await this.databaseProvider
      .getDatabase()
      .insert(games)
      .values(gameData)
      .returning();

    // Cache basic game data in Redis for performance
    await gameState.setGameState(newGame.id, {
      state: newGame.status,
      currentTurn: newGame.currentTurn,
      turnPhase: newGame.turnPhase,
      playerCount: 0,
    });

    this.logger.info('Game created successfully', { gameId: newGame.id });
    return newGame.id;
  }

  /**
   * Start a game after validation and initialization
   * @reference Original GameManager.ts:352-410 startGame()
   */
  async startGame(gameId: string, hostId: string): Promise<void> {
    // Get game from database
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    // Validate start conditions (preserves exact error messages)
    this.validateStartConditions(game, hostId);

    this.logger.info('Starting game', { gameId, playerCount: game.players.length });

    // Update database to active state
    await this.activateGameRecord(gameId);

    // Update Redis cache
    await this.updateRedisForGameStart(gameId, game.players.length);

    // Create a preliminary game instance with players to enable broadcasts during initialization
    const preliminaryPlayers = this.buildPlayersMapFromDb(game.players);

    // Store preliminary instance to enable broadcasts during initialization
    const preliminaryInstance = this.buildPreliminaryInstance(gameId, game, preliminaryPlayers);
    this.games.set(gameId, preliminaryInstance);

    // Initialize the full game instance with map generation
    const storedTerrainSettings = (game.gameState as any)?.terrainSettings;
    const gameInstance = await this.initializeGameInstance(gameId, game, storedTerrainSettings);

    // Replace with the fully initialized instance
    this.games.set(gameId, gameInstance);

    // Broadcast initial map data now that all managers are initialized
    this.onBroadcastMapData?.(gameId, gameInstance.mapManager.getMapData());

    // Notify all players that the game has started
    this.onBroadcast?.(gameId, 'game-started', {
      gameId,
      currentTurn: 1,
    });

    this.logger.info('Game started successfully', { gameId });
  }

  /**
   * Initialize game instance with all managers and map generation
   * @reference Original GameManager.ts:412-604 initializeGameInstance()
   */
  async initializeGameInstance(
    gameId: string,
    game: any,
    terrainSettings?: TerrainSettings
  ): Promise<GameInstance> {
    this.logger.info('Initializing game instance', { gameId });

    // Create player state map
    const players = this.buildPlayersMapFromDb(game.players);

    // Create managers
    const mapManager = this.createMapManager(game, terrainSettings);
    const turnManager = await this.createTurnManagerAndInitialize(gameId, players);
    const cityManager = this.createCityManager(gameId);
    const unitManager = this.createUnitManager(gameId, game, mapManager, cityManager);
    const visibilityManager = this.createVisibilityManager(gameId, unitManager, mapManager);
    const researchManager = this.createResearchManager(gameId);
    const pathfindingManager = this.createPathfindingManager(game, mapManager);

    // Generate the map with starting positions based on terrain settings
    await this.generateGameMap(gameId, mapManager, players, terrainSettings, unitManager);

    // Create game instance
    const gameInstance: GameInstance = this.buildGameInstance(
      gameId,
      game,
      terrainSettings,
      players,
      turnManager,
      mapManager,
      unitManager,
      visibilityManager,
      cityManager,
      researchManager,
      pathfindingManager
    );

    this.logger.info('Game instance initialized successfully', {
      gameId,
      playerCount: players.size,
    });
    return gameInstance;
  }

  /**
   * Delete a game and clean up all associated resources
   * @reference Original GameManager.ts:1905-1950 deleteGame()
   */
  async deleteGame(gameId: string, userId?: string): Promise<void> {
    // Check if game exists
    const game = await this.databaseProvider.getDatabase().query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    this.logger.info('Deleting game', { gameId, userId });

    // Remove from active games map if it exists
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Cleanup managers
      gameInstance.visibilityManager.cleanup();
      gameInstance.cityManager.cleanup();

      // Remove from games map after all cleanup operations are complete
      this.games.delete(gameId);
    }

    // Update database to mark game as ended
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        status: 'ended',
        endedAt: new Date(),
      })
      .where(eq(games.id, gameId));

    // Clear Redis cache
    await gameState.clearGameState(gameId);

    // Notify all players in the game room
    this.io.to(`game:${gameId}`).emit('game_deleted', { gameId });
  }

  /**
   * Clean up inactive games older than threshold
   * @reference Original GameManager.ts:1952-1994 cleanupInactiveGames()
   */
  async cleanupInactiveGames(): Promise<void> {
    const now = new Date();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    const inactiveGames = Array.from(this.games.values()).filter(game => {
      const timeSinceActivity = now.getTime() - game.lastActivity.getTime();
      return timeSinceActivity > inactiveThreshold;
    });

    this.logger.info(`Cleaning up ${inactiveGames.length} inactive games`);

    for (const game of inactiveGames) {
      try {
        await this.deleteGame(game.id);
        this.logger.info('Cleaned up inactive game', { gameId: game.id });
      } catch (error) {
        this.logger.error('Failed to cleanup inactive game:', error);
      }
    }
  }

  /**
   * Get all active game instances
   */
  getActiveGameInstances(): GameInstance[] {
    return Array.from(this.games.values()).filter(game => game.state === 'active');
  }

  /**
   * Get specific game instance
   */
  getGameInstance(gameId: string): GameInstance | null {
    return this.games.get(gameId) || null;
  }

  /**
   * Get all game instances
   */
  getAllGameInstances(): GameInstance[] {
    return Array.from(this.games.values());
  }

  /**
   * Generate map for the game with all required setup
   * @reference Original GameManager.ts:474-604 map generation logic
   */
  private async generateGameMap(
    gameId: string,
    mapManager: MapManager,
    players: Map<string, PlayerState>,
    terrainSettings?: TerrainSettings,
    unitManager?: UnitManager
  ): Promise<void> {
    // Generate the map with starting positions based on terrain settings
    const generator = terrainSettings?.generator || 'random';
    const startpos = terrainSettings?.startpos ?? MapStartpos.DEFAULT;

    this.logger.debug('Map generation starting', { terrainSettings, generator, startpos });

    const generatorType = this.convertGeneratorType(generator);

    const generated = await this.tryGenerate(mapManager, players, generator, generatorType);

    // Emergency fallback sequence (defensive addition, not in freeciv)
    if (!generated || !mapManager.getMapData()) {
      await this.performEmergencyFallback(mapManager, players, generatorType);
    }

    await this.persistAndBroadcast(
      gameId,
      mapManager,
      terrainSettings,
      unitManager,
      players,
      generatorType
    );
  }

  /**
   * Convert generator string to MapGeneratorType
   * @reference Original GameManager.ts:1104-1123 convertGeneratorType()
   */
  private convertGeneratorType(generator: string): MapGeneratorType {
    switch (generator.toLowerCase()) {
      case 'random':
        return 'RANDOM';
      case 'fractal':
        return 'FRACTAL';
      case 'island':
        return 'ISLAND';
      case 'fair':
        return 'FAIR';
      case 'scenario':
        return 'SCENARIO';
      default:
        this.logger.warn(`Unknown generator type: ${generator}, defaulting to RANDOM`);
        return 'RANDOM';
    }
  }

  private async tryGenerate(
    mapManager: MapManager,
    players: Map<string, PlayerState>,
    generator: string,
    generatorType: MapGeneratorType
  ): Promise<boolean> {
    try {
      this.logger.info('Delegating to restructured MapManager', {
        generator,
        generatorType,
        reference: 'apps/server/src/game/MapManager.ts:97-138',
      });
      await mapManager.generateMap(players, generatorType);
      return true;
    } catch (error) {
      const lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Map generation failed, attempting emergency recovery', {
        generator: generatorType,
        error: lastError.message,
      });
      return false;
    }
  }

  private async performEmergencyFallback(
    mapManager: MapManager,
    players: Map<string, PlayerState>,
    generatorType: MapGeneratorType
  ): Promise<void> {
    this.logger.warn('Initiating emergency fallback sequence (defensive extension)');

    try {
      this.logger.info('Emergency fallback: MAPGEN_FRACTAL');
      await mapManager.generateMap(players, 'FRACTAL');
      return;
    } catch (error) {
      this.logger.error('Emergency fractal failed, trying final MAPGEN_RANDOM fallback', {
        error: error instanceof Error ? error.message : error,
      });

      try {
        this.logger.info('Final emergency fallback: MAPGEN_RANDOM');
        await mapManager.generateMap(players, 'RANDOM');
        return;
      } catch (error) {
        const finalError = error instanceof Error ? error : new Error(String(error));
        this.logger.error('All generation methods exhausted', {
          originalError: `initial generator: ${generatorType}`,
          finalError: finalError.message,
        });
        throw new Error(
          `Complete map generation failure. Original: initial generator: ${generatorType}, Final: ${finalError.message}`
        );
      }
    }
  }

  private async persistAndBroadcast(
    gameId: string,
    mapManager: MapManager,
    terrainSettings: TerrainSettings | undefined,
    unitManager: UnitManager | undefined,
    players: Map<string, PlayerState>,
    generatorType: MapGeneratorType
  ): Promise<void> {
    const mapData = mapManager.getMapData();
    if (!mapData) {
      throw new Error('Map generation failed - no map data available');
    }

    this.logger.info('Map generated successfully', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      generator: generatorType,
      startingPositions: mapData.startingPositions?.length || 0,
    });

    // Persist map data to database
    await this.onPersistMapData?.(gameId, mapData, terrainSettings);

    // Create starting units for all players
    if (unitManager) {
      await this.onCreateStartingUnits?.(gameId, mapData, unitManager, players);
    }

    // Broadcast initial map data to all players
    this.onBroadcast?.(gameId, 'map_generated', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      startingPositions: mapData.startingPositions,
    });
  }

  private buildPathResponse(
    pathResult: any,
    unitId: string,
    targetX: number,
    targetY: number
  ): { success: boolean; path?: any; error?: string } {
    const tiles = Array.isArray(pathResult?.path) ? pathResult.path : [];
    const isValid = pathResult?.valid && tiles.length > 0;
    return {
      success: isValid,
      path: isValid
        ? {
            unitId,
            targetX,
            targetY,
            tiles: tiles,
            totalCost: pathResult.totalCost || 0,
            estimatedTurns: pathResult.estimatedTurns || 0,
            valid: isValid,
          }
        : undefined,
      error: isValid ? undefined : 'No valid path found',
    };
  }

  private validatePathRequest(
    gameId: string,
    playerId: string,
    unitId: string
  ): { gameInstance: GameInstance | null; unit?: any; error?: string } {
    const gameInstance = this.games.get(gameId) || null;
    if (!gameInstance) return { gameInstance, error: 'Game instance not found' };
    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit) return { gameInstance, error: 'Unit not found' };
    if (unit.playerId !== playerId)
      return { gameInstance, error: 'Unit does not belong to player' };
    return { gameInstance, unit };
  }
  private validateStartConditions(game: any, hostId: string): void {
    if (game.hostId !== hostId) {
      throw new Error('Only the host can start the game');
    }
    const minPlayers = game.gameType === 'single' ? 1 : serverConfig.game.minPlayersToStart;
    if (game.players.length < minPlayers) {
      throw new Error(`Need at least ${minPlayers} players to start`);
    }
    if (game.status !== 'waiting') {
      throw new Error('Game is not in waiting state');
    }
  }

  private async activateGameRecord(gameId: string): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        status: 'active',
        startedAt: new Date(),
        currentTurn: 1,
      })
      .where(eq(games.id, gameId));
  }

  private async updateRedisForGameStart(gameId: string, playerCount: number): Promise<void> {
    await gameState.setGameState(gameId, {
      state: 'active',
      currentTurn: 1,
      turnPhase: 'movement',
      playerCount,
    });
  }

  private buildPlayersMapFromDb(dbPlayers: any[]): Map<string, PlayerState> {
    const players = new Map<string, PlayerState>();
    for (const dbPlayer of dbPlayers) {
      players.set(dbPlayer.id, {
        id: dbPlayer.id,
        userId: dbPlayer.userId,
        playerNumber: dbPlayer.playerNumber,
        civilization: dbPlayer.civilization,
        isReady: false,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });
    }
    return players;
  }

  private buildPreliminaryInstance(
    gameId: string,
    game: any,
    preliminaryPlayers: Map<string, PlayerState>
  ): GameInstance {
    return {
      id: gameId,
      config: {
        name: game.name,
        hostId: game.hostId,
        gameType: game.gameType as 'single' | 'multiplayer' | undefined,
        maxPlayers: game.maxPlayers ?? undefined,
        mapWidth: game.mapWidth ?? undefined,
        mapHeight: game.mapHeight ?? undefined,
        ruleset: game.ruleset ?? undefined,
        turnTimeLimit: game.turnTimeLimit ?? undefined,
        victoryConditions: game.victoryConditions as string[] | undefined,
        terrainSettings: (game.gameState as any)?.terrainSettings,
      },
      state: 'active',
      currentTurn: 1,
      turnPhase: 'movement',
      players: preliminaryPlayers,
      turnManager: null as any,
      mapManager: null as any,
      unitManager: null as any,
      visibilityManager: null as any,
      cityManager: null as any,
      researchManager: null as any,
      pathfindingManager: null as any,
      lastActivity: new Date(),
    } as GameInstance;
  }

  private createMapManager(game: any, terrainSettings?: TerrainSettings): MapManager {
    const mapGenerator = terrainSettings?.generator || 'random';
    const temperatureParam = terrainSettings?.temperature ?? 50;
    return new MapManager(
      game.mapWidth,
      game.mapHeight,
      undefined,
      mapGenerator,
      undefined,
      undefined,
      false,
      temperatureParam
    );
  }

  private async createTurnManagerAndInitialize(
    gameId: string,
    players: Map<string, PlayerState>
  ): Promise<TurnManager> {
    const tm = new TurnManager(gameId, this.databaseProvider, this.io);
    const playerIds = Array.from(players.keys());
    await tm.initializeTurn(playerIds);
    return tm;
  }

  private createCityManager(gameId: string): CityManager {
    return new CityManager(gameId, this.databaseProvider, undefined, {
      createUnit: (_playerId: string, _unitType: string, _x: number, _y: number) =>
        Promise.resolve(''),
    });
  }

  private createUnitManager(
    gameId: string,
    game: any,
    mapManager: MapManager,
    cityManager: CityManager
  ): UnitManager {
    return new UnitManager(
      gameId,
      this.databaseProvider,
      game.mapWidth,
      game.mapHeight,
      mapManager,
      {
        foundCity: this.onFoundCity
          ? (gameId: string, playerId: string, name: string, x: number, y: number) =>
              this.onFoundCity!(gameId, playerId, name, x, y)
          : async () => '',
        requestPath: (playerId: string, unitId: string, targetX: number, targetY: number) =>
          this.requestPathDelegate(gameId, playerId, unitId, targetX, targetY),
        broadcastUnitMoved: (gameId, unitId, x, y, movementLeft) => {
          this.onBroadcast?.(gameId, 'unit_moved', { gameId, unitId, x, y, movementLeft });
        },
        getCityAt: (x: number, y: number) => {
          const city = cityManager.getCityAt(x, y);
          return city ? { playerId: city.playerId } : null;
        },
      }
    );
  }

  private createVisibilityManager(
    gameId: string,
    unitManager: UnitManager,
    mapManager: MapManager
  ): VisibilityManager {
    return new VisibilityManager(gameId, unitManager, mapManager);
  }

  private createResearchManager(gameId: string): ResearchManager {
    return new ResearchManager(gameId, this.databaseProvider);
  }

  private createPathfindingManager(game: any, mapManager: MapManager): PathfindingManager {
    return new PathfindingManager(game.mapWidth, game.mapHeight, mapManager);
  }

  private buildGameInstance(
    gameId: string,
    game: any,
    terrainSettings: TerrainSettings | undefined,
    players: Map<string, PlayerState>,
    turnManager: TurnManager,
    mapManager: MapManager,
    unitManager: UnitManager,
    visibilityManager: VisibilityManager,
    cityManager: CityManager,
    researchManager: ResearchManager,
    pathfindingManager: PathfindingManager
  ): GameInstance {
    return {
      id: gameId,
      config: {
        name: game.name,
        hostId: game.hostId,
        gameType: game.gameType,
        maxPlayers: game.maxPlayers,
        mapWidth: game.mapWidth,
        mapHeight: game.mapHeight,
        ruleset: game.ruleset,
        turnTimeLimit: game.turnTimeLimit,
        victoryConditions: game.victoryConditions,
        terrainSettings: terrainSettings,
      },
      state: 'active',
      currentTurn: 1,
      turnPhase: 'movement',
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
  }

  private async requestPathDelegate(
    gameId: string,
    playerId: string,
    unitId: string,
    targetX: number,
    targetY: number
  ): Promise<{ success: boolean; path?: any; error?: string }> {
    try {
      const { gameInstance, unit, error } = this.validatePathRequest(gameId, playerId, unitId);
      if (error || !gameInstance || !unit) {
        return { success: false, error: error || 'Pathfinding error' };
      }

      const pathResult = await gameInstance.pathfindingManager.findPath(unit, targetX, targetY);
      return this.buildPathResponse(pathResult, unitId, targetX, targetY);
    } catch (error) {
      logger.error('Error in GameLifecycleManager requestPath delegation:', error);
      return { success: false, error: 'Pathfinding error' };
    }
  }
}
