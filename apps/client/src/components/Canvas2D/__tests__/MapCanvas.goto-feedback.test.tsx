import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestPathResult = vi.hoisted(() => vi.fn());
const executeUnitAction = vi.hoisted(() => vi.fn());
const setDebugVisibility = vi.hoisted(() => vi.fn());
const mapRendererConstructed = vi.hoisted(() => vi.fn());
const setMapviewOrigin = vi.hoisted(() => vi.fn());
const getViewportPositionForTile = vi.hoisted(() => vi.fn());
const contextMenuProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const cityOverlayProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const tileInfoProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
const state = {
  viewport: { x: 0, y: 0, width: 100, height: 100 },
  map: { width: 10, height: 10, xsize: 10, ysize: 10, tiles: [] },
  mapData: { tiles: [] },
  units: {
    'unit-1': {
      id: 'unit-1',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      movesLeft: 3,
      movementLeft: 3,
    },
  },
  cities: {},
  players: {},
  diplomacy: { nations: [] },
  currentPlayerId: 'player-1',
  currentGameId: 'game-1',
  focusedUnits: ['unit-1'],
  selectedUnitId: null,
  selectedCityId: null,
  hasReceivedUnitSnapshot: true,
  research: { researchedTechs: [] },
  setViewport: vi.fn(),
  updateGameState: vi.fn(),
  selectUnit: vi.fn(),
  selectUnits: vi.fn(),
  toggleUnits: vi.fn(),
  selectCity: vi.fn(),
  addToFocus: vi.fn(),
  urgentFocusQueue: [],
};

vi.mock('../../../store/gameStore', () => ({
  useGameStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
    subscribe: () => () => undefined,
  }),
}));

vi.mock('../MapRenderer', () => ({
  MapRenderer: class {
    constructor() {
      mapRendererConstructed();
    }
    async initialize() {}
    cleanup() {}
    render() {}
    setFogOfWarEnabled() {}
    canvasToMap() {
      return { mapX: 1, mapY: 1 };
    }
    getViewportPositionForTile(...args: unknown[]) {
      getViewportPositionForTile(...args);
      return { x: 60, y: 40 };
    }
    setMapviewOrigin(...args: unknown[]) {
      return setMapviewOrigin(...args);
    }
  },
}));

vi.mock('../../../services/PathfindingService', () => ({
  pathfindingService: {
    requestPathResult,
  },
}));

vi.mock('../../../services/GameClient', () => ({
  gameClient: {
    setDebugVisibility,
    executeUnitAction,
    getAvailableProductions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../GameUI/UnitContextMenu', () => ({
  UnitContextMenu: (props: Record<string, unknown>) => {
    contextMenuProps.current = props;
    return null;
  },
}));
vi.mock('../../GameUI/CityNameDialog', () => ({ CityNameDialog: () => null }));
vi.mock('../../GameUI/CityInfoOverlay', () => ({
  CityInfoOverlay: (props: Record<string, unknown>) => {
    cityOverlayProps.current = props;
    return null;
  },
}));
vi.mock('../../GameUI/TileInfoOverlay', () => ({
  TileInfoOverlay: (props: Record<string, unknown>) => {
    tileInfoProps.current = props;
    return null;
  },
}));

import { MapCanvas } from '../MapCanvas';

describe('MapCanvas Go To feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    requestPathResult.mockReset();
    requestPathResult.mockRejectedValue(new Error('Cannot invade unless you break peace first.'));
    executeUnitAction.mockReset();
    executeUnitAction.mockResolvedValue({ success: true, message: 'Unit moved' });
    setDebugVisibility.mockReset();
    setDebugVisibility.mockResolvedValue(undefined);
    mapRendererConstructed.mockClear();
    setMapviewOrigin.mockReset();
    setMapviewOrigin.mockReturnValue({ x: 60, y: 40, width: 100, height: 100 });
    getViewportPositionForTile.mockReset();
    contextMenuProps.current = null;
    cityOverlayProps.current = null;
    tileInfoProps.current = null;
    Object.assign(state.units['unit-1'], {
      playerId: 'player-1',
      x: 0,
      y: 0,
      movesLeft: 3,
      doneMoving: false,
      transportedBy: undefined,
    });
    for (const cityId of Object.keys(state.cities as Record<string, unknown>)) {
      delete (state.cities as Record<string, unknown>)[cityId];
    }
    state.diplomacy.nations.length = 0;
    Object.assign(state.map, { wrap_id: 0 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D
    );
  });

  it('shows a rejected path request to the player', async () => {
    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('activate-goto-mode', {
          detail: { unit: state.units['unit-1'] },
        })
      );
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 1, clientY: 1 });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Cannot invade unless you break peace first.'
      );
    });
  });

  it('confirms before executing a Go To into a peaceful foreign city', async () => {
    Object.assign(state.cities, {
      'city-1': { id: 'city-1', name: 'Foreign City', x: 1, y: 1, playerId: 'player-2' },
    });
    state.diplomacy.nations.push({
      id: 'player-2',
      relation: { state: 'peace' },
    } as never);
    requestPathResult.mockResolvedValue({
      path: { tiles: [{ x: 1, y: 1 }], totalCost: 3, estimatedTurns: 1, valid: true },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('activate-goto-mode', { detail: { unit: state.units['unit-1'] } })
      );
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(confirm).toHaveBeenCalledWith(
      'Entering Foreign City will declare war on its owner. Continue?'
    );
    expect(executeUnitAction).toHaveBeenCalledWith('unit-1', 'goto', 1, 1, true);
    confirm.mockRestore();
  });

  it('keeps the renderer alive when an action context menu opens', async () => {
    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mapRendererConstructed).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('show-action-dialog', { detail: { unit: state.units['unit-1'] } })
      );
      await Promise.resolve();
    });

    expect(mapRendererConstructed).toHaveBeenCalledTimes(1);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/javascript/control.js:3473-3504
   * @assertion A city remains openable when a non-actionable unit occupies its tile.
   */
  it('opens city info when a spent unit is sitting on the city tile', async () => {
    Object.assign(state.cities, {
      'city-1': {
        id: 'city-1',
        name: 'Rome',
        playerId: 'player-1',
        x: 1,
        y: 1,
      },
    });
    Object.assign(state.units['unit-1'], { x: 1, y: 1, movesLeft: 0 });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(cityOverlayProps.current?.isOpen).toBe(true);
    expect((cityOverlayProps.current?.city as { id?: string })?.id).toBe('city-1');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/javascript/control.js:3473-3492
   * @assertion An actionable friendly city occupant exposes the unit context path, which can then show the city.
   */
  it('offers Show City when an actionable friendly unit covers the city', async () => {
    Object.assign(state.cities, {
      'city-1': {
        id: 'city-1',
        name: 'Rome',
        playerId: 'player-1',
        x: 1,
        y: 1,
      },
    });
    Object.assign(state.units['unit-1'], { x: 1, y: 1, movesLeft: 3 });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(contextMenuProps.current?.onShowCity).toEqual(expect.any(Function));
    await act(async () => {
      (contextMenuProps.current?.onShowCity as () => void)();
      await Promise.resolve();
    });
    expect(cityOverlayProps.current?.isOpen).toBe(true);
  });

  it('selects the owned unit on a normal left click', async () => {
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-1' });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    state.selectUnit.mockClear();
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(state.selectUnit).toHaveBeenCalledWith('unit-1');
  });

  it('does not turn a foreign-only tile into the local selection', async () => {
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-2' });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    state.selectUnit.mockClear();
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(state.selectUnit).toHaveBeenCalledWith(null);
  });

  it('opens an owned unit menu through the normal right-click mouse lifecycle', async () => {
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-1' });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 2 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect((contextMenuProps.current?.unit as { id?: string })?.id).toBe('unit-1');

    // Browsers may follow mouseup with contextmenu; it must not close or
    // replace the menu that was already opened by the pointer handler.
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });
    expect((contextMenuProps.current?.unit as { id?: string })?.id).toBe('unit-1');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/javascript/2dcanvas/mapctrl.js:519-551
   * @assertion Right-clicking a foreign or empty tile recenters the map instead of opening an own-unit menu.
   */
  it('does not open a foreign-unit action menu on right-click', async () => {
    Object.assign(state.units['unit-1'], {
      x: 1,
      y: 1,
      playerId: 'player-2',
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect(contextMenuProps.current).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'center-map-on-tile',
        detail: { x: 1, y: 1, source: 'map-right-click' },
      })
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/javascript/2dcanvas/mapctrl.js:234-238
   * @assertion Middle-click opens tile information without selecting a unit action.
   */
  it('opens tile info with middle-click', async () => {
    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 1 });
      await Promise.resolve();
    });

    expect(tileInfoProps.current?.isOpen).toBe(true);
    expect(tileInfoProps.current?.x).toBe(1);
    expect(tileInfoProps.current?.y).toBe(1);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/javascript/2dcanvas/mapctrl.js:477-513
   * @assertion Rectangle selection collects only owned units from the tiles sampled inside the drag area.
   */
  it('selects owned units with an Alt-drag rectangle', async () => {
    Object.assign(state.units['unit-1'], { x: 1, y: 1 });
    state.selectUnits.mockClear();

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0, altKey: true });
      fireEvent.mouseMove(canvas, { clientX: 24, clientY: 24, buttons: 1 });
      fireEvent.mouseUp(canvas, { clientX: 24, clientY: 24, button: 0, altKey: true });
      await Promise.resolve();
    });

    expect(state.selectUnits).toHaveBeenCalledWith(['unit-1']);
  });

  it('slides the viewport to a centered tile and commits the target at the end', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x: 0, y: 0 } }));
      await Promise.resolve();
    });

    expect(frames).toHaveLength(1);
    expect(state.setViewport).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(1350);
    });
    expect(state.setViewport).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);

    await act(async () => {
      frames.shift()?.(1700);
    });
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('coalesces minimap drag panning without sliding or creating markers', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    state.updateGameState.mockClear();
    setMapviewOrigin.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 1, y: 1, source: 'minimap-drag' },
        })
      );
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 2, y: 2, source: 'minimap-drag' },
        })
      );
      await Promise.resolve();
    });

    expect(frames).toHaveLength(1);
    expect(state.updateGameState).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(16);
    });

    expect(setMapviewOrigin).toHaveBeenCalledTimes(2);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('commits and paints right-click recentering atomically', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 2, y: 2, source: 'map-right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(frames).toHaveLength(0);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('does not center on an out-of-bounds right-click tile', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: -1, y: 1, source: 'map-right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(frames).toHaveLength(0);
    expect(state.setViewport).not.toHaveBeenCalled();
  });

  it('keeps discrete recentering away from finite-map polar edges', async () => {
    Object.assign(state.map, { width: 40, height: 40, xsize: 40, ysize: 40, wrap_id: 0 });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    getViewportPositionForTile.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 5, y: 0, source: 'map-right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(getViewportPositionForTile).toHaveBeenCalledWith(5, 9, 100, 100);

    Object.assign(state.map, { width: 10, height: 10, xsize: 10, ysize: 10 });
  });

  it('preserves the requested center period on a wrapped map', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    Object.assign(state.map, { wrap_id: 3 });

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    setMapviewOrigin.mockClear();
    setMapviewOrigin.mockReturnValue({ x: -900, y: -800, width: 100, height: 100 });

    await act(async () => {
      document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x: 0, y: 0 } }));
      await Promise.resolve();
    });

    await act(async () => {
      frames.shift()?.(1700);
    });

    expect(setMapviewOrigin).not.toHaveBeenCalled();
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('normalizes a wrapped right-click center before painting', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.assign(state.map, { wrap_id: 3 });
    setMapviewOrigin.mockReturnValue({ x: 20, y: 30, width: 100, height: 100 });

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    setMapviewOrigin.mockClear();
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 0, y: 0, source: 'map-right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(setMapviewOrigin).toHaveBeenCalledWith(60, 40, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 20,
      y: 30,
      width: 100,
      height: 100,
    });
  });

  it('commits the latest slide viewport before a drag begins', async () => {
    const frames: FrameRequestCallback[] = [];
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);
    vi.spyOn(performance, 'now').mockReturnValue(1000);

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x: 0, y: 0 } }));
      await Promise.resolve();
    });
    await act(async () => {
      frames.shift()?.(1350);
    });

    fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });

    expect(cancelFrame).toHaveBeenCalled();
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 53,
      y: 35,
      width: 100,
      height: 100,
    });
  });
});
