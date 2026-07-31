import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../../store/gameStore';
import { Minimap } from '../Minimap';
import { isMinimapMarkerVisible } from '../minimapVisibility';

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
});
