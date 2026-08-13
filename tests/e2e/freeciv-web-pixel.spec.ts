import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  compareCanvasPixels,
  createRectangularReferenceOverviewFixture,
  getReferenceMinimap,
  readReferenceDisplayedOverviewPixels,
  getReferenceWorldMap,
  loadFreecivWebRenderer,
  readCanvasPixels,
  readReferenceOverviewGeometry,
  readReferenceOverviewTileColors,
  renderFreecivWebFixture,
} from './support/freecivWebRenderHarness';
import {
  compareReferenceOverviewToCivJs,
  createNativeOverviewOracle,
  hideGameHud,
  prepareIsometricFixture,
  readCivJsParityFixture,
} from './support/isometricParityFixture';
import { PARITY_VIEWPORT } from './support/parityConstants';
import { installRulesetRoutes } from './support/rulesetRoutes';
import {
  getMinimapLayout,
  getMinimapViewportPolygons,
  nativeToMinimapPixelPosition,
} from '../../apps/client/src/components/GameUI/minimapGeometry';
import {
  TOPOLOGY_HEX,
  TOPOLOGY_ISO,
} from '../../apps/client/src/components/Canvas2D/mapTopologyGeometry';

const C2C3_TOPOLOGY = TOPOLOGY_ISO | TOPOLOGY_HEX;
const C2C3_WRAP = 3;

const SCREENSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  scale: 'css' as const,
  // The reference atlas is composited by Chromium's canvas implementation.
  // macOS and Linux can differ by a couple of sRGB channel values at sprite
  // edges, so keep the baseline guard tolerant of that rasterization noise.
  // CivJS-vs-reference parity below remains an explicit exact pixel check.
  threshold: 0.01,
  maxDiffPixels: 0,
};

const summarizePixelDiff = (
  expected: Awaited<ReturnType<typeof readCanvasPixels>>,
  actual: Awaited<ReturnType<typeof readCanvasPixels>>
) => {
  const mask = new Uint8Array(expected.width * expected.height);
  const channelCounts = [0, 0, 0, 0];
  const samples: Array<{
    point: [number, number];
    expected: number[];
    actual: number[];
  }> = [];
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      if (expected.data[offset + channel] !== actual.data[offset + channel]) {
        channelCounts[channel] += 1;
      }
    }
    if (
      expected.data[offset] !== actual.data[offset] ||
      expected.data[offset + 1] !== actual.data[offset + 1] ||
      expected.data[offset + 2] !== actual.data[offset + 2] ||
      expected.data[offset + 3] !== actual.data[offset + 3]
    ) {
      mask[pixel] = 1;
      if (samples.length < 20) {
        samples.push({
          point: [pixel % expected.width, Math.floor(pixel / expected.width)],
          expected: expected.data.slice(offset, offset + 4),
          actual: actual.data.slice(offset, offset + 4),
        });
      }
    }
  }

  const seen = new Uint8Array(mask.length);
  const components: Array<{ pixels: number; bounds: [number, number, number, number] }> = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;
    const pending = [start];
    seen[start] = 1;
    let pixels = 0;
    let minX = expected.width;
    let minY = expected.height;
    let maxX = -1;
    let maxY = -1;
    while (pending.length > 0) {
      const current = pending.pop()!;
      const x = current % expected.width;
      const y = Math.floor(current / expected.width);
      pixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const neighborX = x + dx;
        const neighborY = y + dy;
        const neighbor = neighborY * expected.width + neighborX;
        if (
          neighborX >= 0 &&
          neighborX < expected.width &&
          neighborY >= 0 &&
          neighborY < expected.height &&
          mask[neighbor] &&
          !seen[neighbor]
        ) {
          seen[neighbor] = 1;
          pending.push(neighbor);
        }
      }
    }
    components.push({ pixels, bounds: [minX, minY, maxX, maxY] });
  }
  return {
    channelCounts,
    samples,
    components: components.sort((first, second) => second.pixels - first.pixels).slice(0, 20),
  };
};

/**
 * Flatten raw canvas pixels onto the black page behind both map canvases.
 * Freeciv-web does not clear an entirely wrapped first frame, so antialiased
 * sprite edges can retain partial alpha even though their displayed color is
 * already the same as CivJS's explicitly black-backed canvas.
 */
const compositeOnBlack = (
  pixels: Awaited<ReturnType<typeof readCanvasPixels>>
): Awaited<ReturnType<typeof readCanvasPixels>> => {
  const data = [...pixels.data];
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] / 255;
    data[offset] = Math.round(data[offset] * alpha);
    data[offset + 1] = Math.round(data[offset + 1] * alpha);
    data[offset + 2] = Math.round(data[offset + 2] * alpha);
    data[offset + 3] = 255;
  }
  return { ...pixels, data };
};

const renderReferenceFixture = async (
  browser: Browser,
  fixture: Awaited<ReturnType<typeof readCivJsParityFixture>>,
  minimapTopologyId: number,
  minimapWrapId: number
): Promise<Page> => {
  const page = await browser.newPage();
  await loadFreecivWebRenderer(page);
  const overviewFixture = createRectangularReferenceOverviewFixture(
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight
  );
  const physicalLayout = getMinimapLayout(
    fixture.mapWidth,
    fixture.mapHeight,
    minimapTopologyId,
    minimapWrapId
  );
  overviewFixture.displayWidth = physicalLayout.width;
  overviewFixture.displayHeight = physicalLayout.height;
  await renderFreecivWebFixture(
    page,
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight,
    fixture.viewport,
    overviewFixture,
    { topologyId: fixture.referenceBoardTopologyId, wrapId: minimapWrapId },
    fixture.entities,
    fixture.effects
  );
  return page;
};

/** Compare independently evaluated continuous reference geometry. */
const expectContinuousOverviewGeometry = async (
  referencePage: Page,
  fixture: Awaited<ReturnType<typeof readCivJsParityFixture>>,
  topologyId: number,
  wrapId: number
): Promise<void> => {
  const reference = await readReferenceOverviewGeometry(referencePage);
  const layout = getMinimapLayout(fixture.mapWidth, fixture.mapHeight, topologyId, wrapId);
  const actual = getMinimapViewportPolygons(
    fixture.viewport,
    fixture.mapWidth,
    fixture.mapHeight,
    wrapId,
    layout,
    96,
    48,
    topologyId
  );

  expect({ width: reference.width, height: reference.height }).toEqual({
    width: layout.width,
    height: layout.height,
  });
  expect(actual).toHaveLength(reference.polygons.length);
  actual.forEach((polygon, polygonIndex) => {
    expect(polygon).toHaveLength(reference.polygons[polygonIndex].length);
    polygon.forEach((point, pointIndex) => {
      expect(point.x).toBeCloseTo(reference.polygons[polygonIndex][pointIndex].x, 10);
      expect(point.y).toBeCloseTo(reference.polygons[polygonIndex][pointIndex].y, 10);
    });
  });
};

/** Assert that the production overlay raster contains the projected edges. */
const expectCivJsOverviewDrawsPolygons = async (
  page: Page,
  polygons: Array<Array<{ x: number; y: number }>>
): Promise<void> => {
  const overlay = page.locator('canvas[aria-label^="Minimap overview"]');
  const visibleEdges = polygons
    .flatMap(polygon =>
      polygon.map((start, index) => ({
        start,
        end: polygon[(index + 1) % polygon.length],
      }))
    )
    .map(edge => ({
      edge,
      samples: Array.from({ length: 9 }, (_, index) => (index + 1) / 10)
        .map(ratio => ({
          x: edge.start.x + (edge.end.x - edge.start.x) * ratio,
          y: edge.start.y + (edge.end.y - edge.start.y) * ratio,
        }))
        .filter(point => point.x >= 0 && point.x < 288 && point.y >= 0 && point.y < 144),
    }))
    .filter(candidate => candidate.samples.length >= 2);

  expect(visibleEdges.length).toBeGreaterThanOrEqual(2);
  const matches = await overlay.evaluate((canvas: HTMLCanvasElement, candidates) => {
    const context = canvas.getContext('2d');
    if (!context) return [];
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return candidates.map(({ samples }) =>
      samples.reduce((count, sample) => {
        for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
          for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
            const x = Math.round(sample.x) + offsetX;
            const y = Math.round(sample.y) + offsetY;
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
            const pixel = (y * canvas.width + x) * 4;
            if (
              pixels[pixel] === 200 &&
              pixels[pixel + 1] === 200 &&
              pixels[pixel + 2] === 255 &&
              pixels[pixel + 3] > 0
            ) {
              return count + 1;
            }
          }
        }
        return count;
      }, 0)
    );
  }, visibleEdges);

  expect(matches.every((count, index) => count >= visibleEdges[index].samples.length - 1)).toBe(
    true
  );
};

test.beforeEach(async ({ page }) => {
  await installRulesetRoutes(page);
});

test.describe('freeciv-web render-only pixel parity', () => {
  // Rendering the full reference atlas can exceed Playwright's 30s default
  // when the desktop parity workers contend for CPU on GitHub-hosted runners.
  test.describe.configure({ timeout: 60_000 });

  test('compares the CivJS terrain canvas with a headless freeciv-web capture', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference-base');
    await hideGameHud(page);
    const fixture = await readCivJsParityFixture(page);
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      fixture.topologyId,
      fixture.wrapId
    );

    try {
      // This is the reference image, generated at test time by the pinned
      // freeciv-web source and checked against its own baseline.
      await expect(getReferenceWorldMap(referencePage)).toHaveScreenshot(
        'freeciv-web-isometric-terrain-world-map.png',
        SCREENSHOT_OPTIONS
      );
      await expect(getReferenceMinimap(referencePage)).toHaveScreenshot(
        'freeciv-web-isometric-terrain-overview.png',
        SCREENSHOT_OPTIONS
      );

      const civJsOverviewPixels = await readCanvasPixels(
        page
          .locator('canvas[aria-label^="Minimap overview"]')
          .locator('..')
          .locator('canvas[aria-hidden="true"]')
      );
      const overviewDiff = compareCanvasPixels(
        await readReferenceDisplayedOverviewPixels(referencePage),
        civJsOverviewPixels
      );
      expect(overviewDiff).toEqual({
        width: 288,
        height: 144,
        differingPixels: 0,
        totalPixels: 288 * 144,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      await expectContinuousOverviewGeometry(
        referencePage,
        fixture,
        fixture.topologyId,
        fixture.wrapId
      );

      const civJsWorld = compositeOnBlack(
        await readCanvasPixels(page.locator('canvas[aria-label="World map"]'))
      );
      const referenceWorld = compositeOnBlack(
        await readCanvasPixels(getReferenceWorldMap(referencePage))
      );
      const diff = compareCanvasPixels(civJsWorld, referenceWorld);
      if (diff.differingPixels > 0) {
        console.log(
          'Square ISO terrain diff regions:',
          JSON.stringify(summarizePixelDiff(civJsWorld, referenceWorld))
        );
      }
      expect(diff).toEqual({
        width: PARITY_VIEWPORT.width,
        height: PARITY_VIEWPORT.height,
        differingPixels: 0,
        totalPixels: PARITY_VIEWPORT.width * PARITY_VIEWPORT.height,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });
    } finally {
      await referencePage.close();
    }
  });

  test('captures reference feature sprites and compares overview terrain colors', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference');
    await hideGameHud(page);
    const fixture = await readCivJsParityFixture(page);
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      fixture.topologyId,
      fixture.wrapId
    );

    try {
      // Roads, rails, rivers, irrigation, resources, fog, and the reference
      // viewport outline are captured from the actual reference painter. The
      // overview base is compared as a displayed pixel raster; corrected
      // continuous overlay geometry is checked separately below.
      await expect(getReferenceWorldMap(referencePage)).toHaveScreenshot(
        'freeciv-web-isometric-feature-world-map.png',
        SCREENSHOT_OPTIONS
      );
      await expect(getReferenceMinimap(referencePage)).toHaveScreenshot(
        'freeciv-web-isometric-feature-overview.png',
        SCREENSHOT_OPTIONS
      );

      const overviewParity = await compareReferenceOverviewToCivJs(page, referencePage, fixture);
      expect(overviewParity.mismatches).toBe(0);
      expect(overviewParity.comparedTiles).toBeGreaterThan(2000);
      expect(overviewParity.rememberedFogTiles).toBe(1);
      expect(overviewParity.rememberedFogMismatches).toBe(0);

      const displayedReferencePixels = await readReferenceDisplayedOverviewPixels(referencePage);
      const displayedCivJsPixels = await readCanvasPixels(
        page
          .locator('canvas[aria-label^="Minimap overview"]')
          .locator('..')
          .locator('canvas[aria-hidden="true"]')
      );
      expect(compareCanvasPixels(displayedReferencePixels, displayedCivJsPixels)).toEqual({
        width: 288,
        height: 144,
        differingPixels: 0,
        totalPixels: 288 * 144,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      await expectContinuousOverviewGeometry(
        referencePage,
        fixture,
        fixture.topologyId,
        fixture.wrapId
      );

      const referenceWorld = compositeOnBlack(
        await readCanvasPixels(referencePage.locator('#canvas'))
      );
      const civJsWorld = compositeOnBlack(
        await readCanvasPixels(page.locator('canvas[aria-label="World map"]'))
      );
      const worldParity = compareCanvasPixels(referenceWorld, civJsWorld);
      if (worldParity.differingPixels > 0) {
        console.log(
          'Square ISO feature diff regions:',
          JSON.stringify(summarizePixelDiff(referenceWorld, civJsWorld))
        );
      }
      expect(worldParity).toEqual({
        width: PARITY_VIEWPORT.width,
        height: PARITY_VIEWPORT.height,
        differingPixels: 0,
        totalPixels: PARITY_VIEWPORT.width * PARITY_VIEWPORT.height,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });
    } finally {
      await referencePage.close();
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:282-493,674-706,895-1120
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:274-337
   * @assertion Square-isometric cities and units use the pinned Amplio2
   * atlas, offsets, composition, occlusion, city-bar, fog, and overview
   * precedence with no pixel difference from the reference painter.
   */
  test('compares square-isometric city and unit composition with freeciv-web', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference-entities');
    await hideGameHud(page);
    const fixture = await readCivJsParityFixture(page);
    expect(fixture.entities).toBeDefined();
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      fixture.topologyId,
      fixture.wrapId
    );

    try {
      const referenceWorld = await readCanvasPixels(referencePage.locator('#canvas'));
      const civJsWorld = await readCanvasPixels(page.locator('canvas[aria-label="World map"]'));
      const worldParity = compareCanvasPixels(referenceWorld, civJsWorld);
      if (worldParity.differingPixels > 0) {
        console.log(
          'Square ISO entity diff regions:',
          summarizePixelDiff(referenceWorld, civJsWorld)
        );
      }
      expect(worldParity).toEqual({
        width: PARITY_VIEWPORT.width,
        height: PARITY_VIEWPORT.height,
        differingPixels: 0,
        totalPixels: PARITY_VIEWPORT.width * PARITY_VIEWPORT.height,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      const referenceOverview = await readReferenceDisplayedOverviewPixels(referencePage);
      const civJsOverview = await readCanvasPixels(
        page
          .locator('canvas[aria-label^="Minimap overview"]')
          .locator('..')
          .locator('canvas[aria-hidden="true"]')
      );
      const overviewParity = compareCanvasPixels(referenceOverview, civJsOverview);
      if (overviewParity.differingPixels > 0) {
        console.log(
          'Square ISO entity overview diff regions:',
          JSON.stringify(summarizePixelDiff(referenceOverview, civJsOverview))
        );
      }
      expect(overviewParity).toEqual({
        width: 288,
        height: 144,
        differingPixels: 0,
        totalPixels: 288 * 144,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      // Exercise the complete overview-click path after the static oracle:
      // pointer inversion -> direct square-ISO center -> painted board ->
      // independently projected viewport outline.
      await page.locator('[data-game-hud]').evaluate(element => {
        (element as HTMLElement).style.display = '';
      });
      const target = { x: 20, y: 18 };
      const layout = getMinimapLayout(
        fixture.mapWidth,
        fixture.mapHeight,
        fixture.topologyId,
        fixture.wrapId
      );
      const targetPixel = nativeToMinimapPixelPosition(
        target.x,
        target.y,
        layout,
        fixture.topologyId,
        fixture.wrapId
      );
      const overlay = page.locator('canvas[aria-label^="Minimap overview"]');
      await overlay.click({ position: targetPixel });
      await expect
        .poll(() =>
          page.evaluate(() => {
            const globals = window as unknown as {
              viewport?: ReferenceRenderViewport;
              __civjsParityRenderer?: {
                canvasToMap: (
                  x: number,
                  y: number,
                  viewport: ReferenceRenderViewport
                ) => { mapX: number; mapY: number };
              };
            };
            if (!globals.viewport || !globals.__civjsParityRenderer) return null;
            const tile = globals.__civjsParityRenderer.canvasToMap(
              globals.viewport.width / 2,
              globals.viewport.height / 2,
              globals.viewport
            );
            return { x: tile.mapX, y: tile.mapY };
          })
        )
        .toEqual(target);

      await referencePage.evaluate(point => {
        const globals = window as unknown as {
          map_pos_to_tile: (x: number, y: number) => unknown;
          center_tile_mapcanvas_2d: (tile: unknown) => void;
          render_viewrect: () => void;
        };
        globals.center_tile_mapcanvas_2d(globals.map_pos_to_tile(point.x, point.y));
        globals.render_viewrect();
      }, target);
      const centeredFixture = await readCivJsParityFixture(page);
      await expectContinuousOverviewGeometry(
        referencePage,
        centeredFixture,
        centeredFixture.topologyId,
        centeredFixture.wrapId
      );
      await expectCivJsOverviewDrawsPolygons(
        page,
        getMinimapViewportPolygons(
          centeredFixture.viewport,
          centeredFixture.mapWidth,
          centeredFixture.mapHeight,
          centeredFixture.wrapId,
          layout,
          96,
          48,
          centeredFixture.topologyId
        )
      );
    } finally {
      await referencePage.close();
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:720-728,1001-1018
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-423,477-487
   * @assertion The first square-ISO combat and nuclear redraw uses the same
   * native Amplio2 sprite, offset, layer, and single packet anchor.
   */
  test('compares square-isometric transient effect pixels with freeciv-web', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference-effects');
    await hideGameHud(page);
    const fixture = await readCivJsParityFixture(page);
    expect(fixture.effects).toBeDefined();
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      fixture.topologyId,
      fixture.wrapId
    );

    try {
      const referenceWorld = await readCanvasPixels(referencePage.locator('#canvas'));
      const civJsWorld = await readCanvasPixels(page.locator('canvas[aria-label="World map"]'));
      const worldParity = compareCanvasPixels(referenceWorld, civJsWorld);
      if (worldParity.differingPixels > 0) {
        console.log(
          'Square ISO transient-effect diff regions:',
          summarizePixelDiff(referenceWorld, civJsWorld)
        );
      }
      expect(worldParity).toEqual({
        width: PARITY_VIEWPORT.width,
        height: PARITY_VIEWPORT.height,
        differingPixels: 0,
        totalPixels: PARITY_VIEWPORT.width * PARITY_VIEWPORT.height,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });
    } finally {
      await referencePage.close();
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:136-179,266-450
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:215-219
   * @assertion The square-ISO painter resolves terrain, fog, roads, labels,
   * borders, and overview geometry continuously across an X-wrapped seam with
   * exactly the same final pixels as the pinned browser client.
   */
  test('compares the wrapped square-isometric seam with freeciv-web', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference-wrapped');
    await hideGameHud(page);
    const fixture = await readCivJsParityFixture(page);
    expect(fixture.topologyId).toBe(TOPOLOGY_ISO);
    expect(fixture.wrapId).toBe(1);
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      fixture.topologyId,
      fixture.wrapId
    );

    try {
      const referenceWorld = await readCanvasPixels(referencePage.locator('#canvas'));
      const civJsWorld = await readCanvasPixels(page.locator('canvas[aria-label="World map"]'));
      const displayedReferenceWorld = compositeOnBlack(referenceWorld);
      const displayedCivJsWorld = compositeOnBlack(civJsWorld);
      const worldParity = compareCanvasPixels(displayedReferenceWorld, displayedCivJsWorld);
      if (worldParity.differingPixels > 0) {
        console.log(
          'Square ISO wrapped-seam diff regions:',
          JSON.stringify(summarizePixelDiff(displayedReferenceWorld, displayedCivJsWorld))
        );
      }
      expect(worldParity).toEqual({
        width: PARITY_VIEWPORT.width,
        height: PARITY_VIEWPORT.height,
        differingPixels: 0,
        totalPixels: PARITY_VIEWPORT.width * PARITY_VIEWPORT.height,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      const referenceOverview = await readReferenceDisplayedOverviewPixels(referencePage);
      const civJsOverview = await readCanvasPixels(
        page
          .locator('canvas[aria-label^="Minimap overview"]')
          .locator('..')
          .locator('canvas[aria-hidden="true"]')
      );
      expect(compareCanvasPixels(referenceOverview, civJsOverview)).toEqual({
        width: 288,
        height: 144,
        differingPixels: 0,
        totalPixels: 288 * 144,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });
      await expectContinuousOverviewGeometry(
        referencePage,
        fixture,
        fixture.topologyId,
        fixture.wrapId
      );
    } finally {
      await referencePage.close();
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/client/overview_common.c:51-79
   * @reference reference/freeciv/client/overview_common.c:450-483
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:139-158
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:194-275
   * @assertion A 32x64 C2C3 map produces a square native 2x1 overview with
   * exact reference palette colors, wrapped continuous camera geometry, and
   * no independently stretched axes or integer-corner drift.
   */
  test('keeps non-square native ISO data square after physical overview scaling', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'native-reference', { mapWidth: 32, mapHeight: 64 });
    const fixture = await readCivJsParityFixture(page);
    const runtimeTopologyId = C2C3_TOPOLOGY;
    const runtimeWrapId = C2C3_WRAP;
    const referencePage = await renderReferenceFixture(
      browser,
      fixture,
      runtimeTopologyId,
      runtimeWrapId
    );

    try {
      const civJsBase = page
        .locator('canvas[aria-label^="Minimap overview"]')
        .locator('..')
        .locator('canvas[aria-hidden="true"]');
      await expect(civJsBase).toHaveAttribute('width', '256');
      await expect(civJsBase).toHaveAttribute('height', '256');

      const referenceOverview = getReferenceMinimap(referencePage);
      await expect(referenceOverview).toHaveCSS('width', '256px');
      await expect(referenceOverview).toHaveCSS('height', '256px');

      const runtimeFixture = {
        ...fixture,
        topologyId: runtimeTopologyId,
        wrapId: runtimeWrapId,
      };
      const referenceColors = await readReferenceOverviewTileColors(
        referencePage,
        runtimeFixture.tiles.map(tile => ({ x: tile.x, y: tile.y }))
      );
      const nativeOracle = createNativeOverviewOracle(runtimeFixture, referenceColors);
      const displayedCivJsPixels = await readCanvasPixels(civJsBase);
      expect(compareCanvasPixels(nativeOracle, displayedCivJsPixels)).toEqual({
        width: 256,
        height: 256,
        differingPixels: 0,
        totalPixels: 256 * 256,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      const polygons = getMinimapViewportPolygons(
        runtimeFixture.viewport,
        runtimeFixture.mapWidth,
        runtimeFixture.mapHeight,
        runtimeWrapId,
        getMinimapLayout(
          runtimeFixture.mapWidth,
          runtimeFixture.mapHeight,
          runtimeTopologyId,
          runtimeWrapId
        ),
        126,
        64,
        runtimeTopologyId
      );
      expect(polygons).toHaveLength(9);
      expect(polygons[0][0].x).not.toBe(polygons[0][1].x);
      expect(polygons[0][0].y).not.toBe(polygons[0][3].y);
    } finally {
      await referencePage.close();
    }
  });
});
