import { EffectType, EffectsManager, type EffectContext } from '@game/managers/EffectsManager';

describe('C2C3 Tile_Claimable effect requirements', () => {
  const calculateClaimable = (context: EffectContext) =>
    new EffectsManager('civ2civ3').calculateEffect(EffectType.TILE_CLAIMABLE, context);

  it('applies Freeciv connected-land, nearby-ocean, enclosed-lake, and narrow-bay claims', () => {
    // @reference reference/freeciv/data/civ2civ3/effects.ruleset:4626-4665
    const connectedLand = calculateClaimable({
      tileRegionId: 'land-1',
      sourceTileRegionId: 'land-1',
      tileRegionSize: 30,
      tileSameRegionAdjacentCount: 4,
      tileAdjacentRegionIds: new Set(['land-1']),
      tileDistanceSqToSource: 9,
    });
    expect(connectedLand.effects.map(effect => effect.effectId)).toContain('claim_land');

    const adjacentOcean = calculateClaimable({
      tileRegionId: 'ocean-1',
      sourceTileRegionId: 'land-1',
      tileRegionSize: 30,
      tileSameRegionAdjacentCount: 4,
      tileAdjacentRegionIds: new Set(['ocean-1', 'land-1']),
      tileDistanceSqToSource: 2,
    });
    expect(adjacentOcean.effects.map(effect => effect.effectId)).toContain('claim_ocean_adj');

    const enclosedLake = calculateClaimable({
      tileRegionId: 'ocean-lake',
      sourceTileRegionId: 'land-1',
      tileRegionSize: 1,
      tileSameRegionAdjacentCount: 1,
      tileAdjacentRegionIds: new Set(['land-1']),
      tileRegionSurroundedBy: 'land-1',
      tileDistanceSqToSource: 9,
    });
    expect(enclosedLake.effects.map(effect => effect.effectId)).toContain('claim_ocean_lake');

    const narrowBay = calculateClaimable({
      tileRegionId: 'ocean-bay',
      sourceTileRegionId: 'land-1',
      tileRegionSize: 30,
      tileSameRegionAdjacentCount: 2,
      tileAdjacentRegionIds: new Set(['ocean-bay', 'land-1']),
      tileDistanceSqToSource: 9,
    });
    expect(narrowBay.effects.map(effect => effect.effectId)).toContain('claim_ocean_bay');
  });

  it('fails closed when the required source-tile relationship facts are unavailable', () => {
    // @reference reference/freeciv/common/requirements.c:5110-5295
    expect(
      calculateClaimable({
        tileRegionId: 'ocean-1',
        tileDistanceSqToSource: 9,
      }).value
    ).toBe(0);
  });
});
