import {
  SINGLE_MOVE,
  MovementType,
  getRulesetMoveFragments,
  getTerrainMovementCost,
  canUnitEnterTerrain,
  calculateMovementCost,
  type MovementRulesetLookup,
} from '@game/constants/MovementConstants';

describe('MovementConstants', () => {
  it('keeps movement points represented by six fragments', () => {
    expect(SINGLE_MOVE).toBe(6);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:74-79
   * @reference reference/freeciv/common/movement.h:26
   * @assertion Civ2Civ3's terrain control defines six movement fragments for each whole movement point.
   * @c2c3-surface movement-transport
   * @c2c3-surface-scenario normal
   */
  it('loads Civ2Civ3 movement fragments from terrain control', () => {
    const civ2civ3Lookup: MovementRulesetLookup = {
      getTerrainMoveCost: terrain => (terrain === 'hills' ? 2 : 1),
      getUnitMovementType: () => MovementType.LAND,
      getMoveFragments: () => getRulesetMoveFragments('civ2civ3'),
    };

    expect(getRulesetMoveFragments('civ2civ3')).toBe(6);
    expect(getTerrainMovementCost('grassland', 'warriors', civ2civ3Lookup)).toBe(6);
    expect(getTerrainMovementCost('hills', 'warriors', civ2civ3Lookup)).toBe(12);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:107-108
   * @reference reference/freeciv/common/movement.c:117-128
   * @assertion Loaded whole-point terrain movement costs are converted once into Freeciv movement fragments.
   */
  it('scales loaded whole-point terrain costs exactly once', () => {
    // @reference reference/freeciv/data/civ2civ3/terrain.ruleset:107-108
    // @reference reference/freeciv/common/movement.c:117-128
    expect(getTerrainMovementCost('grassland')).toBe(6);
    expect(getTerrainMovementCost('hills')).toBe(12);
    expect(getTerrainMovementCost('mountains')).toBe(18);
  });

  it('changes the fragment cost when an injected ruleset move cost changes', () => {
    const lookup = (moveCost: number): MovementRulesetLookup => ({
      getTerrainMoveCost: terrain => (terrain === 'hills' ? moveCost : undefined),
      getUnitMovementType: () => MovementType.LAND,
    });

    expect(getTerrainMovementCost('hills', 'warriors', lookup(4))).toBe(24);
    expect(getTerrainMovementCost('hills', 'warriors', lookup(7))).toBe(42);
  });

  it('uses loaded unit classes for representative land, sea, and air movement', () => {
    expect(getTerrainMovementCost('hills', 'warriors')).toBe(12);
    expect(getTerrainMovementCost('ocean', 'warriors')).toBe(-1);
    expect(getTerrainMovementCost('coast', 'warriors')).toBe(-1);
    expect(getTerrainMovementCost('ocean', 'trireme')).toBe(6);
    expect(getTerrainMovementCost('coast', 'trireme')).toBe(6);
    expect(getTerrainMovementCost('grassland', 'trireme')).toBe(-1);
    expect(getTerrainMovementCost('mountains', 'fighter')).toBe(SINGLE_MOVE);
  });

  it('fails safely when the unit ID is not in the loaded ruleset', () => {
    expect(getTerrainMovementCost('grassland', 'unknown_unit')).toBe(-1);
    expect(canUnitEnterTerrain('ocean', 'unknown_unit')).toBe(false);
  });

  it('preserves terrain entry and path cost consumers', () => {
    expect(canUnitEnterTerrain('hills', 'warriors')).toBe(true);
    expect(canUnitEnterTerrain('deep_ocean', 'warriors')).toBe(false);
    expect(canUnitEnterTerrain('lake', 'trireme')).toBe(true);
    expect(calculateMovementCost(0, 0, 1, 0, 'hills', 'warriors')).toBe(12);
    expect(calculateMovementCost(0, 0, 1, 1, 'hills', 'warriors')).toBe(12);
    expect(calculateMovementCost(0, 0, 1, 0, 'ocean', 'warriors')).toBe(-1);
  });
});
