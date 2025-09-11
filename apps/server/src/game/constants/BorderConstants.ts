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
    // Small cities (size 1-2): 1 tile radius like Civ 3
    // radius = 1, radius_sq = 1² = 1
    return 1;
  } else if (citySize <= 7) {
    // Medium cities (size 3-7): 2 tile radius
    // radius = 2, radius_sq = 2² = 4 (not 5, using proper squared distance)
    return 4;
  } else if (citySize <= 12) {
    // Large cities (size 8-12): 2.5 tile radius
    // radius_sq = 6 (allows some tiles at distance 2.4)
    return 6;
  } else {
    // Huge cities (size 13+): 3 tile radius
    // radius = 3, radius_sq = 3² = 9
    return 9;
  }
}
