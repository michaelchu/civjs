/**
 * CityHappinessService - Handles all city happiness calculations
 *
 * Extracted from CityManager.ts to create a dedicated service for the happiness subsystem.
 * This service handles all aspects of city happiness including:
 * - Base population happiness calculations
 * - Specialist (Entertainer) happiness effects
 * - Building happiness effects
 * - Unit-based happiness effects (martial law)
 * - Luxury resource effects
 * - Overall happiness state evaluation
 *
 * @reference freeciv/common/city.c - city happiness calculations
 * @reference freeciv-web/javascript/city.js - happiness and luxury effects
 */

import { logger } from '@utils/logger';
import { BaseGameService } from '@game/orchestrators/GameService';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import { rulesetBuildingsService } from './RulesetBuildingsService';
import {
  SpecialistType,
  SPECIALIST_TYPES,
  type SpecialistDefinition,
} from '@game/constants/SpecialistDefinitions';

// Re-export shared types and constants
export interface CityState {
  id: string;
  name: string;
  x: number;
  y: number;
  playerId: string;
  population: number;
  size: number;
  buildings: string[];
  specialists: Record<number, number>;
  happiness: {
    happy: number;
    content: number;
    unhappy: number;
    angry: number;
  };
  [key: string]: any; // For other city properties
}

export interface Happiness {
  happy: number;
  content: number;
  unhappy: number;
  angry: number;
}

// Happiness calculation stages (following Freeciv model)
export const FEELING_BASE = 0; // before any of the modifiers below
export const FEELING_LUXURY = 1; // after luxury
export const FEELING_EFFECT = 2; // after building effects
export const FEELING_NATIONALITY = 3; // after citizen nationality effects
export const FEELING_MARTIAL = 4; // after units enforce martial order
export const FEELING_FINAL = 5; // after wonders (final result)

export { SpecialistType, SPECIALIST_TYPES, type SpecialistDefinition };

/**
 * Detailed happiness calculation result with breakdown
 */
export interface DetailedHappiness {
  stage: number;
  happy: number;
  content: number;
  unhappy: number;
  angry: number;
  luxuryEffect: number;
  buildingEffect: number;
  unitEffect: number;
}

/**
 * Happiness analysis for city management recommendations
 */
export interface HappinessAnalysis {
  currentState: 'happy' | 'content' | 'unhappy' | 'rioting';
  stabilityRisk: 'low' | 'medium' | 'high' | 'critical';
  recommendedActions: Array<{
    action: 'build_temple' | 'add_entertainer' | 'increase_luxury' | 'add_military';
    priority: 'low' | 'medium' | 'high';
    expectedImprovement: number;
    description: string;
  }>;
}

/**
 * CityHappinessService handles all city happiness calculations and analysis
 */
export class CityHappinessService extends BaseGameService {
  private readonly effectsManager: EffectsManager;
  private playerTechsProvider: (playerId: string) => ReadonlySet<string> = () => new Set();
  private playerBuildingsProvider: (playerId: string) => ReadonlySet<string> = () => new Set();
  private playerGovernmentProvider?: (playerId: string) => string;

  setPlayerTechsProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.playerTechsProvider = provider;
  }

  setPlayerBuildingsProvider(provider: (playerId: string) => ReadonlySet<string>): void {
    this.playerBuildingsProvider = provider;
  }

  setPlayerGovernmentProvider(provider: (playerId: string) => string): void {
    this.playerGovernmentProvider = provider;
  }

  private getPlayerGovernment(playerId: string): string {
    if (!this.playerGovernmentProvider) {
      throw new Error(`No government provider configured for player '${playerId}'`);
    }
    const government = this.playerGovernmentProvider(playerId);
    if (!government) {
      throw new Error(`No government found for player '${playerId}'`);
    }
    return government;
  }

  constructor(effectsManager: EffectsManager) {
    super(logger);
    this.effectsManager = effectsManager;
  }

  getServiceName(): string {
    return 'CityHappinessService';
  }

  /**
   * Calculate detailed happiness breakdown for a city
   * @param city City state data
   * @param luxuryFromTrade Additional luxury from trade allocation (optional)
   * @param militaryUnitsPresent Number of military units for martial law (optional)
   * @returns Detailed happiness calculation with breakdown
   */
  calculateDetailedHappiness(
    city: CityState,
    luxuryFromTrade: number = 0,
    militaryUnitsPresent: number = 0,
    militaryUnhappiness: number = 0
  ): DetailedHappiness {
    if (!city) {
      return {
        stage: FEELING_FINAL,
        happy: 0,
        content: 0,
        unhappy: 0,
        angry: 0,
        luxuryEffect: 0,
        buildingEffect: 0,
        unitEffect: 0,
      };
    }

    const effectContext = {
      playerId: city.playerId,
      cityId: city.id,
      government: this.getPlayerGovernment(city.playerId),
      cityBuildings: new Set(city.buildings),
      playerTechs: new Set(this.playerTechsProvider(city.playerId)),
      playerBuildings: new Set(this.playerBuildingsProvider(city.playerId)),
    };

    // Specialists are removed before Freeciv creates the base citizen mood.
    // @reference reference/freeciv/common/city.c:2507-2536 citizen_base_mood()
    const specialistCount = Object.values(city.specialists).reduce(
      (total, count) => total + Math.max(0, count),
      0
    );
    const ordinaryCitizens = Math.max(0, city.population - specialistCount);
    const baseContent = this.effectsManager.calculateEffect(
      EffectType.CITY_UNHAPPY_SIZE,
      effectContext
    ).value;

    // Start with ruleset-driven base population happiness.
    let happy = 0;
    let content = Math.min(ordinaryCitizens, Math.max(0, baseContent));
    let unhappy = Math.max(0, ordinaryCitizens - content);
    const angry = 0;

    // Calculate entertainer luxury through the loaded Specialist_Output effect.
    // @reference reference/freeciv/data/classic/effects.ruleset:92-99
    const luxurySpecialists = city.specialists[SpecialistType.ENTERTAINER] || 0;
    const luxuryEffect =
      luxurySpecialists *
      this.effectsManager.calculateEffect(EffectType.SPECIALIST_OUTPUT, {
        ...effectContext,
        specialist: SPECIALIST_TYPES[SpecialistType.ENTERTAINER].ruleName,
        outputType: OutputType.LUXURY,
      }).value;

    // Add luxury from trade allocation
    const totalLuxury = luxuryEffect + luxuryFromTrade;

    // Calculate building happiness effects
    const buildingEffect = this.effectsManager.calculateEffect(
      EffectType.MAKE_CONTENT,
      effectContext
    ).value;

    // Calculate military unit effects from government-specific martial law.
    // @reference reference/freeciv/common/city.c:3108-3174 city_support()
    const unitEffect = this.effectsManager.calculateMartialLaw(
      effectContext,
      militaryUnitsPresent
    ).happyBonus;

    const contentToApply = Math.min(buildingEffect + unitEffect, unhappy);
    unhappy -= contentToApply;
    content += contentToApply;

    const additionalUnhappiness = Math.max(0, militaryUnhappiness);
    const madeUnhappy = Math.min(additionalUnhappiness, content);
    content -= madeUnhappy;
    unhappy += madeUnhappy;

    // Freeciv spends two luxury points per citizen mood improvement and can
    // continue improving content citizens into happy citizens.
    // @reference reference/freeciv/common/city.c:2545-2623 citizen_happy_luxury()
    let luxurySteps = Math.floor(totalLuxury / 2);
    const calmedByLuxury = Math.min(luxurySteps, unhappy);
    unhappy -= calmedByLuxury;
    content += calmedByLuxury;
    luxurySteps -= calmedByLuxury;
    const madeHappy = Math.min(luxurySteps, content);
    content -= madeHappy;
    happy += madeHappy;

    return {
      stage: FEELING_FINAL,
      happy,
      content,
      unhappy,
      angry,
      luxuryEffect: totalLuxury,
      buildingEffect,
      unitEffect,
    };
  }

  /**
   * Calculate basic happiness for a city
   * @param city City state data
   * @param luxuryFromTrade Additional luxury from trade (optional)
   * @param militaryUnitsPresent Military units for martial law (optional)
   * @returns Basic happiness state
   */
  calculateHappiness(
    city: CityState,
    luxuryFromTrade: number = 0,
    militaryUnitsPresent: number = 0,
    militaryUnhappiness: number = 0
  ): Happiness {
    const detailedHappiness = this.calculateDetailedHappiness(
      city,
      luxuryFromTrade,
      militaryUnitsPresent,
      militaryUnhappiness
    );
    return {
      happy: detailedHappiness.happy,
      content: detailedHappiness.content,
      unhappy: detailedHappiness.unhappy,
      angry: detailedHappiness.angry,
    };
  }

  /**
   * Check if a city is unhappy (has unhappy or angry citizens)
   * @param city City state data
   * @returns True if city has unhappy citizens
   */
  isCityUnhappy(city: CityState): boolean {
    const happiness = this.calculateHappiness(city);
    return happiness.unhappy > 0 || happiness.angry > 0;
  }

  /**
   * Get a descriptive string for city happiness state
   * @param city City state data
   * @returns Description of city happiness
   */
  getCityStateDescription(city: CityState): string {
    if (!city) return 'Unknown city';

    const happiness = this.calculateHappiness(city);
    const isUnhappy = happiness.unhappy > 0 || happiness.angry > 0;

    return `${city.name} (Pop: ${city.population}, ${isUnhappy ? 'Unhappy' : 'Content'})`;
  }

  /**
   * Apply calculated happiness to city state (mutates city object)
   * @param city City state data to update
   * @param luxuryFromTrade Additional luxury from trade (optional)
   * @param militaryUnitsPresent Military units for martial law (optional)
   */
  applyCityHappiness(
    city: CityState,
    luxuryFromTrade: number = 0,
    militaryUnitsPresent: number = 0,
    militaryUnhappiness: number = 0
  ): void {
    if (!city) return;

    const detailedHappiness = this.calculateDetailedHappiness(
      city,
      luxuryFromTrade,
      militaryUnitsPresent,
      militaryUnhappiness
    );
    city.happiness = {
      happy: detailedHappiness.happy,
      content: detailedHappiness.content,
      unhappy: detailedHappiness.unhappy,
      angry: detailedHappiness.angry,
    };
  }

  /**
   * Analyze city happiness and provide management recommendations
   * @param city City state data
   * @returns Happiness analysis with recommendations
   */
  analyzeHappiness(city: CityState): HappinessAnalysis {
    const happiness = this.calculateHappiness(city);

    // Determine current state
    let currentState: 'happy' | 'content' | 'unhappy' | 'rioting';
    let stabilityRisk: 'low' | 'medium' | 'high' | 'critical';

    if (happiness.angry > 0) {
      currentState = 'rioting';
      stabilityRisk = 'critical';
    } else if (happiness.unhappy > 0) {
      currentState = 'unhappy';
      stabilityRisk = happiness.unhappy > 2 ? 'high' : 'medium';
    } else if (happiness.happy > 0) {
      currentState = 'happy';
      stabilityRisk = 'low';
    } else {
      currentState = 'content';
      stabilityRisk = 'low';
    }

    // Generate recommendations
    const recommendedActions: HappinessAnalysis['recommendedActions'] = [];

    if (happiness.unhappy > 0) {
      // Recommend building happiness buildings if not present
      if (!city.buildings.includes('temple')) {
        recommendedActions.push({
          action: 'build_temple',
          priority: 'high',
          expectedImprovement: 2,
          description: 'Build Temple to make 2 unhappy citizens content',
        });
      }

      // Recommend adding entertainers if population allows
      if (city.population > 2) {
        recommendedActions.push({
          action: 'add_entertainer',
          priority: 'medium',
          expectedImprovement: 3,
          description: 'Convert citizen to Entertainer for +3 luxury',
        });
      }

      // Recommend increasing luxury tax if trade available
      if (city.tradePerTurn && (city as any).tradePerTurn > 0) {
        recommendedActions.push({
          action: 'increase_luxury',
          priority: 'medium',
          expectedImprovement: Math.floor((city as any).tradePerTurn / 2),
          description: 'Increase luxury tax allocation to improve happiness',
        });
      }

      // Recommend military units for martial law in dire situations
      if (happiness.unhappy > 3) {
        recommendedActions.push({
          action: 'add_military',
          priority: 'high',
          expectedImprovement: Math.min(happiness.unhappy, 2),
          description: 'Station military units for martial law',
        });
      }
    }

    return {
      currentState,
      stabilityRisk,
      recommendedActions,
    };
  }

  /**
   * Calculate happiness efficiency (contentment per population)
   * @param city City state data
   * @returns Happiness efficiency metrics
   */
  calculateHappinessEfficiency(city: CityState): {
    contentmentRatio: number; // (happy + content) / population
    happinessIndex: number; // 0-100 scale
    stabilityScore: number; // 0-100 scale (higher is more stable)
  } {
    const happiness = this.calculateHappiness(city);
    const population = Math.max(1, city.population);

    const contentmentRatio = (happiness.happy + happiness.content) / population;
    const happinessIndex = Math.round(contentmentRatio * 100);

    // Stability score considers unhappy and angry citizens more heavily
    const stabilityPenalty = happiness.unhappy * 20 + happiness.angry * 50;
    const stabilityScore = Math.max(0, 100 - stabilityPenalty);

    return {
      contentmentRatio,
      happinessIndex,
      stabilityScore,
    };
  }

  /**
   * Predict happiness after potential changes
   * @param city Current city state
   * @param changes Potential changes to evaluate
   * @returns Predicted happiness after changes
   */
  predictHappinessAfterChanges(
    city: CityState,
    changes: {
      additionalEntertainers?: number;
      newBuildings?: string[];
      additionalLuxury?: number;
      additionalMilitary?: number;
      populationChange?: number;
    }
  ): DetailedHappiness {
    // Create a copy of city state with changes applied
    const modifiedCity = { ...city };

    if (changes.populationChange) {
      modifiedCity.population += changes.populationChange;
      modifiedCity.size = modifiedCity.population;
    }

    if (changes.additionalEntertainers) {
      modifiedCity.specialists = { ...city.specialists };
      modifiedCity.specialists[SpecialistType.ENTERTAINER] =
        (modifiedCity.specialists[SpecialistType.ENTERTAINER] || 0) +
        changes.additionalEntertainers;
    }

    if (changes.newBuildings) {
      modifiedCity.buildings = [...city.buildings, ...changes.newBuildings];
    }

    const additionalLuxury = changes.additionalLuxury || 0;
    const additionalMilitary = changes.additionalMilitary || 0;

    return this.calculateDetailedHappiness(modifiedCity, additionalLuxury, additionalMilitary);
  }

  /**
   * Get happiness-related building recommendations for a city
   * @param city City state data
   * @returns Array of building recommendations
   */
  getHappinessBuildingRecommendations(city: CityState): Array<{
    buildingId: string;
    buildingName: string;
    happinessImprovement: number;
    cost: number;
    priority: 'low' | 'medium' | 'high';
  }> {
    const recommendations = [];
    const happiness = this.calculateHappiness(city);

    if (happiness.unhappy > 0) {
      const buildingTypes = rulesetBuildingsService.getBuildingTypes(
        this.effectsManager.getRulesetName()
      );
      const temple = buildingTypes.temple;
      const cathedral = buildingTypes.cathedral;
      const colosseum = buildingTypes.colosseum;

      // Recommend Temple if not built
      if (temple && !city.buildings.includes('temple')) {
        recommendations.push({
          buildingId: temple.id,
          buildingName: temple.name,
          happinessImprovement: 2,
          cost: temple.cost,
          priority: 'high' as const,
        });
      }

      // Recommend Cathedral if Temple exists but more happiness needed
      if (cathedral && city.buildings.includes('temple') && !city.buildings.includes('cathedral')) {
        recommendations.push({
          buildingId: cathedral.id,
          buildingName: cathedral.name,
          happinessImprovement: 3,
          cost: cathedral.cost,
          priority: 'medium' as const,
        });
      }

      // Recommend Colosseum for larger cities
      if (colosseum && city.population >= 6 && !city.buildings.includes('colosseum')) {
        recommendations.push({
          buildingId: colosseum.id,
          buildingName: colosseum.name,
          happinessImprovement: 3,
          cost: colosseum.cost,
          priority: 'medium' as const,
        });
      }
    }

    return recommendations;
  }
}
