/**
 * GameBroadcastManager - Handles all Socket.IO broadcasting and real-time communication
 * Extracted from GameManager.ts following the established refactoring patterns
 */

import { BaseGameService } from './GameService';
import { CityDataService } from '@game/services/CityDataService';
import { logger } from '@utils/logger';
import type { Server as SocketServer } from 'socket.io';
import { PacketType, PACKET_NAMES, PROTOCOL_VERSION } from '@app-types/packet';
import type { GameInstance } from '@game/managers/GameManager';
import { rulesetActionsService } from '@game/services/RulesetActionsService';
import { resolveCityPresentations } from '@game/services/CityPresentationService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';

const LOBBY_EVENTS = new Set(['player-joined', 'player-connection-changed']);

export interface BroadcastService {
  broadcastToGame(gameId: string, event: string, data: any): void;
  broadcastPacketToGame(gameId: string, packetType: PacketType, data: any): void;
  broadcastMapData(gameId: string, mapData: any): void;
  broadcastUnitInfo(gameId: string, unit: any): void;
  broadcastVisibilityState(gameId: string): void;
  broadcastCityData(gameId: string): void;
  broadcastCityDataToPlayer(gameId: string, playerId: string): void;
  syncGameStateToPlayer(gameId: string, playerId: string): void;
  setDebugVisibility(gameId: string, playerId: string, enabled: boolean): boolean;
}

export class GameBroadcastManager extends BaseGameService implements BroadcastService {
  private io: SocketServer;
  private games = new Map<string, GameInstance>();
  private debugVisibilityPlayers = new Set<string>();

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
    if (!gameInstance && !LOBBY_EVENTS.has(event)) {
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

    const metrics = this.computeMapDataMetrics(mapData);

    this.logger.info('Broadcasting map data to players', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      playerCount: gameInstance.players.size,
      ...metrics,
    });

    this.broadcastMapDataToPlayers(gameInstance, gameId, mapData);

    this.broadcastToGame(gameId, 'game_ready', {
      gameId,
      mapSize: `${mapData.width}x${mapData.height}`,
      playerCount: gameInstance.players.size,
      currentTurn: gameInstance.currentTurn,
    });
  }

  /**
   * Send a unit update to its owner and players that can currently see it.
   * @reference reference/freeciv/server/maphand.c:442-613
   */
  broadcastUnitInfo(gameId: string, unit: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to broadcast unit for non-existent game', {
        gameId,
        unitId: unit.id,
      });
      return;
    }

    this.broadcastVisibilityState(gameId);
  }

  /**
   * Refresh each player's Freeciv playermap after a vision source changes.
   * Full visible-unit snapshots also remove enemy units that just left sight.
   */
  broadcastVisibilityState(gameId: string): void {
    const gameInstance = this.games.get(gameId);
    const mapData = gameInstance?.mapManager.getMapData();
    if (!gameInstance || !mapData) return;

    for (const [playerId] of gameInstance.players) {
      this.sendVisibilitySnapshotToPlayer(gameInstance, gameId, playerId, mapData);
    }
  }

  setDebugVisibility(gameId: string, playerId: string, enabled: boolean): boolean {
    const gameInstance = this.games.get(gameId);
    const mapData = gameInstance?.mapManager.getMapData();
    if (!gameInstance || !mapData || !gameInstance.players.has(playerId)) return false;

    const key = this.debugVisibilityKey(gameId, playerId);
    if (enabled) {
      this.debugVisibilityPlayers.add(key);
    } else {
      this.debugVisibilityPlayers.delete(key);
    }

    this.sendVisibilitySnapshotToPlayer(gameInstance, gameId, playerId, mapData);
    return true;
  }

  /**
   * Remove a unit only for its owner and players who could see its last tile.
   * The last-known unit snapshot is required because the authoritative unit
   * has already been removed from UnitManager.
   * @reference reference/freeciv/server/maphand.c:615-683
   */
  broadcastUnitDestroyed(gameId: string, unit: any): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    for (const [playerId] of gameInstance.players) {
      // Use the pre-destruction visibility snapshot. Recomputing after the
      // unit has been removed can hide its last tile and leave a client ghost.
      const visibleTiles = gameInstance.visibilityManager.getVisibleTiles(playerId);
      if (
        !this.isDebugVisibilityEnabled(gameId, playerId) &&
        unit.playerId !== playerId &&
        !visibleTiles.has(`${unit.x},${unit.y}`)
      ) {
        continue;
      }

      const recipientId = gameInstance.players.get(playerId)?.userId || playerId;
      this.io.to(`player:${recipientId}`).emit('unit_destroyed', {
        gameId,
        unitId: unit.id,
      });
    }
    this.broadcastVisibilityState(gameId);
  }

  private computeMapDataMetrics(mapData: any): {
    tilesComplete: boolean;
    firstTileComplete: boolean;
    sampleTileTerrain: string;
    sampleTileElevation: string | number;
  } {
    const tilesComplete = !!(mapData && mapData.tiles && mapData.tiles.length > 0);
    const firstTileComplete = !!(tilesComplete && mapData.tiles[0] && mapData.tiles[0].length > 0);
    const sampleTile = firstTileComplete ? mapData.tiles[0][0] : null;
    return {
      tilesComplete,
      firstTileComplete,
      sampleTileTerrain: sampleTile?.terrain || 'undefined',
      sampleTileElevation: (sampleTile?.elevation as any) || 'undefined',
    };
  }

  private broadcastMapDataToPlayers(
    gameInstance: GameInstance,
    gameId: string,
    mapData: any
  ): void {
    for (const [playerId] of gameInstance.players) {
      this.sendMapDataToPlayer(gameInstance, gameId, playerId, mapData);
    }
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
   * Send map data to a specific player
   */
  private sendMapDataToPlayer(
    gameInstance: any,
    gameId: string,
    playerId: string,
    mapData: any
  ): void {
    try {
      this.sendPlayerInfoSnapshot(gameInstance, playerId);

      // @reference reference/freeciv/server/maphand.c:442-613
      // Map knowledge is player-specific: explored tiles retain terrain, while
      // resources and units are sent only while currently visible.
      gameInstance.visibilityManager.updatePlayerVisibility(playerId);
      const debugVisibility = this.isDebugVisibilityEnabled(gameId, playerId);
      const allTilesSet = debugVisibility ? this.getAllTileKeys(mapData) : undefined;
      const visibleTilesSet =
        allTilesSet ?? gameInstance.visibilityManager.getVisibleTiles(playerId);
      const exploredTilesSet =
        allTilesSet ?? gameInstance.visibilityManager.getExploredTiles(playerId);
      const rememberedTiles = this.getRememberedTiles(
        gameInstance,
        playerId,
        mapData,
        exploredTilesSet
      );
      const visibleTiles = this.processMapTilesForPlayer(
        mapData,
        visibleTilesSet,
        exploredTilesSet,
        rememberedTiles
      );

      // Get units visible to this player (delegate to UnitManager)
      const visibleUnits = debugVisibility
        ? Array.from(gameInstance.unitManager.getAllUnits().values())
        : gameInstance.unitManager.getVisibleUnits(
            playerId,
            visibleTilesSet,
            gameInstance.visibilityManager.getDetectionTiles?.(playerId)
          );
      const formattedUnits = visibleUnits.map((unit: any) =>
        this.formatUnitForClient(unit, gameInstance.unitManager)
      );

      // Send MAP_INFO packet first (like original code)
      const mapInfoPacket = {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: mapData.wrapId ?? 0,
        topology_id: mapData.topologyId ?? 0,
      };
      this.sendPacketToPlayer(gameInstance, playerId, PacketType.MAP_INFO, mapInfoPacket);

      // Send tiles in batches like original code
      this.sendTileDataInBatches(gameInstance, playerId, visibleTiles);

      this.sendPacketToPlayer(gameInstance, playerId, PacketType.UNIT_INFO, {
        units: formattedUnits,
        fullSnapshot: true,
      });

      this.logger.debug('Sent player-specific map data', {
        gameId,
        playerId,
        tilesCount: visibleTiles.length,
        unitsCount: formattedUnits.length,
        batches: Math.ceil(visibleTiles.length / 100),
      });
    } catch (error) {
      this.logger.error('Error sending map data to player:', {
        error: error instanceof Error ? error.message : error,
        gameId,
        playerId,
      });
    }
  }

  private sendPlayerInfoSnapshot(gameInstance: GameInstance, recipientPlayerId: string): void {
    for (const player of gameInstance.players.values()) {
      if (!player.color) continue;
      const research = gameInstance.researchManager?.getPlayerResearch(player.id);
      this.sendPacketToPlayer(gameInstance, recipientPlayerId, PacketType.PLAYER_INFO, {
        id: player.id,
        name: player.leaderName ?? player.civilization,
        nation: player.nation ?? player.civilization,
        score: 0,
        gold: player.gold ?? 0,
        goldPerTurn: player.goldPerTurn ?? 0,
        science: research?.bulbsAccumulated ?? player.science ?? 0,
        sciencePerTurn: research?.bulbsLastTurn ?? player.sciencePerTurn ?? 0,
        culture: player.history ?? 0,
        government: player.government ?? 'despotism',
        alive: player.isAlive ?? true,
        isAI: player.isAI ?? false,
        color: player.color,
      });
    }
  }

  /** Send the recipient's authoritative research state after turn processing. */
  private sendResearchSnapshot(gameInstance: GameInstance, playerId: string): void {
    const research = gameInstance.researchManager.getPlayerResearch(playerId);
    const progress = gameInstance.researchManager.getResearchProgress(playerId);
    const availableTechs = gameInstance.researchManager.getAvailableTechnologies(playerId);

    this.sendPacketToPlayer(gameInstance, playerId, PacketType.RESEARCH_LIST_REPLY, {
      technologies: gameInstance.researchManager.getTechnologyCatalogue(playerId).map(tech => ({
        id: tech.id,
        name: tech.name,
        cost: tech.cost,
        requirements: tech.requirements,
        flags: tech.flags,
        description: tech.description,
      })),
      availableTechs: availableTechs.map(tech => ({
        id: tech.id,
        name: tech.name,
        cost: tech.cost,
        requirements: tech.requirements,
        flags: tech.flags,
        description: tech.description,
      })),
      researchedTechs: research ? Array.from(research.researchedTechs) : [],
      futureTechs: research?.futureTechs ?? 0,
    });
    this.sendPacketToPlayer(gameInstance, playerId, PacketType.RESEARCH_PROGRESS_REPLY, {
      currentTech: research?.currentTech,
      techGoal: research?.techGoal,
      current: progress?.current ?? 0,
      required: progress?.required ?? 0,
      turnsRemaining: progress?.turnsRemaining ?? -1,
      bulbsLastTurn: research?.bulbsLastTurn ?? 0,
    });
  }

  /**
   * Refresh and broadcast authoritative resources after turn processing.
   */
  async broadcastPlayerInfo(gameId: string): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) return;

    const economicManager = gameInstance.turnManager.getEconomicManager();
    for (const player of gameInstance.players.values()) {
      if (economicManager) {
        player.gold = await economicManager.getPlayerGold(player.id);
        player.goldPerTurn =
          economicManager.getLastTurnSummary(player.id)?.totals.netGoldChange ?? 0;
      }
      const research = gameInstance.researchManager.getPlayerResearch(player.id);
      player.science = research?.bulbsAccumulated ?? player.science ?? 0;
      player.sciencePerTurn = research?.bulbsLastTurn ?? 0;
    }

    for (const recipient of gameInstance.players.values()) {
      if (!recipient.isConnected) continue;
      this.sendPlayerInfoSnapshot(gameInstance, recipient.id);
      this.sendResearchSnapshot(gameInstance, recipient.id);
    }
  }

  private sendVisibilitySnapshotToPlayer(
    gameInstance: GameInstance,
    gameId: string,
    playerId: string,
    mapData: any
  ): void {
    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
    const debugVisibility = this.isDebugVisibilityEnabled(gameId, playerId);
    const allTilesSet = debugVisibility ? this.getAllTileKeys(mapData) : undefined;
    const visibleTiles = allTilesSet ?? gameInstance.visibilityManager.getVisibleTiles(playerId);
    const exploredTiles = allTilesSet ?? gameInstance.visibilityManager.getExploredTiles(playerId);
    const rememberedTiles = this.getRememberedTiles(gameInstance, playerId, mapData, exploredTiles);
    const tiles = this.processMapTilesForPlayer(
      mapData,
      visibleTiles,
      exploredTiles,
      rememberedTiles
    );
    this.sendTileDataInBatches(gameInstance, playerId, tiles);

    const visibleUnits = debugVisibility
      ? Array.from(gameInstance.unitManager.getAllUnits().values())
      : gameInstance.unitManager.getVisibleUnits(
          playerId,
          visibleTiles,
          gameInstance.visibilityManager.getDetectionTiles?.(playerId)
        );
    const units = visibleUnits.map((unit: any) =>
      this.formatUnitForClient(unit, gameInstance.unitManager)
    );
    this.sendPacketToPlayer(gameInstance, playerId, PacketType.UNIT_INFO, {
      units,
      fullSnapshot: true,
    });

    this.broadcastCityDataToPlayer(gameId, playerId);

    const currentBorderTiles = gameInstance.borderManager
      .getAllTileOwnership()
      .filter(
        (ownership: any) =>
          debugVisibility ||
          ownership.playerId === playerId ||
          visibleTiles.has(`${ownership.x},${ownership.y}`)
      )
      .map((ownership: any) => ({
        x: ownership.x,
        y: ownership.y,
        owner: ownership.playerId,
        strength: ownership.strength,
      }));
    const borderTiles = debugVisibility
      ? currentBorderTiles
      : [
          ...currentBorderTiles,
          ...[...rememberedTiles.values()]
            .filter(
              (tile: any) =>
                tile.owner &&
                !visibleTiles.has(`${tile.x},${tile.y}`) &&
                !currentBorderTiles.some(
                  (current: any) => current.x === tile.x && current.y === tile.y
                )
            )
            .map((tile: any) => ({
              x: tile.x,
              y: tile.y,
              owner: tile.owner,
              strength: 0,
            })),
        ];
    this.sendPacketToPlayer(gameInstance, playerId, PacketType.BORDER_UPDATE, {
      type: 'border_update',
      updateType: 'full_update',
      tiles: borderTiles,
    });
  }

  private getAllTileKeys(mapData: any): Set<string> {
    const keys = new Set<string>();
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        keys.add(`${x},${y}`);
      }
    }
    return keys;
  }

  private getRememberedTiles(
    gameInstance: GameInstance,
    playerId: string,
    mapData: any,
    exploredTiles: Set<string>
  ): Map<string, any> {
    const remembered = gameInstance.visibilityManager.getRememberedTiles?.(playerId);
    if (remembered) return remembered;

    // Compatibility for legacy/test visibility providers. Runtime
    // VisibilityManager always supplies immutable observation memory.
    const fallback = new Map<string, any>();
    for (const key of exploredTiles) {
      const [x, y] = key.split(',').map(Number);
      const tile = mapData.tiles[x]?.[y];
      if (tile) fallback.set(key, tile);
    }
    return fallback;
  }

  private debugVisibilityKey(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}`;
  }

  private isDebugVisibilityEnabled(gameId: string, playerId: string): boolean {
    return this.debugVisibilityPlayers.has(this.debugVisibilityKey(gameId, playerId));
  }

  /**
   * Process map tiles for player visibility
   */
  private processMapTilesForPlayer(
    mapData: any,
    currentlyVisibleTiles: Set<string>,
    exploredTiles: Set<string>,
    rememberedTiles: Map<string, any>
  ): any[] {
    const clientTiles = [];
    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const tileKey = `${x},${y}`;
        const tileInfo = this.createTileInfo(
          mapData,
          x,
          y,
          currentlyVisibleTiles.has(tileKey),
          exploredTiles.has(tileKey),
          rememberedTiles.get(tileKey)
        );
        if (tileInfo) {
          clientTiles.push(tileInfo);
        }
      }
    }
    return clientTiles;
  }

  /**
   * Create tile information object for a specific coordinate
   */
  private createTileInfo(
    mapData: any,
    x: number,
    y: number,
    isVisible: boolean,
    isExplored: boolean,
    rememberedTile?: any
  ): any | null {
    const index = x + y * mapData.width;
    // Handle column-based tile array structure: mapData.tiles[x][y]
    const serverTile = mapData.tiles[x] && mapData.tiles[x][y];

    if (!serverTile) {
      return null;
    }
    const knownTile = isVisible ? serverTile : rememberedTile;

    // Format tile in exact freeciv-web format
    return {
      tile: index, // This is the key - tile index used by freeciv-web
      x: x,
      y: y,
      terrain: isExplored ? (knownTile?.terrain ?? 'unknown') : 'unknown',
      resource: isExplored ? knownTile?.resource : undefined,
      elevation: isExplored ? knownTile?.elevation || 0 : 0,
      riverMask: isExplored ? knownTile?.riverMask || 0 : 0,
      hasRoad: isExplored ? knownTile?.hasRoad : false,
      hasRailroad: isExplored ? knownTile?.hasRailroad : false,
      improvements: isExplored ? (knownTile?.improvements ?? []) : [],
      cityId: isExplored ? knownTile?.cityId : undefined,
      owner: isExplored ? knownTile?.owner : undefined,
      claimer: isExplored ? knownTile?.claimer : undefined,
      known: isVisible ? 2 : isExplored ? 1 : 0,
      seen: isVisible ? 1 : 0,
      player: isExplored ? (knownTile?.owner ?? null) : null,
      worked: null,
      extras: 0, // BitVector for extras
    };
  }

  /**
   * Send tile data in batches
   */
  private sendTileDataInBatches(
    gameInstance: GameInstance,
    playerId: string,
    visibleTiles: any[]
  ): void {
    const BATCH_SIZE = 100;
    for (let i = 0; i < visibleTiles.length; i += BATCH_SIZE) {
      const batch = visibleTiles.slice(i, i + BATCH_SIZE);

      // DEBUG: Check first tile in batch for completeness
      if (i === 0 && batch.length > 0) {
        this.logger.info('First TILE_INFO batch sample:', {
          firstTile: {
            tile: batch[0].tile,
            x: batch[0].x,
            y: batch[0].y,
            terrain: batch[0].terrain,
            elevation: batch[0].elevation,
            known: batch[0].known,
            seen: batch[0].seen,
          },
        });
      }

      this.sendPacketToPlayer(gameInstance, playerId, PacketType.TILE_INFO, {
        tiles: batch,
        startIndex: i,
        endIndex: Math.min(i + BATCH_SIZE, visibleTiles.length),
        total: visibleTiles.length,
      });
    }
  }

  /** Send a structured packet to the authenticated user's private room. */
  private sendPacketToPlayer(
    gameInstance: GameInstance,
    playerId: string,
    packetType: PacketType,
    data: any
  ): void {
    const player = gameInstance.players.get(playerId);
    const recipientId = player?.userId || playerId;
    this.io.to(`player:${recipientId}`).emit('packet', {
      version: PROTOCOL_VERSION,
      type: packetType,
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Format unit data for client transmission
   * @reference Original GameManager.ts:800-832 formatUnitForClient()
   */
  private formatUnitForClient(unit: any, unitManager: any): any {
    const unitType =
      unitManager.getUnitType?.(unit.unitTypeId || unit.type) ??
      rulesetUnitsService.getUnitType(unit.unitTypeId || unit.type, 'classic');
    return {
      id: unit.id,
      owner: unit.playerId,
      type: unit.unitTypeId || unit.type,
      x: unit.x,
      y: unit.y,
      movesleft: unit.movementLeft,
      maxmoves: unitManager.getUnitMaxMovement(unit.unitTypeId || unit.type) * 3,
      fuel: unit.fuel ?? 0,
      maxFuel: unitType?.fuel ?? 0,
      hp: unit.health ?? 100,
      veteran: unit.veteranLevel ?? unit.veteran ?? false,
      homeCity: unit.homeCity || null,
      activity: unit.activity || 'idle',
      fortified: unit.fortified || false,
      orders: unit.orders || null,
      transportedBy: unit.transportedBy,
      cargoUnits: unit.cargoUnits || [],
      capabilities: {
        canFortify: Boolean(
          unitType?.rulesetUnitClassFlags.includes('CanFortify') &&
            !unitType.flags?.includes('Cant_Fortify')
        ),
        canFoundCity: Boolean(unitType?.canFoundCity),
        canBuildImprovements: Boolean(unitType?.canBuildImprovements),
        canPillage: Boolean(unitType?.rulesetUnitClassFlags.includes('CanPillage')),
        canTrade: Boolean(unitType?.flags?.includes('TradeRoute')),
        diplomatActions: unitType?.flags?.includes('Diplomat')
          ? rulesetActionsService.getDiplomatActions(unitType.flags)
          : [],
        unitActions: unitType ? rulesetActionsService.getUnitActions(unitType) : [],
      },
    };
  }

  /**
   * Broadcast all city data to players in a game
   * Sends cities with calculated production, surplus, and client-ready format
   */
  broadcastCityData(gameId: string): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to broadcast city data to non-existent game', { gameId });
      return;
    }

    for (const [playerId] of gameInstance.players) {
      this.broadcastCityDataToPlayer(gameId, playerId);
    }

    this.logger.debug('Broadcasted city data to game', {
      gameId,
      cityCount: gameInstance.cityManager.getAllCities().length,
      playerCount: gameInstance.players.size,
    });
  }

  /**
   * Broadcast city data to a specific player
   */
  broadcastCityDataToPlayer(gameId: string, playerId: string): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to broadcast city data to non-existent game', { gameId });
      return;
    }

    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
    const visibleTiles = gameInstance.visibilityManager.getVisibleTiles(playerId);
    const exploredTiles = gameInstance.visibilityManager.getExploredTiles(playerId);
    const allCities = gameInstance.cityManager.getAllCities();
    const debugVisibility = this.isDebugVisibilityEnabled(gameId, playerId);
    const rulesetName = gameInstance.config?.ruleset ?? 'civ2civ3';
    const smallWonderVisibility =
      rulesetLoader.loadGameRulesRuleset(rulesetName).wonder_visibility.small_wonders;
    const visibleCities = debugVisibility
      ? allCities
      : allCities.filter(
          (city: any) =>
            city.playerId === playerId ||
            visibleTiles.has(`${city.x},${city.y}`) ||
            (smallWonderVisibility === 'Always' &&
              exploredTiles.has(`${city.x},${city.y}`) &&
              city.buildings.some((buildingId: string) => {
                try {
                  return rulesetLoader.getBuilding(buildingId, rulesetName).genus === 'SmallWonder';
                } catch {
                  return false;
                }
              }))
        );

    const presentations = resolveCityPresentations(
      visibleCities,
      gameInstance.players,
      playerId => gameInstance.researchManager?.getResearchedTechs(playerId) ?? []
    );
    const clientCityData = CityDataService.transformCitiesForClient(
      visibleCities,
      rulesetName,
      undefined,
      presentations,
      gameInstance.unitManager.getAllUnits?.().values() ?? [],
      playerId
    );

    const recipientId = gameInstance.players.get(playerId)?.userId || playerId;
    this.broadcastToPlayer(recipientId, 'cities_updated', {
      gameId,
      cities: clientCityData,
      timestamp: Date.now(),
    });

    this.logger.debug('Broadcasted city data to player', {
      gameId,
      playerId,
      cityCount: visibleCities.length,
    });
  }

  /**
   * Sync complete game state to a player (cities, units, research, etc.)
   * Called when player joins or reconnects
   */
  syncGameStateToPlayer(gameId: string, playerId: string): void {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      this.logger.warn('Attempted to sync game state to non-existent game', { gameId });
      return;
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      this.logger.warn('Attempted to sync game state to non-existent player', { gameId, playerId });
      return;
    }

    // Sync cities with calculated production data
    this.broadcastCityDataToPlayer(gameId, playerId);

    // TODO: Sync other game state components:
    // - Units with positions and stats
    // - Research progress
    // - Diplomacy status
    // - Game rules and settings
    // - Turn information

    this.logger.info('Synchronized complete game state to player', {
      gameId,
      playerId,
      playerName: player.id, // Use player.id since name may not exist
    });
  }
}
