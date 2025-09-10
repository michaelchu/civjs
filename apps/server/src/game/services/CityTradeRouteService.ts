import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState, TradeRoute, TradeRouteCalculation } from '@game/managers/CityManager';

/**
 * CityTradeRouteService - Manages trade routes between cities
 * @reference docs/refactor/REFACTORING_PLAN.md - CityManager refactoring
 *
 * Handles all trade route operations including:
 * - Trade route establishment and removal
 * - Trade revenue calculations
 * - Trade route cleanup on city destruction
 * - Available trade partner discovery
 */
export class CityTradeRouteService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private MAX_TRADE_ROUTES_PER_CITY: number = 3
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityTradeRouteService';
  }

  /**
   * Calculate squared distance between two cities
   */
  private calculateSquaredDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  }

  /**
   * Calculate trade route value between two cities
   * @reference Original CityManager.calculateTradeRouteValue()
   */
  public calculateTradeRouteValue(
    sourceCity: CityState,
    partnerCity: CityState
  ): TradeRouteCalculation {
    // Base calculation following Freeciv trade route mechanics
    const distance = Math.sqrt(
      this.calculateSquaredDistance(sourceCity.x, sourceCity.y, partnerCity.x, partnerCity.y)
    );

    // Base trade value influenced by partner city size
    const baseValue = partnerCity.population;

    // Distance bonus (longer routes are more valuable)
    const distanceBonus = Math.floor(distance / 10);

    // Size bonus for larger cities
    const sizeBonus = Math.floor(partnerCity.population / 2);

    const totalValue = Math.max(1, baseValue + distanceBonus + sizeBonus);

    return {
      baseTradeValue: baseValue,
      distanceBonus,
      sizeBonus,
      governmentBonus: 0, // Would be calculated based on government type
      totalValue,
    };
  }

  /**
   * Establish a trade route between two cities
   * @reference Original CityManager.establishTradeRoute()
   */
  public async establishTradeRoute(
    sourceCityId: string,
    partnerCityId: string,
    playerId: string
  ): Promise<boolean> {
    const sourceCity = this.cities.get(sourceCityId);
    const partnerCity = this.cities.get(partnerCityId);

    if (!sourceCity || !partnerCity) {
      logger.warn('Cannot establish trade route: city not found', {
        sourceCityId,
        partnerCityId,
      });
      return false;
    }

    // Validate ownership
    if (sourceCity.playerId !== playerId) {
      logger.warn('Cannot establish trade route: source city not owned by player', {
        sourceCityId,
        playerId,
      });
      return false;
    }

    // Cannot trade with same city
    if (sourceCityId === partnerCityId) {
      logger.warn('Cannot establish trade route: cannot trade with same city');
      return false;
    }

    // Check if trade route already exists
    const existingRoute = sourceCity.tradeRoutes?.find(
      route => route.partnerCity === partnerCityId
    );
    if (existingRoute) {
      logger.warn('Cannot establish trade route: route already exists', {
        sourceCityId,
        partnerCityId,
      });
      return false;
    }

    // Check maximum trade routes
    const currentTradeRoutes = sourceCity.tradeRoutes?.length || 0;
    if (currentTradeRoutes >= this.MAX_TRADE_ROUTES_PER_CITY) {
      logger.warn('Cannot establish trade route: maximum routes reached', {
        sourceCityId,
        maxRoutes: this.MAX_TRADE_ROUTES_PER_CITY,
      });
      return false;
    }

    // Calculate trade value
    const calculation = this.calculateTradeRouteValue(sourceCity, partnerCity);

    // Create trade route
    const tradeRoute: TradeRoute = {
      id: `${sourceCityId}-${partnerCityId}`,
      sourceCity: sourceCityId,
      partnerCity: partnerCityId,
      value: calculation.totalValue,
      establishedTurn: 0, // Would be set by turn manager
      distance: Math.sqrt(
        this.calculateSquaredDistance(sourceCity.x, sourceCity.y, partnerCity.x, partnerCity.y)
      ),
      isCaravan: false, // Default to false, would be set based on establishment method
    };

    // Initialize trade routes array if needed
    if (!sourceCity.tradeRoutes) {
      sourceCity.tradeRoutes = [];
    }

    sourceCity.tradeRoutes.push(tradeRoute);

    logger.info('Trade route established', {
      sourceCityId,
      sourceCity: sourceCity.name,
      partnerCityId,
      partnerCity: partnerCity.name,
      revenue: calculation.totalValue,
      distance: Math.floor(tradeRoute.distance ?? 0),
    });

    return true;
  }

  /**
   * Get total trade route revenue for a city
   * @reference Original CityManager.getCityTradeRouteRevenue()
   */
  public getCityTradeRouteRevenue(cityId: string): number {
    const city = this.cities.get(cityId);
    if (!city || !city.tradeRoutes) {
      return 0;
    }

    return city.tradeRoutes.reduce((total, route) => total + route.value, 0);
  }

  /**
   * Remove a trade route
   * @reference Original CityManager.removeTradeRoute()
   */
  public async removeTradeRoute(sourceCityId: string, partnerCityId: string): Promise<boolean> {
    const sourceCity = this.cities.get(sourceCityId);
    if (!sourceCity || !sourceCity.tradeRoutes) {
      return false;
    }

    const routeIndex = sourceCity.tradeRoutes.findIndex(
      route => route.partnerCity === partnerCityId
    );
    if (routeIndex === -1) {
      return false;
    }

    const removedRoute = sourceCity.tradeRoutes.splice(routeIndex, 1)[0];

    logger.info('Trade route removed', {
      sourceCityId,
      partnerCityId,
      revenue: removedRoute.value,
    });

    return true;
  }

  /**
   * Update trade routes when a city is destroyed
   * @reference Original CityManager.updateTradeRoutesOnCityDestruction()
   */
  public async updateTradeRoutesOnCityDestruction(destroyedCityId: string): Promise<void> {
    // Remove all trade routes TO the destroyed city
    for (const [cityId, city] of this.cities) {
      if (!city.tradeRoutes) continue;

      const initialLength = city.tradeRoutes.length;
      city.tradeRoutes = city.tradeRoutes.filter(route => route.partnerCity !== destroyedCityId);

      if (city.tradeRoutes.length < initialLength) {
        logger.info('Removed trade routes to destroyed city', {
          cityId,
          cityName: city.name,
          destroyedCityId,
          routesRemoved: initialLength - city.tradeRoutes.length,
        });
      }
    }
  }

  /**
   * Get available trade partners for a city
   * @reference Original CityManager.getAvailableTradePartners()
   */
  public getAvailableTradePartners(cityId: string): CityState[] {
    const sourceCity = this.cities.get(cityId);
    if (!sourceCity) {
      return [];
    }

    const availablePartners: CityState[] = [];
    const existingPartners = new Set(
      (sourceCity.tradeRoutes || []).map(route => route.partnerCity)
    );

    for (const [partnerId, partnerCity] of this.cities) {
      // Skip self
      if (partnerId === cityId) continue;

      // Skip if already trading
      if (existingPartners.has(partnerId)) continue;

      // Skip if owned by same player (in basic implementation)
      if (partnerCity.playerId === sourceCity.playerId) continue;

      availablePartners.push(partnerCity);
    }

    // Sort by potential trade value (descending)
    availablePartners.sort((a, b) => {
      const valueA = this.calculateTradeRouteValue(sourceCity, a).totalValue;
      const valueB = this.calculateTradeRouteValue(sourceCity, b).totalValue;
      return valueB - valueA;
    });

    return availablePartners;
  }

  /**
   * Update trade routes when a city changes ownership
   * @reference Original CityManager.updateTradeRoutesOnPlayerChange()
   */
  public async updateTradeRoutesOnPlayerChange(
    cityId: string,
    newPlayerId: string,
    _oldPlayerId: string
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) return;

    // In a basic implementation, remove all existing trade routes
    // In a full implementation, some routes might be maintained
    if (city.tradeRoutes && city.tradeRoutes.length > 0) {
      const routeCount = city.tradeRoutes.length;
      city.tradeRoutes = [];

      logger.info('Cleared trade routes due to city ownership change', {
        cityId,
        newPlayerId,
        routesCleared: routeCount,
      });
    }

    // Also remove any routes TO this city from other cities
    for (const [otherCityId, otherCity] of this.cities) {
      if (otherCityId === cityId) continue;

      if (otherCity.tradeRoutes) {
        const initialLength = otherCity.tradeRoutes.length;
        otherCity.tradeRoutes = otherCity.tradeRoutes.filter(route => route.partnerCity !== cityId);

        if (otherCity.tradeRoutes.length < initialLength) {
          logger.info('Removed trade routes to city that changed ownership', {
            cityId: otherCityId,
            targetCityId: cityId,
            newPlayerId,
          });
        }
      }
    }
  }

  /**
   * Get trade route information for a city
   */
  public getCityTradeRoutes(cityId: string): TradeRoute[] {
    const city = this.cities.get(cityId);
    return city?.tradeRoutes || [];
  }

  /**
   * Get total number of trade routes for a city
   */
  public getCityTradeRouteCount(cityId: string): number {
    const city = this.cities.get(cityId);
    return city?.tradeRoutes?.length || 0;
  }

  /**
   * Check if a city can establish more trade routes
   */
  public canEstablishMoreTradeRoutes(cityId: string): boolean {
    return this.getCityTradeRouteCount(cityId) < this.MAX_TRADE_ROUTES_PER_CITY;
  }
}
