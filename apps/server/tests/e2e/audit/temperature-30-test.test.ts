/**
 * Test: Temperature Setting 30
 *
 * This test validates that temperature setting 30 (what the user was using)
 * doesn't create massive tundra blocks like in the screenshot.
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';
import { TemperatureType } from '../../../src/game/map/MapTypes';

describe('Temperature Setting 30 Test', () => {
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

  it('should NOT create massive tundra blocks at temperature setting 30', async () => {
    const mapSize = { width: 80, height: 60 };

    const mapManager = new MapManager(
      mapSize.width,
      mapSize.height,
      'temp-30-test-seed',
      'random',
      undefined,
      undefined,
      false,
      30 // Temperature setting 30 (user's setting)
    );

    await mapManager.generateMap(testPlayers, 'RANDOM');
    const mapData = mapManager.getMapData();

    expect(mapData).toBeDefined();

    let totalTundra = 0;
    let totalColdZones = 0;
    let totalFrozenZones = 0;

    for (let x = 0; x < mapSize.width; x++) {
      for (let y = 0; y < mapSize.height; y++) {
        const tile = mapData!.tiles[x][y];

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

    console.log(`\\n❄️ Temperature Setting 30 Results:`);
    console.log(`  Map size: ${mapSize.width}x${mapSize.height} (${totalTiles} tiles)`);
    console.log(`  Total tundra: ${totalTundra} tiles (${tundraPercentage.toFixed(1)}%)`);
    console.log(`  COLD zones: ${totalColdZones}`);
    console.log(`  FROZEN zones: ${totalFrozenZones}`);

    // At temperature 30, we should have minimal tundra (< 5% of map)
    expect(tundraPercentage).toBeLessThan(5.0);

    console.log(`  ✅ Tundra percentage (${tundraPercentage.toFixed(1)}%) is reasonable (< 5%)`);
  }, 15000);
});
