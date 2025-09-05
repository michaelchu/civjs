/* eslint-disable complexity */
import { Server, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { PacketHandler } from './PacketHandler';
import {
  PacketType,
  ServerJoinReqSchema,
  ChatMsgSchema,
  UnitMoveSchema,
  UnitAttackSchema,
  UnitFortifySchema,
  UnitCreateSchema,
  TileVisibilityReqSchema,
  CityFoundSchema,
  CityProductionChangeSchema,
  ResearchSetSchema,
  ResearchGoalSetSchema,
  ResearchListSchema,
  ResearchProgressSchema,
  NationSelectReqSchema,
  NationListReqSchema,
} from '../types/packet';
import { sessionCache } from '../database/redis';
import { db } from '../database';
import { users, games } from '../database/schema';
import { eq } from 'drizzle-orm';
import { GameManager } from '@game/managers/GameManager';
import { RulesetLoader } from '../shared/data/rulesets/RulesetLoader';

// Store active connections
const activeConnections = new Map<
  string,
  {
    userId?: string;
    username?: string;
    gameId?: string;
  }
>();

/**
 * Create new user with race condition handling
 */
async function createNewUserWithRaceConditionHandling(
  username: string
): Promise<{ userId: string; isNewUser: boolean }> {
  try {
    const [newUser] = await db
      .insert(users)
      .values({
        username,
        isGuest: true,
      })
      .returning();
    return { userId: newUser.id, isNewUser: true };
  } catch (insertError: any) {
    return await handleUserCreationRaceCondition(username, insertError);
  }
}

/**
 * Handle race condition during user creation
 */
async function handleUserCreationRaceCondition(
  username: string,
  insertError: any
): Promise<{ userId: string; isNewUser: boolean }> {
  // Handle race condition: username was created by another connection
  if (insertError?.code !== '23505') {
    throw insertError; // Re-throw if it's a different error
  }

  // PostgreSQL unique constraint violation
  logger.debug(`Username ${username} already exists due to race condition, fetching existing user`);

  const existingUserRetry = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!existingUserRetry) {
    throw new Error(`Failed to find user ${username} after constraint violation`);
  }

  await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, existingUserRetry.id));
  return { userId: existingUserRetry.id, isNewUser: false };
}

export function setupSocketHandlers(io: Server, socket: Socket) {
  const packetHandler = new PacketHandler();
  const gameManager = GameManager.getInstance(io);

  // Store packet handler on socket for use in map data functions
  socket.data.packetHandler = packetHandler;

  activeConnections.set(socket.id, {});

  registerHandlers(packetHandler, io, socket);

  socket.on('packet', async packet => {
    await packetHandler.process(socket, packet);
  });

  socket.on('join_game', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const playerId = await gameManager.joinGame(data.gameId, connection.userId, 'random');

      connection.gameId = data.gameId;
      socket.join(`game:${data.gameId}`);
      await gameManager.updatePlayerConnection(playerId, true);

      // Send map data to the player if the game has started
      try {
        await sendPlayerMapData(gameManager, data.gameId, playerId, socket);
      } catch (mapError) {
        logger.warn('Could not send map data to player:', mapError);
      }

      callback({ success: true, playerId });
      logger.info(`${connection?.username || 'Unknown'} joined game ${data.gameId}`, { playerId });
    } catch (error) {
      logger.error('Error joining game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to join game',
      });
    }
  });

  socket.on('observe_game', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const game = await gameManager.getGame(data.gameId);
      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      connection.gameId = data.gameId;
      socket.join(`game:${data.gameId}`);

      await sendObserverMapData(gameManager, data.gameId, socket);

      callback({ success: true });
      logger.info(`${connection?.username || 'Unknown'} is now observing game ${data.gameId}`);
    } catch (error) {
      logger.error('Error observing game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to observe game',
      });
    }
  });

  socket.on('get_game_list', async callback => {
    try {
      logger.info('Getting game list requested');
      const connection = activeConnections.get(socket.id);
      const userId = connection?.userId || null;
      logger.info(`Getting game list for userId: ${userId}`);

      const games = await gameManager.getGameListForLobby(userId);
      logger.info(`Retrieved ${games.length} games from database`);

      callback({ success: true, games });
    } catch (error) {
      logger.error('Error getting game list:', error);
      logger.error('Error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      callback({ success: false, error: 'Failed to get game list' });
    }
  });

  socket.on('delete_game', async (data, callback) => {
    try {
      // For single-player mode, allow anyone to delete any game
      await gameManager.deleteGame(data.gameId);
      callback({ success: true });
      logger.info('Game deleted', { gameId: data.gameId });
    } catch (error) {
      logger.error('Error deleting game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete game',
      });
    }
  });

  socket.on('get_map_data', async (_data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.gameId) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const mapData = gameManager.getMapData(connection.gameId);
      callback({ success: true, mapData });
    } catch (error) {
      logger.error('Error getting map data:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get map data',
      });
    }
  });

  socket.on('get_visible_tiles', async (_data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.gameId) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const game = await db.query.games.findFirst({
        where: eq(games.id, connection.gameId),
        with: {
          players: true,
        },
      });

      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      const player = game.players.find(p => p.userId === connection.userId);
      if (!player) {
        callback({ success: false, error: 'Player not found in game' });
        return;
      }

      const visibleTiles = gameManager.getPlayerVisibleTiles(connection.gameId, player.id);
      callback({ success: true, visibleTiles });
    } catch (error) {
      logger.error('Error getting visible tiles:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get visible tiles',
      });
    }
  });

  socket.on('unit_action', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.gameId) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const gameInstance = gameManager.getGameInstance(connection.gameId);
      if (!gameInstance) {
        callback({ success: false, error: 'Game instance not found' });
        return;
      }

      // Get player ID from user
      let playerId: string | undefined = undefined;
      if (connection.userId) {
        const playerIds = Array.from(gameInstance.players.keys());
        for (const pid of playerIds) {
          const player = gameInstance.players.get(pid);
          if (player && player.userId === connection.userId) {
            playerId = pid;
            break;
          }
        }
      }

      if (!playerId) {
        callback({ success: false, error: 'Player not found' });
        return;
      }

      // Execute the unit action
      const result = await gameInstance.unitManager.executeUnitAction(
        data.unitId,
        data.actionType,
        data.targetX,
        data.targetY
      );

      if (result.success) {
        // If unit was destroyed (e.g., settler founding city), broadcast destruction
        if (result.unitDestroyed) {
          io.to(`game:${connection.gameId}`).emit('unit_destroyed', {
            gameId: connection.gameId,
            unitId: data.unitId,
          });
        } else {
          // Broadcast unit state updates if unit still exists
          const updatedUnit = gameInstance.unitManager.getUnit(data.unitId);
          if (updatedUnit) {
            io.to(`game:${connection.gameId}`).emit('unit_update', {
              gameId: connection.gameId,
              unit: updatedUnit,
            });
          }
        }

        // If city was founded, the GameManager already broadcasts city_founded
        callback({ success: true, result });
        logger.info(`Unit action executed successfully`, {
          unitId: data.unitId,
          actionType: data.actionType,
          playerId,
        });
      } else {
        callback({ success: false, error: result.message });
        logger.warn(`Unit action failed`, {
          unitId: data.unitId,
          actionType: data.actionType,
          error: result.message,
          playerId,
        });
      }
    } catch (error) {
      logger.error('Error executing unit action:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute unit action',
      });
    }
  });

  // Pathfinding request handler
  socket.on('path_request', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.gameId || !connection?.userId) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Not authenticated or not in a game' });
      }
      return;
    }

    try {
      const gameInstance = gameManager.getGameInstance(connection.gameId);
      if (!gameInstance) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Game instance not found' });
        }
        return;
      }

      // Get player ID from user
      let playerId: string | undefined = undefined;
      const playerIds = Array.from(gameInstance.players.keys());
      for (const pid of playerIds) {
        const player = gameInstance.players.get(pid);
        if (player && player.userId === connection.userId) {
          playerId = pid;
          break;
        }
      }

      if (!playerId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Player not found' });
        }
        return;
      }

      // Request pathfinding from GameManager
      const pathResult = await gameManager.requestPath(
        playerId,
        data.unitId,
        data.targetX,
        data.targetY
      );

      if (typeof callback === 'function') {
        callback(pathResult);
      }

      // Also emit to the socket for the PathfindingService listener
      // Add request identification fields for client matching
      const responseWithId = {
        ...pathResult,
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
      };

      // Ensure response is always sent
      socket.emit('path_response', responseWithId);

      logger.debug('Path request processed', {
        gameId: connection.gameId,
        playerId,
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
        success: pathResult.success,
      });
    } catch (error) {
      logger.error('Error processing path request:', error);
      const errorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process path request',
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
        path: null,
      };

      if (typeof callback === 'function') {
        callback(errorResponse);
      }

      // Also emit error response to the socket for PathfindingService
      socket.emit('path_response', errorResponse);
    }
  });

  socket.on('disconnect', async () => {
    logger.info(`Client disconnected: ${socket.id}`);

    const connection = activeConnections.get(socket.id);
    if (connection?.userId) {
      await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, connection.userId));

      if (connection.gameId) {
        const game = await gameManager.getGame(connection.gameId);
        if (game && game.players) {
          // Handle both Map (from gameInstance) and array (from database) formats
          const playersArray =
            game.players instanceof Map ? Array.from(game.players.values()) : game.players;
          const player = playersArray.find((p: any) => p.userId === connection.userId) as any;
          if (player) {
            await gameManager.updatePlayerConnection(player.id, false);
          }
        }

        socket.to(`game:${connection.gameId}`).emit('packet', {
          type: PacketType.CONNECT_MSG,
          data: {
            type: 'player_disconnected',
            username: connection.username,
          },
        });
      }
    }

    activeConnections.delete(socket.id);
    packetHandler.cleanup(socket.id);
  });

  socket.on('error', error => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
}

function registerHandlers(handler: PacketHandler, io: Server, socket: Socket) {
  const gameManager = GameManager.getInstance(io);
  handler.register(
    PacketType.SERVER_JOIN_REQ,
    async (_socket, data) => {
      try {
        const { username } = data;

        const existingUser = await db.query.users.findFirst({
          where: eq(users.username, username),
        });

        let userId: string;
        let isNewUser = false;

        if (existingUser) {
          userId = existingUser.id;
          await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
        } else {
          const result = await createNewUserWithRaceConditionHandling(username);
          userId = result.userId;
          isNewUser = result.isNewUser;
        }

        const connection = activeConnections.get(socket.id);
        if (connection) {
          connection.userId = userId;
          connection.username = username;
        }

        await sessionCache.setSession(socket.id, userId);

        socket.join(`player:${userId}`);

        handler.send(socket, PacketType.SERVER_JOIN_REPLY, {
          accepted: true,
          playerId: userId,
          message: isNewUser ? 'Welcome to CivJS!' : 'Welcome back!',
          capability: 'civjs-1.0',
        });

        logger.info(`User ${username} (${userId}) joined`);
      } catch (error) {
        logger.error('Error handling join request:', error);
        handler.send(socket, PacketType.SERVER_JOIN_REPLY, {
          accepted: false,
          message: 'Failed to join server',
        });
      }
    },
    ServerJoinReqSchema
  );

  handler.register(
    PacketType.CHAT_MSG_REQ,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId) {
        return;
      }

      const chatPacket = {
        sender: connection.username || 'Unknown',
        message: data.message,
        channel: data.channel,
        timestamp: Date.now(),
      };

      if (data.channel === 'all' && connection.gameId) {
        io.to(`game:${connection.gameId}`).emit('packet', {
          type: PacketType.CHAT_MSG,
          data: chatPacket,
        });
      } else if (data.channel === 'private' && data.recipient) {
        const recipientSocket = findSocketByUsername(data.recipient);
        if (recipientSocket) {
          handler.send(recipientSocket, PacketType.CHAT_MSG, chatPacket);
          handler.send(socket, PacketType.CHAT_MSG, chatPacket); // Echo to sender
        }
      } else {
        io.emit('packet', {
          type: PacketType.CHAT_MSG,
          data: chatPacket,
        });
      }
    },
    ChatMsgSchema
  );

  handler.register(PacketType.GAME_LIST, async socket => {
    try {
      const connection = activeConnections.get(socket.id);
      const userId = connection?.userId || null;
      const games = await gameManager.getGameListForLobby(userId);

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
  });

  handler.register(PacketType.GAME_CREATE, async (socket, data) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const gameId = await gameManager.createGame({
        name: data.name,
        hostId: connection.userId,
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

      const playerId = await gameManager.joinGame(gameId, connection.userId, data.selectedNation);
      await gameManager.updatePlayerConnection(playerId, true);

      socket.emit('game_created', {
        gameId,
        maxPlayers: data.maxPlayers,
        playerId, // Include playerId so client can initialize player state
      });

      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: true,
        gameId,
        message: 'Game created successfully',
      });

      logger.info(`Game created by ${connection.username}`, { gameId });
    } catch (error) {
      logger.error('Error creating game:', error);
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create game',
      });
    }
  });

  handler.register(PacketType.GAME_JOIN, async (socket, data) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const playerId = await gameManager.joinGame(
        data.gameId,
        connection.userId,
        data.civilization
      );

      connection.gameId = data.gameId;

      socket.join(`game:${data.gameId}`);

      await gameManager.updatePlayerConnection(playerId, true);

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
  });

  handler.register(PacketType.GAME_START, async (socket, _data) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection?.gameId) {
      return;
    }

    try {
      await gameManager.startGame(connection.gameId, connection.userId);
      logger.info(`Game started by ${connection.username}`, { gameId: connection.gameId });
    } catch (error) {
      logger.error('Error starting game:', error);
      handler.send(socket, PacketType.SERVER_MESSAGE, {
        message: error instanceof Error ? error.message : 'Failed to start game',
        type: 'error',
      });
    }
  });

  handler.register(PacketType.END_TURN, async socket => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection?.gameId) {
      return;
    }

    try {
      let playerId: string | null = null;
      for (const game of await gameManager.getAllGames()) {
        const player = game.players.find((p: any) => p.userId === connection.userId) as any;
        if (player) {
          playerId = player.id;
          break;
        }
      }

      if (!playerId) return;

      const turnAdvanced = await gameManager.endTurn(playerId);

      if (turnAdvanced && connection.gameId) {
        // Get the updated game state from database after turn processing
        const updatedGame = await gameManager.getGame(connection.gameId);
        const gameInstance = gameManager.getGameInstance(connection.gameId);

        if (updatedGame && gameInstance) {
          const turnData = {
            turn: updatedGame.currentTurn,
            year: gameInstance.turnManager.getCurrentYear(),
          };
          logger.debug('Sending TURN_START packet', {
            gameId: connection.gameId,
            turnData,
            gameInstanceTurn: gameInstance.currentTurn,
            dbTurn: updatedGame.currentTurn,
          });
          // Notify all players that turn advanced
          io.to(`game:${connection.gameId}`).emit('packet', {
            type: PacketType.TURN_START,
            data: turnData,
          });
        } else {
          logger.warn('No game found for TURN_START', {
            gameId: connection.gameId,
            updatedGame: !!updatedGame,
            gameInstance: !!gameInstance,
          });
        }
      } else {
        logger.debug('Not sending TURN_START', {
          turnAdvanced,
          gameId: connection.gameId,
        });
      }

      handler.send(socket, PacketType.TURN_END_REPLY, {
        success: true,
        turnAdvanced,
      });

      logger.debug(`${connection.username} ended turn`, {
        gameId: connection.gameId,
        turnAdvanced,
      });
    } catch (error) {
      logger.error('Error ending turn:', error);
      handler.send(socket, PacketType.TURN_END_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to end turn',
      });
    }
  });

  // Unit actions
  handler.register(
    PacketType.UNIT_MOVE,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Player not found in game',
          });
          return;
        }

        // Execute the move immediately
        const moved = await gameManager.moveUnit(
          connection.gameId,
          player.id,
          data.unitId,
          data.x,
          data.y
        );

        if (moved) {
          const gameInstance = gameManager.getGameInstance(connection.gameId);
          const unit = gameInstance?.unitManager.getUnit(data.unitId);
          handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
            success: true,
            unitId: data.unitId,
            newX: unit?.x,
            newY: unit?.y,
            movementLeft: unit?.movementLeft,
          });

          logger.debug('Unit moved successfully', {
            gameId: connection.gameId,
            playerId: player.id,
            unitId: data.unitId,
            newPosition: { x: data.x, y: data.y },
          });
        } else {
          handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Move failed',
          });
        }
      } catch (error) {
        logger.error('Error processing unit move:', error);
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: false,
          unitId: data.unitId,
          message: error instanceof Error ? error.message : 'Failed to move unit',
        });
      }
    },
    UnitMoveSchema
  );

  handler.register(
    PacketType.UNIT_ATTACK,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        const combatResult = await gameManager.attackUnit(
          connection.gameId,
          player.id,
          data.attackerUnitId,
          data.defenderUnitId
        );

        handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
          success: true,
          combatResult,
        });

        logger.debug('Unit attack executed', {
          gameId: connection.gameId,
          playerId: player.id,
          attackerUnitId: data.attackerUnitId,
          defenderUnitId: data.defenderUnitId,
          combatResult,
        });
      } catch (error) {
        logger.error('Error processing unit attack:', error);
        handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to attack unit',
        });
      }
    },
    UnitAttackSchema
  );

  handler.register(
    PacketType.UNIT_FORTIFY,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Player not found in game',
          });
          return;
        }

        await gameManager.fortifyUnit(connection.gameId, player.id, data.unitId);

        handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
          success: true,
          unitId: data.unitId,
        });

        logger.debug('Unit fortified', {
          gameId: connection.gameId,
          playerId: player.id,
          unitId: data.unitId,
        });
      } catch (error) {
        logger.error('Error fortifying unit:', error);
        handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
          success: false,
          unitId: data.unitId,
          message: error instanceof Error ? error.message : 'Failed to fortify unit',
        });
      }
    },
    UnitFortifySchema
  );

  handler.register(
    PacketType.UNIT_CREATE,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        const unitId = await gameManager.createUnit(
          connection.gameId,
          player.id,
          data.unitType,
          data.x,
          data.y
        );

        handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
          success: true,
          unitId,
        });

        logger.debug('Unit created', {
          gameId: connection.gameId,
          playerId: player.id,
          unitId,
          unitType: data.unitType,
          position: { x: data.x, y: data.y },
        });
      } catch (error) {
        logger.error('Error creating unit:', error);
        handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to create unit',
        });
      }
    },
    UnitCreateSchema
  );

  // Visibility handlers
  handler.register(PacketType.MAP_VIEW_REQ, async (socket, _data) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection?.gameId) {
      return;
    }

    try {
      const game = await gameManager.getGame(connection.gameId);
      if (!game) return;

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) return;

      // Update visibility first
      gameManager.updatePlayerVisibility(connection.gameId, player.id);

      // Get player's map view
      const mapData = gameManager.getPlayerMapView(connection.gameId, player.id);

      handler.send(socket, PacketType.MAP_VIEW_REPLY, {
        mapData,
      });

      logger.debug('Sent map view to player', {
        gameId: connection.gameId,
        playerId: player.id,
      });
    } catch (error) {
      logger.error('Error processing map view request:', error);
    }
  });

  handler.register(
    PacketType.TILE_VISIBILITY_REQ,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
          x: data.x,
          y: data.y,
          isVisible: false,
          isExplored: false,
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) return;

        const visibility = gameManager.getTileVisibility(
          connection.gameId,
          player.id,
          data.x,
          data.y
        );

        handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
          x: data.x,
          y: data.y,
          isVisible: visibility.isVisible,
          isExplored: visibility.isExplored,
          lastSeen: visibility.lastSeen,
        });

        logger.debug('Sent tile visibility info', {
          gameId: connection.gameId,
          playerId: player.id,
          tile: { x: data.x, y: data.y },
          visibility,
        });
      } catch (error) {
        logger.error('Error processing tile visibility request:', error);
        handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
          x: data.x,
          y: data.y,
          isVisible: false,
          isExplored: false,
        });
      }
    },
    TileVisibilityReqSchema
  );

  // City handlers
  handler.register(
    PacketType.CITY_FOUND,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.CITY_FOUND_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.CITY_FOUND_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.CITY_FOUND_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        const cityId = await gameManager.foundCity(
          connection.gameId,
          player.id,
          data.name,
          data.x,
          data.y
        );

        handler.send(socket, PacketType.CITY_FOUND_REPLY, {
          success: true,
          cityId,
        });

        logger.debug('City founded', {
          gameId: connection.gameId,
          playerId: player.id,
          cityId,
          name: data.name,
          position: { x: data.x, y: data.y },
        });
      } catch (error) {
        logger.error('Error founding city:', error);
        handler.send(socket, PacketType.CITY_FOUND_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to found city',
        });
      }
    },
    CityFoundSchema
  );

  handler.register(
    PacketType.CITY_PRODUCTION_CHANGE,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        await gameManager.setCityProduction(
          connection.gameId,
          player.id,
          data.cityId,
          data.production,
          data.type
        );

        handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
          success: true,
        });

        logger.debug('City production changed', {
          gameId: connection.gameId,
          playerId: player.id,
          cityId: data.cityId,
          production: data.production,
          type: data.type,
        });
      } catch (error) {
        logger.error('Error changing city production:', error);
        handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to change production',
        });
      }
    },
    CityProductionChangeSchema
  );

  // Research handlers
  handler.register(
    PacketType.RESEARCH_SET,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        await gameManager.setPlayerResearch(connection.gameId, player.id, data.techId);

        const availableTechs = gameManager.getAvailableTechnologies(connection.gameId, player.id);

        handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
          success: true,
          availableTechs: availableTechs.map(tech => ({
            id: tech.id,
            name: tech.name,
            cost: tech.cost,
            requirements: tech.requirements,
            description: tech.description,
          })),
        });

        logger.debug('Research set', {
          gameId: connection.gameId,
          playerId: player.id,
          techId: data.techId,
        });
      } catch (error) {
        logger.error('Error setting research:', error);
        handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to set research',
        });
      }
    },
    ResearchSetSchema
  );

  handler.register(
    PacketType.RESEARCH_GOAL_SET,
    async (socket, data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
          success: false,
          message: 'Not authenticated or not in a game',
        });
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.status !== 'active') {
          handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) {
          handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
            success: false,
            message: 'Player not found in game',
          });
          return;
        }

        await gameManager.setResearchGoal(connection.gameId, player.id, data.techId);

        handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
          success: true,
        });

        logger.debug('Research goal set', {
          gameId: connection.gameId,
          playerId: player.id,
          techGoal: data.techId,
        });
      } catch (error) {
        logger.error('Error setting research goal:', error);
        handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
          success: false,
          message: error instanceof Error ? error.message : 'Failed to set research goal',
        });
      }
    },
    ResearchGoalSetSchema
  );

  handler.register(
    PacketType.RESEARCH_LIST,
    async (socket, _data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) return;

        const availableTechs = gameManager.getAvailableTechnologies(connection.gameId, player.id);
        const playerResearch = gameManager.getPlayerResearch(connection.gameId, player.id);

        handler.send(socket, PacketType.RESEARCH_LIST_REPLY, {
          availableTechs: availableTechs.map(tech => ({
            id: tech.id,
            name: tech.name,
            cost: tech.cost,
            requirements: tech.requirements,
            description: tech.description,
          })),
          researchedTechs: playerResearch ? Array.from(playerResearch.researchedTechs) : [],
        });

        logger.debug('Sent research list', {
          gameId: connection.gameId,
          playerId: player.id,
          availableCount: availableTechs.length,
          researchedCount: playerResearch?.researchedTechs.size || 0,
        });
      } catch (error) {
        logger.error('Error getting research list:', error);
      }
    },
    ResearchListSchema
  );

  handler.register(
    PacketType.RESEARCH_PROGRESS,
    async (socket, _data) => {
      const connection = activeConnections.get(socket.id);
      if (!connection?.userId || !connection?.gameId) {
        return;
      }

      try {
        const game = await gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (!player) return;

        const playerResearch = gameManager.getPlayerResearch(connection.gameId, player.id);
        const progress = gameManager.getResearchProgress(connection.gameId, player.id);

        handler.send(socket, PacketType.RESEARCH_PROGRESS_REPLY, {
          currentTech: playerResearch?.currentTech,
          techGoal: playerResearch?.techGoal,
          current: progress?.current || 0,
          required: progress?.required || 0,
          turnsRemaining: progress?.turnsRemaining || -1,
        });

        logger.debug('Sent research progress', {
          gameId: connection.gameId,
          playerId: player.id,
          currentTech: playerResearch?.currentTech,
          progress: progress,
        });
      } catch (error) {
        logger.error('Error getting research progress:', error);
      }
    },
    ResearchProgressSchema
  );

  // Nation selection handlers
  handler.register(
    PacketType.NATION_LIST_REQ,
    async (socket, data) => {
      try {
        const ruleset = data.ruleset || 'classic';
        const loader = RulesetLoader.getInstance();
        const nationsRuleset = loader.loadNationsRuleset(ruleset);

        if (!nationsRuleset) {
          handler.send(socket, PacketType.NATION_LIST_REPLY, {
            success: false,
            message: `No nations found for ruleset: ${ruleset}`,
          });
          return;
        }

        // Transform nations data for client
        const nationsArray = Object.values(nationsRuleset.nations)
          .filter(nation => nation.id !== 'barbarian') // Filter out barbarian for player selection
          .map(nation => ({
            id: nation.id,
            name: nation.name,
            plural: nation.plural,
            adjective: nation.adjective,
            class: nation.class,
            style: nation.style,
            init_government: nation.init_government,
            leaders: nation.leaders,
            flag: nation.flag,
            flag_alt: nation.flag_alt,
            legend: nation.legend,
          }));

        handler.send(socket, PacketType.NATION_LIST_REPLY, {
          success: true,
          nations: nationsArray,
        });

        logger.debug('Sent nation list', {
          ruleset,
          count: nationsArray.length,
        });
      } catch (error) {
        logger.error('Error getting nation list:', error);
        handler.send(socket, PacketType.NATION_LIST_REPLY, {
          success: false,
          message: 'Failed to load nations data',
        });
      }
    },
    NationListReqSchema
  );

  handler.register(
    PacketType.NATION_SELECT_REQ,
    async (socket, data) => {
      try {
        const connection = activeConnections.get(socket.id);
        if (!connection?.userId) {
          handler.send(socket, PacketType.NATION_SELECT_REPLY, {
            success: false,
            message: 'Not authenticated',
          });
          return;
        }

        const { nation } = data;

        // Validate nation exists
        const loader = RulesetLoader.getInstance();
        try {
          const nationData = loader.getNation(nation, 'classic');
          if (!nationData) {
            handler.send(socket, PacketType.NATION_SELECT_REPLY, {
              success: false,
              message: `Nation '${nation}' not found`,
            });
            return;
          }
        } catch {
          handler.send(socket, PacketType.NATION_SELECT_REPLY, {
            success: false,
            message: `Invalid nation: ${nation}`,
          });
          return;
        }

        // TODO: Store nation selection in database/game state
        // For now, we'll just acknowledge the selection
        // In a full implementation, this would update the player's nation in the database

        handler.send(socket, PacketType.NATION_SELECT_REPLY, {
          success: true,
          selectedNation: nation,
          message: `Selected nation: ${nation}`,
        });

        logger.info('Player selected nation', {
          userId: connection.userId,
          username: connection.username,
          nation,
        });
      } catch (error) {
        logger.error('Error handling nation selection:', error);
        handler.send(socket, PacketType.NATION_SELECT_REPLY, {
          success: false,
          message: 'Failed to select nation',
        });
      }
    },
    NationSelectReqSchema
  );
}

// Helper functions to reduce nesting and complexity
async function sendObserverMapData(
  gameManager: GameManager,
  gameId: string,
  socket: Socket
): Promise<void> {
  const gameInstance = gameManager.getGameInstance(gameId);
  if (!gameInstance) return;

  const mapData = gameInstance.mapManager.getMapData();
  if (!mapData) return;

  // Send MAP_INFO packet via structured packet system
  const centerX = Math.floor(mapData.width / 2);
  const centerY = Math.floor(mapData.height / 2);
  const mapInfoPacketData = {
    xsize: mapData.width,
    ysize: mapData.height,
    topology: 0,
    wrap_id: 0,
    startpos: [{ x: centerX, y: centerY }],
  };

  const packetHandler = socket.data.packetHandler;
  if (packetHandler) {
    packetHandler.send(socket, PacketType.MAP_INFO, mapInfoPacketData);
  }

  // Collect and send tiles in batches
  const allTiles = [];
  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      const index = x + y * mapData.width;
      const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

      if (serverTile) {
        const tileInfo = {
          tile: index,
          x: x,
          y: y,
          terrain: serverTile.terrain,
          resource: serverTile.resource,
          elevation: serverTile.elevation || 0,
          riverMask: serverTile.riverMask || 0,
          known: 1,
          seen: 1,
          player: null,
          worked: null,
          extras: 0,
        };
        allTiles.push(tileInfo);
      }
    }
  }

  const BATCH_SIZE = 100;
  for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
    const batch = allTiles.slice(i, i + BATCH_SIZE);
    const tileInfoBatchData = {
      tiles: batch,
      startIndex: i,
      endIndex: Math.min(i + BATCH_SIZE, allTiles.length),
      total: allTiles.length,
    };

    if (packetHandler) {
      packetHandler.send(socket, PacketType.TILE_INFO, tileInfoBatchData);
    }
  }

  logger.debug(
    `Sent ${allTiles.length} tiles in ${Math.ceil(
      allTiles.length / BATCH_SIZE
    )} batches to observer`
  );
}

async function sendPlayerMapData(
  gameManager: GameManager,
  gameId: string,
  _playerId: string,
  socket: Socket
): Promise<void> {
  // For basic map display, get the raw map data instead of filtered player view
  const gameInstance = gameManager.getGameInstance(gameId);
  if (!gameInstance) {
    logger.warn(`No game instance found for ${gameId}`);
    return;
  }

  const mapData = gameInstance.mapManager.getMapData();
  if (!mapData) {
    logger.warn(`No map data found for game ${gameId}`);
    return;
  }

  // Use raw map data for basic display (no visibility filtering for now)
  const playerMapView = {
    width: mapData.width,
    height: mapData.height,
    tiles: mapData.tiles,
  };

  // Send MAP_INFO packet via structured packet system
  const mapInfoPacketData = {
    xsize: playerMapView.width,
    ysize: playerMapView.height,
    topology: 0,
    wrap_id: 0,
    startpos: [],
  };

  const packetHandler = socket.data.packetHandler;
  if (packetHandler) {
    packetHandler.send(socket, PacketType.MAP_INFO, mapInfoPacketData);
  }

  // Send all tiles to player (basic map display)
  let tileCount = 0;
  for (let x = 0; x < playerMapView.width; x++) {
    for (let y = 0; y < playerMapView.height; y++) {
      const tile = playerMapView.tiles[x][y];
      if (tile) {
        const tileIndex = y * playerMapView.width + x;

        const tileInfoPacketData = {
          tile: tileIndex,
          x: x,
          y: y,
          terrain: tile.terrain,
          known: 1, // Mark all tiles as explored for basic display
          seen: 1, // Mark all tiles as visible for basic display
          resource: tile.resource,
        };

        if (packetHandler) {
          packetHandler.send(socket, PacketType.TILE_INFO, tileInfoPacketData);
        }
        tileCount++;
      }
    }
  }
  logger.debug(`Sent ${tileCount} visible tiles to player`);
}

function findSocketByUsername(username: string): Socket | null {
  for (const [socketId, connection] of activeConnections) {
    if (connection.username === username) {
      return (global as any).io.sockets.sockets.get(socketId);
    }
  }
  return null;
}
