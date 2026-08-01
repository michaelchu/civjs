import { buildRulesetPresentation } from '../../src/routes/rulesets';

describe('ruleset presentation API', () => {
  it('serves one authoritative renderer catalogue', () => {
    const presentation = buildRulesetPresentation('classic');

    expect(Object.keys(presentation.nation_styles)).toHaveLength(6);
    expect(Object.keys(presentation.city_styles)).toHaveLength(10);
    expect(Object.keys(presentation.music_styles)).toHaveLength(11);
    expect(presentation.terrains.deep_ocean).toEqual({
      graphic: 'floor',
      graphic_alt: 'coast',
      graphic_alt2: '-',
    });
    expect(presentation.units.warriors.graphic).toBe('u.warriors');
    expect(presentation.units.warriors.offsets).toMatchObject({
      unitX: 13,
      unitY: -9,
      shieldX: 25,
      shieldY: -15,
      veteranX: 33,
      veteranY: -33,
    });
    expect(presentation.extras.extra_gold.graphic).toBe('ts.gold');
  });

  it('fails closed for unknown rulesets', () => {
    expect(() => buildRulesetPresentation('not-a-ruleset')).toThrow(
      "Failed to load styles ruleset 'not-a-ruleset'"
    );
  });
});
