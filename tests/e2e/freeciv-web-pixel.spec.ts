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
  renderFreecivWebFixture,
} from './support/freecivWebRenderHarness';
import {
  compareReferenceOverviewToCivJs,
  hideGameHud,
  prepareIsometricFixture,
  readCivJsParityFixture,
} from './support/isometricParityFixture';
import { PARITY_VIEWPORT } from './support/parityConstants';
import { installRulesetRoutes } from './support/rulesetRoutes';
import {
  getMinimapLayout,
  getMinimapViewportPolygons,
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
  const physicalLayout = getMinimapLayout(fixture.mapWidth, fixture.mapHeight, minimapTopologyId);
  overviewFixture.displayWidth = physicalLayout.width;
  overviewFixture.displayHeight = physicalLayout.height;
  await renderFreecivWebFixture(
    page,
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight,
    fixture.viewport,
    overviewFixture,
    { topologyId: fixture.referenceBoardTopologyId, wrapId: minimapWrapId }
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
  const layout = getMinimapLayout(fixture.mapWidth, fixture.mapHeight, topologyId);
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

      const diff = compareCanvasPixels(
        await readCanvasPixels(page.locator('canvas[aria-label="World map"]')),
        await readCanvasPixels(getReferenceWorldMap(referencePage))
      );
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

      const worldParity = compareCanvasPixels(
        await readCanvasPixels(referencePage.locator('#canvas')),
        await readCanvasPixels(page.locator('canvas[aria-label="World map"]'))
      );
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
   * @reference reference/freeciv/client/overview_common.c:51-79
   * @reference reference/freeciv/client/overview_common.c:450-483
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:139-158
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:194-275
   * @assertion A 32x64 C2C3 map produces a square physical overview with exact
   * reference palette pixels, wrapped continuous camera geometry, and no
   * independently stretched axes or integer-corner drift.
   */
  test('keeps non-square native ISO data square after physical overview scaling', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference', { mapWidth: 32, mapHeight: 64 });
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
      const overviewParity = await compareReferenceOverviewToCivJs(
        page,
        referencePage,
        runtimeFixture
      );
      expect(overviewParity.mismatches).toBe(0);
      expect(overviewParity.skippedOffscreenTiles).toBe(0);

      const displayedReferencePixels = await readReferenceDisplayedOverviewPixels(referencePage);
      const displayedCivJsPixels = await readCanvasPixels(civJsBase);
      expect(compareCanvasPixels(displayedReferencePixels, displayedCivJsPixels)).toEqual({
        width: 256,
        height: 256,
        differingPixels: 0,
        totalPixels: 256 * 256,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      await expectContinuousOverviewGeometry(
        referencePage,
        runtimeFixture,
        runtimeTopologyId,
        runtimeWrapId
      );
    } finally {
      await referencePage.close();
    }
  });
});
