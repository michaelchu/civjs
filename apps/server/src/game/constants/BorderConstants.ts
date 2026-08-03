/**
 * @module server/game/constants/BorderConstants
 * Border system constants ported from Freeciv
 * @reference freeciv/common/borders.c and freeciv-web implementation
 */

// Border system states (from freeciv game.h)
export const BORDERS_DISABLED = 0;
export const BORDERS_ENABLED = 1;

// C2C3 game.ruleset [borders]. A city's population is added separately,
// capped at CITY_MAP_MAX_RADIUS_SQ.
export const BORDER_DEFAULT_CITY_RADIUS_SQ = 5;
export const BORDER_DEFAULT_SIZE_EFFECT = 1;
export const BORDER_DEFAULT_STRENGTH_PCT = 100;

// City map radius limits (from freeciv common/city.h)
export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = 10; // 3² + 1 = 10

// Border source types
export type BorderSourceType = 'city' | 'fort' | 'extra';

// Border calculation constants
export const FC_INFINITY = 1000000; // From freeciv FC_INFINITY constant
