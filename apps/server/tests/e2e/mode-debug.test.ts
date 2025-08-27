/**
 * Debug test to verify all map generation modes have scale mismatch issues
 */

import { MapManager } from '../../src/game/MapManager';
import { logger } from '../../src/utils/logger';

// Mock player data for testing
const createTestPlayers = (count: number = 4) => {
  const players = new Map();
  for (let i = 0; i < count; i++) {
    players.set(`player_${i}`, { id: `player_${i}` });
  }
  return players;
};

describe('All Map Modes Debug', () => {
  describe('Scale Mismatch Investigation', () => {
    test('RANDOM Mode - Height vs Shore Level Scale Check', async () => {
      const width = 40;
      const height = 25;
      const seed = '1';
      const players = createTestPlayers(4);

      const mapManager = new MapManager(width, height, seed, 'random');

      logger.info('=== TESTING RANDOM MODE ===', {
        width,
        height,
        seed,
        playerCount: players.size,
      });

      await mapManager.generateMap(players, 'RANDOM');

      const mapData = mapManager.getMapData();
      expect(mapData).not.toBeNull();

      if (mapData) {
        // Count terrain types
        let oceanCount = 0;
        let landCount = 0;
        const terrainCounts: Record<string, number> = {};

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const terrain = mapData.tiles[x][y].terrain;
            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;

            if (terrain === 'ocean' || terrain === 'deep_ocean') {
              oceanCount++;
            } else {
              landCount++;
            }
          }
        }

        const totalTiles = width * height;
        const oceanPercentage = (oceanCount / totalTiles) * 100;
        const landPercentage = (landCount / totalTiles) * 100;

        logger.info('=== RANDOM MODE TERRAIN DISTRIBUTION ===', {
          totalTiles,
          oceanCount,
          landCount,
          oceanPercentage: Math.round(oceanPercentage * 10) / 10,
          landPercentage: Math.round(landPercentage * 10) / 10,
          terrainCounts,
        });

        // SUCCESS: Fixed Random Mode ocean generation! Now hitting target 30% land!
        console.log(`RANDOM Mode Result: ${Math.round(landPercentage * 10) / 10}% land`);

        // Validate Random Mode is working (25-35% target range)
        expect(landPercentage).toBeGreaterThan(25);
        expect(landPercentage).toBeLessThan(35);
      }
    });

    test('FRACTAL Mode - Height vs Shore Level Scale Check', async () => {
      const width = 40;
      const height = 25;
      const seed = '1';
      const players = createTestPlayers(4);

      const mapManager = new MapManager(width, height, seed, 'fractal');

      logger.info('=== TESTING FRACTAL MODE ===', {
        width,
        height,
        seed,
        playerCount: players.size,
      });

      await mapManager.generateMap(players, 'FRACTAL');

      const mapData = mapManager.getMapData();
      expect(mapData).not.toBeNull();

      if (mapData) {
        // Count terrain types
        let oceanCount = 0;
        let landCount = 0;
        const terrainCounts: Record<string, number> = {};

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const terrain = mapData.tiles[x][y].terrain;
            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;

            if (terrain === 'ocean' || terrain === 'deep_ocean') {
              oceanCount++;
            } else {
              landCount++;
            }
          }
        }

        const totalTiles = width * height;
        const oceanPercentage = (oceanCount / totalTiles) * 100;
        const landPercentage = (landCount / totalTiles) * 100;

        logger.info('=== FRACTAL MODE TERRAIN DISTRIBUTION ===', {
          totalTiles,
          oceanCount,
          landCount,
          oceanPercentage: Math.round(oceanPercentage * 10) / 10,
          landPercentage: Math.round(landPercentage * 10) / 10,
          terrainCounts,
        });

        // Document the current state (don't assert yet)
        console.log(`FRACTAL Mode Result: ${Math.round(landPercentage * 10) / 10}% land`);
      }
    });

    test('FRACTURE Mode - Height vs Shore Level Scale Check', async () => {
      const width = 40;
      const height = 25;
      const seed = '1';
      const players = createTestPlayers(4);

      const mapManager = new MapManager(width, height, seed, 'fracture');

      logger.info('=== TESTING FRACTURE MODE ===', {
        width,
        height,
        seed,
        playerCount: players.size,
      });

      await mapManager.generateMap(players, 'FRACTURE');

      const mapData = mapManager.getMapData();
      expect(mapData).not.toBeNull();

      if (mapData) {
        // Count terrain types
        let oceanCount = 0;
        let landCount = 0;
        const terrainCounts: Record<string, number> = {};

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const terrain = mapData.tiles[x][y].terrain;
            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;

            if (terrain === 'ocean' || terrain === 'deep_ocean') {
              oceanCount++;
            } else {
              landCount++;
            }
          }
        }

        const totalTiles = width * height;
        const oceanPercentage = (oceanCount / totalTiles) * 100;
        const landPercentage = (landCount / totalTiles) * 100;

        logger.info('=== FRACTURE MODE TERRAIN DISTRIBUTION ===', {
          totalTiles,
          oceanCount,
          landCount,
          oceanPercentage: Math.round(oceanPercentage * 10) / 10,
          landPercentage: Math.round(landPercentage * 10) / 10,
          terrainCounts,
        });

        // Document the current state (don't assert yet)
        console.log(`FRACTURE Mode Result: ${Math.round(landPercentage * 10) / 10}% land`);
      }
    });

    test('ISLANDS Mode - Height vs Shore Level Scale Check', async () => {
      const width = 40;
      const height = 25;
      const seed = '1';
      const players = createTestPlayers(4);

      const mapManager = new MapManager(width, height, seed, 'island');

      logger.info('=== TESTING ISLAND MODE ===', {
        width,
        height,
        seed,
        playerCount: players.size,
      });

      await mapManager.generateMap(players, 'ISLAND');

      const mapData = mapManager.getMapData();
      expect(mapData).not.toBeNull();

      if (mapData) {
        // Count terrain types
        let oceanCount = 0;
        let landCount = 0;
        const terrainCounts: Record<string, number> = {};

        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const terrain = mapData.tiles[x][y].terrain;
            terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;

            if (terrain === 'ocean' || terrain === 'deep_ocean') {
              oceanCount++;
            } else {
              landCount++;
            }
          }
        }

        const totalTiles = width * height;
        const oceanPercentage = (oceanCount / totalTiles) * 100;
        const landPercentage = (landCount / totalTiles) * 100;

        logger.info('=== ISLAND MODE TERRAIN DISTRIBUTION ===', {
          totalTiles,
          oceanCount,
          landCount,
          oceanPercentage: Math.round(oceanPercentage * 10) / 10,
          landPercentage: Math.round(landPercentage * 10) / 10,
          terrainCounts,
        });

        // Document the current state (don't assert yet)
        console.log(`ISLAND Mode Result: ${Math.round(landPercentage * 10) / 10}% land`);
      }
    });
  });
});
