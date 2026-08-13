import { expect, type Page } from '@playwright/test';
import {
  readReferenceOverviewTileColors,
  type ReferenceParityTile,
  type ReferenceRenderViewport,
} from './freecivWebRenderHarness';
import {
  getMinimapLayout,
  getMinimapTileOrigins,
} from '../../../apps/client/src/components/GameUI/minimapGeometry';
import {
  TOPOLOGY_HEX,
  TOPOLOGY_ISO,
} from '../../../apps/client/src/components/Canvas2D/mapTopologyGeometry';
import { PARITY_VIEWPORT, REDUCED_MOTION_PREFERENCES } from './parityConstants';

export type IsometricParityMode = 'visual' | 'reference' | 'reference-base';

export interface CivJsParityFixture {
  tiles: ReferenceParityTile[];
  mapWidth: number;
  mapHeight: number;
  topologyId: number;
  wrapId: number;
  /** Finite board-render fixture retained for strict legacy painter comparison. */
  referenceBoardTopologyId: number;
  viewport: ReferenceRenderViewport;
}

export const waitForStableCanvasFrames = async (page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
};

export const prepareIsometricFixture = async (
  page: Page,
  mode: IsometricParityMode = 'visual',
  dimensions?: { mapWidth: number; mapHeight: number }
): Promise<void> => {
  await page.setViewportSize(PARITY_VIEWPORT);
  await page.addInitScript(preferences => {
    localStorage.setItem('civjs:user-preferences:v2', preferences);
  }, REDUCED_MOTION_PREFERENCES);
  const query = new URLSearchParams({ visual: 'isometric' });
  if (mode !== 'visual') query.set('parity', mode);
  if (dimensions) {
    query.set('mapWidth', String(dimensions.mapWidth));
    query.set('mapHeight', String(dimensions.mapHeight));
  }
  await page.goto(`/test/browser-parity?${query.toString()}`);
  await expect(page.locator('canvas[aria-label="World map"]')).toHaveAttribute(
    'data-renderer-ready',
    'true'
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixture = (window as unknown as { __civjsParityGeometry?: { topologyId?: number } })
          .__civjsParityGeometry;
        return fixture?.topologyId ?? 0;
      })
    )
    .toBe(TOPOLOGY_ISO | TOPOLOGY_HEX);
  await waitForStableCanvasFrames(page);
};

export const hideGameHud = async (page: Page): Promise<void> => {
  await page.locator('[data-game-hud]').evaluate(element => {
    (element as HTMLElement).style.display = 'none';
  });
};

export const readCivJsParityFixture = async (page: Page): Promise<CivJsParityFixture> => {
  const fixture = await page.evaluate(() => {
    const globals = window as unknown as {
      map?: { xsize?: number; ysize?: number; topology_id?: number; wrap_id?: number };
      tiles?: ReferenceParityTile[];
      viewport?: ReferenceRenderViewport;
      __civjsParityGeometry?: { topologyId?: number; wrapId?: number };
    };
    const runtimeGeometry = globals.__civjsParityGeometry;
    return {
      mapWidth: globals.map?.xsize ?? 0,
      mapHeight: globals.map?.ysize ?? 0,
      topologyId: globals.map?.topology_id ?? runtimeGeometry?.topologyId ?? 0,
      wrapId: globals.map?.wrap_id ?? runtimeGeometry?.wrapId ?? 0,
      referenceBoardTopologyId: globals.map?.topology_id ?? 0,
      tiles: globals.tiles ?? [],
      viewport: globals.viewport,
    };
  });

  if (!fixture.mapWidth || !fixture.mapHeight || !fixture.viewport) {
    throw new Error('CivJS parity fixture did not expose map dimensions and viewport');
  }

  return fixture as CivJsParityFixture;
};

export interface MinimapColorParityResult {
  comparedTiles: number;
  mismatches: number;
  rememberedFogTiles: number;
  rememberedFogMismatches: number;
  skippedOffscreenTiles: number;
}

/**
 * Compare Freeciv-web's generated overview palette to CivJS's physically
 * proportioned ISO overview at tile centers. The reference overview does not dim
 * known-but-not-visible terrain; those remembered-fog cells are reported
 * separately instead of being mixed into the terrain palette assertion.
 */
export const compareReferenceOverviewToCivJs = async (
  civJsPage: Page,
  referencePage: Page,
  fixture: CivJsParityFixture
): Promise<MinimapColorParityResult> => {
  const expectedColors = await readReferenceOverviewTileColors(
    referencePage,
    fixture.tiles.map(tile => ({ x: tile.x, y: tile.y }))
  );
  const layout = getMinimapLayout(fixture.mapWidth, fixture.mapHeight, fixture.topologyId);
  const samplePoints = fixture.tiles.map(tile => {
    const origins = getMinimapTileOrigins(
      tile.x,
      tile.y,
      fixture.mapWidth,
      fixture.mapHeight,
      fixture.topologyId,
      fixture.wrapId,
      layout
    );
    const origin = origins.reduce((nearest, candidate) =>
      candidate.x >= 0 &&
      candidate.x < layout.width &&
      candidate.y >= 0 &&
      candidate.y < layout.height
        ? candidate
        : nearest
    );
    return {
      x: Math.floor(origin.x + layout.scaleX),
      y: Math.floor(origin.y + layout.scaleY / 2),
    };
  });
  const actualColors = await civJsPage.evaluate(points => {
    const overlay = document.querySelector('canvas[aria-label^="Minimap overview"]');
    const canvas = overlay?.parentElement?.querySelector('canvas[aria-hidden="true"]');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('CivJS minimap base canvas is unavailable');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return points.map(point => {
      if (point.x < 0 || point.y < 0 || point.x >= canvas.width || point.y >= canvas.height) {
        return null;
      }
      const index = (point.y * canvas.width + point.x) * 4;
      return [pixels[index], pixels[index + 1], pixels[index + 2]] as [number, number, number];
    });
  }, samplePoints);

  let comparedTiles = 0;
  let mismatches = 0;
  let rememberedFogTiles = 0;
  let rememberedFogMismatches = 0;
  let skippedOffscreenTiles = 0;
  fixture.tiles.forEach((tile, index) => {
    const actual = actualColors[index];
    const expected = expectedColors[index];
    if (!actual) {
      skippedOffscreenTiles += 1;
      return;
    }
    comparedTiles += 1;
    const differs = actual.some((channel, channelIndex) => channel !== expected[channelIndex]);
    if (tile.known && !tile.visible) {
      rememberedFogTiles += 1;
      if (differs) rememberedFogMismatches += 1;
      return;
    }
    if (differs) mismatches += 1;
  });

  return {
    comparedTiles,
    mismatches,
    rememberedFogTiles,
    rememberedFogMismatches,
    skippedOffscreenTiles,
  };
};
