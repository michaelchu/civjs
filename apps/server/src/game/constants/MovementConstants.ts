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
 * Unit movement capabilities
 * @reference freeciv/common/unittype.h utype_move_type
 */
export enum MovementType {
  LAND = 'land',
  SEA = 'sea',
  BOTH = 'both', // Amphibious units
  AIR = 'air',
}

/**
 * Unit type movement capabilities
 */
export const UNIT_MOVEMENT_TYPES: Record<string, MovementType> = {
  // Land units
  warrior: MovementType.LAND,
  archer: MovementType.LAND,
  spearman: MovementType.LAND,
  settler: MovementType.LAND,

  // Sea units
  trireme: MovementType.SEA,

  // Future: Air units, amphibious units, etc.
};

/**
 * Get terrain movement cost for specific unit type
 * @reference freeciv/common/movement.c map_move_cost_unit()
 */
export function getTerrainMovementCost(terrain: string, unitTypeId?: string): number {
  const baseCost = TERRAIN_MOVEMENT_COSTS[terrain] || SINGLE_MOVE;

  // If no unit type specified, return base cost
  if (!unitTypeId) {
    return baseCost;
  }

  const movementType = UNIT_MOVEMENT_TYPES[unitTypeId] || MovementType.LAND;

  // Check movement type compatibility
  switch (movementType) {
    case MovementType.LAND:
      // Land units cannot move on water tiles (except coast which represents shallow water)
      if (terrain === 'ocean' || terrain === 'deep_ocean' || terrain === 'lake') {
        return -1; // Impassable
      }
      return baseCost;

    case MovementType.SEA:
      // Sea units can only move on water
      if (!['ocean', 'deep_ocean', 'coast', 'lake'].includes(terrain)) {
        return -1; // Impassable
      }
      return baseCost;

    case MovementType.BOTH:
      // Amphibious units can move anywhere
      return baseCost;

    case MovementType.AIR:
      // Air units ignore terrain (not implemented yet)
      return SINGLE_MOVE;

    default:
      return baseCost;
  }
}

/**
 * Check if unit can enter terrain type
 * @reference freeciv/common/movement.c can_unit_exist_at_tile()
 */
export function canUnitEnterTerrain(terrain: string, unitTypeId: string): boolean {
  return getTerrainMovementCost(terrain, unitTypeId) >= 0;
}

/**
 * Calculate movement cost between two tiles (including diagonal penalty)
 * @reference freeciv/common/movement.c map_move_cost_unit()
 */
export function calculateMovementCost(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  toTerrain: string,
  unitTypeId: string
): number {
  const baseCost = getTerrainMovementCost(toTerrain, unitTypeId);

  if (baseCost < 0) {
    return -1; // Impassable
  }

  // Check if it's a diagonal move
  const dx = Math.abs(toX - fromX);
  const dy = Math.abs(toY - fromY);
  const isDiagonal = dx === 1 && dy === 1;

  // Diagonal moves cost sqrt(2) ≈ 1.41 times more (simplified to 1.5x for integer math)
  return isDiagonal ? Math.floor(baseCost * 1.5) : baseCost;
}
