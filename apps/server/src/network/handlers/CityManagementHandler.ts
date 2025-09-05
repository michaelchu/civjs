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

  private async handleCityFound(
    handler: PacketHandler,
    io: Server,
    socket: Socket,
    data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const { game, player } = await this.validateGameAndPlayer(handler, socket, connection);
      if (!game || !player) return;

      // Process settler unit validation and retrieval
      const settlerUnit = await this.processSettlerUnit(handler, socket, data, player, connection);
      if (settlerUnit === null) return; // Validation failed, error already sent

      // Found city with comprehensive Freeciv-based validation
      const cityId = await this.gameManager.foundCity(
        connection.gameId!,
        player.id,
        data.name,
        data.x,
        data.y,
        settlerUnit // Pass unit for validation
      );

      // Handle settler unit consumption and send success response
      this.handlePostCityFoundingActions(io, handler, socket, data, connection, player, cityId);
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

  private async validateGameAndPlayer(
    handler: PacketHandler,
    socket: Socket,
    connection: any
  ): Promise<{ game: any; player: any } | { game: null; player: null }> {
    const game = await this.gameManager.getGame(connection.gameId!);
    if (!game || game.state !== 'active') {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Game is not active',
      });
      return { game: null, player: null };
    }

    const player = Array.from(game.players.values()).find(
      (p: any) => p.userId === connection.userId
    ) as any;
    if (!player) {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Player not found in game',
      });
      return { game: null, player: null };
    }

    return { game, player };
  }

  private validateSettlerUnit(
    unitId: string,
    playerId: string,
    gameId: string
  ): { isValid: boolean; errorMessage?: string } {
    const gameInstance = this.gameManager.getGameInstance(gameId);
    if (!gameInstance) {
      return { isValid: false, errorMessage: 'Game not found' };
    }

    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit) {
      return { isValid: false, errorMessage: 'Settler unit not found' };
    }

    if (unit.playerId !== playerId) {
      return { isValid: false, errorMessage: 'Unit does not belong to player' };
    }

    if (unit.unitTypeId !== 'settler') {
      return { isValid: false, errorMessage: 'Only settlers can found cities' };
    }

    return { isValid: true };
  }

  private removeSettlerUnit(
    io: Server,
    gameId: string,
    unitId: string,
    cityId: string,
    playerId: string
  ): void {
    const gameInstance = this.gameManager.getGameInstance(gameId);
    if (!gameInstance) return;

    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit) return;

    gameInstance.unitManager.removeUnit(unitId);

    // Broadcast unit destruction to all players
    io.to(`game:${gameId}`).emit('unit_destroyed', {
      gameId,
      unitId,
    });

    logger.debug('Settler unit consumed by city founding', {
      unitId,
      cityId,
      playerId,
    });
  }

  /**
   * Process settler unit validation and retrieval
   * Returns undefined for no unit, Unit for valid unit, or null for validation failure
   */
  private async processSettlerUnit(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    player: any,
    connection: any
  ): Promise<any | undefined | null> {
    if (!data.unitId) {
      return undefined; // No unit provided
    }

    const unitValidationResult = this.validateSettlerUnit(
      data.unitId,
      player.id,
      connection.gameId!
    );

    if (!unitValidationResult.isValid) {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: unitValidationResult.errorMessage!,
      });
      return null; // Validation failed
    }

    const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
    return gameInstance?.unitManager.getUnit(data.unitId);
  }

  /**
   * Handle post city founding actions: unit removal, response, and logging
   */
  private handlePostCityFoundingActions(
    io: Server,
    handler: PacketHandler,
    socket: Socket,
    data: any,
    connection: any,
    player: any,
    cityId: string
  ): void {
    // Remove the settler unit if unitId was provided
    if (data.unitId) {
      this.removeSettlerUnit(io, connection.gameId!, data.unitId, cityId, player.id);
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
  }
}
