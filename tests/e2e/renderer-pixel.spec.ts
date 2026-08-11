import { expect, test, type Page } from '@playwright/test';
import { installRulesetRoutes } from './support/rulesetRoutes';

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const REDUCED_MOTION_PREFERENCES = JSON.stringify({
  muted: true,
  volume: 0,
  reducedMotion: true,
  disableFogOfWar: false,
  cityReportColumns: ['name', 'status', 'size', 'growth', 'resources', 'economy', 'production'],
  cityWorklistPresets: [],
});

const waitForStableCanvasFrames = async (page: Page) => {
  await page.evaluate(
    () =>
      new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
};

const prepareIsometricFixture = async (page: Page) => {
  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
  await page.addInitScript(preferences => {
    localStorage.setItem('civjs:user-preferences:v2', preferences);
  }, REDUCED_MOTION_PREFERENCES);
  await page.goto('/test/browser-parity?visual=isometric');
  await expect(page.locator('canvas[aria-label="World map"]')).toHaveAttribute(
    'data-renderer-ready',
    'true'
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const fixtureMap = (window as unknown as { map?: { topology_id?: number } }).map;
        return fixtureMap?.topology_id ?? 0;
      })
    )
    .toBe(4);
  await waitForStableCanvasFrames(page);
};

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
    expect(canvasSize).toEqual({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

    // The pixel baseline is for the map renderer only. Keep the real app shell
    // mounted, but remove the custom HUD layer from the clipped canvas region.
    await page.locator('[data-game-hud]').evaluate(element => {
      (element as HTMLElement).style.display = 'none';
    });

    await expect(map).toHaveScreenshot('isometric-world-map.png', {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixels: 0,
    });
  });

  test('matches the isometric minimap orientation and white viewport outline', async ({
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
