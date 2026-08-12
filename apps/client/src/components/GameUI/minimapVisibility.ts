/**
 * @module client/components/GameUI/minimapVisibility
 * Defines the minimap Visibility client UI component.
 */
import type { Tile } from '../../types';

export const MINIMAP_COLORS = {
  unknown: '#000000',
  myCity: '#ffffff',
  foreignCity: '#00ffff',
  myUnit: '#ffff00',
  foreignUnit: '#ff0000',
} as const;

export type MinimapCellMarker = {
  kind: 'city' | 'unit';
  ownerId: string;
  ownerColor?: string;
};

export interface MinimapCellAppearance {
  color: string;
}

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

/**
 * Resolve one overview cell using Freeciv's marker-over-owner-over-terrain
 * precedence. The legacy overview uses the same order in overview_tile_color.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:342-379
 */
export const getMinimapCellAppearance = (
  tile: Tile | undefined,
  terrainColor: string,
  currentPlayerId: string,
  ownerColor?: string,
  marker?: MinimapCellMarker
): MinimapCellAppearance => {
  if (!tile || !tile.known) {
    return { color: MINIMAP_COLORS.unknown };
  }

  if (
    marker?.kind === 'city' &&
    isMinimapMarkerVisible(tile, marker.ownerId, currentPlayerId, false)
  ) {
    return {
      color:
        marker.ownerId === currentPlayerId ? MINIMAP_COLORS.myCity : MINIMAP_COLORS.foreignCity,
    };
  }

  if (
    marker?.kind === 'unit' &&
    isMinimapMarkerVisible(tile, marker.ownerId, currentPlayerId, true)
  ) {
    return {
      color:
        marker.ownerId === currentPlayerId
          ? MINIMAP_COLORS.myUnit
          : marker.ownerColor || MINIMAP_COLORS.foreignUnit,
    };
  }

  return { color: tile.owner && ownerColor ? ownerColor : terrainColor };
};
