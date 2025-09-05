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
      logger.debug('Sending TURN_START packet', {
        gameId,
        turnData,
        gameInstanceTurn: gameInstance.currentTurn,
        dbTurn: updatedGame.currentTurn,
      });
      io.to(`game:${gameId}`).emit('packet', { type: PacketType.TURN_START, data: turnData });
    } else {
      logger.warn('No game found for TURN_START', {
        gameId,
        updatedGame: !!updatedGame,
        gameInstance: !!gameInstance,
      });
    }
  }
}
