/**
 * GameBroadcastManager - Handles all Socket.IO broadcasting and real-time communication
 * Extracted from GameManager.ts following the established refactoring patterns
 * @reference docs/refactor/REFACTORING_ARCHITECTURE_PATTERNS.md Manager-Service-Repository Pattern
 */

import { BaseGameService } from './GameService';
import { logger } from '../../utils/logger';
import type { Server as SocketServer } from 'socket.io';
import { PacketType, PACKET_NAMES } from '../../types/packet';
import type { GameInstance } from '../GameManager';

export interface BroadcastService {
  broadcastToGame(gameId: string, event: string, data: any): void;
  broadcastPacketToGame(gameId: string, packetType: PacketType, data: any): void;
  broadcastMapData(gameId: string, mapData: any): void;
}

export class GameBroadcastManager extends BaseGameService implements BroadcastService {
  private io: SocketServer;
  private games = new Map<string, GameInstance>();

  constructor(io: SocketServer) {
    super(logger);
    this.io = io;
  }

  getServiceName(): string {
    return 'GameBroadcastManager';
  }

  /**
   * Set games reference for validation
   */
  setGamesReference(games: Map<string, GameInstance>): void {
    this.games = games;
  }

  /**
   * Broadcast event to all players in a specific game room
   * @reference Original GameManager.ts:1875-1881 broadcastToGame()
   */
  broadcastToGame(gameId: string, event: string, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      // Don't return early - still try to broadcast for compatibility
      this.logger.warn(
        'Broadcasting to game without local instance (might be normal during transitions)',
        {
          gameId,
          event,
          gamesCount: this.games.size,
          availableGameIds: Array.from(this.games.keys()),
        }
      );
    }

    // Always broadcast to all sockets in the specific game room (like original code)
    const room = this.io.to(`game:${gameId}`);
    if (!room || typeof room.emit !== 'function') {
      this.logger.error('Socket room is invalid', { gameId, room });
      return;
    }
    room.emit(event, data);

    this.logger.debug('Broadcasted event to game room', {
      gameId,
      event,
      playerCount: gameInstance?.players.size || 'unknown',
      dataSize: JSON.stringify(data).length,
    });
  }

  /**
   * Broadcast structured packet to game room
   * @reference Original GameManager.ts:1883-1903 broadcastPacketToGame()
   */
  broadcastPacketToGame(gameId: string, packetType: PacketType, data: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to broadcast packet to non-existent game', {
        gameId,
        packetType,
      });
      return;
    }

    // Create packet structure and broadcast to game room
    const packet = {
      type: packetType,
      data,
      timestamp: Date.now(),
    };

    this.io.to(`game:${gameId}`).emit('packet', packet);

    this.logger.debug('Broadcasted structured packet to game room', {
      gameId,
      packetType: PACKET_NAMES[packetType] || packetType,
      playerCount: gameInstance.players.size,
      data: Array.isArray(data?.tiles)
        ? { tilesCount: data.tiles.length, ...data, tiles: '[truncated]' }
        : data,
    });
  }

  /**
   * Broadcast map data to all players in game
   * @reference Original GameManager.ts:605-681 broadcastMapData()
   */
  broadcastMapData(gameId: string, mapData: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to broadcast map data to non-existent game', { gameId });
      return;
    }

    this.logger.info('Broadcasting map data to players', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      playerCount: gameInstance.players.size,
    });

    // Broadcast to each player individually to provide player-specific data
    for (const [playerId] of gameInstance.players) {
      try {
        // TODO: Implement fog of war - for now send all tiles
        // Get player-specific visibility data (disabled until fog of war is implemented)
        const visibleTilesSet = gameInstance.visibilityManager.getVisibleTiles(playerId);

        // Process and format all tiles (no fog of war for now)
        const visibleTiles = [];
        for (let y = 0; y < mapData.height; y++) {
          for (let x = 0; x < mapData.width; x++) {
            const index = x + y * mapData.width;
            // Handle column-based tile array structure: mapData.tiles[x][y]
            const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

            if (serverTile) {
              // Format tile in exact freeciv-web format
              const tileInfo = {
                tile: index, // This is the key - tile index used by freeciv-web
                x: x,
                y: y,
                terrain: serverTile.terrain,
                resource: serverTile.resource,
                elevation: serverTile.elevation || 0,
                riverMask: serverTile.riverMask || 0,
                known: 1, // TILE_KNOWN
                seen: 1,
                player: null,
                worked: null,
                extras: 0, // BitVector for extras
              };
              visibleTiles.push(tileInfo);
            }
          }
        }

        // Get units visible to this player (delegate to UnitManager)
        const visibleUnits = gameInstance.unitManager.getVisibleUnits(playerId, visibleTilesSet);
        const formattedUnits = visibleUnits.map((unit: any) =>
          this.formatUnitForClient(unit, gameInstance.unitManager)
        );

        // Send MAP_INFO packet first (like original code)
        const mapInfoPacket = {
          xsize: mapData.width,
          ysize: mapData.height,
          wrap_id: 0, // Flat earth
          topology_id: 0,
        };
        this.broadcastPacketToGame(gameId, PacketType.MAP_INFO, mapInfoPacket);

        // Send tiles in batches like original code
        const BATCH_SIZE = 100;
        for (let i = 0; i < visibleTiles.length; i += BATCH_SIZE) {
          const batch = visibleTiles.slice(i, i + BATCH_SIZE);
          this.broadcastPacketToGame(gameId, PacketType.TILE_INFO, {
            tiles: batch,
            startIndex: i,
            endIndex: Math.min(i + BATCH_SIZE, visibleTiles.length),
            total: visibleTiles.length,
          });
        }

        this.logger.debug('Sent player-specific map data', {
          gameId,
          playerId,
          tilesCount: visibleTiles.length,
          unitsCount: formattedUnits.length,
          batches: Math.ceil(visibleTiles.length / BATCH_SIZE),
        });
      } catch (error) {
        this.logger.error('Error sending map data to player:', {
          error: error instanceof Error ? error.message : error,
          gameId,
          playerId,
        });
      }
    }

    // Also broadcast general game started event
    this.broadcastToGame(gameId, 'game_ready', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      playerCount: gameInstance.players.size,
      currentTurn: gameInstance.currentTurn,
    });
  }

  /**
   * Broadcast to specific player
   */
  broadcastToPlayer(playerId: string, event: string, data: any): void {
    this.io.to(`player:${playerId}`).emit(event, data);

    this.logger.debug('Broadcasted event to specific player', {
      playerId,
      event,
      dataSize: JSON.stringify(data).length,
    });
  }

  /**
   * Broadcast to all connected sockets
   */
  broadcastGlobally(event: string, data: any): void {
    this.io.emit(event, data);

    this.logger.debug('Broadcasted event globally', {
      event,
      dataSize: JSON.stringify(data).length,
    });
  }

  /**
   * Get connected player count for a game
   * @reference Original GameManager.ts:1868-1874 getConnectedPlayerCount()
   */
  getConnectedPlayerCount(gameId: string): number {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return 0;

    return Array.from(gameInstance.players.values()).filter(player => player.isConnected).length;
  }

  /**
   * Format unit data for client transmission
   * @reference Original GameManager.ts:800-832 formatUnitForClient()
   */
  private formatUnitForClient(unit: any, unitManager: any): any {
    return {
      id: unit.id,
      playerId: unit.playerId,
      type: unit.type,
      x: unit.x,
      y: unit.y,
      movementLeft: unit.movementLeft,
      maxMovement: unitManager.getUnitMaxMovement(unit.type),
      health: unit.health || 100,
      veteran: unit.veteran || false,
      homeCity: unit.homeCity || null,
      activity: unit.activity || 'idle',
      fortified: unit.fortified || false,
      orders: unit.orders || null,
    };
  }
}
