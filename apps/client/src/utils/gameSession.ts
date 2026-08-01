/**
 * Simple username storage utility, following freeciv-web's simpleStorage pattern
 * Only stores username for login convenience, like the original implementation
 */

const STORAGE_KEYS = {
  USERNAME: 'civjs_username',
} as const;

/**
 * Store username for login convenience (like freeciv-web's simpleStorage)
 */
export function storeUsername(username: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.USERNAME, username);
  } catch (error) {
    console.warn('Failed to store username:', error);
  }
}

/**
 * Retrieve stored username for login convenience
 */
export function getStoredUsername(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.USERNAME);
  } catch (error) {
    console.warn('Failed to retrieve username:', error);
    return null;
  }
}

/**
 * Return a reusable connection identity without asking the player to provide one.
 * Leader names are assigned independently by the server.
 */
export function getOrCreateUsername(): string {
  const storedUsername = getStoredUsername()?.trim();
  if (storedUsername) return storedUsername;

  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Date.now().toString(36);
  const username = `Player_${suffix}`.slice(0, 32);
  storeUsername(username);
  return username;
}

/**
 * Clear stored username
 */
export function clearUsername(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.USERNAME);
  } catch (error) {
    console.warn('Failed to clear username:', error);
  }
}
