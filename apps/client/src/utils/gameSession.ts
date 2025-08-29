/**
 * Utility for managing game session data in localStorage
 * Handles player identity persistence across browser refreshes
 */

const STORAGE_KEYS = {
  PLAYER_NAME: 'civjs_player_name',
  GAME_ID: 'civjs_current_game_id',
  GAME_TYPE: 'civjs_game_type',
} as const;

export interface GameSession {
  playerName: string;
  gameId: string;
  gameType: 'single' | 'multiplayer';
}

/**
 * Store game session data when creating or joining a game
 */
export function storeGameSession(session: GameSession): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PLAYER_NAME, session.playerName);
    localStorage.setItem(STORAGE_KEYS.GAME_ID, session.gameId);
    localStorage.setItem(STORAGE_KEYS.GAME_TYPE, session.gameType);
  } catch (error) {
    console.warn('Failed to store game session:', error);
  }
}

/**
 * Retrieve stored game session data
 */
export function getStoredGameSession(gameId?: string): GameSession | null {
  try {
    const storedPlayerName = localStorage.getItem(STORAGE_KEYS.PLAYER_NAME);
    const storedGameId = localStorage.getItem(STORAGE_KEYS.GAME_ID);
    const storedGameType = localStorage.getItem(STORAGE_KEYS.GAME_TYPE);

    // If a specific gameId is provided, ensure it matches stored data
    if (gameId && storedGameId !== gameId) {
      return null;
    }

    if (storedPlayerName && storedGameId && storedGameType) {
      return {
        playerName: storedPlayerName,
        gameId: storedGameId,
        gameType: storedGameType as 'single' | 'multiplayer',
      };
    }
  } catch (error) {
    console.warn('Failed to retrieve game session:', error);
  }

  return null;
}

/**
 * Clear stored game session data
 */
export function clearGameSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.PLAYER_NAME);
    localStorage.removeItem(STORAGE_KEYS.GAME_ID);
    localStorage.removeItem(STORAGE_KEYS.GAME_TYPE);
  } catch (error) {
    console.warn('Failed to clear game session:', error);
  }
}

/**
 * Check if the current game session is for a single player game
 */
export function isCurrentGameSinglePlayer(gameId: string): boolean {
  const session = getStoredGameSession(gameId);
  return session?.gameType === 'single' || false;
}

/**
 * Get the stored player name for a specific game
 */
export function getStoredPlayerName(gameId: string): string | null {
  const session = getStoredGameSession(gameId);
  return session?.playerName || null;
}
