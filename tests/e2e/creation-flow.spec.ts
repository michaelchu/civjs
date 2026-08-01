import { expect, test } from '@playwright/test';
import { installRulesetRoutes } from './support/rulesetRoutes';

test('game creation is responsive and reports ruleset loading failures', async ({ page }) => {
  await installRulesetRoutes(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Start New Game/ }).click();
  await expect(page.getByText('Create New Game', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Your Name')).toHaveCount(0);
  await expect(page.getByLabel('Game Name')).toBeVisible();
});

test('game creation exposes an actionable validation error when nations fail', async ({ page }) => {
  await page.route('http://localhost:3001/api/nations?ruleset=classic', route =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } })
  );
  await page.goto('/create-game');
  await expect(page.getByText('Failed to load nations. Please refresh the page.')).toBeVisible();
});
