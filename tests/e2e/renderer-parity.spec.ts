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
  await page.goto('/test/browser-parity');
  await expect(page.locator('canvas[aria-label="World map"]')).toHaveAttribute(
    'data-renderer-ready',
    'true'
  );

  const requiredTags = [
    'u.warriors',
    'u.worker',
    'unit.select0',
    'unit.select1',
    'unit.select2',
    'unit.select3',
    'unit.fortified',
    'unit.sentry',
    'unit.goto',
    'unit.road',
    'unit.irrigate',
    'unit.connect',
    'unit.stack2',
    'unit.hp_50',
    'unit.vet_2',
    'city.asian_city_0',
    'city.asian_wall_3',
    'road.road_n',
    'road.rail_n',
    'road.river_s_n0e0s0w0',
    'road.river_s_n1e1s1w1',
    'road.river_outlet_n',
    'road.river_outlet_w',
    'tx.fog',
    'explode.unit_0',
    'explode.unit_4',
    'swords.unit_0',
    'swords.unit_7',
    'explode.nuke',
    'grid.usermark',
    'f.shield.rome',
  ];
  const contract = await page.evaluate(tags => {
    const globals = window as unknown as {
      tileset?: Record<string, unknown>;
      tileset_tile_width?: number;
      tileset_tile_height?: number;
      tileset_image_count?: number;
      is_isometric?: number;
    };
    const spec = globals.tileset ?? {};
    const missing = tags.filter(tag => !(tag in spec));
    const malformed = tags.filter(tag => {
      const definition = spec[tag];
      return (
        !Array.isArray(definition) ||
        definition.length !== 5 ||
        definition.some(value => typeof value !== 'number' || !Number.isFinite(value))
      );
    });
    return {
      missing,
      malformed,
      tileWidth: globals.tileset_tile_width,
      tileHeight: globals.tileset_tile_height,
      imageCount: globals.tileset_image_count,
      isometric: globals.is_isometric,
    };
  }, requiredTags);

  expect(contract).toEqual({
    missing: [],
    malformed: [],
    tileWidth: 96,
    tileHeight: 48,
    imageCount: 3,
    isometric: 1,
  });
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
