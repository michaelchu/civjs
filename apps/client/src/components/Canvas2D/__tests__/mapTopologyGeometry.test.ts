import { describe, expect, it } from 'vitest';
import {
  createMapGeometry,
  displayToNativePosition,
  getProjectedMapBounds,
  guiToNativePosition,
  nativeToDisplayPosition,
  nativeToGuiPosition,
} from '../mapTopologyGeometry';

describe('map topology geometry', () => {
  it('keeps native C2C3 dimensions while exposing natural display dimensions', () => {
    const geometry = createMapGeometry(32, 64, 12);

    expect(geometry).toEqual({
      nativeWidth: 32,
      nativeHeight: 64,
      displayWidth: 64,
      displayHeight: 64,
      isIsometric: true,
    });
  });

  it('projects a 32x64 native ISO map into landscape GUI bounds', () => {
    const bounds = getProjectedMapBounds(createMapGeometry(32, 64, 12), 96, 48);

    expect(bounds.width).toBeGreaterThan(bounds.height);
  });

  it('round-trips every native C2C3 tile through natural/display coordinates', () => {
    const geometry = createMapGeometry(32, 64, 12);

    for (let nativeY = 0; nativeY < geometry.nativeHeight; nativeY += 1) {
      for (let nativeX = 0; nativeX < geometry.nativeWidth; nativeX += 1) {
        const display = nativeToDisplayPosition(nativeX, nativeY, geometry);
        expect(displayToNativePosition(display.x + 1, display.y, geometry)).toEqual({
          x: nativeX,
          y: nativeY,
        });
      }
    }
  });

  it('round-trips native tile centers through the canvas GUI projection', () => {
    const geometry = createMapGeometry(32, 64, 12);

    for (let nativeY = 0; nativeY < geometry.nativeHeight; nativeY += 1) {
      for (let nativeX = 0; nativeX < geometry.nativeWidth; nativeX += 1) {
        const gui = nativeToGuiPosition(nativeX, nativeY, geometry, 96, 48);
        expect(guiToNativePosition(gui.x + 48, gui.y + 24, geometry, 96, 48)).toEqual({
          x: nativeX,
          y: nativeY,
        });
      }
    }
  });

  it('retains rectangular native/display behavior for non-ISO maps', () => {
    const geometry = createMapGeometry(80, 50, 0);

    expect(geometry.displayWidth).toBe(80);
    expect(geometry.displayHeight).toBe(50);
    expect(nativeToDisplayPosition(7, 11, geometry)).toEqual({ x: 7, y: 11 });
    expect(displayToNativePosition(7, 11, geometry)).toEqual({ x: 7, y: 11 });
  });
});
