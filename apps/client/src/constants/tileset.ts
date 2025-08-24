/**
 * Tileset constants for freeciv-web compatibility
 * These constants define matching styles and cell types for terrain rendering
 */

export const TILESET_CONSTANTS = {
  // Match styles for terrain blending
  MATCH_NONE: 0,
  MATCH_SAME: 1,
  MATCH_PAIR: 2,
  MATCH_FULL: 3,
  
  // Cell types for sprite rendering
  CELL_WHOLE: 0,
  CELL_CORNER: 1
} as const;

// Export individual constants for convenience
export const { 
  MATCH_NONE, 
  MATCH_SAME, 
  MATCH_PAIR, 
  MATCH_FULL,
  CELL_WHOLE,
  CELL_CORNER 
} = TILESET_CONSTANTS;

// Type definitions
export type MatchStyle = typeof MATCH_NONE | typeof MATCH_SAME | typeof MATCH_PAIR | typeof MATCH_FULL;
export type CellType = typeof CELL_WHOLE | typeof CELL_CORNER;