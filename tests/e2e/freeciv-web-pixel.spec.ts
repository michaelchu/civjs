import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  compareCanvasPixels,
  createRectangularReferenceOverviewFixture,
  getReferenceMinimap,
  readReferenceDisplayedOverviewPixels,
  getReferenceWorldMap,
  loadFreecivWebRenderer,
  readCanvasPixels,
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
  fixture: Awaited<ReturnType<typeof readCivJsParityFixture>>
): Promise<Page> => {
  const page = await browser.newPage();
  await loadFreecivWebRenderer(page);
  const overviewFixture = createRectangularReferenceOverviewFixture(
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight
  );
  await renderFreecivWebFixture(
    page,
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight,
    fixture.viewport,
    overviewFixture
  );
  return page;
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
    const referencePage = await renderReferenceFixture(browser, fixture);

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
        width: 240,
        height: 240,
        differingPixels: 0,
        totalPixels: 240 * 240,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      expect(
        compareCanvasPixels(
          await readCanvasPixels(referencePage.locator('#overview_viewrect')),
          await readCanvasPixels(
            page
              .locator('canvas[aria-label^="Minimap overview"]')
              .locator('..')
              .locator('canvas[aria-label^="Minimap overview"]')
          )
        )
      ).toEqual({
        width: 240,
        height: 240,
        differingPixels: 0,
        totalPixels: 240 * 240,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

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
    const referencePage = await renderReferenceFixture(browser, fixture);

    try {
      // Roads, rails, rivers, irrigation, resources, fog, and the reference
      // viewport outline are captured from the actual reference painter. The
      // overview base and overlay are compared as displayed pixel rasters.
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
        width: 240,
        height: 240,
        differingPixels: 0,
        totalPixels: 240 * 240,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      expect(
        compareCanvasPixels(
          await readCanvasPixels(referencePage.locator('#overview_viewrect')),
          await readCanvasPixels(
            page
              .locator('canvas[aria-label^="Minimap overview"]')
              .locator('..')
              .locator('canvas[aria-label^="Minimap overview"]')
          )
        )
      ).toEqual({
        width: 240,
        height: 240,
        differingPixels: 0,
        totalPixels: 240 * 240,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

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

  test('keeps non-square ISO overview raster and overlay pixels aligned with freeciv-web', async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel parity is desktop-only.');
    await prepareIsometricFixture(page, 'reference', { mapWidth: 32, mapHeight: 64 });
    const fixture = await readCivJsParityFixture(page);
    const referencePage = await renderReferenceFixture(browser, fixture);

    try {
      const civJsBase = page
        .locator('canvas[aria-label^="Minimap overview"]')
        .locator('..')
        .locator('canvas[aria-hidden="true"]');
      await expect(civJsBase).toHaveAttribute('width', '224');
      await expect(civJsBase).toHaveAttribute('height', '300');

      const referenceOverview = getReferenceMinimap(referencePage);
      await expect(referenceOverview).toHaveCSS('width', '224px');
      await expect(referenceOverview).toHaveCSS('height', '300px');

      const overviewParity = await compareReferenceOverviewToCivJs(page, referencePage, fixture);
      expect(overviewParity.mismatches).toBe(0);
      expect(overviewParity.skippedOffscreenTiles).toBe(0);

      const displayedReferencePixels = await readReferenceDisplayedOverviewPixels(referencePage);
      const displayedCivJsPixels = await readCanvasPixels(civJsBase);
      expect(compareCanvasPixels(displayedReferencePixels, displayedCivJsPixels)).toEqual({
        width: 224,
        height: 300,
        differingPixels: 0,
        totalPixels: 224 * 300,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });

      expect(
        compareCanvasPixels(
          await readCanvasPixels(referencePage.locator('#overview_viewrect')),
          await readCanvasPixels(
            page
              .locator('canvas[aria-label^="Minimap overview"]')
              .locator('..')
              .locator('canvas[aria-label^="Minimap overview"]')
          )
        )
      ).toEqual({
        width: 224,
        height: 300,
        differingPixels: 0,
        totalPixels: 224 * 300,
        maxChannelDelta: 0,
        meanChannelDelta: 0,
      });
    } finally {
      await referencePage.close();
    }
  });
});
