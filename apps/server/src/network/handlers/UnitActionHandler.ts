import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  PacketType,
  UnitMoveSchema,
  UnitAttackSchema,
  UnitFortifySchema,
  UnitCreateSchema,
} from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { ActionType } from '@app-types/shared/actions';

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

    socket.on('unit_action_options', async (data, callback) => {
      try {
        const connection = this.getConnection(socket, this.activeConnections);
        if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
          callback({ success: false, error: 'Not authenticated or not in a game' });
          return;
        }
        const game = await this.resolveActiveGame(connection);
        const player = game ? this.resolvePlayerFromGame(connection, game) : undefined;
        if (!game || !player) {
          callback({ success: false, error: 'Game or player not found' });
          return;
        }
        callback({
          success: true,
          result: this.gameManager.getDiplomatActionOptions(
            connection.gameId!,
            player.id,
            data.unitId,
            data.actionType,
            data.targetX,
            data.targetY
          ),
        });
      } catch (error) {
        callback({
          success: false,
          error: error instanceof Error ? error.message : 'Failed to load action options',
        });
      }
    });

    // Handle path_request event
    socket.on('path_request', async (data, callback) => {
      await this.handlePathRequestEvent(socket, data, callback);
    });

    socket.on('movement_range_request', async (data, callback) => {
      await this.handleMovementRangeEvent(socket, data, callback);
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
      this.sendMoveReply(handler, socket, data.unitId, false, 'Not authenticated or not in a game');
      return;
    }

    try {
      const game = await this.resolveActiveGame(connection);
      if (!game) {
        this.sendMoveReply(handler, socket, data.unitId, false, 'Game is not active');
        return;
      }

      const player = this.resolvePlayerFromGame(connection, game);
      if (!player) {
        this.sendMoveReply(handler, socket, data.unitId, false, 'Player not found in game');
        return;
      }

      // Execute the move immediately
      const { moved, unit } = await this.executeMove(connection.gameId!, player.id, data);

      if (moved) {
        this.sendMoveSuccessReply(handler, socket, data.unitId, unit);
        logger.debug('Unit moved successfully', {
          gameId: connection.gameId,
          playerId: player.id,
          unitId: data.unitId,
          newPosition: { x: data.x, y: data.y },
        });
      } else {
        this.sendMoveReply(handler, socket, data.unitId, false, 'Move failed');
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

  private async resolveActiveGame(connection: any): Promise<any | null> {
    const game = await this.gameManager.getGame(connection.gameId!);
    if (!game || game.status !== 'active') return null;
    return game;
  }

  private resolvePlayerFromGame(connection: any, game: any): any | null {
    return (
      Array.from(game.players.values()).find((p: any) => p.userId === connection.userId) || null
    );
  }

  private async executeMove(
    gameId: string,
    playerId: string,
    data: { unitId: string; x: number; y: number }
  ): Promise<{ moved: boolean; unit?: any }> {
    const moved = await this.gameManager.moveUnit(gameId, playerId, data.unitId, data.x, data.y);
    if (!moved) return { moved };
    const gameInstance = this.gameManager.getGameInstance(gameId);
    const unit = gameInstance?.unitManager.getUnit(data.unitId);
    return { moved, unit };
  }

  private sendMoveReply(
    handler: PacketHandler,
    socket: Socket,
    unitId: string,
    success: boolean,
    message?: string
  ): void {
    const payload: any = { success, unitId };
    if (message) payload.message = message;
    handler.send(socket, PacketType.UNIT_MOVE_REPLY, payload);
  }

  private sendMoveSuccessReply(
    handler: PacketHandler,
    socket: Socket,
    unitId: string,
    unit: any | undefined
  ): void {
    handler.send(socket, PacketType.UNIT_MOVE_REPLY, {
      success: true,
      unitId,
      newX: unit?.x,
      newY: unit?.y,
      movementLeft: unit?.movementLeft,
    });
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
      if (!game || game.status !== 'active') {
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
      if (!game || game.status !== 'active') {
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
      if (!game || game.status !== 'active') {
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
    callback: (response: any) => void,
    _io: Server
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isInGame(connection) || this.isSpectator(connection)) {
      callback({ success: false, error: 'Not an active player' });
      return;
    }

    try {
      const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
      if (!gameInstance) {
        callback({ success: false, error: 'Game instance not found' });
        return;
      }

      const playerId = this.resolvePlayerId(connection, gameInstance);
      if (!playerId) {
        callback({ success: false, error: 'Player not found' });
        return;
      }

      const unitBeforeAction = gameInstance.unitManager.getUnit(data.unitId);
      const targetUnitsBeforeAction = this.captureTargetUnits(gameInstance, data, unitBeforeAction);
      const result = await this.executeRequestedUnitAction(
        gameInstance,
        connection.gameId!,
        playerId,
        data
      );

      if (!result.success) {
        callback({ success: false, error: result.message });
        logger.warn(`Unit action failed`, {
          unitId: data.unitId,
          actionType: data.actionType,
          error: result.message,
          playerId,
        });
        return;
      }
      this.broadcastUnitActionResult(
        connection.gameId!,
        data.unitId,
        result.unitDestroyed,
        targetUnitsBeforeAction,
        gameInstance
      );
      if (
        data.actionType === ActionType.NUCLEAR_EXPLOSION &&
        !gameInstance.unitManager.hasNuclearPresentationCallback?.()
      ) {
        const centerX = data.targetX ?? unitBeforeAction?.x;
        const centerY = data.targetY ?? unitBeforeAction?.y;
        if (centerX !== undefined && centerY !== undefined) {
          this.gameManager.broadcastNuclearExplosion(connection.gameId!, {
            eventId: `nuke:${connection.gameId}:${Date.now()}:${data.unitId}`,
            x: centerX,
            y: centerY,
            playerId,
            affectedTiles: gameInstance.mapManager
              ?.getTopology?.()
              .getPositionsWithinRadius(centerX, centerY, 1) ?? [{ x: centerX, y: centerY }],
          });
        }
      }
      if (
        [
          ActionType.MARKETPLACE,
          ActionType.HELP_WONDER,
          ActionType.JOIN_CITY,
          ActionType.DISBAND_UNIT_RECOVER,
          ActionType.CHANGE_HOME_CITY,
          ActionType.UPGRADE_UNIT,
          ActionType.NUCLEAR_EXPLOSION,
          ActionType.COLLECT_RANSOM,
        ].includes(data.actionType)
      ) {
        this.gameManager.broadcastCityData(connection.gameId!);
        this.gameManager.syncGameStateToPlayer(connection.gameId!, playerId);
      }
      callback({ success: true, result });
      logger.info(`Unit action executed successfully`, {
        unitId: data.unitId,
        actionType: data.actionType,
        playerId,
      });
    } catch (error) {
      logger.error('Error executing unit action:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute unit action',
      });
    }
  }

  private captureTargetUnits(gameInstance: any, data: any, unitBeforeAction: any): any[] {
    if (data.actionType === ActionType.NUCLEAR_EXPLOSION) {
      return [...gameInstance.unitManager.getAllUnits().values()]
        .filter(unit => {
          const centerX = data.targetX ?? unitBeforeAction?.x;
          const centerY = data.targetY ?? unitBeforeAction?.y;
          return (
            centerX !== undefined &&
            centerY !== undefined &&
            (unit.x - centerX) ** 2 + (unit.y - centerY) ** 2 <= 1
          );
        })
        .map(unit => ({ ...unit }));
    }
    if (data.targetX === undefined || data.targetY === undefined) return [];
    return (gameInstance.unitManager.getUnitsAt?.(data.targetX, data.targetY) ?? []).map(
      (unit: any) => ({
        ...unit,
      })
    );
  }

  private broadcastUnitActionResult(
    gameId: string,
    unitId: string,
    unitDestroyed: boolean | undefined,
    targetUnitsBeforeAction: any[],
    gameInstance: NonNullable<ReturnType<GameManager['getGameInstance']>>
  ): void {
    if (!unitDestroyed) {
      const updatedUnit = gameInstance.unitManager.getUnit(unitId);
      if (updatedUnit) this.gameManager.broadcastUnitInfo(gameId, updatedUnit);
    }
    for (const targetBefore of targetUnitsBeforeAction) {
      if (targetBefore.id === unitId) continue;
      const targetAfter = gameInstance.unitManager.getUnit(targetBefore.id);
      if (targetAfter) this.gameManager.broadcastUnitInfo(gameId, targetAfter);
    }
  }

  private async executeRequestedUnitAction(
    gameInstance: NonNullable<ReturnType<GameManager['getGameInstance']>>,
    gameId: string,
    playerId: string,
    data: any
  ) {
    const diplomatActions = new Set([
      ActionType.ESTABLISH_EMBASSY,
      ActionType.INVESTIGATE_CITY,
      ActionType.STEAL_TECH,
      ActionType.SABOTAGE_CITY,
      ActionType.SABOTAGE_CITY_PRODUCTION,
      ActionType.BRIBE_UNIT,
      ActionType.INCITE_CITY,
      ActionType.POISON_WATER,
      ActionType.SABOTAGE_UNIT,
    ]);
    if (data.actionType === ActionType.GOTO && data.declareWarIfNeeded) {
      const city =
        data.targetX !== undefined && data.targetY !== undefined
          ? gameInstance.cityManager.getCityAt(data.targetX, data.targetY)
          : undefined;
      if (city && city.playerId !== playerId) {
        await this.gameManager.declareWar(gameId, playerId, city.playerId);
      }
    }

    const result = diplomatActions.has(data.actionType)
      ? await this.gameManager.executeDiplomatAction(
          gameId,
          playerId,
          data.unitId,
          data.actionType,
          data.targetX,
          data.targetY,
          data.technologyId,
          data.buildingId
        )
      : await gameInstance.unitManager.executeUnitAction(
          data.unitId,
          data.actionType,
          data.targetX,
          data.targetY,
          playerId
        );
    return result;
  }

  private resolvePlayerId(connection: any, gameInstance: any): string | undefined {
    if (!connection?.userId) return undefined;
    const playerIds: string[] = Array.from(gameInstance.players.keys()) as string[];
    for (const pid of playerIds) {
      const player = gameInstance.players.get(pid);
      if (player && player.userId === connection.userId) return pid;
    }
    return undefined;
  }

  /**
   * Handle path_request socket event
   */
  private async handlePathRequestEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      this.safeCallback(callback, { success: false, error: 'Not authenticated or not in a game' });
      return;
    }

    try {
      const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
      if (!gameInstance) {
        this.safeCallback(callback, { success: false, error: 'Game instance not found' });
        return;
      }

      const playerId = this.resolvePlayerId(connection, gameInstance);
      if (!playerId) {
        this.safeCallback(callback, { success: false, error: 'Player not found' });
        return;
      }

      const pathResult = await this.gameManager.requestPath(
        playerId,
        data.unitId,
        data.targetX,
        data.targetY
      );

      this.safeCallback(callback, pathResult);

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

      this.safeCallback(callback, errorResponse);
      socket.emit('path_response', errorResponse);
    }
  }

  private async handleMovementRangeEvent(
    socket: Socket,
    data: { unitId: string },
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (
      !this.isAuthenticated(connection) ||
      !this.isInGame(connection) ||
      this.isSpectator(connection)
    ) {
      this.safeCallback(callback, {
        success: false,
        unitId: data.unitId,
        error: 'Not authenticated or not an active player',
        tiles: [],
      });
      return;
    }

    try {
      const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
      const playerId = gameInstance ? this.resolvePlayerId(connection, gameInstance) : undefined;
      if (!playerId) {
        this.safeCallback(callback, {
          success: false,
          unitId: data.unitId,
          error: 'Player not found',
          tiles: [],
        });
        return;
      }

      const response = await this.gameManager.requestMovementRange(playerId, data.unitId);
      this.safeCallback(callback, response);
      socket.emit('movement_range_response', response);
    } catch (error) {
      this.safeCallback(callback, {
        success: false,
        unitId: data.unitId,
        error: error instanceof Error ? error.message : 'Failed to calculate movement range',
        tiles: [],
      });
    }
  }

  private safeCallback(callback: (response: any) => void, payload: any): void {
    if (typeof callback === 'function') {
      callback(payload);
    }
  }
}
