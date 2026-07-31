import { eq, sql } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { games } from '@database/schema';
import type { MapManager } from '@game/managers/MapManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface ClimateState {
  warmingPressure: number;
  coolingPressure: number;
  warmingEvents: number;
  coolingEvents: number;
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

const DEFAULT_STATE: ClimateState = {
  warmingPressure: 0,
  coolingPressure: 0,
  warmingEvents: 0,
  coolingEvents: 0,
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
    ) => void
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
    state.warmingPressure += pollutionTiles;
    state.coolingPressure += falloutTiles;
    const warmingThreshold = Math.max(
      1,
      this.settings.warmingThreshold ?? ClimateManager.EVENT_THRESHOLD
    );
    const coolingThreshold = Math.max(
      1,
      this.settings.coolingThreshold ?? ClimateManager.EVENT_THRESHOLD
    );

    const warmingApplied =
      this.settings.enabled !== false && state.warmingPressure >= warmingThreshold;
    const coolingApplied =
      this.settings.enabled !== false && state.coolingPressure >= coolingThreshold;
    if (warmingApplied) {
      state.warmingPressure -= warmingThreshold;
      state.warmingEvents += 1;
    }
    if (coolingApplied) {
      state.coolingPressure -= coolingThreshold;
      state.coolingEvents += 1;
    }

    const transformedWarming = warmingApplied ? this.transformWorld('warming', tiles) : 0;
    const transformedCooling = coolingApplied ? this.transformWorld('cooling', tiles) : 0;
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

  private transformWorld(direction: 'warming' | 'cooling', tiles: any[]): number {
    let transformed = 0;
    for (const tile of tiles) {
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
