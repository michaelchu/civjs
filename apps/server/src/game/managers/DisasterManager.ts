/**
 * DisasterManager - Manages city disasters and catastrophic events
 *
 * This manager handles the random disasters that can affect cities during
 * turn processing, including earthquakes, fires, floods, plagues, and other
 * catastrophic events that can damage buildings, reduce population, or
 * create pollution/fallout.
 *
 * @reference freeciv/common/disaster.c - disaster types and effects
 * @reference freeciv/server/cityturn.c:4517 - check_disasters() implementation
 */

import { logger } from '@utils/logger';
import type { CityManager } from './CityManager';
import type { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import type { DatabaseProvider } from '@database/DatabaseProvider';
import { disasters } from '@database/schema';
import { eq, and, desc } from 'drizzle-orm';

export enum DisasterType {
  EARTHQUAKE = 'earthquake',
  FIRE = 'fire',
  FLOOD = 'flood',
  PLAGUE = 'plague',
  FAMINE = 'famine',
  TORNADO = 'tornado',
  VOLCANIC_ERUPTION = 'volcanic_eruption',
  NUCLEAR_ACCIDENT = 'nuclear_accident',
}

export enum DisasterEffect {
  POPULATION_LOSS = 'population_loss',
  BUILDING_DESTRUCTION = 'building_destruction',
  GOLD_THEFT = 'gold_theft', // Robbery effect
  POLLUTION_CREATION = 'pollution_creation',
  FALLOUT_CREATION = 'fallout_creation',
  PRODUCTION_LOSS = 'production_loss',
  FOOD_LOSS = 'food_loss',
}

export interface DisasterConfig {
  enabled: boolean;
  baseFrequency: number; // Base disaster frequency multiplier (0-100)
  disasterTypes: DisasterTypeConfig[];
}

export interface DisasterTypeConfig {
  type: DisasterType;
  frequency: number; // Relative frequency (0-100)
  severity: { min: number; max: number }; // Severity range (1-10)
  effects: DisasterEffectConfig[];
  requirements: DisasterRequirement[];
  message: string;
}

export interface DisasterEffectConfig {
  effect: DisasterEffect;
  intensity: number; // Effect intensity (0-100)
  chance: number; // Chance this effect occurs (0-100)
}

export interface DisasterRequirement {
  type: 'city_size' | 'building' | 'terrain' | 'technology' | 'population';
  operator: 'min' | 'max' | 'equals' | 'has' | 'not_has';
  value: any;
}

export interface CityDisaster {
  success: boolean;
  cityId: string;
  cityName: string;
  type: DisasterType;
  severity: number;
  effects: AppliedDisasterEffect[];
  message: string;
  timestamp: number;
  error?: string;
}

export interface AppliedDisasterEffect {
  effect: DisasterEffect;
  value: number; // Amount/intensity of effect
  description: string;
}

export interface DisasterCheckResult {
  playerId: string;
  disasters: CityDisaster[];
  citiesChecked: number;
  disastersApplied: number;
}

// Constants from freeciv disaster system
// @reference freeciv/common/disaster.h:46 DISASTER_BASE_RARITY 1000000
const DISASTER_BASE_RARITY = 1000000; // Base rarity divisor for disaster probability

export class DisasterManager {
  private gameId: string;
  private config: DisasterConfig;
  private cityManager: CityManager;
  // private broadcastManager: GameBroadcastManager; // Placeholder for future use
  private databaseProvider: DatabaseProvider;

  constructor(
    gameId: string,
    config: DisasterConfig,
    cityManager: CityManager,
    _broadcastManager: GameBroadcastManager,
    databaseProvider: DatabaseProvider
  ) {
    this.gameId = gameId;
    this.config = config;
    this.cityManager = cityManager;
    // this.broadcastManager = broadcastManager; // Placeholder for future use
    this.databaseProvider = databaseProvider;
  }

  /**
   * Check and apply disasters for a specific player's cities
   * @reference freeciv/server/cityturn.c:4517 check_disasters()
   */
  async checkPlayerDisasters(
    playerId: string,
    turn: number = 0,
    year: number = 0
  ): Promise<CityDisaster[]> {
    if (!this.config.enabled || this.config.baseFrequency === 0) {
      return [];
    }

    logger.debug('Checking disasters for player', {
      gameId: this.gameId,
      playerId,
      baseFrequency: this.config.baseFrequency,
    });

    const disasters: CityDisaster[] = [];

    try {
      // Get all cities for this player
      const cities = await this.cityManager.getPlayerCities(playerId);

      for (const city of cities) {
        // Check each disaster type for this city
        for (const disasterTypeConfig of this.config.disasterTypes) {
          const disaster = await this.checkCityDisaster(city, disasterTypeConfig);
          if (disaster) {
            disasters.push(disaster);

            if (disaster.success) {
              // Record disaster in database
              await this.recordDisaster(disaster, turn, year);
            }
          }
        }
      }

      if (disasters.length > 0) {
        logger.info('Disasters processed for player', {
          gameId: this.gameId,
          playerId,
          citiesChecked: cities.length,
          disastersOccurred: disasters.filter(d => d.success).length,
          totalChecks: disasters.length,
        });
      }
    } catch (error) {
      logger.error('Error checking disasters for player', {
        gameId: this.gameId,
        playerId,
        error: error instanceof Error ? error.message : error,
      });
    }

    return disasters;
  }

  /**
   * Check if a specific disaster occurs in a city
   * @reference freeciv/server/cityturn.c disaster probability calculation
   */
  private async checkCityDisaster(
    city: any,
    disasterConfig: DisasterTypeConfig
  ): Promise<CityDisaster | null> {
    const disaster: CityDisaster = {
      success: false,
      cityId: city.id,
      cityName: city.name,
      type: disasterConfig.type,
      severity: 0,
      effects: [],
      message: disasterConfig.message,
      timestamp: Date.now(),
    };

    try {
      // 1. Check if disaster requirements are met
      if (!(await this.checkDisasterRequirements(city, disasterConfig.requirements))) {
        return null; // Don't even attempt if requirements not met
      }

      // 2. Calculate disaster probability
      const probability = this.config.baseFrequency * disasterConfig.frequency;
      const roll = Math.floor(Math.random() * DISASTER_BASE_RARITY);

      logger.debug('Disaster probability check', {
        gameId: this.gameId,
        cityId: city.id,
        disasterType: disasterConfig.type,
        probability,
        roll,
        willOccur: roll < probability,
      });

      if (roll >= probability) {
        return null; // Disaster doesn't occur
      }

      // 3. Disaster occurs! Calculate severity
      disaster.severity =
        Math.floor(
          Math.random() * (disasterConfig.severity.max - disasterConfig.severity.min + 1)
        ) + disasterConfig.severity.min;

      // 4. Apply disaster effects
      disaster.effects = await this.applyDisasterEffects(
        city,
        disasterConfig.effects,
        disaster.severity
      );

      disaster.success = disaster.effects.length > 0;

      if (disaster.success) {
        logger.info('Disaster occurred', {
          gameId: this.gameId,
          cityId: city.id,
          cityName: city.name,
          disasterType: disaster.type,
          severity: disaster.severity,
          effectsApplied: disaster.effects.length,
        });
      }
    } catch (error) {
      disaster.error = error instanceof Error ? error.message : String(error);
      logger.error('Error processing city disaster', {
        gameId: this.gameId,
        cityId: city.id,
        disasterType: disasterConfig.type,
        error: disaster.error,
      });
    }

    return disaster;
  }

  /**
   * Check if disaster requirements are satisfied for a city
   */
  private async checkDisasterRequirements(
    city: any,
    requirements: DisasterRequirement[]
  ): Promise<boolean> {
    for (const req of requirements) {
      const satisfied = await this.checkSingleRequirement(city, req);
      if (!satisfied) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check a single disaster requirement
   */
  private async checkSingleRequirement(
    city: any,
    requirement: DisasterRequirement
  ): Promise<boolean> {
    switch (requirement.type) {
      case 'city_size':
        return this.compareValue(city.size, requirement.operator, requirement.value);

      case 'population':
        return this.compareValue(city.population, requirement.operator, requirement.value);

      case 'building':
        // const hasBuilding = await this.cityManager.cityHasBuilding(city.id, requirement.value);
        // return requirement.operator === 'has' ? hasBuilding : !hasBuilding;
        return true; // Placeholder

      case 'terrain':
        // const cityTerrain = await this.cityManager.getCityTerrain(city.id);
        // return requirement.operator === 'equals' ?
        //   cityTerrain === requirement.value :
        //   cityTerrain !== requirement.value;
        return true; // Placeholder

      case 'technology':
        // const hasTech = await this.cityManager.playerHasTechnology(city.playerId, requirement.value);
        // return requirement.operator === 'has' ? hasTech : !hasTech;
        return true; // Placeholder

      default:
        logger.warn('Unknown disaster requirement type', {
          gameId: this.gameId,
          requirementType: requirement.type,
          cityId: city.id,
        });
        return true; // Default to allowing if requirement type unknown
    }
  }

  /**
   * Compare values based on operator
   */
  private compareValue(actual: number, operator: string, expected: number): boolean {
    switch (operator) {
      case 'min':
        return actual >= expected;
      case 'max':
        return actual <= expected;
      case 'equals':
        return actual === expected;
      default:
        return true;
    }
  }

  /**
   * Apply disaster effects to a city
   */
  private async applyDisasterEffects(
    city: any,
    effectConfigs: DisasterEffectConfig[],
    severity: number
  ): Promise<AppliedDisasterEffect[]> {
    const appliedEffects: AppliedDisasterEffect[] = [];

    for (const effectConfig of effectConfigs) {
      // Check if this effect occurs
      const effectRoll = Math.random() * 100;
      if (effectRoll >= effectConfig.chance) {
        continue; // Effect doesn't occur
      }

      const effect = await this.applySingleEffect(city, effectConfig, severity);
      if (effect) {
        appliedEffects.push(effect);
      }
    }

    return appliedEffects;
  }

  /**
   * Apply a single disaster effect
   */
  private async applySingleEffect(
    city: any,
    effectConfig: DisasterEffectConfig,
    severity: number
  ): Promise<AppliedDisasterEffect | null> {
    const effectIntensity = (effectConfig.intensity * severity) / 10; // Scale by severity

    let effectValue = 0;
    let description = '';

    try {
      switch (effectConfig.effect) {
        case DisasterEffect.POPULATION_LOSS:
          effectValue = Math.floor((city.population || 10) * (effectIntensity / 100));
          effectValue = Math.min(effectValue, (city.population || 10) - 1); // Don't eliminate city
          if (effectValue > 0) {
            // await this.cityManager.reducePopulation(city.id, effectValue);
            description = `Lost ${effectValue} population`;
          }
          break;

        case DisasterEffect.BUILDING_DESTRUCTION: {
          // const buildings = await this.cityManager.getCityBuildings(city.id);
          const buildings: any[] = []; // Placeholder
          const buildingsToDestroy = Math.floor(buildings.length * (effectIntensity / 100));
          effectValue = buildingsToDestroy; // await this.cityManager.destroyRandomBuildings(city.id, buildingsToDestroy);
          description = `Destroyed ${effectValue} buildings`;
          break;
        }

        case DisasterEffect.GOLD_THEFT: {
          // const playerGold = await this.cityManager.getPlayerGold(city.playerId);
          const playerGold = 1000; // Placeholder
          effectValue = Math.floor(playerGold * (effectIntensity / 100));
          if (effectValue > 0) {
            // await this.cityManager.reducePlayerGold(city.playerId, effectValue);
            description = `Lost ${effectValue} gold to robbery`;
          }
          break;
        }

        case DisasterEffect.POLLUTION_CREATION:
          effectValue = Math.ceil(effectIntensity / 20); // Number of pollution tiles
          // await this.cityManager.addPollutionAroundCity(city.id, effectValue);
          description = `Created ${effectValue} pollution tiles`;
          break;

        case DisasterEffect.FALLOUT_CREATION:
          effectValue = Math.ceil(effectIntensity / 30); // Number of fallout tiles
          // await this.cityManager.addFalloutAroundCity(city.id, effectValue);
          description = `Created ${effectValue} fallout tiles`;
          break;

        case DisasterEffect.PRODUCTION_LOSS:
          effectValue = Math.floor((city.production || 10) * (effectIntensity / 100));
          if (effectValue > 0) {
            // await this.cityManager.reduceProduction(city.id, effectValue);
            description = `Lost ${effectValue} production`;
          }
          break;

        case DisasterEffect.FOOD_LOSS:
          effectValue = Math.floor((city.foodStorage || 10) * (effectIntensity / 100));
          if (effectValue > 0) {
            // await this.cityManager.reduceFoodStorage(city.id, effectValue);
            description = `Lost ${effectValue} stored food`;
          }
          break;

        default:
          logger.warn('Unknown disaster effect type', {
            gameId: this.gameId,
            effectType: effectConfig.effect,
            cityId: city.id,
          });
          return null;
      }

      if (effectValue > 0) {
        logger.debug('Applied disaster effect', {
          gameId: this.gameId,
          cityId: city.id,
          effect: effectConfig.effect,
          value: effectValue,
          description,
        });

        return {
          effect: effectConfig.effect,
          value: effectValue,
          description,
        };
      }
    } catch (error) {
      logger.error('Error applying disaster effect', {
        gameId: this.gameId,
        cityId: city.id,
        effect: effectConfig.effect,
        error: error instanceof Error ? error.message : error,
      });
    }

    return null;
  }

  /**
   * Record disaster occurrence in database
   */
  private async recordDisaster(disaster: CityDisaster, turn: number, year: number): Promise<void> {
    try {
      await this.databaseProvider
        .getDatabase()
        .insert(disasters)
        .values({
          gameId: this.gameId,
          cityId: disaster.cityId,
          cityName: disaster.cityName,
          type: disaster.type,
          severity: disaster.severity,
          effects: disaster.effects,
          turn,
          year,
          message: disaster.message,
          timestamp: new Date(disaster.timestamp),
        });
    } catch (error) {
      logger.error('Error recording disaster in database', {
        gameId: this.gameId,
        cityId: disaster.cityId,
        disasterType: disaster.type,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  /**
   * Get default disaster configuration
   */
  static getDefaultConfig(): DisasterConfig {
    return {
      enabled: true,
      baseFrequency: 10, // Low base frequency
      disasterTypes: [
        {
          type: DisasterType.EARTHQUAKE,
          frequency: 15,
          severity: { min: 3, max: 8 },
          effects: [
            { effect: DisasterEffect.POPULATION_LOSS, intensity: 20, chance: 80 },
            { effect: DisasterEffect.BUILDING_DESTRUCTION, intensity: 30, chance: 60 },
          ],
          requirements: [{ type: 'city_size', operator: 'min', value: 3 }],
          message: 'An earthquake has struck the city!',
        },
        {
          type: DisasterType.FIRE,
          frequency: 20,
          severity: { min: 2, max: 6 },
          effects: [
            { effect: DisasterEffect.POPULATION_LOSS, intensity: 15, chance: 70 },
            { effect: DisasterEffect.BUILDING_DESTRUCTION, intensity: 40, chance: 85 },
            { effect: DisasterEffect.PRODUCTION_LOSS, intensity: 25, chance: 50 },
          ],
          requirements: [{ type: 'city_size', operator: 'min', value: 2 }],
          message: 'A great fire has swept through the city!',
        },
        {
          type: DisasterType.FLOOD,
          frequency: 12,
          severity: { min: 3, max: 7 },
          effects: [
            { effect: DisasterEffect.POPULATION_LOSS, intensity: 18, chance: 75 },
            { effect: DisasterEffect.FOOD_LOSS, intensity: 60, chance: 90 },
            { effect: DisasterEffect.BUILDING_DESTRUCTION, intensity: 25, chance: 40 },
          ],
          requirements: [{ type: 'terrain', operator: 'equals', value: 'river' }],
          message: 'Flooding has devastated the city!',
        },
        {
          type: DisasterType.PLAGUE,
          frequency: 8,
          severity: { min: 4, max: 9 },
          effects: [
            { effect: DisasterEffect.POPULATION_LOSS, intensity: 35, chance: 95 },
            { effect: DisasterEffect.PRODUCTION_LOSS, intensity: 40, chance: 70 },
          ],
          requirements: [
            { type: 'city_size', operator: 'min', value: 4 },
            { type: 'population', operator: 'min', value: 10000 },
          ],
          message: 'A plague has spread throughout the city!',
        },
      ],
    };
  }

  /**
   * Update disaster configuration
   */
  updateConfig(newConfig: Partial<DisasterConfig>): void {
    this.config = { ...this.config, ...newConfig };

    logger.debug('Disaster configuration updated', {
      gameId: this.gameId,
      config: this.config,
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): DisasterConfig {
    return { ...this.config };
  }

  /**
   * Get disaster history for a city
   */
  async getCityDisasterHistory(cityId: string, limit: number = 10): Promise<any[]> {
    try {
      return await this.databaseProvider
        .getDatabase()
        .select()
        .from(disasters)
        .where(and(eq(disasters.gameId, this.gameId), eq(disasters.cityId, cityId)))
        .orderBy(desc(disasters.timestamp))
        .limit(limit);
    } catch (error) {
      logger.error('Error getting city disaster history', {
        gameId: this.gameId,
        cityId,
        error: error instanceof Error ? error.message : error,
      });
      return [];
    }
  }
}
