import { describe, expect, it } from 'vitest';
import {
  createMapGeometry,
  displayToNativePosition,
  getProjectedMapBounds,
  guiToMapPositionContinuous,
  guiToNativePosition,
  nativeToDisplayPosition,
  nativeToGuiPosition,
  TOPOLOGY_HEX,
  TOPOLOGY_ISO,
} from '../mapTopologyGeometry';

describe('map topology geometry', () => {
  it('uses the current Freeciv protocol bits for ISO and HEX topology', () => {
    expect(TOPOLOGY_ISO).toBe(1);
    expect(TOPOLOGY_HEX).toBe(2);
  });

  it('keeps native C2C3 dimensions while exposing natural display dimensions', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);

    expect(geometry).toEqual({
      nativeWidth: 32,
      nativeHeight: 64,
      displayWidth: 64,
      displayHeight: 64,
      isIsometric: true,
    });
  });

  it('projects a 32x64 native ISO map into landscape GUI bounds', () => {
    const bounds = getProjectedMapBounds(
      createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX),
      96,
      48
    );

    expect(bounds.width).toBeGreaterThan(bounds.height);
  });

  it('round-trips every native C2C3 tile through natural/display coordinates', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);

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
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);

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

  it('retains sub-tile precision for overview viewport corners', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);
    const tile = nativeToGuiPosition(21, 37, geometry, 96, 48);

    expect(guiToMapPositionContinuous(tile.x + 48, tile.y + 24, 96, 48)).toEqual({
      x: 21.5,
      y: 37.5,
    });
  });

  it('retains rectangular native/display behavior for non-ISO maps', () => {
    const geometry = createMapGeometry(80, 50, 0);

    expect(geometry.displayWidth).toBe(80);
    expect(geometry.displayHeight).toBe(50);
    expect(nativeToDisplayPosition(7, 11, geometry)).toEqual({ x: 7, y: 11 });
    expect(displayToNativePosition(7, 11, geometry)).toEqual({ x: 7, y: 11 });
  });
});
