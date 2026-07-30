import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
/**
 * Ruleset-native city disasters.
 *
 * @reference reference/freeciv/common/disaster.h
 * @reference reference/freeciv/server/cityturn.c:4398-4540
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseProvider } from '@database/DatabaseProvider';
import { disasters } from '@database/schema';
import type { CityManager, CityState } from './CityManager';
import type { EconomicManager } from '@game/systems/Economic/EconomicManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { logger } from '@utils/logger';

const DISASTER_BASE_RARITY = 1_000_000;
const CLASSIC_DISASTER_FREQUENCY = 10;

export type RulesetDisasterEffect =
  | 'DestroyBuilding'
  | 'ReducePopulation'
  | 'EmptyFoodStock'
  | 'EmptyProdStock'
  | 'Pollution'
  | 'Fallout'
  | 'ReducePopDestroy'
  | 'Robbery';

export interface AppliedDisasterEffect {
  effect: RulesetDisasterEffect;
  value: number;
  description: string;
}

export interface CityDisaster {
  success: boolean;
  cityId: string;
  cityName: string;
  type: string;
  severity: number;
  effects: AppliedDisasterEffect[];
  message: string;
  timestamp: number;
  error?: string;
}

interface RulesetRequirement {
  type: string;
  name: string;
  range: string;
  present?: boolean;
}

interface RulesetDisasterDefinition {
  id: string;
  name: string;
  frequency: number;
  requirements: RulesetRequirement[];
  effects: RulesetDisasterEffect[];
}

export interface DisasterConfig {
  enabled: boolean;
  frequency: number;
  definitions: RulesetDisasterDefinition[];
}

export class DisasterManager {
  constructor(
    private readonly gameId: string,
    private config: DisasterConfig,
    private readonly cityManager: CityManager,
    private readonly databaseProvider: DatabaseProvider,
    private readonly economicManager?: EconomicManager,
    private readonly random: () => number = Math.random
  ) {}

  static createRulesetConfig(
    rulesetName: string = DEFAULT_RULESET,
    frequency: number = CLASSIC_DISASTER_FREQUENCY
  ): DisasterConfig {
    const sections = rulesetLoader.loadGameRulesRuleset(rulesetName).disasters;
    return {
      enabled: frequency > 0,
      frequency,
      definitions: Object.entries(sections).map(([id, section]) => ({
        id,
        name: section.name,
        frequency: section.frequency,
        requirements: section.reqs ?? [],
        effects: (Array.isArray(section.effects)
          ? section.effects
          : [section.effects]) as RulesetDisasterEffect[],
      })),
    };
  }

  async checkPlayerDisasters(
    playerId: string,
    turn: number = 0,
    year: number = 0
  ): Promise<CityDisaster[]> {
    if (!this.config.enabled || this.config.frequency <= 0) return [];
    const occurred: CityDisaster[] = [];
    for (const city of this.cityManager.getPlayerCities(playerId)) {
      for (const definition of this.config.definitions) {
        if (!this.requirementsMet(city, definition.requirements)) continue;
        if (
          Math.floor(this.random() * DISASTER_BASE_RARITY) >=
          this.config.frequency * definition.frequency
        ) {
          continue;
        }
        const disaster = await this.applyDisaster(city, definition);
        occurred.push(disaster);
        await this.recordDisaster(disaster, turn, year);
      }
    }
    return occurred;
  }

  private requirementsMet(city: CityState, requirements: RulesetRequirement[]): boolean {
    return requirements.every(requirement => {
      let active = false;
      if (requirement.type === 'Building' && requirement.range === 'City') {
        const buildingId = this.resolveBuildingId(requirement.name);
        active = buildingId !== undefined && city.buildings.includes(buildingId);
      } else {
        logger.warn('Unsupported disaster requirement fails closed', {
          gameId: this.gameId,
          type: requirement.type,
          range: requirement.range,
        });
        return false;
      }
      return requirement.present === false ? !active : active;
    });
  }

  private resolveBuildingId(name: string): string | undefined {
    const normalized = name.toLowerCase();
    return Object.entries(rulesetLoader.getBuildings()).find(
      ([id, building]) =>
        id.toLowerCase() === normalized || building.name.toLowerCase() === normalized
    )?.[0];
  }

  private async applyDisaster(
    city: CityState,
    definition: RulesetDisasterDefinition
  ): Promise<CityDisaster> {
    const applied: AppliedDisasterEffect[] = [];
    for (const effect of definition.effects) {
      const result = await this.applyEffect(city, effect);
      if (result) applied.push(result);
    }
    return {
      success: true,
      cityId: city.id,
      cityName: city.name,
      type: definition.id,
      severity: 1,
      effects: applied,
      message: `${city.name} was hit by ${definition.name}.`,
      timestamp: Date.now(),
    };
  }

  private async applyEffect(
    city: CityState,
    effect: RulesetDisasterEffect
  ): Promise<AppliedDisasterEffect | undefined> {
    if (effect === 'ReducePopulation') {
      const changed = await this.cityManager.reducePopulationForDisaster(city.id);
      return changed
        ? { effect, value: 1, description: 'Population reduced by one citizen' }
        : undefined;
    }
    if (effect === 'DestroyBuilding') {
      const building = await this.cityManager.destroyDisasterBuilding(city.id, this.random);
      return building ? { effect, value: 1, description: `Destroyed ${building}` } : undefined;
    }
    if (effect === 'Pollution' || effect === 'Fallout') {
      const changed = await this.cityManager.placeDisasterExtra(
        city.id,
        effect === 'Pollution' ? 'pollution' : 'fallout',
        this.random
      );
      return changed
        ? { effect, value: 1, description: `Created ${effect.toLowerCase()}` }
        : undefined;
    }
    if (effect === 'Robbery') {
      if (!this.economicManager || (city.tradePerTurn ?? 0) <= 0) return undefined;
      const gold = await this.economicManager.getPlayerGold(city.playerId);
      const amount = Math.min(gold, (city.tradePerTurn ?? 0) * 5);
      if (amount <= 0) return undefined;
      const result = await this.economicManager.spendPlayerGold(
        city.playerId,
        amount,
        `Robbery in ${city.name}`,
        { cityId: city.id }
      );
      return result.success
        ? { effect, value: amount, description: `Stole ${amount} gold` }
        : undefined;
    }
    if (effect === 'EmptyFoodStock' || effect === 'EmptyProdStock') {
      const changed = await this.cityManager.emptyDisasterStock(
        city.id,
        effect === 'EmptyFoodStock' ? 'food' : 'production'
      );
      return changed ? { effect, value: 1, description: `Emptied city stock` } : undefined;
    }
    // ReducePopDestroy can remove a size-one city. No shipped classic disaster
    // uses it, so it remains safely inert until city-destruction callbacks can
    // be supplied without bypassing CityManager ownership cleanup.
    return undefined;
  }

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
      logger.error('Failed to record disaster', {
        gameId: this.gameId,
        cityId: disaster.cityId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  updateConfig(newConfig: Partial<DisasterConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  getConfig(): DisasterConfig {
    return {
      ...this.config,
      definitions: this.config.definitions.map(definition => ({ ...definition })),
    };
  }

  async getCityDisasterHistory(cityId: string, limit: number = 10): Promise<unknown[]> {
    return this.databaseProvider
      .getDatabase()
      .select()
      .from(disasters)
      .where(and(eq(disasters.gameId, this.gameId), eq(disasters.cityId, cityId)))
      .orderBy(desc(disasters.timestamp))
      .limit(limit);
  }
}
