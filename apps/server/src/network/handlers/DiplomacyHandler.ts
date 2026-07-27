import type { Server, Socket } from 'socket.io';
import { BaseSocketHandler } from './BaseSocketHandler';
import type { PacketHandler } from '../PacketHandler';
import { PacketType } from '@app-types/packet';
import type { GameManager } from '@game/managers/GameManager';
import type { TreatyClause } from '@game/managers/DiplomacyManager';
import { logger } from '@utils/logger';

export class DiplomacyHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.DIPLOMACY_LIST_REQ,
    PacketType.DIPLOMACY_TREATY_PROPOSE,
    PacketType.DIPLOMACY_TREATY_RESPONSE,
    PacketType.DIPLOMACY_TREATY_CANCEL,
    PacketType.DIPLOMACY_DECLARE_WAR,
  ];
  protected handlerName = 'DiplomacyHandler';

  constructor(
    private readonly activeConnections: Map<string, any>,
    private readonly gameManager: GameManager
  ) {
    super();
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    handler.register(PacketType.DIPLOMACY_LIST_REQ, async () => {
      await this.handleRequest(handler, socket);
    });
    handler.register(PacketType.DIPLOMACY_TREATY_PROPOSE, async (_socket, data) => {
      await this.handleMutation(handler, socket, io, async (gameId, playerId) => {
        await this.gameManager.proposeTreaty(
          gameId,
          playerId,
          data.recipientId,
          data.clauses as TreatyClause[],
          data.requestId
        );
      });
    });
    handler.register(PacketType.DIPLOMACY_TREATY_RESPONSE, async (_socket, data) => {
      await this.handleMutation(handler, socket, io, async (gameId, playerId) => {
        await this.gameManager.respondToTreaty(
          gameId,
          playerId,
          data.otherPlayerId,
          data.proposalId,
          Boolean(data.accept)
        );
      });
    });
    handler.register(PacketType.DIPLOMACY_TREATY_CANCEL, async (_socket, data) => {
      await this.handleMutation(handler, socket, io, async (gameId, playerId) => {
        await this.gameManager.cancelTreaty(gameId, playerId, data.otherPlayerId, data.proposalId);
      });
    });
    handler.register(PacketType.DIPLOMACY_DECLARE_WAR, async (_socket, data) => {
      await this.handleMutation(handler, socket, io, async (gameId, playerId) => {
        await this.gameManager.declareWar(gameId, playerId, data.otherPlayerId);
      });
    });
  }

  private async handleRequest(handler: PacketHandler, socket: Socket): Promise<void> {
    try {
      const context = await this.resolveContext(socket);
      const snapshot = await this.gameManager.getDiplomacySnapshot(
        context.gameId,
        context.playerId
      );
      handler.send(socket, PacketType.DIPLOMACY_LIST_REPLY, { success: true, ...snapshot });
    } catch (error) {
      handler.send(socket, PacketType.DIPLOMACY_LIST_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Unable to load diplomacy',
      });
    }
  }

  private async handleMutation(
    handler: PacketHandler,
    socket: Socket,
    io: Server,
    mutation: (gameId: string, playerId: string) => Promise<void>
  ): Promise<void> {
    try {
      const context = await this.resolveContext(socket);
      await mutation(context.gameId, context.playerId);
      await this.broadcastSnapshots(io, context.gameId);
    } catch (error) {
      logger.warn('Diplomacy request rejected', { error });
      handler.send(socket, PacketType.DIPLOMACY_UPDATE, {
        success: false,
        message: error instanceof Error ? error.message : 'Diplomacy request failed',
      });
    }
  }

  private async resolveContext(socket: Socket): Promise<{ gameId: string; playerId: string }> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      throw new Error('Not authenticated in a game');
    }
    if (connection.role === 'spectator') throw new Error('Spectators cannot conduct diplomacy');
    let instance = this.gameManager.getGameInstance(connection.gameId);
    if (!instance) instance = await this.gameManager.recoverGameInstance(connection.gameId);
    const player = instance
      ? [...instance.players.values()].find(candidate => candidate.userId === connection.userId)
      : undefined;
    if (!player) throw new Error('Player not found in game');
    return { gameId: connection.gameId, playerId: player.id };
  }

  private async broadcastSnapshots(io: Server, gameId: string): Promise<void> {
    const instance = this.gameManager.getGameInstance(gameId);
    if (!instance) return;
    for (const player of instance.players.values()) {
      if (!player.userId) continue;
      const snapshot = await this.gameManager.getDiplomacySnapshot(gameId, player.id);
      io.to(`player:${player.userId}`).emit('packet', {
        type: PacketType.DIPLOMACY_UPDATE,
        timestamp: Date.now(),
        data: { success: true, ...snapshot },
      });
    }
  }
}
