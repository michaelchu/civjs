import { GameInstance } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { CityDataService } from '@game/services/CityDataService';
import { logger } from '@utils/logger';
import type { CityState } from '@game/managers/CityManager';
import { getUniqueCityName } from '@game/constants/CityNames';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

/**
 * CityManagementService - High-level city operations service
 * Handles all high-level city-related operations including:
 * - City founding with validation and broadcasting
 * - City production management
 * - City queries and ownership validation
 * - City-related broadcasting coordination
 * - City buying/selling operations
 * - City specialist and tile management coordination
 * - City automation and governor coordination
 * - City capture and transfer operations
 */
export class CityManagementService extends BaseGameService {
  constructor(
    private games: Map<string, GameInstance>,
    private broadcastToGame: (gameId: string, event: string, data: any) => void,
    private broadcastVisibilityState?: (gameId: string) => void
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityManagementService';
  }

  /**
   * Found a new city for a player with comprehensive Freeciv-based validation
   * @reference Original GameManager.foundCity()
   * @reference freeciv/common/city.c:1487-1551 city_can_be_built_here()
   */
  public async foundCity(
    gameId: string,
    playerId: string,
    name: string,
    x: number,
    y: number,
    unit?: any
  ): Promise<string> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    if (gameInstance.state !== 'active') {
      throw new Error('Cannot found cities unless game is active');
    }

    const player = gameInstance.players.get(playerId);
    if (!player) {
      throw new Error('Player not found in game');
    }

    // Check if there's already a city at this position
    const existingCity = gameInstance.cityManager.getCityAt(x, y);
    if (existingCity) {
      throw new Error('There is already a city at this location');
    }

    const uniqueName = getUniqueCityName(
      gameInstance.cityManager.getAllCities().map(city => city.name),
      name
    );
    const unitId = typeof unit === 'string' ? unit : unit?.id;
    const cityData = await gameInstance.cityManager.foundCity(x, y, uniqueName, playerId, unitId);

    if (!cityData) {
      throw new Error('Failed to found city');
    }

    // City founding changes both vision and the remembered playermap. Send
    // player-scoped snapshots rather than leaking the new city game-wide.
    this.broadcastVisibilityState?.(gameId);

    return cityData.id;
  }

  /**
   * Set city production type and target
   * @reference Original GameManager.setCityProduction()
   */
  public async setCityProduction(
    gameId: string,
    playerId: string,
    cityId: string,
    production: string,
    type: 'unit' | 'building'
  ): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    await gameInstance.cityManager.setCityProduction(cityId, type, production, playerId);

    // Get updated city data and broadcast to all players
    const cityData = gameInstance.cityManager.getCity(cityId);
    if (cityData) {
      const clientCityData = CityDataService.transformCityForClient(
        cityData,
        gameInstance.config?.ruleset ?? DEFAULT_RULESET,
        undefined,
        undefined,
        gameInstance.unitManager.getAllUnits?.().values() ?? []
      );
      this.broadcastToGame(gameId, 'city_production_changed', {
        gameId,
        city: clientCityData,
        production,
        type,
      });
    }
  }

  /**
   * Get all cities owned by a player
   * @reference Original GameManager.getPlayerCities()
   */
  public getPlayerCities(gameId: string, playerId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.cityManager.getPlayerCities(playerId);
  }

  /**
   * Get a specific city by ID
   * @reference Original GameManager.getCity()
   */
  public getCity(gameId: string, cityId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.cityManager.getCity(cityId);
  }

  /**
   * Buy/rush production in a city
   */
  public async buyProduction(
    gameId: string,
    playerId: string,
    cityId: string
  ): Promise<{
    success: boolean;
    goldSpent: number;
    completed: boolean;
    reason?: string;
  }> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    // Delegate to CityManager's production service (would be refactored)
    const result = await gameInstance.cityManager.buyProduction(cityId, playerId);

    if (result.success) {
      // Broadcast production purchase to all players
      this.broadcastToGame(gameId, 'city_production_bought', {
        gameId,
        cityId,
        playerId,
        goldSpent: result.goldSpent,
        production: city.currentProduction,
        productionType: city.productionType,
      });
    }

    return result;
  }

  /**
   * Assign citizen to work a specific tile
   */
  public async assignCitizenToTile(
    gameId: string,
    playerId: string,
    cityId: string,
    tileX: number,
    tileY: number
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    const success = await gameInstance.cityManager.assignCitizenToTile(cityId, tileX, tileY);

    if (success) {
      // Broadcast tile assignment change
      this.broadcastToGame(gameId, 'city_tile_assigned', {
        gameId,
        cityId,
        playerId,
        tileX,
        tileY,
      });
    }

    return success;
  }

  /**
   * Change specialist type in a city
   */
  public async changeSpecialist(
    gameId: string,
    playerId: string,
    cityId: string,
    fromSpecialist: number,
    toSpecialist: number
  ): Promise<void> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    await gameInstance.cityManager.changeSpecialist(cityId, fromSpecialist, toSpecialist, playerId);

    // Broadcast specialist change
    this.broadcastToGame(gameId, 'city_specialist_changed', {
      gameId,
      cityId,
      playerId,
      fromSpecialist,
      toSpecialist,
    });
  }

  /**
   * Configure city governor automation
   */
  public async configureCityGovernor(
    gameId: string,
    playerId: string,
    cityId: string,
    config: {
      enabled: boolean;
      priority: number;
      preventStarvation: boolean;
      maintainHappiness: boolean;
      autoSelectProduction: boolean;
    }
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    const success = await gameInstance.cityManager.configureCityGovernor(cityId, playerId, {
      enabled: config.enabled,
      priority: config.priority as any, // Cast to GovernorPriority
      autoManageSpecialists: config.autoSelectProduction,
      autoManageTiles: true,
      autoManageProduction: config.autoSelectProduction,
      preventStarvation: config.preventStarvation,
      maintainHappiness: config.maintainHappiness,
    });

    if (success) {
      // Broadcast governor configuration change
      this.broadcastToGame(gameId, 'city_governor_configured', {
        gameId,
        cityId,
        playerId,
        config,
      });
    }

    return success;
  }

  /**
   * Establish trade route between cities
   */
  public async establishTradeRoute(
    gameId: string,
    playerId: string,
    sourceCityId: string,
    partnerCityId: string
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const sourceCity = gameInstance.cityManager.getCity(sourceCityId);
    if (!sourceCity) {
      throw new Error('Source city not found');
    }

    if (sourceCity.playerId !== playerId) {
      throw new Error('Source city does not belong to player');
    }

    const success = await gameInstance.cityManager.establishTradeRoute(
      sourceCityId,
      partnerCityId,
      playerId
    );

    if (success) {
      // Broadcast trade route establishment
      this.broadcastToGame(gameId, 'trade_route_established', {
        gameId,
        sourceCityId,
        partnerCityId,
        playerId,
      });
    }

    return success;
  }

  /**
   * Capture an enemy city
   */
  public async captureCity(
    gameId: string,
    conquerorPlayerId: string,
    cityId: string,
    conquerorUnitId: string
  ): Promise<{
    success: boolean;
    populationLoss: number;
    buildingsDestroyed: string[];
    cityDestroyed?: boolean;
    reason?: string;
  }> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const result = await gameInstance.cityManager.captureCity(
      cityId,
      conquerorPlayerId,
      conquerorUnitId
    );

    if (result.success) {
      // Broadcast city capture to all players
      this.broadcastToGame(gameId, 'city_captured', {
        gameId,
        cityId,
        conquerorPlayerId,
        populationLoss: result.populationLoss,
        buildingsDestroyed: result.buildingsDestroyed,
        cityDestroyed: result.cityDestroyed ?? false,
      });
    }

    return result;
  }

  /**
   * Sell a building in a city
   */
  public async sellBuilding(
    gameId: string,
    playerId: string,
    cityId: string,
    buildingId: string
  ): Promise<boolean> {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    const city = gameInstance.cityManager.getCity(cityId);
    if (!city) {
      throw new Error('City not found');
    }

    if (city.playerId !== playerId) {
      throw new Error('City does not belong to player');
    }

    const success = await gameInstance.cityManager.sellBuilding(cityId, buildingId);

    if (success) {
      // Broadcast building sale
      this.broadcastToGame(gameId, 'city_building_sold', {
        gameId,
        cityId,
        playerId,
        buildingId,
      });
    }

    return success;
  }

  /**
   * Get city's workable tiles
   */
  public getWorkableTiles(gameId: string, cityId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    return gameInstance.cityManager.getWorkableTiles(cityId);
  }

  /**
   * Get city's trade routes
   */
  public getCityTradeRoutes(gameId: string, cityId: string) {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      throw new Error('Game not found');
    }

    // Delegate to trade route service through CityManager
    const tradeRouteService = gameInstance.cityManager.getTradeRouteService();
    return tradeRouteService ? tradeRouteService.getCityTradeRoutes(cityId) : [];
  }

  /**
   * Get cities that are unhappy
   */
  public getUnhappyCities(gameId: string, playerId: string): CityState[] {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      return [];
    }

    const playerCities = gameInstance.cityManager.getPlayerCities(playerId);
    return playerCities.filter(city => gameInstance.cityManager.isCityUnhappy(city.id));
  }

  /**
   * Get cities that are starving
   */
  public getStarvingCities(gameId: string, playerId: string): CityState[] {
    const gameInstance = this.games.get(gameId);
    if (!gameInstance) {
      return [];
    }

    const playerCities = gameInstance.cityManager.getPlayerCities(playerId);
    return playerCities.filter(city => (city.foodPerTurn || 0) < 0);
  }
}
