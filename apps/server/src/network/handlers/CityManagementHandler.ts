import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType, CityFoundSchema, CityProductionChangeSchema } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';

/**
 * Handles city management packets: founding cities, production changes
 */
export class CityManagementHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.CITY_FOUND,
    PacketType.CITY_FOUND_REPLY,
    PacketType.CITY_PRODUCTION_CHANGE,
    PacketType.CITY_PRODUCTION_CHANGE_REPLY,
    PacketType.CITY_INFO,
  ];

  protected handlerName = 'CityManagementHandler';

  private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>;
  private gameManager: GameManager;

  constructor(activeConnections: Map<string, any>, gameManager: GameManager) {
    super();
    this.activeConnections = activeConnections;
    this.gameManager = gameManager;
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    handler.register(
      PacketType.CITY_FOUND,
      async (socket, data) => {
        await this.handleCityFound(handler, io, socket, data);
      },
      CityFoundSchema
    );

    handler.register(
      PacketType.CITY_PRODUCTION_CHANGE,
      async (socket, data) => {
        await this.handleCityProductionChange(handler, socket, data);
      },
      CityProductionChangeSchema
    );

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handleCityFound(handler: PacketHandler, io: Server, socket: Socket, data: any): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.CITY_FOUND_REPLY, {
          success: false,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.CITY_FOUND_REPLY, {
          success: false,
          message: 'Player not found in game',
        });
        return;
      }

      // If unitId is provided, verify the unit exists and belongs to the player
      if (data.unitId) {
        const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
        if (gameInstance) {
          const unit = gameInstance.unitManager.getUnit(data.unitId);
          if (!unit) {
            handler.send(socket, PacketType.CITY_FOUND_REPLY, {
              success: false,
              message: 'Settler unit not found',
            });
            return;
          }
          if (unit.playerId !== player.id) {
            handler.send(socket, PacketType.CITY_FOUND_REPLY, {
              success: false,
              message: 'Unit does not belong to player',
            });
            return;
          }
          if (unit.unitTypeId !== 'settler') {
            handler.send(socket, PacketType.CITY_FOUND_REPLY, {
              success: false,
              message: 'Only settlers can found cities',
            });
            return;
          }
        }
      }

      const cityId = await this.gameManager.foundCity(
        connection.gameId!,
        player.id,
        data.name,
        data.x,
        data.y
      );

      // Remove the settler unit if unitId was provided
      if (data.unitId) {
        const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
        if (gameInstance) {
          const unit = gameInstance.unitManager.getUnit(data.unitId);
          if (unit) {
            gameInstance.unitManager.removeUnit(data.unitId);
            
            // Broadcast unit destruction to all players
            io.to(`game:${connection.gameId}`).emit('unit_destroyed', {
              gameId: connection.gameId,
              unitId: data.unitId,
            });
            
            logger.debug('Settler unit consumed by city founding', {
              unitId: data.unitId,
              cityId,
              playerId: player.id,
            });
          }
        }
      }

      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: true,
        cityId,
      });

      logger.debug('City founded', {
        gameId: connection.gameId,
        playerId: player.id,
        cityId,
        name: data.name,
        position: { x: data.x, y: data.y },
        settlerConsumed: !!data.unitId,
      });
    } catch (error) {
      logger.error('Error founding city:', error);
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to found city',
      });
    }
  }

  private async handleCityProductionChange(
    handler: PacketHandler,
    socket: Socket,
    data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
          success: false,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
          success: false,
          message: 'Player not found in game',
        });
        return;
      }

      await this.gameManager.setCityProduction(
        connection.gameId!,
        player.id,
        data.cityId,
        data.production,
        data.type
      );

      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: true,
      });

      logger.debug('City production changed', {
        gameId: connection.gameId,
        playerId: player.id,
        cityId: data.cityId,
        production: data.production,
        type: data.type,
      });
    } catch (error) {
      logger.error('Error changing city production:', error);
      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to change production',
      });
    }
  }
}
