/**
 * Movement system constants
 * @reference freeciv/server/ruleset/ruleload.c terrain_control
 */
export const SINGLE_MOVE = 3; // 1 movement point = 3 movement fragments
export const MAX_MOVE_FRAGS = 65000; // Maximum movement fragments

/**
 * Terrain movement costs in movement fragments
 * @reference freeciv/data/classic/terrain.ruleset
 */
export const TERRAIN_MOVEMENT_COSTS: Record<string, number> = {
  // Flat terrain: 1 movement point = 3 fragments
  ocean: SINGLE_MOVE,
  coast: SINGLE_MOVE,
  deep_ocean: SINGLE_MOVE,
  lake: SINGLE_MOVE,
  plains: SINGLE_MOVE,
  grassland: SINGLE_MOVE,
  desert: SINGLE_MOVE,
  tundra: SINGLE_MOVE,

  // Rough terrain: 2 movement points = 6 fragments
  hills: SINGLE_MOVE * 2,
  forest: SINGLE_MOVE * 2,
  jungle: SINGLE_MOVE * 2,
  swamp: SINGLE_MOVE * 2,

  // Impassable terrain: 3 movement points = 9 fragments
  mountains: SINGLE_MOVE * 3,
};

/**
 * Get terrain movement cost in movement fragments
 * @reference freeciv/common/movement.c map_move_cost_unit()
 */
export function getTerrainMovementCost(terrain: string): number {
  return TERRAIN_MOVEMENT_COSTS[terrain] || SINGLE_MOVE;
}
