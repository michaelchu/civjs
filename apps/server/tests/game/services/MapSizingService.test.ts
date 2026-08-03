/**
 * @module tests/game/services/MapSizingService
 * Covers Freeciv C2C3 player-sized map resolution.
 */
import {
  FREECIV_WEB_MAX_AREA,
  landPercentForTerrain,
  resolveMapSizing,
  validateFreecivFixedMapDimensions,
} from '@game/services/MapSizingService';
import {
  resolveRulesetMapSettings,
  resolveRulesetTerrainSettings,
} from '@game/services/RulesetTerrainDefaults';
import { TopologyFlag, WrapFlag } from '@game/map/MapTopology';

describe('MapSizingService', () => {
  const terrain = resolveRulesetTerrainSettings('civ2civ3', undefined);

  it.each([
    [2, 18, 36],
    [4, 26, 52],
    [6, 32, 64],
  ])('matches the C2C3 default size for %i players', (players, width, height) => {
    const result = resolveMapSizing({
      mode: 'player',
      rulesetName: 'civ2civ3',
      playerCount: players,
      landPercent: landPercentForTerrain('normal'),
      topologyId: terrain.topologyId,
      wrapId: terrain.wrapId,
    });

    expect(result).toMatchObject({ width, height });
    expect(result.metadata).toMatchObject({
      mode: 'player',
      mapsize: 'PLAYER',
      tilesPerPlayer: 100,
      aifill: 6,
      playerCount: players,
      landmass: 'normal',
      landPercent: 30,
    });
  });

  it('reads sizing values from the supplied ruleset rather than duplicating C2C3 constants', () => {
    const loader = {
      loadGameRulesRuleset: jest.fn().mockReturnValue({
        settings: {
          set: [
            { name: 'mapsize', value: 'PLAYER' },
            { name: 'tilesperplayer', value: 80 },
            { name: 'aifill', value: 4 },
          ],
        },
      }),
    } as any;

    expect(resolveRulesetMapSettings('custom', loader)).toEqual({
      mapsize: 'PLAYER',
      tilesPerPlayer: 80,
      aiFill: 4,
    });

    const result = resolveMapSizing({
      mode: 'player',
      rulesetName: 'custom',
      playerCount: 2,
      landmass: 'dense',
      landPercent: 50,
      topologyId: terrain.topologyId,
      wrapId: terrain.wrapId,
      loader,
    });

    expect(result.metadata).toMatchObject({
      tilesPerPlayer: 80,
      aifill: 4,
      landmass: 'dense',
      landPercent: 50,
      requestedArea: 320,
    });
  });

  it('uses Freeciv topology ratios and treats HEX as isometric for sizing', () => {
    expect(
      resolveMapSizing({
        mode: 'player',
        rulesetName: 'civ2civ3',
        playerCount: 2,
        landPercent: 30,
        topologyId: TopologyFlag.HEX,
        wrapId: WrapFlag.X,
      })
    ).toMatchObject({ width: 24, height: 32 });

    expect(
      resolveMapSizing({
        mode: 'player',
        rulesetName: 'civ2civ3',
        playerCount: 2,
        landPercent: 30,
        topologyId: 0,
        wrapId: WrapFlag.Y,
      })
    ).toMatchObject({ width: 20, height: 30 });
  });

  it('applies the minimum dimensions after Freeciv rounding', () => {
    const result = resolveMapSizing({
      mode: 'player',
      rulesetName: 'civ2civ3',
      playerCount: 1,
      landPercent: 50,
      topologyId: terrain.topologyId,
      wrapId: 0,
    });

    expect(result).toMatchObject({ width: 16, height: 20 });
  });

  it('repeats the reference size-minus-100 reduction at the web maximum', () => {
    const result = resolveMapSizing({
      mode: 'player',
      rulesetName: 'civ2civ3',
      playerCount: 115,
      landPercent: 30,
      topologyId: terrain.topologyId,
      wrapId: terrain.wrapId,
    });

    expect(result).toMatchObject({ width: 136, height: 272 });
    expect(result.width * result.height).toBeLessThanOrEqual(FREECIV_WEB_MAX_AREA);
    expect(result.metadata.requestedArea).toBeCloseTo((115 * 100 * 100) / 30);
  });

  it('honors explicit dimensions only in fixed mode', () => {
    const result = resolveMapSizing({
      mode: 'fixed',
      rulesetName: 'civ2civ3',
      playerCount: 6,
      landPercent: 30,
      fixedWidth: 20,
      fixedHeight: 20,
    });

    expect(result).toMatchObject({ width: 20, height: 20 });
    expect(result.metadata.mode).toBe('fixed');
  });

  it('accepts a reference-valid fixed C2C3 map', () => {
    expect(() =>
      validateFreecivFixedMapDimensions(32, 64, TopologyFlag.ISO | TopologyFlag.HEX)
    ).not.toThrow();
  });

  it('rejects an odd fixed height for ISO or HEX maps', () => {
    expect(() => validateFreecivFixedMapDimensions(40, 25, TopologyFlag.ISO)).toThrow(
      'mapHeight must be even'
    );
    expect(() => validateFreecivFixedMapDimensions(40, 25, TopologyFlag.HEX)).toThrow(
      'mapHeight must be even'
    );
  });

  it('rejects fixed dimensions outside Freeciv-web bounds', () => {
    expect(() => validateFreecivFixedMapDimensions(15, 20)).toThrow('mapWidth must be between');
    expect(() => validateFreecivFixedMapDimensions(200, 200)).toThrow(
      'must not exceed 38000 tiles'
    );
  });
});
