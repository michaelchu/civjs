/**
 * Test: Tundra Generation Across Different Map Types
 *
 * This test validates that the aggressive tundra reduction changes
 * apply consistently across all map generator types (FRACTAL, RANDOM, FRACTURE, ISLAND).
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';
import { TemperatureType } from '../../../src/game/map/MapTypes';
import fs from 'fs';

describe('Tundra Generation Across Map Types', () => {
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

  const AUDIT_RESULTS_DIR = './tests/e2e/audit/results';

  beforeAll(() => {
    if (!fs.existsSync(AUDIT_RESULTS_DIR)) {
      fs.mkdirSync(AUDIT_RESULTS_DIR, { recursive: true });
    }
  });

  const testMapGenerator = async (generatorType: string, testName: string) => {
    const mapSize = { width: 60, height: 40 }; // Smaller for faster testing
    const mapManager = new MapManager(mapSize.width, mapSize.height, `${testName}-seed`);

    await mapManager.generateMap(testPlayers, generatorType as any);
    const mapData = mapManager.getMapData();

    expect(mapData).toBeDefined();
    expect(mapData!.tiles).toHaveLength(mapSize.width);

    const tundraCoordinates: Array<{ x: number; y: number }> = [];
    const temperatureDistribution = {
      frozen: 0,
      cold: 0,
      temperate: 0,
      tropical: 0,
    };

    // Analyze all tiles
    for (let x = 0; x < mapSize.width; x++) {
      for (let y = 0; y < mapSize.height; y++) {
        const tile = mapData!.tiles[x][y];

        // Track temperature distribution
        if (tile.temperature === TemperatureType.FROZEN) temperatureDistribution.frozen++;
        else if (tile.temperature === TemperatureType.COLD) temperatureDistribution.cold++;
        else if (tile.temperature === TemperatureType.TEMPERATE)
          temperatureDistribution.temperate++;
        else if (tile.temperature === TemperatureType.TROPICAL) temperatureDistribution.tropical++;

        // Record tundra locations
        if (tile.terrain === 'tundra') {
          tundraCoordinates.push({ x, y });
        }
      }
    }

    // Calculate latitude zones
    const equatorY = Math.floor(mapSize.height / 2);
    const poleThreshold = Math.floor(mapSize.height * 0.2); // 20% from edges

    // Categorize tundra by latitude zones
    const tundraByZone = {
      northPole: tundraCoordinates.filter(t => t.y < poleThreshold),
      equatorial: tundraCoordinates.filter(t => Math.abs(t.y - equatorY) < poleThreshold),
      southPole: tundraCoordinates.filter(t => t.y > mapSize.height - poleThreshold),
    };

    const equatorialTundraPercentage =
      tundraCoordinates.length > 0
        ? (tundraByZone.equatorial.length / tundraCoordinates.length) * 100
        : 0;

    const polarTundraPercentage =
      tundraCoordinates.length > 0
        ? ((tundraByZone.northPole.length + tundraByZone.southPole.length) /
            tundraCoordinates.length) *
          100
        : 0;

    console.log(`\n📊 ${generatorType} Generator Results:`);
    console.log(`  Total tundra tiles: ${tundraCoordinates.length}`);
    console.log(`  Temperature distribution:`, temperatureDistribution);
    console.log(`  Equatorial tundra: ${equatorialTundraPercentage.toFixed(1)}%`);
    console.log(`  Polar tundra: ${polarTundraPercentage.toFixed(1)}%`);

    // Save results
    const results = {
      generatorType,
      mapSize,
      totalTundra: tundraCoordinates.length,
      temperatureDistribution,
      equatorialTundraPercentage,
      polarTundraPercentage,
      tundraByZone: {
        northPole: tundraByZone.northPole.length,
        equatorial: tundraByZone.equatorial.length,
        southPole: tundraByZone.southPole.length,
      },
    };

    fs.writeFileSync(
      `${AUDIT_RESULTS_DIR}/tundra_${generatorType.toLowerCase()}_audit.json`,
      JSON.stringify(results, null, 2)
    );

    // Return results for comparison
    return {
      totalTundra: tundraCoordinates.length,
      equatorialPercentage: equatorialTundraPercentage,
      polarPercentage: polarTundraPercentage,
      temperatureDistribution,
    };
  };

  it('should have minimal tundra on FRACTAL maps', async () => {
    const results = await testMapGenerator('FRACTAL', 'fractal');

    // Should have minimal tundra
    expect(results.totalTundra).toBeLessThan(100); // Should be much less than before
    // Should have 0% equatorial tundra
    expect(results.equatorialPercentage).toBe(0);
    // Should have good polar concentration if any tundra exists
    if (results.totalTundra > 0) {
      expect(results.polarPercentage).toBeGreaterThan(50);
    }
  }, 15000);

  it('should have minimal tundra on RANDOM maps', async () => {
    const results = await testMapGenerator('RANDOM', 'random');

    expect(results.totalTundra).toBeLessThan(100);
    expect(results.equatorialPercentage).toBe(0);
    if (results.totalTundra > 0) {
      expect(results.polarPercentage).toBeGreaterThan(50);
    }
  }, 15000);

  it('should have minimal tundra on FRACTURE maps', async () => {
    const results = await testMapGenerator('FRACTURE', 'fracture');

    expect(results.totalTundra).toBeLessThan(100);
    expect(results.equatorialPercentage).toBe(0);
    if (results.totalTundra > 0) {
      expect(results.polarPercentage).toBeGreaterThan(50);
    }
  }, 15000);

  it('should have minimal tundra on ISLAND maps', async () => {
    const results = await testMapGenerator('ISLAND', 'island');

    expect(results.totalTundra).toBeLessThan(100);
    expect(results.equatorialPercentage).toBe(0);
    if (results.totalTundra > 0) {
      expect(results.polarPercentage).toBeGreaterThan(50);
    }
  }, 15000);
});
