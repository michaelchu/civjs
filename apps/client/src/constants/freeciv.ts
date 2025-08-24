/**
 * Freeciv constants for sprite matching and cell types
 * These constants are used for tileset sprite rendering and matching logic
 * Ported from freeciv-web to TypeScript
 */

// Sprite matching types
export const MATCH_NONE = 0;
export const MATCH_SAME = 1;
export const MATCH_PAIR = 2;
export const MATCH_FULL = 3;

// Cell rendering types
export const CELL_WHOLE = 0;
export const CELL_CORNER = 1;

// Type definitions for better TypeScript support
export type MatchType =
  | typeof MATCH_NONE
  | typeof MATCH_SAME
  | typeof MATCH_PAIR
  | typeof MATCH_FULL;
export type CellType = typeof CELL_WHOLE | typeof CELL_CORNER;

// Export all constants as a single object for easier importing
export const FreecivConstants = {
  MATCH_NONE,
  MATCH_SAME,
  MATCH_PAIR,
  MATCH_FULL,
  CELL_WHOLE,
  CELL_CORNER,
} as const;

// Additional rendering constants that are commonly used with these constants
export const NUM_CARDINAL_DIRS = 4;
export const NUM_CORNER_DIRS = 4;

// Direction mappings - N, S, E, W for CELL_CORNER sprite mapping
export const DIR4_TO_DIR8 = [0, 4, 2, 6] as const;

// Cardinal directions for MATCH_SAME and dithering - N, E, S, W
export const CARDINAL_TILESET_DIRS = [0, 2, 4, 6] as const;
