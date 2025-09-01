/**
 * Shared test setup for initializing terrain ruleset
 * Import this in any test file that uses terrain-related functionality
 */

import { initializeTerrainRuleset, resetTerrainRuleset } from '../src/game/map/TerrainRuleset';

export async function setupTerrainRuleset(): Promise<void> {
  await initializeTerrainRuleset('classic');
}

export function cleanupTerrainRuleset(): void {
  resetTerrainRuleset();
}

// Global setup that runs before all tests
beforeAll(async () => {
  await setupTerrainRuleset();
});

// Global cleanup that runs after all tests
afterAll(() => {
  cleanupTerrainRuleset();
});
