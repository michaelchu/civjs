/**
 * Tests for gameSession utility functions
 */

import {
  storeGameSession,
  getStoredGameSession,
  clearGameSession,
  isCurrentGameSinglePlayer,
  getStoredPlayerName,
} from '../gameSession';

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

  describe('storeGameSession and getStoredGameSession', () => {
    it('should store and retrieve game session data', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      const retrieved = getStoredGameSession();

      expect(retrieved).toEqual(session);
    });

    it('should return null when no session is stored', () => {
      const retrieved = getStoredGameSession();
      expect(retrieved).toBeNull();
    });

    it('should return null when gameId does not match stored gameId', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      const retrieved = getStoredGameSession('different-game');

      expect(retrieved).toBeNull();
    });

    it('should return session when gameId matches stored gameId', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      const retrieved = getStoredGameSession('game123');

      expect(retrieved).toEqual(session);
    });
  });

  describe('clearGameSession', () => {
    it('should clear stored session data', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      expect(getStoredGameSession()).toEqual(session);

      clearGameSession();
      expect(getStoredGameSession()).toBeNull();
    });
  });

  describe('isCurrentGameSinglePlayer', () => {
    it('should return true for single player games', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      expect(isCurrentGameSinglePlayer('game123')).toBe(true);
    });

    it('should return false for multiplayer games', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'multiplayer' as const,
      };

      storeGameSession(session);
      expect(isCurrentGameSinglePlayer('game123')).toBe(false);
    });

    it('should return false when no session exists', () => {
      expect(isCurrentGameSinglePlayer('game123')).toBe(false);
    });
  });

  describe('getStoredPlayerName', () => {
    it('should return player name for matching game', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      expect(getStoredPlayerName('game123')).toBe('TestPlayer');
    });

    it('should return null for non-matching game', () => {
      const session = {
        playerName: 'TestPlayer',
        gameId: 'game123',
        gameType: 'single' as const,
      };

      storeGameSession(session);
      expect(getStoredPlayerName('different-game')).toBeNull();
    });

    it('should return null when no session exists', () => {
      expect(getStoredPlayerName('game123')).toBeNull();
    });
  });
});
