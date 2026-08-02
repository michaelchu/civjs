/**
 * @module server/utils/playerColors
 * Nation color system with 3-color themes for visual distinction
 * Colors are chosen to be distinct, historically appropriate, and avoid ocean-like blues
 */
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

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
const classicColors = rulesetLoader.loadGameRulesRuleset().player_colors;

export const NATION_COLOR_THEMES: NationColorTheme[] = classicColors.colorlist.map(
  (primary, index) => ({
    name: `Classic ${index + 1}`,
    primary,
    // CivJS keeps secondary/tertiary UI accents around Freeciv's authoritative
    // player color. The ruleset background is the stable contrasting fallback.
    secondary: { r: 255, g: 255, b: 255 },
    tertiary: {
      r: classicColors['background.r'],
      g: classicColors['background.g'],
      b: classicColors['background.b'],
    },
  })
);

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
 * @returns Randomly selected available color theme, or a random one if all are used
 */
export function getNextPlayerColorTheme(usedThemes: NationColorTheme[]): NationColorTheme {
  // Filter to get all unused themes
  const availableThemes = NATION_COLOR_THEMES.filter(theme => {
    const isUsed = usedThemes.some(
      used =>
        used &&
        used.primary &&
        used.primary.r === theme.primary.r &&
        used.primary.g === theme.primary.g &&
        used.primary.b === theme.primary.b
    );
    return !isUsed;
  });

  // If there are available themes, randomly select one
  if (availableThemes.length > 0) {
    const randomIndex = Math.floor(Math.random() * availableThemes.length);
    return availableThemes[randomIndex];
  }

  // If all predefined themes are used, return a random one from the palette
  return NATION_COLOR_THEMES[Math.floor(Math.random() * NATION_COLOR_THEMES.length)];
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
