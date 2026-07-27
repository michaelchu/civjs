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
});
