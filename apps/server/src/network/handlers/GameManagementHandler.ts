/**
 * @module server/network/handlers/GameManagementHandler
 * Handles Game Management Handler socket events.
 */
import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import {
  GameCreateSchema,
  GameIdSchema,
  GameJoinSchema,
  PacketType,
  PROTOCOL_VERSION,
} from '@app-types/packet';
import { ScenarioUnavailableError } from '@game/map/ScenarioProvider';
import { GameManager } from '@game/managers/GameManager';
import { CityDataService } from '@game/services/CityDataService';
import { resolveCityPresentations } from '@game/services/CityPresentationService';
import { resolvePlayerScore } from '@game/services/PlayerScoreService';
import { resolveNationGraphic } from '@game/services/NationPresentationService';

/**
 * Handles game management packets: creation, joining, starting, listing, deletion
 * Manages game lifecycle and lobby functionality
 */
export class GameManagementHandler extends BaseSocketHandler {
  protected handledPacketTypes = [
    PacketType.GAME_CREATE,
    PacketType.GAME_CREATE_REPLY,
    PacketType.GAME_JOIN,
    PacketType.GAME_JOIN_REPLY,
    PacketType.GAME_START,
    PacketType.GAME_LIST,
  ];

  protected handlerName = 'GameManagementHandler';

  private activeConnections: Map<
    string,
    {
      userId?: string;
      username?: string;
      gameId?: string;
      role?: 'player' | 'spectator';
    }
  >;
  private gameManager: GameManager;

  constructor(activeConnections: Map<string, any>, gameManager: GameManager) {
    super();
    this.activeConnections = activeConnections;
    this.gameManager = gameManager;
  }

  register(handler: PacketHandler, io: Server, socket: Socket): void {
    // Register packet handlers
    handler.register(PacketType.GAME_LIST, async socket => {
      await this.handleGameList(handler, socket);
    });

    handler.register(
      PacketType.GAME_CREATE,
      async (socket, data) => {
        await this.handleGameCreate(handler, socket, data);
      },
      GameCreateSchema
    );

    handler.register(
      PacketType.GAME_JOIN,
      async (socket, data) => {
        await this.handleGameJoin(handler, socket, data);
      },
      GameJoinSchema
    );

    handler.register(PacketType.GAME_START, async (socket, _data) => {
      await this.handleGameStart(handler, socket);
    });

    // Register socket event handlers
    this.registerSocketEvents(socket, io);

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  /**
   * Register non-packet socket events
   */
  private registerSocketEvents(socket: Socket, _io: Server): void {
    // Handle join_game event
    socket.on('join_game', async (data, callback) => {
      const parsed = GameJoinSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid join game request' });
        return;
      }
      await this.handleJoinGameEvent(socket, parsed.data, callback);
    });

    // Handle observe_game event
    socket.on('observe_game', async (data, callback) => {
      const parsed = GameIdSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid observe game request' });
        return;
      }
      await this.handleObserveGameEvent(socket, parsed.data, callback);
    });

    // Handle get_game_list event
    socket.on('get_game_list', async callback => {
      await this.handleGetGameListEvent(socket, callback);
    });

    // Handle delete_game event
    socket.on('delete_game', async (data, callback) => {
      const parsed = GameIdSchema.safeParse(data);
      if (!parsed.success) {
        callback({ success: false, error: 'Invalid delete game request' });
        return;
      }
      await this.handleDeleteGameEvent(socket, parsed.data, callback);
    });

    socket.on('host:getControls', async (_data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      const game = connection?.gameId ? await this.gameManager.getGame(connection.gameId) : null;
      callback({
        success: Boolean(game && connection?.userId && !this.isSpectator(connection)),
        isHost: game?.hostId === connection?.userId,
        paused: game?.status === 'paused',
        turnTimeLimit: game?.turnTimeLimit,
      });
    });

    socket.on('host:setPaused', async (data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      try {
        if (!connection?.gameId || !connection.userId || this.isSpectator(connection)) {
          throw new Error('Not an active player');
        }
        await this.gameManager.setGamePaused(
          connection.gameId,
          connection.userId,
          Boolean(data.paused)
        );
        callback({ success: true, paused: Boolean(data.paused) });
      } catch (error) {
        callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
      }
    });

    socket.on('host:setTurnTimeLimit', async (data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      try {
        if (!connection?.gameId || !connection.userId || this.isSpectator(connection)) {
          throw new Error('Not an active player');
        }
        const turnTimeLimit = Number(data.turnTimeLimit);
        await this.gameManager.setTurnTimeLimit(
          connection.gameId,
          connection.userId,
          turnTimeLimit
        );
        callback({ success: true, turnTimeLimit });
      } catch (error) {
        callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
      }
    });

    socket.on('host:setPlayerAIControl', async (data, callback) => {
      await this.handleSetPlayerAIControl(socket, data, callback);
    });

    socket.on('advisor:getRecommendations', async (_data, callback) => {
      const connection = this.getConnection(socket, this.activeConnections);
      try {
        if (!connection?.gameId || !connection.userId || this.isSpectator(connection)) {
          throw new Error('Not an active player');
        }
        const recommendations = await this.gameManager.getAdvisorRecommendations(
          connection.gameId,
          connection.userId
        );
        callback({ success: true, recommendations });
      } catch (error) {
        callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
      }
    });
  }

  private async handleSetPlayerAIControl(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    try {
      this.assertAIControlRequest(connection, data);
      await this.gameManager.setPlayerAIControl(
        connection.gameId,
        connection.userId,
        data.playerId,
        data.isAI,
        { aiLevel: data.aiLevel, controllerUserId: data.controllerUserId }
      );
      callback({ success: true, playerId: data.playerId, isAI: data.isAI });
    } catch (error) {
      callback({ success: false, error: error instanceof Error ? error.message : 'Failed' });
    }
  }

  private assertAIControlRequest(connection: any, data: any): void {
    if (!connection?.gameId || !connection.userId || this.isSpectator(connection))
      throw new Error('Not an active player');
    if (typeof data?.playerId !== 'string' || typeof data?.isAI !== 'boolean')
      throw new Error('Invalid player control request');
  }

  /**
   * Handle GAME_LIST packet
   */
  private async handleGameList(_handler: PacketHandler, socket: Socket): Promise<void> {
    try {
      const connection = this.getConnection(socket, this.activeConnections);
      const userId = connection?.userId || null;
      const games = await this.gameManager.getGameListForLobby(userId);

      const gameList = games.map(game => ({
        gameId: game.id,
        name: game.name,
        status: game.status,
        players: game.currentPlayers,
        maxPlayers: game.maxPlayers,
        currentTurn: game.currentTurn,
        mapSize: game.mapSize,
        ruleset: game.ruleset ?? 'civ2civ3',
      }));

      socket.emit('packet', {
        version: PROTOCOL_VERSION,
        type: PacketType.GAME_LIST,
        data: { games: gameList },
      });
    } catch (error) {
      logger.error('Error fetching game list:', error);
    }
  }

  /**
   * Handle GAME_CREATE packet
   */
  private async handleGameCreate(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const gameId = await this.gameManager.createGame({
        name: data.name,
        hostId: connection.userId!,
        gameType: data.gameType,
        maxPlayers: data.maxPlayers,
        mapWidth: data.mapWidth,
        mapHeight: data.mapHeight,
        ruleset: data.ruleset,
        nationSet: data.nationSet,
        turnTimeLimit: data.turnTimeLimit,
        barbarianRate: data.barbarianRate,
        victoryConditions: data.victoryConditions,
        terrainSettings: data.terrainSettings,
        aiLevel: data.aiLevel,
        researchPacing: data.researchPacing,
      });

      // Automatically join the creator as a player
      // Join the socket room BEFORE joining the game so we receive broadcasts
      connection.gameId = gameId;
      connection.role = 'player';
      socket.join(`game:${gameId}`);

      const result = await this.gameManager.joinGame(
        gameId,
        connection.userId!,
        data.selectedNation
      );
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: true,
        gameId,
        maxPlayers: data.maxPlayers,
        playerId: result.playerId,
        message: 'Game created successfully',
        assignedNation: result.assignedNation,
        assignedColor: result.assignedColor,
        leaderName: result.leaderName,
      });

      logger.info(`Game created by ${connection.username}`, { gameId });
    } catch (error) {
      logger.error('Error creating game:', error);
      handler.send(socket, PacketType.GAME_CREATE_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to create game',
        ...(error instanceof ScenarioUnavailableError ? { errorCode: error.code } : {}),
      });
    }
  }

  /**
   * Handle GAME_JOIN packet
   */
  private async handleGameJoin(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: false,
        message: 'Not authenticated',
      });
      return;
    }

    try {
      const result = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.civilization
      );

      connection.gameId = data.gameId;
      connection.role = 'player';
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId: result.playerId,
        leaderName: result.leaderName,
        message: 'Joined game successfully',
      });
      const joinedGame = await this.gameManager.getGame(data.gameId);
      if (joinedGame?.status === 'ended' && joinedGame.endGameReport) {
        handler.send(socket, PacketType.ENDGAME_REPORT, joinedGame.endGameReport);
      }

      logger.info(`${connection.username} joined game`, {
        gameId: data.gameId,
        playerId: result.playerId,
      });
    } catch (error) {
      logger.error('Error joining game:', error);
      handler.send(socket, PacketType.GAME_JOIN_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to join game',
      });
    }
  }

  /**
   * Handle GAME_START packet
   */
  private async handleGameStart(handler: PacketHandler, socket: Socket): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection) || !this.isInGame(connection)) {
      return;
    }

    try {
      await this.gameManager.startGame(connection.gameId!, connection.userId!);
      logger.info(`Game started by ${connection.username}`, { gameId: connection.gameId });
    } catch (error) {
      logger.error('Error starting game:', error);
      handler.send(socket, PacketType.SERVER_MESSAGE, {
        message: error instanceof Error ? error.message : 'Failed to start game',
        type: 'error',
      });
    }
  }

  /**
   * Handle join_game socket event
   */
  private async handleJoinGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const result = await this.gameManager.joinGame(
        data.gameId,
        connection.userId!,
        data.selectedNation || 'random'
      );

      connection.gameId = data.gameId;
      connection.role = 'player';
      socket.join(`game:${data.gameId}`);
      await this.gameManager.updatePlayerConnection(result.playerId, true);

      const joinedGame = await this.gameManager.getGame(data.gameId);
      const hasLiveInstance = Boolean(this.gameManager.getGameInstance(data.gameId));
      const requiresSnapshot =
        hasLiveInstance || Boolean(joinedGame && joinedGame.status !== 'waiting');

      // A successful active-game join means the client can render a complete
      // recovery snapshot. Propagate recovery failures instead of mounting an
      // empty game and asking the browser to recover through a refresh.
      if (requiresSnapshot) {
        await this.sendGameSnapshot(data.gameId, socket, result.playerId);
      }

      callback({
        success: true,
        playerId: result.playerId,
        assignedNation: result.assignedNation,
        assignedColor: result.assignedColor,
        leaderName: result.leaderName,
      });
      logger.info(`${connection?.username || 'Unknown'} joined game ${data.gameId}`, {
        playerId: result.playerId,
      });
    } catch (error) {
      logger.error('Error joining game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to join game',
      });
    }
  }

  /**
   * Handle observe_game socket event
   */
  private async handleObserveGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    const connection = this.getConnection(socket, this.activeConnections);
    if (!this.isAuthenticated(connection)) {
      callback({ success: false, error: 'Not authenticated' });
      return;
    }

    try {
      const game = await this.gameManager.getGame(data.gameId);
      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      connection.gameId = data.gameId;
      connection.role = 'spectator';
      socket.join(`game:${data.gameId}`);

      await this.sendGameSnapshot(data.gameId, socket);

      callback({ success: true, role: 'spectator' });
      logger.info(`${connection?.username || 'Unknown'} is now observing game ${data.gameId}`);
    } catch (error) {
      logger.error('Error observing game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to observe game',
      });
    }
  }

  /**
   * Handle get_game_list socket event
   */
  private async handleGetGameListEvent(
    socket: Socket,
    callback: (response: any) => void
  ): Promise<void> {
    try {
      logger.info('Getting game list requested');
      const connection = this.getConnection(socket, this.activeConnections);
      const games = await this.gameManager.getGameListForLobby(connection?.userId || null);
      logger.info(`Retrieved ${games.length} games from database`);

      callback({ success: true, games });
    } catch (error) {
      logger.error('Error getting game list:', error);
      callback({ success: false, error: 'Failed to get game list' });
    }
  }

  /**
   * Handle delete_game socket event
   */
  private async handleDeleteGameEvent(
    socket: Socket,
    data: any,
    callback: (response: any) => void
  ): Promise<void> {
    try {
      const connection = this.getConnection(socket, this.activeConnections);
      if (!connection?.userId || this.isSpectator(connection)) {
        throw new Error('Not authorized to delete this game');
      }
      await this.gameManager.deleteGame(data.gameId, connection.userId);
      callback({ success: true });
      logger.info('Game deleted', { gameId: data.gameId });
    } catch (error) {
      logger.error('Error deleting game:', error);
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete game',
      });
    }
  }

  /**
   * Restore and send the full map to a player rejoining an active game.
   *
   * A server restart clears the in-memory game instance, so recover it from
   * the persisted map before sending the initial map packets to this socket.
   */
  private async sendGameSnapshot(gameId: string, socket: Socket, playerId?: string): Promise<void> {
    const gameInstance = await this.getSnapshotGameInstance(gameId);
    const mapData = this.getSnapshotMapData(gameInstance);

    const { visibleTiles, exploredTiles, rememberedTiles } = this.getSnapshotVisibility(
      gameInstance,
      playerId,
      mapData
    );

    this.emitSnapshotCalendar(gameInstance, socket);
    this.emitSnapshotMapInfo(mapData, socket);

    const tiles = this.buildSnapshotTiles(
      mapData,
      playerId,
      visibleTiles,
      exploredTiles,
      rememberedTiles
    );

    this.emitSnapshotTileBatches(socket, tiles);

    const units = this.getSnapshotUnitPresentations(gameInstance, playerId, visibleTiles);
    this.emitSnapshotUnits(units, socket);

    const cities = this.getSnapshotCities(gameInstance, playerId, exploredTiles);
    this.emitSnapshotCities(gameId, gameInstance, playerId, cities, socket);
    this.emitSnapshotBorders(gameInstance, playerId, exploredTiles, socket);

    logger.info('Sent recovered game snapshot', {
      gameId,
      playerId,
      role: playerId ? 'player' : 'spectator',
      mapSize: `${mapData.width}x${mapData.height}`,
      tiles: tiles.length,
      units: units.length,
      cities: cities.length,
      totalCities: gameInstance.cityManager.getAllCities().length,
    });
  }

  private async getSnapshotGameInstance(gameId: string): Promise<any> {
    const existing = this.gameManager.getGameInstance(gameId);
    const gameInstance = existing ?? (await this.gameManager.recoverGameInstance(gameId));
    if (!gameInstance) throw new Error('Unable to recover active game');
    return gameInstance;
  }

  private getSnapshotMapData(gameInstance: any): any {
    const mapData = gameInstance.mapManager.getMapData();
    if (!mapData) throw new Error('Recovered game has no map data');
    return mapData;
  }

  private emitSnapshotCalendar(gameInstance: any, socket: Socket): void {
    const snapshotTurn =
      gameInstance.turnManager?.getCurrentTurn?.() ?? gameInstance.currentTurn ?? 0;
    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.NEW_YEAR,
      data: {
        turn: snapshotTurn,
        year: gameInstance.turnManager?.getCurrentYear?.(),
        fragments: 0,
      },
      timestamp: Date.now(),
    });
    this.emitSnapshotPlayers(gameInstance, socket);
  }

  private emitSnapshotMapInfo(mapData: any, socket: Socket): void {
    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.MAP_INFO,
      data: {
        xsize: mapData.width,
        ysize: mapData.height,
        wrap_id: mapData.wrapId ?? 0,
        topology_id: mapData.topologyId ?? 0,
      },
      timestamp: Date.now(),
    });
  }

  private getSnapshotUnitPresentations(
    gameInstance: any,
    playerId: string | undefined,
    visibleTiles: Set<string>
  ): any[] {
    return this.getSnapshotUnits(gameInstance, playerId, visibleTiles).map((unit: any) => {
      const unitType = gameInstance.unitManager.getUnitType?.(unit.unitTypeId);
      return {
        id: unit.id,
        owner: unit.playerId,
        type: unit.unitTypeId,
        x: unit.x,
        y: unit.y,
        hp: unit.health,
        maxHp: unitType?.hp ?? 100,
        attack: unitType?.attack ?? unitType?.combat ?? 0,
        defense: unitType?.defense ?? 0,
        firepower: unitType?.firepower ?? 1,
        movesleft: unit.movementLeft,
        veteran: unit.veteranLevel,
      };
    });
  }

  private emitSnapshotUnits(units: any[], socket: Socket): void {
    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.UNIT_INFO,
      data: { units, fullSnapshot: true },
      timestamp: Date.now(),
    });
  }

  private getSnapshotCities(
    gameInstance: any,
    playerId: string | undefined,
    exploredTiles: Set<string>
  ): any[] {
    return gameInstance.cityManager
      .getAllCities()
      .filter((city: any) => this.isSnapshotCityVisible(city, playerId, exploredTiles));
  }

  private emitSnapshotCities(
    gameId: string,
    gameInstance: any,
    playerId: string | undefined,
    cities: any[],
    socket: Socket
  ): void {
    const cityPresentations = resolveCityPresentations(
      cities,
      gameInstance.players,
      id => gameInstance.researchManager?.getResearchedTechs(id) ?? []
    );
    const clientCities = CityDataService.transformCitiesForClient(
      cities,
      'classic',
      undefined,
      cityPresentations,
      gameInstance.unitManager.getAllUnits?.().values() ?? [],
      playerId
    );
    this.addAirliftAvailabilityToSnapshot(gameInstance, playerId, cities, clientCities);

    socket.emit('cities_updated', {
      gameId,
      cities: clientCities,
      timestamp: Date.now(),
    });
  }

  private addAirliftAvailabilityToSnapshot(
    gameInstance: any,
    playerId: string | undefined,
    cities: any[],
    clientCities: Record<string, any>
  ): void {
    if (!playerId || typeof gameInstance.cityManager.getAirliftAvailability !== 'function') {
      return;
    }

    for (const city of cities) {
      if (city.playerId !== playerId || !clientCities[city.id]) continue;
      clientCities[city.id].airlift = {
        from: gameInstance.cityManager.getAirliftAvailability(
          city.id,
          playerId,
          'from',
          gameInstance.currentTurn ?? 1
        ),
        to: gameInstance.cityManager.getAirliftAvailability(
          city.id,
          playerId,
          'to',
          gameInstance.currentTurn ?? 1
        ),
      };
    }
  }

  private emitSnapshotBorders(
    gameInstance: any,
    playerId: string | undefined,
    exploredTiles: Set<string>,
    socket: Socket
  ): void {
    const tiles = gameInstance.borderManager
      .getAllTileOwnership()
      .filter((ownership: any) => this.isSnapshotBorderVisible(ownership, playerId, exploredTiles))
      .map((ownership: any) => ({
        x: ownership.x,
        y: ownership.y,
        owner: ownership.playerId,
        strength: ownership.strength,
      }));
    socket.emit('packet', {
      version: PROTOCOL_VERSION,
      type: PacketType.BORDER_UPDATE,
      data: { type: 'border_update', updateType: 'full_update', tiles },
      timestamp: Date.now(),
    });
  }

  private getSnapshotVisibility(
    gameInstance: any,
    playerId: string | undefined,
    mapData: any
  ): any {
    if (!playerId)
      return {
        visibleTiles: new Set<string>(),
        exploredTiles: new Set<string>(),
        rememberedTiles: new Map<string, any>(),
      };
    gameInstance.visibilityManager.updatePlayerVisibility(playerId);
    const visibleTiles = gameInstance.visibilityManager.getVisibleTiles(playerId);
    const exploredTiles = gameInstance.visibilityManager.getExploredTiles(playerId);
    const rememberedTiles =
      gameInstance.visibilityManager.getRememberedTiles?.(playerId) ??
      this.rememberExploredTiles(exploredTiles, mapData);
    return { visibleTiles, exploredTiles, rememberedTiles };
  }

  private rememberExploredTiles(exploredTiles: Set<string>, mapData: any): Map<string, any> {
    return new Map(
      [...exploredTiles].flatMap(key => {
        const [x, y] = key.split(',').map(Number);
        const tile = mapData.tiles[x]?.[y];
        return tile ? [[key, tile] as const] : [];
      })
    );
  }

  private emitSnapshotPlayers(gameInstance: any, socket: Socket): void {
    for (const player of gameInstance.players?.values?.() ?? []) {
      if (!player.color) continue;
      socket.emit('packet', {
        version: PROTOCOL_VERSION,
        type: PacketType.PLAYER_INFO,
        data: this.formatSnapshotPlayer(player, gameInstance),
        timestamp: Date.now(),
      });
    }
  }

  private formatSnapshotPlayer(player: any, gameInstance?: any): any {
    const value = (field: string, fallback: any) => player[field] ?? fallback;
    const nation = value('nation', player.civilization);
    const rulesetName = gameInstance?.config?.ruleset ?? 'classic';
    return {
      id: player.id,
      name: value('leaderName', player.civilization),
      nation,
      nationGraphic: resolveNationGraphic(nation, rulesetName),
      score: resolvePlayerScore(player.score, this.getSnapshotScoreInputs(player, gameInstance)),
      gold: value('gold', 0),
      goldPerTurn: value('goldPerTurn', 0),
      science: value('science', 0),
      sciencePerTurn: value('sciencePerTurn', 0),
      taxRate: value('taxRate', 40),
      luxuryRate: value('luxuryRate', 0),
      scienceRate: value('scienceRate', 60),
      culture: value('history', 0),
      teamId: value('teamId', undefined),
      spaceshipState: value('spaceshipState', undefined),
      government: value('government', 'despotism'),
      alive: value('isAlive', true),
      isAI: value('isAI', false),
      color: player.color,
    };
  }

  private getSnapshotScoreInputs(player: any, gameInstance?: any): any {
    if (!gameInstance) return undefined;

    const cities = gameInstance.cityManager?.getCitiesByPlayer?.(player.id) ?? [];
    const buildingTypes = gameInstance.cityManager?.getBuildingTypes?.() ?? {};
    const greatWonders = cities.reduce(
      (total: number, city: any) =>
        total +
        (city.buildings ?? []).filter(
          (buildingId: string) => buildingTypes[buildingId]?.genus === 'GreatWonder'
        ).length,
      0
    );
    return {
      cities,
      units: this.getSnapshotPlayerUnits(player, gameInstance),
      researchedTechs: this.getSnapshotPlayerResearch(player, gameInstance),
      history: player.history ?? 0,
      greatWonders,
      unitsBuilt: player.unitsBuilt ?? 0,
      unitsKilled: player.unitsKilled ?? 0,
      spaceship: player.spaceshipState,
      currentTurn: gameInstance.turnManager?.getCurrentTurn?.() ?? gameInstance.currentTurn ?? 0,
    };
  }

  private getSnapshotPlayerUnits(player: any, gameInstance: any): any[] {
    const allUnits = gameInstance.unitManager?.getAllUnits?.();
    if (!allUnits) return [];
    return Array.from(allUnits.values()).filter((unit: any) => unit.playerId === player.id);
  }

  private getSnapshotPlayerResearch(player: any, gameInstance: any): any[] {
    const research = gameInstance.researchManager?.getPlayerResearch?.(player.id);
    return research?.researchedTechs ? Array.from(research.researchedTechs) : [];
  }

  private buildSnapshotTiles(
    mapData: any,
    playerId: string | undefined,
    visible: Set<string>,
    explored: Set<string>,
    remembered: Map<string, any>
  ): any[] {
    const tiles: any[] = [];
    for (let y = 0; y < mapData.height; y++)
      for (let x = 0; x < mapData.width; x++) {
        const tile = mapData.tiles[x]?.[y];
        if (tile)
          tiles.push(
            this.buildSnapshotTile(
              tile,
              mapData.width,
              x,
              y,
              playerId,
              visible,
              explored,
              remembered
            )
          );
      }
    return tiles;
  }

  private buildSnapshotTile(
    tile: any,
    width: number,
    x: number,
    y: number,
    playerId: string | undefined,
    visible: Set<string>,
    explored: Set<string>,
    remembered: Map<string, any>
  ): any {
    const key = `${x},${y}`;
    const isVisible = !playerId || visible.has(key);
    const isExplored = !playerId || explored.has(key);
    const known = isVisible ? tile : remembered.get(key);
    const value = (field: string, fallback: any = undefined) =>
      isExplored ? (known?.[field] ?? fallback) : fallback;
    return {
      tile: x + y * width,
      x,
      y,
      terrain: value('terrain', 'unknown'),
      resource: value('resource'),
      elevation: value('elevation', 0),
      riverMask: value('riverMask', 0),
      hasRoad: value('hasRoad', false),
      hasRailroad: value('hasRailroad', false),
      improvements: value('improvements', []),
      cityId: value('cityId'),
      owner: value('owner'),
      claimer: value('claimer'),
      known: isVisible ? 2 : isExplored ? 1 : 0,
      seen: isVisible ? 1 : 0,
      player: value('owner', null),
      worked: null,
      extras: 0,
    };
  }

  private emitSnapshotTileBatches(socket: Socket, tiles: any[]): void {
    for (let start = 0; start < tiles.length; start += 100) {
      const batch = tiles.slice(start, start + 100);
      socket.emit('packet', {
        version: PROTOCOL_VERSION,
        type: PacketType.TILE_INFO,
        data: {
          tiles: batch,
          startIndex: start,
          endIndex: start + batch.length,
          total: tiles.length,
        },
        timestamp: Date.now(),
      });
    }
  }

  private getSnapshotUnits(
    gameInstance: any,
    playerId: string | undefined,
    visibleTiles: Set<string>
  ): any[] {
    return playerId
      ? gameInstance.unitManager.getVisibleUnits(
          playerId,
          visibleTiles,
          gameInstance.visibilityManager.getDetectionTiles?.(playerId)
        )
      : Array.from(gameInstance.unitManager.getAllUnits().values());
  }

  private isSnapshotCityVisible(
    city: any,
    playerId: string | undefined,
    explored: Set<string>
  ): boolean {
    return !playerId || city.playerId === playerId || explored.has(`${city.x},${city.y}`);
  }

  private isSnapshotBorderVisible(
    ownership: any,
    playerId: string | undefined,
    explored: Set<string>
  ): boolean {
    return (
      !playerId || ownership.playerId === playerId || explored.has(`${ownership.x},${ownership.y}`)
    );
  }
}
