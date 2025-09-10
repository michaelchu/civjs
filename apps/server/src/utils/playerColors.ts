/**
 * Nation color system with 3-color themes for visual distinction
 * Colors are chosen to be distinct, historically appropriate, and avoid ocean-like blues
 */

export interface PlayerColor {
  r: number;
  g: number;
  b: number;
}

export interface NationColorTheme {
  primary: PlayerColor; // Main color for borders, units, UI elements
  secondary: PlayerColor; // Secondary color for text, highlights
  tertiary: PlayerColor; // Accent color for special elements
  name: string; // Theme name for debugging
}

/**
 * Predefined nation color themes - avoiding ocean-like blues
 * Each theme has primary, secondary, and tertiary colors
 */
export const NATION_COLOR_THEMES: NationColorTheme[] = [
  // Classic Empire Colors
  {
    name: 'Roman Red',
    primary: { r: 204, g: 0, b: 0 }, // Deep Red
    secondary: { r: 255, g: 215, b: 0 }, // Gold
    tertiary: { r: 139, g: 69, b: 19 }, // Saddle Brown
  },
  {
    name: 'Imperial Purple',
    primary: { r: 138, g: 43, b: 226 }, // Blue Violet
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 255, g: 215, b: 0 }, // Gold
  },
  {
    name: 'Forest Green',
    primary: { r: 34, g: 139, b: 34 }, // Forest Green
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 139, g: 69, b: 19 }, // Saddle Brown
  },
  {
    name: 'Royal Gold',
    primary: { r: 255, g: 215, b: 0 }, // Gold
    secondary: { r: 139, g: 0, b: 0 }, // Dark Red
    tertiary: { r: 0, g: 0, b: 0 }, // Black
  },
  {
    name: 'Crimson Empire',
    primary: { r: 220, g: 20, b: 60 }, // Crimson
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 255, g: 215, b: 0 }, // Gold
  },
  {
    name: 'Bright Azure',
    primary: { r: 0, g: 127, b: 255 }, // Bright Blue (not ocean-like)
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 255, g: 215, b: 0 }, // Gold
  },
  {
    name: 'Orange Dynasty',
    primary: { r: 255, g: 140, b: 0 }, // Dark Orange
    secondary: { r: 0, g: 0, b: 0 }, // Black
    tertiary: { r: 255, g: 255, b: 255 }, // White
  },
  {
    name: 'Emerald Kingdom',
    primary: { r: 0, g: 201, b: 87 }, // Emerald Green
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 139, g: 69, b: 19 }, // Saddle Brown
  },
  {
    name: 'Magenta Empire',
    primary: { r: 255, g: 0, b: 255 }, // Magenta
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 0, g: 0, b: 0 }, // Black
  },
  {
    name: 'Copper Bronze',
    primary: { r: 184, g: 115, b: 51 }, // Copper
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 139, g: 0, b: 0 }, // Dark Red
  },
  {
    name: 'Silver Steel',
    primary: { r: 192, g: 192, b: 192 }, // Silver
    secondary: { r: 0, g: 0, b: 0 }, // Black
    tertiary: { r: 0, g: 127, b: 255 }, // Bright Blue
  },
  {
    name: 'Rose Kingdom',
    primary: { r: 255, g: 20, b: 147 }, // Deep Pink
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 139, g: 0, b: 139 }, // Dark Magenta
  },
  {
    name: 'Amber Empire',
    primary: { r: 255, g: 191, b: 0 }, // Amber
    secondary: { r: 139, g: 69, b: 19 }, // Saddle Brown
    tertiary: { r: 255, g: 255, b: 255 }, // White
  },
  {
    name: 'Jade Dynasty',
    primary: { r: 0, g: 168, b: 107 }, // Jade Green
    secondary: { r: 255, g: 215, b: 0 }, // Gold
    tertiary: { r: 139, g: 0, b: 0 }, // Dark Red
  },
  {
    name: 'Violet Reign',
    primary: { r: 148, g: 0, b: 211 }, // Dark Violet
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 255, g: 215, b: 0 }, // Gold
  },
  {
    name: 'Coral Empire',
    primary: { r: 255, g: 127, b: 80 }, // Coral
    secondary: { r: 255, g: 255, b: 255 }, // White
    tertiary: { r: 0, g: 0, b: 139 }, // Dark Blue
  },
];

// Legacy support - primary colors only for backward compatibility
export const PLAYER_COLORS: PlayerColor[] = NATION_COLOR_THEMES.map(theme => theme.primary);

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
 * Get the next available color theme for a new player
 * @param usedThemes - Array of color themes already in use
 * @returns Next available color theme, or a random one if all are used
 */
export function getNextPlayerColorTheme(usedThemes: NationColorTheme[]): NationColorTheme {
  // Find the first unused theme
  for (const theme of NATION_COLOR_THEMES) {
    const isUsed = usedThemes.some(
      used =>
        used.primary.r === theme.primary.r &&
        used.primary.g === theme.primary.g &&
        used.primary.b === theme.primary.b
    );
    if (!isUsed) {
      return theme;
    }
  }

  // If all predefined themes are used, return a random one from the palette
  return NATION_COLOR_THEMES[Math.floor(Math.random() * NATION_COLOR_THEMES.length)];
}

/**
 * Legacy function - Get the next available primary color for a new player
 * @param usedColors - Array of colors already in use
 * @returns Next available color, or a random color if all are used
 */
export function getNextPlayerColor(usedColors: PlayerColor[]): PlayerColor {
  // Find the first unused color
  for (const color of PLAYER_COLORS) {
    const isUsed = usedColors.some(
      used => used.r === color.r && used.g === color.g && used.b === color.b
    );
    if (!isUsed) {
      return color;
    }
  }

  // If all predefined colors are used, return a random one from the palette
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

/**
 * Convert NationColorTheme to CSS hex strings
 */
export function colorThemeToHex(theme: NationColorTheme): {
  primary: string;
  secondary: string;
  tertiary: string;
} {
  return {
    primary: playerColorToHex(theme.primary),
    secondary: playerColorToHex(theme.secondary),
    tertiary: playerColorToHex(theme.tertiary),
  };
}

/**
 * Get a color theme by name (for debugging/testing)
 */
export function getColorThemeByName(name: string): NationColorTheme | null {
  return NATION_COLOR_THEMES.find(theme => theme.name === name) || null;
}
