/**
 * @module server/game/rules/ClassicIrrigationRules
 * Defines Classic Irrigation Rules game rules.
 */
import type { MapTile } from '@game/managers/MapManager';
import { isOceanTerrain } from '@game/map/TerrainUtils';

/**
 * Classic irrigation must extend from a cardinally adjacent oceanic tile,
 * river, or existing irrigation extra.
 *
 * @reference reference/freeciv/data/classic/actions.ruleset:1120-1160
 */
export function hasClassicIrrigationSource(cardinalNeighbors: readonly MapTile[]): boolean {
  return cardinalNeighbors.some(
    tile =>
      isOceanTerrain(tile.terrain) ||
      (tile.riverMask ?? 0) !== 0 ||
      tile.improvements.includes('irrigation')
  );
}
