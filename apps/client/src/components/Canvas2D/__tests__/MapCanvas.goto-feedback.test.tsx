import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestPathResult = vi.hoisted(() => vi.fn());
const executeUnitAction = vi.hoisted(() => vi.fn());
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
  selectUnit: vi.fn(),
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
    async initialize() {}
    cleanup() {}
    render() {}
    setFogOfWarEnabled() {}
    canvasToMap() {
      return { mapX: 1, mapY: 1 };
    }
    getViewportPositionForTile() {
      return { x: 0, y: 0 };
    }
    setMapviewOrigin() {
      return { x: 0, y: 0, width: 100, height: 100 };
    }
  },
}));

vi.mock('../../../services/PathfindingService', () => ({
  pathfindingService: {
    requestMovementRange: vi.fn().mockResolvedValue([]),
    requestPathResult,
  },
}));

vi.mock('../../../services/GameClient', () => ({
  gameClient: {
    setDebugVisibility: vi.fn().mockResolvedValue(undefined),
    executeUnitAction,
  },
}));

vi.mock('../../GameUI/UnitContextMenu', () => ({ UnitContextMenu: () => null }));
vi.mock('../../GameUI/CityNameDialog', () => ({ CityNameDialog: () => null }));
vi.mock('../../GameUI/CityInfoOverlay', () => ({ CityInfoOverlay: () => null }));

import { MapCanvas } from '../MapCanvas';

describe('MapCanvas Go To feedback', () => {
  beforeEach(() => {
    requestPathResult.mockReset();
    requestPathResult.mockRejectedValue(new Error('Cannot invade unless you break peace first.'));
    executeUnitAction.mockReset();
    executeUnitAction.mockResolvedValue({ success: true, message: 'Unit moved' });
    Object.assign(state.cities, {});
    state.diplomacy.nations.length = 0;
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
});
