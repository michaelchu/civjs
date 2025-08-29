/**
 * Test: Temperature Presets (35, 50, 75)
 *
 * This test validates that our temperature preset values (Cold=35, Temperate=50, Tropical=75)
 * generate appropriate tundra amounts for their respective climate settings.
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';

describe('Temperature Presets Test', () => {
  const testPlayers = new Map<string, PlayerState>([
    [
      'player1',
      {
        id: 'player1',
        userId: 'user1',
        playerNumber: 1,
        civilization: 'Romans',
        isReady: true,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      },
    ],
  ]);

  const mapSize = { width: 80, height: 60 };

  it('should generate appropriate tundra amounts for each preset', async () => {
    const presets = [
      { name: 'Cold', value: 35, expectedTundraMin: 10, expectedTundraMax: 25 },
      { name: 'Temperate', value: 50, expectedTundraMin: 0, expectedTundraMax: 10 },
      { name: 'Tropical', value: 75, expectedTundraMin: 0, expectedTundraMax: 5 },
    ];

    const results = [];

    for (const preset of presets) {
      const mapManager = new MapManager(
        mapSize.width,
        mapSize.height,
        `preset-${preset.value}-test-seed`,
        'random',
        undefined,
        undefined,
        false,
        preset.value // Temperature preset value
      );

      await mapManager.generateMap(testPlayers, 'RANDOM');
      const mapData = mapManager.getMapData();

      expect(mapData).toBeDefined();

      let totalTundra = 0;
      let totalLand = 0;

      for (let x = 0; x < mapSize.width; x++) {
        for (let y = 0; y < mapSize.height; y++) {
          const tile = mapData!.tiles[x][y];

          if (
            tile.terrain !== 'ocean' &&
            tile.terrain !== 'deep_ocean' &&
            tile.terrain !== 'coast' &&
            tile.terrain !== 'lake'
          ) {
            totalLand++;
          }

          if (tile.terrain === 'tundra') {
            totalTundra++;
          }
        }
      }

      const tundraLandPercentage = totalLand > 0 ? (totalTundra / totalLand) * 100 : 0;

      results.push({
        preset: preset.name,
        value: preset.value,
        tundra: totalTundra,
        tundraPercentage: tundraLandPercentage,
        land: totalLand,
      });

      // Verify tundra percentage is within expected range
      expect(tundraLandPercentage).toBeGreaterThanOrEqual(preset.expectedTundraMin);
      expect(tundraLandPercentage).toBeLessThanOrEqual(preset.expectedTundraMax);
    }

    console.log(`\n❄️ Temperature Presets Results:`);
    console.log(`  Map size: ${mapSize.width}x${mapSize.height}`);

    for (const result of results) {
      console.log(
        `  ${result.preset} (${result.value}°): ${result.tundra} tundra tiles (${result.tundraPercentage.toFixed(1)}% of ${result.land} land)`
      );
    }

    // Verify that Cold > Temperate > Tropical in terms of tundra
    expect(results[0].tundraPercentage).toBeGreaterThan(results[1].tundraPercentage); // Cold > Temperate
    expect(results[1].tundraPercentage).toBeGreaterThanOrEqual(results[2].tundraPercentage); // Temperate >= Tropical

    console.log(`  ✅ Cold setting generates most tundra, Tropical generates least`);
  }, 20000);
});
