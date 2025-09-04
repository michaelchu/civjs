import { Server, Socket } from 'socket.io';
import { logger } from '../../utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType, TileVisibilityReqSchema } from '../../types/packet';
import { GameManager } from '../../game/GameManager';
import { db } from '../../database';
import { games } from '../../database/schema';
import { eq } from 'drizzle-orm';

/**
 * Handles map and visibility-related packets
 */
export class MapVisibilityHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.MAP_INFO,
    PacketType.TILE_INFO,
    PacketType.MAP_VIEW_REQ,
    PacketType.MAP_VIEW_REPLY,
    PacketType.TILE_VISIBILITY_REQ,
    PacketType.TILE_VISIBILITY_REPLY,
  ];

  protected handlerName = 'MapVisibilityHandler';

  constructor(private activeConnections: Map<string, any>, private gameManager: GameManager) {
    super();
  }

  register(handler: PacketHandler, _io: Server, socket: Socket): void {
    handler.register(PacketType.MAP_VIEW_REQ, async (socket, _data) => {
      await this.handleMapViewRequest(handler, socket, _data);
    });

    handler.register(
      PacketType.TILE_VISIBILITY_REQ,
      async (socket, _data) => {
        await this.handleTileVisibilityRequest(handler, socket, _data);
      },
      TileVisibilityReqSchema
    );

    // Register socket event handlers
    this.registerSocketEvents(socket, _io);

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private registerSocketEvents(socket: Socket, _io: Server): void {
    socket.on('get_map_data', async (_data, callback) => {
      await this.handleGetMapData(socket, callback);
    });

    socket.on('get_visible_tiles', async (_data, callback) => {
      await this.handleGetVisibleTiles(socket, callback);
    });
  }

  private async handleMapViewRequest(
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

      // Update visibility first
      this.gameManager.updatePlayerVisibility(connection.gameId!, player.id);

      // Get player's map view
      const mapData = this.gameManager.getPlayerMapView(connection.gameId!, player.id);

      handler.send(socket, PacketType.MAP_VIEW_REPLY, {
        mapData,
      });

      logger.debug('Sent map view to player', {
        gameId: connection.gameId,
        playerId: player.id,
      });
    } catch (error) {
      logger.error('Error processing map view request:', error);
    }
  }

  private async handleTileVisibilityRequest(
    handler: PacketHandler,
    socket: Socket,
    data: any
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
        x: data.x,
        y: data.y,
        isVisible: false,
        isExplored: false,
      });
      return;
    }

    try {
      const game = await this.gameManager.getGame(connection.gameId!);
      if (!game) return;

      const player = Array.from(game.players.values()).find(
        (p: any) => p.userId === connection.userId
      ) as any;
      if (!player) return;

      const visibility = this.gameManager.getTileVisibility(
        connection.gameId!,
        player.id,
        data.x,
        data.y
      );

      handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
        x: data.x,
        y: data.y,
        isVisible: visibility.isVisible,
        isExplored: visibility.isExplored,
        lastSeen: visibility.lastSeen,
      });

      logger.debug('Sent tile visibility info', {
        gameId: connection.gameId,
        playerId: player.id,
        tile: { x: data.x, y: data.y },
        visibility,
      });
    } catch (error) {
      logger.error('Error processing tile visibility request:', error);
      handler.send(socket, PacketType.TILE_VISIBILITY_REPLY, {
        x: data.x,
        y: data.y,
        isVisible: false,
        isExplored: false,
      });
    }
  }

  private async handleGetMapData(socket: Socket, callback: (response: any) => void): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isInGame(connection)) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const mapData = this.gameManager.getMapData(connection.gameId!);
      callback({ success: true, mapData });
    } catch (error) {
      logger.error('Error getting map data:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get map data',
      });
    }
  }

  private async handleGetVisibleTiles(
    socket: Socket,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isInGame(connection)) {
      callback({ success: false, error: 'Not in a game' });
      return;
    }

    try {
      const game = await db.query.games.findFirst({
        where: eq(games.id, connection.gameId!),
        with: {
          players: true,
        },
      });

      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      const player = game.players.find(p => p.userId === connection.userId);
      if (!player) {
        callback({ success: false, error: 'Player not found in game' });
        return;
      }

      const visibleTiles = this.gameManager.getPlayerVisibleTiles(connection.gameId!, player.id);
      callback({ success: true, visibleTiles });
    } catch (error) {
      logger.error('Error getting visible tiles:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get visible tiles',
      });
    }
  }
}
