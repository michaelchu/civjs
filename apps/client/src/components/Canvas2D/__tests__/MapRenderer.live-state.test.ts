import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapRenderer } from '../MapRenderer';
import { UnitRenderer } from '../renderers/UnitRenderer';
import type { RenderState } from '../renderers/BaseRenderer';
import type { Tile, Unit } from '../../../types';

function createContext() {
  const context = {
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
    save: vi.fn(),
    restore: vi.fn(),
    filter: 'none',
    imageSmoothingEnabled: false,
  };
  return context as unknown as CanvasRenderingContext2D;
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

type RenderEntry = { state: RenderState; tile: Tile };
type AfterTile = (state: RenderState, tile: Tile) => void;
type RendererDouble = Record<string, unknown>;

function createPipelineDoubles(
  overrides: {
    terrainRenderer?: RendererDouble;
    borderRenderer?: RendererDouble;
    cityRenderer?: RendererDouble;
    unitRenderer?: RendererDouble;
    presentationEffectRenderer?: RendererDouble;
    fogRenderer?: RendererDouble;
    pathRenderer?: RendererDouble;
  } = {}
): RendererDouble {
  const runAfterTile = (entries: readonly RenderEntry[], afterTile?: AfterTile) => {
    for (const entry of entries) afterTile?.(entry.state, entry.tile);
  };

  return {
    terrainRenderer: {
      setMapGeometry: vi.fn(),
      invalidateTileCache: vi.fn(),
      renderTerrainEntries: vi.fn(),
      renderTerrainLayerEntries: vi.fn(),
      renderDarknessEntries: vi.fn(),
      renderWaterEntries: vi.fn(),
      renderRoadEntries: vi.fn(),
      renderSpecials: vi.fn(),
      renderSpecial2: vi.fn(),
      renderSpecial3: vi.fn(),
      renderTileLabels: vi.fn(),
      ...overrides.terrainRenderer,
    },
    borderRenderer: {
      setMapGeometry: vi.fn(),
      render: vi.fn(),
      hasActiveAnimation: () => false,
      ...overrides.borderRenderer,
    },
    cityRenderer: {
      setMapGeometry: vi.fn(),
      renderCityEntries: vi.fn(),
      renderCityOverlayEntries: vi.fn(),
      renderWorkedTileOverlayEntries: vi.fn(),
      renderCityBarEntries: vi.fn(),
      ...overrides.cityRenderer,
    },
    unitRenderer: {
      setMapGeometry: vi.fn(),
      renderUnitLayerEntries: vi.fn(runAfterTile),
      renderNonFocusedUnitLayerEntries: vi.fn(runAfterTile),
      renderFocusedUnitLayerEntries: vi.fn(),
      hasActiveMovementAnimations: () => false,
      ...overrides.unitRenderer,
    },
    presentationEffectRenderer: {
      setMapGeometry: vi.fn(),
      getUnitOverrides: () => ({}),
      renderUnitEffectsForTile: () => false,
      renderGotoEffectsForTile: () => false,
      ...overrides.presentationEffectRenderer,
    },
    fogRenderer: {
      setMapGeometry: vi.fn(),
      render: vi.fn(),
      ...overrides.fogRenderer,
    },
    pathRenderer: {
      setMapGeometry: vi.fn(),
      renderPathLayerEntries: vi.fn(runAfterTile),
      ...overrides.pathRenderer,
    },
  };
}

function createUnitState(unit: Unit, overrides: Partial<RenderState> = {}): RenderState {
  const state = createRenderState();
  return {
    ...state,
    ...overrides,
    map: {
      ...state.map,
      tiles: {
        [`${unit.x},${unit.y}`]: {
          x: unit.x,
          y: unit.y,
          terrain: 'plains',
          known: true,
          visible: true,
        },
      },
    },
    units: { [unit.id]: unit },
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

  it('normalizes a wrapped origin to an equivalent native-axis map copy', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: {
        width: 80,
        height: 50,
        xsize: 80,
        ysize: 50,
        topology_id: 3,
        wrap_id: 3,
        tiles: {},
      },
    });

    const viewportOrigin = { x: 368, y: 1284 };
    const normalized = renderer.setMapviewOrigin(viewportOrigin.x, viewportOrigin.y, 800, 600);
    expect(normalized).toEqual({ x: 368, y: 2484 });
    expect(normalized.x - viewportOrigin.x).toBe(0);
    expect(normalized.y - viewportOrigin.y).toBe(1200);
  });

  it('normalizes C2C3 wrapped origins through native storage axes', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: {
        width: 80,
        height: 50,
        xsize: 80,
        ysize: 50,
        topology_id: 3,
        wrap_id: 3,
        tiles: {},
      },
    });

    const source = renderer.mapToGuiVector(-1, 80);
    const normalizeGuiPos = (
      renderer as unknown as {
        normalizeGuiPos: (guiX: number, guiY: number) => { guiX: number; guiY: number };
      }
    ).normalizeGuiPos;
    const normalized = normalizeGuiPos.call(renderer, source.guiDx + 32, source.guiDy + 12);
    expect(normalized).toEqual({ guiX: 3824, guiY: 3108 });
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
        topology_id: 3,
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
      expect.arrayContaining([viewport, { ...viewport, x: -4144, y: 2244 }])
    );
  });

  it('renders every wrapped copy while a presentation effect is active', () => {
    const renderTerrainEntries = vi.fn();
    const renderSpecials = vi.fn();
    const renderSpecial2 = vi.fn();
    const renderSpecial3 = vi.fn();
    const renderPresentationEffect = vi.fn().mockReturnValue(true);
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);

    const renderer = new MapRenderer(createContext());
    const state = createRenderState();
    const firstViewport = { x: 0, y: 0, width: 800, height: 600 };
    const secondViewport = { x: 7680, y: 0, width: 800, height: 600 };
    const tile = Object.values(state.map.tiles)[0];

    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        terrainRenderer: { renderTerrainEntries, renderSpecials, renderSpecial2, renderSpecial3 },
        presentationEffectRenderer: {
          renderUnitEffectsForTile: renderPresentationEffect,
        },
      }),
      getWrappedRenderViews: () => [
        { viewport: firstViewport, visibleTiles: [tile], isPrimary: true },
        { viewport: secondViewport, visibleTiles: [tile], isPrimary: false },
      ],
      checkViewportBounds: () => false,
    });

    renderer.render({ ...state, viewport: firstViewport }, true);

    expect(renderTerrainEntries).toHaveBeenCalledTimes(1);
    expect(renderTerrainEntries.mock.calls[0]?.[0]).toHaveLength(2);
    expect(renderSpecials).toHaveBeenCalledTimes(2);
    expect(renderSpecial2).toHaveBeenCalledTimes(2);
    expect(renderSpecial3).toHaveBeenCalledTimes(2);
    expect(renderPresentationEffect).toHaveBeenCalledTimes(2);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:238-343
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:504-519
   * @assertion Unit movement interpolation keeps the map redraw loop alive for
   * the active animation, then stops scheduling frames once the animation settles.
   */
  it('keeps movement animation frames alive until the unit settles', () => {
    const frames: FrameRequestCallback[] = [];
    let movementActive = true;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });

    const renderer = new MapRenderer(createContext());
    const state = createRenderState();
    const tile = Object.values(state.map.tiles)[0]!;
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        unitRenderer: { hasActiveMovementAnimations: () => movementActive },
      }),
      getWrappedRenderViews: () => [
        { viewport: state.viewport, visibleTiles: [tile], isPrimary: true },
      ],
      checkViewportBounds: () => false,
    });

    const renderSpy = vi.spyOn(renderer, 'render');
    renderer.render(state, true);
    expect(frames).toHaveLength(1);

    movementActive = false;
    frames.shift()?.(16);

    expect(renderSpy).toHaveBeenNthCalledWith(2, state, true);
    expect(frames).toHaveLength(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:504-519
   * @assertion Renderer cleanup cancels a pending animation redraw so a
   * detached map canvas cannot continue painting stale state.
   */
  it('cancels a pending movement redraw during cleanup', () => {
    const cancelFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockReturnValue(73));
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const renderer = new MapRenderer(createContext());
    const state = createRenderState();
    const tile = Object.values(state.map.tiles)[0]!;
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        unitRenderer: { hasActiveMovementAnimations: () => true },
      }),
      getWrappedRenderViews: () => [
        { viewport: state.viewport, visibleTiles: [tile], isPrimary: true },
      ],
      checkViewportBounds: () => false,
    });

    renderer.render(state, true);
    renderer.cleanup();

    expect(cancelFrame).toHaveBeenCalledWith(73);
  });

  it('coalesces throttled packet bursts and renders the latest state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const renderer = new MapRenderer(createContext());
    const renderCityEntries = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({ cityRenderer: { renderCityEntries } }),
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
    expect(renderCityEntries).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);
    expect(renderCityEntries).toHaveBeenCalledTimes(2);
    expect(renderCityEntries.mock.calls.at(-1)?.[0]?.[0]?.state).toBe(latestState);
  });

  it('cancels a pending render when the renderer is cleaned up', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const renderer = new MapRenderer(createContext());
    const renderCityEntries = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({ cityRenderer: { renderCityEntries } }),
      checkViewportBounds: () => false,
    });

    renderer.render(createRenderState());
    vi.setSystemTime(1010);
    renderer.render(createRenderState());
    renderer.cleanup();
    vi.advanceTimersByTime(100);

    expect(renderCityEntries).toHaveBeenCalledTimes(1);
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

    renderer.renderUnits(createUnitState(unit));
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }),
    });
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 2 }),
    });

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 16, -11);

    now += 180;
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 2 }),
    });
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 64, 13);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:245-255,289-343
   * @assertion Reduced motion and transport state cancel the reference unit
   * movement interpolation and draw the unit at its authoritative tile.
   */
  it('cancels movement interpolation for reduced motion and transported units', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      { getSprite: (key: string) => (key === 'u.warriors' ? unitSprite : null) } as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'transported-warrior',
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

    renderer.renderUnits(createUnitState(unit));
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }),
    });
    expect(renderer.hasActiveMovementAnimations()).toBe(true);

    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }),
      reducedMotion: true,
    });
    expect(renderer.hasActiveMovementAnimations()).toBe(false);
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 64, 13);

    now += 10;
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 2, transportedBy: 'transport-1' }),
    });
    expect(renderer.hasActiveMovementAnimations()).toBe(false);
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 112, 37);
  });

  it('does not start a full-map RAF loop for selection pulsing', () => {
    const requestFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        unitRenderer: {
          hasActiveMovementAnimations: () => false,
          hasActiveSelectionAnimation: () => true,
        },
      }),
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

  it('does not add a custom selected-unit annotation above the sprite', () => {
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

    expect(context.fillText).not.toHaveBeenCalledWith(
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

  /**
   * @evidence parity
   * @reference reference/freeciv/data/hexemplio.tilespec:111-143
   * @reference reference/freeciv/client/mapview_common.c:1374-1394
   * @reference reference/freeciv/client/tilespec.c:4669-4685,6139-6554
   * @assertion Native Hexemplio uses the declared layer order, applies Auto
   * fog to foggable sprite layers including Grid1 borders, and leaves the
   * TileLabel/CityBar text layers unfiltered.
   */
  it('runs native Hexemplio layers with per-sprite Auto fog boundaries', () => {
    const context = createContext();
    const savedFilters: string[] = [];
    context.save = vi.fn(() => savedFilters.push(context.filter));
    context.restore = vi.fn(() => {
      context.filter = savedFilters.pop() ?? 'none';
    });
    const calls: Array<{ layer: string; filter: string }> = [];
    const record = (layer: string) => () => calls.push({ layer, filter: context.filter });
    const provider = {
      getGeometry: () => ({
        tileWidth: 126,
        tileHeight: 64,
        fullTileWidth: 126,
        fullTileHeight: 96,
        hexWidth: 16,
        hexHeight: 0,
      }),
      getRenderProfile: () => ({ fogStyle: 'auto' }),
      getSprite: () => null,
      hasSprite: () => false,
      hasTerrainDefinition: () => false,
      getTileSize: () => ({ width: 126, height: 64 }),
      getTopologyCompatibility: () => 'exact',
      getTerrainComposition: () => null,
      getPresentationOffsets: () => ({}),
      load: vi.fn(),
      dispose: vi.fn(),
      metadata: {
        id: 'hex-test',
        name: 'Hex test',
        format: 'synthetic',
        projection: 'isometric',
        topologyId: 3,
      },
    } as unknown as ConstructorParameters<typeof MapRenderer>[1];
    const renderer = new MapRenderer(context, provider);
    const terrainRenderer = {
      setMapGeometry: vi.fn(),
      invalidateTileCache: vi.fn(),
      renderTerrainLayerEntries: vi.fn((_entries: RenderEntry[], layer: number) =>
        calls.push({ layer: `terrain${layer + 1}`, filter: context.filter })
      ),
      renderDarknessEntries: vi.fn(record('darkness')),
      renderWaterEntries: vi.fn(record('water')),
      renderRoadEntries: vi.fn(record('roads')),
      renderSpecials: vi.fn(record('special1')),
      renderSpecial2: vi.fn(record('special2')),
      renderSpecial3: vi.fn(record('special3')),
      renderTileLabels: vi.fn(record('tileLabel')),
    };
    const state = createRenderState();
    state.map.topology_id = 3;
    state.map.tiles['0,0'] = { ...state.map.tiles['0,0'], visible: false };
    const tile = state.map.tiles['0,0'];
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        terrainRenderer,
        borderRenderer: { render: vi.fn(record('grid1')) },
        cityRenderer: {
          renderCityEntries: vi.fn(record('city1')),
          renderWorkedTileOverlayEntries: vi.fn(record('overlays')),
          renderCityBarEntries: vi.fn(record('cityBar')),
        },
        unitRenderer: {
          renderNonFocusedUnitLayerEntries: vi.fn(
            (_entries: readonly RenderEntry[], afterTile?: AfterTile) => {
              calls.push({ layer: 'unit', filter: context.filter });
              afterTile?.(state, tile);
            }
          ),
          renderFocusedUnitLayerEntries: vi.fn(record('focusUnit')),
        },
        pathRenderer: { renderPathLayerEntries: vi.fn(record('goto')) },
      }),
      getWrappedRenderViews: () => [
        { viewport: state.viewport, visibleTiles: [tile], isPrimary: true },
      ],
      checkViewportBounds: () => false,
    });

    renderer.render(state, true);

    expect(calls.map(call => call.layer)).toEqual([
      'terrain1',
      'terrain2',
      'darkness',
      'terrain3',
      'water',
      'roads',
      'special1',
      'grid1',
      'city1',
      'special2',
      'unit',
      'special3',
      'overlays',
      'tileLabel',
      'cityBar',
      'focusUnit',
      'goto',
    ]);
    const unfogged = new Set(['tileLabel', 'cityBar', 'goto']);
    for (const call of calls) {
      expect(call.filter).toBe(unfogged.has(call.layer) ? 'none' : 'brightness(65%)');
    }
    expect(context.filter).toBe('none');
  });

  it('reveals unknown terrain and skips the fog layer when debug fog is disabled', () => {
    const renderer = new MapRenderer(createContext());
    const renderTerrain = vi.fn();
    const renderFog = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        terrainRenderer: {
          renderTerrainEntries: vi.fn((entries: RenderEntry[]) => {
            renderTerrain(
              entries[0]?.state,
              entries.map(entry => entry.tile)
            );
          }),
        },
        fogRenderer: { render: renderFog },
      }),
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

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:272-291
   * @assertion A finite map that does not cover the viewport leaves black
   * out-of-map pixels even when the debug fog toggle is disabled.
   */
  it('clears finite-map padding to black when fog is disabled', () => {
    const context = createContext();
    const renderer = new MapRenderer(context);
    const renderFog = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({ fogRenderer: { render: renderFog } }),
      checkViewportBounds: () => true,
    });

    renderer.setFogOfWarEnabled(false);
    renderer.render(createRenderState(), true);

    expect(context.fillStyle).toBe('#000');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
    expect(renderFog).not.toHaveBeenCalled();
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
