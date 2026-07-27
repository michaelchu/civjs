import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapRenderer } from '../MapRenderer';
import { UnitRenderer } from '../renderers/UnitRenderer';
import type { RenderState } from '../renderers/BaseRenderer';
import type { Unit } from '../../../types';

function createContext() {
  return {
    canvas: { width: 800, height: 600 },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    stroke: vi.fn(),
    imageSmoothingEnabled: false,
  } as unknown as CanvasRenderingContext2D;
}

function createRenderState(cities: RenderState['cities'] = {}): RenderState {
  return {
    viewport: { x: 0, y: 0, width: 800, height: 600 },
    map: {},
    units: {},
    cities,
    players: {},
  };
}

describe('MapRenderer live-state updates', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { tiles?: unknown }).tiles;
    delete (window as unknown as { map?: unknown }).map;
  });

  it('coalesces throttled packet bursts and renders the latest state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    (window as unknown as { tiles: unknown[] }).tiles = [{}];
    (window as unknown as { map: { xsize: number; ysize: number; wrap_id: number } }).map = {
      xsize: 10,
      ysize: 10,
      wrap_id: 0,
    };

    const renderer = new MapRenderer(createContext());
    const cityRenderer = { renderCities: vi.fn() };
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      cityRenderer,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain: vi.fn(),
        renderOceanPadding: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
      },
      pathRenderer: { renderPaths: vi.fn() },
      getVisibleTilesFromGlobal: () => [],
      checkViewportBounds: () => false,
    });

    renderer.render(createRenderState());
    const latestState = createRenderState({
      'ai-city': {
        id: 'ai-city',
        name: 'AI City',
        playerId: 'ai',
        x: 2,
        y: 2,
        size: 1,
      } as RenderState['cities'][string],
    });

    vi.setSystemTime(1010);
    renderer.render(latestState);
    expect(cityRenderer.renderCities).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);
    expect(cityRenderer.renderCities).toHaveBeenCalledTimes(2);
    expect(cityRenderer.renderCities).toHaveBeenLastCalledWith(latestState);
  });

  it('does not draw a unit placeholder when only an optional stack badge is missing', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const tilesetLoader = {
      getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null),
    };
    const renderer = new UnitRenderer(context, tilesetLoader as never, 96, 48);
    const unit: Unit = {
      id: 'warrior',
      playerId: 'ai',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      units: {
        warrior: unit,
        settler: { ...unit, id: 'settler', unitTypeId: 'settlers' },
      },
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 19, -14);
    expect(context.fillText).not.toHaveBeenCalled();
  });
});
