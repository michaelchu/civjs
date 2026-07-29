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
    map: {
      width: 10,
      height: 10,
      xsize: 10,
      ysize: 10,
      wrap_id: 0,
      tiles: {
        '0,0': {
          x: 0,
          y: 0,
          terrain: 'plains',
          known: true,
          visible: true,
        },
      },
    },
    units: {},
    cities,
    players: {},
  };
}

describe('MapRenderer live-state updates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('centers a tile using the current canvas dimensions', () => {
    const renderer = new MapRenderer(createContext());

    expect(renderer.getViewportPositionForTile(10, 20, 1279, 667)).toEqual({
      x: -1071,
      y: 411,
    });
  });

  it('coalesces throttled packet bursts and renders the latest state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const renderer = new MapRenderer(createContext());
    const cityRenderer = { renderCities: vi.fn() };
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      cityRenderer,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain: vi.fn(),
        renderSpecials: vi.fn(),
        renderOceanPadding: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
      },
      pathRenderer: { renderPaths: vi.fn() },
      getVisibleTiles: () => [],
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

  it('cancels a pending render when the renderer is cleaned up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const renderer = new MapRenderer(createContext());
    const cityRenderer = { renderCities: vi.fn() };
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      cityRenderer,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain: vi.fn(),
        renderSpecials: vi.fn(),
        renderOceanPadding: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
      },
      pathRenderer: { renderPaths: vi.fn() },
      getVisibleTiles: () => [],
      checkViewportBounds: () => false,
    });

    renderer.render(createRenderState());
    vi.setSystemTime(1010);
    renderer.render(createRenderState());
    renderer.cleanup();
    vi.advanceTimersByTime(100);

    expect(cityRenderer.renderCities).toHaveBeenCalledTimes(1);
  });

  it('uses the Amplio2 stack badge key without drawing a placeholder', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const stackSprite = {} as HTMLImageElement;
    const tilesetLoader = {
      getSprite: (key: string) =>
        key === 'u.warriors' ? unitSprite : key === 'unit.stack2' ? stackSprite : null,
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
    expect(context.drawImage).toHaveBeenCalledWith(stackSprite, 19, -45);
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('keeps unit sprites in the overdraw margin while panning', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const tilesetLoader = {
      getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null),
    };
    const renderer = new UnitRenderer(context, tilesetLoader as never, 96, 48);
    const unit: Unit = {
      id: 'edge-unit',
      playerId: 'player',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      viewport: { x: 100, y: 0, width: 800, height: 600 },
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, -81, -14);
  });

  it('culls known tiles that are outside the canvas overdraw margin', () => {
    const renderer = new MapRenderer(createContext());
    const nearTile = {
      x: 0,
      y: 0,
      terrain: 'plains',
      known: true,
      visible: true,
    };
    const farTile = {
      x: 100,
      y: 100,
      terrain: 'plains',
      known: true,
      visible: true,
    };

    const visible = (
      renderer as unknown as {
        getVisibleTiles: (
          tiles: (typeof nearTile)[],
          viewport: RenderState['viewport']
        ) => (typeof nearTile)[];
      }
    ).getVisibleTiles([nearTile, farTile], createRenderState().viewport);

    expect(visible).toEqual([nearTile]);
  });

  it('reveals unknown terrain and skips the fog layer when debug fog is disabled', () => {
    const renderer = new MapRenderer(createContext());
    const renderTerrain = vi.fn();
    const renderFog = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain,
        renderSpecials: vi.fn(),
        renderOceanPadding: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      cityRenderer: { renderCities: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
      },
      fogRenderer: { render: renderFog },
      pathRenderer: { renderPaths: vi.fn() },
      checkViewportBounds: () => false,
    });

    renderer.setFogOfWarEnabled(false);
    const state = createRenderState();
    state.map.tiles = {
      '2,3': {
        x: 2,
        y: 3,
        terrain: 'grassland',
        known: false,
        visible: false,
      },
    };
    renderer.render(state, true);

    expect(renderTerrain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          x: 2,
          y: 3,
          terrain: 'grassland',
          visible: true,
          known: true,
        }),
      ])
    );
    expect(renderFog).not.toHaveBeenCalled();
  });

  it('covers finite-map padding with opaque fog instead of decorative ocean', () => {
    const context = createContext();
    const renderer = new MapRenderer(context);
    const renderOceanPadding = vi.fn();
    const renderFog = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain: vi.fn(),
        renderSpecials: vi.fn(),
        renderOceanPadding,
      },
      borderRenderer: { render: vi.fn() },
      cityRenderer: { renderCities: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
      },
      fogRenderer: { render: renderFog },
      pathRenderer: { renderPaths: vi.fn() },
      checkViewportBounds: () => true,
    });

    renderer.render(createRenderState(), true);

    expect(context.fillStyle).toBe('#000');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(renderOceanPadding).not.toHaveBeenCalled();
    expect(renderFog).toHaveBeenCalled();
  });

  it('checks map bounds using the full canvas when viewport dimensions lag', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: { width: 20, height: 20, xsize: 20, ysize: 20, wrap_id: 0, tiles: {} },
    });
    const viewport = { x: -50, y: 430, width: 100, height: 100 };
    const exceedsBounds = (
      renderer as unknown as {
        checkViewportBounds: (candidate: typeof viewport) => boolean;
      }
    ).checkViewportBounds(viewport);

    expect(exceedsBounds).toBe(true);
  });
});
