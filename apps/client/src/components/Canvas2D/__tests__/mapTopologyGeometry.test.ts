import { describe, expect, it } from 'vitest';
import {
  createMapGeometry,
  displayToNativePosition,
  getCardinalMapDirections,
  getProjectedMapBounds,
  getValidMapDirections,
  guiToMapPosition,
  guiToMapPositionContinuous,
  guiToNativePosition,
  nativeToDisplayPosition,
  nativeToGuiPosition,
  nativeToMapPosition,
  sortMapPointsInPainterOrder,
  stepNativeMapPosition,
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
      isHex: true,
      topologyId: 3,
    });
  });

  it('uses the six clockwise Freeciv directions for ISO-hex composition', () => {
    const topology = TOPOLOGY_ISO | TOPOLOGY_HEX;

    expect(getValidMapDirections(topology).map(direction => direction.name)).toEqual([
      'n',
      'e',
      'se',
      's',
      'w',
      'nw',
    ]);
    expect(getCardinalMapDirections(topology).map(direction => direction.name)).toEqual([
      'n',
      'e',
      'se',
      's',
      'w',
      'nw',
    ]);
  });

  it('uses Hexemplio side geometry when selecting a tile near sloped hex edges', () => {
    expect(guiToMapPosition(0, 0, 126, 64, 16)).toEqual({ x: -1, y: 0 });
    expect(guiToMapPosition(63, 32, 126, 64, 16)).toEqual({ x: 0, y: 0 });
    expect(guiToMapPosition(125, 0, 126, 64, 16)).toEqual({ x: 0, y: -1 });
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
        const gui = nativeToGuiPosition(nativeX, nativeY, geometry, 126, 64);
        expect(guiToNativePosition(gui.x + 63, gui.y + 32, geometry, 126, 64, 16)).toEqual({
          x: nativeX,
          y: nativeY,
        });
      }
    }
  });

  it('projects C2C3 native rows through Freeciv logical coordinates', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);
    const native = { x: 21, y: 37 };
    const logical = nativeToMapPosition(native.x, native.y, geometry.nativeWidth, true);

    expect(logical).toEqual({ x: 40, y: 29 });
    expect(nativeToGuiPosition(native.x, native.y, geometry, 126, 64)).toEqual({
      x: 693,
      y: 2208,
    });
  });

  it('steps ISO-hex neighbors in logical space and returns native storage positions', () => {
    const topology = TOPOLOGY_ISO | TOPOLOGY_HEX;
    const positions = getCardinalMapDirections(topology).map(direction =>
      stepNativeMapPosition(4, 3, direction.dx, direction.dy, 10, 12, topology, 0)
    );

    expect(positions).toEqual([
      { x: 5, y: 2 },
      { x: 5, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 4, y: 2 },
      { x: 4, y: 1 },
    ]);
    expect(stepNativeMapPosition(31, 3, 1, 0, 32, 64, topology, 0)).toBeNull();
    expect(stepNativeMapPosition(31, 3, 1, 0, 32, 64, topology, 1)).toEqual({ x: 0, y: 4 });
  });

  it('sorts ISO-hex native tiles in projected row-major painter order', () => {
    const topology = TOPOLOGY_ISO | TOPOLOGY_HEX;
    const points = [
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 2 },
      { x: 0, y: 1 },
    ];

    expect(sortMapPointsInPainterOrder(points, topology)).toEqual([
      { x: 0, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
    ]);
  });

  it('retains sub-tile precision for overview viewport corners', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO | TOPOLOGY_HEX);
    const tile = nativeToGuiPosition(21, 37, geometry, 96, 48);

    expect(guiToMapPositionContinuous(tile.x + 48, tile.y + 24, 96, 48)).toEqual({
      x: 40.5,
      y: 29.5,
    });
  });

  it('retains freeciv-web direct packet-grid projection for topology 1 snapshots', () => {
    const geometry = createMapGeometry(32, 64, TOPOLOGY_ISO);
    const gui = nativeToGuiPosition(21, 37, geometry, 96, 48);

    expect(gui).toEqual({ x: -768, y: 1392 });
    expect(guiToNativePosition(gui.x + 48, gui.y + 24, geometry, 96, 48)).toEqual({
      x: 21,
      y: 37,
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
