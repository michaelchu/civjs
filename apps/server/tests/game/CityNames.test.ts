import { getUniqueCityName } from '@game/constants/CityNames';

describe('getUniqueCityName', () => {
  it('removes coordinate suffixes from placeholder names', () => {
    expect(getUniqueCityName([], 'New City (15,12)')).toBe('New City');
  });

  it('replaces a duplicate supplied name with an unused name', () => {
    expect(getUniqueCityName(['New Rome'], 'New Rome')).toBe('Alexandria');
  });

  it('keeps a unique supplied name', () => {
    expect(getUniqueCityName(['New Rome'], 'River Town')).toBe('River Town');
  });
});
