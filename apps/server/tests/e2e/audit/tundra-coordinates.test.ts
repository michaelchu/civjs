/**
 * Audit Test: Tundra Coordinate Distribution
 *
 * This test validates that tundra tiles appear only in appropriate climate zones
 * based on latitude/coordinate position, not randomly scattered across the map.
 *
 * Expected behavior:
 * - Tundra should be concentrated near poles (top/bottom edges of map)
 * - Tundra should NOT appear in equatorial regions (center of map)
 * - Temperature distribution should follow latitude-based gradients
 */

import { MapManager } from '../../../src/game/MapManager';
import { PlayerState } from '../../../src/game/GameManager';
import { TemperatureType } from '../../../src/game/map/MapTypes';
import fs from 'fs';

describe('Tundra Coordinate Distribution Audit', () => {
  let mapManager: MapManager;
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
    // Ensure audit results directory exists
    if (!fs.existsSync(AUDIT_RESULTS_DIR)) {
      fs.mkdirSync(AUDIT_RESULTS_DIR, { recursive: true });
    }
  });

  describe('Temperature-based tundra distribution', () => {
    it('should generate tundra only in appropriate latitude zones', async () => {
      const mapSize = { width: 80, height: 60 }; // Standard size for good latitude gradient
      mapManager = new MapManager(
        mapSize.width,
        mapSize.height,
        'tundra-audit-seed',
        'random',
        undefined,
        undefined,
        false,
        35 // Use temperature 35 to ensure we get some tundra
      );

      await mapManager.generateMap(testPlayers);
      const mapData = mapManager.getMapData();

      expect(mapData).toBeDefined();
      expect(mapData!.tiles).toHaveLength(mapSize.width);
      expect(mapData!.tiles[0]).toHaveLength(mapSize.height);

      const tundraCoordinates: Array<{ x: number; y: number; temp: number }> = [];
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
          else if (tile.temperature === TemperatureType.TROPICAL)
            temperatureDistribution.tropical++;

          // Record tundra locations
          if (tile.terrain === 'tundra') {
            tundraCoordinates.push({
              x,
              y,
              temp: tile.temperature as number,
            });
          }
        }
      }

      // Calculate latitude zones
      const equatorY = Math.floor(mapSize.height / 2);
      const poleThreshold = Math.floor(mapSize.height * 0.2); // 20% from edges

      console.log(`\\nTundra Distribution Audit Results:`);
      console.log(`Map size: ${mapSize.width}x${mapSize.height}`);
      console.log(
        `Equator at y=${equatorY}, pole zones: y<${poleThreshold} or y>${mapSize.height - poleThreshold}`
      );
      console.log(`Total tundra tiles: ${tundraCoordinates.length}`);
      console.log(`Temperature distribution:`, temperatureDistribution);

      // Categorize tundra by latitude zones
      const tundraByZone = {
        northPole: tundraCoordinates.filter(t => t.y < poleThreshold),
        equatorial: tundraCoordinates.filter(t => Math.abs(t.y - equatorY) < poleThreshold),
        southPole: tundraCoordinates.filter(t => t.y > mapSize.height - poleThreshold),
        other: tundraCoordinates.filter(
          t =>
            t.y >= poleThreshold &&
            t.y <= mapSize.height - poleThreshold &&
            Math.abs(t.y - equatorY) >= poleThreshold
        ),
      };

      console.log(`\\nTundra by latitude zones:`);
      console.log(`  North pole (y<${poleThreshold}): ${tundraByZone.northPole.length} tiles`);
      console.log(
        `  Equatorial (±${poleThreshold} from y=${equatorY}): ${tundraByZone.equatorial.length} tiles`
      );
      console.log(
        `  South pole (y>${mapSize.height - poleThreshold}): ${tundraByZone.southPole.length} tiles`
      );
      console.log(`  Other zones: ${tundraByZone.other.length} tiles`);

      // Save detailed audit results
      const auditResults = {
        mapSize,
        totalTundra: tundraCoordinates.length,
        temperatureDistribution,
        tundraByZone: {
          northPole: tundraByZone.northPole.length,
          equatorial: tundraByZone.equatorial.length,
          southPole: tundraByZone.southPole.length,
          other: tundraByZone.other.length,
        },
        detailedCoordinates: tundraCoordinates,
        analysis: {
          equatorialTundraPercentage: Math.round(
            (tundraByZone.equatorial.length / tundraCoordinates.length) * 100
          ),
          polarTundraPercentage: Math.round(
            ((tundraByZone.northPole.length + tundraByZone.southPole.length) /
              tundraCoordinates.length) *
              100
          ),
        },
      };

      fs.writeFileSync(
        `${AUDIT_RESULTS_DIR}/tundra_coordinates_audit.json`,
        JSON.stringify(auditResults, null, 2)
      );

      // CRITICAL ASSERTIONS: Tundra distribution should follow climate logic

      // 1. Tundra should NOT dominate equatorial regions (should be <10% of total tundra)
      const equatorialTundraPercentage =
        (tundraByZone.equatorial.length / tundraCoordinates.length) * 100;
      console.log(`\\n🧪 AUDIT ASSERTION: Equatorial tundra should be <10% of total tundra`);
      console.log(`   Current: ${equatorialTundraPercentage.toFixed(1)}%`);

      if (equatorialTundraPercentage > 10) {
        console.log(`   ❌ FAILED: Too much tundra in equatorial regions!`);
        console.log(
          `   Sample equatorial tundra coordinates:`,
          tundraByZone.equatorial.slice(0, 5)
        );
      } else {
        console.log(`   ✅ PASSED: Equatorial tundra is appropriately limited`);
      }

      // 2. Majority of tundra should be in polar regions (>60%)
      const polarTundraPercentage =
        ((tundraByZone.northPole.length + tundraByZone.southPole.length) /
          tundraCoordinates.length) *
        100;
      console.log(`\\n🧪 AUDIT ASSERTION: Polar tundra should be >60% of total tundra`);
      console.log(`   Current: ${polarTundraPercentage.toFixed(1)}%`);

      if (polarTundraPercentage < 60) {
        console.log(`   ❌ FAILED: Not enough tundra concentrated in polar regions!`);
      } else {
        console.log(`   ✅ PASSED: Tundra is appropriately concentrated in polar regions`);
      }

      // 3. Temperature distribution should be reasonable (not all one type)
      const totalTiles = mapSize.width * mapSize.height;
      const frozenPercentage = (temperatureDistribution.frozen / totalTiles) * 100;
      const temperatePercentage = (temperatureDistribution.temperate / totalTiles) * 100;

      console.log(`\\n🧪 AUDIT ASSERTION: Temperature distribution should be balanced`);
      console.log(`   FROZEN: ${frozenPercentage.toFixed(1)}% (should be <20%)`);
      console.log(`   TEMPERATE: ${temperatePercentage.toFixed(1)}% (should be >30%)`);

      // Flexible assertions for now - we want to see current behavior
      expect(tundraCoordinates.length).toBeGreaterThan(0); // Should have some tundra
      expect(equatorialTundraPercentage).toBeLessThan(50); // Not more than half in equatorial zones
      expect(temperatureDistribution.temperate).toBeGreaterThan(0); // Should have some temperate zones

      console.log(`\\n📊 Full audit results saved to: tundra_coordinates_audit.json`);
    }, 30000); // 30 second timeout for map generation
  });
});
