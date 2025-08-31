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
 * Clear stored username
 */
export function clearUsername(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.USERNAME);
  } catch (error) {
    console.warn('Failed to clear username:', error);
  }
}
