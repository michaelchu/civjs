import { Server, Socket } from 'socket.io';
import { logger } from '../utils/logger';
import { PacketHandler } from './PacketHandler';
import { GameManager } from '../game/managers/GameManager';
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
} from './handlers';
import { PacketType } from '../types/packet';

// Store active connections (shared across handlers)
const activeConnections = new Map<
  string,
  {
    userId?: string;
    username?: string;
    gameId?: string;
  }
>();

/**
 * Central coordinator for all socket handlers
 * Orchestrates specialized handlers and manages their lifecycle
 */
export class SocketCoordinator {
  private handlers: SocketHandler[] = [];
  private gameManager: GameManager;

  constructor(gameManager: GameManager) {
    this.gameManager = gameManager;
    this.initializeHandlers();
  }

  /**
   * Initialize all specialized handlers
   */
  private initializeHandlers(): void {
    this.handlers = [
      new ConnectionHandler(activeConnections),
      new GameManagementHandler(activeConnections, this.gameManager),
      new UnitActionHandler(activeConnections, this.gameManager),
      new CityManagementHandler(activeConnections, this.gameManager),
      new ResearchHandler(activeConnections, this.gameManager),
      new MapVisibilityHandler(activeConnections, this.gameManager),
      new ChatCommunicationHandler(activeConnections),
      new TurnManagementHandler(activeConnections, this.gameManager),
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

    // Additional disconnect logic for game-specific cleanup
    await this.handleGameSpecificDisconnect(socket);
  }

  /**
   * Handle game-specific disconnect logic
   */
  private async handleGameSpecificDisconnect(socket: Socket): Promise<void> {
    const connection = activeConnections.get(socket.id);
    if (connection?.userId && connection?.gameId) {
      try {
        const game = await this.gameManager.getGame(connection.gameId);
        if (game && game.players) {
          // Handle both Map (from gameInstance) and array (from database) formats
          const playersArray =
            game.players instanceof Map ? Array.from(game.players.values()) : game.players;
          const player = playersArray.find((p: any) => p.userId === connection.userId) as any;
          if (player) {
            await this.gameManager.updatePlayerConnection(player.id, false);
          }
        }
      } catch (error) {
        logger.error('Error handling game-specific disconnect:', error);
      }
    }
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
  getConnectionInfo(
    socketId: string
  ): { userId?: string; username?: string; gameId?: string } | undefined {
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
