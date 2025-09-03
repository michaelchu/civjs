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
import { PathfindingManager } from './PathfindingManager';
import { MapStartpos } from './map/MapTypes';
import { Server as SocketServer } from 'socket.io';
import { PacketType, PACKET_NAMES } from '../types/packet';

import { RulesetLoader } from '../shared/data/rulesets/RulesetLoader';

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

  public async createGame(gameConfig: GameConfig): Promise<string> {
    logger.info('Creating new game', { name: gameConfig.name, hostId: gameConfig.hostId });

    // Create game in database
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

    const [newGame] = await db.insert(games).values(gameData).returning();

    // Cache basic game data in Redis for performance
    await gameState.setGameState(newGame.id, {
      state: newGame.status,
      currentTurn: newGame.currentTurn,
      turnPhase: newGame.turnPhase,
      playerCount: 0,
    });

    logger.info('Game created successfully', { gameId: newGame.id });

    // Note: The Socket.IO handler will handle joining the creator to the game
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
      return existingPlayer.id; // Already joined - allow rejoining at any game status
    }

    // Only allow new players in waiting games
    if (game.status !== 'waiting') {
      throw new Error('Game is not accepting new players');
    }

    if (game.players.length >= game.maxPlayers) {
      throw new Error('Game is full');
    }

    // Create player in database
    const playerNumber = game.players.length + 1;

    // Handle random nation selection
    let selectedNation = civilization || 'american';
    if (civilization === 'random') {
      try {
        const loader = RulesetLoader.getInstance();
        const nationsRuleset = loader.loadNationsRuleset('classic');

        if (nationsRuleset) {
          // Get playable nations (exclude barbarian)
          const playableNations = Object.values(nationsRuleset.nations)
            .filter(nation => nation.id !== 'barbarian')
            .map(nation => nation.id);

          // Randomly select from available nations
          if (playableNations.length > 0) {
            const randomIndex = Math.floor(Math.random() * playableNations.length);
            selectedNation = playableNations[randomIndex];
          }
        }
      } catch (error) {
        logger.warn('Failed to load nations for random selection, using default', error);
        selectedNation = 'american';
      }
    }

    const playerData = {
      gameId,
      userId,
      playerNumber,
      nation: selectedNation,
      civilization: selectedNation || `Civilization${playerNumber}`,
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
      playerCount: updatedGame?.players.length,
    });

    // Auto-start logic: immediately start single-player games, or start multiplayer when enough players join
    if (updatedGame && updatedGame.status === 'waiting') {
      const shouldAutoStart =
        updatedGame.gameType === 'single' || // Always start single-player games
        updatedGame.players.length >= serverConfig.game.minPlayersToStart; // Start multiplayer when enough players

      if (shouldAutoStart) {
        logger.info('Auto-starting game', {
          gameId,
          gameType: updatedGame.gameType,
          playerCount: updatedGame.players.length,
        });
        try {
          // Small delay to ensure socket room joins are complete
          await new Promise(resolve => setTimeout(resolve, 200));
          await this.startGame(gameId, updatedGame.hostId);
        } catch (error) {
          logger.error('Failed to auto-start game:', error);
        }
      } else {
        logger.debug('Auto-start conditions not met', {
          gameId,
          gameType: updatedGame.gameType,
          hasGame: !!updatedGame,
          status: updatedGame?.status,
          playerCount: updatedGame?.players.length,
        });
      }
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

    // Different minimum requirements for single vs multiplayer
    const minPlayers = game.gameType === 'single' ? 1 : serverConfig.game.minPlayersToStart;
    if (game.players.length < minPlayers) {
      throw new Error(`Need at least ${minPlayers} players to start`);
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

    // Notify all players that the game has started
    this.broadcastToGame(gameId, 'game-started', {
      gameId,
      currentTurn: 1,
    });

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
    const temperatureParam = terrainSettings?.temperature ?? 50;
    const mapManager = new MapManager(
      game.mapWidth,
      game.mapHeight,
      undefined,
      mapGenerator,
      undefined,
      undefined,
      false,
      temperatureParam
    );
    const turnManager = new TurnManager(gameId, this.io);
    const unitManager = new UnitManager(gameId, game.mapWidth, game.mapHeight, mapManager, {
      foundCity: this.foundCity.bind(this),
      requestPath: this.requestPath.bind(this),
      broadcastUnitMoved: (gameId, unitId, x, y, movementLeft) => {
        this.broadcastToGame(gameId, 'unit_moved', { gameId, unitId, x, y, movementLeft });
      },
    });

    // Initialize turn system with player IDs
    const playerIds = Array.from(players.keys());
    await turnManager.initializeTurn(playerIds);
    const visibilityManager = new VisibilityManager(gameId, unitManager, mapManager);
    const cityManager = new CityManager(gameId);
    const researchManager = new ResearchManager(gameId);
    const pathfindingManager = new PathfindingManager(game.mapWidth, game.mapHeight, mapManager);

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
            `Complete map generation failure. Original: ${
              lastError?.message || 'unknown'
            }, Final: ${finalError.message}`
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
      pathfindingManager,
      lastActivity: new Date(),
    };

    // Store the game instance
    this.games.set(gameId, gameInstance);

    // Persist map data to database for recovery after server restarts
    await this.persistMapDataToDatabase(gameId, mapData, terrainSettings);

    // Initialize research and visibility for all players
    for (const player of players.values()) {
      await researchManager.initializePlayerResearch(player.id);
      visibilityManager.initializePlayerVisibility(player.id);
      // Grant initial visibility around starting position
      visibilityManager.updatePlayerVisibility(player.id);
    }

    // Create starting units for all players (settler + warrior)
    // @reference freeciv/server/plrhand.c:player_init() - create_start_unit()
    await this.createStartingUnits(gameId, mapData, unitManager);

    // Update visibility after units are created to reveal starting positions
    for (const player of players.values()) {
      visibilityManager.updatePlayerVisibility(player.id);
    }

    // Send initial map data to all players (with delay to ensure socket room joins are complete)
    // Delay map broadcasting to ensure socket room joins are complete
    setTimeout(() => {
      this.broadcastMapData(gameId, mapData);
    }, 300);
  }

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

  /**
   * Persist map data to database for recovery after server restarts
   */
  private async persistMapDataToDatabase(
    gameId: string,
    mapData: any,
    terrainSettings?: TerrainSettings
  ): Promise<void> {
    try {
      logger.info('Persisting map data to database', { gameId });

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
      await db
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

      logger.info('Map data persisted successfully', {
        gameId,
        mapSize: `${mapData.width}x${mapData.height}`,
      });
    } catch (error) {
      logger.error('Failed to persist map data to database:', error);
      // Don't throw error to avoid breaking game initialization
    }
  }

  /**
   * Create starting units for all players at their starting positions
   * @reference freeciv/server/plrhand.c:player_init() - create_start_unit()
   * Each player starts with a settler (city founder) and a warrior (military unit)
   */
  private async createStartingUnits(gameId: string, mapData: any, unitManager: any): Promise<void> {
    try {
      logger.info('Creating starting units for all players', { gameId });

      const gameInstance = this.games.get(gameId);
      if (!gameInstance) {
        throw new Error('Game instance not found');
      }

      // Create starting units for each player
      for (const player of gameInstance.players.values()) {
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
   * Serialize map tiles for database storage (compress large tile arrays)
   */
  private serializeMapTiles(tiles: any[][]): any {
    // Store only essential tile data to reduce database size
    const compressedTiles: any = {};

    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        const tile = tiles[y][x];
        if (tile && tile.terrain !== 'ocean') {
          // Only store non-ocean tiles to save space
          const key = `${x},${y}`;
          compressedTiles[key] = {
            terrain: tile.terrain,
            elevation: tile.elevation,
            resource: tile.resource,
            riverMask: tile.riverMask,
            continentId: tile.continentId,
            temperature: tile.temperature,
            wetness: tile.wetness,
          };
        }
      }
    }

    return compressedTiles;
  }

  /**
   * Recover game instance from database when not found in memory
   * This handles cases where the server restarted and game instances were lost
   */
  public async recoverGameInstance(gameId: string): Promise<GameInstance | null> {
    try {
      logger.info('Attempting to recover game instance from database', { gameId });

      // Get game from database with all related data
      const game = await db.query.games.findFirst({
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
      const turnManager = new TurnManager(gameId, this.io);
      const unitManager = new UnitManager(gameId, game.mapWidth, game.mapHeight, mapManager, {
        foundCity: this.foundCity.bind(this),
        requestPath: this.requestPath.bind(this),
        broadcastUnitMoved: (gameId, unitId, x, y, movementLeft) => {
          this.broadcastToGame(gameId, 'unit_moved', { gameId, unitId, x, y, movementLeft });
        },
      });

      // Initialize turn system with existing player IDs
      const playerIds = Array.from(players.keys());
      await turnManager.initializeTurn(playerIds);
      const cityManager = new CityManager(gameId);
      const researchManager = new ResearchManager(gameId);
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
   * Restore map data from database to MapManager
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
    return await this.getAllGamesFromDatabase(null);
  }

  public async getActiveGames(): Promise<any[]> {
    return await this.getAllGamesFromDatabase(null);
  }

  public async getAllGamesFromDatabase(userId?: string | null): Promise<any[]> {
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

    // Update database connection status
    try {
      await db
        .update(players)
        .set({
          connectionStatus: isConnected ? 'connected' : 'disconnected',
          lastActionAt: new Date(),
        })
        .where(eq(players.id, playerId));
    } catch (error) {
      logger.error('Failed to update player connection status in database:', error);
    }

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

  /**
   * Get count of connected players for a game
   */
  private getConnectedPlayerCount(gameId: string): number {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return 0;

    return Array.from(gameInstance.players.values()).filter(p => p.isConnected).length;
  }

  private broadcastToGame(gameId: string, event: string, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    // Broadcast to all sockets in the specific game room
    this.io.to(`game:${gameId}`).emit(event, data);
  }

  private broadcastPacketToGame(gameId: string, packetType: PacketType, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    // Create packet structure and broadcast to game room
    const packet = {
      type: packetType,
      data,
      timestamp: Date.now(),
    };

    this.io.to(`game:${gameId}`).emit('packet', packet);

    logger.debug('Broadcasted structured packet to game room', {
      gameId,
      packetType: PACKET_NAMES[packetType] || packetType,
      data: Array.isArray(data?.tiles)
        ? { tilesCount: data.tiles.length, ...data, tiles: '[truncated]' }
        : data,
    });
  }

  public async deleteGame(gameId: string, userId?: string): Promise<void> {
    // Check if game exists
    const game = await db.query.games.findFirst({
      where: eq(games.id, gameId),
      with: {
        players: true,
      },
    });

    if (!game) {
      throw new Error('Game not found');
    }

    logger.info('Deleting game', { gameId, userId });

    // Remove from active games map if it exists
    const gameInstance = this.games.get(gameId);
    if (gameInstance) {
      // Remove from player mappings
      for (const player of gameInstance.players.values()) {
        this.playerToGame.delete(player.id);
      }

      // Cleanup managers (keep game in map until cleanup is complete)
      gameInstance.visibilityManager.cleanup();
      gameInstance.cityManager.cleanup();

      // Remove from games map after all cleanup operations are complete
      this.games.delete(gameId);
    }

    // Update database to mark game as ended
    await db
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

      return {
        success: true,
        path: {
          unitId,
          targetX,
          targetY,
          tiles: pathResult.path,
          totalCost: pathResult.totalCost,
          estimatedTurns: pathResult.estimatedTurns,
          valid: pathResult.valid,
        },
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
