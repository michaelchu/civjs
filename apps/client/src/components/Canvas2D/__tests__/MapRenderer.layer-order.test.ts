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
        renderSpecials: record('specials'),
      },
      borderRenderer: {
        setMapGeometry: record('border.setMapGeometry'),
        render: record('borders'),
      },
      cityRenderer: {
        setMapGeometry: record('city.setMapGeometry'),
        renderCities: record('cities'),
      },
      unitRenderer: {
        setMapGeometry: record('unit.setMapGeometry'),
        renderUnits: record('units'),
        renderUnitSelection: record('unit-selection'),
        renderSelectedUnit: record('selected-unit'),
      },
      presentationEffectRenderer: {
        setMapGeometry: record('effect.setMapGeometry'),
        getUnitOverrides: () => ({}),
        render: record('effects'),
      },
      fogRenderer: {
        setMapGeometry: record('fog.setMapGeometry'),
        render: record('fog'),
      },
      pathRenderer: {
        setMapGeometry: record('path.setMapGeometry'),
        renderPaths: record('paths'),
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
      'borders',
      'specials',
      'cities',
      'units',
      'effects',
      'fog',
      'paths',
      'unit-selection',
      'selected-unit',
    ]);
  });
});
