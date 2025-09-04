import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType } from '../../types/packet';
import { GameManager } from '../../game/GameManager';

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

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handleEndTurn(handler: PacketHandler, socket: Socket, io: Server): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      let playerId: string | null = null;
      for (const game of await this.gameManager.getAllGames()) {
        const player = game.players.find((p: any) => p.userId === connection.userId) as any;
        if (player) {
          playerId = player.id;
          break;
        }
      }

      if (!playerId) return;

      const turnAdvanced = await this.gameManager.endTurn(playerId);

      if (turnAdvanced && connection.gameId) {
        // Get the updated game state from database after turn processing
        const updatedGame = await this.gameManager.getGame(connection.gameId);
        const gameInstance = this.gameManager.getGameInstance(connection.gameId);

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
  }
}
