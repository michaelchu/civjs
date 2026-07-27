/**
 * GameLifecycleManager - Handles game creation, initialization, starting, and cleanup
 * Extracted from GameManager.ts following the established refactoring patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 */

import { BaseGameService } from './GameService';
import { logger } from '@utils/logger';
import { DatabaseProvider } from '@database';
import { gameState } from '@database/redis';
import { games, players as playerRecords } from '@database/schema';
import { eq } from 'drizzle-orm';
import serverConfig from '@config';
import { TurnManager } from '@game/managers/TurnManager';
import { MapManager, MapGeneratorType } from '@game/managers/MapManager';
import { UnitManager } from '@game/managers/UnitManager';
import { VisibilityManager } from '@game/managers/VisibilityManager';
import { CityManager } from '@game/managers/CityManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { ResearchManager } from '@game/managers/ResearchManager';
import { CultureManager } from '@game/managers/CultureManager';
import { EconomicManager } from '@game/systems/Economic/EconomicManager';
import { DEFAULT_TAX_RATES } from '@game/systems/Economic/constants/EconomicConstants';
import { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { PathfindingManager } from '@game/managers/PathfindingManager';
import { BorderManager } from '@game/managers/BorderManager';
import { GovernmentManager } from '@game/managers/GovernmentManager';
import { BorderNetworkService } from '@game/services/BorderNetworkService';
import { MapStartpos } from '@game/map/MapTypes';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import type { Server as SocketServer } from 'socket.io';
import { PROTOCOL_VERSION } from '@app-types/packet';
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
  private broadcastManager?: GameBroadcastManager;
  private borderNetworkService?: BorderNetworkService;

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
    onBroadcastMapData?: (gameId: string, mapData: any) => void,
    broadcastManager?: GameBroadcastManager
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
    this.broadcastManager = broadcastManager;
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
      victoryConditions: gameConfig.victoryConditions?.length
        ? gameConfig.victoryConditions
        : ['conquest'],
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

    // Create managers in dependency order
    const mapManager = this.createMapManager(game, terrainSettings);
    const effectsManager = new EffectsManager(); // Shared effects manager
    const governmentManager = new GovernmentManager(gameId, this.databaseProvider, effectsManager);
    for (const player of game.players) {
      await governmentManager.loadPlayerGovernment(
        player.id,
        player.government,
        player.revolutionTurns
      );
    }
    const cityManager = this.createCityManager(gameId, effectsManager);
    const borderManager = this.createBorderManager(mapManager, cityManager, effectsManager);
    this.borderNetworkService = this.createBorderNetworkService(borderManager);
    const researchManager = this.createResearchManager(gameId);
    await this.initializePlayerResearch(researchManager, players);
    const unitManager = this.createUnitManager(
      gameId,
      game,
      mapManager,
      cityManager,
      effectsManager,
      researchManager
    );
    cityManager.setUnitSupportProvider(city =>
      [...unitManager.getAllUnits().values()]
        .filter(unit => unit.homeCityId === city.id)
        .map(unit => {
          const unitType = UNIT_TYPES[unit.unitTypeId];
          return {
            unitId: unit.id,
            unitType: unit.unitTypeId,
            homeCity: city.id,
            currentLocation: cityManager.getCityAt(unit.x, unit.y)?.id ?? `${unit.x},${unit.y}`,
            upkeep: {
              food: unitType?.uk_food ?? 0,
              shield: unitType?.uk_shield ?? 0,
              gold: unitType?.uk_gold ?? 0,
            },
            isAwayFromHome: unit.x !== city.x || unit.y !== city.y,
            isMilitaryUnit: (unitType?.attack ?? 0) > 0,
          };
        })
    );
    cityManager.setMapChangedCallback((changedGameId, mapData) =>
      this.onBroadcastMapData?.(changedGameId, mapData)
    );

    // Set up dependencies after all managers are created
    cityManager.setMapManager(mapManager);
    await cityManager.initialize();

    // Create additional managers
    cityManager.setPlayerTechsProvider(
      playerId => new Set(researchManager.getResearchedTechs(playerId))
    );
    cityManager.setPlayerBuildingsProvider(
      playerId => new Set(cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings))
    );
    cityManager.setPlayerGovernmentProvider(playerId => {
      const government = governmentManager.getPlayerGovernment(playerId)?.currentGovernment;
      if (!government) {
        throw new Error(`No government found for player '${playerId}'`);
      }
      return government;
    });
    const visibilityManager = this.createVisibilityManager(
      gameId,
      unitManager,
      mapManager,
      effectsManager,
      researchManager
    );
    visibilityManager.setCityVisionProvider(playerId =>
      cityManager.getCitiesByPlayer(playerId).map(city => ({ x: city.x, y: city.y }))
    );
    unitManager.setHutMapRevealProvider((playerId, x, y) => [
      ...visibilityManager.revealArea(playerId, x, y, 30),
    ]);
    unitManager.setExploredTilesProvider(playerId => visibilityManager.getExploredTiles(playerId));
    unitManager.setPlayerTechsProvider(
      playerId => new Set(researchManager.getResearchedTechs(playerId))
    );
    const pathfindingManager = this.createPathfindingManager(game, mapManager);

    // Create TurnManager last since it depends on all other managers
    const turnManager = await this.createTurnManagerAndInitialize(
      gameId,
      players,
      unitManager,
      cityManager,
      researchManager,
      borderManager,
      visibilityManager,
      game.players,
      governmentManager,
      effectsManager,
      game.ruleset ?? 'classic'
    );
    // @reference reference/freeciv/server/techtools.c:665-719
    // Research completion belongs to the active authoritative turn.
    researchManager.setCurrentTurnProvider(() => turnManager.getCurrentTurn());

    // Set up callbacks after all managers are created
    cityManager.setCallbacks({
      onCityProductionComplete: async (city, item) => {
        if (item.kind === 'unit') {
          try {
            // Create unit at city location
            const unit = await unitManager.createUnit(
              city.playerId,
              item.value,
              city.x,
              city.y,
              city.id
            );
            this.logger.info(`Unit ${item.value} created at city ${city.name}`, {
              cityId: city.id,
              playerId: city.playerId,
              unitType: item.value,
              unitId: unit.id,
              x: city.x,
              y: city.y,
            });

            this.broadcastManager?.broadcastUnitInfo(gameId, unit);

            this.logger.debug('New unit broadcasted to game', {
              gameId,
              unitId: unit.id,
              playerId: city.playerId,
            });
          } catch (error) {
            this.logger.error(`Failed to create unit ${item.value} at city ${city.name}`, {
              error: error instanceof Error ? error.message : 'Unknown error',
              cityId: city.id,
              playerId: city.playerId,
              unitType: item.value,
              x: city.x,
              y: city.y,
            });
          }
        } else {
          const immediateTechs = effectsManager.calculateEffect(EffectType.GIVE_IMMEDIATE_TECH, {
            playerId: city.playerId,
            cityId: city.id,
            buildingId: item.value,
            cityBuildings: new Set(city.buildings),
            playerBuildings: new Set(
              cityManager.getCitiesByPlayer(city.playerId).flatMap(candidate => candidate.buildings)
            ),
            playerTechs: new Set(researchManager.getResearchedTechs(city.playerId)),
          }).value;
          if (immediateTechs > 0) {
            await researchManager.grantAvailableTechnologies(city.playerId, immediateTechs);
          }
        }
      },
      onCityFounded: city => {
        borderManager.addCityBorderSource(city);

        this.logger.info(`Border source added for city ${city.name}`, {
          cityId: city.id,
          x: city.x,
          y: city.y,
          playerId: city.playerId,
        });
      },
      onCityCaptured: city => {
        borderManager.removeBorderSource(city.x, city.y);
        borderManager.addCityBorderSource(city);
        this.onBroadcastMapData?.(gameId, mapManager.getMapData());
      },
      onCityGrowth: (city, oldSize) => {
        this.logger.info(`City ${city.name} grew from size ${oldSize} to ${city.size}`, {
          cityId: city.id,
          x: city.x,
          y: city.y,
          oldSize,
          newSize: city.size,
        });
        // Population still changes Freeciv-style border strength, even though
        // CivJS territorial radius is driven by accumulated city culture.
        borderManager.recalculateAllBorders();
      },
    });

    // Set up BorderManager callbacks to broadcast network updates
    borderManager.setCallbacks({
      onBorderUpdate: update => {
        // Send border update to all players in the game
        this.borderNetworkService!.broadcastBorderUpdate(gameId, update);
        this.logger.debug('Border update broadcasted', {
          gameId,
          tilesUpdated: update.tiles.length,
          affectedPlayers: update.affectedPlayers?.length || 0,
        });
      },
      onBorderSourceAdded: source => {
        this.logger.debug('Border source added', {
          gameId,
          x: source.x,
          y: source.y,
          playerId: source.playerId,
          type: source.type,
        });
      },
      onBorderSourceRemoved: (x, y) => {
        this.logger.debug('Border source removed', {
          gameId,
          x,
          y,
        });
      },
    });

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
      pathfindingManager,
      borderManager,
      governmentManager
    );

    this.logger.info('Game instance initialized successfully', {
      gameId,
      playerCount: players.size,
    });
    return gameInstance;
  }

  /**
   * Initialize a research record for every player before the first turn.
   * @reference reference/freeciv/common/research.c:62-76 researches_init()
   */
  private async initializePlayerResearch(
    researchManager: ResearchManager,
    players: Map<string, PlayerState>
  ): Promise<void> {
    for (const playerId of players.keys()) {
      await researchManager.initializePlayerResearch(playerId);
    }
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

    if (userId && game.hostId !== userId) {
      throw new Error('Only the host can delete a game');
    }

    this.logger.info('Deleting game', { gameId, userId });

    // A completed game is marked as ended by EndGameService. Explicit
    // deletion removes the record entirely (related records cascade).
    await this.databaseProvider.getDatabase().delete(games).where(eq(games.id, gameId));

    // Remove from active games map if it exists
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Cleanup managers
      gameInstance.visibilityManager.cleanup();
      gameInstance.cityManager.cleanup();

      // Remove from games map after all cleanup operations are complete
      this.games.delete(gameId);
    }

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
        // The null-user fallback keeps games created before isAI was persisted
        // playable after a server restart.
        isAI: dbPlayer.isAI || dbPlayer.userId === null,
        playerNumber: dbPlayer.playerNumber,
        civilization: dbPlayer.civilization,
        history: dbPlayer.history ?? 0,
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
    players: Map<string, PlayerState>,
    unitManager: UnitManager,
    cityManager: CityManager,
    researchManager: ResearchManager,
    borderManager: BorderManager,
    visibilityManager: VisibilityManager,
    databasePlayers: any[],
    governmentManager: GovernmentManager,
    effectsManager: EffectsManager,
    rulesetName: string
  ): Promise<TurnManager> {
    // Create a simple broadcast manager for the TurnManager
    // TODO: Proper dependency injection should be implemented
    const mockBroadcastManager = {
      broadcastToPlayer: (playerId: string, event: string, data: any) => {
        this.io.to(`player:${playerId}`).emit(event, data);
      },
      broadcastToGame: (gameId: string, event: string, data: any) => {
        this.io.to(`game:${gameId}`).emit(event, data);
      },
      broadcastPacketToGame: (gameId: string, packetType: any, data: any) => {
        this.io
          .to(`game:${gameId}`)
          .emit('packet', { type: packetType, version: PROTOCOL_VERSION, data });
      },
      broadcastMapData: (gameId: string, mapData: any) => {
        this.io.to(`game:${gameId}`).emit('map_data', mapData);
      },
      broadcastCityData: (gameId: string) => {
        this.broadcastManager?.broadcastCityData(gameId);
      },
      broadcastCityDataToPlayer: (gameId: string, playerId: string) => {
        this.broadcastManager?.broadcastCityDataToPlayer(gameId, playerId);
      },
      syncGameStateToPlayer: (gameId: string, playerId: string) => {
        this.broadcastManager?.syncGameStateToPlayer(gameId, playerId);
      },
    } as any; // Cast to any to satisfy type requirements temporarily

    const cultureManager = this.createCultureManager(rulesetName);
    cultureManager.setRuntimeState({
      getCity: cityId => cityManager.getCity(cityId),
      getPlayer: playerId => players.get(playerId),
    });
    const economicManager = this.createEconomicManager(gameId, effectsManager);
    economicManager.setGovernmentProvider(
      playerId => governmentManager.getPlayerGovernment(playerId)?.currentGovernment ?? 'despotism'
    );
    const tm = new TurnManager(
      gameId,
      this.databaseProvider,
      this.io,
      unitManager,
      cityManager,
      researchManager,
      borderManager,
      visibilityManager,
      cultureManager,
      mockBroadcastManager,
      economicManager,
      governmentManager,
      effectsManager
    );
    const playerIds = Array.from(players.keys());
    await tm.initializeTurn(playerIds);
    // @reference reference/freeciv/server/unittools.c:1215-1280
    unitManager.setCurrentTurnProvider(() => tm.getCurrentTurn());
    // @reference reference/freeciv/server/citytools.c:639-690
    cityManager.setCurrentTurnProvider(() => tm.getCurrentTurn());

    // Initialize economic system
    await economicManager.initialize();
    cityManager.setTreasuryProviders(
      playerId => economicManager.getPlayerGold(playerId),
      async (playerId, amount) =>
        (
          await economicManager.spendPlayerGold(playerId, amount, 'Rush city production', {
            turn: tm.getCurrentTurn(),
          })
        ).success
    );

    // Restore authoritative treasury and rates instead of resetting persisted
    // players to EconomicManager's new-player defaults.
    // @reference reference/freeciv/server/savegame/savegame3.c:6543-6603
    for (const playerId of playerIds) {
      const player = databasePlayers.find(candidate => candidate.id === playerId);
      await economicManager.initializePlayer(playerId, player?.gold ?? 0, {
        tax: player?.taxRate ?? DEFAULT_TAX_RATES.tax,
        luxury: player?.luxuryRate ?? DEFAULT_TAX_RATES.luxury,
        science: player?.scienceRate ?? DEFAULT_TAX_RATES.science,
      });
    }
    cityManager.setPlayerTaxRatesProvider(playerId => economicManager.getPlayerTaxRates(playerId));

    return tm;
  }

  private createCityManager(gameId: string, effectsManager: EffectsManager): CityManager {
    return new CityManager(gameId, this.databaseProvider, effectsManager, {});
  }

  private createBorderManager(
    mapManager: MapManager,
    cityManager: CityManager,
    effectsManager: EffectsManager
  ): BorderManager {
    return new BorderManager(mapManager, cityManager, effectsManager);
  }

  private createBorderNetworkService(borderManager: BorderManager): BorderNetworkService {
    return new BorderNetworkService(this.io, borderManager, gameId => this.games.get(gameId));
  }

  private createUnitManager(
    gameId: string,
    game: any,
    mapManager: MapManager,
    cityManager: CityManager,
    effectsManager: EffectsManager,
    researchManager: ResearchManager
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
        broadcastUnitMoved: gameId => {
          this.broadcastManager?.broadcastVisibilityState(gameId);
        },
        broadcastUnitDestroyed: (gameId, unit) => {
          this.broadcastManager?.broadcastUnitDestroyed(gameId, unit);
        },
        getCityAt: (x: number, y: number) => {
          const city = cityManager.getCityAt(x, y);
          return city ? { id: city.id, playerId: city.playerId, buildings: city.buildings } : null;
        },
        getPlayerBuildings: playerId =>
          cityManager.getCitiesByPlayer(playerId).flatMap(city => city.buildings),
        reserveAirlift: (sourceCityId, destinationCityId, playerId, turn) =>
          cityManager.reserveAirlift(sourceCityId, destinationCityId, playerId, turn),
        establishTradeRoute: async (playerId, homeCityId, targetX, targetY) => {
          const destination = cityManager.getCityAt(targetX, targetY);
          return destination
            ? cityManager.establishTradeRoute(homeCityId, destination.id, playerId)
            : false;
        },
        executeCityUnitAction: (...args) => cityManager.executeUnitCityAction(...args),
        applyNuclearCityDamage: (...args) => cityManager.applyNuclearExplosion(...args),
        grantHutTechnology: async playerId => {
          const available = researchManager.getAvailableTechnologies(playerId);
          const technology = available[0];
          return technology && (await researchManager.grantTechnology(playerId, technology.id))
            ? technology.name
            : null;
        },
        captureCity: async (cityId, playerId, unitId) =>
          (await cityManager.captureCity(cityId, playerId, unitId)).success,
        broadcastMapChanged: (changedGameId, mapData) =>
          this.onBroadcastMapData?.(changedGameId, mapData),
      },
      effectsManager
    );
  }

  private createVisibilityManager(
    gameId: string,
    unitManager: UnitManager,
    mapManager: MapManager,
    effectsManager: EffectsManager,
    researchManager: ResearchManager
  ): VisibilityManager {
    return new VisibilityManager(
      gameId,
      unitManager,
      mapManager,
      effectsManager,
      playerId => new Set(researchManager.getResearchedTechs(playerId)),
      async (playerId, exploredTiles, visibleTiles) => {
        await this.databaseProvider
          .getDatabase()
          .update(playerRecords)
          .set({ exploredTiles, visibleTiles })
          .where(eq(playerRecords.id, playerId));
      }
    );
  }

  private createResearchManager(gameId: string): ResearchManager {
    return new ResearchManager(gameId, this.databaseProvider);
  }

  private createCultureManager(rulesetName: string): CultureManager {
    return new CultureManager(this.databaseProvider, rulesetName);
  }

  private createEconomicManager(gameId: string, effectsManager: EffectsManager): EconomicManager {
    return new EconomicManager(gameId, this.databaseProvider, effectsManager);
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
    pathfindingManager: PathfindingManager,
    borderManager: BorderManager,
    governmentManager: GovernmentManager
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
      borderManager,
      governmentManager,
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
