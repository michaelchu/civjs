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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:315-325,1431-1523
   * @assertion A rail hides the road on the same connection and the river is
   * painted later in SPECIAL1.
   */
  it('renders a connected rail before the later river layer and hides its road', () => {
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
    renderer.renderSpecials(state, [center]);

    expect(drawnTags(context)).toEqual(['road.rail_e', 'road.river_s_n1e0s1w0:0']);
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
    renderer.renderSpecials(state, [coast]);

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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:238-246
   * @assertion Resource sprites use the ruleset graphic tag and native atlas
   * dimensions, while unmapped resources are skipped.
   */
  it('renders authoritative resource graphics at native atlas size', () => {
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
      expect.any(Number)
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1421-1457
   * @assertion Paths do not reveal themselves by connecting through a tile
   * whose knowledge state is TILE_UNKNOWN.
   */
  it('does not connect roads through an unknown neighbor', () => {
    const center = tile({ hasRoad: true });
    const unknownEast = tile({ x: 1, hasRoad: true, known: false, visible: false });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['road.road_e', 'road.road_isolated']),
      96,
      48
    );
    const state = createState({ '0,0': center, '1,0': unknownEast });
    renderer.setMapGeometry(state.map);
    renderer.renderTerrain(state, [center]);

    expect(drawnTags(context)).toContain('road.road_isolated');
    expect(drawnTags(context)).not.toContain('road.road_e');
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1431-1523
   * @assertion Maglev hides rail and road on a shared segment, and a city
   * suppresses an otherwise isolated path sprite.
   */
  it('applies path hiding and city-center isolation rules', () => {
    const maglev = tile({
      hasRoad: true,
      hasRailroad: true,
      improvements: ['road', 'railroad', 'maglev'],
    });
    const maglevEast = tile({
      x: 1,
      hasRoad: true,
      hasRailroad: true,
      improvements: ['road', 'railroad', 'maglev'],
    });
    const cityRoad = tile({ y: 1, hasRoad: true, improvements: ['road'], cityId: 'city-1' });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['road.road_e', 'road.rail_e', 'road.maglev_e', 'road.road_isolated']),
      96,
      48
    );
    const state = createState({ '0,0': maglev, '1,0': maglevEast, '0,1': cityRoad });
    renderer.setMapGeometry(state.map);
    renderer.renderTerrain(state, [maglev, cityRoad]);

    expect(drawnTags(context)).toEqual(['road.maglev_e']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:321-360
   * @assertion Every SPECIAL1 graphic is emitted in source order before the
   * border renderer appends border commands to the same layer.
   */
  it('renders special extras in source order before borders', () => {
    const specialTile = tile({
      resource: 'wheat',
      improvements: ['mine', 'hut', 'pollution', 'fallout'],
    });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['ts.wheat:0', 'tx.mine', 'tx.hut', 'tx.pollution', 'tx.fallout']),
      96,
      48
    );
    renderer.setExtraGraphics({
      extra_wheat: { graphic: 'ts.wheat' },
      extra_mine: { graphic: 'tx.mine' },
      extra_hut: { graphic: 'tx.hut' },
      extra_pollution: { graphic: 'tx.pollution' },
      extra_fallout: { graphic: 'tx.fallout' },
    });
    const state = createState({ '0,0': specialTile });
    renderer.setMapGeometry(state.map);

    renderer.renderSpecials(state, [specialTile]);
    expect(drawnTags(context)).toEqual([
      'ts.wheat:0',
      'tx.mine',
      'tx.hut',
      'tx.pollution',
      'tx.fallout',
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:373-376,1555-1585
   * @assertion Base middleground and foreground sprites keep their separate
   * source layers and the half-tile vertical offset.
   */
  it('keeps base middlegrounds and foregrounds in separate layers', () => {
    const baseTile = tile({ improvements: ['airbase', 'fortress'] });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['base.airbase_mg', 'base.fortress_fg']),
      96,
      48
    );
    const state = createState({ '0,0': baseTile });
    renderer.setMapGeometry(state.map);

    renderer.renderSpecial2(state, [baseTile]);
    renderer.renderSpecial3(state, [baseTile]);

    expect(drawnTags(context)).toEqual(['base.airbase_mg', 'base.fortress_fg']);
    expect(context.drawImage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tag: 'base.airbase_mg' }),
      expect.any(Number),
      -24
    );
    expect(context.drawImage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tag: 'base.fortress_fg' }),
      expect.any(Number),
      -24
    );
  });
});
