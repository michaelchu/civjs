import type { CityState } from '../../../src/game/managers/CityManager';
import type { PlayerState } from '../../../src/game/managers/GameManager';
import { resolveCityPresentation } from '../../../src/game/services/CityPresentationService';

describe('CityPresentationService', () => {
  const loader = {
    getNation: () => ({ style: 'Asian' }),
    getRulesetCityStyles: () => ({
      citystyle_asian: {
        graphic: 'city.asian',
        graphic_alt: '-',
        reqs: [{ type: 'Style', name: 'Asian', present: true }],
      },
      citystyle_industrial: {
        graphic: 'city.industrial',
        graphic_alt: '-',
        reqs: [{ type: 'Tech', name: 'Railroad', present: true }],
      },
    }),
  };
  const player = { civilization: 'japanese' } as PlayerState;

  it('resolves another player city era without exposing their research list', () => {
    const presentation = resolveCityPresentation(
      {
        buildings: ['city_walls', 'coastal_defense', 'sam_battery'],
      } as CityState,
      player,
      new Set(['alphabet', 'railroad']),
      'civ2civ3',
      loader as never
    );

    expect(presentation).toEqual({
      graphic: 'city.industrial',
      graphicAlt: undefined,
      hasWalls: true,
      overlays: ['city.coastal_underlay', 'city.coastal_overlay', 'city.sam_overlay'],
    });
  });

  it('does not treat coastal defense as city walls', () => {
    const presentation = resolveCityPresentation(
      { buildings: ['coastal_defense'] } as CityState,
      player,
      new Set(['alphabet']),
      'civ2civ3',
      loader as never
    );

    expect(presentation.graphic).toBe('city.asian');
    expect(presentation.hasWalls).toBe(false);
  });
});
