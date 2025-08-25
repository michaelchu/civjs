/* eslint-disable @typescript-eslint/no-explicit-any, complexity */
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
        const playerMapView = gameManager.getPlayerMapView(data.gameId, playerId);
        if (playerMapView) {
          // Send map-info packet (freeciv-web format)
          const mapInfoPacket = {
            xsize: playerMapView.width,
            ysize: playerMapView.height,
            topology: 0,
            wrap_id: 0, // Non-wrapping map
            startpos: [],
          };
          socket.emit('map-info', mapInfoPacket);

          // Send visible tiles to player
          let tileCount = 0;
          for (let x = 0; x < playerMapView.width; x++) {
            for (let y = 0; y < playerMapView.height; y++) {
              const tile = playerMapView.tiles[x][y];
              if (tile && (tile.isVisible || tile.isExplored)) {
                const tileIndex = y * playerMapView.width + x;
                
                const tileInfoPacket = {
                  tile: tileIndex,
                  x: x,
                  y: y,
                  terrain: tile.terrain,
                  known: tile.isExplored ? 1 : 0,
                  seen: tile.isVisible ? 1 : 0,
                  resource: tile.resource,
                };
                socket.emit('tile-info', tileInfoPacket);
                tileCount++;
              }
            }
          }
          logger.debug(`Sent ${tileCount} visible tiles to player`);
        }
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
      // Check if game exists
      const game = await gameManager.getGame(data.gameId);
      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      // Allow observing any game regardless of status or player count
      connection.gameId = data.gameId;
      socket.join(`game:${data.gameId}`);

      // Send map data to observer using EXACT same batching system as new games
      try {
        const gameInstance = gameManager.getGameInstance(data.gameId);
        if (gameInstance) {
          const mapData = gameInstance.mapManager.getMapData();
          if (mapData) {
            // Send map-info packet first
            const centerX = Math.floor(mapData.width / 2);
            const centerY = Math.floor(mapData.height / 2);
            const mapInfoPacket = {
              xsize: mapData.width,
              ysize: mapData.height,
              topology: 0,
              wrap_id: 0,
              startpos: [{ x: centerX, y: centerY }], // Center observer viewport
            };
            socket.emit('map-info', mapInfoPacket);

            // Use EXACT same batching logic from GameManager.broadcastMapData()
            // Collect all tiles into an array
            const allTiles = [];
            for (let y = 0; y < mapData.height; y++) {
              for (let x = 0; x < mapData.width; x++) {
                const index = x + y * mapData.width;
                // Handle column-based tile array structure: mapData.tiles[x][y]
                const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

                if (serverTile) {
                  // Format tile in exact freeciv-web format (copied from GameManager)
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

            // Send tiles in batches of 100 to avoid overwhelming the client (copied from GameManager)
            const BATCH_SIZE = 100;
            for (let i = 0; i < allTiles.length; i += BATCH_SIZE) {
              const batch = allTiles.slice(i, i + BATCH_SIZE);
              socket.emit('tile-info-batch', {
                tiles: batch,
                startIndex: i,
                endIndex: Math.min(i + BATCH_SIZE, allTiles.length),
                total: allTiles.length,
              });
            }

            logger.debug(
              `Sent ${allTiles.length} tiles in ${Math.ceil(allTiles.length / BATCH_SIZE)} batches to observer`
            );
          }
        }
      } catch (mapError) {
        logger.warn('Could not send map data to observer:', mapError);
      }

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
      const games = await gameManager.getGameListForLobby();
      callback({ success: true, games });
    } catch (error) {
      logger.error('Error getting game list:', error);
      callback({ success: false, error: 'Failed to get game list' });
    }
  });

  // Map data handlers
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
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get visible tiles',
      });
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

      // Automatically join the creator as a player
      // Join the socket room BEFORE joining the game so we receive broadcasts
      connection.gameId = gameId;
      socket.join(`game:${gameId}`);

      // Verify the join worked immediately

      const playerId = await gameManager.joinGame(gameId, connection.userId, 'random');
      await gameManager.updatePlayerConnection(playerId, true);

      // Emit game created event to the creator
      socket.emit('game_created', {
        gameId,
        maxPlayers: data.maxPlayers,
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
      for (const game of await gameManager.getAllGames()) {
        const player = Array.from(game.players.values()).find(
          (p: any) => p.userId === connection.userId
        ) as any;
        if (player) {
          playerId = player.id;
          break;
        }
      }

      if (!playerId) return;

      const turnAdvanced = await gameManager.endTurn(playerId);
      const game = await gameManager.getGameByPlayerId(playerId);

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
        const game = await gameManager.getGame(connection.gameId);
        if (!game || game.state !== 'active') {
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
          const gameForUnit = await gameManager.getGame(connection.gameId);
          const unit = gameForUnit?.unitManager.getUnit(data.unitId);
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
        if (!game || game.state !== 'active') {
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
}

function findSocketByUsername(username: string): Socket | null {
  for (const [socketId, connection] of activeConnections) {
    if (connection.username === username) {
      return (global as any).io.sockets.sockets.get(socketId);
    }
  }
  return null;
}
