/**
 * @module server/network/handlers/EconomicHandler
 * Handles Economic Handler socket events.
 */
import { Server, Socket } from 'socket.io';
import { and, eq } from 'drizzle-orm';
import { players } from '@database/schema';
import type { Database } from '@database';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { GameManager } from '@game/managers/GameManager';

export class EconomicHandler extends BaseSocketHandler {
  protected handledPacketTypes = [];
  protected handlerName = 'EconomicHandler';

  constructor(
    private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>,
    private gameManager: GameManager,
    private database: Database
  ) {
    super();
  }

  register(_handler: PacketHandler, _io: Server, socket: Socket): void {
    socket.on('economy:getTaxRates', (_data, callback) => {
      const context = this.resolveContext(socket);
      if (!context) {
        callback({ success: false, error: 'Player or active game not found' });
        return;
      }
      callback({
        success: true,
        rates: context.economicManager.getPlayerTaxRates(context.playerId),
      });
    });

    socket.on('economy:setTaxRates', async (data, callback) => {
      const context = this.resolveContext(socket);
      if (!context) {
        callback({ success: false, error: 'Player or active game not found' });
        return;
      }
      const rates = {
        tax: Number(data.tax),
        luxury: Number(data.luxury),
        science: Number(data.science),
      };
      const validation = context.economicManager.setPlayerTaxRates({
        playerId: context.playerId,
        newRates: rates,
      });
      if (!validation.isValid) {
        callback({ success: false, error: validation.error });
        return;
      }
      await this.database
        .update(players)
        .set({
          taxRate: rates.tax,
          luxuryRate: rates.luxury,
          scienceRate: rates.science,
        })
        .where(and(eq(players.gameId, context.gameId), eq(players.id, context.playerId)));
      callback({ success: true, rates });
    });
  }

  private resolveContext(socket: Socket):
    | {
        gameId: string;
        playerId: string;
        economicManager: NonNullable<
          ReturnType<
            NonNullable<
              ReturnType<GameManager['getGameInstance']>
            >['turnManager']['getEconomicManager']
          >
        >;
      }
    | undefined {
    const connection = this.getConnection(socket, this.activeConnections);
    if (
      !this.isAuthenticated(connection) ||
      !this.isInGame(connection) ||
      this.isSpectator(connection)
    )
      return undefined;
    const game = this.gameManager.getGameInstance(connection.gameId!);
    const player = game
      ? Array.from(game.players.values()).find(candidate => candidate.userId === connection.userId)
      : undefined;
    const economicManager = game?.turnManager.getEconomicManager();
    if (!player || !economicManager) return undefined;
    return { gameId: connection.gameId!, playerId: player.id, economicManager };
  }
}
