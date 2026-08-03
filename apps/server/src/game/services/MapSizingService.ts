/**
 * @module server/game/services/MapSizingService
 * Resolves Freeciv-compatible map dimensions for player-sized games.
 *
 * @reference reference/freeciv/server/generator/mapgen_topology.c:63-125
 * @reference reference/freeciv/server/generator/mapgen_topology.c:160-223
 * @reference reference/freeciv/common/map.h:643-670
 */
import { normalizeTopologyId, TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import type { MapSizingMode } from '@game/runtime/GameTypes';
import {
  resolveRulesetMapSettings,
  type RulesetMapSettings,
} from '@game/services/RulesetTerrainDefaults';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export const FREECIV_WEB_MAX_AREA = 38_000;
export const FREECIV_MIN_LINEAR_SIZE = 16;
export const FREECIV_MAX_LINEAR_SIZE = Math.floor(FREECIV_WEB_MAX_AREA / FREECIV_MIN_LINEAR_SIZE);

export interface MapSizingMetadata {
  mode: MapSizingMode;
  mapsize: string;
  tilesPerPlayer: number;
  aifill: number;
  playerCount: number;
  landmass: string;
  landPercent: number;
  requestedArea: number;
  width: number;
  height: number;
}

export interface MapSizingResolution {
  width: number;
  height: number;
  metadata: MapSizingMetadata;
}

export interface ResolveMapSizingInput {
  mode: MapSizingMode;
  rulesetName: string;
  playerCount: number;
  landmass?: string;
  landPercent: number;
  topologyId?: number;
  wrapId?: number;
  fixedWidth?: number;
  fixedHeight?: number;
  loader?: RulesetLoader;
}

export function landPercentForTerrain(landmass?: string): number {
  return landmass === 'sparse' ? 20 : landmass === 'dense' ? 50 : 30;
}

export function resolveMapSizing(input: ResolveMapSizingInput): MapSizingResolution {
  const settings = resolveRulesetMapSettings(input.rulesetName, input.loader ?? rulesetLoader);

  if (input.mode === 'fixed') {
    assertDimension(input.fixedWidth, 'mapWidth');
    assertDimension(input.fixedHeight, 'mapHeight');
    return buildResolution(
      input,
      settings,
      input.fixedWidth,
      input.fixedHeight,
      input.fixedWidth * input.fixedHeight
    );
  }

  if (settings.mapsize !== 'PLAYER') {
    throw new Error(
      `Ruleset '${input.rulesetName}' does not support PLAYER map sizing (mapsize=${settings.mapsize})`
    );
  }
  if (!Number.isInteger(input.playerCount) || input.playerCount < 1) {
    throw new Error('Player-sized maps require at least one player');
  }
  if (!Number.isFinite(input.landPercent) || input.landPercent <= 0) {
    throw new Error('Player-sized maps require a positive land percentage');
  }

  // Freeciv calculates this as a double, then passes the raw area through
  // topology sizing. The web build caps the requested area at 38,000 tiles.
  const requestedArea = (input.playerCount * settings.tilesPerPlayer * 100) / input.landPercent;
  const boundedArea = Math.min(requestedArea, FREECIV_WEB_MAX_AREA);
  const { width, height } = setFreecivDimensions(boundedArea, input.topologyId, input.wrapId);

  return buildResolution(input, settings, width, height, requestedArea);
}

function buildResolution(
  input: ResolveMapSizingInput,
  settings: RulesetMapSettings,
  width: number,
  height: number,
  requestedArea: number
): MapSizingResolution {
  return {
    width,
    height,
    metadata: {
      mode: input.mode,
      mapsize: settings.mapsize,
      tilesPerPlayer: settings.tilesPerPlayer,
      aifill: settings.aiFill,
      playerCount: input.playerCount,
      landmass: input.landmass ?? 'normal',
      landPercent: input.landPercent,
      requestedArea,
      width,
      height,
    },
  };
}

function setFreecivDimensions(
  requestedArea: number,
  topologyId = 0,
  wrapId = 0
): { width: number; height: number } {
  const topology = normalizeTopologyId(topologyId);
  const isIsometric = (topology & (TopologyFlag.ISO | TopologyFlag.HEX)) !== 0;
  const isoFactor = isIsometric ? 2 : 1;
  const [xRatio, yRatio] = topologyRatios(wrapId);
  const even = 2;

  let area = requestedArea;
  while (true) {
    const size = Math.trunc(Math.sqrt(area / (xRatio * yRatio * isoFactor * even * even)) + 0.49);
    const width = xRatio * size * even;
    const height = yRatio * size * even * isoFactor;

    if (
      width <= FREECIV_MAX_LINEAR_SIZE &&
      height <= FREECIV_MAX_LINEAR_SIZE &&
      width * height <= FREECIV_WEB_MAX_AREA
    ) {
      return {
        width: Math.max(Math.min(width, FREECIV_MAX_LINEAR_SIZE), FREECIV_MIN_LINEAR_SIZE),
        height: Math.max(Math.min(height, FREECIV_MAX_LINEAR_SIZE), FREECIV_MIN_LINEAR_SIZE),
      };
    }

    // @reference mapgen_topology.c:set_sizes() recursively retries size - 100.
    area = Math.max(0, area - 100);
  }
}

function topologyRatios(wrapId: number): [number, number] {
  const wrapsX = (wrapId & WrapFlag.X) !== 0;
  const wrapsY = (wrapId & WrapFlag.Y) !== 0;
  if (wrapsX && wrapsY) return [1, 1];
  if (wrapsX) return [3, 2];
  if (wrapsY) return [2, 3];
  return [1, 1];
}

function assertDimension(value: number | undefined, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Fixed map sizing requires a positive integer ${name}`);
  }
}
