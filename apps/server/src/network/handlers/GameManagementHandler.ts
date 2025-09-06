import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';

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
      await this.handleGetGameListEvent(callback);
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

      const playerId = await this.gameManager.joinGame(
        gameId,
        connection.userId!,
        data.selectedNation
      );
      await this.gameManager.updatePlayerConnection(playerId, true);

      // Get the player data to return the assigned nation
      const playerData = await this.gameManager.getPlayerById(playerId);

      // Determine the assigned nation, never send 'random' as final result
      let assignedNation = playerData?.nation || data.selectedNation || 'american';
      if (assignedNation === 'random') {
        // If we still have 'random' at this point, it means the random selection failed
        // Default to 'american' so client never gets 'random' as the final nation
        assignedNation = 'american';
      }

      socket.emit('game_created', {
        gameId,
        maxPlayers: data.maxPlayers,
        playerId, // Include playerId so client can initialize player state
        assignedNation,
      });

      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: true,
        gameId,
        message: 'Game created successfully',
        assignedNation,
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
      const playerId = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.civilization
      );

      connection.gameId = data.gameId;
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(playerId, true);

      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId,
        message: 'Joined game successfully',
      });

      logger.info(`${connection.username} joined game`, { gameId: data.gameId, playerId });
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
      const playerId = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.selectedNation || 'random'
      );

      connection.gameId = data.gameId;
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(playerId, true);

      // Get the player data to return the assigned nation
      const playerData = await this.gameManager.getPlayerById(playerId);

      // Send map data to the player if the game has started
      try {
        await this.sendPlayerMapData(data.gameId, playerId, socket);
      } catch (mapError) {
        logger.warn('Could not send map data to player:', mapError);
      }

      // Determine the assigned nation, never send 'random' as final result
      let assignedNation = playerData?.nation || data.selectedNation || 'american';
      if (assignedNation === 'random') {
        // If we still have 'random' at this point, it means the random selection failed
        // Default to 'american' so client never gets 'random' as the final nation
        assignedNation = 'american';
      }

      callback({
        success: true,
        playerId,
        assignedNation,
      });
      logger.info(`${connection?.username || 'Unknown'} joined game ${data.gameId}`, { playerId });
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
  private async handleGetGameListEvent(callback: (response: any) => void): Promise<void> {
    try {
      logger.info('Getting game list requested');
      const games = await this.gameManager.getGameListForLobby(null);
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
   * Send map data to player (placeholder - would need to be implemented)
   */
  private async sendPlayerMapData(
    gameId: string,
    playerId: string,
    _socket: Socket
  ): Promise<void> {
    // TODO: This would need to be implemented with proper map data sending
    // For now, we'll leave it as a placeholder since it involves complex map data logic
    logger.debug(`Sending player map data for game ${gameId}, player ${playerId}`);
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
