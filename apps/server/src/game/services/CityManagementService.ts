import { GameInstance } from '@game/managers/GameManager';
import { BaseGameService } from '@game/orchestrators/GameService';
import { logger } from '@utils/logger';

/**
 * CityManagementService - Extracted city operations from GameManager
 * @reference docs/refactor/REFACTORING_PLAN.md - Phase 1 GameManager refactoring
 *
 * Handles all city-related operations including:
 * - City founding with validation and broadcasting
 * - City production management
 * - City queries and ownership validation
 * - City-related broadcasting coordination
 */
export class CityManagementService extends BaseGameService {
  constructor(
    private games: Map<string, GameInstance>,
    private broadcastToGame: (gameId: string, event: string, data: any) => void
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

    const cityId = await gameInstance.cityManager.foundCity(
      playerId,
      name,
      x,
      y,
      gameInstance.currentTurn,
      unit
    );

    // Broadcast city founding to all players
    this.broadcastToGame(gameId, 'city_founded', {
      gameId,
      city: {
        id: cityId,
        playerId,
        name,
        x,
        y,
        population: 1,
      },
    });

    return cityId;
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

    await gameInstance.cityManager.setCityProduction(cityId, production, type);

    // Broadcast production change to all players
    this.broadcastToGame(gameId, 'city_production_changed', {
      gameId,
      cityId,
      production,
      type,
    });
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
}
