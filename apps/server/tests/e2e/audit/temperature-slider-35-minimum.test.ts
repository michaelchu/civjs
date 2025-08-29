/**
 * Test: Temperature Slider Minimum Value
 *
 * This test validates that temperature setting 35 (new minimum)
 * generates appropriate tundra amounts - should have some tundra but not excessive.
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';
import { TemperatureType } from '../../../src/game/map/MapTypes';

describe('Temperature Slider Minimum Value (35)', () => {
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

  it('should generate reasonable tundra amounts at temperature setting 35 (slider minimum)', async () => {
    const mapSize = { width: 80, height: 60 };

    const mapManager = new MapManager(
      mapSize.width,
      mapSize.height,
      'temp-35-min-test-seed',
      'random',
      undefined,
      undefined,
      false,
      35 // Temperature setting 35 (new slider minimum)
    );

    await mapManager.generateMap(testPlayers, 'RANDOM');
    const mapData = mapManager.getMapData();

    expect(mapData).toBeDefined();

    let totalTundra = 0;
    let totalColdZones = 0;
    let totalFrozenZones = 0;
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

        if (tile.temperature === TemperatureType.COLD) {
          totalColdZones++;
        }

        if (tile.temperature === TemperatureType.FROZEN) {
          totalFrozenZones++;
        }
      }
    }

    const totalTiles = mapSize.width * mapSize.height;
    const tundraPercentage = (totalTundra / totalTiles) * 100;
    const tundraLandPercentage = totalLand > 0 ? (totalTundra / totalLand) * 100 : 0;

    console.log(`\n❄️ Temperature Setting 35 (Slider Minimum) Results:`);
    console.log(`  Map size: ${mapSize.width}x${mapSize.height} (${totalTiles} tiles)`);
    console.log(`  Total land: ${totalLand} tiles`);
    console.log(
      `  Total tundra: ${totalTundra} tiles (${tundraPercentage.toFixed(
        1
      )}% of map, ${tundraLandPercentage.toFixed(1)}% of land)`
    );
    console.log(`  COLD zones: ${totalColdZones}`);
    console.log(`  FROZEN zones: ${totalFrozenZones}`);

    // At temperature 35 (slider minimum), we should have moderate tundra (5-20% of land)
    expect(tundraLandPercentage).toBeGreaterThan(5.0); // Should have some tundra
    expect(tundraLandPercentage).toBeLessThan(20.0); // But not excessive

    console.log(
      `  ✅ Tundra land percentage (${tundraLandPercentage.toFixed(
        1
      )}%) is reasonable (5-20% of land)`
    );

    // Should have some cold zones but not the majority
    expect(totalColdZones).toBeGreaterThan(0);
    console.log(`  ✅ Has cold temperature zones: ${totalColdZones}`);
  }, 15000);
});
