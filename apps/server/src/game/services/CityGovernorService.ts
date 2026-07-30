import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import {
  CityState,
  CityGovernor,
  GovernorPriority,
  WorkableTile,
  SpecialistType,
} from '@game/managers/CityManager';

/**
 * CityGovernorService - Manages automated city governance and optimization
 * Handles all city automation operations including:
 * - Governor configuration and automation
 * - Starvation prevention
 * - Happiness optimization
 * - Specialist management
 * - Tile assignment optimization
 * - Production selection
 */
export class CityGovernorService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private changeSpecialist: (
      cityId: string,
      from: SpecialistType,
      to: SpecialistType,
      playerId: string
    ) => Promise<boolean>,
    private assignCitizenToTile: (cityId: string, tileX: number, tileY: number) => Promise<boolean>,
    _convertTileWorkerToSpecialist: (
      cityId: string,
      tileX: number,
      tileY: number,
      specialistType: SpecialistType
    ) => Promise<boolean> // Mark as unused with underscore
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityGovernorService';
  }

  /**
   * Configure city governor settings
   * @reference Original CityManager.configureCityGovernor()
   */
  public async configureCityGovernor(
    cityId: string,
    playerId: string,
    config: {
      enabled: boolean;
      priority: GovernorPriority;
      autoManageSpecialists: boolean;
      autoManageTiles: boolean;
      autoManageProduction: boolean;
      preventStarvation: boolean;
      maintainHappiness: boolean;
    }
  ): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    if (city.playerId !== playerId) {
      return false;
    }

    // Initialize governor if not exists
    if (!city.governor) {
      city.governor = {
        isEnabled: false,
        priority: GovernorPriority.BALANCED,
        settings: {
          autoManageSpecialists: false,
          autoManageTiles: false,
          autoManageProduction: false,
          preventStarvation: true,
          maintainHappiness: true,
        },
      };
    }

    // Update governor configuration
    city.governor.isEnabled = config.enabled;
    city.governor.priority = config.priority;
    city.governor.settings.autoManageSpecialists = config.autoManageSpecialists;
    city.governor.settings.autoManageTiles = config.autoManageTiles;
    city.governor.settings.autoManageProduction = config.autoManageProduction;
    city.governor.settings.preventStarvation = config.preventStarvation;
    city.governor.settings.maintainHappiness = config.maintainHappiness;

    logger.info('City governor configured', {
      cityId,
      cityName: city.name,
      config,
    });

    return true;
  }

  /**
   * Apply governor automation to a city
   * @reference Original CityManager.applyGovernorAutomation()
   */
  public async applyGovernorAutomation(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || !city.governor || !city.governor.isEnabled) {
      return;
    }

    logger.debug('Applying governor automation', {
      cityId,
      cityName: city.name,
      priority: city.governor.priority,
    });

    try {
      await this.runGovernorSteps(cityId, city.governor);

      logger.debug('Governor automation completed', { cityId, cityName: city.name });
    } catch (error) {
      logger.error('Governor automation failed', {
        cityId,
        cityName: city.name,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  private async runGovernorSteps(cityId: string, governor: any): Promise<void> {
    if (governor.settings.preventStarvation) await this.preventCityStarvation(cityId);
    if (governor.settings.maintainHappiness) await this.optimizeCityHappiness(cityId);
    if (governor.settings.autoManageSpecialists)
      await this.optimizeCitySpecialists(cityId, governor.priority);
    if (governor.settings.autoManageTiles) await this.optimizeCityTiles(cityId, governor.priority);
    if (governor.settings.autoManageProduction)
      await this.selectOptimalProduction(cityId, governor.priority);
  }

  /**
   * Prevent city from starving by adjusting specialists/tiles
   * @reference Original CityManager.preventCityStarvation()
   */
  private async preventCityStarvation(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || (city.foodPerTurn ?? 0) >= 0) {
      return; // Not starving
    }

    logger.info('Preventing city starvation', {
      cityId,
      cityName: city.name,
      foodPerTurn: city.foodPerTurn,
    });

    // Try converting non-food specialists to workers or food-producing specialists
    const nonFoodSpecialists = [
      SpecialistType.SCIENTIST,
      SpecialistType.TAX_COLLECTOR,
      SpecialistType.ENTERTAINER,
      SpecialistType.ENGINEER,
      SpecialistType.MERCHANT,
    ];

    for (const specialistType of nonFoodSpecialists) {
      if (city.specialists[specialistType] > 0 && (city.foodPerTurn ?? 0) < 0) {
        await this.changeSpecialist(cityId, specialistType, SpecialistType.WORKER, city.playerId);
        logger.debug('Converted specialist to worker for food', {
          cityId,
          from: specialistType,
          to: SpecialistType.WORKER,
        });
      }
    }
  }

  /**
   * Optimize city happiness by adjusting specialists
   * @reference Original CityManager.optimizeCityHappiness()
   */
  private async optimizeCityHappiness(cityId: string): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || city.happiness.unhappy === 0) {
      return; // City is not unhappy
    }

    logger.info('Optimizing city happiness', {
      cityId,
      cityName: city.name,
      unhappy: city.happiness.unhappy,
    });

    // Convert other specialists to entertainers to increase luxury
    const nonLuxurySpecialists = [
      SpecialistType.SCIENTIST,
      SpecialistType.TAX_COLLECTOR,
      SpecialistType.WORKER,
      SpecialistType.ENGINEER,
      SpecialistType.MERCHANT,
    ];

    for (const specialistType of nonLuxurySpecialists) {
      if (city.specialists[specialistType] > 0 && city.happiness.unhappy > 0) {
        await this.changeSpecialist(
          cityId,
          specialistType,
          SpecialistType.ENTERTAINER,
          city.playerId
        );
        logger.debug('Converted specialist to entertainer for happiness', {
          cityId,
          from: specialistType,
          to: SpecialistType.ENTERTAINER,
        });
      }
    }
  }

  /**
   * Optimize city specialists based on priority
   * @reference Original CityManager.optimizeCitySpecialists()
   */
  private async optimizeCitySpecialists(cityId: string, priority: GovernorPriority): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city) return;

    // Define specialist priorities for each governor priority
    const specialistPriorities: Record<GovernorPriority, SpecialistType[]> = {
      [GovernorPriority.FOOD]: [SpecialistType.WORKER], // Food for growth
      [GovernorPriority.SHIELDS]: [SpecialistType.ENGINEER], // Shields for production
      [GovernorPriority.SCIENCE]: [SpecialistType.SCIENTIST], // Science for research
      [GovernorPriority.GOLD]: [SpecialistType.TAX_COLLECTOR, SpecialistType.MERCHANT], // Gold generation
      [GovernorPriority.TRADE]: [SpecialistType.MERCHANT], // Trade focus
      [GovernorPriority.LUXURY]: [SpecialistType.ENTERTAINER], // Happiness focus
      [GovernorPriority.BALANCED]: [
        SpecialistType.SCIENTIST,
        SpecialistType.TAX_COLLECTOR,
        SpecialistType.WORKER,
      ], // Balanced approach
    };

    const preferredSpecialists = specialistPriorities[priority] || [];
    if (preferredSpecialists.length === 0) return;

    // Count total specialists
    const totalSpecialists = Object.values(city.specialists).reduce((sum, count) => sum + count, 0);
    if (totalSpecialists === 0) return;

    // Try to convert less preferred specialists to more preferred ones
    const allSpecialistTypes = Object.keys(city.specialists).map(Number) as SpecialistType[];

    for (const currentType of allSpecialistTypes) {
      if (city.specialists[currentType] > 0 && !preferredSpecialists.includes(currentType)) {
        const preferredType = preferredSpecialists[0]; // Use first preferred specialist

        await this.changeSpecialist(cityId, currentType, preferredType, city.playerId);
        logger.debug('Optimized specialist assignment', {
          cityId,
          priority,
          from: currentType,
          to: preferredType,
        });
      }
    }
  }

  /**
   * Optimize city tile assignments based on priority
   * @reference Original CityManager.optimizeCityTiles()
   */
  private async optimizeCityTiles(cityId: string, priority: GovernorPriority): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || !city.workableTiles) return;

    // Get all workable but unworked tiles
    const availableTiles = city.workableTiles.filter(
      tile => !tile.isWorked && !tile.isBlocked && !tile.isCenter
    );

    if (availableTiles.length === 0) return;

    // Sort tiles by priority value
    availableTiles.sort(
      (a, b) =>
        this.evaluateTileForPriority(b, priority) - this.evaluateTileForPriority(a, priority)
    );

    // Get currently worked tiles (excluding city center)
    const workedTiles = city.workableTiles.filter(tile => tile.isWorked && !tile.isCenter);

    // Calculate how many workers we can assign
    const totalSpecialists = Object.values(city.specialists).reduce((sum, count) => sum + count, 0);
    const maxWorkers = city.population - totalSpecialists;
    const availableWorkerSlots = Math.max(0, maxWorkers - workedTiles.length);

    // Assign workers to best available tiles
    let assigned = 0;
    for (const tile of availableTiles) {
      if (assigned >= availableWorkerSlots) break;

      const success = await this.assignCitizenToTile(cityId, tile.x, tile.y);
      if (success) {
        assigned++;
        logger.debug('Assigned citizen to optimal tile', {
          cityId,
          tileX: tile.x,
          tileY: tile.y,
          priority,
          value: this.evaluateTileForPriority(tile, priority),
        });
      }
    }

    // Also consider reassigning workers from suboptimal tiles to better ones
    // This would involve more complex logic to avoid thrashing
  }

  /**
   * Evaluate a tile's value for a specific priority
   * @reference Original CityManager.evaluateTileForPriority()
   */
  private evaluateTileForPriority(tile: WorkableTile, priority: GovernorPriority): number {
    switch (priority) {
      case GovernorPriority.FOOD:
        return tile.outputs.food * 3 + tile.outputs.shields + tile.outputs.trade;

      case GovernorPriority.SHIELDS:
        return tile.outputs.shields * 3 + tile.outputs.food + tile.outputs.trade;

      case GovernorPriority.SCIENCE:
        return tile.outputs.trade * 2 + tile.outputs.food + tile.outputs.shields;

      case GovernorPriority.GOLD:
      case GovernorPriority.TRADE:
        return tile.outputs.trade * 2 + tile.outputs.food + tile.outputs.shields;

      case GovernorPriority.LUXURY:
        return tile.outputs.trade + tile.outputs.food + tile.outputs.shields;

      case GovernorPriority.BALANCED:
      default:
        return tile.outputs.food + tile.outputs.shields + tile.outputs.trade;
    }
  }

  /**
   * Select optimal production based on priority
   * @reference Original CityManager.selectOptimalProduction()
   */
  private async selectOptimalProduction(cityId: string, priority: GovernorPriority): Promise<void> {
    const city = this.cities.get(cityId);
    if (!city || city.currentProduction) {
      return; // Already has production set
    }

    // This is a simplified implementation
    // In a full game, this would consider:
    // - Available units/buildings to build
    // - Technology requirements
    // - Strategic value
    // - City needs (growth, defense, etc.)

    const { recommendedProduction, productionType } = this.getRecommendedProduction(city, priority);

    logger.info('Governor selected production', {
      cityId,
      cityName: city.name,
      priority,
      production: recommendedProduction,
      productionType,
    });

    // Note: In full implementation, would call setCityProduction
    // For now, just log the decision
  }

  private getRecommendedProduction(
    city: CityState,
    priority: GovernorPriority
  ): { recommendedProduction: string; productionType: 'unit' | 'building' } {
    const recommendations: Partial<Record<GovernorPriority, string>> = {
      [GovernorPriority.FOOD]: 'granary',
      [GovernorPriority.SHIELDS]: 'factory',
      [GovernorPriority.SCIENCE]: 'library',
      [GovernorPriority.GOLD]: 'marketplace',
      [GovernorPriority.TRADE]: 'marketplace',
      [GovernorPriority.LUXURY]: 'temple',
    };
    const recommendation = recommendations[priority];
    if (recommendation)
      return { recommendedProduction: recommendation, productionType: 'building' };
    return city.buildings.length < 3
      ? { recommendedProduction: 'granary', productionType: 'building' }
      : { recommendedProduction: 'warriors', productionType: 'unit' };
  }

  /**
   * Get city governor information
   * @reference Original CityManager.getCityGovernorInfo()
   */
  public getCityGovernorInfo(cityId: string): CityGovernor | null {
    const city = this.cities.get(cityId);
    return city?.governor || null;
  }

  /**
   * Disable governor for a city
   */
  public disableCityGovernor(cityId: string, playerId: string): boolean {
    const city = this.cities.get(cityId);
    if (!city || city.playerId !== playerId) {
      return false;
    }

    if (city.governor) {
      city.governor.isEnabled = false;
      logger.info('City governor disabled', { cityId, cityName: city.name });
    }

    return true;
  }

  /**
   * Get available governor priorities
   */
  public getAvailableGovernorPriorities(): GovernorPriority[] {
    return [
      GovernorPriority.BALANCED,
      GovernorPriority.FOOD,
      GovernorPriority.SHIELDS,
      GovernorPriority.TRADE,
      GovernorPriority.SCIENCE,
      GovernorPriority.GOLD,
      GovernorPriority.LUXURY,
    ];
  }
}
