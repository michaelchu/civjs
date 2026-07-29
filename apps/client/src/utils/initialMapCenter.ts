import type { City, GameState, Tile, Unit } from '../types';

export interface MapCenterTile {
  x: number;
  y: number;
}

interface FindInitialMapCenterOptions {
  mapData?: GameState['mapData'];
  currentPlayerId: string;
  units: Record<string, Unit>;
  cities: Record<string, City>;
  tiles: Record<string, Tile>;
  hasReceivedUnitSnapshot: boolean;
}

/**
 * Choose the initial camera target without racing the initial map and unit
 * snapshots. Players wait for their full unit snapshot before falling back to
 * a visible tile; observers can use a visible tile immediately.
 */
export function findInitialMapCenter({
  mapData,
  currentPlayerId,
  units,
  cities,
  tiles,
  hasReceivedUnitSnapshot,
}: FindInitialMapCenterOptions): MapCenterTile | null {
  const playerStart = mapData?.startingPositions?.find(
    position => position.playerId === currentPlayerId
  );
  if (playerStart) {
    return { x: playerStart.x, y: playerStart.y };
  }

  const playerUnit = Object.values(units).find(unit => unit.playerId === currentPlayerId);
  if (playerUnit) {
    return { x: playerUnit.x, y: playerUnit.y };
  }

  const playerCity = Object.values(cities).find(city => city.playerId === currentPlayerId);
  if (playerCity) {
    return { x: playerCity.x, y: playerCity.y };
  }

  if (currentPlayerId && !hasReceivedUnitSnapshot) {
    return null;
  }

  const visibleTile = Object.values(tiles).find(tile => tile.visible);
  return visibleTile ? { x: visibleTile.x, y: visibleTile.y } : null;
}
