import { expect, test } from '@playwright/test';
import { hideGameHud, prepareIsometricFixture } from './support/isometricParityFixture';
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

  test('matches the physical-aspect minimap raster and isometric viewport outline', async ({
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

  test('keeps a minimap click, board camera, and viewport outline on one tile', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Canvas interaction is desktop-only.');
    await prepareIsometricFixture(page, 'visual', { mapWidth: 32, mapHeight: 64 });

    const overlay = page.locator('canvas[aria-label^="Minimap overview"]');
    await expect(overlay).toHaveAttribute('width', '256');
    await expect(overlay).toHaveAttribute('height', '256');

    const target = { x: 21, y: 37 };
    const targetPixel = {
      x: ((target.x + 0.5) / 32) * 256,
      y: ((target.y + 0.5) / 64) * 256,
    };
    await overlay.click({ position: targetPixel });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const globals = window as unknown as {
            viewport?: { x: number; y: number; width: number; height: number };
          };
          const viewport = globals.viewport;
          if (!viewport) return null;
          const tileWidth = 96;
          const tileHeight = 48;
          const adjustedX = viewport.x + viewport.width / 2 - tileWidth / 2;
          const guiY = viewport.y + viewport.height / 2;
          return {
            x: Math.floor((adjustedX * tileHeight + guiY * tileWidth) / (tileWidth * tileHeight)),
            y: Math.floor((guiY * tileWidth - adjustedX * tileHeight) / (tileWidth * tileHeight)),
          };
        })
      )
      .toEqual(target);

    const viewport = await page.evaluate(() => {
      const globals = window as unknown as {
        viewport?: { x: number; y: number; width: number; height: number };
      };
      if (!globals.viewport) throw new Error('Fixture viewport is unavailable');
      return globals.viewport;
    });
    const topologyId = TOPOLOGY_ISO | TOPOLOGY_HEX;
    const layout = getMinimapLayout(32, 64, topologyId);
    const polygons = getMinimapViewportPolygons(viewport, 32, 64, 3, layout, 96, 48, topologyId);
    const polygonCenters = polygons.map(polygon => ({
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
      polygon,
    }));
    const targetPolygon = polygonCenters.reduce((nearest, candidate) =>
      Math.hypot(candidate.x - targetPixel.x, candidate.y - targetPixel.y) <
      Math.hypot(nearest.x - targetPixel.x, nearest.y - targetPixel.y)
        ? candidate
        : nearest
    );
    expect(targetPolygon.x).toBeCloseTo(targetPixel.x, 0);
    expect(targetPolygon.y).toBeCloseTo(targetPixel.y, 0);

    const visibleEdges = targetPolygon.polygon
      .map((start, index, polygon) => ({
        start,
        end: polygon[(index + 1) % polygon.length],
      }))
      .filter(
        edge =>
          edge.start.x >= 0 &&
          edge.start.x < layout.width &&
          edge.start.y >= 0 &&
          edge.start.y < layout.height &&
          edge.end.x >= 0 &&
          edge.end.x < layout.width &&
          edge.end.y >= 0 &&
          edge.end.y < layout.height
      );
    expect(visibleEdges.length).toBeGreaterThanOrEqual(2);

    const edgeMatches = await overlay.evaluate((canvas: HTMLCanvasElement, edges) => {
      const context = canvas.getContext('2d');
      if (!context) return [];
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      return edges.map(edge => {
        const samples = [0.25, 0.5, 0.75].map(ratio => ({
          x: edge.start.x + (edge.end.x - edge.start.x) * ratio,
          y: edge.start.y + (edge.end.y - edge.start.y) * ratio,
        }));
        let matchedSamples = 0;
        for (const sample of samples) {
          let found = false;
          for (let offsetY = -2; offsetY <= 2; offsetY += 1) {
            for (let offsetX = -2; offsetX <= 2; offsetX += 1) {
              const x = Math.round(sample.x) + offsetX;
              const y = Math.round(sample.y) + offsetY;
              if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
              const index = (y * canvas.width + x) * 4;
              if (
                pixels[index] === 200 &&
                pixels[index + 1] === 200 &&
                pixels[index + 2] === 255 &&
                pixels[index + 3] > 0
              ) {
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (found) matchedSamples += 1;
        }
        return matchedSamples;
      });
    }, visibleEdges);

    expect(edgeMatches.every(matches => matches >= 2)).toBe(true);
  });
});
