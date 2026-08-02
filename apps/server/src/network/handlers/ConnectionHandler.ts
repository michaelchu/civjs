/**
 * @module server/network/handlers/ConnectionHandler
 * Handles Connection Handler socket events.
 */
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType, PROTOCOL_VERSION, ServerJoinReqSchema } from '@app-types/packet';
import { sessionCache } from '@database/redis';
import { db, type Database } from '@database';
import { users } from '@database/schema';
import { eq } from 'drizzle-orm';

/**
 * Handles connection-related packets: authentication, join/leave, disconnect
 * Manages active connections and user sessions
 */
export class ConnectionHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.SERVER_JOIN_REQ,
    PacketType.SERVER_JOIN_REPLY,
    PacketType.AUTHENTICATION_REQ,
    PacketType.AUTHENTICATION_REPLY,
  ];

  protected handlerName = 'ConnectionHandler';

  private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>;

  constructor(
    activeConnections: Map<string, any>,
    private database: Database = db
  ) {
    super();
    this.activeConnections = activeConnections;
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    // Initialize connection entry
    this.activeConnections.set(socket.id, {});

    // Register SERVER_JOIN_REQ handler
    handler.register(
      PacketType.SERVER_JOIN_REQ,
      async (_socket, data) => {
        await this.handleServerJoinRequest(handler, socket, data);
      },
      ServerJoinReqSchema
    );

    // Register socket event handlers
    this.registerSocketEvents(socket, io);

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  cleanup(socketId: string): void {
    this.activeConnections.delete(socketId);
    logger.debug(`${this.handlerName} cleaned up connection for socket ${socketId}`);
  }

  /**
   * Handle SERVER_JOIN_REQ packet
   */
  private async handleServerJoinRequest(
    handler: PacketHandler,
    socket: Socket,
    data: { username: string }
  ): Promise<void> {
    try {
      const { username } = data;

      const existingUser = await this.database.query.users.findFirst({
        where: eq(users.username, username),
      });

      let userId: string;
      let isNewUser = false;

      if (existingUser) {
        userId = existingUser.id;
        await this.database.update(users).set({ lastSeen: new Date() }).where(eq(users.id, userId));
      } else {
        const result = await this.createNewUser(username);
        userId = result.userId;
        isNewUser = result.isNewUser;
      }

      const connection = this.activeConnections.get(socket.id);
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
  }

  /**
   * Register non-packet socket events
   */
  private registerSocketEvents(socket: Socket, io: Server): void {
    // Handle socket disconnect
    socket.on('disconnect', async () => {
      await this.handleDisconnect(socket, io);
    });

    // Handle socket errors
    socket.on('error', error => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  }

  /**
   * Handle socket disconnect
   */
  private async handleDisconnect(socket: Socket, _io: Server): Promise<void> {
    logger.info(`Client disconnected: ${socket.id}`);

    const connection = this.activeConnections.get(socket.id);
    if (connection?.userId) {
      try {
        await this.database
          .update(users)
          .set({ lastSeen: new Date() })
          .where(eq(users.id, connection.userId));
      } catch (error) {
        // Disconnect cleanup is best-effort. A database outage must not turn
        // an otherwise normal socket disconnect into an unhandled rejection.
        logger.warn('Unable to persist user last-seen timestamp during disconnect', {
          userId: connection.userId,
          error: error instanceof Error ? error.message : error,
        });
      }

      if (connection.gameId) {
        // Emit disconnect message to game room
        socket.to(`game:${connection.gameId}`).emit('packet', {
          version: PROTOCOL_VERSION,
          type: PacketType.CONNECT_MSG,
          data: {
            type: 'player_disconnected',
            username: connection.username,
          },
        });
      }
    }

    // Cleanup will be called by SocketCoordinator
  }

  /**
   * Get connection info for a socket
   */
  getConnectionInfo(
    socketId: string
  ): { userId?: string; username?: string; gameId?: string } | undefined {
    return this.activeConnections.get(socketId);
  }

  /**
   * Create new user with race condition handling
   */
  private async createNewUser(username: string): Promise<{ userId: string; isNewUser: boolean }> {
    try {
      const [newUser] = await this.database
        .insert(users)
        .values({
          username,
          isGuest: true,
        })
        .returning();
      return { userId: newUser.id, isNewUser: true };
    } catch (insertError: any) {
      return await this.handleUserCreationRaceCondition(username, insertError);
    }
  }

  /**
   * Handle race condition during user creation
   */
  private async handleUserCreationRaceCondition(
    username: string,
    insertError: any
  ): Promise<{ userId: string; isNewUser: boolean }> {
    // Handle race condition: username was created by another connection
    if (insertError?.code !== '23505') {
      throw insertError; // Re-throw if it's a different error
    }

    // PostgreSQL unique constraint violation
    logger.debug(
      `Username ${username} already exists due to race condition, fetching existing user`
    );

    const existingUserRetry = await this.database.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (!existingUserRetry) {
      throw new Error(`Failed to find user ${username} after constraint violation`);
    }

    await this.database
      .update(users)
      .set({ lastSeen: new Date() })
      .where(eq(users.id, existingUserRetry.id));
    return { userId: existingUserRetry.id, isNewUser: false };
  }

  /**
   * Update connection info
   */
  updateConnection(
    socketId: string,
    updates: Partial<{ userId: string; username: string; gameId: string }>
  ): void {
    const connection = this.activeConnections.get(socketId);
    if (connection) {
      Object.assign(connection, updates);
    }
  }
}
