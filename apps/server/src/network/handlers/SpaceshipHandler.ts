/**
 * @module server/network/handlers/SpaceshipHandler
 * Handles authoritative spaceship placement and launch requests.
 */
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  PacketType,
  SpaceshipLaunchSchema,
  SpaceshipPlaceSchema,
  type SpaceshipPlacement,
} from '@app-types/packet';
import { GameManager, type GameInstance, type PlayerState } from '@game/managers/GameManager';

interface SpaceshipContext {
  game: GameInstance;
  player: PlayerState;
}

/**
 * Native Freeciv accepts these requests only from the controlling player;
 * transition validation belongs to the authoritative GameManager.
 *
 * @reference reference/freeciv/server/spacerace.c:167-201
 * @reference reference/freeciv/server/spacerace.c:204-415
 */
export class SpaceshipHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.SPACESHIP_PLACE,
    PacketType.SPACESHIP_PLACE_REPLY,
    PacketType.SPACESHIP_LAUNCH,
    PacketType.SPACESHIP_LAUNCH_REPLY,
  ];

  protected handlerName = 'SpaceshipHandler';

  constructor(
    private readonly activeConnections: Map<string, any>,
    private readonly gameManager: GameManager
  ) {
    super();
  }

  register(handler: PacketHandler, _io: Server, socket: Socket): void {
    handler.register(
      PacketType.SPACESHIP_PLACE,
      async (targetSocket, data) => {
        await this.handlePlace(handler, targetSocket, data);
      },
      SpaceshipPlaceSchema
    );
    handler.register(
      PacketType.SPACESHIP_LAUNCH,
      async (targetSocket, data) => {
        await this.handleLaunch(handler, targetSocket, data);
      },
      SpaceshipLaunchSchema
    );
    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private async handlePlace(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
    const context = await this.resolveContext(socket);
    if (!context) {
      this.sendPlaceReply(handler, socket, false, undefined, 'Game is not active');
      return;
    }
    try {
      const result = await this.gameManager.placeSpaceshipPart(
        this.getConnection(socket, this.activeConnections).gameId,
        context.player.id,
        data.placement as SpaceshipPlacement
      );
      this.sendPlaceReply(handler, socket, result.success, result.state, result.reason);
    } catch (error) {
      logger.error('Failed to place spaceship part', error);
      this.sendPlaceReply(
        handler,
        socket,
        false,
        undefined,
        error instanceof Error ? error.message : 'Failed to place spaceship part'
      );
    }
  }

  private async handleLaunch(handler: PacketHandler, socket: Socket, _data: any): Promise<void> {
    const context = await this.resolveContext(socket);
    if (!context) {
      this.sendLaunchReply(handler, socket, false, undefined, 'Game is not active');
      return;
    }
    try {
      const result = await this.gameManager.launchSpaceship(
        this.getConnection(socket, this.activeConnections).gameId,
        context.player.id
      );
      this.sendLaunchReply(handler, socket, result.success, result.state, result.reason);
    } catch (error) {
      logger.error('Failed to launch spaceship', error);
      this.sendLaunchReply(
        handler,
        socket,
        false,
        undefined,
        error instanceof Error ? error.message : 'Failed to launch spaceship'
      );
    }
  }

  private async resolveContext(socket: Socket): Promise<SpaceshipContext | undefined> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (
      !this.isAuthenticated(connection) ||
      !this.isInGame(connection) ||
      this.isSpectator(connection)
    ) {
      return undefined;
    }
    let game = this.gameManager.getGameInstance(connection.gameId);
    if (!game) game = await this.gameManager.recoverGameInstance(connection.gameId);
    if (!game || game.state !== 'active') return undefined;
    const player = Array.from(game.players.values()).find(
      candidate => candidate.userId === connection.userId
    );
    return player ? { game, player } : undefined;
  }

  private sendPlaceReply(
    handler: PacketHandler,
    socket: Socket,
    success: boolean,
    spaceshipState?: unknown,
    message?: string
  ): void {
    handler.send(socket, PacketType.SPACESHIP_PLACE_REPLY, {
      success,
      ...(spaceshipState === undefined ? {} : { spaceshipState }),
      ...(message ? { message } : {}),
    });
  }

  private sendLaunchReply(
    handler: PacketHandler,
    socket: Socket,
    success: boolean,
    spaceshipState?: unknown,
    message?: string
  ): void {
    handler.send(socket, PacketType.SPACESHIP_LAUNCH_REPLY, {
      success,
      ...(spaceshipState === undefined ? {} : { spaceshipState }),
      ...(message ? { message } : {}),
    });
  }
}
