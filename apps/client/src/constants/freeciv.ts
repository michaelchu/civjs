/**
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

// Direction constants - ported from freeciv-web for exact compatibility
export const DIR8_NORTH = 0;
export const DIR8_NORTHEAST = 1;
export const DIR8_EAST = 2;
export const DIR8_SOUTHEAST = 3;
export const DIR8_SOUTH = 4;
export const DIR8_SOUTHWEST = 5;
export const DIR8_WEST = 6;
export const DIR8_NORTHWEST = 7;

// Direction mappings - N, S, E, W for CELL_CORNER sprite mapping
export const DIR4_TO_DIR8 = [DIR8_NORTH, DIR8_SOUTH, DIR8_EAST, DIR8_WEST] as const;

// Cardinal directions for MATCH_SAME and dithering - N, E, S, W
export const CARDINAL_TILESET_DIRS = [DIR8_NORTH, DIR8_EAST, DIR8_SOUTH, DIR8_WEST] as const;

// Tile ownership constants - ported from freeciv reference
export const UNOWNED_TILE = 255; // Special constant for tiles not owned by anyone (freeciv standard)

// Border rendering constants
export const BORDER_LINE_WIDTH = 2;
export const BORDER_ALPHA = 0.8;
export const DEFAULT_BORDER_COLOR = '#FFFFFF';
export const DEBUG_BORDER_COLOR = '#FF0000';

// Expose constants globally for compatibility with freeciv-web tileset scripts
// This ensures that dynamically loaded JavaScript files from the server can access these constants
declare global {
  interface Window {
    MATCH_NONE: number;
    MATCH_SAME: number;
    MATCH_PAIR: number;
    MATCH_FULL: number;
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
  window.CELL_WHOLE = CELL_WHOLE;
  window.CELL_CORNER = CELL_CORNER;
}
