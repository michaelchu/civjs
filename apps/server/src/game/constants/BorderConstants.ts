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
 * Implements freeciv's progressive border expansion formula:
 * radius_sq = border_city_radius_sq + min(city_size, CITY_MAP_MAX_RADIUS_SQ) * border_size_effect
 *
 * @reference freeciv/common/borders.c:33-49 tile_border_source_radius_sq()
 * @param citySize - The population/size of the city
 * @returns radius squared value for border calculations
 */
export function calculateCityBorderRadiusSq(citySize: number): number {
  if (citySize <= 0) {
    return 0; // No borders for invalid cities
  }

  // Freeciv border expansion formula
  // Base radius (usually 5 for 2-tile radius)
  let radiusSq = BORDER_DEFAULT_CITY_RADIUS_SQ;

  // Add size effect: min(city_size, max_radius_sq) * size_effect
  const sizeBonus = Math.min(citySize, CITY_MAP_MAX_RADIUS_SQ) * BORDER_DEFAULT_SIZE_EFFECT;
  radiusSq += sizeBonus;

  return radiusSq;
}
