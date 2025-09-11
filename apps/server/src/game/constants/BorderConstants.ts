/**
 * Border system constants ported from Freeciv
 * @reference freeciv/common/borders.c and freeciv-web implementation
 */

// Border system states (from freeciv game.h)
export const BORDERS_DISABLED = 0;
export const BORDERS_ENABLED = 1;

// Default border configuration values (from freeciv)
export const BORDER_DEFAULT_CITY_RADIUS_SQ = 5; // radius 2: 2² + 1 = 5
export const BORDER_DEFAULT_SIZE_EFFECT = 1;
export const BORDER_DEFAULT_STRENGTH_PCT = 100;

// City map radius limits (from freeciv common/city.h)
export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = 10; // 3² + 1 = 10

// Border source types
export type BorderSourceType = 'city' | 'fort' | 'extra';

// Border calculation constants
export const FC_INFINITY = 1000000; // From freeciv FC_INFINITY constant

/**
 * Calculate city border radius squared based on population/size
 * Implements progressive expansion: small cities start with 1 tile radius,
 * grow to medium radius, then large radius as population increases
 *
 * @param citySize - The population/size of the city
 * @returns radius squared value for border calculations
 */
export function calculateCityBorderRadiusSq(citySize: number): number {
  if (citySize <= 0) {
    return 0; // No borders for invalid cities
  } else if (citySize <= 2) {
    // Small cities (size 1-2): 1 tile radius like Civ 3 (3x3 square)
    // Need radius_sq = 2 to include diagonal tiles: √2 ≈ 1.41 <= √2
    return 2;
  } else {
    // Medium+ cities (size 3+): 2 tile radius with 21 tiles (~2.2 radius)
    // radius_sq = 5 (freeciv default, matches 21 tile pattern)
    return 5;
  }
}
