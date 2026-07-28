import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState, TradeRoute, TradeRouteCalculation } from '@game/managers/CityManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { TradeRules } from '@shared/data/rulesets/schemas';

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
  private playerTechsProvider: (playerId: string) => ReadonlySet<string> = () => new Set();

  constructor(
    private cities: Map<string, CityState>,
    private MAX_TRADE_ROUTES_PER_CITY: number = 2,
    private readonly mapContext: {
      width: number;
      height: number;
      getContinentId: (x: number, y: number) => number | undefined;
      getCurrentTurn: () => number;
      getRealDistance?: (x1: number, y1: number, x2: number, y2: number) => number;
      getMapDistance?: (x1: number, y1: number, x2: number, y2: number) => number;
    } = {
      width: 80,
      height: 50,
      getContinentId: () => undefined,
      getCurrentTurn: () => 0,
    },
    private readonly effectsManager: EffectsManager = new EffectsManager(),
    private readonly tradeRules: TradeRules = rulesetLoader.getTradeRules()
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityTradeRouteService';
  }

  setPlayerTechsProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.playerTechsProvider = provider;
  }

  private getMaxTradeRoutes(city: CityState): number {
    const techs = this.playerTechsProvider(city.playerId);
    const configured = this.effectsManager.calculateEffect(EffectType.MAX_TRADE_ROUTES, {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
      playerTechs: new Set(techs),
    }).value;
    return Math.max(0, configured || this.MAX_TRADE_ROUTES_PER_CITY);
  }

  /**
   * Calculate trade route value between two cities
   * @reference Original CityManager.calculateTradeRouteValue()
   */
  public calculateTradeRouteValue(
    sourceCity: CityState,
    partnerCity: CityState,
    relation: string = 'no_contact'
  ): TradeRouteCalculation {
    // Classic revenue uses real (Chebyshev) distance, with half of the
    // distance normalized to a 40-tile-wide world by the default setting.
    // @reference reference/freeciv/common/traderoutes.c:332-363
    const distance =
      this.mapContext.getRealDistance?.(sourceCity.x, sourceCity.y, partnerCity.x, partnerCity.y) ??
      Math.max(Math.abs(sourceCity.x - partnerCity.x), Math.abs(sourceCity.y - partnerCity.y));
    const relativeDistance = Math.floor(
      (distance * 40) / Math.max(this.mapContext.width, this.mapContext.height)
    );
    const weightedDistance = Math.floor((50 * distance + 50 * relativeDistance) / 100);
    const sourceContinent = this.mapContext.getContinentId(sourceCity.x, sourceCity.y);
    const partnerContinent = this.mapContext.getContinentId(partnerCity.x, partnerCity.y);
    const intercontinental =
      sourceContinent !== undefined &&
      partnerContinent !== undefined &&
      sourceContinent !== partnerContinent;
    const routeType = this.getRouteType(sourceCity, partnerCity, relation, intercontinental);
    const tradePercent =
      this.tradeRules.settings.find(setting => setting.type === routeType)?.pct ?? 0;
    const sizeValue = sourceCity.population + partnerCity.population;
    const beforeTypeBonus = weightedDistance + sizeValue;
    const totalValue = Math.max(
      this.tradeRules.min_trade_route_val,
      Math.floor(Math.floor((beforeTypeBonus * tradePercent) / 100) / 12)
    );

    return {
      baseTradeValue: sizeValue,
      distanceBonus: weightedDistance,
      sizeBonus: 0,
      governmentBonus: tradePercent - 100,
      totalValue,
    };
  }

  public calculateTradeSettlement(
    sourceCity: CityState,
    partnerCity: CityState,
    relation: string = 'no_contact'
  ): {
    routeType: string;
    bonusType: 'None' | 'Gold' | 'Science' | 'Both';
    bonus: number;
    goods: string;
  } {
    const distance = this.getMapDistance(sourceCity, partnerCity);
    const relativeDistance = Math.floor(
      (distance * 40) / Math.max(this.mapContext.width, this.mapContext.height)
    );
    const weightedDistance = Math.floor((50 * distance + 50 * relativeDistance) / 100);
    const sourceContinent = this.mapContext.getContinentId(sourceCity.x, sourceCity.y);
    const partnerContinent = this.mapContext.getContinentId(partnerCity.x, partnerCity.y);
    const routeType = this.getRouteType(
      sourceCity,
      partnerCity,
      relation,
      sourceContinent !== undefined &&
        partnerContinent !== undefined &&
        sourceContinent !== partnerContinent
    );
    const setting = this.tradeRules.settings.find(candidate => candidate.type === routeType);
    return {
      routeType,
      bonusType: setting?.bonus ?? 'None',
      bonus: Math.ceil(
        ((weightedDistance + 10) *
          ((sourceCity.tradePerTurn ?? 0) + (partnerCity.tradePerTurn ?? 0))) /
          24
      ),
      goods: Object.keys(rulesetLoader.loadGameRulesRuleset().goods)[0] ?? 'good',
    };
  }

  private getRouteType(
    sourceCity: CityState,
    partnerCity: CityState,
    relation: string,
    intercontinental: boolean
  ): string {
    const suffix = intercontinental ? 'IC' : '';
    if (sourceCity.playerId === partnerCity.playerId) return `National${suffix}`;
    if (relation === 'alliance') return `Ally${suffix}`;
    if (relation === 'team') return `Team${suffix}`;
    if (relation === 'war') return `Enemy${suffix}`;
    return `IN${suffix}`;
  }

  /**
   * Establish a trade route between two cities
   * @reference Original CityManager.establishTradeRoute()
   */
  public async establishTradeRoute(
    sourceCityId: string,
    partnerCityId: string,
    playerId: string,
    relation: string = 'no_contact'
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
    const mapDistance = this.getMapDistance(sourceCity, partnerCity);
    if (sourceCity.playerId === partnerCity.playerId && mapDistance < 9) {
      logger.warn('Cannot establish domestic trade route below trademindist', {
        sourceCityId,
        partnerCityId,
        mapDistance,
      });
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

    // Calculate trade value
    const calculation = this.calculateTradeRouteValue(sourceCity, partnerCity, relation);
    const settlement = this.calculateTradeSettlement(sourceCity, partnerCity, relation);
    if (
      !this.canMakeRoomForRoute(sourceCity, calculation.totalValue) ||
      !this.canMakeRoomForRoute(partnerCity, calculation.totalValue)
    ) {
      return false;
    }
    this.makeRoomForRoute(sourceCity);
    this.makeRoomForRoute(partnerCity);

    // Create trade route
    const tradeRoute: TradeRoute = {
      id: `${sourceCityId}-${partnerCityId}`,
      sourceCity: sourceCityId,
      partnerCity: partnerCityId,
      value: calculation.totalValue,
      establishedTurn: this.mapContext.getCurrentTurn(),
      distance: this.getRealDistance(sourceCity, partnerCity),
      isCaravan: true,
      routeType: settlement.routeType,
      goods: settlement.goods,
    };

    // Initialize trade routes array if needed
    if (!sourceCity.tradeRoutes) {
      sourceCity.tradeRoutes = [];
    }

    sourceCity.tradeRoutes.push(tradeRoute);
    partnerCity.tradeRoutes ??= [];
    partnerCity.tradeRoutes.push({
      ...tradeRoute,
      id: `${partnerCityId}-${sourceCityId}`,
      sourceCity: partnerCityId,
      partnerCity: sourceCityId,
    });

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

  private canMakeRoomForRoute(city: CityState, newValue: number): boolean {
    city.tradeRoutes ??= [];
    if (city.tradeRoutes.length < this.getMaxTradeRoutes(city)) return true;
    const weakest = city.tradeRoutes.reduce((candidate, route) =>
      route.value < candidate.value ? route : candidate
    );
    return weakest.value < newValue;
  }

  private makeRoomForRoute(city: CityState): void {
    if (city.tradeRoutes.length < this.getMaxTradeRoutes(city)) return;
    const weakest = city.tradeRoutes.reduce((candidate, route) =>
      route.value < candidate.value ? route : candidate
    );
    city.tradeRoutes.splice(city.tradeRoutes.indexOf(weakest), 1);
    const formerPartner = this.cities.get(weakest.partnerCity);
    if (formerPartner) {
      formerPartner.tradeRoutes = formerPartner.tradeRoutes.filter(
        route => route.partnerCity !== city.id
      );
    }
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
    const partner = this.cities.get(partnerCityId);
    if (partner) {
      partner.tradeRoutes = partner.tradeRoutes.filter(route => route.partnerCity !== sourceCityId);
    }

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
   * Recalculate both sides after a city changes owner. International and
   * intercontinental multipliers are properties of the live city pair, not
   * values frozen when the caravan arrived.
   * @reference reference/freeciv/server/citytools.c:953-1009
   */
  public async updateRoutesOnPlayerChange(
    cityId: string,
    relationProvider: (playerId: string, otherPlayerId: string) => Promise<string>
  ): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) return;

    for (const route of [...(city.tradeRoutes ?? [])]) {
      const partner = this.cities.get(route.partnerCity);
      if (!partner) continue;
      const relation =
        city.playerId === partner.playerId
          ? 'domestic'
          : await relationProvider(city.playerId, partner.playerId);
      const settlement = this.calculateTradeSettlement(city, partner, relation);
      if (this.shouldCancelRoute(route.routeType, settlement.routeType)) {
        await this.removeTradeRoute(city.id, partner.id);
        continue;
      }
      const value = this.calculateTradeRouteValue(city, partner, relation).totalValue;
      route.value = value;
      const reciprocal = (partner.tradeRoutes ?? []).find(
        candidate => candidate.partnerCity === cityId
      );
      if (reciprocal) reciprocal.value = value;
    }
  }

  public updateRoutesForDiplomacy(
    firstPlayerId: string,
    secondPlayerId: string,
    relation: string
  ): void {
    for (const city of this.cities.values()) {
      for (const route of [...(city.tradeRoutes ?? [])]) {
        const partner = this.cities.get(route.partnerCity);
        if (
          !partner ||
          !(
            (city.playerId === firstPlayerId && partner.playerId === secondPlayerId) ||
            (city.playerId === secondPlayerId && partner.playerId === firstPlayerId)
          )
        ) {
          continue;
        }
        const nextType = this.calculateTradeSettlement(city, partner, relation).routeType;
        if (this.shouldCancelRoute(route.routeType, nextType)) {
          city.tradeRoutes = city.tradeRoutes.filter(
            candidate => candidate.partnerCity !== partner.id
          );
          partner.tradeRoutes = partner.tradeRoutes.filter(
            candidate => candidate.partnerCity !== city.id
          );
        }
      }
    }
  }

  private shouldCancelRoute(previousType: string | undefined, nextType: string): boolean {
    if (!previousType || previousType === nextType) return false;
    return (
      this.tradeRules.settings.find(setting => setting.type === previousType)?.cancelling ===
      'Cancel'
    );
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

      const distance = this.getMapDistance(sourceCity, partnerCity);
      if (partnerCity.playerId === sourceCity.playerId && distance < 9) continue;

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

  private getRealDistance(sourceCity: CityState, partnerCity: CityState): number {
    return (
      this.mapContext.getRealDistance?.(sourceCity.x, sourceCity.y, partnerCity.x, partnerCity.y) ??
      Math.max(Math.abs(sourceCity.x - partnerCity.x), Math.abs(sourceCity.y - partnerCity.y))
    );
  }

  private getMapDistance(sourceCity: CityState, partnerCity: CityState): number {
    return (
      this.mapContext.getMapDistance?.(sourceCity.x, sourceCity.y, partnerCity.x, partnerCity.y) ??
      Math.abs(sourceCity.x - partnerCity.x) + Math.abs(sourceCity.y - partnerCity.y)
    );
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
