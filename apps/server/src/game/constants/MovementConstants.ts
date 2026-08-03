/**
 * @module server/game/constants/MovementConstants
 * Movement system constants
 * Implements freeciv's movement fragment system and terrain costs
 *
 * @reference freeciv/common/movement.h - SINGLE_MOVE, MAX_MOVE_FRAGS definitions
 * @reference freeciv/data/civ2civ3/terrain.ruleset - Terrain movement costs
 * @reference freeciv/server/ruleset/ruleload.c - Terrain control loading
 * @compliance The active ruleset supplies movement fragments per move point.
 */
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

// Civ2Civ3 uses six movement fragments per whole move.
export const SINGLE_MOVE = 6;
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
  getMoveFragments?(): number | undefined;
}

const defaultMovementRulesetLookup: MovementRulesetLookup = {
  getTerrainMoveCost(terrain: string): number | undefined {
    return rulesetLoader.getTerrain(terrain as any).moveCost;
  },
  getUnitMovementType(unitTypeId: string): MovementType | undefined {
    return rulesetUnitsService.getMovementType(unitTypeId) as MovementType | undefined;
  },
  getMoveFragments(): number {
    return SINGLE_MOVE;
  },
};

/**
 * Resolve the number of movement fragments in one whole move from the
 * ruleset's terrain control parameters.
 *
 * @reference reference/freeciv/common/movement.h:26
 * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:74-79
 */
export function getRulesetMoveFragments(rulesetName: string = DEFAULT_RULESET): number {
  const fragments = rulesetLoader.loadTerrainRuleset(rulesetName).terrain_control?.move_fragments;
  return typeof fragments === 'number' && Number.isInteger(fragments) && fragments > 0
    ? fragments
    : SINGLE_MOVE;
}

function moveFragments(lookup: MovementRulesetLookup): number {
  const fragments = lookup.getMoveFragments?.();
  return typeof fragments === 'number' && Number.isInteger(fragments) && fragments > 0
    ? fragments
    : SINGLE_MOVE;
}

/**
 * Get terrain movement cost for specific unit type
 * terrain.json stores the whole movement points from terrain.ruleset; this
 * boundary converts them to movement fragments exactly once.
 * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:106-108
 * @reference reference/freeciv/common/movement.c:117-128
 */
export function getTerrainMovementCost(
  terrain: string,
  unitTypeId?: string,
  lookup: MovementRulesetLookup = defaultMovementRulesetLookup
): number {
  const fragments = moveFragments(lookup);
  const moveCost = lookup.getTerrainMoveCost(terrain);
  const baseCost = moveCost === undefined ? fragments : moveCost * fragments;

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
      // Coast is shallow water, not land. Keep this aligned with the shared
      // terrain classifier and city founding's native-terrain validation.
      if (
        terrain === 'ocean' ||
        terrain === 'coast' ||
        terrain === 'deep_ocean' ||
        terrain === 'lake'
      ) {
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
      return fragments;

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
 * C2C3 sets pythagorean_diagonal = FALSE, so square-topology diagonal
 * steps have the same cost as orthogonal steps.
 * @reference freeciv/common/movement.c map_move_cost_unit()
 * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:74-75
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
