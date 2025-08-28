/* eslint-disable @typescript-eslint/no-explicit-any, complexity */
import { logger } from '../utils/logger';
import { db } from '../database';
import { gameState } from '../database/redis';
import { games, players } from '../database/schema';
import { eq } from 'drizzle-orm';
import serverConfig from '../config';
import { TurnManager } from './TurnManager';
import { MapManager, MapGeneratorType } from './MapManager';
import { UnitManager } from './UnitManager';
import { VisibilityManager } from './VisibilityManager';
import { CityManager } from './CityManager';
import { ResearchManager } from './ResearchManager';
import { MapStartpos } from './map/MapTypes';
// HTTP-only implementation

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
  lastActivity: Date;
}

export interface PlayerState {
  id: string;
  userId: string;
  playerNumber: number;
  civilization: string;
  isReady: boolean;
  hasEndedTurn: boolean;
  isConnected: boolean;
  lastSeen: Date;
}

export class GameManager {
  private static instance: GameManager;
  private games = new Map<string, GameInstance>();
  private playerToGame = new Map<string, string>();

  private constructor() {
    // HTTP-only GameManager - no Socket.IO needed
  }

  public static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  public async createGame(gameConfig: GameConfig): Promise<string> {
    logger.info('Creating new game', { name: gameConfig.name, hostId: gameConfig.hostId });

    // Create game in database
    const gameData = {
      name: gameConfig.name,
      hostId: gameConfig.hostId,
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

    const [newGame] = await db.insert(games).values(gameData).returning();

    // Cache basic game data in Redis for performance
    await gameState.setGameState(newGame.id, {
      state: newGame.status,
      currentTurn: newGame.currentTurn,
      turnPhase: newGame.turnPhase,
      playerCount: 0,
    });

    logger.info('Game created successfully', { gameId: newGame.id });

    // Creator will join via separate API call
    // This ensures proper socket room management

    return newGame.id;
  }

  public async joinGame(gameId: string, userId: string, civilization?: string): Promise<string> {
    // Get game from database
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    // Check if user is already in the game first
    const existingPlayer = game.players.find(p => p.userId === userId);
    if (existingPlayer) {
      return existingPlayer.id; // Already joined
    }

    if (game.status !== 'waiting') {
      throw new Error('Game is not accepting new players');
    }

    if (game.players.length >= game.maxPlayers) {
      throw new Error('Game is full');
    }

    // Create player in database
    const playerNumber = game.players.length + 1;
    const playerData = {
      gameId,
      userId,
      playerNumber,
      civilization: civilization || `Civilization${playerNumber}`,
      leaderName: `Leader${playerNumber}`,
      color: {
        r: Math.floor(Math.random() * 255),
        g: Math.floor(Math.random() * 255),
        b: Math.floor(Math.random() * 255),
      },
    };

    const [newPlayer] = await db.insert(players).values(playerData).returning();

    // Update Redis cache
    await gameState.setGameState(gameId, {
      state: game.status,
      currentTurn: game.currentTurn,
      turnPhase: game.turnPhase,
      playerCount: game.players.length + 1,
    });

    logger.info('Player joined game', { gameId, playerId: newPlayer.id, userId });

    // Player joined - state updated in database

    // Auto-start game if not already started and conditions are met
    const updatedGame = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });

    logger.debug('Checking auto-start conditions', {
      gameId,
      gameExists: !!updatedGame,
      gameStatus: updatedGame?.status,
      playerCount: updatedGame?.players.length,
    });

    if (
      updatedGame &&
      updatedGame.status === 'waiting' &&
      updatedGame.players.length >= serverConfig.game.minPlayersToStart
    ) {
      logger.info('Auto-starting game', { gameId, playerCount: updatedGame.players.length });
      try {
        // Small delay to ensure socket room joins have completed
        // Small delay to ensure socket room joins are complete
        await new Promise(resolve => setTimeout(resolve, 200));
        await this.startGame(gameId, updatedGame.hostId);
      } catch (error) {
        logger.error('Failed to auto-start game:', error);
      }
    } else {
      logger.debug('Auto-start conditions not met', {
        gameId,
        hasGame: !!updatedGame,
        status: updatedGame?.status,
        playerCount: updatedGame?.players.length,
      });
    }

    return newPlayer.id;
  }

  public async startGame(gameId: string, hostId: string): Promise<void> {
    // Get game from database
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    if (game.hostId !== hostId) {
      throw new Error('Only the host can start the game');
    }

    if (game.players.length < serverConfig.game.minPlayersToStart) {
      throw new Error(`Need at least ${serverConfig.game.minPlayersToStart} players to start`);
    }

    if (game.status !== 'waiting') {
      throw new Error('Game is not in waiting state');
    }

    logger.info('Starting game', { gameId, playerCount: game.players.length });

    // Update database to active state
    await db
      .update(games)
      .set({
        status: 'active',
        startedAt: new Date(),
        currentTurn: 1,
      })
      .where(eq(games.id, gameId));

    // Update Redis cache
    await gameState.setGameState(gameId, {
      state: 'active',
      currentTurn: 1,
      turnPhase: 'movement',
      playerCount: game.players.length,
    });

    // Initialize the in-memory game instance with map generation
    const storedTerrainSettings = (game.gameState as any)?.terrainSettings;
    await this.initializeGameInstance(gameId, game, storedTerrainSettings);

    // Game started - state updated in database

    logger.info('Game started successfully', { gameId });
  }

  private async initializeGameInstance(
    gameId: string,
    game: any,
    terrainSettings?: TerrainSettings
  ): Promise<void> {
    logger.info('Initializing game instance', { gameId });

    // Create player state map
    const players = new Map<string, PlayerState>();
    for (const dbPlayer of game.players) {
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

      // Track player to game mapping
      this.playerToGame.set(dbPlayer.id, gameId);
    }

    // Initialize managers with terrain settings
    const mapGenerator = terrainSettings?.generator || 'random';
    const mapManager = new MapManager(game.mapWidth, game.mapHeight, undefined, mapGenerator);
    const turnManager = new TurnManager(gameId);
    const unitManager = new UnitManager(gameId, game.mapWidth, game.mapHeight);
    const visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);
    const cityManager = new CityManager(gameId);
    const researchManager = new ResearchManager(gameId);

    // Generate the map with starting positions based on terrain settings
    const generator = terrainSettings?.generator || 'random';
    // Get startpos setting for island-based generators (from fix-map-duplicate-creation branch)
    const startpos = terrainSettings?.startpos ?? MapStartpos.DEFAULT;
    logger.debug('Map generation starting', { terrainSettings, generator, startpos });

    // Use restructured MapManager with proper generator routing
    // @reference freeciv/server/generator/mapgen.c:1315-1341
    // Delegates to MapManager's restructured generateMap() with fallback logic
    const generatorType = this.convertGeneratorType(generator);
    let generationAttempted = false;
    let lastError: Error | null = null;

    try {
      logger.info('Delegating to restructured MapManager', {
        generator,
        generatorType,
        reference: 'apps/server/src/game/MapManager.ts:97-138',
      });

      // Delegate to restructured MapManager system
      await mapManager.generateMap(players, generatorType);
      generationAttempted = true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error('Map generation failed, attempting emergency recovery', {
        generator: generatorType,
        error: lastError.message,
      });
    }

    // Emergency fallback sequence (defensive addition, not in freeciv)
    if (!generationAttempted || !mapManager.getMapData()) {
      logger.warn('Initiating emergency fallback sequence (defensive extension)');

      try {
        logger.info('Emergency fallback: MAPGEN_FRACTAL');
        await mapManager.generateMap(players, 'FRACTAL');
        generationAttempted = true;
      } catch (error) {
        logger.error('Emergency fractal failed, trying final MAPGEN_RANDOM fallback', {
          error: error instanceof Error ? error.message : error,
        });

        try {
          logger.info('Final emergency fallback: MAPGEN_RANDOM');
          await mapManager.generateMap(players, 'RANDOM');
          generationAttempted = true;
        } catch (error) {
          const finalError = error instanceof Error ? error : new Error(String(error));
          logger.error('All generation methods exhausted', {
            originalError: lastError?.message,
            finalError: finalError.message,
          });
          throw new Error(
            `Complete map generation failure. Original: ${lastError?.message || 'unknown'}, Final: ${finalError.message}`
          );
        }
      }
    }

    const mapData = mapManager.getMapData();
    if (!mapData) {
      throw new Error('Failed to generate map data');
    }

    logger.info('Map generated successfully', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      startingPositions: mapData.startingPositions.length,
    });

    // Create game instance
    const gameInstance: GameInstance = {
      id: gameId,
      config: {
        name: game.name,
        hostId: game.hostId,
        maxPlayers: game.maxPlayers,
        mapWidth: game.mapWidth,
        mapHeight: game.mapHeight,
        ruleset: game.ruleset,
        turnTimeLimit: game.turnTimeLimit,
        victoryConditions: game.victoryConditions || ['conquest', 'science', 'culture'],
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
      lastActivity: new Date(),
    };

    // Store the game instance
    this.games.set(gameId, gameInstance);

    // Initialize research and visibility for all players
    for (const player of players.values()) {
      await researchManager.initializePlayerResearch(player.id);
      visibilityManager.initializePlayerVisibility(player.id);
      // Grant initial visibility around starting position
      visibilityManager.updatePlayerVisibility(player.id);
    }

    // Map data is now available via HTTP API endpoints
  }

  /**
   * Convert string generator type to MapGeneratorType enum
   * @param generator String generator identifier from client
   * @returns MapGeneratorType enum value for MapManager
   */
  private convertGeneratorType(generator: string): MapGeneratorType {
    switch (generator.toLowerCase()) {
      case 'fair':
        return 'FAIR';
      case 'island':
        return 'ISLAND';
      case 'random':
        return 'RANDOM';
      case 'fracture':
        return 'FRACTURE';
      case 'fractal':
        return 'FRACTAL';
      case 'scenario':
        return 'SCENARIO';
      default:
        logger.warn('Unknown generator type, defaulting to FRACTAL', { generator });
        return 'FRACTAL';
    }
  }

  public async getGame(gameId: string): Promise<any | null> {
    return await this.getGameById(gameId);
  }

  public getGameInstance(gameId: string): GameInstance | null {
    return this.games.get(gameId) || null;
  }

  public getAllGameInstances(): GameInstance[] {
    return Array.from(this.games.values());
  }

  public getActiveGameInstances(): GameInstance[] {
    return Array.from(this.games.values()).filter(game => game.state === 'active');
  }

  public async getGameByPlayerId(playerId: string): Promise<any | null> {
    try {
      const player = await db.query.players.findFirst({
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

  public async getAllGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase();
  }

  public async getActiveGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase();
  }

  public async getAllGamesFromDatabase(): Promise<any[]> {
    try {
      const dbGames = await db.query.games.findMany({
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

      return dbGames.map(game => ({
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
      }));
    } catch (error) {
      logger.error('Error fetching games from database:', error);
      return [];
    }
  }

  public async getGameListForLobby(): Promise<any[]> {
    // All games come from database now - single source of truth
    return await this.getAllGamesFromDatabase();
  }

  public async getGameById(gameId: string): Promise<any | null> {
    try {
      const game = await db.query.games.findFirst({
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
        hostId: game.hostId,
        hostName: game.host?.username || 'Unknown',
        status: game.status,
        players: game.players,
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

  public async updatePlayerConnection(playerId: string, isConnected: boolean): Promise<void> {
    const gameId = this.playerToGame.get(playerId);
    if (!gameId) return;

    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    const player = gameInstance.players.get(playerId);
    if (!player) return;

    player.isConnected = isConnected;
    player.lastSeen = new Date();

    if (isConnected) {
      logger.info('Player reconnected', { gameId, playerId });
    } else {
      logger.info('Player disconnected', { gameId, playerId });

      // Check if all players are disconnected
      const allDisconnected = Array.from(gameInstance.players.values()).every(p => !p.isConnected);

      if (allDisconnected && gameInstance.state === 'active') {
        gameInstance.state = 'paused';
        logger.info('Game paused - all players disconnected', { gameId });
      }
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

      // Reset player turn status for next turn
      for (const player of gameInstance.players.values()) {
        player.hasEndedTurn = false;
      }

      return true; // Turn advanced
    }

    return false; // Waiting for other players
  }

  // Unit management methods
  public async createUnit(
    gameId: string,
    playerId: string,
    unitType: string,
    x: number,
    y: number
  ): Promise<string> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot create units unless game is active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    const unit = await gameInstance.unitManager.createUnit(playerId, unitType, x, y);

    // Update visibility for the player
    gameInstance.visibilityManager.onUnitCreated(playerId);

    // Unit created - state updated in database

    return unit.id;
  }

  public async moveUnit(
    gameId: string,
    playerId: string,
    unitId: string,
    x: number,
    y: number
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot move units unless game is active');
    }

    // Verify unit belongs to player
    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit || unit.playerId !== playerId) {
      throw new Error('Unit not found or does not belong to player');
    }

    const moved = await gameInstance.unitManager.moveUnit(unitId, x, y);

    if (moved) {
      // Update visibility for the player
      gameInstance.visibilityManager.onUnitMoved(playerId);

      // Unit moved - state updated in database
    }

    return moved;
  }

  public async attackUnit(
    gameId: string,
    playerId: string,
    attackerUnitId: string,
    defenderUnitId: string
  ) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot attack unless game is active');
    }

    // Verify attacking unit belongs to player
    const attackerUnit = gameInstance.unitManager.getUnit(attackerUnitId);
    if (!attackerUnit || attackerUnit.playerId !== playerId) {
      throw new Error('Attacking unit not found or does not belong to player');
    }

    const combatResult = await gameInstance.unitManager.attackUnit(attackerUnitId, defenderUnitId);

    // Update visibility for relevant players if units were destroyed
    if (combatResult.attackerDestroyed) {
      gameInstance.visibilityManager.onUnitDestroyed(playerId);
    }
    if (combatResult.defenderDestroyed) {
      // Find the defender's player
      const defenderUnit = gameInstance.unitManager.getUnit(defenderUnitId);
      if (defenderUnit) {
        gameInstance.visibilityManager.onUnitDestroyed(defenderUnit.playerId);
      }
    }

    // Combat resolved - state updated in database

    return combatResult;
  }

  public async fortifyUnit(gameId: string, playerId: string, unitId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Verify unit belongs to player
    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit || unit.playerId !== playerId) {
      throw new Error('Unit not found or does not belong to player');
    }

    await gameInstance.unitManager.fortifyUnit(unitId);

    // Unit fortified - state updated in database
  }

  public getPlayerUnits(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.unitManager.getPlayerUnits(playerId);
  }

  public getVisibleUnits(gameId: string, playerId: string, visibleTiles?: Set<string>) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Use visibility manager if no visibleTiles provided
    const tiles = visibleTiles || gameInstance.visibilityManager.getVisibleTiles(playerId);
    return gameInstance.unitManager.getVisibleUnits(playerId, tiles);
  }

  public getPlayerMapView(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.visibilityManager.getPlayerMapView(playerId);
  }

  public getTileVisibility(gameId: string, playerId: string, x: number, y: number) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.visibilityManager.getTileVisibility(playerId, x, y);
  }

  public updatePlayerVisibility(gameId: string, playerId: string): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
  }

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

  // City management methods
  public async foundCity(
    gameId: string,
    playerId: string,
    name: string,
    x: number,
    y: number
  ): Promise<string> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot found cities unless game is active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    // Check if there's already a city at this position
    const existingCity = gameInstance.cityManager.getCityAt(x, y);
    if (existingCity) {
      throw new Error('There is already a city at this location');
    }

    const cityId = await gameInstance.cityManager.foundCity(
      playerId,
      name,
      x,
      y,
      gameInstance.currentTurn
    );

    // City founded - state updated in database

    return cityId;
  }

  public async setCityProduction(
    gameId: string,
    playerId: string,
    cityId: string,
    production: string,
    type: 'unit' | 'building'
  ): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    await gameInstance.cityManager.setCityProduction(cityId, production, type);

    // Production changed - state updated in database
  }

  public getPlayerCities(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.cityManager.getPlayerCities(playerId);
  }

  public getCity(gameId: string, cityId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.cityManager.getCity(cityId);
  }

  // Research management methods
  public async setPlayerResearch(gameId: string, playerId: string, techId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    await gameInstance.researchManager.setCurrentResearch(playerId, techId);

    // Research changed - state updated in database
  }

  public async setResearchGoal(gameId: string, playerId: string, techId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    await gameInstance.researchManager.setResearchGoal(playerId, techId);

    // Research goal changed - state updated in database
  }

  public getPlayerResearch(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getPlayerResearch(playerId);
  }

  public getAvailableTechnologies(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getAvailableTechnologies(playerId);
  }

  public getResearchProgress(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.researchManager.getResearchProgress(playerId);
  }

  public async processResearchTurn(gameId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Process research for each player
    for (const [playerId, player] of gameInstance.players) {
      if (!player.isConnected) continue;

      // Get science output from cities
      const playerCities = gameInstance.cityManager.getPlayerCities(playerId);
      let totalScience = 0;

      for (const city of playerCities) {
        totalScience += city.sciencePerTurn || 0;
      }

      // Add research points and check for completed techs
      const completedTech = await gameInstance.researchManager.addResearchPoints(
        playerId,
        totalScience
      );

      if (completedTech) {
        // Tech completed - state updated in database

        logger.info('Technology completed', { gameId, playerId, techId: completedTech });
      }
    }
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
          await db
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
}
