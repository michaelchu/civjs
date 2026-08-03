/**
 * @module client/components/Canvas2D/mapRenderMetrics
 * Shares the active tileset geometry with UI overlays that project the map viewport.
 */
export interface MapRenderTileSize {
  width: number;
  height: number;
}

let currentTileSize: MapRenderTileSize = { width: 96, height: 48 };
const listeners = new Set<() => void>();

export const getMapRenderTileSize = (): MapRenderTileSize => currentTileSize;

export const subscribeMapRenderTileSize = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setMapRenderTileSize = (next: MapRenderTileSize): void => {
  if (next.width === currentTileSize.width && next.height === currentTileSize.height) return;
  currentTileSize = { width: next.width, height: next.height };
  listeners.forEach(listener => listener());
};
