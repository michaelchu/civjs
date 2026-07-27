import { Server, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { PacketHandler } from './PacketHandler';
import { GameManager } from '@game/managers/GameManager';
import {
  SocketHandler,
  ConnectionHandler,
  GameManagementHandler,
  UnitActionHandler,
  CityManagementHandler,
  ResearchHandler,
  MapVisibilityHandler,
  ChatCommunicationHandler,
  TurnManagementHandler,
  GovernmentHandler,
  EconomicHandler,
  DiplomacyHandler,
} from './handlers';
import { PacketType } from '../types/packet';
import { db, type Database } from '@database';

// Store active connections (shared across handlers)
const activeConnections = new Map<
  string,
  {
    userId?: string;
    username?: string;
    gameId?: string;
    role?: 'player' | 'spectator';
  }
>();

/**
 * Central coordinator for all socket handlers
 * Orchestrates specialized handlers and manages their lifecycle
 */
export class SocketCoordinator {
  private handlers: SocketHandler[] = [];
  private gameManager: GameManager;

  constructor(
    gameManager: GameManager,
    private database: Database = db
  ) {
    this.gameManager = gameManager;
    this.initializeHandlers();
  }

  /**
   * Initialize all specialized handlers
   */
  private initializeHandlers(): void {
    this.handlers = [
      new ConnectionHandler(activeConnections, this.database),
      new GameManagementHandler(activeConnections, this.gameManager),
      new UnitActionHandler(activeConnections, this.gameManager),
      new CityManagementHandler(activeConnections, this.gameManager),
      new ResearchHandler(activeConnections, this.gameManager),
      new MapVisibilityHandler(activeConnections, this.gameManager),
      new ChatCommunicationHandler(activeConnections),
      new TurnManagementHandler(activeConnections, this.gameManager),
      new GovernmentHandler(activeConnections, this.gameManager),
      new EconomicHandler(activeConnections, this.gameManager, this.database),
      new DiplomacyHandler(activeConnections, this.gameManager),
    ];

    logger.info(`SocketCoordinator initialized with ${this.handlers.length} handlers`);
  }

  /**
   * Setup handlers for a new socket connection
   */
  setupSocket(io: Server, socket: Socket): void {
    const packetHandler = new PacketHandler();

    // Store packet handler on socket for use in helper functions
    socket.data.packetHandler = packetHandler;

    // Register all handlers
    for (const handler of this.handlers) {
      try {
        handler.register(packetHandler, io, socket);
        logger.debug(`Registered ${handler.getName()} for socket ${socket.id}`);
      } catch (error) {
        logger.error(`Error registering ${handler.getName()}:`, error);
      }
    }

    // Setup packet processing
    socket.on('packet', async packet => {
      try {
        const connection = activeConnections.get(socket.id);
        const spectatorSafePackets = new Set([
          PacketType.GAME_LIST,
          PacketType.MAP_VIEW_REQ,
          PacketType.TILE_VISIBILITY_REQ,
          PacketType.CHAT_MSG_REQ,
          PacketType.DIPLOMACY_LIST_REQ,
        ]);
        if (connection?.role === 'spectator' && !spectatorSafePackets.has(packet.type)) {
          socket.emit('packet', {
            type: PacketType.SERVER_MESSAGE,
            data: { type: 'error', message: 'Spectators cannot change game state' },
          });
          return;
        }
        await packetHandler.process(socket, packet);
      } catch (error) {
        logger.error(`Error processing packet from ${socket.id}:`, error);
      }
    });

    // Setup disconnect handling
    socket.on('disconnect', async () => {
      await this.handleDisconnect(socket);
    });

    logger.info(`Socket ${socket.id} setup completed with ${this.handlers.length} handlers`);
  }

  /**
   * Handle socket disconnect - cleanup all handlers
   */
  private async handleDisconnect(socket: Socket): Promise<void> {
    logger.info(`Cleaning up handlers for disconnected socket: ${socket.id}`);

    // ConnectionHandler cleanup removes the shared connection record, so the
    // game-specific transition must happen first.
    await this.handleGameSpecificDisconnect(socket);

    // Cleanup all handlers
    for (const handler of this.handlers) {
      try {
        if (handler.cleanup) {
          handler.cleanup(socket.id);
        }
      } catch (error) {
        logger.error(`Error cleaning up ${handler.getName()}:`, error);
      }
    }

    // Cleanup packet handler
    if (socket.data.packetHandler) {
      socket.data.packetHandler.cleanup(socket.id);
    }

    activeConnections.delete(socket.id);
  }

  /**
   * Handle game-specific disconnect logic
   */
  private async handleGameSpecificDisconnect(socket: Socket): Promise<void> {
    const connection = activeConnections.get(socket.id);
    if (!connection?.userId || !connection.gameId) return;
    if (this.hasAnotherPlayerSocket(socket.id, connection)) return;
    try {
      const playerId = await this.findPlayerId(connection.gameId, connection.userId);
      if (playerId) await this.gameManager.updatePlayerConnection(playerId, false);
    } catch (error) {
      logger.error('Error handling game-specific disconnect:', error);
    }
  }

  private async findPlayerId(gameId: string, userId: string): Promise<string | undefined> {
    const game = await this.gameManager.getGame(gameId);
    if (!game?.players) return undefined;
    // Handle both Map (from gameInstance) and array (from database) formats.
    const players = game.players instanceof Map ? Array.from(game.players.values()) : game.players;
    return players.find((player: any) => player.userId === userId)?.id;
  }

  private hasAnotherPlayerSocket(
    disconnectedSocketId: string,
    connection: { userId?: string; gameId?: string }
  ): boolean {
    return [...activeConnections.entries()].some(
      ([socketId, candidate]) =>
        socketId !== disconnectedSocketId &&
        candidate.userId === connection.userId &&
        candidate.gameId === connection.gameId &&
        candidate.role === 'player'
    );
  }

  /**
   * Get handler statistics
   */
  getHandlerStats(): { name: string; packetTypes: PacketType[] }[] {
    return this.handlers.map(handler => ({
      name: handler.getName(),
      packetTypes: handler.getHandledPacketTypes(),
    }));
  }

  /**
   * Get active connections count
   */
  getActiveConnectionsCount(): number {
    return activeConnections.size;
  }

  /**
   * Get connection info for a socket (for testing/debugging)
   */
  getConnectionInfo(socketId: string):
    | {
        userId?: string;
        username?: string;
        gameId?: string;
        role?: 'player' | 'spectator';
      }
    | undefined {
    return activeConnections.get(socketId);
  }
}

/**
 * Main setup function - replaces the original setupSocketHandlers
 */
export function setupSocketHandlers(io: Server, socket: Socket): void {
  const gameManager = GameManager.getInstance(io);
  const coordinator = new SocketCoordinator(gameManager);
  coordinator.setupSocket(io, socket);
}
