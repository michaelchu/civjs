/**
 * Movement system constants
 * Implements freeciv's movement fragment system and terrain costs
 *
 * @reference freeciv/common/movement.h - SINGLE_MOVE, MAX_MOVE_FRAGS definitions
 * @reference freeciv/data/classic/terrain.ruleset - Terrain movement costs
 * @reference freeciv/server/ruleset/ruleload.c - Terrain control loading
 * @compliance Movement fragments (3 per move point) match freeciv exactly
 */
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export const SINGLE_MOVE = 3; // 1 movement point = 3 movement fragments
export const MAX_MOVE_FRAGS = 65535; // Maximum movement fragments - matches freeciv exactly

/**
 * Unit movement capabilities
 * Defines movement types for different unit classes
 *
 * @reference freeciv/common/unittype.h - utype_move_type enum definition
 * @reference freeciv/common/movement.c - Movement type validation
 * @compliance Matches freeciv's unit movement classification system
 */
export enum MovementType {
  LAND = 'land',
  SEA = 'sea',
  BOTH = 'both', // Amphibious units
  AIR = 'air',
}

export interface MovementRulesetLookup {
  getTerrainMoveCost(terrain: string): number | undefined;
  getUnitMovementType(unitTypeId: string): MovementType | undefined;
}

const defaultMovementRulesetLookup: MovementRulesetLookup = {
  getTerrainMoveCost(terrain: string): number | undefined {
    const terrains = rulesetLoader.getTerrains() as Record<string, { moveCost: number }>;
    return terrains[terrain]?.moveCost;
  },
  getUnitMovementType(unitTypeId: string): MovementType | undefined {
    return rulesetUnitsService.getMovementType(unitTypeId) as MovementType | undefined;
  },
};

/**
 * Get terrain movement cost for specific unit type
 * terrain.json stores the whole movement points from terrain.ruleset; this
 * boundary converts them to movement fragments exactly once.
 * @reference reference/freeciv/data/classic/terrain.ruleset:106-108
 * @reference reference/freeciv/common/movement.c:117-128
 */
export function getTerrainMovementCost(
  terrain: string,
  unitTypeId?: string,
  lookup: MovementRulesetLookup = defaultMovementRulesetLookup
): number {
  const moveCost = lookup.getTerrainMoveCost(terrain);
  const baseCost = moveCost === undefined ? SINGLE_MOVE : moveCost * SINGLE_MOVE;

  // If no unit type specified, return base cost
  if (!unitTypeId) {
    return baseCost;
  }

  const movementType = lookup.getUnitMovementType(unitTypeId);
  if (!movementType) {
    return -1;
  }

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
      // Unit classes without TerrainSpeed use one movement point.
      // @reference reference/freeciv/common/map.c:924-926
      return SINGLE_MOVE;

    default:
      return -1;
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
 * Calculate movement cost between two tiles.
 * Classic sets pythagorean_diagonal = FALSE, so square-topology diagonal
 * steps have the same cost as orthogonal steps.
 * @reference freeciv/common/movement.c map_move_cost_unit()
 * @reference reference/freeciv/data/classic/terrain.ruleset:74-75
 */
export function calculateMovementCost(
  _fromX: number,
  _fromY: number,
  _toX: number,
  _toY: number,
  toTerrain: string,
  unitTypeId: string
): number {
  const baseCost = getTerrainMovementCost(toTerrain, unitTypeId);

  if (baseCost < 0) {
    return -1; // Impassable
  }

  return baseCost;
}
