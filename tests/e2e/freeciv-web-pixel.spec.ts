import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  compareCanvasPixels,
  createLogicalIsometricReferenceFixture,
  createRectangularReferenceOverviewFixture,
  getReferenceMinimap,
  readReferenceOverviewPixels,
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
  threshold: 0,
  maxDiffPixels: 0,
};

const renderReferenceFixture = async (
  browser: Browser,
  fixture: Awaited<ReturnType<typeof readCivJsParityFixture>>
): Promise<Page> => {
  const page = await browser.newPage();
  await loadFreecivWebRenderer(page);
  const referenceFixture = createLogicalIsometricReferenceFixture(
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight
  );
  const overviewFixture = createRectangularReferenceOverviewFixture(
    fixture.tiles,
    fixture.mapWidth,
    fixture.mapHeight
  );
  await renderFreecivWebFixture(
    page,
    referenceFixture.tiles,
    referenceFixture.width,
    referenceFixture.height,
    fixture.viewport,
    overviewFixture
  );
  return page;
};

test.beforeEach(async ({ page }) => {
  await installRulesetRoutes(page);
});

test.describe('freeciv-web render-only pixel parity', () => {
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

      const civJsOverviewPixels = await readCanvasPixels(
        page
          .locator('canvas[aria-label^="Minimap overview"]')
          .locator('..')
          .locator('canvas[aria-hidden="true"]')
      );
      const referenceOverviewPixels = await readReferenceOverviewPixels(referencePage);
      // Freeciv-web keeps known-but-not-visible terrain at full palette
      // brightness while CivJS dims that cell. Mask only those known-fog cell
      // rectangles so this assertion remains a strict raster/palette check.
      const normalizedReferenceOverviewPixels = {
        ...referenceOverviewPixels,
        data: [...referenceOverviewPixels.data],
      };
      for (const tile of fixture.tiles) {
        if (!tile.known || tile.visible) continue;
        const xStart = Math.floor((tile.x * referenceOverviewPixels.width) / fixture.mapWidth);
        const xEnd = Math.floor(((tile.x + 1) * referenceOverviewPixels.width) / fixture.mapWidth);
        const yStart = Math.floor((tile.y * referenceOverviewPixels.height) / fixture.mapHeight);
        const yEnd = Math.floor(
          ((tile.y + 1) * referenceOverviewPixels.height) / fixture.mapHeight
        );
        for (let y = yStart; y < yEnd; y += 1) {
          for (let x = xStart; x < xEnd; x += 1) {
            const index = (y * referenceOverviewPixels.width + x) * 4;
            normalizedReferenceOverviewPixels.data[index] = civJsOverviewPixels.data[index];
            normalizedReferenceOverviewPixels.data[index + 1] = civJsOverviewPixels.data[index + 1];
            normalizedReferenceOverviewPixels.data[index + 2] = civJsOverviewPixels.data[index + 2];
            normalizedReferenceOverviewPixels.data[index + 3] = civJsOverviewPixels.data[index + 3];
          }
        }
      }
      const overviewDiff = compareCanvasPixels(
        normalizedReferenceOverviewPixels,
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
      // overview image is a separate raster snapshot, while the tile-center
      // assertion compares its rectangular palette cells with CivJS.
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
      expect(overviewParity.rememberedFogMismatches).toBe(1);
    } finally {
      await referencePage.close();
    }
  });
});
