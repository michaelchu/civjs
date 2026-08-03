/**
 * @module server/game/services/CityTurnProcessingService
 * Provides the server-side City Turn Processing Service service.
 */
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
/**
 * CityTurnProcessingService - Handles city turn processing pipeline
 *
 * Extracted from CityManager.ts to reduce complexity and improve maintainability.
 * This service orchestrates the complete city turn processing sequence:
 * - Government effects application
 * - Governor automation
 * - Citizen optimization
 * - Output calculations
 * - Food and growth processing
 * - Production processing
 * - Happiness calculations
 * - Database persistence
 *
 * @reference freeciv/common/city.c - city turn processing
 * @reference freeciv-web/javascript/city.js - city management
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { type UnitType, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { rulesetBuildingsService } from './RulesetBuildingsService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import type { Server as SocketServer } from 'socket.io';
import type { CityGovernorService } from './CityGovernorService';
import type { CityTileManagementService } from './CityTileManagementService';
import { spaceshipPartFromEffects } from './SpaceshipService';
import type { BuildingType, TradeRoute } from '@game/cities/CityTypes';

// Import types from CityManager (we'll need to make these available)
export interface CityState {
  id: string;
  name: string;
  x: number;
  y: number;
  playerId: string;
  population: number;
  size: number;
  cityRadius: number;
  founded: number;
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
  turnsToComplete: number;
  productionStock?: number;
  foodStock?: number;
  foodPerTurn?: number;
  productionPerTurn?: number;
  tradePerTurn?: number;
  shieldStock?: number;
  sciencePerTurn?: number;
  goldPerTurn?: number;
  luxuryPerTurn?: number;
  illness?: number;
  illnessTrade?: number;
  turnPlague?: number;
  wasHappy?: boolean;
  disorderTurns?: number;
  history: number;
  buildings: string[];
  specialists: Record<number, number>;
  workableTiles?: Array<{
    x: number;
    y: number;
    isWorked: boolean;
    isCenter?: boolean;
    isBlocked?: boolean;
    outputs: { food: number; shields: number; trade: number };
    terrain?: string;
    resource?: string;
    improvements?: string[];
  }>;
  tradeRoutes: any[];
  happiness: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
  };
  governor?: any;
  worklist: any[];
  defenseStrength?: number;
}

export interface ProductionItem {
  kind: 'unit' | 'building' | 'wonder';
  value: string;
  remainingCost?: number;
}

export type CityGameplayEvent =
  | { type: 'founded'; city: CityState }
  | { type: 'growth'; city: CityState; oldSize: number }
  | { type: 'production_completed'; city: CityState; item: ProductionItem }
  | {
      type: 'trade_route_established';
      sourceCity: CityState;
      partnerCity: CityState;
      route: TradeRoute;
    };

export interface CityManagerCallbacks {
  onCityGrowth?: (city: CityState, oldSize: number) => void;
  onCityProductionComplete?: (city: CityState, item: ProductionItem) => void | Promise<void>;
  onCityTurnProcessed?: (city: CityState) => void;
}

const WEALTH_PRODUCTION_ID = 'capitalization';

/**
 * Turn processing step timing information
 */
export interface TurnStepTiming {
  step: string;
  duration: number;
}

/**
 * Turn processing performance metrics
 */
export interface TurnProcessingMetrics {
  cityId: string;
  cityName: string;
  totalTime: number;
  stepTimings: TurnStepTiming[];
  population: number;
  currentProduction?: string | null;
  productionType?: 'unit' | 'building' | null;
}

/**
 * Dependencies that CityTurnProcessingService needs from CityManager
 */
export interface CityTurnProcessingDependencies {
  gameId: string;
  cities: Map<string, CityState>;
  callbacks: CityManagerCallbacks;
  onGameplayEvent?: (event: CityGameplayEvent) => void;
  effectsManager: EffectsManager;
  unitTypes?: Record<string, UnitType>;
  buildingTypes?: Record<string, BuildingType>;
  io?: SocketServer;
  governorService?: CityGovernorService;
  tileManagementService?: CityTileManagementService;

  // Method dependencies (functions from CityManager)
  refreshCityWithGovernmentEffects: (cityId: string) => void;
  calculateCityOutputs: (cityId: string) => any;
  calculateHappiness: (cityId: string) => any;
  applyCityHappiness?: (cityId: string) => void;
  getPlayerGovernment?: (playerId: string) => string;
  checkPollution: (cityId: string, currentTurn: number) => Promise<boolean>;
  /** Recalculate and resolve C2C3 illness before food and growth. */
  processIllness?: (cityId: string, currentTurn: number) => Promise<boolean>;
  canCityContinueProduction?: (cityId: string, kind: 'unit' | 'building', value: string) => boolean;
  forceGovernmentRevolution?: (playerId: string) => Promise<void>;
  reconcileCitizenAssignments: (cityId: string, reason: string) => Promise<boolean>;
  destroyCity: (cityId: string) => Promise<boolean>;
  saveCityToDatabase: (city: CityState) => Promise<void>;
  refreshCapitalStatus?: (playerId: string) => void;
}

/**
 * CityTurnProcessingService handles the complete city turn processing pipeline
 */
export class CityTurnProcessingService extends BaseGameService {
  private dependencies: CityTurnProcessingDependencies;
  private readonly effectsManager: EffectsManager;
  private readonly unitTypes: Record<string, UnitType>;
  private readonly buildingTypes: Record<string, BuildingType>;

  constructor(dependencies: CityTurnProcessingDependencies) {
    super(logger);
    this.dependencies = dependencies;
    this.effectsManager = dependencies.effectsManager;
    this.unitTypes =
      dependencies.unitTypes ??
      rulesetUnitsService.getUnitTypes(this.effectsManager.getRulesetName());
    this.buildingTypes =
      dependencies.buildingTypes ??
      rulesetBuildingsService.getBuildingTypes(this.effectsManager.getRulesetName());
  }

  getServiceName(): string {
    return 'CityTurnProcessingService';
  }

  /**
   * Process a single city's turn with comprehensive timing and error handling
   */
  async processCityTurn(cityId: string, currentTurn: number): Promise<void> {
    const city = this.dependencies.cities.get(cityId);
    if (!city) {
      logger.warn(`Cannot process turn for city: ${cityId} - city not found`);
      return;
    }

    const startTime = Date.now();
    const stepTimings: TurnStepTiming[] = [];
    let lastStepTime = startTime;

    const recordStep = (step: string) => {
      const now = Date.now();
      stepTimings.push({
        step,
        duration: now - lastStepTime,
      });
      lastStepTime = now;
    };

    try {
      await this.processCityTurnSteps(
        city,
        cityId,
        currentTurn,
        recordStep,
        startTime,
        stepTimings
      );
    } catch (error) {
      const totalTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error(`Error processing turn for city ${city.name}`, {
        gameId: this.dependencies.gameId,
        cityId,
        totalTime,
        stepTimings,
        error: errorMessage,
        population: city.population,
        currentProduction: city.currentProduction,
        productionType: city.productionType,
      });

      // Don't re-throw database errors during turn processing to avoid breaking the entire turn
      // The error has already been logged above, and the turn processing should continue
      logger.warn('City turn processing completed with database save error, continuing with turn', {
        gameId: this.dependencies.gameId,
        cityId,
        cityName: city.name,
      });
    }
  }

  private async processCityTurnSteps(
    city: CityState,
    cityId: string,
    currentTurn: number,
    recordStep: (step: string) => void,
    startTime: number,
    stepTimings: TurnStepTiming[]
  ): Promise<void> {
    this.dependencies.refreshCityWithGovernmentEffects(cityId);
    recordStep('government_effects');
    if (this.dependencies.governorService && city.governor?.isEnabled)
      await this.dependencies.governorService.applyGovernorAutomation(cityId);
    recordStep('governor_automation');
    this.dependencies.calculateCityOutputs(cityId);
    recordStep('calculate_outputs');
    this.dependencies.applyCityHappiness?.(cityId);
    const inDisorder = city.happiness.unhappy + 2 * city.happiness.angry > city.happiness.happy;
    this.applyDisorderOutputs(city, inDisorder);
    await this.processCivilDisorder(city, inDisorder);
    recordStep('happiness');
    this.dependencies.callbacks.onCityTurnProcessed?.(city);
    recordStep('callbacks');
    const citySurvivedIllness =
      (await this.dependencies.processIllness?.(cityId, currentTurn)) ?? true;
    recordStep('illness');
    if (!citySurvivedIllness || !this.dependencies.cities.has(cityId)) return;
    await this.processFoodAndGrowth(city, currentTurn);
    recordStep('food_growth');
    if (!this.dependencies.cities.has(cityId)) return;
    await this.processProduction(city, currentTurn);
    recordStep('production');
    city.wasHappy = this.isHappy(city);
    await this.dependencies.checkPollution(cityId, currentTurn);
    recordStep('pollution');
    await this.dependencies.saveCityToDatabase(city);
    recordStep('database_save');
    const totalTime = Date.now() - startTime;
    if (totalTime > 2000 || stepTimings.some(s => s.duration > 1000))
      logger.warn(`Slow city turn processing detected for ${city.name}`, {
        gameId: this.dependencies.gameId,
        cityId,
        totalTime,
        stepTimings,
        population: city.population,
        currentProduction: city.currentProduction,
        productionType: city.productionType,
      });
  }

  private applyDisorderOutputs(city: CityState, inDisorder: boolean): void {
    if (!inDisorder) return;
    city.foodPerTurn = Math.min(0, city.foodPerTurn ?? 0);
    city.productionPerTurn = 0;
    city.sciencePerTurn = 0;
    city.goldPerTurn = 0;
    city.luxuryPerTurn = 0;
  }

  /**
   * Democracy falls after more consecutive disorder turns than allowed by
   * Revolution_Unhappiness. Other governments have a zero threshold.
   * @reference reference/freeciv/server/cityturn.c:3821-3875
   */
  private async processCivilDisorder(city: CityState, inDisorder: boolean): Promise<void> {
    if (!inDisorder) {
      city.disorderTurns = 0;
      return;
    }

    city.disorderTurns = (city.disorderTurns ?? 0) + 1;
    const threshold = this.effectsManager.calculateEffect(EffectType.REVOLUTION_UNHAPPINESS, {
      playerId: city.playerId,
      cityId: city.id,
      government: this.dependencies.getPlayerGovernment?.(city.playerId),
      cityBuildings: new Set(city.buildings),
    }).value;
    if (threshold > 0 && city.disorderTurns > threshold) {
      await this.dependencies.forceGovernmentRevolution?.(city.playerId);
      city.disorderTurns = 0;
    }
  }

  /**
   * Process all cities' turns in parallel
   */
  async processAllCitiesTurn(currentTurn: number): Promise<void> {
    const cityPromises = Array.from(this.dependencies.cities.keys()).map(cityId =>
      this.processCityTurn(cityId, currentTurn)
    );

    try {
      await Promise.all(cityPromises);
    } catch (error) {
      logger.error('Error processing cities turn', {
        currentTurn,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Process food consumption and city growth
   * Public method for testing and external access
   */
  public async processFoodAndGrowth(city: CityState, _currentTurn: number): Promise<void> {
    const food = this.getFoodState(city);
    const { foodSurplus, newFoodStock, granarySize, effectContext, raptureGrowth } = food;

    if ((newFoodStock >= granarySize && foodSurplus > 0) || raptureGrowth) {
      await this.processGrowth(city, newFoodStock, granarySize, raptureGrowth, effectContext);
      return;
    }
    if (newFoodStock < 0) {
      await this.processStarvation(city);
      return;
    }
    city.foodStock = newFoodStock;
  }

  private getFoodState(city: CityState): any {
    const foodSurplus = city.foodPerTurn || 0;
    const newFoodStock = (city.foodStock || 0) + foodSurplus;
    const granarySize = this.calculateGranarySize(city.population);
    const government = this.dependencies.getPlayerGovernment?.(city.playerId) ?? 'despotism';
    const effectContext = {
      playerId: city.playerId,
      cityId: city.id,
      government,
      cityBuildings: new Set(city.buildings),
      cityPopulation: city.population,
    };
    const celebrating = city.wasHappy === true && this.isHappy(city);
    const raptureGrowth =
      foodSurplus > 0 &&
      celebrating &&
      this.effectsManager.calculateEffect(EffectType.RAPTURE_GROW, effectContext).value > 0;
    return { foodSurplus, newFoodStock, granarySize, effectContext, raptureGrowth };
  }

  private async processGrowth(
    city: CityState,
    newFoodStock: number,
    granarySize: number,
    raptureGrowth: boolean,
    effectContext: any
  ): Promise<void> {
    const unlimited =
      this.effectsManager.calculateEffect(EffectType.SIZE_UNLIMIT, effectContext).value > 0;
    const configuredSize = this.effectsManager.calculateEffect(
      EffectType.SIZE_ADJ,
      effectContext
    ).value;
    const sizeLimit = unlimited ? Number.POSITIVE_INFINITY : configuredSize;
    if (city.population >= sizeLimit) {
      city.foodStock = Math.min(newFoodStock, granarySize);
      return;
    }
    const oldSize = city.population;
    city.population += 1;
    city.size = city.population;
    const retention = this.effectsManager.calculateEffect(EffectType.GROWTH_FOOD, {
      ...effectContext,
      // Freeciv evaluates granary savings before increasing city size.
      cityPopulation: oldSize,
    }).value;
    city.foodStock = raptureGrowth
      ? Math.min(newFoodStock, this.calculateGranarySize(city.population))
      : newFoodStock - granarySize + Math.floor((granarySize * retention) / 100);
    logger.info(`City ${city.name} grew from size ${oldSize} to ${city.population}`);
    if (!(await this.dependencies.reconcileCitizenAssignments(city.id, 'growth'))) {
      throw new Error(`Failed to reconcile citizens after growth in ${city.name}`);
    }
    this.dependencies.callbacks.onCityGrowth?.(city, oldSize);
    this.dependencies.onGameplayEvent?.({ type: 'growth', city, oldSize });
  }

  private async processStarvation(city: CityState): Promise<void> {
    city.foodStock = 0;
    if (city.population <= 1) {
      await this.dependencies.destroyCity(city.id);
      return;
    }
    const oldSize = city.population;
    const retention = this.effectsManager.calculateEffect(EffectType.SHRINK_FOOD, {
      playerId: city.playerId,
      cityId: city.id,
      cityBuildings: new Set(city.buildings),
      // Freeciv evaluates shrink savings before reducing city size.
      cityPopulation: oldSize,
    }).value;
    city.population -= 1;
    city.size = city.population;
    city.foodStock = Math.floor((this.calculateGranarySize(city.population) * retention) / 100);
    if (!(await this.dependencies.reconcileCitizenAssignments(city.id, 'starvation'))) {
      throw new Error(`Failed to reconcile citizens after starvation in ${city.name}`);
    }
    logger.info(`City ${city.name} starved and lost population`);
  }

  private isHappy(city: CityState): boolean {
    return (
      city.population >= 3 &&
      city.happiness.unhappy === 0 &&
      city.happiness.angry === 0 &&
      city.happiness.happy >= Math.ceil(city.population / 2)
    );
  }

  /**
   * Process production accumulation and completion
   */
  private async processProduction(city: CityState, _currentTurn: number): Promise<void> {
    if (!this.ensureProductionTarget(city)) return;

    // Wealth is an indefinite conversion mode, not a project. Its shield
    // output is converted to gold during city output calculation, so it must
    // never accumulate shields or complete at the ruleset's 999 sentinel cost.
    if (this.isWealthProduction(city)) return;

    const productionPerTurn = city.productionPerTurn || 0;
    const currentProductionStock = city.productionStock ?? city.shieldStock ?? 0;
    const newProductionStock = currentProductionStock + productionPerTurn;

    const productionCostResult = this.getProductionCost(city);
    const productionCost = productionCostResult.cost;
    const productionIsValid = productionCostResult.valid;

    if (!productionIsValid) {
      this.clearProduction(city);
      return;
    }

    if (productionCost <= 0) {
      return this.processProductionWithCost(city, 1, productionPerTurn, newProductionStock);
    }

    return this.processProductionWithCost(
      city,
      productionCost,
      productionPerTurn,
      newProductionStock
    );
  }

  private clearProduction(city: CityState): void {
    logger.warn(`Clearing invalid production for city ${city.name}`);
    city.currentProduction = null;
    city.productionType = null;
    city.productionStock = 0;
    city.shieldStock = 0;
    city.turnsToComplete = 0;
  }

  private async processProductionWithCost(
    city: CityState,
    productionCost: number,
    productionPerTurn: number,
    newProductionStock: number
  ): Promise<void> {
    if (newProductionStock >= productionCost) {
      const populationCost =
        city.productionType === 'unit'
          ? (this.unitTypes[city.currentProduction!]?.pop_cost ?? 0)
          : 0;
      // Population-cost units may be queued before the city is large enough.
      // At full stock Freeciv leaves the production in place until a later
      // turn when the city can pay the population cost.
      // @reference reference/freeciv/server/cityturn.c:2976-2997
      if (populationCost > 0 && city.population <= populationCost) {
        city.productionStock = newProductionStock;
        city.shieldStock = newProductionStock;
        city.turnsToComplete = 0;
        logger.debug(
          `City ${city.name} is ready to build ${city.currentProduction}, but is too small`,
          {
            cityId: city.id,
            population: city.population,
            populationCost,
          }
        );
        return;
      }
      // Production completed
      city.productionStock = newProductionStock;
      city.shieldStock = newProductionStock;
      if (populationCost > 0) {
        city.population -= populationCost;
        city.size = city.population;
        if (!(await this.dependencies.reconcileCitizenAssignments(city.id, 'unit_built'))) {
          throw new Error(`Failed to reconcile citizens after unit production in ${city.name}`);
        }
      }
      await this.completeProduction(city.id, productionCost);
    } else {
      city.productionStock = newProductionStock;
      city.shieldStock = newProductionStock;
      city.turnsToComplete = Math.ceil(
        (productionCost - newProductionStock) / Math.max(1, productionPerTurn)
      );
    }
  }

  private ensureProductionTarget(city: CityState): boolean {
    if (city.currentProduction && !city.productionType) {
      if (city.currentProduction === 'capitalization') return true;
      if (this.unitTypes[city.currentProduction]) {
        city.productionType = 'unit';
      } else if (this.buildingTypes[city.currentProduction]) {
        city.productionType = 'building';
      } else {
        this.clearProduction(city);
        return false;
      }
    }

    while (!city.currentProduction && city.worklist.length > 0) {
      const next = city.worklist.shift() as ProductionItem;
      const nextType = next.kind === 'wonder' ? 'building' : next.kind;
      const exists =
        nextType === 'unit'
          ? Boolean(this.unitTypes[next.value])
          : Boolean(this.buildingTypes[next.value]);
      const allowed =
        this.dependencies.canCityContinueProduction?.(city.id, nextType, next.value) ?? true;
      if (exists && allowed) {
        city.currentProduction = next.value;
        city.productionType = nextType;
      }
    }
    return Boolean(city.currentProduction);
  }

  private isWealthProduction(city: CityState): boolean {
    if (city.currentProduction !== WEALTH_PRODUCTION_ID) return false;
    city.productionStock = 0;
    city.shieldStock = 0;
    city.turnsToComplete = 0;
    return true;
  }

  private getProductionCost(city: CityState): { cost: number; valid: boolean } {
    if (city.productionType === 'unit') {
      const unitType = this.unitTypes[city.currentProduction!];
      if (unitType) return { cost: unitType.cost || 0, valid: true };
      logger.error(`Invalid unit type in production for city ${city.name}`, {
        cityId: city.id,
        currentProduction: city.currentProduction,
      });
      return { cost: 0, valid: false };
    }
    if (city.productionType === 'building') {
      const building = this.buildingTypes[city.currentProduction!];
      if (building) return { cost: building.cost || 0, valid: true };
      logger.error(`Invalid building type in production for city ${city.name}`, {
        cityId: city.id,
        currentProduction: city.currentProduction,
      });
      return { cost: 0, valid: false };
    }
    logger.error(`Unknown production type for city ${city.name}`, {
      cityId: city.id,
      productionType: city.productionType,
    });
    return { cost: 0, valid: false };
  }

  /**
   * Handle production completion
   */
  private async completeProduction(cityId: string, productionCost: number): Promise<void> {
    const city = this.dependencies.cities.get(cityId);
    if (!city || !city.currentProduction) {
      return;
    }

    const completedProductionType = city.productionType as 'unit' | 'building' | 'wonder';
    const completedProductionId = city.currentProduction;
    this.addCompletedBuilding(city);
    if (completedProductionType === 'building') {
      this.dependencies.refreshCapitalStatus?.(city.playerId);
    }
    const productionItem: ProductionItem = {
      kind: city.productionType as 'unit' | 'building',
      value: city.currentProduction,
    };
    const completedCount = this.getCompletedProductionCount(city, productionCost);
    const remaining = Math.max(
      0,
      (city.productionStock ?? city.shieldStock ?? 0) - productionCost * completedCount
    );

    // A city may use multiple City_Build_Slots only for identical, ordinary
    // units. Freeciv does not let excess shields spill into a different
    // target in the same turn.
    // @reference reference/freeciv/common/city.c:747-801
    // @reference reference/freeciv/server/cityturn.c:3004-3062
    for (let index = 0; index < completedCount; index += 1) {
      await this.notifyProductionComplete(city, productionItem);
      if (index > 0 && city.worklist.length > 0) {
        city.worklist.shift();
      }
    }

    this.resetCompletedProduction(city, remaining);
    this.promoteProductionAfterCompletion(city);
    this.emitProductionComplete(cityId, completedProductionType, completedProductionId);
  }

  /**
   * Return the number of copies of the active unit that can be completed in
   * this turn. City_Build_Slots applies only to regular zero-population,
   * non-unique units and stops before the first different worklist target.
   * @reference reference/freeciv/common/city.c:747-801
   */
  private getCompletedProductionCount(city: CityState, productionCost: number): number {
    if (city.productionType !== 'unit' || !city.currentProduction || productionCost <= 0) return 1;

    const unitType = this.unitTypes[city.currentProduction];
    if (!unitType || (unitType.pop_cost ?? 0) > 0 || unitType.flags?.includes('Unique')) return 1;

    const configuredSlots = this.effectsManager.calculateEffect(EffectType.CITY_BUILD_SLOTS, {
      playerId: city.playerId,
      cityId: city.id,
      cityPopulation: city.population,
      cityBuildings: new Set(city.buildings),
      playerBuildings: new Set(
        [...this.dependencies.cities.values()]
          .filter(candidate => candidate.playerId === city.playerId)
          .flatMap(candidate => candidate.buildings)
      ),
      worldBuildings: new Set(
        [...this.dependencies.cities.values()].flatMap(candidate => candidate.buildings)
      ),
      government: this.dependencies.getPlayerGovernment?.(city.playerId),
    }).value;
    const slots = Math.max(1, configuredSlots);
    let shieldsLeft = city.productionStock ?? city.shieldStock ?? 0;
    let completed = 0;

    for (let index = 0; index < slots && shieldsLeft >= productionCost; index += 1) {
      completed += 1;
      shieldsLeft -= productionCost;
      const queued = city.worklist[index];
      if (queued && (queued.kind !== 'unit' || queued.value !== city.currentProduction)) break;
    }

    return Math.max(1, completed);
  }

  private addCompletedBuilding(city: CityState): void {
    if (
      city.productionType === 'building' &&
      !this.isSpaceshipPart(city, city.currentProduction!) &&
      !city.buildings.includes(city.currentProduction!)
    )
      city.buildings.push(city.currentProduction!);
  }

  /**
   * Freeciv consumes Special spaceship improvements at completion based on
   * their active SS_* effect, rather than on a fixed building identifier.
   *
   * @reference reference/freeciv/server/cityturn.c:2768-2779
   */
  private isSpaceshipPart(city: CityState, buildingId: string): boolean {
    return (
      spaceshipPartFromEffects(this.effectsManager, {
        playerId: city.playerId,
        cityId: city.id,
        buildingId,
        cityBuildings: new Set([...city.buildings, buildingId]),
        playerBuildings: new Set(
          [...this.dependencies.cities.values()]
            .filter(candidate => candidate.playerId === city.playerId)
            .flatMap(candidate => candidate.buildings)
        ),
        worldBuildings: new Set(
          [...this.dependencies.cities.values()].flatMap(candidate => candidate.buildings)
        ),
      }) !== undefined
    );
  }

  private resetCompletedProduction(city: CityState, remaining: number): void {
    city.currentProduction = null;
    city.productionType = null;
    city.productionStock = remaining;
    city.shieldStock = remaining;
    city.turnsToComplete = 0;
  }

  private async notifyProductionComplete(city: CityState, item: ProductionItem): Promise<void> {
    const callback = this.dependencies.callbacks.onCityProductionComplete;
    if (callback) await callback(city, item);
    this.dependencies.onGameplayEvent?.({ type: 'production_completed', city, item });
  }

  private promoteProductionAfterCompletion(city: CityState): void {
    while (city.worklist.length > 0 && !city.currentProduction) {
      const next = city.worklist.shift() as ProductionItem;
      const type = next.kind === 'wonder' ? 'building' : next.kind;
      const exists =
        type === 'unit'
          ? Boolean(this.unitTypes[next.value])
          : Boolean(this.buildingTypes[next.value]);
      const allowed =
        this.dependencies.canCityContinueProduction?.(city.id, type, next.value) ?? true;
      if (exists && allowed) {
        city.currentProduction = next.value;
        city.productionType = type;
      }
    }
  }

  private emitProductionComplete(cityId: string, type: string, productionId: string): void {
    if (!this.dependencies.io || !type || !productionId) return;
    logger.info('Production completed', {
      gameId: this.dependencies.gameId,
      cityId,
      productionType: type,
      productionId,
    });
    if (type === 'building')
      this.dependencies.io
        .to(`game:${this.dependencies.gameId}`)
        .emit('production:completed', { cityId, productionType: type, productionId });
  }

  /**
   * Calculate granary size needed for city growth
   */
  public calculateGranarySize(population: number, rulesetName: string = DEFAULT_RULESET): number {
    try {
      const civstyle = rulesetLoader.getCivstyle(rulesetName);
      const granaryFoodIni = civstyle.granary_food_ini;
      const granaryFoodInc = civstyle.granary_food_inc;

      // Freeciv permits a per-size initial-granary table as well as a
      // scalar-plus-increment form.
      if (Array.isArray(granaryFoodIni)) {
        return granaryFoodIni[Math.min(Math.max(0, population - 1), granaryFoodIni.length - 1)]!;
      }
      return granaryFoodIni + (population - 1) * granaryFoodInc;
    } catch {
      return [20, 20, 20, 20, 20, 30, 30, 40][Math.min(Math.max(0, population - 1), 7)]!;
    }
  }

  /**
   * Get turn processing performance metrics for debugging
   */
  getPerformanceMetrics(): {
    averageTurnTime: number;
    slowCities: string[];
    totalCitiesProcessed: number;
  } {
    // This would be implemented to track performance metrics over time
    // For now, return placeholder values
    return {
      averageTurnTime: 0,
      slowCities: [],
      totalCitiesProcessed: this.dependencies.cities.size,
    };
  }
}
