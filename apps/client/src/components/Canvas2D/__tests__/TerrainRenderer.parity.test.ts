import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../types';
import type { RenderState } from '../renderers/BaseRenderer';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { TilesetProvider } from '../tilesets/TilesetProvider';

type Sprite = HTMLCanvasElement & { tag: string };

const createContext = () =>
  ({
    canvas: { width: 800, height: 600 },
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  }) as unknown as CanvasRenderingContext2D;

const createProvider = (tags: string[]) => {
  const sprites = new Map<string, Sprite>();
  for (const tag of tags) {
    sprites.set(tag, { tag, width: 20, height: 10 } as unknown as Sprite);
  }

  return {
    metadata: {
      id: 'terrain-test',
      name: 'Terrain test tileset',
      format: 'synthetic',
      projection: 'isometric',
    },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSprite: vi.fn((tag: string) => sprites.get(tag) ?? null),
    hasSprite: vi.fn((tag: string) => sprites.has(tag)),
    hasTerrainDefinition: vi.fn(),
    getTileSize: vi.fn(() => ({ width: 96, height: 48 })),
  } as unknown as TilesetProvider;
};

const createState = (tiles: Record<string, Tile>): RenderState => ({
  viewport: { x: 0, y: 0, width: 800, height: 600 },
  map: {
    width: 2,
    height: 2,
    xsize: 2,
    ysize: 2,
    tiles,
  },
  units: {},
  cities: {},
  players: {},
});

const tile = (overrides: Partial<Tile> = {}): Tile => ({
  x: 0,
  y: 0,
  terrain: 'plains',
  visible: true,
  known: true,
  ...overrides,
});

const drawnTags = (context: CanvasRenderingContext2D): string[] =>
  (context.drawImage as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    ([sprite]) => (sprite as Sprite).tag
  );

describe('TerrainRenderer parity contracts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1458-1525
   * @assertion Connected roads and rails render in reference order, with the
   * rail connection painted over the road connection.
   */
  it('renders connected river, road, and rail sprites in the reference order', () => {
    const center = tile({ hasRoad: true, hasRailroad: true, riverMask: 5 });
    const east = tile({ x: 1, hasRoad: true, hasRailroad: true });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['road.river_s_n1e0s1w0:0', 'road.road_e', 'road.rail_e']),
      96,
      48
    );
    const state = createState({ '0,0': center, '1,0': east });
    renderer.setMapGeometry(state.map);
    renderer.renderTerrain(state, [center]);

    expect(drawnTags(context)).toEqual(['road.river_s_n1e0s1w0:0', 'road.road_e', 'road.rail_e']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1208-1243
   * @assertion A coast tile adjacent to a river tile receives the matching
   * directional outlet sprite even when the coast tile has no river mask.
   */
  it('renders a river outlet on the adjacent coast tile', () => {
    const coast = tile({ terrain: 'coast' });
    const river = tile({ x: 1, riverMask: 1 });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['road.river_outlet_e:0']),
      96,
      48
    );
    const state = createState({ '0,0': coast, '1,0': river });
    renderer.setMapGeometry(state.map);
    renderer.renderTerrain(state, [coast]);

    expect(drawnTags(context)).toContain('road.river_outlet_e:0');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1531-1547
   * @assertion Irrigation is hidden beneath a city, while a non-city tile still
   * receives its irrigation improvement sprite.
   */
  it('suppresses city-covered irrigation and renders it on an empty tile', () => {
    const emptyTile = tile({ improvements: ['irrigation'] });
    const cityTile = tile({ x: 1, improvements: ['irrigation'], cityId: 'city-1' });
    const context = createContext();
    const renderer = new TerrainRenderer(context, createProvider(['extra.irrigation']), 96, 48);
    renderer.setExtraGraphics({
      extra_irrigation: { graphic: 'extra.irrigation' },
    });
    const state = createState({ '0,0': emptyTile, '1,0': cityTile });
    renderer.setMapGeometry(state.map);
    renderer.renderTerrain(state, [emptyTile, cityTile]);

    expect(drawnTags(context)).toEqual(['extra.irrigation']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1192-1203
   * @assertion Resource sprites use the ruleset graphic tag, are centered at
   * the reference reduced scale, and unmapped resources are skipped.
   */
  it('renders authoritative resource graphics with centered scaling', () => {
    const resourceTile = tile({ resource: 'wheat' });
    const unmappedTile = tile({ x: 1, resource: 'uranium' });
    const context = createContext();
    const renderer = new TerrainRenderer(context, createProvider(['ts.wheat:0']), 96, 48);
    renderer.setExtraGraphics({
      extra_wheat: { graphic: 'ts.wheat' },
    });
    const state = createState({ '0,0': resourceTile, '1,0': unmappedTile });
    renderer.setMapGeometry(state.map);
    renderer.renderSpecials(state, [resourceTile, unmappedTile]);

    expect(drawnTags(context)).toEqual(['ts.wheat:0']);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'ts.wheat:0' }),
      expect.any(Number),
      expect.any(Number),
      14,
      7
    );
  });
});
