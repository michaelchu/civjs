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
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] > 0) opaque += 1;
    }
    return opaque;
  });
  expect(pixels).toBeGreaterThan(1000);

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
