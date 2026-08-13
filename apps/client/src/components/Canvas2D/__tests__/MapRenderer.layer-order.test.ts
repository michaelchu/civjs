import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapRenderer } from '../MapRenderer';
import type { RenderState } from '../renderers/BaseRenderer';

const createContext = (): CanvasRenderingContext2D =>
  ({
    canvas: { width: 800, height: 600 },
    clearRect: vi.fn(),
    fillRect: vi.fn(),
  }) as unknown as CanvasRenderingContext2D;

const createState = (): RenderState => ({
  viewport: { x: 0, y: 0, width: 800, height: 600 },
  map: {
    width: 2,
    height: 1,
    xsize: 2,
    ysize: 1,
    tiles: {
      '0,0': { x: 0, y: 0, terrain: 'plains', known: true, visible: true },
    },
  },
  units: {},
  cities: {},
  players: {},
});

describe('MapRenderer painter order', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:251-387
   * @assertion The map is painted layer-first so later city/unit/fog/interaction
   * layers cannot be covered by a later terrain pass.
   */
  it('keeps the reference layer order for one map copy', () => {
    const calls: string[] = [];
    const renderer = new MapRenderer(createContext());
    const record = (name: string) => vi.fn(() => calls.push(name));

    Object.assign(renderer as unknown as Record<string, unknown>, {
      fogOfWarEnabled: true,
      terrainRenderer: {
        setMapGeometry: record('terrain.setMapGeometry'),
        renderTerrain: record('terrain'),
        renderTerrainEntries: record('terrain'),
        renderSpecials: record('special1'),
        renderSpecial2: record('special2'),
        renderSpecial3: record('special3'),
        renderTileLabels: record('tile-labels'),
      },
      borderRenderer: {
        setMapGeometry: record('border.setMapGeometry'),
        render: record('borders'),
      },
      cityRenderer: {
        setMapGeometry: record('city.setMapGeometry'),
        renderCityEntries: record('cities'),
        renderCityOverlayEntries: record('citybar'),
      },
      unitRenderer: {
        setMapGeometry: record('unit.setMapGeometry'),
        renderUnitLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>,
          afterTile?: (state: RenderState, tile: RenderState['map']['tiles'][string]) => void
        ) => {
          calls.push('unit-selection', 'units');
          for (const entry of entries) afterTile?.(entry.state, entry.tile);
        },
      },
      presentationEffectRenderer: {
        setMapGeometry: record('effect.setMapGeometry'),
        getUnitOverrides: () => ({}),
        renderUnitEffectsForTile: record('effects'),
        renderGotoEffectsForTile: record('goto-effects'),
      },
      fogRenderer: {
        setMapGeometry: record('fog.setMapGeometry'),
        render: record('fog'),
      },
      pathRenderer: {
        setMapGeometry: record('path.setMapGeometry'),
        renderPathLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>,
          afterTile?: (state: RenderState, tile: RenderState['map']['tiles'][string]) => void
        ) => {
          calls.push('paths');
          for (const entry of entries) afterTile?.(entry.state, entry.tile);
        },
      },
    });

    const renderMapLayers = (
      renderer as unknown as {
        renderMapLayers: (
          state: RenderState,
          visibleTiles: RenderState['map']['tiles'][string][]
        ) => boolean;
      }
    ).renderMapLayers;
    renderMapLayers.call(renderer, createState(), [createState().map.tiles['0,0']]);

    expect(calls).toEqual([
      'terrain',
      'special1',
      'borders',
      'cities',
      'special2',
      'unit-selection',
      'units',
      'effects',
      'fog',
      'special3',
      'tile-labels',
      'citybar',
      'paths',
      'goto-effects',
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:388-402
   * @assertion Unknown tiles are suppressed from normal map layers but remain
   * in the final GOTO walk, exactly as put_one_tile() specifies.
   */
  it('retains unknown tile origins only for the GOTO layer', () => {
    const renderer = new MapRenderer(createContext());
    const state = createState();
    const known = state.map.tiles['0,0'];
    const unknown = {
      x: 1,
      y: 0,
      terrain: 'unknown',
      known: false,
      visible: false,
    };
    const terrainEntries = vi.fn();
    const unitEntries = vi.fn();
    const gotoEntries = vi.fn();
    const unitEffect = vi.fn().mockReturnValue(false);
    const gotoEffect = vi.fn().mockReturnValue(false);

    Object.assign(renderer as unknown as Record<string, unknown>, {
      fogOfWarEnabled: true,
      terrainRenderer: {
        renderTerrainEntries: terrainEntries,
        renderSpecials: vi.fn(),
        renderSpecial2: vi.fn(),
        renderSpecial3: vi.fn(),
        renderTileLabels: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      cityRenderer: {
        renderCityEntries: vi.fn(),
        renderCityOverlayEntries: vi.fn(),
      },
      unitRenderer: {
        renderUnitLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>,
          afterTile?: (state: RenderState, tile: RenderState['map']['tiles'][string]) => void
        ) => {
          unitEntries(entries);
          for (const entry of entries) afterTile?.(entry.state, entry.tile);
        },
      },
      presentationEffectRenderer: {
        getUnitOverrides: () => ({}),
        renderUnitEffectsForTile: unitEffect,
        renderGotoEffectsForTile: gotoEffect,
      },
      fogRenderer: { render: vi.fn() },
      pathRenderer: {
        renderPathLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>,
          afterTile?: (state: RenderState, tile: RenderState['map']['tiles'][string]) => void
        ) => {
          gotoEntries(entries);
          for (const entry of entries) afterTile?.(entry.state, entry.tile);
        },
      },
    });

    const renderMapLayers = (
      renderer as unknown as {
        renderMapLayers: (
          candidate: RenderState,
          visibleTiles: RenderState['map']['tiles'][string][]
        ) => boolean;
      }
    ).renderMapLayers;
    renderMapLayers.call(renderer, state, [known, unknown]);

    expect(
      terrainEntries.mock.calls[0]?.[0].map((entry: { tile: { known: boolean } }) => entry.tile)
    ).toEqual([known]);
    expect(
      unitEntries.mock.calls[0]?.[0].map((entry: { tile: { known: boolean } }) => entry.tile)
    ).toEqual([known]);
    expect(
      gotoEntries.mock.calls[0]?.[0].map((entry: { tile: { known: boolean } }) => entry.tile)
    ).toEqual([known, unknown]);
    expect(unitEffect).toHaveBeenCalledTimes(1);
    expect(gotoEffect).toHaveBeenCalledTimes(2);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-387
   * @assertion Explicit wrapped copies are merged into one GUI painter walk,
   * so a copy supplied later cannot paint a shallower tile over a deeper one.
   */
  it('sorts wrapped copies together before every global layer pass', () => {
    const renderer = new MapRenderer(createContext());
    const shallow = {
      x: 1,
      y: 0,
      terrain: 'desert',
      known: true,
      visible: true,
    };
    const deep = createState().map.tiles['0,0'];
    const state = {
      ...createState(),
      map: {
        ...createState().map,
        height: 2,
        ysize: 2,
        topology_id: 1,
        tiles: { '0,0': deep, '1,0': shallow },
      },
    };
    const terrainEntries = vi.fn();
    const cityEntries = vi.fn();
    const unitEntries = vi.fn();
    const pathEntries = vi.fn();

    Object.assign(renderer as unknown as Record<string, unknown>, {
      currentMap: state.map,
      fogOfWarEnabled: false,
      terrainRenderer: {
        renderTerrainEntries: terrainEntries,
        renderSpecials: vi.fn(),
        renderSpecial2: vi.fn(),
        renderSpecial3: vi.fn(),
        renderTileLabels: vi.fn(),
      },
      borderRenderer: { render: vi.fn() },
      cityRenderer: {
        renderCityEntries: cityEntries,
        renderCityOverlayEntries: vi.fn(),
      },
      unitRenderer: {
        renderUnitLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>
        ) => unitEntries(entries),
      },
      presentationEffectRenderer: {
        getUnitOverrides: () => ({}),
        renderUnitEffectsForTile: vi.fn().mockReturnValue(false),
        renderGotoEffectsForTile: vi.fn().mockReturnValue(false),
      },
      fogRenderer: { render: vi.fn() },
      pathRenderer: {
        renderPathLayerEntries: (
          entries: Array<{ state: RenderState; tile: RenderState['map']['tiles'][string] }>
        ) => pathEntries(entries),
      },
    });

    const renderMapViews = (
      renderer as unknown as {
        renderMapViews: (
          views: Array<{
            state: RenderState;
            visibleTiles: RenderState['map']['tiles'][string][];
            isPrimary?: boolean;
          }>
        ) => boolean;
      }
    ).renderMapViews;
    renderMapViews.call(renderer, [
      {
        state: { ...state, viewport: { x: 0, y: -100, width: 800, height: 600 } },
        visibleTiles: [deep],
        isPrimary: true,
      },
      {
        state: { ...state, viewport: { x: 0, y: 100, width: 800, height: 600 } },
        visibleTiles: [shallow],
      },
    ]);

    const tileOrder = (entries: Array<{ tile: { x: number; y: number } }>) =>
      entries.map(entry => `${entry.tile.x},${entry.tile.y}`);
    expect(tileOrder(terrainEntries.mock.calls[0]?.[0])).toEqual(['1,0', '0,0']);
    expect(tileOrder(cityEntries.mock.calls[0]?.[0])).toEqual(['1,0', '0,0']);
    expect(tileOrder(unitEntries.mock.calls[0]?.[0])).toEqual(['1,0', '0,0']);
    expect(tileOrder(pathEntries.mock.calls[0]?.[0])).toEqual(['1,0', '0,0']);
  });
});
