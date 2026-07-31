import { logger } from '@utils/logger';
import { Socket } from 'socket.io';
import type { RequirementsManager } from '@game/managers/RequirementsManager';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetUnitsService, type UnitType } from '@game/services/RulesetUnitsService';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import {
  UnitProductionValidationService,
  type UnitProductionFacts,
} from '@game/services/UnitProductionValidationService';
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
  private readonly unitTypes: Record<string, UnitType>;
  private readonly buildingTypes: Record<string, any>;
  private readonly unitProductionValidation: UnitProductionValidationService;

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
    private requirementsManager?: Pick<RequirementsManager, 'evaluateRulesetCultureRequirements'>,
    private readonly unitBuildValidator?: (cityId: string, unitId: string) => boolean,
    private readonly rulesetName: string = DEFAULT_RULESET,
    unitTypes?: Record<string, UnitType>,
    buildingTypes?: Record<string, any>
  ) {
    this.unitTypes = unitTypes ?? rulesetUnitsService.getUnitTypes(rulesetName);
    this.buildingTypes =
      buildingTypes ?? rulesetBuildingsService.getPlayableBuildingTypes(rulesetName);
    this.unitProductionValidation = new UnitProductionValidationService(this.unitTypes);
  }

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
      for (const [unitId, unitType] of Object.entries(this.unitTypes)) {
        const isAvailable = this.canCityBuildUnit(city, unitType, player);
        availableProductions.push({
          id: unitId,
          name: unitType.name,
          type: 'unit',
          cost: unitType.cost,
          description: this.getUnitDescription(unitType),
          requirements: this.getUnitRequirements(unitType),
          available: isAvailable,
        });
      }

      availableProductions.push(...(await this.getBuildingProductionOptions(city, player)));
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

  private async getBuildingProductionOptions(city: any, player: any): Promise<ProductionOption[]> {
    const options: ProductionOption[] = [];
    for (const [buildingId, buildingType] of Object.entries(this.buildingTypes)) {
      const isAvailable = await this.canCityBuildBuilding(city, buildingType, player);
      const cultureRequirements = (buildingType.cultureRequirements ?? []).map(
        (requirement: any) =>
          `${requirement.range} ${requirement.present ? 'minimum' : 'below'} ${requirement.value} culture`
      );
      options.push({
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
    return options;
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
    const player = this.players.get(playerId);
    await this.assertProductionChange(city, player, playerId, productionType, productionId);
    productionType = productionType === 'wonder' ? 'building' : productionType;

    const penalty = this.calculateProductionChangePenalty(city, productionId, productionType);
    const previousProduction = city.currentProduction;
    const previousType = city.productionType;
    this.applyProductionPenalty(city, penalty);

    await this.persistProductionChange(city, cityId, playerId, productionId, productionType);

    const productionDetails = this.getProductionDetails(productionId, productionType);
    city.production = {
      target: productionDetails.name,
      type: productionType,
      progress: city.productionStock ?? city.shieldStock ?? 0,
      cost: productionDetails.cost,
      turnsToComplete: this.calculateTurnsToComplete(city, productionDetails),
      conversion:
        productionType === 'building' && this.buildingTypes[productionId]?.genus === 'Convert',
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

  private async assertProductionChange(
    city: any,
    player: any,
    playerId: string,
    productionType: 'unit' | 'building' | 'wonder',
    productionId: string
  ): Promise<void> {
    if (!city) throw new Error('City not found');
    if (city.playerId !== playerId) throw new Error('City does not belong to player');
    if (!player) throw new Error('Player not found');
    if (!(await this.canCityBuild(city, productionId, productionType, player)))
      throw new Error('Production not available');
  }

  private async persistProductionChange(
    city: any,
    cityId: string,
    playerId: string,
    productionId: string,
    productionType: 'unit' | 'building'
  ): Promise<void> {
    if (this.setCityProduction)
      await this.setCityProduction(cityId, productionType, productionId, playerId);
    else {
      city.currentProduction = productionId;
      city.productionType = productionType;
    }
  }

  private applyProductionPenalty(city: any, penalty: number): void {
    if (penalty > 0)
      city.productionStock = Math.max(0, (city.productionStock ?? city.shieldStock ?? 0) - penalty);
  }

  /**
   * Check if city can build a unit
   * @reference freeciv/common/city.c can_city_build_unit_now()
   */
  private canCityBuildUnit(city: any, unitType: UnitType, player: any): boolean {
    if (this.unitBuildValidator) return this.unitBuildValidator(city.id, unitType.id);
    return this.unitProductionValidation.canBuildUnit(
      unitType,
      this.getUnitProductionFacts(city, player)
    );
  }

  /**
   * Check if city can build a building
   * @reference freeciv/common/city.c can_city_build_improvement_now()
   */
  private async canCityBuildBuilding(city: any, buildingType: any, player: any): Promise<boolean> {
    const buildingId = String(buildingType.id);
    if (!this.isBuildingGloballyAvailable(city, buildingType, player, buildingId)) return false;
    if (buildingType.requiredTech && !this.hasPlayerResearched(player, buildingType.requiredTech))
      return false;
    if (buildingType.requires && !this.hasRequiredBuildings(city, buildingType.requires))
      return false;
    return this.meetsCultureRequirements(city, buildingType, player);
  }

  private isBuildingGloballyAvailable(
    city: any,
    buildingType: any,
    player: any,
    buildingId: string
  ): boolean {
    if (!isSpaceshipPart(buildingId) && city.buildings?.includes(buildingId)) return false;
    if (isSpaceshipPart(buildingId) && !this.isSpaceshipPartAvailable(city, player, buildingId))
      return false;
    if (
      buildingType.genus === 'GreatWonder' &&
      [...this.cities.values()].some(
        other =>
          other.buildings?.includes(buildingType.id) ||
          (other.id !== city.id && other.currentProduction === buildingType.id)
      )
    )
      return false;
    if (
      buildingType.genus === 'SmallWonder' &&
      [...this.cities.values()].some(
        other => other.playerId === player.id && other.buildings?.includes(buildingType.id)
      )
    )
      return false;
    return true;
  }

  private isSpaceshipPartAvailable(city: any, player: any, buildingId: string): boolean {
    if (
      ![...this.cities.values()].some(candidate => candidate.buildings?.includes('apollo_program'))
    )
      return false;
    const playerCities = [...this.cities.values()].filter(
      candidate => candidate.playerId === player.id
    );
    const spaceshipBuildingId = buildingId as keyof typeof SPACESHIP_PART_LIMITS;
    const commitments = countSpaceshipPartCommitments(
      normalizeSpaceshipState(player.spaceshipState),
      playerCities,
      spaceshipBuildingId
    );
    const limit = SPACESHIP_PART_LIMITS[spaceshipBuildingId];
    return commitments <= limit && (city.currentProduction === buildingId || commitments < limit);
  }

  private async meetsCultureRequirements(
    city: any,
    buildingType: any,
    player: any
  ): Promise<boolean> {
    if (!buildingType.cultureRequirements?.length) return true;
    if (!this.requirementsManager) {
      logger.warn('Culture-gated building evaluated without RequirementsManager', {
        buildingId: buildingType.id,
      });
      return false;
    }
    const result = await this.requirementsManager.evaluateRulesetCultureRequirements(
      buildingType.cultureRequirements,
      { cityId: city.id, playerId: player.id, cityBuildings: new Set(city.buildings ?? []) }
    );
    return result.satisfied;
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
      const unitType = this.unitTypes[productionId];
      return unitType ? this.canCityBuildUnit(city, unitType, player) : false;
    } else if (productionType === 'building') {
      const buildingType = this.buildingTypes[productionId];
      return buildingType ? this.canCityBuildBuilding(city, buildingType, player) : false;
    } else if (productionType === 'wonder') {
      const buildingType = this.buildingTypes[productionId];
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
    const building = this.buildingTypes[productionId];
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
      return this.unitTypes[productionId];
    } else if (productionType === 'building') {
      return this.buildingTypes[productionId];
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

  private getUnitRequirements(unitType: UnitType): string[] {
    const requirements = new Set<string>();
    if (unitType.requiredTech) requirements.add(unitType.requiredTech);
    for (const requirement of unitType.buildRequirements ?? []) {
      requirements.add(
        requirement.type === 'Tech' && requirement.range === 'Player'
          ? requirement.name
          : `${requirement.range}: ${requirement.type} ${requirement.name}`
      );
    }
    return [...requirements];
  }

  private getUnitProductionFacts(city: any, player: any): UnitProductionFacts {
    const researched = this.researchManager?.getResearchedTechs?.(player.id);
    const playerTechnologies = new Set<string>(Array.isArray(researched) ? researched : []);
    if (!researched) {
      for (const unit of Object.values(this.unitTypes)) {
        for (const requirement of unit.buildRequirements ?? []) {
          if (requirement.type !== 'Tech') continue;
          if (this.hasPlayerResearched(player, requirement.name)) {
            playerTechnologies.add(requirement.name);
          }
        }
      }
    }
    const playerCities = [...this.cities.values()].filter(
      candidate => candidate.playerId === player.id
    );
    const playerBuildings = new Set(playerCities.flatMap(candidate => candidate.buildings ?? []));
    const worldBuildings = new Set(
      [...this.cities.values()].flatMap(candidate => candidate.buildings ?? [])
    );
    const playerGoods = new Set<string>(
      playerCities.flatMap(candidate =>
        (candidate.workableTiles ?? [])
          .map((tile: { resource?: string }) => tile.resource)
          .filter((resource: string | undefined): resource is string => Boolean(resource))
      )
    );
    const cityGoods = new Set<string>(
      [
        ...(city.workableTiles ?? []).map((tile: { resource?: string }) => tile.resource),
        ...(city.tradeRoutes ?? []).map((route: { goods?: string }) => route.goods),
      ].filter((resource): resource is string => Boolean(resource))
    );
    const nativeUnitClassesByTerrain = new Map<string, ReadonlySet<string>>(
      Object.entries(rulesetLoader.getTerrains(this.rulesetName)).map(([terrainId, terrain]) => [
        terrainId,
        new Set((terrain as typeof terrain & { native_to?: string[] }).native_to ?? []),
      ])
    );
    return {
      playerTechnologies,
      government: player.government ?? player.currentGovernment,
      playerBuildings,
      playerGoods,
      cityBuildings: new Set(city.buildings ?? []),
      cityGoods,
      worldBuildings,
      nukeEnabled: worldBuildings.has('manhattan_project'),
      localTerrain: city.terrain,
      adjacentTerrains: city.adjacentTerrains,
      nativeUnitClassesByTerrain,
    };
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
   * Check if city has required buildings
   */
  private hasRequiredBuildings(city: any, requirements: string[]): boolean {
    const cityBuildings = city.buildings || [];
    return requirements.every(req => cityBuildings.includes(req));
  }
}
