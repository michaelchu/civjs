/**
 * Player color utilities for converting between RGB objects and CSS hex strings
 * These should match the server-side color definitions
 */

export interface PlayerColor {
  r: number;
  g: number;
  b: number;
}

/**
 * Convert PlayerColor object to CSS hex string
 */
export function playerColorToHex(color: PlayerColor): string {
  const r = Math.round(color.r).toString(16).padStart(2, '0');
  const g = Math.round(color.g).toString(16).padStart(2, '0');
  const b = Math.round(color.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Convert hex string to PlayerColor object
 */
export function hexToPlayerColor(hex: string): PlayerColor {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return { r, g, b };
}
