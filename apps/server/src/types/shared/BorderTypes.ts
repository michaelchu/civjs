/**
 * Shared border system types for CivJS
 * These types are used across client-server communication
 * @reference freeciv/common/borders.h and port plan Phase 1.1
 */

import type { BorderSourceType } from '@game/constants/BorderConstants';

export interface BorderSource {
  x: number;
  y: number;
  strength: number;
  radius: number;
  playerId: string;
  type: BorderSourceType;
  cityId?: string; // If source is a city
  extraType?: string; // If source is an extra/fort
}

export interface TileOwnership {
  x: number;
  y: number;
  playerId: string | null;
  strength: number;
  claimedBy: BorderSource | null;
}

/**
 * Represents the border status between two tiles
 */
export interface BorderEdge {
  fromTile: { x: number; y: number };
  toTile: { x: number; y: number };
  direction: 'N' | 'E' | 'S' | 'W';
  fromOwner: number | null;
  toOwner: number | null;
  isBorder: boolean;
}

/**
 * Border update event data
 */
export interface BorderUpdate {
  tiles: TileOwnership[];
  sources: BorderSource[];
  removedSources: Array<{ x: number; y: number; playerId?: string }>;
  affectedPlayers: string[];
}
