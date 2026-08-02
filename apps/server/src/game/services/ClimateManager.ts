/**
 * @module server/game/services/ClimateManager
 * Provides the server-side Climate Manager service.
 */
import { eq, sql } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { games } from '@database/schema';
import type { MapManager } from '@game/managers/MapManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { randomInt, type RandomSource } from '@game/random/FreecivRandom';

export interface ClimateState {
  warmingPressure: number;
  coolingPressure: number;
  warmingEvents: number;
  coolingEvents: number;
  warmingLevel: number;
  coolingLevel: number;
}

export interface ClimateTurnResult {
  pollutionTiles: number;
  falloutTiles: number;
  warmingApplied: boolean;
  coolingApplied: boolean;
  state: ClimateState;
}

export interface ClimateSettings {
  enabled?: boolean;
  warmingThreshold?: number;
  coolingThreshold?: number;
}

export function getClimateSettingsFromGameState(gameState: unknown): ClimateSettings | undefined {
  if (!gameState || typeof gameState !== 'object') return undefined;
  const settings = (gameState as { climateSettings?: unknown }).climateSettings;
  return settings && typeof settings === 'object' ? (settings as ClimateSettings) : undefined;
}

const DEFAULT_STATE: ClimateState = {
  warmingPressure: 0,
  coolingPressure: 0,
  warmingEvents: 0,
  coolingEvents: 0,
  warmingLevel: 0,
  coolingLevel: 0,
};

/**
 * Accumulates pollution and fallout pressure and applies the terrain results
 * declared by the active ruleset. The thresholds are intentionally explicit
 * and deterministic so a saved game cannot diverge because of an unseeded
 * climate roll.
 */
export class ClimateManager {
  static readonly EVENT_THRESHOLD = 100;

  constructor(
    private readonly gameId: string,
    private readonly mapManager: Pick<MapManager, 'getMapData' | 'updateTileProperty'>,
    private readonly databaseProvider: DatabaseProvider,
    private readonly rulesetName: string = 'civ2civ3',
    private readonly settings: ClimateSettings = {},
    private readonly onMapChanged?: (gameId: string, mapData: unknown) => void,
    private readonly onClimateEvent?: (
      gameId: string,
      event: 'warming' | 'cooling',
      transformedTiles: number
    ) => void,
    private readonly random: RandomSource = Math.random
  ) {}

  async processTurn(): Promise<ClimateTurnResult> {
    const mapData = this.mapManager.getMapData();
    const tiles = mapData?.tiles?.flat() ?? [];
    const pollutionTiles = tiles.filter(tile =>
      (tile.improvements ?? []).some(extra => extra.toLowerCase() === 'pollution')
    ).length;
    const falloutTiles = tiles.filter(tile =>
      (tile.improvements ?? []).some(extra => extra.toLowerCase() === 'fallout')
    ).length;
    const state = await this.loadState();
    const usesReferenceModel =
      this.settings.warmingThreshold === undefined && this.settings.coolingThreshold === undefined;
    const climateEnabled = this.settings.enabled !== false;
    const warming = climateEnabled
      ? usesReferenceModel
        ? this.processReferenceUpset('warming', pollutionTiles, tiles, state)
        : this.processThresholdUpset(
            'warming',
            pollutionTiles,
            tiles,
            state,
            this.settings.warmingThreshold
          )
      : { applied: false, transformed: 0 };
    const cooling = climateEnabled
      ? usesReferenceModel
        ? this.processReferenceUpset('cooling', falloutTiles, tiles, state)
        : this.processThresholdUpset(
            'cooling',
            falloutTiles,
            tiles,
            state,
            this.settings.coolingThreshold
          )
      : { applied: false, transformed: 0 };
    const warmingApplied = warming.applied;
    const coolingApplied = cooling.applied;
    const transformedWarming = warming.transformed;
    const transformedCooling = cooling.transformed;
    if (transformedWarming || transformedCooling) {
      this.onMapChanged?.(this.gameId, mapData);
    }
    await this.saveState(state);
    if (warmingApplied) this.onClimateEvent?.(this.gameId, 'warming', transformedWarming);
    if (coolingApplied) this.onClimateEvent?.(this.gameId, 'cooling', transformedCooling);

    return {
      pollutionTiles,
      falloutTiles,
      warmingApplied,
      coolingApplied,
      state,
    };
  }

  private processReferenceUpset(
    direction: 'warming' | 'cooling',
    extraCount: number,
    tiles: any[],
    state: ClimateState
  ): { applied: boolean; transformed: number } {
    const pressureKey = direction === 'warming' ? 'warmingPressure' : 'coolingPressure';
    const levelKey = direction === 'warming' ? 'warmingLevel' : 'coolingLevel';
    const eventKey = direction === 'warming' ? 'warmingEvents' : 'coolingEvents';
    const mapTileCount = Math.max(1, tiles.length);
    if (state[levelKey] <= 0) {
      state[levelKey] = Math.max(1, Math.ceil(mapTileCount / 500));
    }
    state[pressureKey] += extraCount;
    if (state[pressureKey] < state[levelKey]) {
      state[pressureKey] = 0;
      return { applied: false, transformed: 0 };
    }

    state[pressureKey] -= state[levelKey];
    const chanceBound = Math.max(1, Math.ceil(mapTileCount / 20));
    if (randomInt(this.random, chanceBound) >= state[pressureKey]) {
      return { applied: false, transformed: 0 };
    }

    const effect =
      Math.floor((this.mapManager.getMapData()?.width ?? 0) / 10) +
      Math.floor((this.mapManager.getMapData()?.height ?? 0) / 10) +
      state[pressureKey] * 5;
    const transformed = this.transformWorld(direction, tiles, effect);
    state[pressureKey] = 0;
    state[eventKey] += 1;
    state[levelKey] += Math.max(1, Math.ceil(mapTileCount / 1000));
    return { applied: true, transformed };
  }

  private processThresholdUpset(
    direction: 'warming' | 'cooling',
    extraCount: number,
    tiles: any[],
    state: ClimateState,
    thresholdOverride?: number
  ): { applied: boolean; transformed: number } {
    const pressureKey = direction === 'warming' ? 'warmingPressure' : 'coolingPressure';
    const eventKey = direction === 'warming' ? 'warmingEvents' : 'coolingEvents';
    const threshold = Math.max(1, thresholdOverride ?? ClimateManager.EVENT_THRESHOLD);
    state[pressureKey] += extraCount;
    if (state[pressureKey] < threshold) return { applied: false, transformed: 0 };
    state[pressureKey] -= threshold;
    state[eventKey] += 1;
    return { applied: true, transformed: this.transformWorld(direction, tiles, tiles.length) };
  }

  private transformWorld(direction: 'warming' | 'cooling', tiles: any[], effect: number): number {
    let transformed = 0;
    const candidates = [...tiles];
    while (effect > 0 && candidates.length > 0) {
      const [tile] = candidates.splice(randomInt(this.random, candidates.length), 1);
      if (!tile) continue;
      const terrain = rulesetLoader.getTerrain(tile.terrain, this.rulesetName) as any;
      const properties = terrain.properties ?? {};
      const wet = Number(properties.MG_WET ?? properties.wet ?? 0) > 0;
      const result =
        terrain[
          direction === 'warming'
            ? wet
              ? 'warmer_wetter_result'
              : 'warmer_drier_result'
            : wet
              ? 'cooler_wetter_result'
              : 'cooler_drier_result'
        ];
      if (typeof result !== 'string' || ['no', 'yes'].includes(result.toLowerCase())) continue;
      const nextTerrain = this.findTerrainName(result);
      if (!nextTerrain || nextTerrain === tile.terrain) continue;
      tile.terrain = nextTerrain;
      tile.improvements = (tile.improvements ?? []).filter(
        (extra: string) => !['pollution', 'fallout'].includes(extra.toLowerCase())
      );
      this.mapManager.updateTileProperty(tile.x, tile.y, 'terrain', nextTerrain);
      this.mapManager.updateTileProperty(tile.x, tile.y, 'improvements', tile.improvements);
      transformed += 1;
      effect -= 1;
    }
    return transformed;
  }

  private findTerrainName(name: string): string | undefined {
    const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return Object.keys(rulesetLoader.getTerrains(this.rulesetName)).find(
      terrainName => terrainName.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
    );
  }

  private async loadState(): Promise<ClimateState> {
    const record = await this.databaseProvider
      .getDatabase()
      .query.games.findFirst({ where: eq(games.id, this.gameId) });
    const stored = (record?.gameState as any)?.climate;
    return {
      warmingPressure: Number(stored?.warmingPressure ?? DEFAULT_STATE.warmingPressure),
      coolingPressure: Number(stored?.coolingPressure ?? DEFAULT_STATE.coolingPressure),
      warmingEvents: Number(stored?.warmingEvents ?? DEFAULT_STATE.warmingEvents),
      coolingEvents: Number(stored?.coolingEvents ?? DEFAULT_STATE.coolingEvents),
      warmingLevel: Number(stored?.warmingLevel ?? DEFAULT_STATE.warmingLevel),
      coolingLevel: Number(stored?.coolingLevel ?? DEFAULT_STATE.coolingLevel),
    };
  }

  private async saveState(state: ClimateState): Promise<void> {
    await this.databaseProvider
      .getDatabase()
      .update(games)
      .set({
        gameState: sql`coalesce(${games.gameState}, '{}'::jsonb) || ${JSON.stringify({ climate: state })}::jsonb`,
      })
      .where(eq(games.id, this.gameId));
  }
}
