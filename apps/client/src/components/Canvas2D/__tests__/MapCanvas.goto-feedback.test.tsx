import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestPathResult = vi.hoisted(() => vi.fn());
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
});
