/**
 * Standard player colors for consistent appearance across server and client
 * These colors are chosen to be distinct and work well in the game UI
 */

export interface PlayerColor {
  r: number;
  g: number;
  b: number;
}

export const PLAYER_COLORS: PlayerColor[] = [
  { r: 255, g: 69, b: 0 },   // Red-Orange
  { r: 30, g: 144, b: 255 }, // Dodge Blue
  { r: 50, g: 205, b: 50 },  // Lime Green
  { r: 255, g: 215, b: 0 },  // Gold
  { r: 138, g: 43, b: 226 }, // Blue Violet
  { r: 255, g: 20, b: 147 }, // Deep Pink
  { r: 0, g: 191, b: 255 },  // Deep Sky Blue
  { r: 255, g: 140, b: 0 },  // Dark Orange
  { r: 124, g: 252, b: 0 },  // Lawn Green
  { r: 220, g: 20, b: 60 },  // Crimson
  { r: 0, g: 255, b: 255 },  // Cyan
  { r: 255, g: 105, b: 180 }, // Hot Pink
];

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

/**
 * Get the next available color for a new player
 * @param usedColors - Array of colors already in use
 * @returns Next available color, or a random color if all are used
 */
export function getNextPlayerColor(usedColors: PlayerColor[]): PlayerColor {
  // Find the first unused color
  for (const color of PLAYER_COLORS) {
    const isUsed = usedColors.some(used => 
      used.r === color.r && used.g === color.g && used.b === color.b
    );
    if (!isUsed) {
      return color;
    }
  }
  
  // If all predefined colors are used, return a random one from the palette
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}