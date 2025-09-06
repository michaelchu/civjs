/* eslint-disable complexity */
import { eq } from 'drizzle-orm';
import { Server as SocketServer } from 'socket.io';
import { DatabaseProvider, productionDatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { games, players } from '@database/schema';
import { PacketType } from '@app-types/packet';
import { logger } from '@utils/logger';

// Extracted managers following refactoring patterns
import { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { GameLifecycleManager } from '@game/orchestrators/GameLifecycleManager';
import { GameStateManager } from '@game/orchestrators/GameStateManager';
import { PlayerConnectionManager } from '@game/orchestrators/PlayerConnectionManager';
import { ServiceRegistry } from '@game/services/ServiceRegistry';
import { UnitManagementService } from '@game/services/UnitManagementService';
import { CityManagementService } from '@game/services/CityManagementService';
import { ResearchManagementService } from '@game/services/ResearchManagementService';
import { VisibilityMapService } from '@game/services/VisibilityMapService';
import { GameInstanceRecoveryService } from '@game/services/GameInstanceRecoveryService';

// Keep existing imports for delegation
import { CityManager } from '@game/managers/CityManager';
import { MapManager } from '@game/managers/MapManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { ResearchManager } from '@game/managers/ResearchManager';
import { TurnManager } from '@game/managers/TurnManager';
import { UnitManager } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';

export type GameState = 'waiting' | 'starting' | 'active' | 'paused' | 'ended';
export type TurnPhase = 'movement' | 'production' | 'research' | 'diplomacy';

export interface TerrainSettings {
  generator: string;
  landmass: string;
  huts: number;
  temperature: number;
  wetness: number;
  rivers: number;
  resources: string;
  startpos?: number; // MapStartpos enum value for island generator routing
}

export interface GameConfig {
  name: string;
  hostId: string;
  gameType?: 'single' | 'multiplayer';
  maxPlayers?: number;
  mapWidth?: number;
  mapHeight?: number;
  ruleset?: string;
  turnTimeLimit?: number;
  victoryConditions?: string[];
  terrainSettings?: TerrainSettings;
}

export interface GameInstance {
  id: string;
  config: GameConfig;
  state: GameState;
  currentTurn: number;
  turnPhase: TurnPhase;
  players: Map<string, PlayerState>;
  turnManager: TurnManager;
  mapManager: MapManager;
  unitManager: UnitManager;
  visibilityManager: VisibilityManager;
  cityManager: CityManager;
  researchManager: ResearchManager;
  pathfindingManager: PathfindingManager;
  lastActivity: Date;
}

export interface PlayerState {
  id: string;
  userId: string | null; // Can be null for AI players
  playerNumber: number;
  civilization: string;
  isReady: boolean;
  hasEndedTurn: boolean;
  isConnected: boolean;
  lastSeen: Date;
}

/**
 * GameManager - Refactored to use extracted service components as facade
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 *
 * Now acts as a facade coordinating:
 * - GameStateManager: Database operations and persistence
 * - PlayerConnectionManager: Player join/leave operations
 * - GameLifecycleManager: Game creation, start, end
 * - GameBroadcastManager: Socket.IO broadcasting
 */
export class GameManager {
  private static instance: GameManager;
  private io: SocketServer;
  private databaseProvider: DatabaseProvider;
  private games = new Map<string, GameInstance>();
  private playerToGame = new Map<string, string>();

  // Extracted service components
  private serviceRegistry!: ServiceRegistry;
  private gameStateManager!: GameStateManager;
  private playerConnectionManager!: PlayerConnectionManager;
  private gameLifecycleManager!: GameLifecycleManager;
  private gameBroadcastManager!: GameBroadcastManager;
  private unitManagementService!: UnitManagementService;
  private cityManagementService!: CityManagementService;
  private researchManagementService!: ResearchManagementService;
  private visibilityMapService!: VisibilityMapService;
  private gameInstanceRecoveryService!: GameInstanceRecoveryService;

  private constructor(io: SocketServer, databaseProvider?: DatabaseProvider) {
    this.io = io;
    this.databaseProvider = databaseProvider || productionDatabaseProvider;
    this.initializeServices();
  }

  public static getInstance(io: SocketServer, databaseProvider?: DatabaseProvider): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager(io, databaseProvider);
    }
    return GameManager.instance;
  }

  /**
   * Initialize extracted service components following dependency injection pattern
   */
  private initializeServices(): void {
    // Create service registry
    this.serviceRegistry = new ServiceRegistry();

    // Initialize extracted managers with proper dependencies
    this.gameStateManager = new GameStateManager(logger, this.databaseProvider);
    this.gameBroadcastManager = new GameBroadcastManager(this.io);

    this.playerConnectionManager = new PlayerConnectionManager(
      this.databaseProvider,
      this.broadcastToGame.bind(this),
      this.startGame.bind(this)
    );

    this.gameLifecycleManager = new GameLifecycleManager(
      this.io,
      this.databaseProvider,
      this.games,
      this.broadcastToGame.bind(this),
      this.persistMapDataToDatabase.bind(this),
      this.createStartingUnits.bind(this),
      this.foundCity.bind(this),
      this.gameBroadcastManager.broadcastMapData.bind(this.gameBroadcastManager)
    );

    this.unitManagementService = new UnitManagementService(
      this.games,
      this.broadcastToGame.bind(this)
    );

    this.cityManagementService = new CityManagementService(
      this.games,
      this.broadcastToGame.bind(this)
    );

    this.researchManagementService = new ResearchManagementService(
      this.games,
      this.broadcastToGame.bind(this)
    );

    this.visibilityMapService = new VisibilityMapService(this.games);

    this.gameInstanceRecoveryService = new GameInstanceRecoveryService(
      this.databaseProvider,
      this.games,
      this.playerToGame,
      this.io,
      this.foundCity.bind(this),
      this.requestPath.bind(this),
      this.createUnit.bind(this),
      this.broadcastToGame.bind(this)
    );

    // Register services
    this.serviceRegistry.register('GameStateManager', this.gameStateManager);
    this.serviceRegistry.register('PlayerConnectionManager', this.playerConnectionManager);
    this.serviceRegistry.register('GameLifecycleManager', this.gameLifecycleManager);
    this.serviceRegistry.register('GameBroadcastManager', this.gameBroadcastManager);
    this.serviceRegistry.register('UnitManagementService', this.unitManagementService);
    this.serviceRegistry.register('CityManagementService', this.cityManagementService);
    this.serviceRegistry.register('ResearchManagementService', this.researchManagementService);
    this.serviceRegistry.register('VisibilityMapService', this.visibilityMapService);
    this.serviceRegistry.register('GameInstanceRecoveryService', this.gameInstanceRecoveryService);

    // Set cross-references
    this.gameBroadcastManager.setGamesReference(this.games);

    logger.info('GameManager services initialized successfully');
  }

  /**
   * Helper methods for extracted services
   */
  private async persistMapDataToDatabase(
    gameId: string,
    mapData: any,
    terrainSettings?: TerrainSettings
  ): Promise<void> {
    return this.gameStateManager.persistMapData(gameId, mapData, terrainSettings);
  }

  // requestPathForLifecycle removed - GameLifecycleManager now delegates to main requestPath method

  /**
   * Get games map reference for sharing with extracted services
   */
  public getGamesMap(): Map<string, GameInstance> {
    return this.games;
  }

  /**
   * Get playerToGame map reference (for testing)
   */
  public getPlayerToGameMap(): Map<string, string> {
    return this.playerToGame;
  }

  /**
   * Clear all games and player mappings (for testing)
   */
  public clearAllGames(): void {
    this.games.clear();
    this.playerToGame.clear();
  }

  /**
   * Set game instance (for lifecycle manager)
   */
  public setGameInstance(gameId: string, gameInstance: GameInstance): void {
    this.games.set(gameId, gameInstance);
    // Sync player mappings
    for (const [playerId] of gameInstance.players) {
      this.playerToGame.set(playerId, gameId);
      this.playerConnectionManager.setPlayerToGame(playerId, gameId);
    }
  }

  /**
   * Create a new game - delegates to GameLifecycleManager
   */
  public async createGame(gameConfig: GameConfig): Promise<string> {
    return this.gameLifecycleManager.createGame(gameConfig);
  }

  /**
   * Join a game - delegates to PlayerConnectionManager
   */
  public async joinGame(gameId: string, userId: string, civilization?: string): Promise<string> {
    const playerId = await this.playerConnectionManager.joinGame(gameId, userId, civilization);
    // Sync player-to-game mapping
    this.playerToGame.set(playerId, gameId);
    return playerId;
  }

  /**
   * Start a game - delegates to GameLifecycleManager
   */
  public async startGame(gameId: string, hostId: string): Promise<void> {
    await this.gameLifecycleManager.startGame(gameId, hostId);
    // Note: GameLifecycleManager handles the game instance creation internally
  }

  // Moved to GameBroadcastManager - this method is no longer used
  /*
  private broadcastMapData(gameId: string, mapData: any): void {
    const mapDataPacket = {
      gameId,
      width: mapData.width,
      height: mapData.height,
      startingPositions: mapData.startingPositions,
      seed: mapData.seed,
      generatedAt: mapData.generatedAt,
    };

    this.broadcastToGame(gameId, 'map-data', mapDataPacket);

    // Send data in EXACT freeciv-web format
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Send map info in EXACT freeciv-web format (gets assigned to global map variable)
      const mapInfoPacket = {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: 0, // Flat earth
        topology_id: 0,
      };

      this.broadcastPacketToGame(gameId, PacketType.MAP_INFO, mapInfoPacket);

      // OPTIMIZED: Send tiles in batches to improve performance

      // Collect all tiles into an array
      const allTiles = [];
      for (let y = 0; y < mapData.height; y++) {
        for (let x = 0; x < mapData.width; x++) {
          const index = x + y * mapData.width;
          // Handle column-based tile array structure: mapData.tiles[x][y]
          const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

          if (serverTile) {
            // Format tile in exact freeciv-web format
            const tileInfo = {
              tile: index, // This is the key - tile index used by freeciv-web
              x: x,
              y: y,
              terrain: serverTile.terrain,
              resource: serverTile.resource,
              elevation: serverTile.elevation || 0,
              riverMask: serverTile.riverMask || 0,
              known: 1, // TILE_KNOWN
              seen: 1,
              player: null,
              worked: null,
              extras: 0, // BitVector for extras
            };
            allTiles.push(tileInfo);
          }
        }
      }

      // Send tiles in batches of 100 to avoid overwhelming the client
      const BATCH_SIZE = 100;
      for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
        const batch = allTiles.slice(i, i + BATCH_SIZE);
        this.broadcastPacketToGame(gameId, PacketType.TILE_INFO, {
          tiles: batch,
          startIndex: i,
          endIndex: Math.min(i + BATCH_SIZE, allTiles.length),
          total: allTiles.length,
        });
      }

      logger.debug(
        `Sent ${allTiles.length} tiles in ${Math.ceil(allTiles.length / BATCH_SIZE)} batches`
      );
    }
  }
  */

  /**
   * Create starting units for all players at their starting positions
   * @reference freeciv/server/plrhand.c:player_init() - create_start_unit()
   * Each player starts with a settler (city founder) and a warrior (military unit)
   */
  private async createStartingUnits(
    gameId: string,
    mapData: any,
    unitManager: any,
    players: Map<string, PlayerState>
  ): Promise<void> {
    try {
      logger.info('Creating starting units for all players', { gameId });

      // Create starting units for each player
      for (const player of players.values()) {
        const startingPos = mapData.startingPositions.find(
          (pos: any) => pos.playerId === player.id
        );

        if (!startingPos) {
          logger.warn(`No starting position found for player ${player.id}`);
          continue;
        }

        try {
          // Create settler first (city founder)
          // @reference freeciv/server/plrhand.c - UTYF_CITYFOUNDATION flag
          const settler = await unitManager.createUnit(
            player.id,
            'settler',
            startingPos.x,
            startingPos.y
          );

          // Create military unit (warrior) at same position
          // @reference freeciv/server/plrhand.c - initial military unit
          const warrior = await unitManager.createUnit(
            player.id,
            'warrior',
            startingPos.x,
            startingPos.y
          );

          logger.info(`Created starting units for player ${player.id}`, {
            gameId,
            playerId: player.id,
            position: `${startingPos.x},${startingPos.y}`,
            units: [settler.id, warrior.id],
          });

          // Broadcast unit creation to all players in the game
          this.broadcastPacketToGame(gameId, PacketType.UNIT_INFO, {
            units: [
              this.formatUnitForClient(settler, unitManager),
              this.formatUnitForClient(warrior, unitManager),
            ],
          });
        } catch (error) {
          logger.error(`Failed to create starting units for player ${player.id}:`, error);
          // Continue with other players even if one fails
        }
      }

      logger.info('Starting units creation completed', { gameId });
    } catch (error) {
      logger.error('Failed to create starting units:', error);
      // Don't throw to avoid breaking game initialization
    }
  }

  /**
   * Format unit for client communication
   * @reference freeciv-web unit packet format
   */
  private formatUnitForClient(unit: any, unitManager: any): any {
    const unitType = unitManager.getUnitType(unit.unitTypeId);

    return {
      id: unit.id,
      owner: unit.playerId,
      type: unitType?.id || unit.unitTypeId,
      tile: unit.x + unit.y * 100, // Convert to tile index (simplified)
      x: unit.x,
      y: unit.y,
      hp: unit.health,
      movesleft: unit.movementLeft * 3, // Convert to movement fragments
      veteran: unit.veteranLevel,
      transported: false,
      paradropped: false,
      connecting: false,
      occupied: false,
      done_moving: unit.movementLeft === 0,
      battlegroup: -1,
      has_orders: false,
      homecity: 0, // No home city initially
      fuel: 0,
      goto_tile: -1,
      activity: 0, // ACTIVITY_IDLE
      activity_count: 0,
      activity_target: null,
      focus: false,
    };
  }

  /**
   * Recover game instance from database when not found in memory
   * This handles cases where the server restarted and game instances were lost
   */
  // Game recovery methods - delegates to GameInstanceRecoveryService
  public async recoverGameInstance(gameId: string): Promise<GameInstance | null> {
    return this.gameInstanceRecoveryService.recoverGameInstance(gameId);
  }

  public async getGame(gameId: string): Promise<any | null> {
    return await this.getGameById(gameId);
  }

  public getGameInstance(gameId: string): GameInstance | null {
    return this.games.get(gameId) || null;
  }

  public getAllGameInstances(): GameInstance[] {
    return this.gameLifecycleManager.getAllGameInstances();
  }

  public async loadGame(gameId: string): Promise<GameInstance | null> {
    return this.gameInstanceRecoveryService.loadGame(gameId);
  }

  public getActiveGameInstances(): GameInstance[] {
    return this.gameLifecycleManager.getActiveGameInstances();
  }

  public async getGameByPlayerId(playerId: string): Promise<any | null> {
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
      logger.error('Error fetching game by player ID:', error);
      return null;
    }
  }

  public async getPlayerById(playerId: string): Promise<any | null> {
    try {
      const player = await this.databaseProvider.getDatabase().query.players.findFirst({
        where: eq(players.id, playerId),
      });
      return player;
    } catch (error) {
      logger.error('Failed to get player by ID:', error);
      return null;
    }
  }

  public async getAllGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase(null);
  }

  public async getActiveGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase(null);
  }

  public async getAllGamesFromDatabase(userId?: string | null): Promise<any[]> {
    try {
      const dbGames = await this.databaseProvider.getDatabase().query.games.findMany({
        where: (games, { inArray }) => inArray(games.status, ['waiting', 'running', 'active']),
        with: {
          host: {
            columns: {
              username: true,
            },
          },
          players: true,
        },
        orderBy: (games, { desc }) => desc(games.createdAt),
      });

      return dbGames.map(game => {
        // Use connected player count for running/active games, database count for waiting games
        const isRunning = game.status === 'running' || game.status === 'active';
        const connectedCount = isRunning ? this.getConnectedPlayerCount(game.id) : 0;
        const currentPlayers = isRunning ? connectedCount : game.players?.length || 0;

        // Check if the current user is already a player in this game
        const isExistingPlayer = userId && game.players?.some(p => p.userId === userId);

        // User can join if:
        // 1. Game is waiting and has space, OR
        // 2. User is already a player (can rejoin regardless of status)
        const canJoin =
          isExistingPlayer ||
          (game.status === 'waiting' && (game.players?.length || 0) < game.maxPlayers);

        return {
          id: game.id,
          name: game.name,
          hostName: game.host?.username || 'Unknown',
          status: game.status,
          currentPlayers: currentPlayers,
          maxPlayers: game.maxPlayers,
          currentTurn: game.currentTurn,
          mapSize: `${game.mapWidth}x${game.mapHeight}`,
          createdAt: game.createdAt.toISOString(),
          canJoin: canJoin,
          players: game.players || [],
        };
      });
    } catch (error) {
      logger.error('Error fetching games from database:', error);
      return [];
    }
  }

  public async getGameListForLobby(userId?: string | null): Promise<any[]> {
    // All games come from database now - single source of truth
    return await this.getAllGamesFromDatabase(userId);
  }

  public async getGameById(gameId: string): Promise<any | null> {
    try {
      const game = await this.databaseProvider.getDatabase().query.games.findFirst({
        where: eq(games.id, gameId),
        with: {
          host: {
            columns: {
              username: true,
            },
          },
          players: true,
        },
      });

      if (!game) return null;

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
      logger.error('Error fetching game by ID from database:', error);
      return null;
    }
  }

  /**
   * Update player connection - delegates to PlayerConnectionManager
   */
  public async updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void> {
    // Update local game instance state
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) {
      // Delegate to connection manager
      return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
    }

    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      // Delegate to connection manager
      return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      // Delegate to connection manager
      return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
    }

    // Update player connection state
    this.updatePlayerConnectionState(player, isConnected);

    // Handle game pause if needed
    if (!isConnected) {
      this.handlePlayerDisconnection(gameInstance, gameId);
    }

    // Delegate to connection manager
    return this.playerConnectionManager.updatePlayerConnection(playerId, isConnected);
  }

  /**
   * Update player connection state and timestamp
   */
  private updatePlayerConnectionState(player: any, isConnected: boolean): void {
    player.isConnected = isConnected;
    player.lastSeen = new Date();
  }

  /**
   * Handle game pause when player disconnects
   */
  private handlePlayerDisconnection(gameInstance: any, gameId: string): void {
    if (gameInstance.state !== 'active') {
      return;
    }

    const allDisconnected = Array.from(gameInstance.players.values()).every(
      (p: any) => !p.isConnected
    );

    if (allDisconnected) {
      gameInstance.state = 'paused';
      logger.info('Game paused - all players disconnected', { gameId });
    }
  }

  public async endTurn(playerId: string): Promise<boolean> {
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) {
      throw new Error('Player not in any game');
    }

    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Game is not active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    if (player.hasEndedTurn) {
      return false; // Already ended turn
    }

    player.hasEndedTurn = true;
    logger.info('Player ended turn', { gameId, playerId, turn: gameInstance.currentTurn });

    // Check if all players have ended their turn
    const allPlayersReady = Array.from(gameInstance.players.values())
      .filter(p => p.isConnected)
      .every(p => p.hasEndedTurn);

    if (allPlayersReady) {
      // Process city production first
      await gameInstance.cityManager.processAllCitiesTurn(gameInstance.currentTurn + 1);

      // Process research
      await this.processResearchTurn(gameId);

      // Process the turn
      await gameInstance.turnManager.processTurn();

      // Reset movement points for all units at the start of the new turn
      for (const player of gameInstance.players.values()) {
        await gameInstance.unitManager.resetMovement(player.id);
      }

      // Process unit orders (multi-turn GOTO, etc.) after movement points are restored
      for (const player of gameInstance.players.values()) {
        await gameInstance.unitManager.processUnitOrders(player.id);
      }

      // Reset player turn status for next turn
      for (const player of gameInstance.players.values()) {
        player.hasEndedTurn = false;
      }

      return true; // Turn advanced
    }

    return false; // Waiting for other players
  }

  // Unit management methods - delegates to UnitManagementService
  public async createUnit(
    gameId: string,
    playerId: string,
    unitType: string,
    x: number,
    y: number
  ): Promise<string> {
    return this.unitManagementService.createUnit(gameId, playerId, unitType, x, y);
  }

  public async moveUnit(
    gameId: string,
    playerId: string,
    unitId: string,
    x: number,
    y: number
  ): Promise<boolean> {
    return this.unitManagementService.moveUnit(gameId, playerId, unitId, x, y);
  }

  public async attackUnit(
    gameId: string,
    playerId: string,
    attackerUnitId: string,
    defenderUnitId: string
  ) {
    return this.unitManagementService.attackUnit(gameId, playerId, attackerUnitId, defenderUnitId);
  }

  public async fortifyUnit(gameId: string, playerId: string, unitId: string): Promise<void> {
    return this.unitManagementService.fortifyUnit(gameId, playerId, unitId);
  }

  public getPlayerUnits(gameId: string, playerId: string) {
    return this.unitManagementService.getPlayerUnits(gameId, playerId);
  }

  public getVisibleUnits(gameId: string, playerId: string, visibleTiles?: Set<string>) {
    return this.unitManagementService.getVisibleUnits(gameId, playerId, visibleTiles);
  }

  // Visibility and map methods - delegates to VisibilityMapService
  public getPlayerMapView(gameId: string, playerId: string) {
    return this.visibilityMapService.getPlayerMapView(gameId, playerId);
  }

  public getTileVisibility(gameId: string, playerId: string, x: number, y: number) {
    return this.visibilityMapService.getTileVisibility(gameId, playerId, x, y);
  }

  public updatePlayerVisibility(gameId: string, playerId: string): void {
    this.visibilityMapService.updatePlayerVisibility(gameId, playerId);
  }

  public getMapData(gameId: string) {
    return this.visibilityMapService.getMapData(gameId);
  }

  public getPlayerVisibleTiles(gameId: string, playerId: string) {
    return this.visibilityMapService.getPlayerVisibleTiles(gameId, playerId);
  }

  // City management methods - delegates to CityManagementService
  public async foundCity(
    gameId: string,
    playerId: string,
    name: string,
    x: number,
    y: number,
    unit?: any
  ): Promise<string> {
    return this.cityManagementService.foundCity(gameId, playerId, name, x, y, unit);
  }

  public async setCityProduction(
    gameId: string,
    playerId: string,
    cityId: string,
    production: string,
    type: 'unit' | 'building'
  ): Promise<void> {
    return this.cityManagementService.setCityProduction(gameId, playerId, cityId, production, type);
  }

  public getPlayerCities(gameId: string, playerId: string) {
    return this.cityManagementService.getPlayerCities(gameId, playerId);
  }

  public getCity(gameId: string, cityId: string) {
    return this.cityManagementService.getCity(gameId, cityId);
  }

  // Research management methods - delegates to ResearchManagementService
  public async setPlayerResearch(gameId: string, playerId: string, techId: string): Promise<void> {
    return this.researchManagementService.setPlayerResearch(gameId, playerId, techId);
  }

  public async setResearchGoal(gameId: string, playerId: string, techId: string): Promise<void> {
    return this.researchManagementService.setResearchGoal(gameId, playerId, techId);
  }

  public getPlayerResearch(gameId: string, playerId: string) {
    return this.researchManagementService.getPlayerResearch(gameId, playerId);
  }

  public getAvailableTechnologies(gameId: string, playerId: string) {
    return this.researchManagementService.getAvailableTechnologies(gameId, playerId);
  }

  public getResearchProgress(gameId: string, playerId: string) {
    return this.researchManagementService.getResearchProgress(gameId, playerId);
  }

  public async processResearchTurn(gameId: string): Promise<void> {
    return this.researchManagementService.processResearchTurn(gameId);
  }

  /**
   * Get count of connected players for a game
   */
  private getConnectedPlayerCount(gameId: string): number {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return 0;

    return Array.from(gameInstance.players.values()).filter(p => p.isConnected).length;
  }

  /**
   * Broadcast to game - delegates to GameBroadcastManager
   */
  private broadcastToGame(gameId: string, event: string, data: any): void {
    this.gameBroadcastManager.broadcastToGame(gameId, event, data);
  }

  /**
   * Broadcast packet to game - delegates to GameBroadcastManager
   */
  private broadcastPacketToGame(gameId: string, packetType: PacketType, data: any): void {
    this.gameBroadcastManager.broadcastPacketToGame(gameId, packetType, data);
  }

  /**
   * Delete game - delegates to GameLifecycleManager
   */
  public async deleteGame(gameId: string, userId?: string): Promise<void> {
    // Clean up local tracking
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Remove from player mappings
      for (const player of gameInstance.players.values()) {
        this.playerToGame.delete(player.id);
        this.playerConnectionManager.removePlayer(player.id);
      }
      this.games.delete(gameId);
    }

    // Delegate to lifecycle manager
    return this.gameLifecycleManager.deleteGame(gameId, userId);
  }

  public async cleanupInactiveGames(): Promise<void> {
    const now = new Date();
    const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

    for (const [gameId, gameInstance] of this.games) {
      if (now.getTime() - gameInstance.lastActivity.getTime() > inactiveThreshold) {
        if (
          gameInstance.state === 'waiting' ||
          (gameInstance.state === 'paused' &&
            Array.from(gameInstance.players.values()).every(p => !p.isConnected))
        ) {
          logger.info('Cleaning up inactive game', { gameId });

          // Remove from maps
          for (const player of gameInstance.players.values()) {
            this.playerToGame.delete(player.id);
          }

          // Cleanup managers
          gameInstance.visibilityManager.cleanup();
          gameInstance.cityManager.cleanup();

          this.games.delete(gameId);

          // Update database
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
        }
      }
    }
  }

  /**
   * Handle pathfinding request from client
   */
  public async requestPath(
    playerId: string,
    unitId: string,
    targetX: number,
    targetY: number
  ): Promise<{ success: boolean; path?: any; error?: string }> {
    try {
      const gameId = this.playerToGame.get(playerId);
      if (!gameId) {
        return { success: false, error: 'Player not in any game' };
      }

      const gameInstance = this.games.get(gameId);
      if (!gameInstance) {
        return { success: false, error: 'Game not found' };
      }

      if (gameInstance.state !== 'active') {
        return { success: false, error: 'Game is not active' };
      }

      // Get the unit
      const unit = await gameInstance.unitManager.getUnit(unitId);
      if (!unit) {
        return { success: false, error: 'Unit not found' };
      }

      // Verify unit ownership
      if (unit.playerId !== playerId) {
        return { success: false, error: 'Unit does not belong to player' };
      }

      // Request pathfinding
      const pathResult = await gameInstance.pathfindingManager.findPath(unit, targetX, targetY);

      logger.info('Pathfinding request completed', {
        gameId,
        playerId,
        unitId,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        pathFound: pathResult.valid,
        pathLength: pathResult.path.length,
      });

      // Handle the case where pathResult might have unexpected structure
      const tiles = Array.isArray(pathResult.path) ? pathResult.path : [];
      const isValid = pathResult.valid && tiles.length > 0;

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
    } catch (error) {
      logger.error('Error processing pathfinding request', {
        playerId,
        unitId,
        targetX,
        targetY,
        error: error instanceof Error ? error.message : String(error),
      });

      return { success: false, error: 'Internal server error' };
    }
  }
}
