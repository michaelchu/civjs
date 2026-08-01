import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState } from '@game/managers/CityManager';
import {
  rulesetBuildingsService,
  type RulesetBuildingsService,
} from '@game/services/RulesetBuildingsService';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';

export interface CityCaptureResult {
  success: boolean;
  populationLoss: number;
  buildingsDestroyed: string[];
  cityDestroyed?: boolean;
  reason?: string;
}

/**
 * CityCaptureService - Manages city capture and transfer mechanics
 * Handles all city capture operations including:
 * - City conquest mechanics
 * - City transfer between players
 * - Population loss and building destruction
 * - Trade route cleanup after ownership changes
 */
export class CityCaptureService extends BaseGameService {
  constructor(
    private cities: Map<string, CityState>,
    private updateTradeRoutesOnPlayerChange: (
      cityId: string,
      newPlayerId: string,
      oldPlayerId: string
    ) => Promise<void>,
    private readonly buildingsService: Pick<
      RulesetBuildingsService,
      'getBuildingTypes'
    > = rulesetBuildingsService,
    private readonly random: RandomSource = Math.random,
    private readonly buildingTypes?: Readonly<Record<string, Pick<{ genus: string }, 'genus'>>>,
    private readonly reconcileCitizenAssignments?: (
      cityId: string,
      reason: string
    ) => Promise<boolean>
  ) {
    super(logger);
  }

  getServiceName(): string {
    return 'CityCaptureService';
  }

  /**
   * Capture a city in battle
   * @reference Original CityManager.captureCity()
   */
  public async captureCity(
    cityId: string,
    conquerorPlayerId: string,
    conquerorUnitId: string
  ): Promise<CityCaptureResult> {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        success: false,
        populationLoss: 0,
        buildingsDestroyed: [],
        reason: 'City not found',
      };
    }

    if (city.playerId === conquerorPlayerId) {
      return {
        success: false,
        populationLoss: 0,
        buildingsDestroyed: [],
        reason: 'Cannot capture own city',
      };
    }

    const originalPlayerId = city.playerId;
    const originalPopulation = city.population;
    const originalBuildings = [...city.buildings];
    const originalProductionStock = city.productionStock;
    const originalGovernorEnabled = city.governor?.isEnabled;
    const originalSpecialists = { ...city.specialists };
    const originalWorked = city.workableTiles?.map(tile => tile.isWorked);

    logger.info('Starting city capture', {
      cityId,
      cityName: city.name,
      originalPlayerId,
      conquerorPlayerId,
      conquerorUnitId,
      originalPopulation,
      buildingsCount: originalBuildings.length,
    });

    try {
      // A size-one city is destroyed by conquest. CityManager performs the
      // authoritative removal after this result so callbacks and persistence
      // follow the same path as every other city destruction.
      // @reference reference/freeciv/server/citytools.c:2037-2061
      if (city.population <= 1) {
        return {
          success: true,
          populationLoss: city.population,
          buildingsDestroyed: [...city.buildings],
          cityDestroyed: true,
        };
      }

      // Classic conquest reduces the transferred city by exactly one citizen.
      // @reference reference/freeciv/server/citytools.c:2135-2142
      const populationLoss = 1;
      city.population -= populationLoss;
      city.size = city.population;

      // Small wonders are removed during transfer. Great wonders and special
      // production targets survive; ordinary improvements use the classic
      // default razechance of 20 percent.
      // @reference reference/freeciv/server/citytools.c:924-950
      // @reference reference/freeciv/common/game.h:574
      const buildingsDestroyed = this.destroyBuildings(city);

      // Transfer ownership
      city.playerId = conquerorPlayerId;

      // Razing nullifies accumulated shields but keeps the chosen target.
      city.productionStock = 0;

      // Disable governor (needs to be reconfigured)
      if (city.governor) {
        city.governor.isEnabled = false;
      }

      // Update trade routes
      await this.updateTradeRoutesOnPlayerChange(cityId, conquerorPlayerId, originalPlayerId);
      await this.reconcileCapturedCity(cityId);

      logger.info('City capture completed', {
        cityId,
        cityName: city.name,
        newPlayerId: conquerorPlayerId,
        populationLoss,
        newPopulation: city.population,
        buildingsDestroyed,
        remainingBuildings: city.buildings.length,
      });

      return {
        success: true,
        populationLoss,
        buildingsDestroyed,
        cityDestroyed: false,
      };
    } catch (error) {
      city.playerId = originalPlayerId;
      city.population = originalPopulation;
      city.size = originalPopulation;
      city.buildings = originalBuildings;
      city.productionStock = originalProductionStock;
      city.specialists = originalSpecialists;
      city.workableTiles?.forEach((tile, index) => {
        tile.isWorked = originalWorked?.[index] ?? Boolean(tile.isCenter);
      });
      if (city.governor && originalGovernorEnabled !== undefined) {
        city.governor.isEnabled = originalGovernorEnabled;
      }
      logger.error('City capture failed', {
        cityId,
        cityName: city.name,
        conquerorPlayerId,
        error: error instanceof Error ? error.message : error,
      });

      return {
        success: false,
        populationLoss: 0,
        buildingsDestroyed: [],
        reason: 'Capture operation failed',
      };
    }
  }

  private async reconcileCapturedCity(cityId: string): Promise<void> {
    if (!this.reconcileCitizenAssignments) return;
    if (await this.reconcileCitizenAssignments(cityId, 'conquest')) return;
    throw new Error('Citizen reconciliation failed after conquest');
  }

  private destroyBuildings(city: CityState): string[] {
    const destroyed: string[] = [];
    const buildingTypes = this.buildingTypes ?? this.buildingsService.getBuildingTypes();
    city.buildings = city.buildings.filter(buildingId => {
      const genus = buildingTypes[buildingId]?.genus;
      if (genus !== 'SmallWonder' && !(genus === 'Improvement' && randomInt(this.random, 100) < 20))
        return true;
      destroyed.push(buildingId);
      return false;
    });
    return destroyed;
  }

  /**
   * Transfer city to another player (diplomacy/trade)
   * @reference Original CityManager.transferCity()
   */
  public async transferCity(cityId: string, newPlayerId: string): Promise<boolean> {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    if (city.playerId === newPlayerId) {
      return true; // Already owned by target player
    }

    const originalPlayerId = city.playerId;

    logger.info('Transferring city ownership', {
      cityId,
      cityName: city.name,
      fromPlayerId: originalPlayerId,
      toPlayerId: newPlayerId,
    });

    try {
      // Transfer ownership (peaceful transfer - no population loss)
      city.playerId = newPlayerId;

      // Disable governor (needs reconfiguration for new player)
      if (city.governor) {
        city.governor.isEnabled = false;
      }

      // Update trade routes
      await this.updateTradeRoutesOnPlayerChange(cityId, newPlayerId, originalPlayerId);

      logger.info('City transfer completed', {
        cityId,
        cityName: city.name,
        newPlayerId,
      });

      return true;
    } catch (error) {
      logger.error('City transfer failed', {
        cityId,
        cityName: city.name,
        newPlayerId,
        error: error instanceof Error ? error.message : error,
      });

      return false;
    }
  }

  /**
   * Calculate capture effects based on city size and defenses
   */
  public calculateCaptureEffects(cityId: string): {
    expectedPopulationLoss: number;
    buildingDestructionChance: number;
    resistanceTurns: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        expectedPopulationLoss: 0,
        buildingDestructionChance: 0,
        resistanceTurns: 0,
      };
    }

    return {
      expectedPopulationLoss: 1,
      buildingDestructionChance: 0.2,
      resistanceTurns: 0,
    };
  }

  /**
   * Handle city resistance after capture
   * During resistance, the city produces no output and cannot build
   */
  public applyCityResistance(cityId: string, resistanceTurns: number): boolean {
    const city = this.cities.get(cityId);
    if (!city) {
      return false;
    }

    // Add resistance status (would be tracked in full implementation)
    // For now, just log the resistance application
    logger.info('Applied city resistance after capture', {
      cityId,
      cityName: city.name,
      resistanceTurns,
    });

    // Stop all production during resistance
    city.currentProduction = null;
    city.productionType = null;
    city.turnsToComplete = 0;
    // city.shieldStock = 0; // Would be reset if property exists

    return true;
  }

  /**
   * Get cities that can be captured by a specific player
   */
  public getCapturableCities(playerId: string): CityState[] {
    const capturableCities: CityState[] = [];

    for (const [, city] of this.cities) {
      if (city.playerId !== playerId) {
        capturableCities.push(city);
      }
    }

    return capturableCities;
  }

  /**
   * Check if a city is currently under resistance
   * (This would be implemented with actual resistance tracking in full game)
   */
  public isCityUnderResistance(_cityId: string): boolean {
    // In full implementation, would check resistance turn counter
    // For now, return false (no resistance tracking)
    return false;
  }

  /**
   * Get city capture history
   * (Would track all captures in full implementation)
   */
  public getCityCaptureHistory(_cityId: string): Array<{
    turn: number;
    fromPlayerId: string;
    toPlayerId: string;
    method: 'capture' | 'transfer';
    populationLoss?: number;
    buildingsDestroyed?: string[];
  }> {
    // In full implementation, would return actual capture history
    return [];
  }

  /**
   * Estimate city capture difficulty
   */
  public estimateCaptureDifficulty(cityId: string): {
    difficulty: 'easy' | 'medium' | 'hard' | 'very_hard';
    defenseStrength: number;
    populationFactor: number;
    buildingFactor: number;
  } {
    const city = this.cities.get(cityId);
    if (!city) {
      return {
        difficulty: 'easy',
        defenseStrength: 0,
        populationFactor: 0,
        buildingFactor: 0,
      };
    }

    const defenseStrength = city.defenseStrength || 1;
    const populationFactor = city.population;
    const buildingFactor = city.buildings.length;

    const totalDifficulty = defenseStrength + populationFactor * 0.5 + buildingFactor * 0.3;

    let difficulty: 'easy' | 'medium' | 'hard' | 'very_hard';
    if (totalDifficulty < 5) {
      difficulty = 'easy';
    } else if (totalDifficulty < 10) {
      difficulty = 'medium';
    } else if (totalDifficulty < 20) {
      difficulty = 'hard';
    } else {
      difficulty = 'very_hard';
    }

    return {
      difficulty,
      defenseStrength,
      populationFactor,
      buildingFactor,
    };
  }
}
