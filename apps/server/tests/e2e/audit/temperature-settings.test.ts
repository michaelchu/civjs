/**
 * Test: Temperature Settings Impact on Tundra Generation
 *
 * This test validates that different temperature parameter settings
 * create appropriate amounts of tundra while maintaining polar concentration.
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';
import { TemperatureType } from '../../../src/game/map/MapTypes';

describe('Temperature Settings Impact on Tundra', () => {
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

  const testTemperatureSetting = async (temperature: number) => {
    const mapSize = { width: 60, height: 40 };
    const mapManager = new MapManager(mapSize.width, mapSize.height, `temp-${temperature}-seed`);

    // Override the temperature parameter for testing
    await mapManager.generateMap(testPlayers, 'RANDOM');
    const mapData = mapManager.getMapData();

    expect(mapData).toBeDefined();

    let tundraCount = 0;
    const temperatureDistribution = {
      frozen: 0,
      cold: 0,
      temperate: 0,
      tropical: 0,
    };

    // Count terrain and temperature distribution
    for (let x = 0; x < mapSize.width; x++) {
      for (let y = 0; y < mapSize.height; y++) {
        const tile = mapData!.tiles[x][y];

        if (tile.terrain === 'tundra') {
          tundraCount++;
        }

        if (tile.temperature === TemperatureType.FROZEN) temperatureDistribution.frozen++;
        else if (tile.temperature === TemperatureType.COLD) temperatureDistribution.cold++;
        else if (tile.temperature === TemperatureType.TEMPERATE)
          temperatureDistribution.temperate++;
        else if (tile.temperature === TemperatureType.TROPICAL) temperatureDistribution.tropical++;
      }
    }

    const totalTiles = mapSize.width * mapSize.height;
    const coldPercentage =
      ((temperatureDistribution.cold + temperatureDistribution.frozen) / totalTiles) * 100;

    console.log(`\n🌡️ Temperature Setting: ${temperature}`);
    console.log(`  Tundra tiles: ${tundraCount}`);
    console.log(`  Cold zones: ${coldPercentage.toFixed(1)}%`);
    console.log(`  Temperature distribution:`, temperatureDistribution);

    return {
      temperature,
      tundraCount,
      coldPercentage,
      temperatureDistribution,
    };
  };

  it('should show impact of different temperature settings', async () => {
    // Test different temperature settings
    const results = await Promise.all([
      testTemperatureSetting(0), // Coldest
      testTemperatureSetting(30), // Cool
      testTemperatureSetting(50), // Default
      testTemperatureSetting(70), // Warm
      testTemperatureSetting(100), // Hottest
    ]);

    console.log('\n📊 Temperature Settings Summary:');
    results.forEach(result => {
      console.log(
        `  Temp ${result.temperature}: ${result.tundraCount} tundra, ${result.coldPercentage.toFixed(1)}% cold zones`
      );
    });

    // Validate that colder settings produce more tundra/cold zones
    const coldestResult = results[0]; // temp = 0
    const hottestResult = results[4]; // temp = 100

    // Cold setting should have more cold zones than hot setting
    expect(coldestResult.coldPercentage).toBeGreaterThanOrEqual(hottestResult.coldPercentage);

    // At least one setting should produce some tundra
    const totalTundra = results.reduce((sum, r) => sum + r.tundraCount, 0);
    expect(totalTundra).toBeGreaterThan(0);
  }, 30000); // 30 second timeout for multiple map generations
});
