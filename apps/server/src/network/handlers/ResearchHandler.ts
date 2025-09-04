import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  PacketType,
  ResearchSetSchema,
  ResearchGoalSetSchema,
  ResearchListSchema,
  ResearchProgressSchema,
} from '../../types/packet';
import { GameManager } from '../../game/GameManager';

/**
 * Handles research-related packets: setting research, research goals, progress tracking
 */
export class ResearchHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.RESEARCH_SET,
    PacketType.RESEARCH_SET_REPLY,
    PacketType.RESEARCH_GOAL_SET,
    PacketType.RESEARCH_GOAL_SET_REPLY,
    PacketType.RESEARCH_LIST,
    PacketType.RESEARCH_LIST_REPLY,
    PacketType.RESEARCH_PROGRESS,
    PacketType.RESEARCH_PROGRESS_REPLY,
  ];

  protected handlerName = 'ResearchHandler';

  constructor(
    private activeConnections: Map<string, any>,
    private gameManager: GameManager
  ) {
    super();
  }

  register(handler: PacketHandler, _io: Server, socket: Socket): void {
    handler.register(
      PacketType.RESEARCH_SET,
      async (socket, _data) => {
        await this.handleResearchSet(handler, socket, _data);
      },
      ResearchSetSchema
    );

    handler.register(
      PacketType.RESEARCH_GOAL_SET,
      async (socket, _data) => {
        await this.handleResearchGoalSet(handler, socket, _data);
      },
      ResearchGoalSetSchema
    );

    handler.register(
      PacketType.RESEARCH_LIST,
      async (socket, _data) => {
        await this.handleResearchList(handler, socket, _data);
      },
      ResearchListSchema
    );

    handler.register(
      PacketType.RESEARCH_PROGRESS,
      async (socket, _data) => {
        await this.handleResearchProgress(handler, socket, _data);
      },
      ResearchProgressSchema
    );

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handleResearchSet(
    handler: PacketHandler,
    socket: Socket,
    data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.RESEARCH_SET_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
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

      await this.gameManager.setPlayerResearch(connection.gameId!, player.id, data.techId);

      const availableTechs = this.gameManager.getAvailableTechnologies(
        connection.gameId!,
        player.id
      );

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
  }

  private async handleResearchGoalSet(
    handler: PacketHandler,
    socket: Socket,
    data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.RESEARCH_GOAL_SET_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
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

      await this.gameManager.setResearchGoal(connection.gameId!, player.id, data.techId);

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
  }

  private async handleResearchList(
    handler: PacketHandler,
    socket: Socket,
    _data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game) return;

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) return;

      const availableTechs = this.gameManager.getAvailableTechnologies(
        connection.gameId!,
        player.id
      );
      const playerResearch = this.gameManager.getPlayerResearch(connection.gameId!, player.id);

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
  }

  private async handleResearchProgress(
    handler: PacketHandler,
    socket: Socket,
    _data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game) return;

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) return;

      const playerResearch = this.gameManager.getPlayerResearch(connection.gameId!, player.id);
      const progress = this.gameManager.getResearchProgress(connection.gameId!, player.id);

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
  }
}
