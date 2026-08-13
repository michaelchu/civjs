import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionType } from '../../../types/shared/actions';

const requestPathResult = vi.hoisted(() => vi.fn());
const executeUnitAction = vi.hoisted(() => vi.fn());
const setDebugVisibility = vi.hoisted(() => vi.fn());
const mapRendererConstructed = vi.hoisted(() => vi.fn());
const mapRendererRender = vi.hoisted(() => vi.fn());
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
    render(...args: unknown[]) {
      mapRendererRender(...args);
    }
    setRenderCompleteListener() {}
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
    vi.useRealTimers();
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
    mapRendererRender.mockClear();
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
    state.selectedUnitId = null;
    state.focusedUnits = ['unit-1'];
    for (const cityId of Object.keys(state.cities as Record<string, unknown>)) {
      delete (state.cities as Record<string, unknown>)[cityId];
    }
    for (const playerId of Object.keys(state.players as Record<string, unknown>)) {
      delete (state.players as Record<string, unknown>)[playerId];
    }
    state.diplomacy.nations.length = 0;
    Object.assign(state.map, {
      width: 10,
      height: 10,
      xsize: 10,
      ysize: 10,
      topology_id: 3,
      wrap_id: 0,
    });
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

  it('does not restore a stale path when a hover request resolves after selecting a target', async () => {
    let resolvePath: ((value: unknown) => void) | undefined;
    requestPathResult.mockImplementation(
      () =>
        new Promise(resolve => {
          resolvePath = resolve;
        })
    );

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('activate-goto-mode', { detail: { unit: state.units['unit-1'] } })
      );
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.mouseMove(canvas, { clientX: 1, clientY: 1 });
      await Promise.resolve();
    });
    expect(requestPathResult).toHaveBeenCalledWith('unit-1', 1, 1);

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });
    expect(executeUnitAction).toHaveBeenCalledWith('unit-1', 'goto', 1, 1, false);

    await act(async () => {
      resolvePath?.({
        path: {
          unitId: 'unit-1',
          tiles: [
            { x: 0, y: 0, moveCost: 0 },
            { x: 1, y: 1, moveCost: 1 },
          ],
          totalCost: 1,
          estimatedTurns: 1,
          valid: true,
        },
      });
      await Promise.resolve();
    });

    const lastRenderState = mapRendererRender.mock.calls.at(-1)?.[0] as
      { gotoPath?: unknown } | undefined;
    expect(lastRenderState?.gotoPath).toBeNull();
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3473-3504
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:3473-3492
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

  it('redraws the selected unit when left-clicking an actionable unit in a city', async () => {
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
    state.selectedUnitId = null;
    state.focusedUnits = [];
    state.selectUnit.mockImplementationOnce((unitId: string | null) => {
      Object.assign(state, {
        selectedUnitId: unitId,
        focusedUnits: unitId ? [unitId] : [],
      });
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    state.selectUnit.mockClear();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mapRendererRender.mockClear();
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(state.selectUnit).toHaveBeenCalledWith('unit-1');
    const renderedState = mapRendererRender.mock.calls.at(-1)?.[0] as
      { selectedUnitId?: string | null; focusedUnits?: string[] } | undefined;
    expect(renderedState?.selectedUnitId).toBe('unit-1');
    expect(renderedState?.focusedUnits).toEqual(['unit-1']);
  });

  it('selects the owned unit and redraws its selection on a normal left click', async () => {
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-1' });
    state.selectedUnitId = null;
    state.focusedUnits = [];
    state.selectUnit.mockImplementationOnce((unitId: string | null) => {
      Object.assign(state, {
        selectedUnitId: unitId,
        focusedUnits: unitId ? [unitId] : [],
      });
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    state.selectUnit.mockClear();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    mapRendererRender.mockClear();
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(state.selectUnit).toHaveBeenCalledWith('unit-1');
    expect(mapRendererRender).toHaveBeenCalled();
    const renderedState = mapRendererRender.mock.calls.at(-1)?.[0] as
      { selectedUnitId?: string | null; focusedUnits?: string[] } | undefined;
    expect(renderedState?.selectedUnitId).toBe('unit-1');
    expect(renderedState?.focusedUnits).toEqual(['unit-1']);
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

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:309-316
   * @assertion A visible owned unit takes precedence over square-ISO
   * right-click recentering and opens the unit context interaction once.
   */
  it('opens an owned unit menu through the square-ISO right-click lifecycle', async () => {
    Object.assign(state.map, { topology_id: 1 });
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
   * @assertion The native Hexemplio interaction keeps CivJS's tile-information
   * right-click behavior; square ISO has a separate reference test below.
   */
  it('opens tile info on a foreign or empty tile instead of recentering', async () => {
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
    expect(tileInfoProps.current?.isOpen).toBe(true);
    expect(tileInfoProps.current?.x).toBe(1);
    expect(tileInfoProps.current?.y).toBe(1);
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'center-map-on-tile',
      })
    );
  });

  it('opens city info on a native city tile instead of recentering', async () => {
    Object.assign(state.cities, {
      'city-1': {
        id: 'city-1',
        name: 'Rome',
        playerId: 'player-1',
        x: 1,
        y: 1,
      },
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect((cityOverlayProps.current?.city as { id?: string })?.id).toBe('city-1');
    expect(cityOverlayProps.current?.isOpen).toBe(true);
    expect(tileInfoProps.current).toBeNull();
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'center-map-on-tile' })
    );
  });

  it('does nothing when right-clicking an AI city', async () => {
    Object.assign(state.players, {
      'player-ai': { isHuman: false },
    });
    Object.assign(state.cities, {
      'city-1': {
        id: 'city-1',
        name: 'Rome',
        playerId: 'player-ai',
        x: 1,
        y: 1,
      },
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect(contextMenuProps.current).toBeNull();
    expect(cityOverlayProps.current?.isOpen).toBe(false);
    expect(tileInfoProps.current).toBeNull();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:288-323
   * @assertion Square ISO reserves a normal right click for recentering, while
   * the original pointer tile still controls whether an owned-unit menu wins.
   */
  it('re-centers square ISO on a non-owned right-click target', async () => {
    Object.assign(state.map, { topology_id: 1 });
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-2' });
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect(contextMenuProps.current).toBeNull();
    expect(tileInfoProps.current).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'center-map-on-tile',
        detail: { x: 1, y: 1, source: 'right-click' },
      })
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:294-307
   * @assertion Only square ISO's explicit right-click recenter applies the
   * eight-tile polar guard on maps larger than 24 by 24.
   */
  it('polar-clamps only the square right-click recenter target', async () => {
    Object.assign(state.map, {
      width: 40,
      height: 40,
      xsize: 40,
      ysize: 40,
      topology_id: 1,
    });
    Object.assign(state.units['unit-1'], { x: 0, y: 0, playerId: 'player-2' });
    const dispatchSpy = vi.spyOn(document, 'dispatchEvent');

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.contextMenu(canvas, { clientX: 1, clientY: 1, button: 2 });
      await Promise.resolve();
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'center-map-on-tile',
        detail: { x: 1, y: 8, source: 'right-click' },
      })
    );
  });

  it('does nothing when left-clicking an AI city', async () => {
    Object.assign(state.players, {
      'player-ai': { isHuman: false },
    });
    Object.assign(state.cities, {
      'city-1': {
        id: 'city-1',
        name: 'Rome',
        playerId: 'player-ai',
        x: 1,
        y: 1,
      },
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 0 });
      fireEvent.mouseUp(canvas, { clientX: 1, clientY: 1, button: 0 });
      await Promise.resolve();
    });

    expect(contextMenuProps.current).toBeNull();
    expect(cityOverlayProps.current?.isOpen).toBe(false);
    expect(tileInfoProps.current).toBeNull();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:234-238
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:250-286
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

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:367-374
   * @assertion A right drag remains a context interaction until both axes exceed
   * 45px and the pointer has been held for more than 200ms.
   */
  it('applies the reference right-drag gate in the canvas lifecycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    Object.assign(state.units['unit-1'], { x: 1, y: 1, playerId: 'player-1' });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    state.selectUnits.mockClear();

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 1, clientY: 1, button: 2 });
      fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60, buttons: 2 });
    });
    expect(state.selectUnits).not.toHaveBeenCalled();

    await act(async () => {
      vi.setSystemTime(1_201);
      fireEvent.mouseMove(canvas, { clientX: 60, clientY: 60, buttons: 2 });
      fireEvent.mouseUp(canvas, { clientX: 60, clientY: 60, button: 2 });
      await Promise.resolve();
    });

    expect(state.selectUnits).toHaveBeenCalledWith(['unit-1']);
    expect(contextMenuProps.current).toBeNull();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:43-47,131-190
   * @assertion Single-finger movement pans the map by twice the touch delta and
   * commits the constrained viewport when the touch ends.
   */
  it('pans and commits the viewport through the reference touch lifecycle', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    const touch = (clientX: number, clientY: number) => ({
      identifier: 1,
      target: canvas,
      clientX,
      clientY,
      pageX: clientX,
      pageY: clientY,
    });

    await act(async () => {
      fireEvent.touchStart(canvas, { touches: [touch(10, 10)] });
    });
    await act(async () => {
      fireEvent.touchMove(canvas, { touches: [touch(30, 30)] });
    });
    await act(async () => {
      fireEvent.touchMove(canvas, { touches: [touch(40, 45)] });
    });

    // The threshold-crossing move now starts the drag synchronously, so both
    // moves can enqueue frames before the mocked cancellation removes them.
    expect(frames.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      frames.at(-1)?.(16);
    });

    await act(async () => {
      fireEvent.touchEnd(canvas, {
        touches: [],
        changedTouches: [touch(40, 45)],
      });
    });

    expect(setMapviewOrigin).toHaveBeenCalledWith(-60, -70, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
    expect(
      (mapRendererRender.mock.calls.at(-1)?.[0] as { viewport?: unknown } | undefined)?.viewport
    ).toEqual({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('commits a mouse pan when mouseup arrives before React rerenders drag state', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    state.selectUnit.mockClear();
    setMapviewOrigin.mockClear();

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30, buttons: 1 });
      fireEvent.mouseUp(canvas, { clientX: 30, clientY: 30, button: 0 });
    });

    expect(setMapviewOrigin).toHaveBeenCalledWith(-40, -40, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
    expect(state.selectUnit).not.toHaveBeenCalled();
  });

  it('does not republish the stored viewport when an overlay rerenders', async () => {
    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('show-action-dialog', {
          detail: { unit: state.units['unit-1'] },
        })
      );
      await Promise.resolve();
    });

    expect(state.setViewport).not.toHaveBeenCalled();
  });

  it('keeps a pan active across canvas leave and commits on document mouseup', async () => {
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    setMapviewOrigin.mockClear();

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30, buttons: 1 });
      fireEvent.mouseLeave(canvas, { clientX: 30, clientY: 30 });
      fireEvent.mouseMove(window, { clientX: 60, clientY: 70, buttons: 1 });
    });

    expect(state.setViewport).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.mouseUp(document, { clientX: 60, clientY: 70, button: 0 });
    });

    expect(setMapviewOrigin).toHaveBeenCalledWith(-100, -120, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('does not normalize a wrapped map into another GUI period on release', async () => {
    Object.assign(state.map, { wrap_id: 3 });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    setMapviewOrigin.mockClear();

    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10, button: 0 });
      fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30, buttons: 1 });
      fireEvent.mouseUp(canvas, { clientX: 30, clientY: 30, button: 0 });
    });

    expect(setMapviewOrigin).not.toHaveBeenCalled();
    expect(state.setViewport).toHaveBeenCalledWith({
      x: -40,
      y: -40,
      width: 100,
      height: 100,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:43-47,131-151
   * @assertion A stationary long touch uses the mobile context interaction and
   * does not fall through to the normal tap/click action.
   */
  it('opens the unit context interaction for a stationary long touch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    Object.assign(state.units['unit-1'], {
      x: 1,
      y: 1,
      playerId: 'player-1',
    });

    render(<MapCanvas width={100} height={100} />);
    const canvas = screen.getByLabelText('World map');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const touch = {
      identifier: 1,
      target: canvas,
      clientX: 1,
      clientY: 1,
      pageX: 1,
      pageY: 1,
    };
    await act(async () => {
      fireEvent.touchStart(canvas, { touches: [touch] });
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect((contextMenuProps.current?.unit as { id?: string })?.id).toBe('unit-1');
    expect(tileInfoProps.current).toBeNull();

    await act(async () => {
      fireEvent.touchEnd(canvas, { touches: [], changedTouches: [touch] });
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/control.js:2199-2221
   * @assertion Escape aborts an active target-tile interaction without sending
   * the partially selected action to the server.
   */
  it('cancels target action selection with Escape', async () => {
    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      document.dispatchEvent(
        new CustomEvent('activate-target-action-mode', {
          detail: { unit: state.units['unit-1'], action: ActionType.PATROL },
        })
      );
    });

    await waitFor(() =>
      expect(screen.getByText('Select the other endpoint of this patrol route')).toBeInTheDocument()
    );
    expect(screen.getByText('Select a target · Esc to cancel')).toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    expect(screen.queryByText('Select the other endpoint of this patrol route')).toBeNull();
    expect(screen.queryByText('Select a target · Esc to cancel')).toBeNull();
    expect(executeUnitAction).not.toHaveBeenCalled();
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
    expect(
      (mapRendererRender.mock.calls.at(-1)?.[0] as { viewport?: unknown } | undefined)?.viewport
    ).toEqual({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  it('centers square-isometric map requests immediately without a custom marker', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.assign(state.map, { topology_id: 1 });

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    state.updateGameState.mockClear();

    await act(async () => {
      document.dispatchEvent(new CustomEvent('center-map-on-tile', { detail: { x: 5, y: 0 } }));
      await Promise.resolve();
    });

    expect(getViewportPositionForTile).toHaveBeenLastCalledWith(5, 0, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
    expect(state.updateGameState).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:434-515
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:525-559
   * @assertion A nearby square-ISO right-click uses the pinned 700 ms,
   * 100-step, floor-quantized slide before committing the centered target.
   */
  it('uses the reference linear slide for square-isometric right-click recentering', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    Object.assign(state.map, { topology_id: 1 });

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    mapRendererRender.mockClear();

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 1, y: 1, source: 'right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(frames).toHaveLength(1);
    expect(state.setViewport).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(1350);
    });
    expect(
      (mapRendererRender.mock.calls.at(-1)?.[0] as { viewport?: unknown } | undefined)?.viewport
    ).toEqual({ x: 30, y: 20, width: 100, height: 100 });
    expect(state.setViewport).not.toHaveBeenCalled();

    await act(async () => {
      frames.shift()?.(1699);
    });
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 60,
      y: 40,
      width: 100,
      height: 100,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:450-455
   * @assertion A square-ISO right-click farther than one viewport bypasses
   * animation-frame continuation and commits its centered target directly.
   */
  it('snaps a distant square-isometric right-click to the target', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.assign(state.map, { topology_id: 1 });

    render(<MapCanvas width={100} height={100} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    state.setViewport.mockClear();
    getViewportPositionForTile.mockReturnValue({ x: 160, y: 40 });
    setMapviewOrigin.mockReturnValue({ x: 160, y: 40, width: 100, height: 100 });

    await act(async () => {
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', {
          detail: { x: 1, y: 1, source: 'right-click' },
        })
      );
      await Promise.resolve();
    });

    expect(getViewportPositionForTile).toHaveBeenLastCalledWith(1, 1, 100, 100);
    expect(state.setViewport).toHaveBeenCalledWith({
      x: 160,
      y: 40,
      width: 100,
      height: 100,
    });
    expect(frames).toHaveLength(0);
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

  it('centers programmatic requests on the exact finite-map polar tile', async () => {
    Object.assign(state.map, {
      width: 40,
      height: 40,
      xsize: 40,
      ysize: 40,
      topology_id: 1,
      wrap_id: 0,
    });
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
          detail: { x: 5, y: 0 },
        })
      );
      await Promise.resolve();
    });

    expect(getViewportPositionForTile).toHaveBeenCalledWith(5, 0, 100, 100);
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
