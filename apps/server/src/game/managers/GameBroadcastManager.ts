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
      this.logger.warn('Attempted to broadcast to non-existent game', { gameId, event });
      return;
    }

    // Broadcast to all sockets in the specific game room
    this.io.to(`game:${gameId}`).emit(event, data);

    this.logger.debug('Broadcasted event to game room', {
      gameId,
      event,
      playerCount: gameInstance.players.size,
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
    for (const [playerId, playerState] of gameInstance.players) {
      try {
        // Get player-specific visibility data
        const visibleTilesSet = gameInstance.visibilityManager.getVisibleTiles(playerId);
        // Filter tiles based on visibility (simplified approach)
        const visibleTiles = mapData.tiles.filter((_: any, index: number) => {
          const x = index % mapData.width;
          const y = Math.floor(index / mapData.width);
          return visibleTilesSet.has(`${x},${y}`);
        });

        // Get units visible to this player (delegate to UnitManager)
        const visibleUnits = gameInstance.unitManager.getVisibleUnits(playerId, visibleTilesSet);
        const formattedUnits = visibleUnits.map((unit: any) =>
          this.formatUnitForClient(unit, gameInstance.unitManager)
        );

        // Get cities visible to this player
        const playerCities = gameInstance.cityManager.getPlayerCities(playerId);
        const visibleCities = playerCities.map(city => ({
          id: city.id,
          playerId: city.playerId,
          name: city.name,
          x: city.x,
          y: city.y,
          population: city.population,
          size: city.population,
          production: city.currentProduction,
          buildings: city.buildings || [],
        }));

        // Prepare player-specific map data
        const playerMapData = {
          gameId,
          playerId,
          mapData: {
            width: mapData.width,
            height: mapData.height,
            tiles: visibleTiles,
            startingPositions: mapData.startingPositions,
          },
          units: formattedUnits,
          cities: visibleCities,
          playerData: {
            playerId,
            playerNumber: playerState.playerNumber,
            civilization: playerState.civilization,
          },
          currentTurn: gameInstance.currentTurn,
        };

        // Send to specific player via Socket.IO room
        this.io.to(`player:${playerId}`).emit('map_data', playerMapData);

        this.logger.debug('Sent player-specific map data', {
          gameId,
          playerId,
          visibleTilesCount: visibleTiles.length,
          unitsCount: formattedUnits.length,
          citiesCount: visibleCities.length,
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
