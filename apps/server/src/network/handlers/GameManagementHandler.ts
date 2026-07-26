import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { CityDataService } from '@game/services/CityDataService';

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

  private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>;
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

    handler.register(PacketType.GAME_CREATE, async (socket, data) => {
      await this.handleGameCreate(handler, socket, data);
    });

    handler.register(PacketType.GAME_JOIN, async (socket, data) => {
      await this.handleGameJoin(handler, socket, data);
    });

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
      await this.handleJoinGameEvent(socket, data, callback);
    });

    // Handle observe_game event
    socket.on('observe_game', async (data, callback) => {
      await this.handleObserveGameEvent(socket, data, callback);
    });

    // Handle get_game_list event
    socket.on('get_game_list', async callback => {
      await this.handleGetGameListEvent(socket, callback);
    });

    // Handle delete_game event
    socket.on('delete_game', async (data, callback) => {
      await this.handleDeleteGameEvent(data, callback);
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
      socket.join(`game:${gameId}`);

      const result = await this.gameManager.joinGame(
        gameId,
        connection.userId!,
        data.selectedNation
      );
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      socket.emit('game_created', {
        gameId,
        maxPlayers: data.maxPlayers,
        playerId: result.playerId, // Include playerId so client can initialize player state
        assignedNation: result.assignedNation,
        assignedColor: result.assignedColor,
      });

      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: true,
        gameId,
        message: 'Game created successfully',
        assignedNation: result.assignedNation,
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
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId: result.playerId,
        message: 'Joined game successfully',
      });

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
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      // Send map data to the player if the game has started
      try {
        await this.sendPlayerMapData(data.gameId, result.playerId, socket);
      } catch (mapError) {
        logger.warn('Could not send map data to player:', mapError);
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
      socket.join(`game:${data.gameId}`);

      await this.sendObserverMapData(data.gameId, socket);

      callback({ success: true });
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
  private async handleDeleteGameEvent(data: any, callback: (response: any) => void): Promise<void> {
    try {
      // For single-player mode, allow anyone to delete any game
      await this.gameManager.deleteGame(data.gameId);
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
  private async sendPlayerMapData(gameId: string, playerId: string, socket: Socket): Promise<void> {
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
    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
    const visibleTiles = gameInstance.visibilityManager.getVisibleTiles(playerId);
    const exploredTiles = gameInstance.visibilityManager.getExploredTiles(playerId);

    socket.emit('packet', {
      type: PacketType.MAP_INFO,
      data: {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: 0,
        topology_id: 0,
      },
      timestamp: Date.now(),
    });

    const tiles = [];
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const tile = mapData.tiles[x]?.[y];
        if (!tile) continue;
        const tileKey = `${x},${y}`;
        const isVisible = visibleTiles.has(tileKey);
        const isExplored = exploredTiles.has(tileKey);
        tiles.push({
          tile: x + y * mapData.width,
          x,
          y,
          terrain: isExplored ? tile.terrain : undefined,
          resource: isVisible ? tile.resource : undefined,
          elevation: isExplored ? tile.elevation || 0 : undefined,
          riverMask: isExplored ? tile.riverMask || 0 : undefined,
          known: isVisible ? 1 : 0,
          seen: isExplored ? 1 : 0,
          player: null,
          worked: null,
          extras: 0,
        });
      }
    }

    const batchSize = 100;
    for (let startIndex = 0; startIndex < tiles.length; startIndex += batchSize) {
      const batch = tiles.slice(startIndex, startIndex + batchSize);
      socket.emit('packet', {
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

    const units = gameInstance.unitManager
      .getVisibleUnits(playerId, visibleTiles)
      .map((unit: any) => ({
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
      type: PacketType.UNIT_INFO,
      data: { units },
      timestamp: Date.now(),
    });

    const cities = gameInstance.cityManager
      .getAllCities()
      .filter((city: any) => city.playerId === playerId || visibleTiles.has(`${city.x},${city.y}`));
    socket.emit('cities_updated', {
      gameId,
      cities: CityDataService.transformCitiesForClient(cities),
      timestamp: Date.now(),
    });

    socket.emit('packet', {
      type: PacketType.BORDER_UPDATE,
      data: {
        type: 'border_update',
        updateType: 'full_update',
        tiles: gameInstance.borderManager.getAllTileOwnership().map((ownership: any) => ({
          x: ownership.x,
          y: ownership.y,
          owner: ownership.playerId,
          strength: ownership.strength,
        })),
      },
      timestamp: Date.now(),
    });

    logger.info('Sent recovered map data to player', {
      gameId,
      playerId,
      mapSize: `${mapData.width}x${mapData.height}`,
      tiles: tiles.length,
      units: units.length,
      cities: gameInstance.cityManager.getAllCities().length,
    });
  }

  /**
   * Send map data to observer (placeholder - would need to be implemented)
   */
  private async sendObserverMapData(gameId: string, _socket: Socket): Promise<void> {
    // TODO: This would need to be implemented with proper map data sending
    // For now, we'll leave it as a placeholder since it involves complex map data logic
    logger.debug(`Sending observer map data for game ${gameId}`);
  }
}
