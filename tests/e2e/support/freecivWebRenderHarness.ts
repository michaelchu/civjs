import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { PARITY_MINIMAP_SIZE, PARITY_VIEWPORT } from './parityConstants';

export interface ReferenceRenderViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReferenceMapFixture {
  tiles: ReferenceParityTile[];
  width: number;
  height: number;
}

export interface CanvasPixels {
  width: number;
  height: number;
  data: number[];
}

export interface PixelDiff {
  width: number;
  height: number;
  differingPixels: number;
  totalPixels: number;
  maxChannelDelta: number;
  meanChannelDelta: number;
}

/** Read a canvas without introducing a PNG decoder into the test runner. */
export const readCanvasPixels = async (canvas: Locator): Promise<CanvasPixels> =>
  canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    return {
      width: element.width,
      height: element.height,
      data: Array.from(context.getImageData(0, 0, element.width, element.height).data),
    };
  });

/** Read the reference overview image after its CSS dimensions are applied. */
export const readReferenceDisplayedOverviewPixels = async (page: Page): Promise<CanvasPixels> =>
  page.evaluate(() => {
    const image = document.getElementById('overview_img');
    if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth) {
      throw new Error('Reference overview image is unavailable');
    }
    const bounds = image.getBoundingClientRect();
    const width = Math.round(bounds.width);
    const height = Math.round(bounds.height);
    if (!width || !height) throw new Error('Reference overview image has no displayed dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Reference overview canvas context is unavailable');
    context.drawImage(image, 0, 0, width, height);
    return {
      width,
      height,
      data: Array.from(context.getImageData(0, 0, width, height).data),
    };
  });

/**
 * Compare two captures with an explicit per-channel tolerance. Keeping this
 * separate from Playwright's screenshot matcher makes the reference-vs-CivJS
 * comparison independent of screenshot baseline naming and YIQ thresholds.
 */
export const compareCanvasPixels = (
  expected: CanvasPixels,
  actual: CanvasPixels,
  channelTolerance = 0
): PixelDiff => {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(
      `Canvas dimensions differ: expected ${expected.width}x${expected.height}, ` +
        `actual ${actual.width}x${actual.height}`
    );
  }

  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  for (let index = 0; index < expected.data.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(expected.data[index + channel] - actual.data[index + channel]);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalChannelDelta += delta;
      if (delta > channelTolerance) pixelDiffers = true;
    }
    if (pixelDiffers) differingPixels += 1;
  }

  return {
    width: expected.width,
    height: expected.height,
    differingPixels,
    totalPixels: expected.width * expected.height,
    maxChannelDelta,
    meanChannelDelta: totalChannelDelta / (expected.width * expected.height * 4),
  };
};

export const readReferenceOverviewTileColors = async (
  page: Page,
  coordinates: Array<{ x: number; y: number }>
): Promise<Array<[number, number, number]>> =>
  page.evaluate(points => {
    const globals = window as unknown as {
      overview_tile_color: (x: number, y: number) => number;
      palette: Array<[number, number, number]>;
    };
    return points.map(
      point => globals.palette[globals.overview_tile_color(point.x, point.y)] ?? [0, 0, 0]
    );
  }, coordinates);

export interface ReferenceParityTile {
  x: number;
  y: number;
  terrain: string;
  known: boolean;
  visible: boolean;
  owner?: string;
  resource?: string;
  riverMask?: number;
  hasRoad?: boolean;
  hasRailroad?: boolean;
  improvements?: string[];
}

const unknownReferenceTile = (x: number, y: number): ReferenceParityTile => ({
  x,
  y,
  terrain: 'deep_ocean',
  known: false,
  visible: false,
});

/**
 * Adapt the fixture to Freeciv-web's rectangular overview grid.
 * overview.js indexes one rectangular cell per map-coordinate tile.
 */
export const createRectangularReferenceOverviewFixture = (
  tiles: ReferenceParityTile[],
  nativeWidth: number,
  nativeHeight: number
): ReferenceMapFixture => {
  const tilesByCoordinate = new Map(tiles.map(tile => [`${tile.x},${tile.y}`, tile] as const));
  const overviewTiles = Array.from({ length: nativeWidth * nativeHeight }, (_, index) => {
    const x = index % nativeWidth;
    const y = Math.floor(index / nativeWidth);
    return tilesByCoordinate.get(`${x},${y}`) ?? unknownReferenceTile(x, y);
  });
  return { tiles: overviewTiles, width: nativeWidth, height: nativeHeight };
};

const repositoryRoot = path.resolve(__dirname, '../../..');
const referenceJavascriptRoot = path.join(
  repositoryRoot,
  'reference/freeciv-web/freeciv-web/src/main/webapp/javascript'
);
const applicationAssetsRoot = path.join(repositoryRoot, 'apps/client/public');

const referenceScriptPaths = [
  path.join(referenceJavascriptRoot, 'utility.js'),
  path.join(referenceJavascriptRoot, 'map.js'),
  path.join(referenceJavascriptRoot, 'tile.js'),
  path.join(referenceJavascriptRoot, 'terrain.js'),
  path.join(referenceJavascriptRoot, '2dcanvas/tilespec.js'),
  path.join(referenceJavascriptRoot, '2dcanvas/tileset_config_amplio2.js'),
  path.join(applicationAssetsRoot, 'js/2dcanvas/tileset_spec_amplio2.js'),
  path.join(referenceJavascriptRoot, '2dcanvas/mapview.js'),
  path.join(referenceJavascriptRoot, '2dcanvas/mapview_common.js'),
  path.join(referenceJavascriptRoot, 'libs/bmp_lib.js'),
  path.join(referenceJavascriptRoot, 'overview.js'),
];

const atlasPaths = [0, 1, 2].map(index =>
  path.join(applicationAssetsRoot, `tilesets/freeciv-web-tileset-amplio2-${index}.png`)
);

const REFERENCE_PAGE_HTML = `
  <style>
    html, body { margin: 0; padding: 0; background: #000; }
    #canvas { display: block; }
    #overview { position: absolute; left: 0; top: ${PARITY_VIEWPORT.height + 20}px; width: ${PARITY_MINIMAP_SIZE}px; height: ${PARITY_MINIMAP_SIZE}px; }
    #overview_map { position: relative; width: ${PARITY_MINIMAP_SIZE}px; height: ${PARITY_MINIMAP_SIZE}px; overflow: hidden; }
    #overview_img, #overview_viewrect { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
  </style>
  <canvas id="canvas" width="${PARITY_VIEWPORT.width}" height="${PARITY_VIEWPORT.height}"></canvas>
  <div id="overview">
    <div id="overview_map" style="width: ${PARITY_MINIMAP_SIZE}px; height: ${PARITY_MINIMAP_SIZE}px;">
      <img id="overview_img" alt="" />
      <canvas id="overview_viewrect" width="${PARITY_MINIMAP_SIZE}" height="${PARITY_MINIMAP_SIZE}"></canvas>
    </div>
  </div>
`;

const REFERENCE_RUNTIME_BOOTSTRAP = `
  // utility.js uses jQuery's extend helper while the reference scripts load.
  // Keep the shim intentionally narrow: the harness never boots the web UI.
  window.$ = selector => {
    const element = typeof selector === 'string' ? document.querySelector(selector) : selector;
    const dimension = (axis, fallback) => {
      if (!element) return fallback;
      const direct = element[axis];
      if (typeof direct === 'number' && direct > 0) return direct;
      const computed = Number.parseFloat(getComputedStyle(element)[axis]);
      return Number.isFinite(computed) && computed > 0 ? computed : fallback;
    };
    return {
      length: element ? 1 : 0,
      width: () => dimension('width', ${PARITY_MINIMAP_SIZE}),
      height: () => dimension('height', ${PARITY_MINIMAP_SIZE}),
    };
  };
  window.$.extend = (target, ...sources) => {
    if (sources.length === 0) return Object.assign(window.$, target);
    return Object.assign(target, ...sources);
  };
`;

const REFERENCE_RUNTIME_SETUP = `
  // The render-only page deliberately supplies only the browser services that
  // the legacy map painter reads. It does not boot the Freeciv client, socket,
  // dialogs, or server.
  window.find_visible_unit = () => null;
  window.get_drawable_unit = () => null;
  window.unit_is_in_focus = () => false;
  window.draw_units = false;
  window.draw_focus_unit = false;
  window.draw_fog_of_war = true;
  window.active_city = null;
  window.map_select_active = false;
  window.map_select_setting_enabled = false;
  window.mouse_x = 0;
  window.mouse_y = 0;
  window.show_citybar = false;
  window.observing = false;
  window.current_focus = [];
  window.explosion_anim_map = {};
  window.city_rules = {};
  window.cities = {};
  window.C_S_RUNNING = 2;
  window.C_S_OVER = 3;
  window.client_state = () => window.C_S_RUNNING;
  window.civclient_state = window.C_S_RUNNING;
  window.RENDERER_2DCANVAS = 1;
  window.RENDERER_WEBGL = 2;
  window.renderer = window.RENDERER_2DCANVAS;
  window.client = { conn: { playing: { id: 0, playerno: 0 } } };
  window.players = {
    0: { id: 0, playerno: 0, nation: 0, name: 'Akiko' },
    1: { id: 1, playerno: 1, nation: 1, name: 'Caesar' },
  };
  window.nations = {
    0: { graphic_str: 'japanese', color: '#dc2626' },
    1: { graphic_str: 'romans', color: '#2563eb' },
  };
  window.city_owner_player_id = city => city.owner;
  window.is_city_center = () => false;
  window.EXTRA_RIVER = 0;
  window.EXTRA_ROAD = 1;
  window.EXTRA_RAIL = 2;
  window.EXTRA_IRRIGATION = 3;
  window.EXTRA_FARMLAND = 4;
  window.EXTRA_MINE = 5;
  window.EXTRA_OIL_WELL = 6;
  window.EXTRA_MAGLEV = 7;
  window.EXTRA_HUT = 8;
  window.EXTRA_POLLUTION = 9;
  window.EXTRA_FALLOUT = 10;
  window.EXTRA_FORTRESS = 11;
  window.EXTRA_AIRBASE = 12;
  window.EXTRA_BUOY = 13;
  window.EXTRA_RUINS = 14;
  window.extras = {
    20: { graphic_str: 'ts.gold' },
  };
  window.terrain_control = {};
  window.ruleset_control = { num_extra_types: 15 };
  window.ruleset_units = {};
  window.SSA_NONE = 0;
  // The reference BMP helper prefers window.btoa when available, but its
  // legacy binary-string path can contain non-Latin1 code units in Chromium.
  // Preserve the reference encoder's byte semantics while making the
  // render-only harness deterministic in modern browsers.
  window.bmp_lib.encode64_ = input => {
    let binary = '';
    for (let index = 0; index < input.length; index += 1) {
      binary += String.fromCharCode(input.charCodeAt(index) & 255);
    }
    return window.btoa(binary);
  };
`;

const terrainDefinitions = {
  deep_ocean: { id: 0, graphic_str: 'floor', color: [0, 33, 129] },
  coast: { id: 1, graphic_str: 'coast', color: [0, 46, 137] },
  grassland: { id: 2, graphic_str: 'grassland', color: [11, 138, 4] },
  plains: { id: 3, graphic_str: 'plains', color: [122, 156, 46] },
  forest: { id: 4, graphic_str: 'forest', color: [43, 107, 19] },
  hills: { id: 5, graphic_str: 'hills', color: [24, 97, 5] },
  mountains: { id: 6, graphic_str: 'mountains', color: [129, 127, 118] },
  desert: { id: 7, graphic_str: 'desert', color: [214, 185, 106] },
  jungle: { id: 8, graphic_str: 'jungle', color: [55, 156, 38] },
} as const;

const toReferenceTile = (tile: ReferenceParityTile, index: number) => {
  let extras = 0;
  if (tile.riverMask) extras |= 1 << 0;
  if (tile.hasRoad) extras |= 1 << 1;
  if (tile.hasRailroad) extras |= 1 << 2;
  if (tile.improvements?.includes('irrigation')) extras |= 1 << 3;

  return {
    index,
    x: tile.x,
    y: tile.y,
    terrain: tile.terrain,
    known: tile.known ? (tile.visible ? 2 : 1) : 0,
    seen: {},
    owner: tile.owner === 'player-one' ? 0 : tile.owner === 'player-two' ? 1 : null,
    claimer: null,
    worked: null,
    resource: tile.resource === 'gold' ? 20 : null,
    units: [],
    extraMask: extras,
    spec_sprite: null,
    goto_dir: null,
    nuke: 0,
  };
};

export const loadFreecivWebRenderer = async (page: Page): Promise<void> => {
  await page.setViewportSize(PARITY_VIEWPORT);
  await page.setContent(REFERENCE_PAGE_HTML);
  await page.addScriptTag({ content: REFERENCE_RUNTIME_BOOTSTRAP });
  for (const scriptPath of referenceScriptPaths) {
    await page.addScriptTag({ path: scriptPath });
  }
  await page.addScriptTag({ content: REFERENCE_RUNTIME_SETUP });
};

export const renderFreecivWebFixture = async (
  page: Page,
  tiles: ReferenceParityTile[],
  mapWidth: number,
  mapHeight: number,
  viewport: ReferenceRenderViewport,
  overviewFixture?: ReferenceMapFixture
): Promise<void> => {
  const atlasUrls = await Promise.all(
    atlasPaths.map(async atlasPath => {
      const contents = await fs.readFile(atlasPath);
      return `data:image/png;base64,${contents.toString('base64')}`;
    })
  );
  const referenceTiles = tiles.map(toReferenceTile);
  const overviewTiles = overviewFixture?.tiles.map(toReferenceTile);

  await page.evaluate(
    async ({
      atlasUrls: imageUrls,
      referenceTiles,
      width,
      height,
      viewport,
      terrain,
      minimapSize,
      overview: overviewFixture,
    }) => {
      const images = await Promise.all(
        imageUrls.map(
          url =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = reject;
              image.src = url;
            })
        )
      );

      const installMapFixture = (fixtureTiles, fixtureWidth, fixtureHeight) => {
        window.map = {
          xsize: fixtureWidth,
          ysize: fixtureHeight,
          topology_id: window.TF_ISO,
          wrap_id: 0,
        };
        const tileObjects = fixtureTiles.map(tile => ({
          ...tile,
          extras: {
            isSet: extra => (tile.extraMask & (1 << extra)) !== 0,
          },
        }));
        window.tiles = tileObjects;
        window.map_pos_to_tile = (x, y) => {
          // Preserve the legacy map_pos_to_tile() finite ISO edge adjustment
          // used by the browser painter. The test fixture must exercise the
          // same boundary lookup as the production reference scripts.
          if (x >= fixtureWidth) y -= 1;
          else if (x < 0) y += 1;
          return tileObjects[x + y * fixtureWidth] ?? null;
        };
      };

      installMapFixture(referenceTiles, width, height);
      window.terrains = Object.fromEntries(
        Object.entries(terrain).map(([name, definition]) => [
          name,
          {
            id: definition.id,
            graphic_str: definition.graphic_str,
            color_red: definition.color[0],
            color_green: definition.color[1],
            color_blue: definition.color[2],
          },
        ])
      );
      window.tileset_images = images;
      window.loaded_images = images.length;
      window.sprites = {};
      window.sprites_init = false;

      const mapCanvas = document.getElementById('canvas');
      window.mapview_canvas = mapCanvas;
      window.mapview_canvas_ctx = mapCanvas.getContext('2d');
      window.mapview_canvas_ctx.imageSmoothingEnabled = false;
      window.buffer_canvas = document.createElement('canvas');
      window.buffer_canvas_ctx = window.buffer_canvas.getContext('2d');
      window.dashedSupport = true;
      window.mapview.width = viewport.width;
      window.mapview.height = viewport.height;
      window.mapview.store_width = viewport.width;
      window.mapview.store_height = viewport.height;
      window.mapview.gui_x0 = viewport.x;
      window.mapview.gui_y0 = viewport.y;
      window.fullfog = [];
      for (let index = 0; index < 81; index += 1) {
        const ids = ['u', 'f', 'k'];
        let remaining = index;
        let tag = 't.fog';
        for (let direction = 0; direction < 4; direction += 1) {
          tag += '_' + ids[remaining % 3];
          remaining = Math.floor(remaining / 3);
        }
        window.fullfog[index] = tag;
      }

      window.init_cache_sprites();
      window.update_map_canvas(0, 0, viewport.width, viewport.height);

      const overviewWidth = overviewFixture?.width ?? width;
      const overviewHeight = overviewFixture?.height ?? height;
      if (overviewFixture) {
        installMapFixture(overviewFixture.tiles, overviewWidth, overviewHeight);
      }

      window.OVERVIEW_TILE_SIZE = 1;
      while (window.OVERVIEW_TILE_SIZE * overviewWidth < 200) {
        window.OVERVIEW_TILE_SIZE += 1;
      }
      window.palette = window.generate_palette();
      const grid = window.generate_overview_grid(overviewWidth, overviewHeight);
      const overview = document.getElementById('overview_map');
      overview.style.width = `${Math.min(minimapSize, window.OVERVIEW_TILE_SIZE * overviewWidth)}px`;
      overview.style.height = `${Math.min(minimapSize, window.OVERVIEW_TILE_SIZE * overviewHeight)}px`;
      window.bmp_lib.render('overview_img', grid, window.palette);
      const image = document.getElementById('overview_img');
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener(
            'error',
            () => reject(new Error('Reference overview image failed to load')),
            {
              once: true,
            }
          );
        });
      }
      window.render_viewrect();
    },
    {
      atlasUrls,
      referenceTiles,
      width: mapWidth,
      height: mapHeight,
      viewport,
      terrain: terrainDefinitions,
      minimapSize: PARITY_MINIMAP_SIZE,
      overview: overviewFixture
        ? {
            tiles: overviewTiles,
            width: overviewFixture.width,
            height: overviewFixture.height,
          }
        : undefined,
    }
  );
};

export const getReferenceWorldMap = (page: Page) => page.locator('#canvas');

export const getReferenceMinimap = (page: Page) => page.locator('#overview_map');
