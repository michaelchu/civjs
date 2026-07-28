import { Server, Socket } from 'socket.io';
import { logger } from '@utils/logger';
import { PacketHandler } from '../PacketHandler';
import { BaseSocketHandler } from './BaseSocketHandler';
import { PacketType, CityFoundSchema, CityProductionChangeSchema } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { CityProductionHandler } from './CityProductionHandler';
import { getUnitType } from '@game/constants/UnitConstants';
import {
  GovernorPriority,
  SPECIALIST_TYPES,
  type ProductionItem,
} from '@game/managers/CityManager';
import { RequirementsManager } from '@game/managers/RequirementsManager';

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

  register(handler: PacketHandler, _io: Server, socket: Socket): void {
    handler.register(
      PacketType.CITY_FOUND,
      async (socket, data) => {
        await this.handleCityFound(handler, socket, data);
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

    // Register production endpoints
    socket.on('city:getAvailableProductions', async data => {
      const connection = this.getConnection(socket, this.activeConnections);
      if (
        !this.isAuthenticated(connection) ||
        !this.isInGame(connection) ||
        this.isSpectator(connection)
      ) {
        socket.emit('error', { message: 'Not authenticated or not in a game' });
        return;
      }

      // Get the actual game instance and its data
      const game = this.gameManager.getGameInstance(connection.gameId!);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Create production handler with real data for this request
      const productionHandler = new CityProductionHandler(
        game.cityManager.getCitiesMap(),
        game.players,
        game.researchManager,
        game.cityManager.setCityProduction.bind(game.cityManager),
        game.turnManager ? new RequirementsManager(game.turnManager.getCultureManager()) : undefined
      );

      const player = Array.from(game.players.values()).find(
        (candidate: any) => candidate.userId === connection.userId
      );
      if (!player) {
        socket.emit('error', { message: 'Player not found in game' });
        return;
      }

      await productionHandler.getAvailableProductions(socket, {
        cityId: data.cityId,
        playerId: player.id,
      });
    });

    socket.on('city:changeProduction', async data => {
      const connection = this.getConnection(socket, this.activeConnections);
      if (
        !this.isAuthenticated(connection) ||
        !this.isInGame(connection) ||
        this.isSpectator(connection)
      ) {
        socket.emit('error', { message: 'Not authenticated or not in a game' });
        return;
      }

      // Get the actual game instance and its data
      const game = this.gameManager.getGameInstance(connection.gameId!);
      if (!game) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      // Create production handler with real data for this request
      const productionHandler = new CityProductionHandler(
        game.cityManager.getCitiesMap(),
        game.players,
        game.researchManager,
        game.cityManager.setCityProduction.bind(game.cityManager),
        game.turnManager ? new RequirementsManager(game.turnManager.getCultureManager()) : undefined
      );

      const player = Array.from(game.players.values()).find(
        (candidate: any) => candidate.userId === connection.userId
      );
      if (!player) {
        socket.emit('error', { message: 'Player not found in game' });
        return;
      }

      await productionHandler.changeProduction(socket, {
        cityId: data.cityId,
        playerId: player.id,
        productionId: data.productionId,
        productionType: data.productionType,
      });
    });

    socket.on('city:configureGovernor', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context) {
        callback({ success: false, error: 'City not found or not owned by player' });
        return;
      }
      const priorities = new Set(Object.values(GovernorPriority));
      if (!priorities.has(data.priority)) {
        callback({ success: false, error: 'Invalid governor priority' });
        return;
      }

      const success = await context.game.cityManager.configureCityGovernor(
        data.cityId,
        context.player.id,
        {
          enabled: Boolean(data.enabled),
          priority: data.priority,
          autoManageSpecialists: Boolean(data.autoManageSpecialists),
          autoManageTiles: Boolean(data.autoManageTiles),
          autoManageProduction: Boolean(data.autoManageProduction),
          preventStarvation: Boolean(data.preventStarvation),
          maintainHappiness: Boolean(data.maintainHappiness),
        }
      );
      callback({
        success,
        governor: context.game.cityManager.getCityGovernorInfo(data.cityId),
      });
    });

    socket.on('city:optimizeCitizens', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context) {
        callback({ success: false, error: 'City not found or not owned by player' });
        return;
      }
      const success = await context.game.cityManager.optimizeCityManually(data.cityId);
      if (success) {
        context.game.cityManager.refreshCityOutputs(data.cityId);
        await context.game.cityManager.saveCity(data.cityId);
        this.gameManager.broadcastCityData(context.game.id);
      }
      callback({ success });
    });

    socket.on('city:buyProduction', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context) {
        callback({ success: false, error: 'City not found or not owned by player' });
        return;
      }
      const result = await context.game.cityManager.buyProduction(data.cityId, context.player.id);
      const remainingGold = await context.game.turnManager
        ?.getEconomicManager()
        ?.getPlayerGold(context.player.id);
      callback({
        success: result.success,
        result: { ...result, remainingGold },
        error: result.reason,
      });
    });

    socket.on('city:addWorklist', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context || !Array.isArray(data?.items) || data.items.length === 0) {
        callback({ success: false, error: 'Invalid worklist request' });
        return;
      }
      const items: ProductionItem[] = data.items.map((item: any) => ({
        kind: item.type,
        value: item.productionId,
      }));
      const valid = items.every(
        item =>
          ['unit', 'building', 'wonder'].includes(item.kind) &&
          typeof item.value === 'string' &&
          item.value.length > 0
      );
      const player = context.game.players.get(context.player.id);
      const productionHandler = new CityProductionHandler(
        context.game.cityManager.getCitiesMap(),
        context.game.players,
        context.game.researchManager,
        context.game.cityManager.setCityProduction.bind(context.game.cityManager),
        context.game.turnManager
          ? new RequirementsManager(context.game.turnManager.getCultureManager())
          : undefined
      );
      const available =
        valid &&
        Boolean(player) &&
        (
          await Promise.all(
            items.map(item =>
              productionHandler.canCityBuild(
                context.game.cityManager.getCity(data.cityId),
                item.value,
                item.kind,
                player
              )
            )
          )
        ).every(Boolean);
      const success =
        available &&
        (await context.game.cityManager.addToWorklist(data.cityId, items, context.player.id));
      if (success) this.gameManager.broadcastCityData(context.game.id);
      callback({ success, error: success ? undefined : 'One or more items cannot be queued' });
    });

    socket.on('city:removeWorklist', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const success =
        Boolean(context) &&
        Number.isInteger(data?.index) &&
        (await context!.game.cityManager.removeFromWorklist(
          data.cityId,
          data.index,
          context!.player.id
        ));
      if (success) this.gameManager.broadcastCityData(context!.game.id);
      callback({ success, error: success ? undefined : 'Invalid worklist item' });
    });

    socket.on('city:reorderWorklist', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const success =
        Boolean(context) &&
        Number.isInteger(data?.fromIndex) &&
        Number.isInteger(data?.toIndex) &&
        (await context!.game.cityManager.reorderWorklist(
          data.cityId,
          data.fromIndex,
          data.toIndex,
          context!.player.id
        ));
      if (success) this.gameManager.broadcastCityData(context!.game.id);
      callback({ success, error: success ? undefined : 'Invalid worklist reorder' });
    });

    socket.on('city:assignCitizen', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const success =
        Boolean(context) &&
        Number.isInteger(data?.x) &&
        Number.isInteger(data?.y) &&
        (await context!.game.cityManager.assignCitizenToTile(data.cityId, data.x, data.y));
      if (success) {
        context!.game.cityManager.refreshCityOutputs(data.cityId);
        await context!.game.cityManager.saveCity(data.cityId);
        this.gameManager.broadcastCityData(context!.game.id);
      }
      callback({ success, error: success ? undefined : 'Citizen cannot work that tile' });
    });

    socket.on('city:workerToSpecialist', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const specialistType = Number(data?.specialistType);
      const success =
        Boolean(context) &&
        Number.isInteger(data?.x) &&
        Number.isInteger(data?.y) &&
        Object.prototype.hasOwnProperty.call(SPECIALIST_TYPES, specialistType) &&
        (await context!.game.cityManager.convertTileWorkerToSpecialist(
          data.cityId,
          data.x,
          data.y,
          specialistType
        ));
      if (success) {
        context!.game.cityManager.refreshCityOutputs(data.cityId);
        await context!.game.cityManager.saveCity(data.cityId);
        this.gameManager.broadcastCityData(context!.game.id);
      }
      callback({ success, error: success ? undefined : 'Worker cannot become that specialist' });
    });

    socket.on('city:specialistToTile', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const specialistType = Number(data?.specialistType);
      const success =
        Boolean(context) &&
        Number.isInteger(data?.x) &&
        Number.isInteger(data?.y) &&
        Object.prototype.hasOwnProperty.call(SPECIALIST_TYPES, specialistType) &&
        (await context!.game.cityManager.convertSpecialistToTile(
          data.cityId,
          specialistType,
          data.x,
          data.y
        ));
      if (success) {
        await context!.game.cityManager.saveCity(data.cityId);
        this.gameManager.broadcastCityData(context!.game.id);
      }
      callback({ success, error: success ? undefined : 'Specialist cannot work that tile' });
    });

    socket.on('city:changeSpecialist', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const fromType = Number(data?.fromType);
      const toType = Number(data?.toType);
      const valid =
        Boolean(context) &&
        Object.prototype.hasOwnProperty.call(SPECIALIST_TYPES, fromType) &&
        Object.prototype.hasOwnProperty.call(SPECIALIST_TYPES, toType);
      const success =
        valid &&
        (await context!.game.cityManager.changeSpecialist(
          data.cityId,
          fromType,
          toType,
          context!.player.id
        ));
      if (success) {
        await context!.game.cityManager.saveCity(data.cityId);
        this.gameManager.broadcastCityData(context!.game.id);
      }
      callback({ success, error: success ? undefined : 'Invalid specialist change' });
    });

    socket.on('city:rename', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      const name = typeof data?.name === 'string' ? data.name.trim() : '';
      const success =
        Boolean(context) &&
        name.length > 0 &&
        name.length <= 100 &&
        (await context!.game.cityManager.renameCity(data.cityId, name, context!.player.id));
      if (success) this.gameManager.broadcastCityData(context!.game.id);
      callback({ success, error: success ? undefined : 'Invalid city name' });
    });

    socket.on('city:sellBuilding', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context || typeof data?.buildingId !== 'string') {
        callback({ success: false, error: 'Invalid building sale' });
        return;
      }
      const result = await context.game.cityManager.sellBuildingForPlayer(
        data.cityId,
        data.buildingId,
        context.player.id
      );
      const remainingGold = await context.game.turnManager
        ?.getEconomicManager()
        ?.getPlayerGold(context.player.id);
      if (result.success) this.gameManager.broadcastCityData(context.game.id);
      callback({ ...result, remainingGold, error: result.reason });
    });

    socket.on('city:disband', async (data, callback) => {
      const context = this.resolveLiveCityContext(socket, data?.cityId);
      if (!context) {
        callback({ success: false, error: 'City not found or not owned by player' });
        return;
      }
      const result = await context.game.cityManager.disbandCity(data.cityId, context.player.id);
      if (result.success) this.gameManager.broadcastCityData(context.game.id);
      callback({ success: result.success, error: result.reason });
    });

    socket.on('city:batchManage', async (data, callback) => {
      const requestedCityIds: unknown[] = Array.isArray(data?.cityIds) ? data.cityIds : [];
      const cityIds = [
        ...new Set(requestedCityIds.filter((id: unknown): id is string => typeof id === 'string')),
      ].slice(0, 100);
      if (cityIds.length === 0) {
        callback({ success: false, succeeded: [], failed: [], error: 'Select at least one city' });
        return;
      }

      const context = cityIds
        .map(cityId => this.resolveLiveCityContext(socket, cityId))
        .find(candidate => candidate !== undefined);
      if (!context) {
        callback({
          success: false,
          succeeded: [],
          failed: cityIds.map(cityId => ({ cityId, reason: 'City not found or not owned' })),
        });
        return;
      }

      const ownedCityIds = cityIds.filter(
        cityId => context.game.cityManager.getCity(cityId)?.playerId === context.player.id
      );
      const succeeded: Array<{ cityId: string; detail?: Record<string, unknown> }> = [];
      const failed = cityIds
        .filter(cityId => !ownedCityIds.includes(cityId))
        .map(cityId => ({ cityId, reason: 'City not found or not owned' }));
      const fail = (cityId: string, reason: string) => failed.push({ cityId, reason });
      let treasuryChanged = false;

      try {
        switch (data?.action) {
          case 'production': {
            if (
              typeof data.productionId !== 'string' ||
              !['unit', 'building', 'wonder'].includes(data.productionType)
            ) {
              throw new Error('Invalid production target');
            }
            const productionHandler = new CityProductionHandler(
              context.game.cityManager.getCitiesMap(),
              context.game.players,
              context.game.researchManager,
              context.game.cityManager.setCityProduction.bind(context.game.cityManager),
              context.game.turnManager
                ? new RequirementsManager(context.game.turnManager.getCultureManager())
                : undefined
            );
            for (const cityId of ownedCityIds) {
              try {
                const detail = await productionHandler.applyProductionChange({
                  cityId,
                  playerId: context.player.id,
                  productionId: data.productionId,
                  productionType: data.productionType,
                });
                succeeded.push({ cityId, detail });
              } catch (error) {
                fail(cityId, error instanceof Error ? error.message : 'Production unavailable');
              }
            }
            break;
          }
          case 'optimize': {
            for (const cityId of ownedCityIds) {
              const success = await context.game.cityManager.optimizeCityManually(cityId);
              if (!success) {
                fail(cityId, 'Citizen optimization failed');
                continue;
              }
              context.game.cityManager.refreshCityOutputs(cityId);
              await context.game.cityManager.saveCity(cityId);
              succeeded.push({ cityId });
            }
            break;
          }
          case 'governor': {
            const priorities = new Set(Object.values(GovernorPriority));
            if (!priorities.has(data.config?.priority))
              throw new Error('Invalid governor priority');
            for (const cityId of ownedCityIds) {
              const success = await context.game.cityManager.configureCityGovernor(
                cityId,
                context.player.id,
                {
                  enabled: Boolean(data.config.enabled),
                  priority: data.config.priority,
                  autoManageSpecialists: Boolean(data.config.autoManageSpecialists),
                  autoManageTiles: Boolean(data.config.autoManageTiles),
                  autoManageProduction: Boolean(data.config.autoManageProduction),
                  preventStarvation: Boolean(data.config.preventStarvation),
                  maintainHappiness: Boolean(data.config.maintainHappiness),
                }
              );
              if (success) succeeded.push({ cityId });
              else fail(cityId, 'Governor configuration failed');
            }
            break;
          }
          case 'worklist': {
            const items: ProductionItem[] = Array.isArray(data.items)
              ? data.items.map((item: any) => ({
                  kind: item.type,
                  value: item.productionId,
                }))
              : [];
            if (
              items.length === 0 ||
              !items.every(
                item =>
                  ['unit', 'building', 'wonder'].includes(item.kind) &&
                  typeof item.value === 'string' &&
                  item.value.length > 0
              )
            ) {
              throw new Error('Invalid worklist');
            }
            for (const cityId of ownedCityIds) {
              const city = context.game.cityManager.getCity(cityId);
              const originalWorklist = city ? [...city.worklist] : [];
              if (data.mode === 'replace' && city) city.worklist = [];
              const success = await context.game.cityManager.addToWorklist(
                cityId,
                items,
                context.player.id
              );
              if (success) succeeded.push({ cityId });
              else {
                if (city) city.worklist = originalWorklist;
                fail(cityId, 'One or more worklist items are unavailable');
              }
            }
            break;
          }
          case 'buy': {
            const ordered = [...ownedCityIds].sort(
              (left, right) =>
                context.game.cityManager.calculateBuyCost(left).goldCost -
                context.game.cityManager.calculateBuyCost(right).goldCost
            );
            for (const cityId of ordered) {
              const result = await context.game.cityManager.buyProduction(
                cityId,
                context.player.id
              );
              if (result.success) {
                treasuryChanged = true;
                succeeded.push({ cityId, detail: { goldSpent: result.goldSpent } });
              } else {
                fail(cityId, result.reason ?? 'Production could not be purchased');
              }
            }
            break;
          }
          case 'sellBuilding': {
            if (typeof data.buildingId !== 'string') throw new Error('Invalid building');
            for (const cityId of ownedCityIds) {
              const result = await context.game.cityManager.sellBuildingForPlayer(
                cityId,
                data.buildingId,
                context.player.id
              );
              if (result.success) {
                treasuryChanged = true;
                succeeded.push({ cityId, detail: { goldReceived: result.goldReceived } });
              } else {
                fail(cityId, result.reason ?? 'Building could not be sold');
              }
            }
            break;
          }
          default:
            throw new Error('Unsupported batch action');
        }
      } catch (error) {
        callback({
          success: false,
          succeeded,
          failed,
          error: error instanceof Error ? error.message : 'Batch operation failed',
        });
        return;
      }

      if (succeeded.length > 0) this.gameManager.broadcastCityData(context.game.id);
      const remainingGold = treasuryChanged
        ? await context.game.turnManager?.getEconomicManager()?.getPlayerGold(context.player.id)
        : undefined;
      callback({
        success: failed.length === 0,
        succeeded,
        failed,
        treasury: remainingGold === undefined ? undefined : { after: remainingGold },
      });
    });

    logger.debug(`${this.handlerName} registered handlers for socket ${socket.id}`);
  }

  private resolveLiveCityContext(
    socket: Socket,
    cityId: string
  ):
    | {
        game: NonNullable<ReturnType<GameManager['getGameInstance']>>;
        player: { id: string };
      }
    | undefined {
    const connection = this.getConnection(socket, this.activeConnections);
    if (
      !this.isAuthenticated(connection) ||
      !this.isInGame(connection) ||
      this.isSpectator(connection)
    )
      return undefined;
    const game = this.gameManager.getGameInstance(connection.gameId!);
    if (!game || game.state !== 'active') return undefined;
    const player = Array.from(game.players.values()).find(
      candidate => candidate.userId === connection.userId
    );
    const city = game.cityManager.getCity(cityId);
    if (!player || !city || city.playerId !== player.id) return undefined;
    return { game, player };
  }

  private async handleCityFound(handler: PacketHandler, socket: Socket, data: any): Promise<void> {
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
      await this.handlePostCityFoundingActions(handler, socket, data, connection, player, cityId);
    } catch (error) {
      logger.error('Error founding city:', error);
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to found city',
      });
    }
  }

  private async validateCityProductionChangeRequest(
    handler: PacketHandler,
    socket: Socket,
    connection: any
  ): Promise<{ game: any; player: any } | null> {
    const game = await this.gameManager.getGame(connection.gameId!);
    if (!game || game.status !== 'active') {
      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: false,
        message: `Game is not active (current status: ${game?.status || 'not found'})`,
      });
      return null;
    }

    const player = game.players?.find((p: any) => p.userId === connection.userId) as any;
    if (!player) {
      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: false,
        message: 'Player not found in game',
      });
      return null;
    }

    return { game, player };
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
      const validation = await this.validateCityProductionChangeRequest(
        handler,
        socket,
        connection
      );
      if (!validation) return;

      const { player } = validation;
      const game = this.gameManager.getGameInstance(connection.gameId!);
      const city = game?.cityManager.getCity(data.cityId);
      if (!game || !city) {
        throw new Error('City or game instance not found');
      }
      const productionHandler = new CityProductionHandler(
        game.cityManager.getCitiesMap(),
        game.players,
        game.researchManager,
        game.cityManager.setCityProduction.bind(game.cityManager),
        game.turnManager ? new RequirementsManager(game.turnManager.getCultureManager()) : undefined
      );
      const result = await productionHandler.applyProductionChange({
        cityId: data.cityId,
        playerId: player.id,
        productionId: data.production,
        productionType: data.type,
      });

      handler.send(socket, PacketType.CITY_PRODUCTION_CHANGE_REPLY, {
        success: true,
        ...result,
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
    // First check database game status
    const dbGame = await this.gameManager.getGame(connection.gameId!);
    if (!dbGame || dbGame.status !== 'active') {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: `Game is not active (current status: ${dbGame?.status || 'not found'})`,
      });
      return { game: null, player: null };
    }

    // For active games, use the game instance which has current player state
    const gameInstance = this.gameManager.getGameInstance(connection.gameId!);
    if (!gameInstance) {
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Game instance not found',
      });
      return { game: null, player: null };
    }

    logger.debug('Validating player in game instance', {
      gameId: connection.gameId,
      connectionUserId: connection.userId,
      gamePlayersCount: gameInstance.players.size,
      gamePlayers: Array.from(gameInstance.players.values()).map((p: any) => ({
        id: p.id,
        userId: p.userId,
      })),
    });

    const player = Array.from(gameInstance.players.values()).find(
      (p: any) => p.userId === connection.userId
    ) as any;
    if (!player) {
      logger.debug('Player not found in game instance - detailed info', {
        connectionUserId: connection.userId,
        availablePlayerUserIds: Array.from(gameInstance.players.values()).map((p: any) => p.userId),
      });
      handler.send(socket, PacketType.CITY_FOUND_REPLY, {
        success: false,
        message: 'Player not found in game',
      });
      return { game: null, player: null };
    }

    return { game: dbGame, player };
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

    // Use dynamic unit data to check if unit can found cities (matches ActionSystem approach)
    const unitType = getUnitType(unit.unitTypeId);
    if (!unitType || !unitType.canFoundCity) {
      return {
        isValid: false,
        errorMessage: 'Only settlers can found cities',
      };
    }

    return { isValid: true };
  }

  private async removeSettlerUnit(
    gameId: string,
    unitId: string,
    cityId: string,
    playerId: string
  ): Promise<void> {
    const gameInstance = this.gameManager.getGameInstance(gameId);
    if (!gameInstance) return;

    const unit = gameInstance.unitManager.getUnit(unitId);
    if (!unit) return;

    await gameInstance.unitManager.removeUnit(unitId);
    this.gameManager.broadcastUnitDestroyed(gameId, unit);

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
  private async handlePostCityFoundingActions(
    handler: PacketHandler,
    socket: Socket,
    data: any,
    connection: any,
    player: any,
    cityId: string
  ): Promise<void> {
    // Remove the settler unit if unitId was provided
    if (data.unitId) {
      await this.removeSettlerUnit(connection.gameId!, data.unitId, cityId, player.id);
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
