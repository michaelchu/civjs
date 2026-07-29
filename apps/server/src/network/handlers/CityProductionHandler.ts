import { logger } from '@utils/logger';
import { Socket } from 'socket.io';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { BUILDING_TYPES } from '@game/managers/CityManager';
import type { RequirementsManager } from '@game/managers/RequirementsManager';
import {
  countSpaceshipPartCommitments,
  isSpaceshipPart,
  normalizeSpaceshipState,
  SPACESHIP_PART_LIMITS,
} from '@game/services/SpaceshipService';
// ProductionOption interface - shared between client and server
interface ProductionOption {
  id: string;
  name: string;
  type: 'unit' | 'building' | 'wonder';
  cost: number;
  description?: string;
  requirements?: string[];
  conversion?: boolean;
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
    private researchManager: any,
    private setCityProduction?: (
      cityId: string,
      productionType: 'unit' | 'building',
      productionId: string,
      playerId: string
    ) => Promise<boolean>,
    private requirementsManager?: Pick<RequirementsManager, 'evaluateRulesetCultureRequirements'>
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
        const isAvailable = await this.canCityBuildBuilding(city, buildingType, player);
        const cultureRequirements = (buildingType.cultureRequirements ?? []).map(
          requirement =>
            `${requirement.range} ${requirement.present ? 'minimum' : 'below'} ${requirement.value} culture`
        );
        availableProductions.push({
          id: buildingId,
          name: buildingType.name,
          type: 'building',
          cost: buildingType.cost,
          description: this.getBuildingDescription(buildingType),
          conversion: buildingType.genus === 'Convert',
          requirements: [
            ...(buildingType.requiredTech ? [buildingType.requiredTech] : []),
            ...cultureRequirements,
          ],
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
      socket.emit(
        'city:productionChanged',
        await this.applyProductionChange({ cityId, playerId, productionId, productionType })
      );
    } catch (error) {
      logger.error('Error changing production', {
        error: error instanceof Error ? error.message : 'Unknown error',
        cityId,
        playerId,
        productionId,
        productionType,
      });
      socket.emit('error', {
        message: error instanceof Error ? error.message : 'Failed to change production',
      });
    }
  }

  /**
   * Canonical authoritative mutation shared by packet-v1 and its named-event
   * compatibility adapter.
   */
  public async applyProductionChange({
    cityId,
    playerId,
    productionId,
    productionType,
  }: {
    cityId: string;
    playerId: string;
    productionId: string;
    productionType: 'unit' | 'building' | 'wonder';
  }): Promise<Record<string, unknown>> {
    const city = this.cities.get(cityId);
    if (!city) throw new Error('City not found');
    if (city.playerId !== playerId) throw new Error('City does not belong to player');

    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found');
    if (!(await this.canCityBuild(city, productionId, productionType, player))) {
      throw new Error('Production not available');
    }
    if (productionType === 'wonder') {
      productionType = 'building';
    }

    const penalty = this.calculateProductionChangePenalty(city, productionId, productionType);
    const previousProduction = city.currentProduction;
    const previousType = city.productionType;
    if (penalty > 0) {
      city.productionStock = Math.max(0, (city.productionStock ?? city.shieldStock ?? 0) - penalty);
    }

    if (this.setCityProduction) {
      await this.setCityProduction(cityId, productionType, productionId, playerId);
    } else {
      city.currentProduction = productionId;
      city.productionType = productionType;
    }

    const productionDetails = this.getProductionDetails(productionId, productionType);
    city.production = {
      target: productionDetails.name,
      type: productionType,
      progress: city.productionStock ?? city.shieldStock ?? 0,
      cost: productionDetails.cost,
      turnsToComplete: this.calculateTurnsToComplete(city, productionDetails),
      conversion:
        productionType === 'building' && BUILDING_TYPES[productionId]?.genus === 'Convert',
    };

    const result = {
      cityId,
      production: city.production,
      shieldStock: city.productionStock ?? city.shieldStock ?? 0,
      penalty,
      previousProduction,
      previousType,
    };
    logger.info('City production changed', {
      cityId,
      cityName: city.name,
      playerId,
      from: `${previousType}:${previousProduction}`,
      to: `${productionType}:${productionId}`,
      penalty,
      shieldStock: city.shieldStock,
    });
    return result;
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
    if (['settlers'].includes(unitType.id) && city.size < 2) {
      return false;
    }

    if (unitType.flags?.includes('NoBuild') || unitType.flags?.includes('BarbarianOnly')) {
      return false;
    }

    // A unit is obsolete as soon as the player can build any replacement in
    // its obsolete_by chain.
    if (this.isUnitObsolete(unitType, player)) {
      return false;
    }

    return true;
  }

  /**
   * Check if city can build a building
   * @reference freeciv/common/city.c can_city_build_improvement_now()
   */
  private async canCityBuildBuilding(city: any, buildingType: any, player: any): Promise<boolean> {
    // Check if already built (can't build duplicates)
    const buildingId = String(buildingType.id);
    if (!isSpaceshipPart(buildingId) && city.buildings?.includes(buildingId)) {
      return false;
    }
    if (isSpaceshipPart(buildingId)) {
      if (
        ![...this.cities.values()].some(candidate =>
          candidate.buildings?.includes('apollo_program')
        )
      ) {
        return false;
      }
      const playerCities = [...this.cities.values()].filter(
        candidate => candidate.playerId === player.id
      );
      const commitments = countSpaceshipPartCommitments(
        normalizeSpaceshipState(player.spaceshipState),
        playerCities,
        buildingId
      );
      const currentProject = city.currentProduction === buildingId;
      if (
        commitments > SPACESHIP_PART_LIMITS[buildingId] ||
        (!currentProject && commitments >= SPACESHIP_PART_LIMITS[buildingId])
      ) {
        return false;
      }
    }

    if (buildingType.genus === 'GreatWonder') {
      const claimed = [...this.cities.values()].some(
        other =>
          other.buildings?.includes(buildingType.id) ||
          (other.id !== city.id && other.currentProduction === buildingType.id)
      );
      if (claimed) return false;
    } else if (buildingType.genus === 'SmallWonder') {
      const owned = [...this.cities.values()].some(
        other => other.playerId === player.id && other.buildings?.includes(buildingType.id)
      );
      if (owned) return false;
    }

    // Check if player has required technology
    if (buildingType.requiredTech && !this.hasPlayerResearched(player, buildingType.requiredTech)) {
      return false;
    }

    // Check building prerequisites
    if (buildingType.requires && !this.hasRequiredBuildings(city, buildingType.requires)) {
      return false;
    }

    if (buildingType.cultureRequirements?.length) {
      if (!this.requirementsManager) {
        logger.warn('Culture-gated building evaluated without RequirementsManager', {
          buildingId: buildingType.id,
        });
        return false;
      }
      const result = await this.requirementsManager.evaluateRulesetCultureRequirements(
        buildingType.cultureRequirements,
        {
          cityId: city.id,
          playerId: player.id,
          cityBuildings: new Set(city.buildings ?? []),
        }
      );
      if (!result.satisfied) return false;
    }

    return true;
  }

  /**
   * Check if city can build the specified production
   */
  public async canCityBuild(
    city: any,
    productionId: string,
    productionType: 'unit' | 'building' | 'wonder',
    player: any
  ): Promise<boolean> {
    if (productionType === 'unit') {
      const unitType = UNIT_TYPES[productionId];
      return unitType ? this.canCityBuildUnit(city, unitType, player) : false;
    } else if (productionType === 'building') {
      const buildingType = BUILDING_TYPES[productionId];
      return buildingType ? this.canCityBuildBuilding(city, buildingType, player) : false;
    } else if (productionType === 'wonder') {
      const buildingType = BUILDING_TYPES[productionId];
      return buildingType?.genus === 'GreatWonder'
        ? this.canCityBuildBuilding(city, buildingType, player)
        : false;
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

    const currentShields = city.productionStock ?? city.shieldStock ?? 0;
    const currentClass = this.getProductionClass(city.currentProduction, city.productionType);
    const newClass = this.getProductionClass(newProductionId, newProductionType);

    // Freeciv preserves stock when switching within the unit, improvement, or
    // Wonder class. Crossing classes retains half, so this method returns the
    // amount to subtract from the current stock.
    if (!currentClass || currentClass === newClass) return 0;
    return currentShields - Math.floor(currentShields / 2);
  }

  private getProductionClass(
    productionId: string | undefined,
    productionType: 'unit' | 'building' | 'wonder' | null | undefined
  ): 'unit' | 'improvement' | 'wonder' | undefined {
    if (!productionId || !productionType) return undefined;
    if (productionType === 'unit') return 'unit';
    if (productionType === 'wonder') return 'wonder';
    const building = BUILDING_TYPES[productionId];
    return building?.genus === 'GreatWonder' || building?.genus === 'SmallWonder'
      ? 'wonder'
      : 'improvement';
  }

  /**
   * Calculate turns to complete production
   */
  private calculateTurnsToComplete(city: any, productionDetails: any): number {
    // Use the same calculation as CityDataService.transformCityForClient to ensure consistency
    // Priority: city.productionPerTurn > city.surplus.shields > default (1)
    // This fixes the discrepancy where server showed 40 turns and client showed 10 turns
    const shieldsPerTurn = Math.max(1, city.productionPerTurn || city.surplus?.shields || 1);
    const remainingShields = Math.max(
      0,
      productionDetails.cost - (city.productionStock ?? city.shieldStock ?? 0)
    );
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
    if (unitType.movement) parts.push(`Movement: ${unitType.movement}`);
    if (unitType.canFoundCity) parts.push('Can found cities');
    if (unitType.canBuildImprovements) parts.push('Can build improvements');
    return parts.join(', ') || 'Basic unit';
  }

  /**
   * Get building description for tooltip
   */
  private getBuildingDescription(buildingType: any): string {
    if (buildingType.genus === 'Convert' && buildingType.flags === 'Gold') {
      return 'Converts shields to gold while selected';
    }
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

  private getAvailableWonders(_city: any, _player: any): ProductionOption[] {
    // Great Wonders are part of BUILDING_TYPES and are returned above. Keep
    // this adapter empty so older clients do not receive duplicate entries.
    return [];
  }

  /**
   * Check if player has researched technology
   */
  private hasPlayerResearched(player: any, techId: string): boolean {
    if (this.researchManager?.hasResearchedTech) {
      return this.researchManager.hasResearchedTech(player.id, techId);
    }

    // Retain the older adapter only for callers which have not yet moved to
    // ResearchManager's canonical API.
    if (this.researchManager?.hasPlayerResearched) {
      return this.researchManager.hasPlayerResearched(player.id, techId);
    }

    // A missing research authority must not make a gated product available.
    return false;
  }

  /**
   * Check if unit is obsolete
   */
  private isUnitObsolete(unitType: any, player: any): boolean {
    const visited = new Set<string>();
    let replacementId = unitType.obsolete_by;
    while (replacementId && !visited.has(replacementId)) {
      visited.add(replacementId);
      const replacement = UNIT_TYPES[replacementId];
      if (!replacement) return false;
      if (
        (!replacement.requiredTech || this.hasPlayerResearched(player, replacement.requiredTech)) &&
        !replacement.flags?.includes('NoBuild') &&
        !replacement.flags?.includes('BarbarianOnly')
      ) {
        return true;
      }
      replacementId = replacement.obsolete_by;
    }
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
