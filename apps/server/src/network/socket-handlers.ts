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
} from '../types/packet';
import { sessionCache } from '../database/redis';
import { db } from '../database';
import { users, games } from '../database/schema';
import { eq } from 'drizzle-orm';
import { GameManager } from '../game/GameManager';

// Store active connections
const activeConnections = new Map<
  string,
  {
    userId?: string;
    username?: string;
    gameId?: string;
  }
>();

export function setupSocketHandlers(io: Server, socket: Socket) {
  const packetHandler = new PacketHandler();
  const gameManager = GameManager.getInstance(io);

  // Store connection info
  activeConnections.set(socket.id, {});

  // Register packet handlers
  registerHandlers(packetHandler, io, socket);

  // Handle incoming packets
  socket.on('packet', async packet => {
    await packetHandler.process(socket, packet);
  });

  // Add new Socket.IO event handlers for the lobby system
  socket.on('create_game', async (gameData, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const gameId = await gameManager.createGame({
        name: gameData.gameName,
        hostId: connection.userId,
        maxPlayers: gameData.maxPlayers,
        mapWidth: gameData.mapSize === 'small' ? 40 : gameData.mapSize === 'large' ? 120 : 80,
        mapHeight: gameData.mapSize === 'small' ? 25 : gameData.mapSize === 'large' ? 75 : 50,
        ruleset: 'classic',
      });

      // Automatically join the creator as a player
      const playerId = await gameManager.joinGame(gameId, connection.userId, 'random');
      
      connection.gameId = gameId;
      socket.join(`game:${gameId}`);
      await gameManager.updatePlayerConnection(playerId, true);

      // Emit game created event to the creator
      socket.emit('game_created', {
        gameId,
        maxPlayers: gameData.maxPlayers
      });

      callback({ success: true, gameId });
      logger.info(`Game created: ${gameData.gameName} by ${connection.username}`, { gameId });
    } catch (error) {
      logger.error('Error creating game:', error);
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to create game' });
    }
  });

  socket.on('join_game', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId) {
      // For joining games, we need to authenticate first
      try {
        // Create guest user if needed
        let userId: string;
        const existingUser = await db.query.users.findFirst({
          where: eq(users.username, data.playerName),
        });

        if (existingUser) {
          userId = existingUser.id;
          await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
        } else {
          const [newUser] = await db
            .insert(users)
            .values({
              username: data.playerName,
              isGuest: true,
            })
            .returning();
          userId = newUser.id;
        }

        if (connection) {
          connection.userId = userId;
          connection.username = data.playerName;
        }
        await sessionCache.setSession(socket.id, userId);
        
        // Join player-specific room for targeted emissions
        socket.join(`player:${userId}`);
      } catch (error) {
        callback({ success: false, error: 'Authentication failed' });
        return;
      }
    }

    try {
      const playerId = await gameManager.joinGame(data.gameId, connection?.userId || '', 'random');
      
      if (connection) {
        connection.gameId = data.gameId;
      }
      socket.join(`game:${data.gameId}`);
      await gameManager.updatePlayerConnection(playerId, true);

      callback({ success: true, playerId });
      logger.info(`${connection?.username || 'Unknown'} joined game ${data.gameId}`, { playerId });
    } catch (error) {
      logger.error('Error joining game:', error);
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to join game' });
    }
  });

  socket.on('get_game_list', async (callback) => {
    try {
      const games = await gameManager.getGameListForLobby();
      callback({ success: true, games });
    } catch (error) {
      logger.error('Error getting game list:', error);
      callback({ success: false, error: 'Failed to get game list' });
    }
  });

  // Map data handlers
  socket.on('get_map_data', async (data, callback) => {
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
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to get map data' });
    }
  });

  socket.on('get_visible_tiles', async (data, callback) => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection?.gameId) {
      callback({ success: false, error: 'Not authenticated or not in a game' });
      return;
    }

    try {
      // Get game from database to find player
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

      // Find player by userId
      const player = game.players.find(p => p.userId === connection.userId);
      if (!player) {
        callback({ success: false, error: 'Player not found in game' });
        return;
      }

      const visibleTiles = gameManager.getPlayerVisibleTiles(connection.gameId, player.id);
      callback({ success: true, visibleTiles });
    } catch (error) {
      logger.error('Error getting visible tiles:', error);
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed to get visible tiles' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    logger.info(`Client disconnected: ${socket.id}`);

    const connection = activeConnections.get(socket.id);
    if (connection?.userId) {
      // Update user last seen
      await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, connection.userId));

      // Update game manager about disconnection
      if (connection.gameId) {
        const game = gameManager.getGame(connection.gameId);
        if (game) {
          const player = Array.from(game.players.values()).find(
            p => p.userId === connection.userId
          );
          if (player) {
            await gameManager.updatePlayerConnection(player.id, false);
          }
        }

        // Notify others in the game
        socket.to(`game:${connection.gameId}`).emit('packet', {
          type: PacketType.CONNECT_MSG,
          data: {
            type: 'player_disconnected',
            username: connection.username,
          },
        });
      }
    }

    // Clean up
    activeConnections.delete(socket.id);
    packetHandler.cleanup(socket.id);
  });

  // Handle errors
  socket.on('error', error => {
    logger.error(`Socket error for ${socket.id}:`, error);
  });
}

function registerHandlers(handler: PacketHandler, io: Server, socket: Socket) {
  const gameManager = GameManager.getInstance(io);
  // Connection management
  handler.register(
    PacketType.SERVER_JOIN_REQ,
    async (_socket, data) => {
      try {
        const { username } = data;

        // Check if username is already taken (for guests)
        const existingUser = await db.query.users.findFirst({
          where: eq(users.username, username),
        });

        let userId: string;
        let isNewUser = false;

        if (existingUser) {
          userId = existingUser.id;
          // Update last seen
          await db.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
        } else {
          // Create guest user
          const [newUser] = await db
            .insert(users)
            .values({
              username,
              isGuest: true,
            })
            .returning();
          userId = newUser.id;
          isNewUser = true;
        }

        // Store connection info
        const connection = activeConnections.get(socket.id);
        if (connection) {
          connection.userId = userId;
          connection.username = username;
        }

        // Create session
        await sessionCache.setSession(socket.id, userId);

        // Join player-specific room for targeted emissions
        socket.join(`player:${userId}`);

        // Send success response
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

  // Chat messages
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

      // Broadcast based on channel
      if (data.channel === 'all' && connection.gameId) {
        // Game chat
        io.to(`game:${connection.gameId}`).emit('packet', {
          type: PacketType.CHAT_MSG,
          data: chatPacket,
        });
      } else if (data.channel === 'private' && data.recipient) {
        // Private message
        const recipientSocket = findSocketByUsername(data.recipient);
        if (recipientSocket) {
          handler.send(recipientSocket, PacketType.CHAT_MSG, chatPacket);
          handler.send(socket, PacketType.CHAT_MSG, chatPacket); // Echo to sender
        }
      } else {
        // Global chat
        io.emit('packet', {
          type: PacketType.CHAT_MSG,
          data: chatPacket,
        });
      }
    },
    ChatMsgSchema
  );

  // Game listing
  handler.register(PacketType.GAME_LIST, async socket => {
    try {
      const games = await gameManager.getGameListForLobby();

      const gameList = games.map(game => ({
        gameId: game.id,
        name: game.name,
        status: game.status,
        players: game.currentPlayers,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: game.mapSize,
        ruleset: 'classic', // Default ruleset, could be enhanced
      }));

      socket.emit('packet', {
        type: PacketType.GAME_LIST,
        data: { games: gameList },
      });
    } catch (error) {
      logger.error('Error fetching game list:', error);
    }
  });

  // Game creation
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
        maxPlayers: data.maxPlayers,
        mapWidth: data.mapWidth,
        mapHeight: data.mapHeight,
        ruleset: data.ruleset,
        turnTimeLimit: data.turnTimeLimit,
        victoryConditions: data.victoryConditions,
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

  // Game join
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

      // Update connection info
      connection.gameId = data.gameId;

      // Join socket room for game
      socket.join(`game:${data.gameId}`);

      // Update player connection status
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

  // Game start
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

  // Turn end
  handler.register(PacketType.END_TURN, async socket => {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection?.gameId) {
      return;
    }

    try {
      // Find player by userId instead of playerId
      let playerId: string | null = null;
      for (const game of gameManager.getAllGames()) {
        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
        if (player) {
          playerId = player.id;
          break;
        }
      }

      if (!playerId) return;

      const turnAdvanced = await gameManager.endTurn(playerId);
      const game = gameManager.getGameByPlayerId(playerId);

      if (turnAdvanced && game) {
        // Notify all players that turn advanced
        io.to(`game:${connection.gameId}`).emit('packet', {
          type: PacketType.TURN_START,
          data: {
            turn: game.currentTurn,
            year: game.turnManager.getCurrentYear(),
          },
        });
      }

      handler.send(socket, PacketType.TURN_END_REPLY, {
        success: true,
        turnAdvanced,
      });

      logger.debug(`${connection.username} ended turn`, {
        gameId: connection.gameId,
        turn: game?.currentTurn,
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
          const unit = gameManager.getGame(connection.gameId)?.unitManager.getUnit(data.unitId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
            success: false,
            unitId: data.unitId,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
      const game = gameManager.getGame(connection.gameId);
      if (!game) return;

      const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.CITY_FOUND_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
          handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
            success: false,
            message: 'Game is not active',
          });
          return;
        }

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
        const game = gameManager.getGame(connection.gameId);
        if (!game) return;

        const player = Array.from(game.players.values()).find(p => p.userId === connection.userId);
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
}

function findSocketByUsername(username: string): Socket | null {
  for (const [socketId, connection] of activeConnections) {
    if (connection.username === username) {
      return (global as any).io.sockets.sockets.get(socketId);
    }
  }
  return null;
}
