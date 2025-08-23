import { logger } from '../utils/logger';
import { db } from '../database';
import { gameState } from '../database/redis';
import { games, players } from '../database/schema';
import { eq } from 'drizzle-orm';
import { TurnManager } from './TurnManager';
import { MapManager } from './MapManager';
import { UnitManager } from './UnitManager';
import { VisibilityManager } from './VisibilityManager';
import { CityManager } from './CityManager';
import { ResearchManager } from './ResearchManager';
import { Server as SocketServer } from 'socket.io';

export type GameState = 'waiting' | 'starting' | 'active' | 'paused' | 'ended';
export type TurnPhase = 'movement' | 'production' | 'research' | 'diplomacy';

export interface GameConfig {
  name: string;
  hostId: string;
  maxPlayers?: number;
  mapWidth?: number;
  mapHeight?: number;
  ruleset?: string;
  turnTimeLimit?: number;
  victoryConditions?: string[];
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
  private io: SocketServer;
  private games = new Map<string, GameInstance>();
  private playerToGame = new Map<string, string>();

  private constructor(io: SocketServer) {
    this.io = io;
  }

  public static getInstance(io: SocketServer): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager(io);
    }
    return GameManager.instance;
  }

  public async createGame(config: GameConfig): Promise<string> {
    logger.info('Creating new game', { name: config.name, hostId: config.hostId });

    // Create game in database
    const gameData = {
      name: config.name,
      hostId: config.hostId,
      maxPlayers: config.maxPlayers || 8,
      mapWidth: config.mapWidth || 80,
      mapHeight: config.mapHeight || 50,
      ruleset: config.ruleset || 'classic',
      turnTimeLimit: config.turnTimeLimit,
      victoryConditions: config.victoryConditions || ['conquest', 'science', 'culture'],
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
    
    // Automatically join the creator to the game
    logger.info('Auto-joining game creator', { gameId: newGame.id, hostId: config.hostId });
    try {
      await this.joinGame(newGame.id, config.hostId, 'random');
    } catch (error) {
      logger.error('Failed to auto-join creator to game:', error);
    }
    
    return newGame.id;
  }

  public async joinGame(gameId: string, userId: string, civilization?: string): Promise<string> {
    logger.info('🚀 JOINAME METHOD CALLED WITH DEBUG 🚀', { gameId, userId, civilization });
    
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

    if (game.status !== 'waiting') {
      throw new Error('Game is not accepting new players');
    }

    if (game.players.length >= game.maxPlayers) {
      throw new Error('Game is full');
    }

    // Check if user is already in the game
    const existingPlayer = game.players.find(p => p.userId === userId);
    if (existingPlayer) {
      return existingPlayer.id; // Already joined
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

    // Notify all players in the game
    this.broadcastToGame(gameId, 'player-joined', {
      playerId: newPlayer.id,
      playerNumber,
      civilization: playerData.civilization,
      playerCount: game.players.length + 1,
    });

    // Auto-start game if not already started and conditions are met
    const updatedGame = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: { players: true },
    });
    
    logger.debug('Checking auto-start conditions', { 
      gameId, 
      gameExists: !!updatedGame,
      gameStatus: updatedGame?.status,
      playerCount: updatedGame?.players.length 
    });
    
    if (updatedGame && updatedGame.status === 'waiting' && updatedGame.players.length >= 1) {
      logger.info('Auto-starting game', { gameId, playerCount: updatedGame.players.length });
      try {
        await this.startGame(gameId, newPlayer.id);
      } catch (error) {
        logger.error('Failed to auto-start game:', error);
      }
    } else {
      logger.debug('Auto-start conditions not met', {
        gameId,
        hasGame: !!updatedGame,
        status: updatedGame?.status,
        playerCount: updatedGame?.players.length
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

    if (game.players.length < 2) {
      throw new Error('Need at least 2 players to start');
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
    await this.initializeGameInstance(gameId, game);

    // Notify all players that the game has started
    this.broadcastToGame(gameId, 'game-started', {
      gameId,
      currentTurn: 1,
    });

    logger.info('Game started successfully', { gameId });
  }

  private async initializeGameInstance(gameId: string, game: any): Promise<void> {
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

    // Initialize managers
    const mapManager = new MapManager(game.mapWidth, game.mapHeight);
    const turnManager = new TurnManager(gameId, this.io);
    const unitManager = new UnitManager(gameId, game.mapWidth, game.mapHeight);
    const visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);
    const cityManager = new CityManager(gameId);
    const researchManager = new ResearchManager(gameId);

    // Generate the map with starting positions
    await mapManager.generateMap(players);

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

    // Send initial map data to all players
    this.broadcastMapData(gameId, mapData);
  }

  private broadcastMapData(gameId: string, mapData: any): void {
    this.broadcastToGame(gameId, 'map-data', {
      gameId,
      width: mapData.width,
      height: mapData.height,
      startingPositions: mapData.startingPositions,
      seed: mapData.seed,
      generatedAt: mapData.generatedAt,
    });

    // Send visible tiles to each player based on their starting position
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      for (const startPos of mapData.startingPositions) {
        const visibleTiles = gameInstance.mapManager.getVisibleTiles(
          startPos.x,
          startPos.y,
          2 // Initial sight radius
        );

        // Send individual tile-info packets (like freeciv-web) for each visible tile
        visibleTiles.forEach(tile => {
          const tileId = tile.x * 1000 + tile.y; // Simple tile ID calculation
          this.emitToPlayer(gameId, startPos.playerId, 'tile-info', {
            tile: tileId,
            x: tile.x,
            y: tile.y,
            terrain: tile.terrain,
            resource: tile.resource,
            elevation: tile.elevation,
            riverMask: tile.riverMask,
            isExplored: true,
            isVisible: true,
          });
        });
      }
    }
  }

  public async getGame(gameId: string): Promise<any | null> {
    return await this.getGameById(gameId);
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

    // Broadcast unit creation to all players
    this.broadcastToGame(gameId, 'unit_created', {
      gameId,
      unit: {
        id: unit.id,
        playerId: unit.playerId,
        unitType: unit.unitTypeId,
        x: unit.x,
        y: unit.y,
        health: unit.health,
        movementLeft: unit.movementLeft,
      },
    });

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
      const updatedUnit = gameInstance.unitManager.getUnit(unitId)!;

      // Update visibility for the player
      gameInstance.visibilityManager.onUnitMoved(playerId);

      // Broadcast unit movement to all players
      this.broadcastToGame(gameId, 'unit_moved', {
        gameId,
        unitId,
        x: updatedUnit.x,
        y: updatedUnit.y,
        movementLeft: updatedUnit.movementLeft,
      });
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

    // Broadcast combat result to all players
    this.broadcastToGame(gameId, 'unit_combat', {
      gameId,
      combatResult,
    });

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

    // Broadcast fortification to all players
    this.broadcastToGame(gameId, 'unit_fortified', {
      gameId,
      unitId,
    });
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
      throw new Error('Game not found');
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

    // Broadcast city founding to all players
    this.broadcastToGame(gameId, 'city_founded', {
      gameId,
      city: {
        id: cityId,
        playerId,
        name,
        x,
        y,
        population: 1,
      },
    });

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

    // Broadcast production change to all players
    this.broadcastToGame(gameId, 'city_production_changed', {
      gameId,
      cityId,
      production,
      type,
    });
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

    // Broadcast research change to the player
    this.broadcastToGame(gameId, 'research_changed', {
      gameId,
      playerId,
      techId,
      availableTechs: gameInstance.researchManager.getAvailableTechnologies(playerId),
    });
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

    // Broadcast goal change to the player
    this.broadcastToGame(gameId, 'research_goal_changed', {
      gameId,
      playerId,
      techGoal: techId,
    });
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
        // Broadcast tech completion to all players
        this.broadcastToGame(gameId, 'tech_completed', {
          gameId,
          playerId,
          techId: completedTech,
          playerName: player.civilization,
          availableTechs: gameInstance.researchManager.getAvailableTechnologies(playerId),
        });

        logger.info('Technology completed', { gameId, playerId, techId: completedTech });
      }
    }
  }

  private broadcastToGame(gameId: string, event: string, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    // Broadcast to the specific game room instead of all sockets
    this.io.to(`game:${gameId}`).emit(event, data);
  }

  private emitToPlayer(gameId: string, playerId: string, event: string, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    const player = gameInstance.players.get(playerId);
    if (!player || !player.isConnected) return;

    // Emit to player-specific room using their userId
    // Sockets should join player-specific rooms when they connect
    this.io.to(`player:${player.userId}`).emit(event, data);
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
