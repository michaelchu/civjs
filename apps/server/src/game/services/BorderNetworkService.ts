/**
 * BorderNetworkService - Handles border system network communication
 * Manages client-server synchronization for border data
 * @reference docs/BORDER_SYSTEM_PORT_PLAN.md Phase 2.2
 */

import { logger } from '@utils/logger';
import type { Server as SocketServer, Socket } from 'socket.io';
import type { BorderManager } from '@game/managers/BorderManager';
import type {
  BorderUpdatePacket,
  BorderSourcePacket,
  BorderInfoRequestPacket,
  BorderInfoResponsePacket,
  BorderChangeNotificationPacket,
} from '../../types/shared/BorderPackets';
import type { BorderSource, BorderUpdate } from '../../types/shared/BorderTypes';

export class BorderNetworkService {
  private io: SocketServer;
  private borderManager: BorderManager;
  private socketHandlers: Map<string, { [key: string]: (...args: any[]) => void }> = new Map();

  constructor(io: SocketServer, borderManager: BorderManager) {
    this.io = io;
    this.borderManager = borderManager;
  }

  /**
   * Send full border state to a specific player/socket
   */
  sendFullBorderUpdate(socket: Socket, playerId?: string): void {
    const sources = this.borderManager.getAllBorderSources();
    const ownership = this.borderManager.getAllTileOwnership();

    // Filter by player if specified
    const filteredOwnership = playerId
      ? ownership.filter(tile => tile.playerId === playerId || tile.playerId === null)
      : ownership;

    const updatePacket: BorderUpdatePacket = {
      type: 'border_update',
      tiles: filteredOwnership.map(tile => ({
        x: tile.x,
        y: tile.y,
        owner: tile.playerId,
        strength: tile.strength,
      })),
      updateType: 'full_update',
      affectedPlayers: playerId ? [playerId] : undefined,
    };

    const sourcePacket: BorderSourcePacket = {
      type: 'border_source_update',
      sources: sources,
      removed: [],
    };

    socket.emit('border_update', updatePacket);
    socket.emit('border_source_update', sourcePacket);

    logger.debug('Sent full border update to client', {
      playerId,
      tilesCount: updatePacket.tiles.length,
      sourcesCount: sources.length,
    });
  }

  /**
   * Send incremental border update to all players in a game
   */
  broadcastBorderUpdate(gameId: string, borderUpdate: BorderUpdate): void {
    const updatePacket: BorderUpdatePacket = {
      type: 'border_update',
      tiles: borderUpdate.tiles.map(tile => ({
        x: tile.x,
        y: tile.y,
        owner: tile.playerId,
        strength: tile.strength,
      })),
      updateType: 'incremental',
      affectedPlayers: borderUpdate.affectedPlayers,
    };

    if (borderUpdate.sources.length > 0 || borderUpdate.removedSources.length > 0) {
      const sourcePacket: BorderSourcePacket = {
        type: 'border_source_update',
        sources: borderUpdate.sources,
        removed: borderUpdate.removedSources,
      };

      this.io.to(gameId).emit('border_source_update', sourcePacket);
    }

    this.io.to(gameId).emit('border_update', updatePacket);

    logger.debug('Broadcasted border update to game', {
      gameId,
      tilesUpdated: updatePacket.tiles.length,
      sourcesChanged: borderUpdate.sources.length + borderUpdate.removedSources.length,
      affectedPlayers: borderUpdate.affectedPlayers,
    });
  }

  /**
   * Send border change notification to a specific player
   */
  notifyBorderChange(
    gameId: string,
    playerId: string,
    tilesGained: Array<{ x: number; y: number }>,
    tilesLost: Array<{ x: number; y: number }>,
    sourceAdded?: BorderSource,
    sourceRemoved?: { x: number; y: number }
  ): void {
    const notification: BorderChangeNotificationPacket = {
      type: 'border_change_notification',
      playerId,
      tilesGained,
      tilesLost,
      sourceAdded,
      sourceRemoved,
    };

    this.io.to(gameId).emit('border_change_notification', notification);

    logger.info('Sent border change notification', {
      gameId,
      playerId,
      tilesGained: tilesGained.length,
      tilesLost: tilesLost.length,
      sourceAdded: !!sourceAdded,
      sourceRemoved: !!sourceRemoved,
    });
  }

  /**
   * Handle border information request from client
   */
  handleBorderInfoRequest(socket: Socket, request: BorderInfoRequestPacket, gameId: string): void {
    try {
      const sources = this.borderManager.getAllBorderSources();
      let ownership = this.borderManager.getAllTileOwnership();

      // Filter by region if specified
      if (request.region) {
        const { minX, minY, maxX, maxY } = request.region;
        ownership = ownership.filter(
          tile => tile.x >= minX && tile.x <= maxX && tile.y >= minY && tile.y <= maxY
        );
      }

      // Filter by player if specified
      if (request.playerId) {
        ownership = ownership.filter(
          tile => tile.playerId === request.playerId || tile.playerId === null
        );
      }

      const response: BorderInfoResponsePacket = {
        type: 'border_info_response',
        sources: sources,
        ownership: ownership,
      };

      socket.emit('border_info_response', response);

      logger.debug('Handled border info request', {
        gameId,
        region: request.region,
        playerId: request.playerId,
        tilesReturned: ownership.length,
        sourcesReturned: sources.length,
      });
    } catch (error) {
      logger.error('Error handling border info request', { error, gameId, request });
      socket.emit('error', { message: 'Failed to retrieve border information' });
    }
  }

  /**
   * Register socket event handlers for border system
   */
  registerHandlers(socket: Socket, gameId: string): void {
    const handlers = {
      border_info_request: (request: BorderInfoRequestPacket) => {
        this.handleBorderInfoRequest(socket, request, gameId);
      },
      request_full_border_update: (playerId?: string) => {
        this.sendFullBorderUpdate(socket, playerId);
      },
    };

    // Register handlers
    socket.on('border_info_request', handlers.border_info_request);
    socket.on('request_full_border_update', handlers.request_full_border_update);

    // Store handlers for cleanup
    this.socketHandlers.set(socket.id, handlers);

    logger.debug('Registered border network handlers', { gameId, socketId: socket.id });
  }

  /**
   * Clean up handlers when socket disconnects
   */
  unregisterHandlers(socket: Socket): void {
    const handlers = this.socketHandlers.get(socket.id);
    if (handlers) {
      socket.off('border_info_request', handlers.border_info_request);
      socket.off('request_full_border_update', handlers.request_full_border_update);
      this.socketHandlers.delete(socket.id);
    }

    logger.debug('Unregistered border network handlers', { socketId: socket.id });
  }
}
