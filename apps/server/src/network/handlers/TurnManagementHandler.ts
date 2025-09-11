import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';

/**
 * Handles turn management packets: ending turns, turn processing
 */
export class TurnManagementHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.END_TURN,
    PacketType.TURN_END_REPLY,
    PacketType.TURN_START,
    PacketType.NEW_TURN,
    PacketType.BEGIN_TURN,
    PacketType.NEW_YEAR, // Add NEW_YEAR packet support
  ];

  protected handlerName = 'TurnManagementHandler';

  constructor(
    private activeConnections: Map<string, any>,
    private gameManager: GameManager
  ) {
    super();
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    handler.register(PacketType.END_TURN, async socket => {
      await this.handleEndTurn(handler, socket, io);
    });

    // NEW_YEAR packets are server-generated only, so no client handler needed
    // but we register it for completeness and future client-side processing
    handler.register(PacketType.NEW_YEAR, async (socket, data) => {
      logger.debug('NEW_YEAR packet received (currently server-generated only)', {
        socketId: socket.id,
        data,
      });
    });

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handleEndTurn(handler: PacketHandler, socket: Socket, io: Server): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      const playerId = await this.resolvePlayerIdForTurn(connection);
      if (!playerId) return;

      const turnAdvanced = await this.gameManager.endTurn(playerId);

      if (turnAdvanced && connection.gameId) {
        await this.notifyTurnStart(io, connection.gameId);
      } else {
        logger.debug('Not sending TURN_START', {
          turnAdvanced,
          gameId: connection.gameId,
        });
      }

      handler.send(socket, PacketType.TURN_END_REPLY, { success: true, turnAdvanced });
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
  }

  private async resolvePlayerIdForTurn(connection: any): Promise<string | null> {
    for (const game of await this.gameManager.getAllGames()) {
      const player = game.players.find((p: any) => p.userId === connection.userId) as any;
      if (player) return player.id;
    }
    return null;
  }

  private async notifyTurnStart(io: Server, gameId: string): Promise<void> {
    const updatedGame = await this.gameManager.getGame(gameId);
    const gameInstance = this.gameManager.getGameInstance(gameId);

    if (updatedGame && gameInstance) {
      const turnData = {
        turn: updatedGame.currentTurn,
        year: gameInstance.turnManager.getCurrentYear(),
      };

      // Send NEW_YEAR packet first (freeciv-web protocol)
      io.to(`game:${gameId}`).emit('packet', {
        type: PacketType.NEW_YEAR,
        timestamp: Date.now(),
        data: {
          turn: turnData.turn,
          year: turnData.year,
          fragments: 0, // Calendar fragments - will be enhanced in Phase 2
        },
      });

      // Then send legacy TURN_START packet for backward compatibility
      logger.debug('Sending NEW_YEAR and TURN_START packets', {
        gameId,
        turnData,
        gameInstanceTurn: gameInstance.currentTurn,
        dbTurn: updatedGame.currentTurn,
      });

      // Small delay to ensure packet ordering
      setTimeout(() => {
        io.to(`game:${gameId}`).emit('packet', { type: PacketType.TURN_START, data: turnData });
      }, 10);
    } else {
      logger.warn('No game found for turn start notification', {
        gameId,
        updatedGame: !!updatedGame,
        gameInstance: !!gameInstance,
      });
    }
  }
}
