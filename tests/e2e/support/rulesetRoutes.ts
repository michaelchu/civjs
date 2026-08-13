import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const rulesetPath = (...parts: string[]) =>
  join(process.cwd(), 'apps/server/src/shared/data/rulesets/civ2civ3', ...parts);

export const installRulesetRoutes = async (page: Page): Promise<void> => {
  const styles = JSON.parse(readFileSync(rulesetPath('styles.json'), 'utf8'));
  const terrain = JSON.parse(readFileSync(rulesetPath('terrain.json'), 'utf8'));
  const units = JSON.parse(readFileSync(rulesetPath('units.json'), 'utf8'));
  const buildings = JSON.parse(readFileSync(rulesetPath('buildings.json'), 'utf8'));
  const extras = JSON.parse(readFileSync(rulesetPath('extras.json'), 'utf8'));
  const nations = JSON.parse(readFileSync(rulesetPath('nations.json'), 'utf8'));

  // Match the configured API origin rather than assuming the development
  // default. Local .env files may point VITE_SERVER_URL at another origin,
  // but these fixture tests should always provide their own ruleset data.
  await page.route('**/api/rulesets/civ2civ3/presentation', route =>
    route.fulfill({
      json: {
        nation_styles: styles.nation_styles,
        city_styles: styles.city_styles,
        music_styles: styles.music_styles,
        terrains: Object.fromEntries(
          Object.entries(terrain.terrains).map(([id, definition]) => [
            id,
            {
              graphic: definition.graphic,
              graphic_alt: definition.graphic_alt,
              graphic_alt2: definition.graphic_alt2,
            },
          ])
        ),
        units: Object.fromEntries(
          Object.entries(units.units).map(([id, definition]) => [
            id,
            { graphic: definition.graphic, graphic_alt: definition.graphic_alt },
          ])
        ),
        buildings: Object.fromEntries(
          Object.entries(buildings.buildings).map(([id, definition]) => [
            id,
            {
              graphic: definition.graphic,
              graphic_alt: definition.graphic_alt,
              graphic_alt2: definition.graphic_alt2,
            },
          ])
        ),
        extras: Object.fromEntries(
          Object.entries(extras.extras).map(([id, definition]) => [
            id,
            { graphic: definition.graphic, graphic_alt: definition.graphic_alt },
          ])
        ),
      },
    })
  );
  await page.route(/\/api\/nations\?ruleset=civ2civ3$/, route =>
    route.fulfill({
      json: {
        success: true,
        data: {
          nations: Object.entries(nations.nations).map(([id, nation]) => ({
            id,
            name: nation.name,
            style: nation.style,
          })),
        },
      },
    })
  );
};
