/**
 * @module server/network/handlers/GovernmentHandler
 * Handles Government Handler socket events.
 */
import { Server, Socket } from 'socket.io';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { GameManager } from '@game/managers/GameManager';

export class GovernmentHandler extends BaseSocketHandler {
  protected handledPacketTypes = [];
  protected handlerName = 'GovernmentHandler';

  constructor(
    private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>,
    private gameManager: GameManager
  ) {
    super();
  }

  register(_handler: PacketHandler, _io: Server, socket: Socket): void {
    socket.on('government:getState', (_data, callback) => {
      const context = this.resolveContext(socket);
      if (!context) {
        callback({ success: false, error: 'Player or active game not found' });
        return;
      }
      callback({ success: true, state: this.serializeState(context.game, context.player.id) });
    });

    socket.on('government:startRevolution', async (data, callback) => {
      const context = this.resolveContext(socket);
      if (!context) {
        callback({ success: false, error: 'Player or active game not found' });
        return;
      }
      const manager = context.game.governmentManager;
      if (!manager) {
        callback({ success: false, error: 'Government system is unavailable' });
        return;
      }
      if (typeof data?.governmentId !== 'string') {
        callback({ success: false, error: 'Invalid government selection' });
        return;
      }
      const researchedTechs = new Set(
        context.game.researchManager.getResearchedTechs(context.player.id)
      );
      const result = await manager.startRevolution(
        context.player.id,
        data.governmentId,
        researchedTechs,
        context.game.turnManager.getCurrentTurn()
      );
      if (!result.success) {
        callback({ success: false, error: result.message });
        return;
      }
      for (const city of context.game.cityManager.getPlayerCities(context.player.id)) {
        context.game.cityManager.refreshCityWithGovernmentEffects(city.id);
      }
      callback({
        success: true,
        message: result.message,
        state: this.serializeState(context.game, context.player.id),
      });
    });
  }

  private serializeState(
    game: NonNullable<ReturnType<GameManager['getGameInstance']>>,
    playerId: string
  ) {
    const manager = game.governmentManager!;
    const playerGovernment = manager.getPlayerGovernment(playerId);
    const researchedTechs = new Set(game.researchManager.getResearchedTechs(playerId));
    return {
      governments: manager.getAllGovernments(),
      currentGovernment: playerGovernment?.currentGovernment,
      revolutionTurns: playerGovernment?.revolutionTurns ?? 0,
      requestedGovernment: playerGovernment?.requestedGovernment,
      availableGovernments: manager.getAvailableGovernments(researchedTechs).map(entry => ({
        id: entry.id,
        available: entry.available,
        reason: entry.reason,
      })),
    };
  }

  private resolveContext(socket: Socket):
    | {
        game: NonNullable<ReturnType<GameManager['getGameInstance']>>;
        player: { id: string };
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
    if (!game?.governmentManager) return undefined;
    const player = Array.from(game.players.values()).find(
      candidate => candidate.userId === connection.userId
    );
    return player ? { game, player } : undefined;
  }
}
