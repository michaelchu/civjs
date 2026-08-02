/**
 * @module server/game/constants/GameConstants
 * Game Constants - Core game enumeration and constant values
 * @reference freeciv/common/fc_types.h - Output_type_id
 */

/**
 * Output types for city production
 * Based on Freeciv's Output_type_id enum (O_FOOD, O_SHIELD, etc.)
 */
export enum OutputType {
  FOOD = 'food',
  SHIELD = 'shield',
  TRADE = 'trade',
  GOLD = 'gold',
  LUXURY = 'luxury',
  SCIENCE = 'science',
}

/**
 * Number of different output types
 */
export const OUTPUT_TYPE_COUNT = Object.keys(OutputType).length;

/**
 * All output types as array for iteration
 */
export const ALL_OUTPUT_TYPES = Object.values(OutputType);
