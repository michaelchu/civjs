/**
 * @module server/game/services/RulesetTerrainDefaults
 * Resolves the map settings a ruleset supplies for newly created games.
 *
 * Freeciv stores a ruleset's defaults in `game.ruleset` `[settings]` rather
 * than duplicating them in each map generator.  Persisting the resolved
 * values at game creation makes the authoritative map topology stable across
 * generation, recovery, and replay.
 */

import { normalizeTopologyId, TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import type { TerrainSettings } from '@game/runtime/GameTypes';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export const DEFAULT_TERRAIN_SETTINGS: TerrainSettings = {
  generator: 'random',
  landmass: 'normal',
  huts: 15,
  temperature: 50,
  wetness: 50,
  rivers: 50,
  resources: 'normal',
};

type RulesetSetting = { name?: unknown; value?: unknown };

function getRulesetSetting(
  loader: RulesetLoader,
  rulesetName: string,
  settingName: string
): unknown {
  const settings = loader.loadGameRulesRuleset(rulesetName).settings.set;
  if (!Array.isArray(settings)) return undefined;
  return (settings as RulesetSetting[]).find(setting => setting?.name === settingName)?.value;
}

function topologyFromSetting(value: unknown): number {
  const source = typeof value === 'string' ? value.toUpperCase() : '';
  return (
    (source.includes('ISO') ? TopologyFlag.ISO : 0) |
    (source.includes('HEX') ? TopologyFlag.HEX : 0)
  );
}

function wrapFromSetting(value: unknown): number {
  const source = typeof value === 'string' ? value.toUpperCase() : '';
  return (source.includes('WRAPX') ? WrapFlag.X : 0) | (source.includes('WRAPY') ? WrapFlag.Y : 0);
}

/**
 * Resolve Freeciv server defaults, ruleset settings, then explicit game
 * settings. Only the map settings represented by CivJS are applied here.
 *
 * @reference reference/freeciv/server/settings.c:game_ruleset_load()
 * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-827
 */
export function resolveRulesetTerrainSettings(
  rulesetName: string,
  overrides: Partial<TerrainSettings> | undefined,
  loader: RulesetLoader = rulesetLoader
): TerrainSettings {
  const generator = getRulesetSetting(loader, rulesetName, 'generator');
  const temperature = getRulesetSetting(loader, rulesetName, 'temperature');
  const topology = topologyFromSetting(getRulesetSetting(loader, rulesetName, 'topology'));
  const wrap = wrapFromSetting(getRulesetSetting(loader, rulesetName, 'wrap'));

  const settings = {
    ...DEFAULT_TERRAIN_SETTINGS,
    ...(typeof generator === 'string' && generator.length > 0
      ? { generator: generator.toLowerCase() }
      : {}),
    ...(typeof temperature === 'number' && Number.isFinite(temperature) ? { temperature } : {}),
    topologyId: topology,
    wrapId: wrap,
    ...overrides,
  };

  return {
    ...settings,
    topologyId: normalizeTopologyId(settings.topologyId ?? 0),
  };
}
