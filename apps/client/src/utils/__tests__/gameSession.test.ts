/**
 * Tests for gameSession utility functions
 */

import { storeUsername, getStoredUsername, clearUsername } from '../gameSession';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage });

describe('gameSession utilities', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
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
