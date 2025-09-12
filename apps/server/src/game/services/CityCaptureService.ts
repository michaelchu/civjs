import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import type { CityState, SpecialistType } from '@game/managers/CityManager';

/**
 * CityCaptureService - Manages city capture and transfer mechanics
 * @reference docs/refactor/REFACTORING_PLAN.md - CityManager refactoring
 *
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
    ) => Promise<void>
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
  ): Promise<{
    success: boolean;
    populationLoss: number;
    buildingsDestroyed: string[];
    reason?: string;
  }> {
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
      // Calculate population loss (20-40% of population typically)
      const populationLossPercentage = 0.2 + Math.random() * 0.2; // 20-40%
      const populationLoss = Math.floor(city.population * populationLossPercentage);
      city.population = Math.max(1, city.population - populationLoss);

      // Calculate building destruction
      const buildingsDestroyed: string[] = [];
      const buildingDestructionChance = 0.3; // 30% chance per building

      city.buildings = city.buildings.filter(building => {
        const buildingId = typeof building === 'string' ? building : building.id;
        if (Math.random() < buildingDestructionChance) {
          buildingsDestroyed.push(buildingId);
          return false;
        }
        return true;
      });

      // Transfer ownership
      city.playerId = conquerorPlayerId;

      // Reset city state (note: some properties may not exist in current CityState interface)
      // city.foodStock = 0; // Would be reset if property exists
      // city.shieldStock = 0; // Would be reset if property exists
      city.currentProduction = null;
      city.productionType = null;
      city.turnsToComplete = 0;

      // Reset happiness (conquest causes unrest)
      city.happiness = {
        happy: 0,
        content: Math.max(0, city.population - 2),
        unhappy: Math.min(2, city.population),
        angry: 0,
      };

      // Clear specialists (they flee during conquest)
      Object.keys(city.specialists).forEach(key => {
        const specialistType = parseInt(key) as SpecialistType;
        city.specialists[specialistType] = 0;
      });

      // Disable governor (needs to be reconfigured)
      if (city.governor) {
        city.governor.isEnabled = false;
      }

      // Update trade routes
      await this.updateTradeRoutesOnPlayerChange(cityId, conquerorPlayerId, originalPlayerId);

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
      };
    } catch (error) {
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

    // Larger cities lose more population in conquest
    const basePopulationLossPercentage = 0.2; // 20% base
    const sizeModifier = Math.min(0.2, city.population * 0.02); // Up to 20% more for large cities
    const expectedPopulationLossPercentage = basePopulationLossPercentage + sizeModifier;
    const expectedPopulationLoss = Math.floor(city.population * expectedPopulationLossPercentage);

    // Building destruction chance affected by city defenses
    let buildingDestructionChance = 0.3; // 30% base chance

    // Cities with walls are better protected
    if (city.buildings.includes('walls')) {
      buildingDestructionChance *= 0.7; // Reduce by 30%
    }

    // Fortifications also help
    if (city.buildings.includes('fortress')) {
      buildingDestructionChance *= 0.8; // Reduce by 20%
    }

    // Resistance turns (simplified calculation)
    const resistanceTurns = Math.max(1, Math.floor(city.population / 2));

    return {
      expectedPopulationLoss,
      buildingDestructionChance,
      resistanceTurns,
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
