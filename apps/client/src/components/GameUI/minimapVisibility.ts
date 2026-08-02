/**
 * @module client/components/GameUI/minimapVisibility
 * Defines the minimap Visibility client UI component.
 */
import type { Tile } from '../../types';

export const isMinimapMarkerVisible = (
  tile: Tile | undefined,
  ownerId: string,
  currentPlayerId: string,
  requiresCurrentVisibility: boolean
): boolean => {
  if (!tile) return false;
  if (ownerId === currentPlayerId) return true;
  return requiresCurrentVisibility ? tile.visible : tile.known;
};
