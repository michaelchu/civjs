import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  GameCreateSchema,
  GameIdSchema,
  GameJoinSchema,
  PacketType,
  PROTOCOL_VERSION,
} from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { CityDataService } from '@game/services/CityDataService';
import { resolveCityPresentations } from '@game/services/CityPresentationService';

/**
 * Handles game management packets: creation, joining, starting, listing, deletion
 * Manages game lifecycle and lobby functionality
 */
export class GameManagementHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.GAME_CREATE,
    PacketType.GAME_CREATE_REPLY,
    PacketType.GAME_JOIN,
    PacketType.GAME_JOIN_REPLY,
    PacketType.GAME_START,
    PacketType.GAME_LIST,
  ];

  protected handlerName = 'GameManagementHandler';

  private activeConnections: Map<
    string,
    {
      userId?: string;
      username?: string;
      gameId?: string;
      role?: 'player' | 'spectator';
    }
  >;
  private gameManager: GameManager;

  constructor(activeConnections: Map<string, any>, gameManager: GameManager) {
    super();
    this.activeConnections = activeConnections;
    this.gameManager = gameManager;
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    // Register packet handlers
    handler.register(PacketType.GAME_LIST, async socket => {
      await this.handleGameList(handler, socket);
    });

    handler.register(
      PacketType.GAME_CREATE,
      async (socket, data) => {
        await this.handleGameCreate(handler, socket, data);
      },
      GameCreateSchema
    );

    handler.register(
      PacketType.GAME_JOIN,
      async (socket, data) => {
        await this.handleGameJoin(handler, socket, data);
      },
      GameJoinSchema
    );

    handler.register(PacketType.GAME_START, async (socket, _data) => {
      await this.handleGameStart(handler, socket);
    });

    // Register socket event handlers
    this.registerSocketEvents(socket, io);

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  /**
   * Register non-packet socket events
   */
  private registerSocketEvents(socket: Socket, _io: Server): void {
    // Handle join_game event
    socket.on('join_game', async (data, callback) => {
      const parsed = GameJoinSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid join game request' });
        return;
      }
      await this.handleJoinGameEvent(socket, parsed.data, callback);
    });

    // Handle observe_game event
    socket.on('observe_game', async (data, callback) => {
      const parsed = GameIdSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid observe game request' });
        return;
      }
      await this.handleObserveGameEvent(socket, parsed.data, callback);
    });

    // Handle get_game_list event
    socket.on('get_game_list', async callback => {
      await this.handleGetGameListEvent(socket, callback);
    });

    // Handle delete_game event
    socket.on('delete_game', async (data, callback) => {
      const parsed = GameIdSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid delete game request' });
        return;
      }
      await this.handleDeleteGameEvent(socket, parsed.data, callback);
    });

    socket.on('host:getControls', async (_data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      const game = connection?.gameId ? await this.gameManager.getGame(connection.gameId) : null;
      callback({
        success: Boolean(game && connection?.userId && !this.isSpectator(connection)),
        isHost: game?.hostId === connection?.userId,
        paused: game?.status === 'paused',
        turnTimeLimit: game?.turnTimeLimit,
      });
    });

    socket.on('host:setPaused', async (data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      try {
        if (!connection?.gameId || !connection.userId || this.isSpectator(connection)) {
          throw new Error('Not an active player');
        }
        await this.gameManager.setGamePaused(
          connection.gameId,
          connection.userId,
          Boolean(data.paused)
        );
        callback({ success: true, paused: Boolean(data.paused) });
      } catch (error) {
        callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
      }
    });

    socket.on('host:setTurnTimeLimit', async (data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      try {
        if (!connection?.gameId || !connection.userId || this.isSpectator(connection)) {
          throw new Error('Not an active player');
        }
        const turnTimeLimit = Number(data.turnTimeLimit);
        await this.gameManager.setTurnTimeLimit(
          connection.gameId,
          connection.userId,
          turnTimeLimit
        );
        callback({ success: true, turnTimeLimit });
      } catch (error) {
        callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
      }
    });
  }

  /**
   * Handle GAME_LIST packet
   */
  private async handleGameList(_handler: PacketHandler, socket: Socket): Promise<void> {
    try {
      const connection = this.getConnection(socket, this.activeConnections);
      const userId = connection?.userId || null;
      const games = await this.gameManager.getGameListForLobby(userId);

      const gameList = games.map(game => ({
        gameId: game.id,
        name: game.name,
        status: game.status,
        players: game.currentPlayers,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: game.mapSize,
        ruleset: 'classic',
      }));

      socket.emit('packet', {
        version: PROTOCOL_VERSION,
        type: PacketType.GAME_LIST,
        data: { games: gameList },
      });
    } catch (error) {
      logger.error('Error fetching game list:', error);
    }
  }

  /**
   * Handle GAME_CREATE packet
   */
  private async handleGameCreate(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const gameId = await this.gameManager.createGame({
        name: data.name,
        hostId: connection.userId!,
        gameType: data.gameType,
        maxPlayers: data.maxPlayers,
        mapWidth: data.mapWidth,
        mapHeight: data.mapHeight,
        ruleset: data.ruleset,
        turnTimeLimit: data.turnTimeLimit,
        victoryConditions: data.victoryConditions,
        terrainSettings: data.terrainSettings,
      });

      // Automatically join the creator as a player
      // Join the socket room BEFORE joining the game so we receive broadcasts
      connection.gameId = gameId;
      connection.role = 'player';
      socket.join(`game:${gameId}`);

      const result = await this.gameManager.joinGame(
        gameId,
        connection.userId!,
        data.selectedNation
      );
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: true,
        gameId,
        maxPlayers: data.maxPlayers,
        playerId: result.playerId,
        message: 'Game created successfully',
        assignedNation: result.assignedNation,
        assignedColor: result.assignedColor,
      });

      logger.info(`Game created by ${connection.username}`, { gameId });
    } catch (error) {
      logger.error('Error creating game:', error);
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create game',
      });
    }
  }

  /**
   * Handle GAME_JOIN packet
   */
  private async handleGameJoin(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const result = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.civilization
      );

      connection.gameId = data.gameId;
      connection.role = 'player';
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId: result.playerId,
        message: 'Joined game successfully',
      });
      const joinedGame = await this.gameManager.getGame(data.gameId);
      if (joinedGame?.status === 'ended' && joinedGame.endGameReport) {
        handler.send(socket, PacketType.ENDGAME_REPORT, joinedGame.endGameReport);
      }

      logger.info(`${connection.username} joined game`, {
        gameId: data.gameId,
        playerId: result.playerId,
      });
    } catch (error) {
      logger.error('Error joining game:', error);
      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to join game',
      });
    }
  }

  /**
   * Handle GAME_START packet
   */
  private async handleGameStart(handler: PacketHandler, socket: Socket): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      await this.gameManager.startGame(connection.gameId!, connection.userId!);
      logger.info(`Game started by ${connection.username}`, { gameId: connection.gameId });
    } catch (error) {
      logger.error('Error starting game:', error);
      handler.send(socket, PacketType.SERVER_MESSAGE, {
        message: error instanceof Error ? error.message : 'Failed to start game',
        type: 'error',
      });
    }
  }

  /**
   * Handle join_game socket event
   */
  private async handleJoinGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const result = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.selectedNation || 'random'
      );

      connection.gameId = data.gameId;
      connection.role = 'player';
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      const joinedGame = await this.gameManager.getGame(data.gameId);
      const hasLiveInstance = Boolean(this.gameManager.getGameInstance(data.gameId));
      const requiresSnapshot =
        hasLiveInstance || Boolean(joinedGame && joinedGame.status !== 'waiting');

      // A successful active-game join means the client can render a complete
      // recovery snapshot. Propagate recovery failures instead of mounting an
      // empty game and asking the browser to recover through a refresh.
      if (requiresSnapshot) {
        await this.sendGameSnapshot(data.gameId, socket, result.playerId);
      }

      callback({
        success: true,
        playerId: result.playerId,
        assignedNation: result.assignedNation,
        assignedColor: result.assignedColor,
      });
      logger.info(`${connection?.username || 'Unknown'} joined game ${data.gameId}`, {
        playerId: result.playerId,
      });
    } catch (error) {
      logger.error('Error joining game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to join game',
      });
    }
  }

  /**
   * Handle observe_game socket event
   */
  private async handleObserveGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const game = await this.gameManager.getGame(data.gameId);
      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      connection.gameId = data.gameId;
      connection.role = 'spectator';
      socket.join(`game:${data.gameId}`);

      await this.sendGameSnapshot(data.gameId, socket);

      callback({ success: true, role: 'spectator' });
      logger.info(`${connection?.username || 'Unknown'} is now observing game ${data.gameId}`);
    } catch (error) {
      logger.error('Error observing game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to observe game',
      });
    }
  }

  /**
   * Handle get_game_list socket event
   */
  private async handleGetGameListEvent(
    socket: Socket,
    callback: (response: any) => void
  ): Promise<void> {
    try {
      logger.info('Getting game list requested');
      const connection = this.getConnection(socket, this.activeConnections);
      const games = await this.gameManager.getGameListForLobby(connection?.userId || null);
      logger.info(`Retrieved ${games.length} games from database`);

      callback({ success: true, games });
    } catch (error) {
      logger.error('Error getting game list:', error);
      callback({ success: false, error: 'Failed to get game list' });
    }
  }

  /**
   * Handle delete_game socket event
   */
  private async handleDeleteGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const connection = this.getConnection(socket, this.activeConnections);
      if (!connection?.userId || this.isSpectator(connection)) {
        throw new Error('Not authorized to delete this game');
      }
      await this.gameManager.deleteGame(data.gameId, connection.userId);
      callback({ success: true });
      logger.info('Game deleted', { gameId: data.gameId });
    } catch (error) {
      logger.error('Error deleting game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete game',
      });
    }
  }

  /**
   * Restore and send the full map to a player rejoining an active game.
   *
   * A server restart clears the in-memory game instance, so recover it from
   * the persisted map before sending the initial map packets to this socket.
   */
  private async sendGameSnapshot(gameId: string, socket: Socket, playerId?: string): Promise<void> {
    let gameInstance = this.gameManager.getGameInstance(gameId);
    if (!gameInstance) {
      gameInstance = await this.gameManager.recoverGameInstance(gameId);
    }

    if (!gameInstance) {
      throw new Error('Unable to recover active game');
    }

    const mapData = gameInstance.mapManager.getMapData();
    if (!mapData) {
      throw new Error('Recovered game has no map data');
    }

    // @reference reference/freeciv/server/maphand.c:442-613
    // Rejoining players receive only their explored map, with current vision
    // represented by the Freeciv-compatible known/seen packet flags.
    if (playerId) {
      gameInstance.visibilityManager.updatePlayerVisibility(playerId);
    }
    const visibleTiles = playerId
      ? gameInstance.visibilityManager.getVisibleTiles(playerId)
      : new Set<string>();
    const exploredTiles = playerId
      ? gameInstance.visibilityManager.getExploredTiles(playerId)
      : new Set<string>();
    const rememberedTiles = playerId
      ? (gameInstance.visibilityManager.getRememberedTiles?.(playerId) ??
        new Map(
          [...exploredTiles].flatMap(key => {
            const [x, y] = key.split(',').map(Number);
            const tile = mapData.tiles[x]?.[y];
            return tile ? [[key, tile] as const] : [];
          })
        ))
      : new Map<string, any>();

    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.MAP_INFO,
      data: {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: mapData.wrapId ?? 0,
        topology_id: mapData.topologyId ?? 0,
      },
      timestamp: Date.now(),
    });

    const tiles = [];
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const tile = mapData.tiles[x]?.[y];
        if (!tile) continue;
        const tileKey = `${x},${y}`;
        const isVisible = !playerId || visibleTiles.has(tileKey);
        const isExplored = !playerId || exploredTiles.has(tileKey);
        const knownTile = isVisible ? tile : rememberedTiles.get(tileKey);
        tiles.push({
          tile: x + y * mapData.width,
          x,
          y,
          terrain: isExplored ? (knownTile?.terrain ?? 'unknown') : 'unknown',
          resource: isExplored ? knownTile?.resource : undefined,
          elevation: isExplored ? knownTile?.elevation || 0 : 0,
          riverMask: isExplored ? knownTile?.riverMask || 0 : 0,
          hasRoad: isExplored ? knownTile?.hasRoad : false,
          hasRailroad: isExplored ? knownTile?.hasRailroad : false,
          improvements: isExplored ? (knownTile?.improvements ?? []) : [],
          cityId: isExplored ? knownTile?.cityId : undefined,
          owner: isExplored ? knownTile?.owner : undefined,
          claimer: isExplored ? knownTile?.claimer : undefined,
          // Freeciv known_type: 0 unknown, 1 known/fogged, 2 known/seen.
          known: isVisible ? 2 : isExplored ? 1 : 0,
          seen: isVisible ? 1 : 0,
          player: isExplored ? (knownTile?.owner ?? null) : null,
          worked: null,
          extras: 0,
        });
      }
    }

    const batchSize = 100;
    for (let startIndex = 0; startIndex < tiles.length; startIndex += batchSize) {
      const batch = tiles.slice(startIndex, startIndex + batchSize);
      socket.emit('packet', {
        version: PROTOCOL_VERSION,
        type: PacketType.TILE_INFO,
        data: {
          tiles: batch,
          startIndex,
          endIndex: startIndex + batch.length,
          total: tiles.length,
        },
        timestamp: Date.now(),
      });
    }

    const sourceUnits = playerId
      ? gameInstance.unitManager.getVisibleUnits(
          playerId,
          visibleTiles,
          gameInstance.visibilityManager.getDetectionTiles?.(playerId)
        )
      : Array.from(gameInstance.unitManager.getAllUnits().values());
    const units = sourceUnits.map((unit: any) => ({
      id: unit.id,
      owner: unit.playerId,
      type: unit.unitTypeId,
      x: unit.x,
      y: unit.y,
      hp: unit.health,
      movesleft: unit.movementLeft,
      veteran: unit.veteranLevel,
    }));
    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.UNIT_INFO,
      data: { units, fullSnapshot: true },
      timestamp: Date.now(),
    });

    const cities = gameInstance.cityManager
      .getAllCities()
      .filter(
        (city: any) =>
          !playerId || city.playerId === playerId || exploredTiles.has(`${city.x},${city.y}`)
      );
    const cityPresentations = resolveCityPresentations(
      cities,
      gameInstance.players,
      id => gameInstance.researchManager?.getResearchedTechs(id) ?? []
    );
    socket.emit('cities_updated', {
      gameId,
      cities: CityDataService.transformCitiesForClient(
        cities,
        'classic',
        undefined,
        cityPresentations
      ),
      timestamp: Date.now(),
    });

    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.BORDER_UPDATE,
      data: {
        type: 'border_update',
        updateType: 'full_update',
        // @reference reference/freeciv/server/maphand.c:442-613
        // A player may always inspect their own territory. Previously
        // discovered foreign borders remain on the fogged map after reload.
        tiles: gameInstance.borderManager
          .getAllTileOwnership()
          .filter(
            (ownership: any) =>
              !playerId ||
              ownership.playerId === playerId ||
              exploredTiles.has(`${ownership.x},${ownership.y}`)
          )
          .map((ownership: any) => ({
            x: ownership.x,
            y: ownership.y,
            owner: ownership.playerId,
            strength: ownership.strength,
          })),
      },
      timestamp: Date.now(),
    });

    logger.info('Sent recovered game snapshot', {
      gameId,
      playerId,
      role: playerId ? 'player' : 'spectator',
      mapSize: `${mapData.width}x${mapData.height}`,
      tiles: tiles.length,
      units: units.length,
      cities: cities.length,
      totalCities: gameInstance.cityManager.getAllCities().length,
    });
  }
}
