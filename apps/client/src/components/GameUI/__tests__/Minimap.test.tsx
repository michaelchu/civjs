import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { Minimap } from '../Minimap';
import { isMinimapMarkerVisible } from '../minimapVisibility';
import {
  getMinimapLayout,
  getMinimapViewportPolygons,
  guiToMapPos,
  minimapPointToMapTile,
  nativeToMinimapPosition,
  VIEWPORT_OUTLINE_COLOR,
  VIEWPORT_OUTLINE_WIDTH,
} from '../minimapGeometry';

describe('Minimap', () => {
  afterEach(() => {
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

  it('renders a 32x64 ISO map in a centered landscape overview', () => {
    useGameStore.setState({
      map: {
        width: 32,
        height: 64,
        xsize: 32,
        ysize: 64,
        topology_id: 12,
        wrap_id: 3,
        tiles: {},
      },
    });

    render(<Minimap />);
    const canvas = screen.getByLabelText('Minimap overview');
    expect(canvas).toHaveAttribute('width', '256');
    expect(canvas).toHaveAttribute('height', '128');
  });

  it('dispatches a map-centering request when clicked', () => {
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    render(<Minimap />);
    fireEvent.click(screen.getByLabelText('Minimap overview'), { clientX: 80, clientY: 50 });
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'center-map-on-tile' })
    );
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
    expect(centerEvents.length).toBeGreaterThanOrEqual(2);
    const lastCenterEvent = centerEvents.at(-1)?.[0] as CustomEvent<{ x: number; y: number }>;
    expect(lastCenterEvent.type).toBe('center-map-on-tile');
    expect(lastCenterEvent.detail).toEqual({ x: 2, y: 1 });
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

  it('uses a centered transposed ISO layout without stretching cells', () => {
    expect(getMinimapLayout(32, 64, 12)).toEqual({
      tileSize: 4,
      width: 256,
      height: 128,
      scaleX: 4,
      scaleY: 4,
      coordinateWidth: 64,
      coordinateHeight: 32,
    });
    expect(getMinimapLayout(80, 50)).toEqual({
      tileSize: 3,
      width: 240,
      height: 150,
      scaleX: 3,
      scaleY: 3,
      coordinateWidth: 80,
      coordinateHeight: 50,
    });
    expect(getMinimapLayout(100, 400, 12)).toEqual({
      tileSize: 0.75,
      width: 300,
      height: 75,
      scaleX: 0.75,
      scaleY: 0.75,
      coordinateWidth: 400,
      coordinateHeight: 100,
    });
  });

  it('maps centered landscape overview clicks back to native ISO tile storage', () => {
    const layout = getMinimapLayout(32, 64, 12);
    expect(minimapPointToMapTile(128, 64, 32, 64, layout, 12, 3)).toEqual({
      x: 16,
      y: 32,
    });
    expect(minimapPointToMapTile(2, 62, 32, 64, layout, 12, 3)).toEqual({
      x: 31,
      y: 63,
    });
  });

  it('places native ISO tiles in centered transposed overview coordinates', () => {
    expect(nativeToMinimapPosition(0, 0, 32, 64, 12, 3)).toEqual({ x: 0, y: 16 });
    expect(nativeToMinimapPosition(0, 1, 32, 64, 12, 3)).toEqual({ x: 0, y: 17 });
    expect(nativeToMinimapPosition(16, 32, 32, 64, 12, 3)).toEqual({ x: 32, y: 16 });
    expect(nativeToMinimapPosition(31, 63, 32, 64, 12, 3)).toEqual({ x: 0, y: 15 });
  });

  it('maps every native ISO tile to exactly one displayed overview position', () => {
    const positions = new Set<string>();

    for (let y = 0; y < 64; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const position = nativeToMinimapPosition(x, y, 32, 64, 12, 3);
        expect(position.x).toBeGreaterThanOrEqual(0);
        expect(position.x).toBeLessThan(64);
        expect(position.y).toBeGreaterThanOrEqual(0);
        expect(position.y).toBeLessThan(32);
        positions.add(`${position.x},${position.y}`);
      }
    }

    expect(positions.size).toBe(32 * 64);
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

  it('projects an ISO viewport as a centered diamond without stretching', () => {
    const layout = getMinimapLayout(32, 64, 12);
    const polygons = getMinimapViewportPolygons(
      { x: -432, y: 1296, width: 960, height: 480 },
      32,
      64,
      3,
      layout,
      96,
      48,
      12
    );

    expect(polygons[0]).toEqual([
      { x: 128, y: 24 },
      { x: 88, y: 64 },
      { x: 128, y: 104 },
      { x: 168, y: 64 },
    ]);
    expect(polygons).toHaveLength(9);
  });

  it('uses the Freeciv viewport outline style', () => {
    expect(VIEWPORT_OUTLINE_COLOR).toBe('rgb(200,200,255)');
    expect(VIEWPORT_OUTLINE_WIDTH).toBe(1);
  });
});
