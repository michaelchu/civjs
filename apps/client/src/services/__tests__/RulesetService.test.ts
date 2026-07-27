import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rulesetService } from '../RulesetService';

describe('RulesetService', () => {
  beforeEach(() => rulesetService.clearCache());
  afterEach(() => vi.unstubAllGlobals());

  it('loads city and nation styles from the authoritative server APIs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          city_styles: {
            european: { name: 'European', graphic: 'city.european' },
          },
          founding_rules: {
            no_cities_terrains: [],
            founding_units: ['Settlers'],
            allow_foreign_territory: false,
            enemy_units_block: true,
            exploration_requirement: 1,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { nations: [{ id: 'roman', style: 'European' }] },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(rulesetService.getCityStyles()).resolves.toEqual({
      european: { name: 'European', graphic: 'city.european' },
    });
    await expect(rulesetService.getNationStyles()).resolves.toEqual({
      roman: 'European',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('loads and caches the renderer presentation catalogue', async () => {
    const payload = {
      nation_styles: { style_asian: { name: 'Asian' } },
      city_styles: {},
      music_styles: {},
      terrains: { lake: { graphic: 'lake', graphic_alt: 'coast' } },
      units: { warriors: { graphic: 'u.warriors' } },
      extras: { extra_gold: { graphic: 'ts.gold' } },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(rulesetService.loadPresentationRuleset()).resolves.toEqual(payload);
    await expect(rulesetService.loadPresentationRuleset()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
