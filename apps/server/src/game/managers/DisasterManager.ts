/**
 * @module server/game/managers/DisasterManager
 * Coordinates authoritative Disaster Manager game state.
 */
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
import type { MapTile } from '@game/map/MapTypes';
import type { MapManager } from '@game/managers/MapManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';
import { logger } from '@utils/logger';
import { tileHasRiver } from '@game/map/TerrainUtils';

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
  private readonly warnedUnsupportedRequirements = new Set<string>();

  constructor(
    private readonly gameId: string,
    private config: DisasterConfig,
    private readonly cityManager: CityManager,
    private readonly databaseProvider: DatabaseProvider,
    private readonly economicManager?: EconomicManager,
    private readonly random: RandomSource = Math.random,
    private readonly mapManager?: Pick<MapManager, 'getTile' | 'getNeighbors'>,
    private readonly rulesetName: string = DEFAULT_RULESET
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
          randomInt(this.random, DISASTER_BASE_RARITY) >=
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
      const active = this.evaluateRequirement(city, requirement);
      if (active === undefined) {
        const key = `${requirement.type}:${requirement.range}:${requirement.name}`;
        if (!this.warnedUnsupportedRequirements.has(key)) {
          this.warnedUnsupportedRequirements.add(key);
          logger.warn('Unsupported disaster requirement fails closed', {
            gameId: this.gameId,
            type: requirement.type,
            range: requirement.range,
          });
        }
        return false;
      }
      return requirement.present === false ? !active : active;
    });
  }

  /**
   * Evaluate the subset of the universal Freeciv requirement model that is
   * legal for disasters. The reference evaluates disaster requirements with
   * the owning player, city, and city-center tile as context; adjacent ranges
   * then inspect the map neighbors of that center tile.
   */
  private evaluateRequirement(
    city: CityState,
    requirement: RulesetRequirement
  ): boolean | undefined {
    if (requirement.type === 'Building' && requirement.range === 'City') {
      const buildingId = this.resolveBuildingId(requirement.name);
      return buildingId === undefined ? false : city.buildings.includes(buildingId);
    }

    if (requirement.type === 'MinSize' && requirement.range === 'City') {
      const minimum = Number(requirement.name);
      return Number.isFinite(minimum) ? city.size >= minimum : undefined;
    }

    if (
      (requirement.type === 'Terrain' || requirement.type === 'Extra') &&
      (requirement.range === 'Tile' || requirement.range === 'Adjacent')
    ) {
      const center = this.mapManager?.getTile(city.x, city.y);
      if (!center) return undefined;
      const candidates =
        requirement.range === 'Tile'
          ? [center]
          : [center, ...(this.mapManager?.getNeighbors(city.x, city.y) ?? [])];
      return candidates.some(tile =>
        requirement.type === 'Terrain'
          ? this.matchesTerrain(tile, requirement.name)
          : this.matchesExtra(tile, requirement.name)
      );
    }

    return undefined;
  }

  private matchesTerrain(tile: MapTile, name: string): boolean {
    const normalized = this.normalizeRuleName(name);
    const terrain = rulesetLoader.getTerrains(this.rulesetName)[tile.terrain];
    return (
      this.normalizeRuleName(tile.terrain) === normalized ||
      (terrain !== undefined && this.normalizeRuleName(terrain.name) === normalized)
    );
  }

  private matchesExtra(tile: MapTile, name: string): boolean {
    const normalized = this.normalizeRuleName(name);
    const river = normalized === 'river' && tileHasRiver(tile);
    if (river) return true;

    return tile.improvements.some(improvement => {
      const extra = rulesetLoader.getExtras(this.rulesetName)[improvement];
      return (
        this.normalizeRuleName(improvement) === normalized ||
        (extra !== undefined && this.normalizeRuleName(extra.name) === normalized)
      );
    });
  }

  private normalizeRuleName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private resolveBuildingId(name: string): string | undefined {
    const normalized = name.toLowerCase();
    return Object.entries(rulesetLoader.getBuildings(this.rulesetName)).find(
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
    const handlers: Record<string, () => Promise<AppliedDisasterEffect | undefined>> = {
      ReducePopulation: () => this.applyPopulationReduction(city, effect),
      DestroyBuilding: () => this.applyBuildingDestruction(city, effect),
      Pollution: () => this.applyExtra(city, effect, 'pollution'),
      Fallout: () => this.applyExtra(city, effect, 'fallout'),
      Robbery: () => this.applyRobbery(city, effect),
      EmptyFoodStock: () => this.emptyStock(city, effect, 'food'),
      EmptyProdStock: () => this.emptyStock(city, effect, 'production'),
    };
    return handlers[effect]?.();
  }

  private async applyPopulationReduction(
    city: CityState,
    effect: RulesetDisasterEffect
  ): Promise<AppliedDisasterEffect | undefined> {
    const changed = await this.cityManager.reducePopulationForDisaster(city.id);
    return changed
      ? { effect, value: 1, description: 'Population reduced by one citizen' }
      : undefined;
  }

  private async applyBuildingDestruction(
    city: CityState,
    effect: RulesetDisasterEffect
  ): Promise<AppliedDisasterEffect | undefined> {
    const building = await this.cityManager.destroyDisasterBuilding(city.id, this.random);
    return building ? { effect, value: 1, description: `Destroyed ${building}` } : undefined;
  }

  private async applyExtra(
    city: CityState,
    effect: RulesetDisasterEffect,
    extra: 'pollution' | 'fallout'
  ): Promise<AppliedDisasterEffect | undefined> {
    const changed = await this.cityManager.placeDisasterExtra(city.id, extra, this.random);
    return changed ? { effect, value: 1, description: `Created ${extra}` } : undefined;
  }

  private async applyRobbery(
    city: CityState,
    effect: RulesetDisasterEffect
  ): Promise<AppliedDisasterEffect | undefined> {
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

  private async emptyStock(
    city: CityState,
    effect: RulesetDisasterEffect,
    stock: 'food' | 'production'
  ): Promise<AppliedDisasterEffect | undefined> {
    const changed = await this.cityManager.emptyDisasterStock(city.id, stock);
    return changed ? { effect, value: 1, description: 'Emptied city stock' } : undefined;
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
