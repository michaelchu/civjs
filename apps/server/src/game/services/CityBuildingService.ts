import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState, BuildingType, BUILDING_TYPES } from '@game/managers/CityManager';
import { DatabaseProvider } from '@database';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';

/**
 * CityBuildingService - Manages city buildings and their effects
 * @reference docs/refactor/REFACTORING_PLAN.md - CityManager refactoring
 *
 * Handles all building-related operations including:
 * - Building construction validation and completion
 * - Building effects application
 * - Building maintenance costs
 * - Building selling/demolition
 */
export class CityBuildingService extends BaseGameService {
  private readonly effectsManager = new EffectsManager();
  constructor(
    private cities: Map<string, CityState>,
    _db: DatabaseProvider, // Marked as unused with underscore
    private buildingTypes: typeof BUILDING_TYPES
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityBuildingService';
  }

  /**
   * Check if a city can build a specific building
   * @reference Original CityManager.canCityBuildBuilding()
   */
  public canCityBuildBuilding(cityId: string, buildingId: string): boolean {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    const building = this.buildingTypes[buildingId];
    if (!building) {
      return false;
    }

    // Check if building is already built
    if (city.buildings.includes(buildingId)) {
      return false;
    }

    // Check prerequisites (simplified - in full game would check techs, resources, etc.)
    // Note: prerequisiteBuildings property doesn't exist in current BuildingType interface
    // This would need to be added to the interface when implementing full building prerequisites

    // Check population requirements
    // Note: populationRequirement property doesn't exist in current BuildingType interface
    // This would need to be added when implementing population-based building requirements

    return true;
  }

  // Note: completeBuildingConstruction method removed as it's not currently used
  // It would be called by the main CityManager during turn processing

  // Note: applyBuildingEffects method removed as it's not currently used
  // It would be called by the completeBuildingConstruction method
  /**
   * Apply building effects to city
   * @reference Original CityManager.applyBuildingEffects()
   *
  private applyBuildingEffects(city: CityState, building: BuildingType): void {
    if (building.effects.defenseBonus && city.defenseStrength) {
      city.defenseStrength += Math.floor(
        (city.defenseStrength * building.effects.defenseBonus) / 100
      );
    }

    // Note: Other effects like scienceBonus, goldBonus, etc. are applied during city refresh
    // This method is for immediate, permanent effects that modify base city stats

    logger.debug('Applied building effects', {
      cityId: city.id,
      buildingId: building.name,
      effects: building.effects,
    });
  }
   */

  /**
   * Calculate city outputs including building effects
   * @reference Original CityManager.calculateCityOutputsWithBuildings()
   */
  public calculateCityOutputsWithBuildings(cityId: string): {
    food: number;
    shields: number;
    trade: number;
    science: number;
    gold: number;
    luxury: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return { food: 0, shields: 0, trade: 0, science: 0, gold: 0, luxury: 0 };
    }

    // Start with base tile outputs (would be calculated by CityTileManagementService)
    let food = city.foodPerTurn || 0;
    let shields = city.productionPerTurn || 0;
    const trade = 1; // Base trade from city center

    // Apply building bonuses (using available effect properties)
    let foodBonus = 0;
    let productionBonus = 0; // Use productionBonus instead of shieldBonus
    for (const buildingId of city.buildings) {
      const building = this.buildingTypes[buildingId];
      if (building) {
        if (building.effects.foodBonus) foodBonus += building.effects.foodBonus;
        if (building.effects.productionBonus) productionBonus += building.effects.productionBonus;
      }
    }

    const effectContext = {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
    };
    const scienceBonus = this.effectsManager.calculateEffect(EffectType.OUTPUT_BONUS, {
      ...effectContext,
      outputType: OutputType.SCIENCE,
    }).value;
    const goldBonus = this.effectsManager.calculateEffect(EffectType.OUTPUT_BONUS, {
      ...effectContext,
      outputType: OutputType.GOLD,
    }).value;

    // Apply bonuses
    const tradeAfterBonus = trade; // No trade bonus property available yet
    food = Math.floor((food * (100 + foodBonus)) / 100);
    shields = Math.floor((shields * (100 + productionBonus)) / 100);

    // Split trade between science and gold
    const scienceFromTrade = Math.floor(tradeAfterBonus / 2);
    const goldFromTrade = Math.floor(tradeAfterBonus / 2);

    const science = Math.floor((scienceFromTrade * (100 + scienceBonus)) / 100);
    const gold = Math.floor((goldFromTrade * (100 + goldBonus)) / 100);

    return {
      food,
      shields,
      trade: tradeAfterBonus,
      science,
      gold,
      luxury: 0, // Calculated from specialists
    };
  }

  /**
   * Calculate building maintenance cost for a city
   * @reference Original CityManager.calculateBuildingMaintenanceCost()
   */
  public calculateBuildingMaintenanceCost(cityId: string): number {
    const city = this.cities.get(cityId);
    if (!city) {
      return 0;
    }

    let totalMaintenance = 0;

    for (const buildingId of city.buildings) {
      const building = this.buildingTypes[buildingId];
      // Note: maintenanceCost property doesn't exist in current BuildingType interface
      // This would need to be added when implementing building maintenance costs
      if (building) {
        // totalMaintenance += building.maintenanceCost || 0;
        totalMaintenance += 1; // Placeholder maintenance cost
      }
    }

    return totalMaintenance;
  }

  /**
   * Start building construction
   * @reference Original CityManager.startBuildingConstruction()
   */
  public async startBuildingConstruction(cityId: string, buildingId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    if (!this.canCityBuildBuilding(cityId, buildingId)) {
      return false;
    }

    const building = this.buildingTypes[buildingId];
    if (!building) {
      return false;
    }

    // Set production
    city.currentProduction = buildingId;
    city.productionType = 'building';
    // Note: shieldStock property doesn't exist in current interface
    city.turnsToComplete = Math.ceil(building.cost / (city.productionPerTurn || 1));

    logger.info('Started building construction', {
      cityId,
      buildingId,
      buildingName: building.name,
      cost: building.cost,
      turnsToComplete: city.turnsToComplete,
    });

    return true;
  }

  // Note: This method is not used in the current implementation
  // It would be called by the main CityManager during turn processing

  /**
   * Sell a building for gold
   * @reference Original CityManager.sellBuilding()
   */
  public async sellBuilding(cityId: string, buildingId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    const buildingIndex = city.buildings.indexOf(buildingId);
    if (buildingIndex === -1) {
      return false;
    }

    const building = this.buildingTypes[buildingId];
    if (!building) {
      return false;
    }

    // Remove building
    city.buildings.splice(buildingIndex, 1);

    // Give gold (typically half the cost)
    const goldValue = Math.floor(building.cost / 2);
    // Note: In full implementation, this would be added to player's treasury

    logger.info('Building sold', {
      cityId,
      buildingId,
      buildingName: building.name,
      goldValue,
    });

    return true;
  }

  /**
   * Get all buildings available for construction in a city
   */
  public getAvailableBuildings(cityId: string): BuildingType[] {
    const availableBuildings: BuildingType[] = [];

    for (const [buildingId, building] of Object.entries(this.buildingTypes)) {
      if (this.canCityBuildBuilding(cityId, buildingId)) {
        availableBuildings.push(building);
      }
    }

    return availableBuildings;
  }

  /**
   * Get buildings currently in a city
   */
  public getCityBuildings(cityId: string): BuildingType[] {
    const city = this.cities.get(cityId);
    if (!city) {
      return [];
    }

    return city.buildings
      .map(buildingId => this.buildingTypes[buildingId])
      .filter(building => building !== undefined);
  }
}
