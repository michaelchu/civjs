import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

const rulesetPath = (...parts: string[]) =>
  join(process.cwd(), 'apps/server/src/shared/data/rulesets/classic', ...parts);

export const installRulesetRoutes = async (page: Page): Promise<void> => {
  const styles = JSON.parse(readFileSync(rulesetPath('styles.json'), 'utf8'));
  const terrain = JSON.parse(readFileSync(rulesetPath('terrain.json'), 'utf8'));
  const units = JSON.parse(readFileSync(rulesetPath('units.json'), 'utf8'));
  const extras = JSON.parse(readFileSync(rulesetPath('extras.json'), 'utf8'));
  const nations = JSON.parse(readFileSync(rulesetPath('nations.json'), 'utf8'));

  await page.route('http://localhost:3001/api/rulesets/classic/presentation', route =>
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
        extras: Object.fromEntries(
          Object.entries(extras.extras).map(([id, definition]) => [
            id,
            { graphic: definition.graphic, graphic_alt: definition.graphic_alt },
          ])
        ),
      },
    })
  );
  await page.route('http://localhost:3001/api/nations?ruleset=classic', route =>
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
