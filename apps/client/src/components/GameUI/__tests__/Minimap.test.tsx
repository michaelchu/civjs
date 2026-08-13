import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import type { City, Player } from '../../../types';
import { TOPOLOGY_HEX, TOPOLOGY_ISO } from '../../Canvas2D/mapTopologyGeometry';
import { Minimap } from '../Minimap';
import {
  getMinimapCellAppearance,
  isMinimapMarkerVisible,
  MINIMAP_COLORS,
} from '../minimapVisibility';
import {
  getMinimapLayout,
  getMinimapCellWidth,
  getMinimapSourceTileOrigins,
  getMinimapTileOrigins,
  getMinimapViewportPolygons,
  guiToMapPos,
  minimapPointToMapTile,
  minimapPositionToNative,
  nativeToMinimapPixelPosition,
  nativeToMinimapPosition,
  VIEWPORT_OUTLINE_COLOR,
  VIEWPORT_OUTLINE_WIDTH,
} from '../minimapGeometry';

const C2C3_TOPOLOGY = TOPOLOGY_ISO | TOPOLOGY_HEX;

describe('Minimap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    useGameStore.setState({
      currentPlayerId: 'player-1',
      map: {
        width: 4,
        height: 3,
        xsize: 4,
        ysize: 3,
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'grassland', known: true, visible: true },
          '1,0': { x: 1, y: 0, terrain: 'ocean', known: true, visible: true },
        },
      },
      units: {},
      cities: {},
      players: {},
      selectedUnitId: null,
      selectedCityId: null,
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    });
  });

  it('renders an accessible overview canvas', () => {
    render(<Minimap />);
    expect(screen.getByLabelText('Minimap overview')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });

  it('renders a 32x64 ISO map with Freeciv physical overview proportions', () => {
    useGameStore.setState({
      map: {
        width: 32,
        height: 64,
        xsize: 32,
        ysize: 64,
        topology_id: 3,
        wrap_id: 3,
        tiles: {},
      },
    });

    render(<Minimap />);
    const canvas = screen.getByLabelText('Minimap overview');
    expect(canvas).toHaveAttribute('width', '256');
    expect(canvas).toHaveAttribute('height', '256');
  });

  it('dispatches a map-centering request when clicked', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Minimap />);
    fireEvent.click(screen.getByLabelText('Minimap overview'), { clientX: 80, clientY: 50 });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'center-map-on-tile',
        detail: expect.objectContaining({ source: 'minimap-click' }),
      })
    );
  });

  it('centers once for a click after the pointer lifecycle', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Minimap />);
    const minimap = screen.getByLabelText('Minimap overview');

    fireEvent.pointerDown(minimap, { clientX: 80, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(minimap, { clientX: 80, clientY: 50, pointerId: 1 });
    fireEvent.click(minimap, { clientX: 80, clientY: 50 });

    const centerEvents = dispatchSpy.mock.calls.filter(
      ([event]) => (event as CustomEvent).type === 'center-map-on-tile'
    );
    expect(centerEvents).toHaveLength(1);
    expect((centerEvents[0]?.[0] as CustomEvent).detail.source).toBe('minimap-click');
  });

  it('repositions the main map while dragging the overview', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Minimap />);
    const minimap = screen.getByLabelText('Minimap overview');

    const dispatchPointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        clientX: { value: clientX },
        clientY: { value: clientY },
        pointerId: { value: 1 },
      });
      minimap.dispatchEvent(event);
    };
    dispatchPointer('pointerdown', 20, 20);
    dispatchPointer('pointermove', 120, 80);
    dispatchPointer('pointerup', 120, 80);

    const centerEvents = dispatchSpy.mock.calls.filter(
      ([event]) => (event as CustomEvent).type === 'center-map-on-tile'
    );
    expect(centerEvents).toHaveLength(2);
    expect(
      centerEvents.every(
        ([event]) => (event as CustomEvent<{ source: string }>).detail.source === 'minimap-drag'
      )
    ).toBe(true);
    const lastCenterEvent = centerEvents.at(-1)?.[0] as CustomEvent<{ x: number; y: number }>;
    expect(lastCenterEvent.type).toBe('center-map-on-tile');
    expect(lastCenterEvent.detail).toEqual({ x: 2, y: 1, source: 'minimap-drag' });
  });

  it('exposes the selected unit in the minimap context', () => {
    useGameStore.setState({
      selectedUnitId: 'unit-1',
      units: {
        'unit-1': {
          id: 'unit-1',
          playerId: 'player-1',
          unitTypeId: 'scout',
          x: 1,
          y: 1,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
    });

    render(<Minimap />);
    expect(screen.getByLabelText('Minimap overview, selected unit scout')).toBeInTheDocument();
  });

  it('keeps foreign markers inside the fog-of-war boundary', () => {
    const knownButNotVisible = {
      x: 1,
      y: 1,
      terrain: 'grassland',
      known: true,
      visible: false,
    };
    const unknown = {
      x: 2,
      y: 2,
      terrain: 'grassland',
      known: false,
      visible: false,
    };

    expect(isMinimapMarkerVisible(knownButNotVisible, 'player-2', 'player-1', false)).toBe(true);
    expect(isMinimapMarkerVisible(knownButNotVisible, 'player-2', 'player-1', true)).toBe(false);
    expect(isMinimapMarkerVisible(unknown, 'player-2', 'player-1', false)).toBe(false);
    expect(isMinimapMarkerVisible(unknown, 'player-1', 'player-1', true)).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:342-379
   * @assertion Overview cells prefer city/unit identity, then known ownership,
   * then terrain, while unknown cells remain black.
   */
  it('uses reference overview color precedence for cells and markers', () => {
    const visibleTile = {
      x: 1,
      y: 1,
      terrain: 'grassland',
      known: true,
      visible: true,
      owner: 'player-2',
    };

    expect(
      getMinimapCellAppearance(visibleTile, '#0b8a04', 'player-1', '#d946ef', {
        kind: 'city',
        ownerId: 'player-1',
      })
    ).toEqual({ color: MINIMAP_COLORS.myCity });
    expect(
      getMinimapCellAppearance(visibleTile, '#0b8a04', 'player-1', '#d946ef', {
        kind: 'unit',
        ownerId: 'player-2',
        ownerColor: '#d946ef',
      })
    ).toEqual({ color: '#d946ef' });
    expect(getMinimapCellAppearance(visibleTile, '#0b8a04', 'player-1', '#d946ef')).toEqual({
      color: '#d946ef',
    });
    expect(
      getMinimapCellAppearance({ ...visibleTile, known: false }, '#0b8a04', 'player-1', '#d946ef')
    ).toEqual({ color: MINIMAP_COLORS.unknown });

    expect(
      getMinimapCellAppearance({ ...visibleTile, visible: false }, '#0b8a04', 'player-1', '#d946ef')
    ).toEqual({ color: '#d946ef' });
    expect(
      getMinimapCellAppearance(visibleTile, '#0b8a04', '', '#d946ef', {
        kind: 'unit',
        ownerId: 'player-2',
        ownerColor: '#d946ef',
      })
    ).toEqual({ color: MINIMAP_COLORS.foreignUnit });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:342-379
   * @assertion The mounted minimap applies reference marker/owner colors to the
   * actual base canvas, not only to the pure color-resolution helper.
   */
  it('draws reference cell colors through the mounted minimap canvas', () => {
    const fillCalls: Array<{ style: string; alpha: number; args: number[] }> = [];
    const filledStyles: string[] = [];
    let fillStyle = '';
    let globalAlpha = 1;
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn((...args: number[]) =>
        fillCalls.push({ style: fillStyle, alpha: globalAlpha, args })
      ),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(() => filledStyles.push(fillStyle)),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = value;
      },
      get globalAlpha() {
        return globalAlpha;
      },
      set globalAlpha(value: number) {
        globalAlpha = value;
      },
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;

    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useGameStore.setState({
      map: {
        width: 2,
        height: 1,
        xsize: 2,
        ysize: 1,
        tiles: {
          '0,0': { x: 0, y: 0, terrain: 'grassland', known: true, visible: true },
          '1,0': { x: 1, y: 0, terrain: 'plains', known: true, visible: true },
        },
      },
      cities: {
        'city-1': {
          id: 'city-1',
          name: 'Rome',
          playerId: 'player-1',
          x: 0,
          y: 0,
        } as City,
      },
      units: {
        'unit-1': {
          id: 'unit-1',
          playerId: 'player-2',
          unitTypeId: 'warriors',
          x: 1,
          y: 0,
          hp: 100,
          movesLeft: 1,
          veteranLevel: 0,
        },
      },
      players: {
        'player-1': {
          id: 'player-1',
          name: 'Rome',
          nation: 'romans',
          color: '#ffffff',
        } as Player,
        'player-2': {
          id: 'player-2',
          name: 'Japan',
          nation: 'japanese',
          color: '#2563eb',
        } as Player,
      },
    });

    render(<Minimap />);

    expect(fillCalls.some(call => call.style === MINIMAP_COLORS.myCity)).toBe(true);
    expect(
      fillCalls.some(call => call.style === '#2563eb') || filledStyles.includes('#2563eb')
    ).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:233-275,387-400
   * @assertion The mounted overview keeps the viewport outline on its overlay
   * canvas, draws it through a frame callback, and cancels both base/overlay
   * redraw callbacks when unmounted.
   */
  it('draws and cleans up the mounted viewport outline overlay', () => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      strokeRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      strokeStyle: '',
      lineWidth: 1,
    } as unknown as CanvasRenderingContext2D;
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();

    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const { unmount } = render(<Minimap />);
    expect(frames.length).toBeGreaterThanOrEqual(2);

    for (const frame of [...frames]) frame(0);

    expect(context.clearRect).toHaveBeenCalled();
    expect(context.strokeStyle).toBe(VIEWPORT_OUTLINE_COLOR);
    expect(context.lineWidth).toBe(1);
    expect(context.beginPath).toHaveBeenCalled();
    expect(context.stroke).toHaveBeenCalled();

    unmount();
    expect(cancelFrame).toHaveBeenCalledWith(expect.any(Number));
  });

  it('uses an aspect-preserving 2x1 physical overview for ISO maps', () => {
    expect(getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3)).toEqual({
      tileSize: 4,
      sourceWidth: 256,
      sourceHeight: 256,
      width: 256,
      height: 256,
      scaleX: 4,
      scaleY: 4,
      coordinateWidth: 64,
      coordinateHeight: 64,
    });
    expect(getMinimapLayout(80, 50)).toEqual({
      tileSize: 3,
      sourceWidth: 240,
      sourceHeight: 150,
      width: 240,
      height: 150,
      scaleX: 3,
      scaleY: 3,
      coordinateWidth: 80,
      coordinateHeight: 50,
    });
    expect(getMinimapLayout(100, 400, C2C3_TOPOLOGY, 3)).toEqual({
      tileSize: 1,
      sourceWidth: 200,
      sourceHeight: 400,
      width: 150,
      height: 300,
      scaleX: 0.75,
      scaleY: 0.75,
      coordinateWidth: 200,
      coordinateHeight: 400,
    });

    expect(getMinimapLayout(80, 50, C2C3_TOPOLOGY, 3)).toMatchObject({
      width: 288,
      height: 90,
      scaleX: 1.8,
      scaleY: 1.8,
      coordinateWidth: 160,
      coordinateHeight: 50,
    });

    const isoLayout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    expect(getMinimapCellWidth(C2C3_TOPOLOGY)).toBe(2);
    expect(isoLayout.scaleX).toBe(isoLayout.scaleY);
    expect(isoLayout.width / isoLayout.height).toBe(
      isoLayout.coordinateWidth / isoLayout.coordinateHeight
    );
  });

  it('maps physical overview clicks back to the same ISO tile storage', () => {
    const layout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    const native = { x: 16, y: 32 };
    const display = nativeToMinimapPosition(native.x, native.y, C2C3_TOPOLOGY);
    const pixel = nativeToMinimapPixelPosition(16, 32, layout, C2C3_TOPOLOGY, 3);
    expect(minimapPointToMapTile(pixel.x, pixel.y, 32, 64, layout, C2C3_TOPOLOGY, 3)).toEqual(
      native
    );
    expect(display).toEqual({ x: 32, y: 32 });
  });

  it('places C2C3 native tiles in staggered 2x1 natural coordinates', () => {
    expect(nativeToMinimapPosition(0, 0, C2C3_TOPOLOGY)).toEqual({ x: 0, y: 0 });
    expect(nativeToMinimapPosition(0, 1, C2C3_TOPOLOGY)).toEqual({ x: 1, y: 1 });
    expect(nativeToMinimapPosition(0, 2, C2C3_TOPOLOGY)).toEqual({ x: 0, y: 2 });
    expect(nativeToMinimapPosition(16, 32, C2C3_TOPOLOGY)).toEqual({ x: 32, y: 32 });
    expect(nativeToMinimapPosition(31, 63, C2C3_TOPOLOGY)).toEqual({ x: 63, y: 63 });
  });

  it('keeps ISO east and south adjacent in physical overview coordinates', () => {
    const base = nativeToMinimapPosition(10, 20, C2C3_TOPOLOGY);
    const east = nativeToMinimapPosition(11, 20, C2C3_TOPOLOGY);
    const south = nativeToMinimapPosition(10, 21, C2C3_TOPOLOGY);

    expect(east).toEqual({ x: base.x + 2, y: base.y });
    expect(south).toEqual({ x: base.x + 1, y: base.y + 1 });
  });

  it('maps every ISO tile to exactly one physical overview position and back', () => {
    const layout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    const positions = new Set<string>();

    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const position = nativeToMinimapPosition(x, y, C2C3_TOPOLOGY);
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThan(layout.coordinateWidth);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThan(layout.coordinateHeight);
        positions.add(`${position.x},${position.y}`);
        expect(
          minimapPositionToNative(position.x + 1, position.y, 32, 64, C2C3_TOPOLOGY, 3)
        ).toEqual({ x, y });
      }
    }

    expect(positions.size).toBe(32 * 64);
  });

  it('centers ISO markers in the same 2x1 cells as their terrain', () => {
    const layout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    const cell = nativeToMinimapPosition(16, 32, C2C3_TOPOLOGY);

    expect(nativeToMinimapPixelPosition(16, 32, layout, C2C3_TOPOLOGY, 3)).toEqual({
      x: (cell.x + 1) * layout.scaleX,
      y: (cell.y + 0.5) * layout.scaleY,
    });
  });

  it('draws wrapped ISO cells across the physical horizontal seam', () => {
    const layout = getMinimapLayout(4, 4, C2C3_TOPOLOGY, 3);
    const origins = getMinimapTileOrigins(3, 1, 4, 4, C2C3_TOPOLOGY, 3, layout);

    expect(origins).toContainEqual({ x: -25, y: 25 });
    expect(origins).toContainEqual({ x: 175, y: 25 });
  });

  it('keeps wrapped cells on integer Freeciv source-raster origins', () => {
    const layout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    const origins = getMinimapSourceTileOrigins(31, 63, 32, 64, C2C3_TOPOLOGY, 3, layout);

    expect(origins).toContainEqual({ x: -4, y: 252 });
    expect(origins).toContainEqual({ x: 252, y: 252 });
  });

  it('projects GUI coordinates with the active tileset half-tile origin', () => {
    expect(guiToMapPos(48, 0, 96, 48)).toEqual({ x: 0, y: 0 });
    expect(guiToMapPos(0, 0, 96, 48)).toEqual({ x: -1, y: 0 });
  });

  it('splits the camera outline across wrapped map seams', () => {
    const layout = getMinimapLayout(4, 3);
    const polygons = getMinimapViewportPolygons(
      { x: -48, y: 0, width: 48, height: 48 },
      4,
      3,
      3,
      layout,
      96,
      48
    );

    expect(polygons).toHaveLength(9);
  });

  it('projects an ISO viewport as a rotated diamond', () => {
    const layout = getMinimapLayout(32, 64, C2C3_TOPOLOGY, 3);
    const polygons = getMinimapViewportPolygons(
      { x: -432, y: 1296, width: 960, height: 480 },
      32,
      64,
      3,
      layout,
      96,
      48,
      C2C3_TOPOLOGY
    );

    expect(polygons[0]).toEqual([
      { x: 52, y: 126 },
      { x: 132, y: 86 },
      { x: 212, y: 126 },
      { x: 132, y: 166 },
    ]);
    expect(polygons).toHaveLength(9);
  });

  it('uses the Freeciv viewport outline style', () => {
    expect(VIEWPORT_OUTLINE_COLOR).toBe('rgb(200,200,255)');
    expect(VIEWPORT_OUTLINE_WIDTH).toBe(1);
  });
});
