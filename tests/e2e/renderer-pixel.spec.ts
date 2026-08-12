import { expect, test } from '@playwright/test';
import { hideGameHud, prepareIsometricFixture } from './support/isometricParityFixture';
import { PARITY_VIEWPORT } from './support/parityConstants';
import { installRulesetRoutes } from './support/rulesetRoutes';

test.beforeEach(async ({ page }) => {
  await installRulesetRoutes(page);
});

test.describe('isometric map pixel parity', () => {
  test('matches the deterministic isometric world-map rendering', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel baselines are desktop-only.');
    await prepareIsometricFixture(page);

    const map = page.locator('canvas[aria-label="World map"]');
    const canvasSize = await map.evaluate((canvas: HTMLCanvasElement) => ({
      width: canvas.width,
      height: canvas.height,
    }));
    expect(canvasSize).toEqual(PARITY_VIEWPORT);

    // The pixel baseline is for the map renderer only. Keep the real app shell
    // mounted, but remove the custom HUD layer from the clipped canvas region.
    await hideGameHud(page);

    await expect(map).toHaveScreenshot('isometric-world-map.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
    });
  });

  test('matches the rectangular minimap raster and isometric viewport outline', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Pixel baselines are desktop-only.');
    await prepareIsometricFixture(page);

    const overlay = page.locator('canvas[aria-label^="Minimap overview"]');
    await expect
      .poll(() =>
        overlay.evaluate((canvas: HTMLCanvasElement) => {
          const context = canvas.getContext('2d');
          if (!context) return 0;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let outlinePixels = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index] === 200 &&
              pixels[index + 1] === 200 &&
              pixels[index + 2] === 255 &&
              pixels[index + 3] > 0
            ) {
              outlinePixels += 1;
            }
          }
          return outlinePixels;
        })
      )
      .toBeGreaterThan(8);

    const outlineShape = await overlay.evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (!context) return null;
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const points: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const index = (y * canvas.width + x) * 4;
          if (
            pixels[index] === 200 &&
            pixels[index + 1] === 200 &&
            pixels[index + 2] === 255 &&
            pixels[index + 3] > 0
          ) {
            points.push({ x, y });
          }
        }
      }

      const rowCounts = new Map<number, number>();
      const columnCounts = new Map<number, number>();
      for (const point of points) {
        rowCounts.set(point.y, (rowCounts.get(point.y) ?? 0) + 1);
        columnCounts.set(point.x, (columnCounts.get(point.x) ?? 0) + 1);
      }
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);
      return {
        count: points.length,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        maxRowCount: Math.max(...rowCounts.values()),
        maxColumnCount: Math.max(...columnCounts.values()),
      };
    });

    expect(outlineShape).not.toBeNull();
    expect(outlineShape!.count).toBeGreaterThan(8);
    expect(outlineShape!.width).toBeGreaterThan(20);
    expect(outlineShape!.height).toBeGreaterThan(20);
    // A projected ISO footprint has sloped/parallelogram edges rather than a
    // long axis-aligned rectangle edge in either direction.
    expect(outlineShape!.maxRowCount).toBeLessThan(outlineShape!.width * 0.75);
    expect(outlineShape!.maxColumnCount).toBeLessThan(outlineShape!.height * 0.75);

    const minimap = overlay.locator('..');
    await expect(minimap).toHaveScreenshot('isometric-minimap.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
    });
  });
});
