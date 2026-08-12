/**
 * @module client/constants/freeciv
 * Freeciv constants for sprite matching and cell types
 * These constants are used for tileset sprite rendering and matching logic
 * Ported from freeciv-web to TypeScript
 *
 * NOTE: These constants are also exposed globally on window for compatibility
 * with legacy freeciv-web tileset scripts loaded from the server.
 */

// Sprite matching types
export const MATCH_NONE = 0;
export const MATCH_SAME = 1;
export const MATCH_PAIR = 2;
export const MATCH_FULL = 3;
export const MATCH_RANDOM = 4; // Random match for terrain variation

// Cell rendering types
export const CELL_WHOLE = 0;
export const CELL_CORNER = 1;

// Type definitions for better TypeScript support
export type MatchType =
  | typeof MATCH_NONE
  | typeof MATCH_SAME
  | typeof MATCH_PAIR
  | typeof MATCH_FULL
  | typeof MATCH_RANDOM;
export type CellType = typeof CELL_WHOLE | typeof CELL_CORNER;

// Export all constants as a single object for easier importing
export const FreecivConstants = {
  MATCH_NONE,
  MATCH_SAME,
  MATCH_PAIR,
  MATCH_FULL,
  MATCH_RANDOM,
  CELL_WHOLE,
  CELL_CORNER,
} as const;

// Additional rendering constants that are commonly used with these constants
export const NUM_CARDINAL_DIRS = 4;
export const NUM_CORNER_DIRS = 4;

// Freeciv-web's DIR8 order is NW, N, NE, W, E, SW, S, SE.
// CELL_CORNER and dither use DIR4_TO_DIR8 = N, S, E, W. The MATCH_SAME
// branch intentionally indexes the first four DIR8 entries directly.
export const DIR4_TO_DIR8 = [1, 6, 4, 3] as const;
export const CARDINAL_TILESET_DIRS = [1, 4, 6, 3] as const;

// Expose constants globally for compatibility with freeciv-web tileset scripts
// This ensures that dynamically loaded JavaScript files from the server can access these constants
declare global {
  interface Window {
    MATCH_NONE: number;
    MATCH_SAME: number;
    MATCH_PAIR: number;
    MATCH_FULL: number;
    MATCH_RANDOM: number;
    CELL_WHOLE: number;
    CELL_CORNER: number;
  }
}

// Set global window properties for backward compatibility
if (typeof window !== 'undefined') {
  window.MATCH_NONE = MATCH_NONE;
  window.MATCH_SAME = MATCH_SAME;
  window.MATCH_PAIR = MATCH_PAIR;
  window.MATCH_FULL = MATCH_FULL;
  window.MATCH_RANDOM = MATCH_RANDOM;
  window.CELL_WHOLE = CELL_WHOLE;
  window.CELL_CORNER = CELL_CORNER;
}
