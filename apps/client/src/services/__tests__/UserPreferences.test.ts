import { beforeEach, describe, expect, it } from 'vitest';
import { loadUserPreferences, saveUserPreferences } from '../UserPreferences';

describe('UserPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('reduce-motion');
  });

  it('persists bounded audio and reduced-motion settings', () => {
    saveUserPreferences({
      muted: true,
      volume: 0.75,
      reducedMotion: true,
      disableFogOfWar: true,
    });

    expect(loadUserPreferences()).toEqual({
      muted: true,
      volume: 0.75,
      reducedMotion: true,
      disableFogOfWar: true,
    });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
  });

  it('uses safe defaults for invalid saved data', () => {
    localStorage.setItem('civjs:user-preferences:v1', '{not-json');
    expect(loadUserPreferences()).toEqual({
      muted: false,
      volume: 0.5,
      reducedMotion: false,
      disableFogOfWar: false,
    });
  });
});
