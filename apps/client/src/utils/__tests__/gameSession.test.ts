/**
 * Tests for gameSession utility functions
 */

import { storeUsername, getStoredUsername, clearUsername } from '../gameSession';

describe('gameSession utilities', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('storeUsername and getStoredUsername', () => {
    it('should store and retrieve username', () => {
      const username = 'TestPlayer';

      storeUsername(username);
      const retrieved = getStoredUsername();

      expect(retrieved).toBe(username);
    });

    it('should return null when no username is stored', () => {
      const retrieved = getStoredUsername();
      expect(retrieved).toBeNull();
    });
  });

  describe('clearUsername', () => {
    it('should clear stored username', () => {
      const username = 'TestPlayer';

      storeUsername(username);
      expect(getStoredUsername()).toBe(username);

      clearUsername();
      expect(getStoredUsername()).toBeNull();
    });
  });
});
