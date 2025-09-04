/* eslint-disable @typescript-eslint/no-unused-vars */
import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  PacketType,
  UnitMoveSchema,
  UnitAttackSchema,
  UnitFortifySchema,
  UnitCreateSchema,
} from '../../types/packet';
import { GameManager } from '../../game/GameManager';

/**
 * Handles unit action packets: movement, attack, fortify, creation, pathfinding
 * Manages unit-related operations and interactions
 */
export class UnitActionHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.UNIT_MOVE,
    PacketType.UNIT_MOVE_REPLY,
    PacketType.UNIT_ATTACK,
    PacketType.UNIT_ATTACK_REPLY,
    PacketType.UNIT_FORTIFY,
    PacketType.UNIT_FORTIFY_REPLY,
    PacketType.UNIT_CREATE,
    PacketType.UNIT_CREATE_REPLY,
    PacketType.UNIT_INFO,
  ];

  protected handlerName = 'UnitActionHandler';

  private activeConnections: Map<string, { userId?: string; username?: string; gameId?: string }>;
  private gameManager: GameManager;

  constructor(activeConnections: Map<string, any>, gameManager: GameManager) {
    super();
    this.activeConnections = activeConnections;
    this.gameManager = gameManager;
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    // Register packet handlers
    handler.register(
      PacketType.UNIT_MOVE,
      async (socket, data) => {
        await this.handleUnitMove(handler, socket, data, io);
      },
      UnitMoveSchema
    );

    handler.register(
      PacketType.UNIT_ATTACK,
      async (socket, data) => {
        await this.handleUnitAttack(handler, socket, data, io);
      },
      UnitAttackSchema
    );

    handler.register(
      PacketType.UNIT_FORTIFY,
      async (socket, data) => {
        await this.handleUnitFortify(handler, socket, data, io);
      },
      UnitFortifySchema
    );

    handler.register(
      PacketType.UNIT_CREATE,
      async (socket, data) => {
        await this.handleUnitCreate(handler, socket, data, io);
      },
      UnitCreateSchema
    );

    // Register socket event handlers
    this.registerSocketEvents(socket, io);

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  /**
   * Register non-packet socket events
   */
  private registerSocketEvents(socket: Socket, io: Server): void {
    // Handle unit_action event
    socket.on('unit_action', async (data, callback) => {
      await this.handleUnitActionEvent(socket, data, callback, io);
    });

    // Handle path_request event
    socket.on('path_request', async (data, callback) => {
      await this.handlePathRequestEvent(socket, data, callback);
    });
  }

  /**
   * Handle UNIT_MOVE packet
   */
  private async handleUnitMove(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    _io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
        success: false,
        unitId: data.unitId,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Player not found in game',
        });
        return;
      }

      // Execute the move immediately
      const moved = await this.gameManager.moveUnit(
        connection.gameId!,
        player.id,
        data.unitId,
        data.x,
        data.y
      );

      if (moved) {
        const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
        const unit = gameInstance?.unitManager.getUnit(data.unitId);
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: true,
          unitId: data.unitId,
          newX: unit?.x,
          newY: unit?.y,
          movementLeft: unit?.movementLeft,
        });

        logger.debug('Unit moved successfully', {
          gameId: connection.gameId,
          playerId: player.id,
          unitId: data.unitId,
          newPosition: { x: data.x, y: data.y },
        });
      } else {
        handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Move failed',
        });
      }
    } catch (error) {
      logger.error('Error processing unit move:', error);
      handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
        success: false,
        unitId: data.unitId,
        message: error instanceof Error ? error.message : 'Failed to move unit',
      });
    }
  }

  /**
   * Handle UNIT_ATTACK packet
   */
  private async handleUnitAttack(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    _io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
          success: false,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
          success: false,
          message: 'Player not found in game',
        });
        return;
      }

      const combatResult = await this.gameManager.attackUnit(
        connection.gameId!,
        player.id,
        data.attackerUnitId,
        data.defenderUnitId
      );

      handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
        success: true,
        combatResult,
      });

      logger.debug('Unit attack executed', {
        gameId: connection.gameId,
        playerId: player.id,
        attackerUnitId: data.attackerUnitId,
        defenderUnitId: data.defenderUnitId,
        combatResult,
      });
    } catch (error) {
      logger.error('Error processing unit attack:', error);
      handler.send(socket, PacketType.UNIT_ATTACK_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to attack unit',
      });
    }
  }

  /**
   * Handle UNIT_FORTIFY packet
   */
  private async handleUnitFortify(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    _io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
        success: false,
        unitId: data.unitId,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
          success: false,
          unitId: data.unitId,
          message: 'Player not found in game',
        });
        return;
      }

      await this.gameManager.fortifyUnit(connection.gameId!, player.id, data.unitId);

      handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
        success: true,
        unitId: data.unitId,
      });

      logger.debug('Unit fortified', {
        gameId: connection.gameId,
        playerId: player.id,
        unitId: data.unitId,
      });
    } catch (error) {
      logger.error('Error fortifying unit:', error);
      handler.send(socket, PacketType.UNIT_FORTIFY_REPLY, {
        success: false,
        unitId: data.unitId,
        message: error instanceof Error ? error.message : 'Failed to fortify unit',
      });
    }
  }

  /**
   * Handle UNIT_CREATE packet
   */
  private async handleUnitCreate(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    _io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
        success: false,
        message: 'Not authenticated or not in a game',
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game || game.state !== 'active') {
        handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
          success: false,
          message: 'Game is not active',
        });
        return;
      }

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) {
        handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
          success: false,
          message: 'Player not found in game',
        });
        return;
      }

      const unitId = await this.gameManager.createUnit(
        connection.gameId!,
        player.id,
        data.unitType,
        data.x,
        data.y
      );

      handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
        success: true,
        unitId,
      });

      logger.debug('Unit created', {
        gameId: connection.gameId,
        playerId: player.id,
        unitId,
        unitType: data.unitType,
        position: { x: data.x, y: data.y },
      });
    } catch (error) {
      logger.error('Error creating unit:', error);
      handler.send(socket, PacketType.UNIT_CREATE_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create unit',
      });
    }
  }

  /**
   * Handle unit_action socket event
   */
  private async handleUnitActionEvent(
    socket: Socket,
    data: any,
    callback: Function,
    io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isInGame(connection)) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
      if (!gameInstance) {
        callback({ success: false, error: 'Game instance not found' });
        return;
      }

      // Get player ID from user
      let playerId: string | undefined = undefined;
      if (connection.userId) {
        const playerIds = Array.from(gameInstance.players.keys());
        for (const pid of playerIds) {
          const player = gameInstance.players.get(pid);
          if (player && player.userId === connection.userId) {
            playerId = pid;
            break;
          }
        }
      }

      if (!playerId) {
        callback({ success: false, error: 'Player not found' });
        return;
      }

      // Execute the unit action
      const result = await gameInstance.unitManager.executeUnitAction(
        data.unitId,
        data.actionType,
        data.targetX,
        data.targetY
      );

      if (result.success) {
        // If unit was destroyed (e.g., settler founding city), broadcast destruction
        if (result.unitDestroyed) {
          io.to(`game:${connection.gameId}`).emit('unit_destroyed', {
            gameId: connection.gameId,
            unitId: data.unitId,
          });
        } else {
          // Broadcast unit state updates if unit still exists
          const updatedUnit = gameInstance.unitManager.getUnit(data.unitId);
          if (updatedUnit) {
            io.to(`game:${connection.gameId}`).emit('unit_update', {
              gameId: connection.gameId,
              unit: updatedUnit,
            });
          }
        }

        callback({ success: true, result });
        logger.info(`Unit action executed successfully`, {
          unitId: data.unitId,
          actionType: data.actionType,
          playerId,
        });
      } else {
        callback({ success: false, error: result.message });
        logger.warn(`Unit action failed`, {
          unitId: data.unitId,
          actionType: data.actionType,
          error: result.message,
          playerId,
        });
      }
    } catch (error) {
      logger.error('Error executing unit action:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute unit action',
      });
    }
  }

  /**
   * Handle path_request socket event
   */
  private async handlePathRequestEvent(
    socket: Socket,
    data: any,
    callback: Function
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Not authenticated or not in a game' });
      }
      return;
    }

    try {
      const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
      if (!gameInstance) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Game instance not found' });
        }
        return;
      }

      // Get player ID from user
      let playerId: string | undefined = undefined;
      const playerIds = Array.from(gameInstance.players.keys());
      for (const pid of playerIds) {
        const player = gameInstance.players.get(pid);
        if (player && player.userId === connection.userId) {
          playerId = pid;
          break;
        }
      }

      if (!playerId) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Player not found' });
        }
        return;
      }

      // Request pathfinding from GameManager
      const pathResult = await this.gameManager.requestPath(
        playerId,
        data.unitId,
        data.targetX,
        data.targetY
      );

      if (typeof callback === 'function') {
        callback(pathResult);
      }

      // Also emit to the socket for the PathfindingService listener
      const responseWithId = {
        ...pathResult,
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
      };

      socket.emit('path_response', responseWithId);

      logger.debug('Path request processed', {
        gameId: connection.gameId,
        playerId,
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
        success: pathResult.success,
      });
    } catch (error) {
      logger.error('Error processing path request:', error);
      const errorResponse = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process path request',
        unitId: data.unitId,
        targetX: data.targetX,
        targetY: data.targetY,
        path: null,
      };

      if (typeof callback === 'function') {
        callback(errorResponse);
      }

      socket.emit('path_response', errorResponse);
    }
  }
}
