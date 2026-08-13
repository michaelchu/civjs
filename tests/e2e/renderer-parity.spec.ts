import { expect, test } from '@playwright/test';
import { installRulesetRoutes } from './support/rulesetRoutes';

test.beforeEach(async ({ page }) => {
  await installRulesetRoutes(page);
});

test('renders the authoritative Civ2Civ3 presentation and supported game screens', async ({
  page,
}, testInfo) => {
  await page.goto('/test/browser-parity');

  const map = page.locator('canvas[aria-label="World map"]');
  await expect(map).toHaveAttribute('data-renderer-ready', 'true');
  await expect
    .poll(() => page.locator('html').getAttribute('data-music-theme'))
    .toBe('music_asian_peace');

  const pixels = await map.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    const colors = new Set<string>();
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) opaque += 1;
      if (data[index] > 0) {
        colors.add(`${data[index - 3]},${data[index - 2]},${data[index - 1]}`);
      }
    }
    return { opaque, colors: colors.size };
  });
  expect(pixels.opaque).toBeGreaterThan(1000);
  expect(pixels.colors).toBeGreaterThan(8);

  await page.getByRole('button', { name: /Empire report/ }).click();
  await expect(page.getByText('Kyoto')).toBeVisible();
  await page.keyboard.press('F6');
  await expect(page.getByRole('heading', { name: 'Game information' })).toBeVisible();

  await page.getByLabel('Reduce interface motion').check();
  await expect(page.locator('html')).toHaveClass(/reduce-motion/);

  await page.screenshot({
    path: testInfo.outputPath('civ2civ3-parity.png'),
    animations: 'disabled',
    fullPage: true,
  });
});

test('loads the sprite contract required by the active board renderers', async ({ page }) => {
  const manifestResponse = page.waitForResponse(
    response =>
      response.url().endsWith('/tilesets/hexemplio/manifest.json') && response.status() === 200
  );
  await page.goto('/test/browser-parity');
  await expect(page.locator('canvas[aria-label="World map"]')).toHaveAttribute(
    'data-renderer-ready',
    'true'
  );

  const requiredTags = [
    'u.warriors',
    'u.worker',
    'unit.select:0',
    'unit.select:1',
    'unit.select:2',
    'unit.select:3',
    'unit.fortified',
    'unit.sentry',
    'unit.goto',
    'unit.road',
    'unit.irrigate',
    'unit.connect',
    'unit.stack',
    'unit.hp_50',
    'unit.vet_2',
    'city.asian_city_0',
    'city.asian_wall_3',
    'road.road_n:0',
    'road.rail_n0e0se0s0w0nw0:0',
    'road.river_s_n0e0se0s0w0nw0:0',
    'road.river_s_n1e1se1s1w1nw1:0',
    'road.river_outlet_n:0',
    'road.river_outlet_w:0',
    'tx.darkness_n',
    'explode.unit_0',
    'explode.unit_4',
    'explode.nuke',
    'f.shield.rome',
  ];
  const contract = await page.evaluate(tags => {
    const globals = window as unknown as {
      __civjsParityRenderer?: {
        tilesetLoader?: {
          metadata?: { id?: string; format?: string; topologyId?: number };
          getGeometry?: () => Record<string, number>;
          getTopologyCompatibility?: (topologyId: number) => string;
          hasSprite?: (tag: string) => boolean;
        };
      };
    };
    const provider = globals.__civjsParityRenderer?.tilesetLoader;
    return {
      id: provider?.metadata?.id,
      format: provider?.metadata?.format,
      topologyId: provider?.metadata?.topologyId,
      compatibility: provider?.getTopologyCompatibility?.(3),
      geometry: provider?.getGeometry?.(),
      missing: tags.filter(tag => !provider?.hasSprite?.(tag)),
    };
  }, requiredTags);

  expect(contract).toEqual({
    id: 'hexemplio',
    format: 'freeciv',
    topologyId: 3,
    compatibility: 'exact',
    geometry: {
      tileWidth: 126,
      tileHeight: 64,
      fullTileWidth: 126,
      fullTileHeight: 96,
      hexWidth: 16,
      hexHeight: 0,
    },
    missing: [],
  });

  const manifest = (await (await manifestResponse).json()) as {
    schemaVersion?: number;
    topologyId?: number;
    sourceRevision?: string;
    preloadImages?: unknown[];
    sprites?: Record<string, { x?: number; y?: number; width?: number; height?: number }>;
  };
  const malformed = Object.entries(manifest.sprites ?? {})
    .filter(([, rectangle]) =>
      [rectangle.x, rectangle.y, rectangle.width, rectangle.height].some(
        value => typeof value !== 'number' || !Number.isFinite(value) || value < 0
      )
    )
    .map(([tag]) => tag);
  expect(manifest.schemaVersion).toBe(2);
  expect(manifest.topologyId).toBe(3);
  expect(manifest.sourceRevision).toBe('eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc');
  expect(manifest.preloadImages).toHaveLength(37);
  expect(Object.keys(manifest.sprites ?? {})).toHaveLength(3263);
  expect(malformed).toEqual([]);
});

test('supports keyboard navigation across the player-visible surface', async ({ page }) => {
  await page.goto('/test/browser-parity');
  await page.keyboard.press('F2');
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Government' }).first()
  ).toBeVisible();
  await expect(
    page.getByText('Representative government with strong trade and limited corruption.')
  ).toBeVisible();
  await page.keyboard.press('F3');
  await expect(page.getByText('Writing', { exact: true }).first()).toBeVisible();
  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: 'Nations & diplomacy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Romans' })).toBeVisible();
  await page.keyboard.press('F5');
  await expect(page.getByText('Kyoto')).toBeVisible();
  await page.keyboard.press('F6');
  await expect(page.getByRole('heading', { name: 'Game information' })).toBeVisible();
  await page.keyboard.press('F1');
  await expect(page.locator('canvas[aria-label="World map"]')).toBeVisible();
});

test('presents the authoritative end-game report accessibly', async ({ page }) => {
  await page.goto('/test/browser-parity?state=endgame');

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Victory' })).toBeFocused();
  await expect(dialog.getByRole('row', { name: /Japanese 320/ })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Return to game list' })).toBeVisible();
});
