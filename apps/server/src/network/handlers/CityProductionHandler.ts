import { logger } from '@utils/logger';
import { Socket } from 'socket.io';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { BUILDING_TYPES } from '@game/managers/CityManager';
// ProductionOption interface - shared between client and server
interface ProductionOption {
  id: string;
  name: string;
  type: 'unit' | 'building' | 'wonder';
  cost: number;
  description?: string;
  requirements?: string[];
  available: boolean;
}

/**
 * CityProductionHandler - Handles city production-related socket events
 * @reference freeciv-web/javascript/city.js production system
 *
 * Provides endpoints for:
 * - Getting available productions for a city
 * - Changing current production
 * - Managing production queue (worklist)
 */
export class CityProductionHandler {
  constructor(
    private cities: Map<string, any>,
    private players: Map<string, any>,
    private researchManager: any
  ) {}

  /**
   * Get available production options for a city
   * @reference freeciv-web/javascript/city.js getAvailableProductions logic
   */
  public async getAvailableProductions(
    socket: Socket,
    { cityId, playerId }: { cityId: string; playerId: string }
  ): Promise<void> {
    try {
      const city = this.cities.get(cityId);
      if (!city) {
        socket.emit('error', { message: 'City not found' });
        return;
      }

      if (city.playerId !== playerId) {
        socket.emit('error', { message: 'City does not belong to player' });
        return;
      }

      const player = this.players.get(playerId);
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      const availableProductions: ProductionOption[] = [];

      // Add available units based on technology
      for (const [unitId, unitType] of Object.entries(UNIT_TYPES)) {
        const isAvailable = this.canCityBuildUnit(city, unitType, player);
        availableProductions.push({
          id: unitId,
          name: unitType.name,
          type: 'unit',
          cost: unitType.cost,
          description: this.getUnitDescription(unitType),
          requirements: unitType.requiredTech ? [unitType.requiredTech] : [],
          available: isAvailable,
        });
      }

      // Add available buildings based on technology and existing buildings
      for (const [buildingId, buildingType] of Object.entries(BUILDING_TYPES)) {
        const isAvailable = this.canCityBuildBuilding(city, buildingType, player);
        availableProductions.push({
          id: buildingId,
          name: buildingType.name,
          type: 'building',
          cost: buildingType.cost,
          description: this.getBuildingDescription(buildingType),
          requirements: buildingType.requiredTech ? [buildingType.requiredTech] : [],
          available: isAvailable,
        });
      }

      // Add available wonders (basic implementation)
      const wonders = this.getAvailableWonders(city, player);
      availableProductions.push(...wonders);

      socket.emit('city:availableProductions', {
        cityId,
        productions: availableProductions,
      });

      logger.info('Sent available productions for city', {
        cityId,
        cityName: city.name,
        playerId,
        productionCount: availableProductions.length,
      });
    } catch (error) {
      logger.error('Error getting available productions', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cityId,
        playerId,
      });
      socket.emit('error', { message: 'Failed to get available productions' });
    }
  }

  /**
   * Change city production
   * @reference freeciv-web/javascript/city.js city_change_production()
   */
  public async changeProduction(
    socket: Socket,
    {
      cityId,
      playerId,
      productionId,
      productionType,
    }: {
      cityId: string;
      playerId: string;
      productionId: string;
      productionType: 'unit' | 'building' | 'wonder';
    }
  ): Promise<void> {
    try {
      const city = this.cities.get(cityId);
      if (!city) {
        socket.emit('error', { message: 'City not found' });
        return;
      }

      if (city.playerId !== playerId) {
        socket.emit('error', { message: 'City does not belong to player' });
        return;
      }

      const player = this.players.get(playerId);
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      // Validate the production option is available
      if (!this.canCityBuild(city, productionId, productionType, player)) {
        socket.emit('error', { message: 'Production not available' });
        return;
      }

      // Calculate production change penalty (shields lost when changing)
      const penalty = this.calculateProductionChangePenalty(city, productionId, productionType);

      // Update city production
      const previousProduction = city.currentProduction;
      const previousType = city.productionType;

      city.currentProduction = productionId;
      city.productionType = productionType;

      // Apply penalty to shield stock
      if (penalty > 0) {
        city.shieldStock = Math.max(0, (city.shieldStock || 0) - penalty);
      }

      // Get production details for the response
      const productionDetails = this.getProductionDetails(productionId, productionType);
      const turnsToComplete = this.calculateTurnsToComplete(city, productionDetails);

      // Update city production object
      city.production = {
        target: productionDetails.name,
        type: productionType,
        progress: city.shieldStock || 0,
        cost: productionDetails.cost,
        turnsToComplete,
      };

      // Broadcast city update to all players who can see this city
      // TODO: Implement proper city serialization for broadcasts
      socket.broadcast.emit('city:updated', {
        cityId,
        city,
      });

      socket.emit('city:productionChanged', {
        cityId,
        production: city.production,
        shieldStock: city.shieldStock,
        penalty,
        previousProduction,
        previousType,
      });

      logger.info('City production changed', {
        cityId,
        cityName: city.name,
        playerId,
        from: `${previousType}:${previousProduction}`,
        to: `${productionType}:${productionId}`,
        penalty,
        shieldStock: city.shieldStock,
      });
    } catch (error) {
      logger.error('Error changing production', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cityId,
        playerId,
        productionId,
        productionType,
      });
      socket.emit('error', { message: 'Failed to change production' });
    }
  }

  /**
   * Check if city can build a unit
   * @reference freeciv/common/city.c can_city_build_unit_now()
   */
  private canCityBuildUnit(city: any, unitType: any, player: any): boolean {
    // Check if player has required technology
    if (unitType.requiredTech && !this.hasPlayerResearched(player, unitType.requiredTech)) {
      return false;
    }

    // Check city size requirements for settlers (need at least size 2)
    if (['settler', 'settlers'].includes(unitType.id) && city.size < 2) {
      return false;
    }

    // Check if unit is obsoleted by newer technology
    if (this.isUnitObsolete(unitType, player)) {
      return false;
    }

    return true;
  }

  /**
   * Check if city can build a building
   * @reference freeciv/common/city.c can_city_build_improvement_now()
   */
  private canCityBuildBuilding(city: any, buildingType: any, player: any): boolean {
    // Check if already built (can't build duplicates)
    if (city.buildings?.includes(buildingType.id)) {
      return false;
    }

    // Check if player has required technology
    if (buildingType.requiredTech && !this.hasPlayerResearched(player, buildingType.requiredTech)) {
      return false;
    }

    // Check building prerequisites
    if (buildingType.requires && !this.hasRequiredBuildings(city, buildingType.requires)) {
      return false;
    }

    return true;
  }

  /**
   * Check if city can build the specified production
   */
  private canCityBuild(
    city: any,
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder',
    player: any
  ): boolean {
    if (productionType === 'unit') {
      const unitType = UNIT_TYPES[productionId];
      return unitType ? this.canCityBuildUnit(city, unitType, player) : false;
    } else if (productionType === 'building') {
      const buildingType = BUILDING_TYPES[productionId];
      return buildingType ? this.canCityBuildBuilding(city, buildingType, player) : false;
    } else if (productionType === 'wonder') {
      // Wonder logic would go here
      return false; // Not implemented yet
    }
    return false;
  }

  /**
   * Calculate production change penalty
   * @reference freeciv/common/city.c city_change_production_penalty()
   */
  private calculateProductionChangePenalty(
    city: any,
    newProductionId: string,
    newProductionType: 'unit' | 'building' | 'wonder'
  ): number {
    // No penalty if no current production or changing to same thing
    if (
      !city.currentProduction ||
      (city.currentProduction === newProductionId && city.productionType === newProductionType)
    ) {
      return 0;
    }

    // In Freeciv, changing production typically loses 50% of accumulated shields
    // but there are exceptions for related units/buildings
    const currentShields = city.shieldStock || 0;

    // For now, apply standard 50% penalty
    // TODO: Implement more sophisticated penalty calculation based on production relationships
    return Math.floor(currentShields * 0.5);
  }

  /**
   * Calculate turns to complete production
   */
  private calculateTurnsToComplete(city: any, productionDetails: any): number {
    // Use the same calculation as CityDataService.transformCityForClient to ensure consistency
    // Priority: city.productionPerTurn > city.surplus.shields > default (1)
    // This fixes the discrepancy where server showed 40 turns and client showed 10 turns
    const shieldsPerTurn = Math.max(1, city.productionPerTurn || city.surplus?.shields || 1);
    const remainingShields = Math.max(0, productionDetails.cost - (city.shieldStock || 0));
    return Math.ceil(remainingShields / shieldsPerTurn);
  }

  /**
   * Get production details for ID and type
   */
  private getProductionDetails(
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder'
  ) {
    if (productionType === 'unit') {
      return UNIT_TYPES[productionId];
    } else if (productionType === 'building') {
      return BUILDING_TYPES[productionId];
    }
    // Wonder handling would go here
    return { name: 'Unknown', cost: 0 };
  }

  /**
   * Get unit description for tooltip
   */
  private getUnitDescription(unitType: any): string {
    const parts = [];
    if (unitType.combat > 0) parts.push(`Attack: ${unitType.combat}`);
    if (unitType.movement) parts.push(`Movement: ${unitType.movement / 3}`);
    if (unitType.canFoundCity) parts.push('Can found cities');
    if (unitType.canBuildImprovements) parts.push('Can build improvements');
    return parts.join(', ') || 'Basic unit';
  }

  /**
   * Get building description for tooltip
   */
  private getBuildingDescription(buildingType: any): string {
    if (buildingType.effects) {
      const effects = [];
      if (buildingType.effects.foodBonus)
        effects.push(`+${buildingType.effects.foodBonus}% food storage`);
      if (buildingType.effects.happinessEffect)
        effects.push(`Makes ${buildingType.effects.happinessEffect} citizens happy`);
      if (buildingType.effects.tradeBonus)
        effects.push(`+${buildingType.effects.tradeBonus}% trade`);
      if (buildingType.effects.scienceBonus)
        effects.push(`+${buildingType.effects.scienceBonus}% science`);
      return effects.join(', ') || 'City improvement';
    }
    return 'City improvement';
  }

  /**
   * Get available wonders (placeholder)
   */
  private getAvailableWonders(_city: any, _player: any): ProductionOption[] {
    // TODO: Implement wonder system
    return [];
  }

  /**
   * Check if player has researched technology
   */
  private hasPlayerResearched(player: any, techId: string): boolean {
    return this.researchManager?.hasPlayerResearched?.(player.id, techId) ?? true;
  }

  /**
   * Check if unit is obsolete
   */
  private isUnitObsolete(_unitType: any, _player: any): boolean {
    // TODO: Implement obsolescence logic
    return false;
  }

  /**
   * Check if city has required buildings
   */
  private hasRequiredBuildings(city: any, requirements: string[]): boolean {
    const cityBuildings = city.buildings || [];
    return requirements.every(req => cityBuildings.includes(req));
  }
}
