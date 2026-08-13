import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../../../types';
import type { RenderState } from '../renderers/BaseRenderer';
import { TerrainRenderer } from '../renderers/TerrainRenderer';
import type { TilesetProvider } from '../tilesets/TilesetProvider';
import type { TerrainCompositionProfile } from '../tilesets/TilesetProvider';

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
      topologyId: 1,
    },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSprite: vi.fn((tag: string) => sprites.get(tag) ?? null),
    hasSprite: vi.fn((tag: string) => sprites.has(tag)),
    hasTerrainDefinition: vi.fn(),
    getTileSize: vi.fn(() => ({ width: 96, height: 48 })),
    getGeometry: vi.fn(() => ({
      tileWidth: 96,
      tileHeight: 48,
      fullTileWidth: 96,
      fullTileHeight: 48,
      hexWidth: 0,
      hexHeight: 0,
    })),
    getTopologyCompatibility: vi.fn(() => 'exact'),
    getTerrainComposition: vi.fn(() => null),
    getPresentationOffsets: vi.fn(() => ({
      unitFlagX: 0,
      unitFlagY: 0,
      cityFlagX: 0,
      cityFlagY: 0,
      unitX: 0,
      unitY: 0,
      activityX: 0,
      activityY: 0,
      selectX: 0,
      selectY: 0,
      stackX: 0,
      stackY: 0,
      cityX: 0,
      cityY: 0,
      citybarX: 0,
      citybarY: 0,
      tileLabelX: 0,
      tileLabelY: 0,
    })),
  } as unknown as TilesetProvider;
};

const createHexProvider = (tags: string[]) => {
  const provider = createProvider(tags);
  provider.metadata.topologyId = 3;
  vi.mocked(provider.getGeometry).mockReturnValue({
    tileWidth: 126,
    tileHeight: 64,
    fullTileWidth: 126,
    fullTileHeight: 96,
    hexWidth: 16,
    hexHeight: 0,
  });
  return provider;
};

const setNativeComposition = (
  provider: TilesetProvider,
  extraStyles: Record<string, string>,
  terrains: TerrainCompositionProfile['terrains'] = {}
) => {
  vi.mocked(provider.getTerrainComposition).mockReturnValue({
    mode: 'direct-cells',
    matchTypes: [[], [], []],
    terrains,
    extraStyles,
  });
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1181-1188
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:340-350
   * @assertion Tileset offsets move the label anchor before the reference
   * painter centers the text and subtracts one baseline pixel.
   */
  it('places tile labels at the exact tileset-relative reference baseline', () => {
    const context = {
      canvas: { width: 800, height: 600 },
      measureText: vi.fn(() => ({ width: 31 })),
      fillText: vi.fn(),
      font: '',
      textBaseline: '',
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D;
    const provider = createProvider([]);
    vi.mocked(provider.getPresentationOffsets).mockReturnValue({
      unitFlagX: 0,
      unitFlagY: 0,
      cityFlagX: 0,
      cityFlagY: 0,
      unitX: 0,
      unitY: 0,
      activityX: 0,
      activityY: 0,
      selectX: 0,
      selectY: 0,
      stackX: 0,
      stackY: 0,
      cityX: 0,
      cityY: 0,
      citybarX: 0,
      citybarY: 0,
      tileLabelX: 7,
      tileLabelY: 15,
    });
    const renderer = new TerrainRenderer(context, provider, 96, 48);
    const labeled = tile({ x: 3, y: 1, label: 'Oracle' });
    const state = createState({ '3,1': labeled });
    state.viewport = { x: 20, y: 30, width: 800, height: 600 };
    state.map.width = 4;
    state.map.height = 4;

    renderer.renderTileLabels(state, [labeled]);

    // map_to_gui_pos(3,1) = (96,96), then subtract viewport (20,30).
    expect(context.fillText).toHaveBeenCalledWith('Oracle', 76 + 7 + 48 - 15, 66 + 15 - 1);
    expect(context.font).toBe('16px Georgia, serif');
    expect(context.textBaseline).toBe('alphabetic');
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
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:24-31
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1459-1513
   * @assertion Square path segments are emitted in numeric DIR8 order so west
   * is painted before east at their overlapping center pixels.
   */
  it('emits square path segments in the browser numeric DIR8 order', () => {
    const center = tile({ x: 1, y: 1, hasRailroad: true });
    const west = tile({ x: 0, y: 1, hasRailroad: true });
    const east = tile({ x: 2, y: 1, hasRailroad: true });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createProvider(['road.rail_w', 'road.rail_e']),
      96,
      48
    );
    const state = createState({ '0,1': west, '1,1': center, '2,1': east });
    state.map.width = 3;
    state.map.xsize = 3;
    renderer.setMapGeometry(state.map);

    renderer.renderTerrain(state, [center]);

    expect(drawnTags(context)).toEqual(['road.rail_w', 'road.rail_e']);
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
   * @reference reference/freeciv/data/hexemplio/rivers.spec:29-104
   * @reference reference/freeciv/client/tilespec.c:6140-6195
   * @assertion The topology-3 renderer consumes all six river-mask bits in
   * Hexemplio's N,E,SE,S,W,NW tag order and resolves diagonal native steps.
   */
  it('renders six-direction ISO-hex rivers and outlets', () => {
    const center = tile({ x: 4, y: 3, riverMask: 0b100101 });
    const coast = tile({ x: 2, y: 3, terrain: 'coast' });
    // Logical NW from native (2,3) is native (2,1).
    const northwestRiver = tile({ x: 2, y: 1, riverMask: 1 });
    const context = createContext();
    const renderer = new TerrainRenderer(
      context,
      createHexProvider(['road.river_s_n1e0se1s0w0nw1:0', 'road.river_outlet_nw:0']),
      126,
      64
    );
    const state = createState({
      '4,3': center,
      '2,3': coast,
      '2,1': northwestRiver,
    });
    state.map.width = 10;
    state.map.height = 8;
    state.map.xsize = 10;
    state.map.ysize = 8;
    state.map.topology_id = 3;
    renderer.setMapGeometry(state.map);

    renderer.renderWaterEntries([
      { state, tile: center },
      { state, tile: coast },
    ]);

    expect(drawnTags(context)).toEqual(['road.river_s_n1e0se1s0w0nw1:0', 'road.river_outlet_nw:0']);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/hexemplio.tilespec:347-357
   * @reference reference/freeciv/client/tilespec.c:6139-6190
   * @assertion Hexemplio's River-style loop owns irrigation and farmland as
   * well as rivers, emits every shoreline outlet in ruleset order, and only
   * connects road-caused river bodies to adjacent copies of the same extra.
   */
  it('renders every native River-style outlet and body in WATER order', () => {
    const coast = tile({ x: 2, y: 3, terrain: 'coast' });
    const riverNeighbor = tile({ x: 3, y: 4, improvements: ['river'] });
    const irrigationNeighbor = tile({ x: 2, y: 5, improvements: ['irrigation'] });
    const farmlandNeighbor = tile({ x: 2, y: 2, improvements: ['farmland'] });
    const center = tile({ x: 6, y: 3, improvements: ['river', 'irrigation', 'farmland'] });
    const eastOcean = tile({ x: 7, y: 4, terrain: 'ocean' });
    const southeastRiver = tile({ x: 6, y: 5, improvements: ['river'] });
    const context = createContext();
    const tags = [
      'road.river_outlet_e:0',
      'tx.irrigation_outlet_se:0',
      'tx.farmland_outlet_w:0',
      'road.river_s_n0e1se1s0w0nw0:0',
      'tx.irrigation_s_n0e1se0s0w0nw0:0',
      'tx.farmland_s_n0e1se0s0w0nw0:0',
    ];
    const provider = createHexProvider(tags);
    setNativeComposition(provider, {
      'road.river': 'River',
      'tx.irrigation': 'River',
      'tx.farmland': 'River',
    });
    const renderer = new TerrainRenderer(context, provider, 126, 64);
    renderer.setExtraGraphics({
      extra_river: { name: 'River', causes: 'Road', graphic: 'road.river' },
      extra_irrigation: {
        name: 'Irrigation',
        causes: 'Irrigation',
        graphic: 'tx.irrigation',
      },
      extra_farmland: { name: 'Farmland', causes: 'Irrigation', graphic: 'tx.farmland' },
    });
    const state = createState({
      '2,3': coast,
      '3,4': riverNeighbor,
      '2,5': irrigationNeighbor,
      '2,2': farmlandNeighbor,
      '6,3': center,
      '7,4': eastOcean,
      '6,5': southeastRiver,
    });
    state.map.width = 12;
    state.map.height = 10;
    state.map.xsize = 12;
    state.map.ysize = 10;
    state.map.topology_id = 3;
    renderer.setMapGeometry(state.map);

    renderer.renderWaterEntries([
      { state, tile: coast },
      { state, tile: center },
    ]);

    expect(drawnTags(context)).toEqual(tags);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/client/tilespec.c:4560-4599,5362-5397
   * @assertion Direct terrain blending crops the neighboring terrain quadrant
   * and applies the dither mask with Freeciv's crop-relative offset.
   */
  it('masks direct terrain blend quadrants with t.dither_tile', () => {
    const center = tile({ x: 1, y: 1, terrain: 'plains' });
    const north = tile({ x: 1, terrain: 'desert' });
    const context = createContext();
    const provider = createProvider(['t.l0.plains1', 't.l0.desert1', 't.dither_tile']);
    const whole = {
      matchStyle: 0,
      spriteType: 0,
      matchIndices: 1,
      matchIndex: [0],
      dither: false,
      matchType: 'lake',
      matchWith: [],
    };
    setNativeComposition(
      provider,
      {},
      {
        plains: { numLayers: 1, blendLayer: 1, layers: [whole] },
        desert: { numLayers: 1, blendLayer: 1, layers: [whole] },
      }
    );
    const offscreenContext = {
      drawImage: vi.fn(),
      globalCompositeOperation: 'source-over',
    } as unknown as CanvasRenderingContext2D;
    const offscreen = {
      tag: 'masked-blend',
      width: 0,
      height: 0,
      getContext: vi.fn(() => offscreenContext),
    } as unknown as Sprite;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(tag => {
      if (tag === 'canvas') return offscreen;
      return createElement(tag);
    });
    const renderer = new TerrainRenderer(context, provider, 96, 48);
    const state = createState({ '1,1': center, '1,0': north });
    state.map.width = 3;
    state.map.height = 3;
    state.map.xsize = 3;
    state.map.ysize = 3;
    state.viewport = { ...state.viewport, x: 0, y: 48 };
    renderer.setMapGeometry(state.map);

    renderer.renderTerrainLayerEntries([{ state, tile: center }], 0);

    expect(offscreen.width).toBe(48);
    expect(offscreen.height).toBe(24);
    expect(offscreenContext.drawImage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tag: 't.l0.desert1' }),
      48,
      0,
      48,
      24,
      0,
      0,
      48,
      24
    );
    expect(offscreenContext.drawImage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tag: 't.dither_tile' }),
      -48,
      -0
    );
    expect(context.drawImage).toHaveBeenCalledWith(offscreen, 48, 0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/client/tilespec.c:6198-6262,6346-6376,6438-6465
   * @assertion Native special layers iterate 3Layer before Single extras,
   * include resources in Single1, and apply hidden_by from the ruleset.
   */
  it('renders native special style families in Freeciv loop order', () => {
    const specialTile = tile({
      resource: 'gold',
      improvements: ['fort', 'mine', 'oil_well', 'pollution'],
    });
    const context = createContext();
    const provider = createHexProvider([
      'base.outpost_bg:0',
      'base.outpost_mg:0',
      'base.outpost_fg:0',
      'tx.mine',
      'tx.oil_mine',
      'tx.pollution',
      'ts.gold',
    ]);
    setNativeComposition(provider, {
      'tx.mine': 'Single1',
      'tx.oil_mine': 'Single1',
      'tx.pollution': 'Single2',
      'base.outpost': '3Layer',
      'ts.gold': 'Single1',
    });
    const renderer = new TerrainRenderer(context, provider, 126, 64);
    renderer.setExtraGraphics({
      extra_mine: { name: 'Mine', graphic: 'tx.mine', hidden_by: 'Oil Well' },
      extra_oil_well: { name: 'Oil Well', graphic: 'tx.oil_mine' },
      extra_pollution: { name: 'Pollution', graphic: 'tx.pollution' },
      extra_fort: { name: 'Fort', graphic: 'base.outpost' },
      extra_gold: { name: 'Gold', causes: 'Resource', graphic: 'ts.gold' },
    });
    const state = createState({ '0,0': specialTile });
    state.map.topology_id = 3;
    state.viewport = { ...state.viewport, x: -126, y: 64 };
    renderer.setMapGeometry(state.map);

    renderer.renderSpecials(state, [specialTile]);
    renderer.renderSpecial2(state, [specialTile]);
    renderer.renderSpecial3(state, [specialTile]);

    expect(drawnTags(context)).toEqual([
      'base.outpost_bg:0',
      'tx.oil_mine',
      'ts.gold',
      'base.outpost_mg:0',
      'tx.pollution',
      'base.outpost_fg:0',
    ]);
    expect(context.drawImage).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'base.outpost_bg:0' }),
      0,
      -32
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/client/tilespec.c:5013-5210
   * @assertion A city suppresses an isolated path sprite but does not suppress
   * a connected combined railroad sprite.
   */
  it('keeps connected native rail graphics visible through a city', () => {
    const center = tile({
      x: 2,
      y: 3,
      cityId: 'city-1',
      hasRailroad: true,
      improvements: ['railroad'],
    });
    const east = tile({ x: 3, y: 4, hasRailroad: true, improvements: ['railroad'] });
    const key = 'road.rail_n0e1se0s0w0nw0';
    const context = createContext();
    const provider = createHexProvider([key]);
    const renderer = new TerrainRenderer(context, provider, 126, 64);
    const state = createState({ '2,3': center, '3,4': east });
    state.map.width = 8;
    state.map.height = 8;
    state.map.xsize = 8;
    state.map.ysize = 8;
    state.map.topology_id = 3;
    renderer.setMapGeometry(state.map);

    renderer.renderRoadEntries([{ state, tile: center }]);

    expect(drawnTags(context)).toEqual([key]);
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
