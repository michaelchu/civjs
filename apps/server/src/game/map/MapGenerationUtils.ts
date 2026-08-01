import { MapStartpos } from './MapTypes';

/**
 * Freeciv's one-dimensional map-size estimate.
 * @reference reference/freeciv/server/generator/mapgen_topology.c:get_sqsize()
 */
export function getMapSqSize(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.sqrt((width * height) / 1000)));
}

/**
 * Number of smoothing passes used by MAPGEN_RANDOM.
 * @reference reference/freeciv/server/generator/mapgen.c:1350-1353
 */
export function getRandomSmoothPasses(
  width: number,
  height: number,
  playerCount: number,
  startPosMode: MapStartpos
): number {
  const playerAdjustment = startPosMode === MapStartpos.DEFAULT ? 0 : Math.floor(playerCount / 4);
  return Math.max(1, 1 + getMapSqSize(width, height) - playerAdjustment);
}

/**
 * Extra initial subdivisions used by MAPGEN_FRACTAL.
 * @reference reference/freeciv/server/generator/mapgen.c:1343-1347
 */
export function getPseudoFractalExtraDivisions(
  playerCount: number,
  startPosMode: MapStartpos
): number {
  return (
    1 + (startPosMode === MapStartpos.DEFAULT || startPosMode === MapStartpos.ALL ? 0 : playerCount)
  );
}
