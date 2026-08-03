import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapRenderer } from '../MapRenderer';
import { UnitRenderer } from '../renderers/UnitRenderer';
import type { RenderState } from '../renderers/BaseRenderer';
import type { Tile, Unit } from '../../../types';

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
    measureText: vi.fn().mockReturnValue({ width: 32 }),
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('centers a tile using the current canvas dimensions', () => {
    const renderer = new MapRenderer(createContext());

    expect(renderer.getViewportPositionForTile(10, 20, 1279, 667)).toEqual({
      x: -1071,
      y: 411,
    });
  });

  it('does not snap an ordinary drag release into another wrapped GUI period', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: { width: 80, height: 50, xsize: 80, ysize: 50, wrap_id: 3, tiles: {} },
    });

    const viewportOrigin = { x: 368, y: 1284 };
    expect(renderer.setMapviewOrigin(viewportOrigin.x, viewportOrigin.y, 800, 600)).toEqual(
      viewportOrigin
    );
  });

  it('normalizes wrapped origins using the authoritative rectangular x/y coordinates', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: { width: 80, height: 50, xsize: 80, ysize: 50, wrap_id: 3, tiles: {} },
    });

    const source = renderer.mapToGuiVector(-1, 23);
    const normalizeGuiPos = (
      renderer as unknown as {
        normalizeGuiPos: (guiX: number, guiY: number) => { guiX: number; guiY: number };
      }
    ).normalizeGuiPos;
    const normalized = normalizeGuiPos.call(renderer, source.guiDx + 32, source.guiDy + 12);
    const wrapped = renderer.mapToGuiVector(79, 23);

    expect(normalized).toEqual({
      guiX: wrapped.guiDx + 32,
      guiY: wrapped.guiDy + 12,
    });
  });

  it('renders the neighboring finite-map copy when a wrapped viewport reaches a seam', () => {
    const renderer = new MapRenderer(createContext());
    const tiles: Tile[] = [
      { x: 0, y: 25, terrain: 'plains', known: true, visible: true },
      { x: 79, y: 25, terrain: 'desert', known: true, visible: true },
    ];
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: {
        width: 80,
        height: 50,
        xsize: 80,
        ysize: 50,
        wrap_id: 3,
        tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
      },
    });

    const viewport = {
      ...renderer.getViewportPositionForTile(0, 25, 800, 600),
      width: 800,
      height: 600,
    };
    const getWrappedRenderViews = (
      renderer as unknown as {
        getWrappedRenderViews: (
          mapTiles: Tile[],
          candidate: typeof viewport
        ) => Array<{ viewport: typeof viewport; visibleTiles: Tile[] }>;
      }
    ).getWrappedRenderViews;
    const views = getWrappedRenderViews.call(renderer, tiles, viewport);

    expect(views.map(view => view.viewport)).toEqual(
      expect.arrayContaining([viewport, { ...viewport, x: 2288, y: 2244 }])
    );
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

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);
    expect(context.drawImage).toHaveBeenCalledWith(stackSprite, 0, -31);
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('renders the ruleset nation graphic shield for own and foreign units', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const shieldSprite = {} as HTMLImageElement;
    const tilesetLoader = {
      getSprite: (key: string) =>
        key === 'u.warriors' ? unitSprite : key === 'f.shield.rome' ? shieldSprite : null,
    };
    const renderer = new UnitRenderer(context, tilesetLoader as never, 96, 48);
    const unit: Unit = {
      id: 'roman-warrior',
      playerId: 'roman-player',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      players: {
        'roman-player': {
          name: 'Caesar',
          nation: 'roman',
          nationGraphic: 'rome',
          color: '#ff0000',
        },
      },
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(shieldSprite, 25, -15);
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);
  });

  it('normalizes object worker activities to their active indicator sprites', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const activitySprite = {} as HTMLImageElement;
    const tilesetLoader = {
      getSprite: (key: string) =>
        key === 'u.worker' ? unitSprite : key === 'unit.irrigate' ? activitySprite : null,
    };
    const renderer = new UnitRenderer(context, tilesetLoader as never, 96, 48);
    const unit: Unit = {
      id: 'worker',
      playerId: 'player-1',
      unitTypeId: 'worker',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
      activity: { type: 'irrigating', turnsRemaining: 2, totalTurns: 3 },
    };

    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(activitySprite, 55, -25);
  });

  it('draws the connect badge only when a matching activity has queued orders', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const activitySprite = {} as HTMLImageElement;
    const connectSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      {
        getSprite: (key: string) =>
          key === 'u.worker'
            ? unitSprite
            : key === 'unit.road'
              ? activitySprite
              : key === 'unit.connect'
                ? connectSprite
                : null,
      } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'worker',
      playerId: 'player-1',
      unitTypeId: 'worker',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
      activity: 'road',
      orders: [],
    };

    renderer.renderUnits({ ...createRenderState(), units: { [unit.id]: unit } });
    expect(context.drawImage).not.toHaveBeenCalledWith(connectSprite, -6, -6);

    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: { ...unit, orders: [{ type: 'activity' }] } },
    });
    expect(context.drawImage).toHaveBeenCalledWith(connectSprite, -6, -6);
  });

  it('anchors queued movement segments to their absolute interpolated positions', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      { getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null) } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'rapid-unit',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    renderer.renderUnits({ ...createRenderState(), units: { [unit.id]: unit } });
    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: { ...unit, x: 1 } },
    });
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: { ...unit, x: 2 } },
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);

    now += 180;
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: { ...unit, x: 2 } },
    });
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 64, 13);
  });

  it('does not start a full-map RAF loop for selection pulsing', () => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      terrainRenderer: {
        invalidateTileCache: vi.fn(),
        renderTerrain: vi.fn(),
        renderSpecials: vi.fn(),
        renderOceanPadding: vi.fn(),
      },
      borderRenderer: { render: vi.fn(), hasActiveAnimation: () => false },
      cityRenderer: { renderCities: vi.fn() },
      unitRenderer: {
        renderUnitSelection: vi.fn(),
        renderSelectedUnit: vi.fn(),
        renderUnits: vi.fn(),
        hasActiveMovementAnimations: () => false,
        hasActiveSelectionAnimation: () => true,
      },
      presentationEffectRenderer: {
        getUnitOverrides: () => ({}),
        render: () => false,
      },
      fogRenderer: { render: vi.fn() },
      pathRenderer: { renderPaths: vi.fn() },
      getVisibleTiles: () => [],
      checkViewportBounds: () => false,
    });
    const state = createRenderState();
    state.selectedUnitId = 'stale-unit';

    renderer.render(state, true);

    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('uses the ruleset activity target graphic when one is provided', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const targetActivitySprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      {
        getSprite: (key: string) =>
          key === 'u.worker' ? unitSprite : key === 'unit.farmland' ? targetActivitySprite : null,
      } as never,
      96,
      48
    );
    renderer.setActivityGraphics({
      extra_farmland: {
        name: 'Farmland',
        activity_gfx: 'unit.farmland',
      },
    });
    const unit: Unit = {
      id: 'farmer',
      playerId: 'player-1',
      unitTypeId: 'worker',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
      activity: { type: 'irrigating', target: 'extra_farmland' },
      activityTarget: 'extra_farmland',
    };

    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(targetActivitySprite, 55, -25);
  });

  it('renders reference-positioned HP, movement, veteran, and stack overlays', () => {
    const context = createContext();
    const sprites = new Map<string, HTMLImageElement>();
    for (const key of [
      'u.warriors',
      'unit.hp_35',
      'unit.hp_50',
      'unit.vet_2',
      'unit.stk_shld_l',
      'unit.stack2',
      'unit.action_decision_want',
    ])
      sprites.set(key, {} as HTMLImageElement);
    const renderer = new UnitRenderer(
      context,
      { getSprite: (key: string) => sprites.get(key) ?? null } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'decorated-warrior',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      maxHp: 200,
      movesLeft: 2,
      maxMoves: 6,
      veteranLevel: 2,
      actionDecisionWant: true,
    };

    renderer.renderUnits({
      ...createRenderState(),
      showUnitMovePoints: true,
      units: {
        [unit.id]: unit,
        second: { ...unit, id: 'second' },
      },
    });

    const drawCalls = (context.drawImage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(drawCalls).toContainEqual([sprites.get('unit.hp_35'), 0, -31]);
    expect(drawCalls).toContainEqual([sprites.get('unit.hp_50'), 0, -36]);
    expect(drawCalls).toContainEqual([sprites.get('unit.vet_2'), 35, -35]);
    expect(drawCalls).toContainEqual([sprites.get('unit.stk_shld_l'), 0, -31]);
    expect(drawCalls).toContainEqual([sprites.get('unit.stack2'), 0, -31]);
    expect(drawCalls).toContainEqual([sprites.get('unit.action_decision_want'), 55, -25]);
  });

  it('keeps a visible identity marker when a nation flag asset is unavailable', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      { getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null) } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'unknown-flag-warrior',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      players: {
        'player-1': {
          name: 'Unknown',
          nation: 'custom_nation',
          color: '#123456',
        },
      },
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);
    expect(context.fillRect).toHaveBeenCalledWith(25, -15, 14, 14);
  });

  it('keeps a neutral identity marker while owner metadata is still missing', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      { getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null) } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'packet-order-warrior',
      playerId: 'player-not-yet-loaded',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      units: { [unit.id]: unit },
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);
    expect(context.fillRect).toHaveBeenCalledWith(25, -15, 14, 14);
  });

  it('renders a selected own-unit annotation label above the sprite', () => {
    const context = createContext();
    const renderer = new UnitRenderer(context, { getSprite: () => undefined } as never, 96, 48);
    const unit: Unit = {
      id: 'selected-warrior',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };

    renderer.renderUnits({
      ...createRenderState(),
      currentPlayerId: 'player-1',
      selectedUnitId: unit.id,
      focusedUnits: [unit.id],
      units: { [unit.id]: unit },
    });

    expect(context.fillText).toHaveBeenCalledWith(
      'warriors',
      expect.any(Number),
      expect.any(Number)
    );
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

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, -84, -11);
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
