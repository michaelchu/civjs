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

const AMPLIO2_PRESENTATION_OFFSETS = {
  unitFlagX: 25,
  unitFlagY: -16,
  cityFlagX: 2,
  cityFlagY: -9,
  unitX: 19,
  unitY: -14,
  activityX: 55,
  activityY: -25,
  selectX: 0,
  selectY: 0,
  stackX: 0,
  stackY: -31,
  cityX: 0,
  cityY: -14,
  citybarX: 45,
  citybarY: 55,
  tileLabelX: 0,
  tileLabelY: 15,
};

function createSquareUnitTileset(getSprite: (key: string) => HTMLImageElement | undefined | null) {
  return {
    getSprite,
    getGeometry: () => ({
      tileWidth: 96,
      tileHeight: 48,
      fullTileWidth: 96,
      fullTileHeight: 48,
      hexWidth: 0,
      hexHeight: 0,
    }),
    getPresentationOffsets: () => AMPLIO2_PRESENTATION_OFFSETS,
  };
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
type DecorateTile = (state: RenderState, tile: Tile, render: () => void) => void;
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

  it('preserves an exact finite-map GUI origin without generic camera clamping', () => {
    const renderer = new MapRenderer(createContext());
    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: {
        width: 40,
        height: 40,
        xsize: 40,
        ysize: 40,
        topology_id: 1,
        wrap_id: 0,
        tiles: {},
      },
    });

    expect(renderer.setMapviewOrigin(-100_000, 75_000, 800, 600)).toEqual({
      x: -100_000,
      y: 75_000,
    });
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

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-380
   * @assertion Wrapped square-ISO copies retain the exact gui_rect_iterate
   * painter walk instead of reverting to bounding-box tile culling at seams.
   */
  it('uses the square-ISO painter iterator for neighboring wrapped copies', () => {
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
        topology_id: 1,
        wrap_id: 1,
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
        ) => Array<{ viewport: typeof viewport; visibleTiles: Tile[]; isPrimary: boolean }>;
      }
    ).getWrappedRenderViews;
    const views = getWrappedRenderViews.call(renderer, tiles, viewport);

    expect(views.some(view => view.isPrimary && view.visibleTiles.includes(tiles[0]))).toBe(true);
    expect(views.some(view => !view.isPrimary && view.visibleTiles.includes(tiles[1]))).toBe(true);
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

    // Stay inside freeciv-web's strict 10 ms square-ISO refresh gate.
    vi.setSystemTime(1005);
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
    vi.setSystemTime(1005);
    renderer.render(createRenderState());
    renderer.cleanup();
    vi.advanceTimersByTime(100);

    expect(renderCityEntries).toHaveBeenCalledTimes(1);
  });

  it('uses the Amplio2 stack badge key without drawing a placeholder', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const stackSprite = {} as HTMLImageElement;
    const tilesetLoader = createSquareUnitTileset((key: string) =>
      key === 'u.warriors' ? unitSprite : key === 'unit.stack' ? stackSprite : null
    );
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
    expect(context.drawImage).toHaveBeenCalledWith(stackSprite, 0, -31);
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it('renders the ruleset nation graphic shield for own and foreign units', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const shieldSprite = {} as HTMLImageElement;
    const tilesetLoader = createSquareUnitTileset((key: string) =>
      key === 'u.warriors' ? unitSprite : key === 'f.shield.rome' ? shieldSprite : null
    );
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

    expect(context.drawImage).toHaveBeenCalledWith(shieldSprite, 25, -16);
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 19, -14);
  });

  it('normalizes object worker activities to their active indicator sprites', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const activitySprite = {} as HTMLImageElement;
    const tilesetLoader = createSquareUnitTileset((key: string) =>
      key === 'u.worker' ? unitSprite : key === 'unit.irrigate' ? activitySprite : null
    );
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

  it('does not add modern queued-order badges to square-isometric units', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const activitySprite = {} as HTMLImageElement;
    const connectSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) =>
        key === 'u.worker'
          ? unitSprite
          : key === 'unit.road'
            ? activitySprite
            : key === 'unit.connect'
              ? connectSprite
              : null
      ) as never,
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
    expect(context.drawImage).not.toHaveBeenCalledWith(connectSprite, -6, -6);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:289-343
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:674-705,895-965
   * @assertion Square-isometric movement consumes the reference eight-step
   * tuple once for the body, once for the nation shield, and once for HP in
   * each composed frame; stack and veteran badges remain tile-anchored.
   */
  it('samples square-isometric movement in the reference sprite-composition sequence', () => {
    const context = createContext();
    const sprites = new Map<string, HTMLImageElement>();
    for (const key of ['u.warriors', 'f.shield.rome', 'unit.hp_50', 'unit.stack', 'unit.vet_2']) {
      sprites.set(key, {} as HTMLImageElement);
    }
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => sprites.get(key) ?? null) as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'moving-unit',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 50,
      maxHp: 100,
      movesLeft: 1,
      veteranLevel: 2,
    };
    const players = {
      'player-1': {
        name: 'Caesar',
        nation: 'roman',
        nationGraphic: 'rome',
        color: '#ff0000',
      },
    };

    renderer.renderUnits(createUnitState(unit, { players }));
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }, { players }),
      units: {
        [unit.id]: { ...unit, x: 1 },
        stacked: { ...unit, id: 'stacked', x: 1, unitTypeId: 'settlers' },
      },
    });

    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('u.warriors'), 49, 1);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('f.shield.rome'), 61, 2);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.hp_50'), 36, -13);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.stack'), 48, -7);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.vet_2'), 83, -11);

    // The next frame consumes another three reference samples (2/8, 1/8,
    // 1/8) from the same mutable destination tuple.
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }, { players }),
      units: {
        [unit.id]: { ...unit, x: 1 },
        stacked: { ...unit, id: 'stacked', x: 1, unitTypeId: 'settlers' },
      },
    });
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('u.warriors'), 55, 4);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('f.shield.rome'), 67, 5);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.hp_50'), 42, -10);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.stack'), 48, -7);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.vet_2'), 83, -11);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:674-705
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:289-343
   * @assertion Each translated copy of a moving unit on a wrapped square map
   * invokes the mutable body/shield/HP sampling sequence independently.
   */
  it('advances square movement samples for every wrapped map copy', () => {
    const context = createContext();
    const sprites = new Map<string, HTMLImageElement>();
    for (const key of ['u.warriors', 'f.shield.rome', 'unit.hp_50']) {
      sprites.set(key, {} as HTMLImageElement);
    }
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => sprites.get(key) ?? null) as never,
      96,
      48
    );
    const unit: Unit = {
      id: 'wrapped-moving-unit',
      playerId: 'player-1',
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      hp: 50,
      maxHp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };
    const players = {
      'player-1': {
        name: 'Caesar',
        nation: 'roman',
        nationGraphic: 'rome',
        color: '#ff0000',
      },
    };

    renderer.renderUnits(createUnitState(unit, { players }));
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();

    const movedState = createUnitState({ ...unit, x: 1 }, { players });
    const tile = movedState.map.tiles['1,0'];
    renderer.renderUnitLayerEntries([
      { state: movedState, tile },
      {
        state: {
          ...movedState,
          viewport: { ...movedState.viewport, x: 96 },
        },
        tile,
      },
    ]);

    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('u.warriors'), 49, 1);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('f.shield.rome'), 61, 2);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.hp_50'), 36, -13);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('u.warriors'), -41, 4);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('f.shield.rome'), -29, 5);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.hp_50'), -54, -10);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:674-705,895-913,944-955
   * @assertion A foreign Flagless square unit skips the shield helper and
   * therefore consumes only the body and HP movement-counter samples.
   */
  it('does not consume a square movement sample for an omitted Flagless shield', () => {
    const context = createContext();
    const sprites = new Map<string, HTMLImageElement>([
      ['u.storm', {} as HTMLImageElement],
      ['unit.hp_50', {} as HTMLImageElement],
    ]);
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => sprites.get(key) ?? null) as never,
      96,
      48
    );
    renderer.setUnitGraphics({ storm: { graphic: 'u.storm', flagless: true } });
    const unit: Unit = {
      id: 'foreign-flagless',
      playerId: 'player-2',
      unitTypeId: 'storm',
      x: 0,
      y: 0,
      hp: 50,
      maxHp: 100,
      movesLeft: 1,
      veteranLevel: 0,
    };
    const players = {
      'player-2': {
        name: 'Foreign',
        nation: 'roman',
        nationGraphic: 'rome',
        color: '#ff0000',
      },
    };

    renderer.renderUnits(createUnitState(unit, { players, currentPlayerId: 'player-1' }));
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }, { players, currentPlayerId: 'player-1' }),
      units: { [unit.id]: { ...unit, x: 1 } },
    });

    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 1 }, { players, currentPlayerId: 'player-1' }),
      units: { [unit.id]: { ...unit, x: 1 } },
    });

    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('u.storm'), 55, 4);
    expect(context.drawImage).toHaveBeenCalledWith(sprites.get('unit.hp_50'), 36, -13);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
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
      createSquareUnitTileset((key: string) => (key === 'u.warriors' ? unitSprite : null)) as never,
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
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 67, 10);

    now += 10;
    (context.drawImage as unknown as ReturnType<typeof vi.fn>).mockClear();
    renderer.renderUnits({
      ...createUnitState({ ...unit, x: 2, transportedBy: 'transport-1' }),
    });
    expect(renderer.hasActiveMovementAnimations()).toBe(false);
    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 115, 34);
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
      createSquareUnitTileset((key: string) =>
        key === 'u.worker' ? unitSprite : key === 'unit.farmland' ? targetActivitySprite : null
      ) as never,
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

  it('renders only the reference HP, veteran, stack, and action-decision overlays', () => {
    const context = createContext();
    const sprites = new Map<string, HTMLImageElement>();
    for (const key of [
      'u.warriors',
      'unit.hp_50',
      'unit.vet_2',
      'unit.stack',
      'unit.action_decision_want',
    ])
      sprites.set(key, {} as HTMLImageElement);
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => sprites.get(key) ?? null) as never,
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
      units: {
        [unit.id]: unit,
        second: { ...unit, id: 'second' },
      },
    });

    const drawCalls = (context.drawImage as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(drawCalls).toContainEqual([sprites.get('unit.hp_50'), 0, -31]);
    expect(drawCalls).toContainEqual([sprites.get('unit.vet_2'), 35, -35]);
    expect(drawCalls).toContainEqual([sprites.get('unit.stack'), 0, -31]);
    expect(drawCalls).toContainEqual([sprites.get('unit.action_decision_want'), 55, -25]);
  });

  it('keeps a visible identity marker when a nation flag asset is unavailable', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => (key === 'u.warriors' ? unitSprite : null)) as never,
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

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 19, -14);
    expect(context.fillRect).toHaveBeenCalledWith(25, -16, 14, 14);
  });

  it('keeps a neutral identity marker while owner metadata is still missing', () => {
    const context = createContext();
    const unitSprite = {} as HTMLImageElement;
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset((key: string) => (key === 'u.warriors' ? unitSprite : null)) as never,
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

    expect(context.drawImage).toHaveBeenCalledWith(unitSprite, 19, -14);
    expect(context.fillRect).toHaveBeenCalledWith(25, -16, 14, 14);
  });

  it('does not add a custom selected-unit annotation above the sprite', () => {
    const context = createContext();
    const renderer = new UnitRenderer(
      context,
      createSquareUnitTileset(() => undefined) as never,
      96,
      48
    );
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
    const tilesetLoader = createSquareUnitTileset((key: string) =>
      key === 'u.warriors' ? unitSprite : null
    );
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

  it('limits native ISO-hex culling to rows that intersect the viewport', () => {
    const renderer = new MapRenderer(createContext());
    const tiles = Array.from({ length: 80 }, (_, y) =>
      Array.from({ length: 100 }, (__, x) => ({
        x,
        y,
        terrain: 'plains',
        known: true,
        visible: true,
      }))
    ).flat();
    const internals = renderer as unknown as {
      currentMap: RenderState['map'];
      nativeToGuiPosition: (x: number, y: number) => { guiDx: number; guiDy: number };
      getVisibleTiles: (tiles: Tile[], viewport: RenderState['viewport']) => Tile[];
    };
    internals.currentMap = {
      width: 100,
      height: 80,
      topology_id: 3,
      wrap_id: 0,
      tiles: Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile])),
    };
    const projectTile = vi.spyOn(internals, 'nativeToGuiPosition');

    const visible = internals.getVisibleTiles(tiles, {
      x: -400,
      y: 3000,
      width: 800,
      height: 600,
    });

    expect(visible.length).toBeGreaterThan(0);
    expect(projectTile.mock.calls.length).toBeLessThan(tiles.length / 10);
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
    const state = createRenderState();
    state.map.topology_id = 3;
    state.map.tiles['0,0'] = { ...state.map.tiles['0,0'], visible: false };
    const tile = state.map.tiles['0,0'];
    const recordDecorated = (layer: string, decorateTile?: DecorateTile) => {
      const render = record(layer);
      if (decorateTile) decorateTile(state, tile, render);
      else render();
    };
    const terrainRenderer = {
      setMapGeometry: vi.fn(),
      invalidateTileCache: vi.fn(),
      renderTerrainLayerEntries: vi.fn(
        (_entries: RenderEntry[], layer: number, decorateTile?: DecorateTile) =>
          recordDecorated(`terrain${layer + 1}`, decorateTile)
      ),
      renderDarknessEntries: vi.fn((_entries: RenderEntry[], decorateTile?: DecorateTile) =>
        recordDecorated('darkness', decorateTile)
      ),
      renderWaterEntries: vi.fn((_entries: RenderEntry[], decorateTile?: DecorateTile) =>
        recordDecorated('water', decorateTile)
      ),
      renderRoadEntries: vi.fn((_entries: RenderEntry[], decorateTile?: DecorateTile) =>
        recordDecorated('roads', decorateTile)
      ),
      renderSpecials: vi.fn(record('special1')),
      renderSpecial2: vi.fn(record('special2')),
      renderSpecial3: vi.fn(record('special3')),
      renderTileLabels: vi.fn(record('tileLabel')),
    };
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        terrainRenderer,
        borderRenderer: { render: vi.fn(record('grid1')) },
        cityRenderer: {
          renderCityEntries: vi.fn((_entries: RenderEntry[], decorateTile?: DecorateTile) =>
            recordDecorated('city1', decorateTile)
          ),
          renderWorkedTileOverlayEntries: vi.fn(
            (_entries: RenderEntry[], decorateTile?: DecorateTile) =>
              recordDecorated('overlays', decorateTile)
          ),
          renderCityBarEntries: vi.fn(record('cityBar')),
        },
        unitRenderer: {
          renderNonFocusedUnitLayerEntries: vi.fn(
            (
              _entries: readonly RenderEntry[],
              afterTile?: AfterTile,
              decorateTile?: DecorateTile
            ) => {
              const render = () => {
                calls.push({ layer: 'unit', filter: context.filter });
                afterTile?.(state, tile);
              };
              if (decorateTile) decorateTile(state, tile, render);
              else render();
            }
          ),
          renderFocusedUnitLayerEntries: vi.fn(
            (_entries: readonly RenderEntry[], decorateTile?: DecorateTile) =>
              recordDecorated('focusUnit', decorateTile)
          ),
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

  it('batches native entity and terrain setup once per layer instead of once per tile', () => {
    const context = createContext();
    const renderer = new MapRenderer(context);
    const state = createRenderState();
    state.map.topology_id = 3;
    const tiles = Array.from({ length: 24 }, (_, index) => ({
      x: index % 8,
      y: Math.floor(index / 8),
      terrain: 'plains',
      known: true,
      visible: true,
    }));
    state.map.tiles = Object.fromEntries(tiles.map(tile => [`${tile.x},${tile.y}`, tile]));

    const renderTerrainLayerEntries = vi.fn();
    const renderCityEntries = vi.fn();
    const renderWorkedTileOverlayEntries = vi.fn();
    const renderNonFocusedUnitLayerEntries = vi.fn(
      (entries: readonly RenderEntry[], afterTile?: AfterTile) => {
        for (const entry of entries) afterTile?.(entry.state, entry.tile);
      }
    );
    const renderFocusedUnitLayerEntries = vi.fn();
    Object.assign(renderer as unknown as Record<string, unknown>, {
      isInitialized: true,
      ...createPipelineDoubles({
        terrainRenderer: { renderTerrainLayerEntries },
        cityRenderer: { renderCityEntries, renderWorkedTileOverlayEntries },
        unitRenderer: {
          renderNonFocusedUnitLayerEntries,
          renderFocusedUnitLayerEntries,
        },
      }),
      getWrappedRenderViews: () => [
        { viewport: state.viewport, visibleTiles: tiles, isPrimary: true },
      ],
      checkViewportBounds: () => false,
    });

    renderer.render(state, true);

    expect(renderTerrainLayerEntries).toHaveBeenCalledTimes(3);
    expect(renderTerrainLayerEntries).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ tile: tiles[0] })]),
      0,
      expect.any(Function)
    );
    expect(renderTerrainLayerEntries.mock.calls[0]?.[0]).toHaveLength(tiles.length);
    expect(renderCityEntries).toHaveBeenCalledTimes(1);
    expect(renderWorkedTileOverlayEntries).toHaveBeenCalledTimes(1);
    expect(renderNonFocusedUnitLayerEntries).toHaveBeenCalledTimes(1);
    expect(renderFocusedUnitLayerEntries).toHaveBeenCalledTimes(1);
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
