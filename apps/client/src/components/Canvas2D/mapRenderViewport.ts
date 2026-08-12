/**
 * @module client/components/Canvas2D/mapRenderViewport
 * Shares the viewport snapshot that MapCanvas has most recently painted with
 * overlays such as the minimap viewport outline.
 */
import type { MapViewport } from '../../types';

let activeViewport: MapViewport | null = null;
const listeners = new Set<() => void>();

export const getMapRenderViewport = (): MapViewport | null => activeViewport;

export const subscribeMapRenderViewport = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Publish the viewport currently being painted by MapCanvas. Camera slides and
 * drag previews render an override before committing it to Zustand; the HUD
 * must use that same snapshot so its footprint cannot lag the world canvas.
 */
export const setMapRenderViewport = (viewport: MapViewport | null): void => {
  if (activeViewport === viewport) return;
  activeViewport = viewport;
  for (const listener of listeners) listener();
};
