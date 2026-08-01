import { describe, expect, it } from 'vitest';
import { getNextNationCityName } from '../cityNames';

describe('getNextNationCityName', () => {
  it('strips ruleset terrain constraints and skips used names', () => {
    expect(getNextNationCityName(['Roma (hills)', 'Capua', 'Veii'], ['Roma', 'CAPUA'])).toBe(
      'Veii'
    );
  });

  it('returns no suggestion when the nation catalogue is exhausted', () => {
    expect(getNextNationCityName(['Roma'], ['Roma'])).toBeUndefined();
  });
});
