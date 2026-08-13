import { describe, expect, it } from 'vitest';
import {
  resolveCityGraphic,
  resolveGraphic,
  resolveMusicStyle,
  resolveNationStyleName,
} from '../PresentationResolver';
import type { PresentationRuleset } from '../RulesetService';

const presentation: PresentationRuleset = {
  nation_styles: {
    style_european: { name: 'European' },
    style_asian: { name: 'Asian' },
    style_tropical: { name: 'Tropical' },
  },
  city_styles: {
    citystyle_european: {
      name: 'European',
      graphic: 'city.european',
      reqs: [{ type: 'Style', name: 'European', range: 'Player' }],
    },
    citystyle_asian: {
      name: 'Asian',
      graphic: 'city.asian',
      reqs: [{ type: 'Style', name: 'Asian', range: 'Player' }],
    },
    citystyle_industrial: {
      name: 'Industrial',
      graphic: 'city.industrial',
      reqs: [{ type: 'Tech', name: 'Railroad', range: 'Player' }],
    },
  },
  music_styles: {
    musicstyle_asian: {
      music_peaceful: 'music_asian_peace',
      music_combat: 'music_asian_combat',
      reqs: [{ type: 'Style', name: 'Asian', range: 'Player' }],
    },
    musicstyle_industrial: {
      music_peaceful: 'music_industrial_peace',
      music_combat: 'music_industrial_combat',
      reqs: [{ type: 'Tech', name: 'Railroad', range: 'Player' }],
    },
  },
  terrains: {},
  units: {},
  buildings: {},
  extras: {},
};

describe('PresentationResolver', () => {
  it('matches nation style names to generated style definitions', () => {
    expect(resolveNationStyleName('Asian', presentation.nation_styles)).toBe('Asian');
    expect(resolveNationStyleName('African', presentation.nation_styles)).toBe('Tropical');
    expect(
      resolveCityGraphic({
        requestedNationStyle: 'Asian',
        nationStyles: presentation.nation_styles,
        cityStyles: presentation.city_styles,
      })
    ).toBe('city.asian');
  });

  it('selects the latest eligible technology-driven city and music styles', () => {
    const researchedTechs = new Set(['railroad']);
    expect(
      resolveCityGraphic({
        requestedNationStyle: 'Asian',
        nationStyles: presentation.nation_styles,
        cityStyles: presentation.city_styles,
        researchedTechs,
      })
    ).toBe('city.industrial');
    expect(
      resolveMusicStyle({
        requestedNationStyle: 'Asian',
        nationStyles: presentation.nation_styles,
        musicStyles: presentation.music_styles,
        researchedTechs,
        combat: true,
      })
    ).toBe('music_industrial_combat');
  });

  it('uses ordered graphic alternatives and ignores disabled tags', () => {
    expect(
      resolveGraphic(
        { graphic: 'missing', graphic_alt: '-', graphic_alt2: 'available' },
        tag => tag === 'available'
      )
    ).toBe('available');
  });
});
