/**
 * Border system constants ported from Freeciv
 * @reference freeciv/common/borders.c and freeciv-web implementation
 */

// Border system states (from freeciv game.h)
export const BORDERS_DISABLED = 0;
export const BORDERS_ENABLED = 1;

// A newly-founded city owns its center and the eight immediately surrounding
// tiles. Squared Euclidean distance 2 is the smallest radius that includes the
// diagonal corners of that 3x3 area.
export const BORDER_DEFAULT_CITY_RADIUS_SQ = 2;
export const BORDER_DEFAULT_SIZE_EFFECT = 1;
export const BORDER_DEFAULT_STRENGTH_PCT = 100;

/**
 * Civ-style accumulated city-culture thresholds for territorial expansion.
 * Each entry advances the city to the corresponding squared map radius.
 */
export const CITY_CULTURE_BORDER_RADII = [
  { minimumCulture: 0, radiusSq: 2 },
  { minimumCulture: 10, radiusSq: 5 },
  { minimumCulture: 100, radiusSq: 10 },
  { minimumCulture: 1_000, radiusSq: 17 },
  { minimumCulture: 10_000, radiusSq: 26 },
] as const;

// City map radius limits (from freeciv common/city.h)
export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = 10; // 3² + 1 = 10

// Border source types
export type BorderSourceType = 'city' | 'fort' | 'extra';

// Border calculation constants
export const FC_INFINITY = 1000000; // From freeciv FC_INFINITY constant

/**
 * Calculate city border radius from accumulated city culture.
 *
 * CivJS intentionally uses culture milestones for territorial expansion while
 * retaining Freeciv's population/effect-based border strength competition.
 *
 * @param cityCulture - The city's accumulated culture/history score
 * @returns radius squared value for border calculations
 */
export function calculateCityBorderRadiusSq(cityCulture: number): number {
  const normalizedCulture = Math.max(0, Math.trunc(cityCulture));
  let radiusSq = BORDER_DEFAULT_CITY_RADIUS_SQ;

  for (const milestone of CITY_CULTURE_BORDER_RADII) {
    if (normalizedCulture < milestone.minimumCulture) break;
    radiusSq = milestone.radiusSq;
  }

  return radiusSq;
}
