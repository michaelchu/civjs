/**
 * @module client/utils/playerColors
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

/** Return a readable foreground for a player-color-backed surface. */
export function getContrastingTextColor(backgroundColor: string): '#0f172a' | '#f8fafc' {
  const rgb = parseColor(backgroundColor);
  if (!rgb) return '#f8fafc';

  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);

  return luminance > 0.179 ? '#0f172a' : '#f8fafc';
}

function parseColor(color: string): PlayerColor | null {
  const hex = color.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(`${hex[0]}${hex[0]}`, 16),
      g: parseInt(`${hex[1]}${hex[1]}`, 16),
      b: parseInt(`${hex[2]}${hex[2]}`, 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) return hexToPlayerColor(hex);

  const rgbMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgbMatch) return null;
  return { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) };
}
