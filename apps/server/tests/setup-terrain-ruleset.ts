/**
 * Shared test setup for terrain ruleset tests
 * Import this in any test file that uses terrain-related functionality
 */

import { rulesetLoader } from '@game/map/TerrainRuleset';

export function setupTerrainRuleset(): void {
  // No setup needed - terrain rulesets are loaded synchronously on first access
}

export function cleanupTerrainRuleset(): void {
  // Clear cache to ensure clean state between tests
  rulesetLoader.clearCache();
}

// Global setup that runs before all tests
beforeAll(() => {
  setupTerrainRuleset();
});

// Global cleanup that runs after all tests
afterAll(() => {
  cleanupTerrainRuleset();
});
