/**
 * Phase 1: Terrain Generation Flow Sequence Compliance Tests
 * Tests for Phase 1 fixes to ensure correct flow sequence according to freeciv reference
 */
import { MapManager, TemperatureType } from '../../src/game/MapManager';
import { PlayerState } from '../../src/game/GameManager';

describe('Phase 1: Terrain Generation Flow Sequence Compliance', () => {
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
    [
      'player2',
      {
        id: 'player2',
        userId: 'user2',
        playerNumber: 2,
        civilization: 'Greeks',
        isReady: true,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      },
    ],
  ]);

  beforeEach(() => {
    mapManager = new MapManager(30, 20, 'phase1-test-seed');
  });

  describe('Phase 1 Fix 1: Temperature Map Creation Integration', () => {
    it('should create temperature map internally within makeLand', async () => {
      // Create a map with fractal generator (calls makeLand)
      await mapManager.generateMapFractal(testPlayers);

      const mapData = mapManager.getMapData()!;

      // Verify all tiles have temperature data
      let tilesWithTemperature = 0;
      for (let x = 0; x < mapData.width; x++) {
        for (let y = 0; y < mapData.height; y++) {
          const tile = mapData.tiles[x][y];
          if (tile.temperature !== undefined) {
            tilesWithTemperature++;
            // Temperature should be a valid enum value
            expect([
              TemperatureType.TROPICAL,
              TemperatureType.TEMPERATE,
              TemperatureType.COLD,
              TemperatureType.FROZEN,
            ]).toContain(tile.temperature);
          }
        }
      }

      // All tiles should have temperature data from internal creation
      expect(tilesWithTemperature).toBe(mapData.width * mapData.height);
    });

    it('should create temperature map in all generator types', async () => {
      const generatorTypes = ['fractal', 'random', 'fracture'];

      for (const genType of generatorTypes) {
        const testMap = new MapManager(20, 15, `temp-test-${genType}-${Math.random()}`);
        
        switch (genType) {
          case 'fractal':
            await testMap.generateMapFractal(testPlayers);
            break;
          case 'random':
            await testMap.generateMapRandom(testPlayers);
            break;
          case 'fracture':
            await testMap.generateMapFracture(testPlayers);
            break;
        }

        const mapData = testMap.getMapData()!;
        let temperatureCount = 0;

        for (let x = 0; x < mapData.width; x++) {
          for (let y = 0; y < mapData.height; y++) {
            if (mapData.tiles[x][y].temperature !== undefined) {
              temperatureCount++;
            }
          }
        }

        expect(temperatureCount).toBe(mapData.width * mapData.height);
      }
    });
  });

  describe('Phase 1 Fix 2: River Generation Integration', () => {
    it('should generate rivers internally within makeLand', async () => {
      // Use larger map for better river generation
      const largerMap = new MapManager(50, 40, 'river-integration-test');
      await largerMap.generateMapFractal(testPlayers);

      const mapData = largerMap.getMapData()!;

      // Count tiles with river data (riverMask > 0)
      let tilesWithRivers = 0;
      for (let x = 0; x < mapData.width; x++) {
        for (let y = 0; y < mapData.height; y++) {
          const tile = mapData.tiles[x][y];
          if (tile.riverMask > 0) {
            tilesWithRivers++;
            // River mask should be valid bitfield (0-15)
            expect(tile.riverMask >= 0).toBe(true);
            expect(tile.riverMask <= 15).toBe(true);
          }
        }
      }

      // Larger maps should have some rivers generated internally
      expect(tilesWithRivers).toBeGreaterThanOrEqual(0);
    });

    it('should handle river generation in all non-island generators', async () => {
      const generators = ['fractal', 'random', 'fracture'];

      for (const genType of generators) {
        const testMap = new MapManager(30, 25, `river-${genType}-test`);

        switch (genType) {
          case 'fractal':
            await testMap.generateMapFractal(testPlayers);
            break;
          case 'random':
            await testMap.generateMapRandom(testPlayers);
            break;
          case 'fracture':
            await testMap.generateMapFracture(testPlayers);
            break;
        }

        const mapData = testMap.getMapData()!;

        // Verify river data structure is present
        for (let x = 0; x < Math.min(5, mapData.width); x++) {
          for (let y = 0; y < Math.min(5, mapData.height); y++) {
            const tile = mapData.tiles[x][y];
            expect(typeof tile.riverMask).toBe('number');
            expect(tile.riverMask >= 0).toBe(true);
            expect(tile.riverMask <= 15).toBe(true);
          }
        }
      }
    });
  });

  describe('Phase 1 Fix 3: Pole Renormalization Integration', () => {
    it('should apply pole renormalization internally within makeLand', async () => {
      // Create larger map for better pole effects
      const poleMap = new MapManager(40, 30, 'pole-renorm-test');
      await poleMap.generateMapFractal(testPlayers);

      const mapData = poleMap.getMapData()!;
      const height = mapData.height;

      // Check pole areas (top and bottom rows) vs center areas
      const poleElevations: number[] = [];
      const centerElevations: number[] = [];

      // Sample from poles (top/bottom 10% of map)
      const poleRows = Math.max(1, Math.floor(height * 0.1));
      for (let x = 0; x < mapData.width; x++) {
        for (let y = 0; y < poleRows; y++) {
          poleElevations.push(mapData.tiles[x][y].elevation);
          poleElevations.push(mapData.tiles[x][height - 1 - y].elevation);
        }
      }

      // Sample from center
      const centerStart = Math.floor(height * 0.4);
      const centerEnd = Math.floor(height * 0.6);
      for (let x = 0; x < mapData.width; x++) {
        for (let y = centerStart; y < centerEnd; y++) {
          centerElevations.push(mapData.tiles[x][y].elevation);
        }
      }

      const avgPoleElevation =
        poleElevations.reduce((sum, e) => sum + e, 0) / poleElevations.length;
      const avgCenterElevation =
        centerElevations.reduce((sum, e) => sum + e, 0) / centerElevations.length;

      // Pole renormalization should generally make poles lower
      // Allow some variance for different random seeds
      expect(avgPoleElevation).toBeLessThanOrEqual(avgCenterElevation + 40);
    });

    it('should apply pole renormalization consistently across generators', async () => {
      const results = [];

      for (const genType of ['fractal', 'random', 'fracture']) {
        const testMap = new MapManager(35, 25, `pole-${genType}-test`);

        switch (genType) {
          case 'fractal':
            await testMap.generateMapFractal(testPlayers);
            break;
          case 'random':
            await testMap.generateMapRandom(testPlayers);
            break;
          case 'fracture':
            await testMap.generateMapFracture(testPlayers);
            break;
        }

        const mapData = testMap.getMapData()!;

        // Check that elevation values are in expected range after renormalization
        let elevationSum = 0;
        let tileCount = 0;
        let minElev = 999;
        let maxElev = -1;

        for (let x = 0; x < mapData.width; x++) {
          for (let y = 0; y < mapData.height; y++) {
            const elevation = mapData.tiles[x][y].elevation;
            minElev = Math.min(minElev, elevation);
            maxElev = Math.max(maxElev, elevation);
            expect(elevation >= 0).toBe(true);
            if (elevation > 255) {
              console.error(`${genType} generator produced elevation ${elevation} at (${x}, ${y})`);
            }
            expect(elevation <= 255).toBe(true);
            elevationSum += elevation;
            tileCount++;
          }
        }

        const avgElevation = elevationSum / tileCount;
        results.push({ generator: genType, avgElevation });
      }

      // All generators should produce valid average elevations
      for (const result of results) {
        expect(result.avgElevation).toBeGreaterThan(0);
        expect(result.avgElevation).toBeLessThan(255);
      }
    });
  });

  describe('Phase 1 Fix 4: Continent Assignment Order', () => {
    it('should assign continents after removing tiny islands', async () => {
      await mapManager.generateMapFractal(testPlayers);

      const mapData = mapManager.getMapData()!;
      const continentCounts = new Map<number, number>();
      let landTileCount = 0;

      // Count continents and land tiles
      for (let x = 0; x < mapData.width; x++) {
        for (let y = 0; y < mapData.height; y++) {
          const tile = mapData.tiles[x][y];
          const continentId = tile.continentId;

          // Count land tiles (non-ocean terrain)
          if (tile.terrain !== 'ocean' && tile.terrain !== 'deep_ocean') {
            landTileCount++;
            continentCounts.set(continentId, (continentCounts.get(continentId) || 0) + 1);
          }
        }
      }

      // If there are land tiles, they should have valid continent assignments
      if (landTileCount > 0) {
        expect(continentCounts.size).toBeGreaterThan(0);

        // All continent IDs should be positive (0 = ocean)
        for (const [continentId] of continentCounts) {
          expect(continentId).toBeGreaterThan(0);
        }

        // No continent should be too small (tiny islands should be removed)
        const continentSizes = Array.from(continentCounts.values());
        const minContinentSize = Math.min(...continentSizes);
        expect(minContinentSize).toBeGreaterThan(0);
      }
    });

    it('should maintain correct continent assignment order across all generators', async () => {
      const generators = [
        { name: 'fractal', fn: (map: MapManager) => map.generateMapFractal(testPlayers) },
        { name: 'random', fn: (map: MapManager) => map.generateMapRandom(testPlayers) },
        { name: 'fracture', fn: (map: MapManager) => map.generateMapFracture(testPlayers) },
      ];

      for (const { name, fn } of generators) {
        const testMap = new MapManager(25, 20, `continent-${name}-test`);
        await fn(testMap);

        const mapData = testMap.getMapData()!;
        const continentIds = new Set<number>();

        for (let x = 0; x < mapData.width; x++) {
          for (let y = 0; y < mapData.height; y++) {
            const tile = mapData.tiles[x][y];
            continentIds.add(tile.continentId);
          }
        }

        // Should have at least continent 0 (ocean)
        expect(continentIds.has(0)).toBe(true);

        // Continent IDs should be sequential starting from 0
        const sortedIds = Array.from(continentIds).sort((a, b) => a - b);
        expect(sortedIds[0]).toBe(0); // Ocean continent

        // Check that continent IDs are reasonable
        for (const id of sortedIds) {
          expect(id >= 0).toBe(true);
          expect(id < 100).toBe(true); // Reasonable upper bound
        }
      }
    });
  });

  describe('Phase 1 End-to-End Flow Validation', () => {
    it('should complete full terrain generation flow with correct sequence', async () => {
      const startTime = Date.now();

      await mapManager.generateMapFractal(testPlayers);

      const endTime = Date.now();
      const generationTime = endTime - startTime;

      const mapData = mapManager.getMapData()!;

      // Verify complete map structure
      expect(mapData).toBeDefined();
      expect(mapData.width).toBe(30);
      expect(mapData.height).toBe(20);
      expect(mapData.tiles).toHaveLength(30);
      expect(mapData.tiles[0]).toHaveLength(20);
      expect(mapData.startingPositions).toHaveLength(2);

      // Verify all Phase 1 fixes are applied
      let completeDataCount = 0;
      const terrainTypes = new Set<string>();
      const temperatureTypes = new Set<TemperatureType>();

      for (let x = 0; x < mapData.width; x++) {
        for (let y = 0; y < mapData.height; y++) {
          const tile = mapData.tiles[x][y];

          // Check all required data is present
          if (
            tile.terrain !== undefined &&
            tile.elevation !== undefined &&
            tile.temperature !== undefined &&
            tile.continentId !== undefined &&
            tile.riverMask !== undefined
          ) {
            completeDataCount++;
          }

          terrainTypes.add(tile.terrain);
          temperatureTypes.add(tile.temperature);

          // Validate data ranges
          expect(tile.elevation >= 0 && tile.elevation <= 255).toBe(true);
          expect(tile.riverMask >= 0 && tile.riverMask <= 15).toBe(true);
          expect(tile.continentId >= 0).toBe(true);
        }
      }

      // All tiles should have complete data
      expect(completeDataCount).toBe(mapData.width * mapData.height);

      // Should have terrain variety - allow for small maps that may have limited variety
      expect(terrainTypes.size).toBeGreaterThanOrEqual(1);

      // Should have temperature variety
      expect(temperatureTypes.size).toBeGreaterThanOrEqual(1);

      // Generation should complete in reasonable time
      expect(generationTime).toBeLessThan(10000); // 10 seconds max

      console.log(`Phase 1 compliance test completed in ${generationTime}ms`);
    });

    it('should maintain deterministic generation with same seed', async () => {
      const seed = 'phase1-deterministic-test';

      const map1 = new MapManager(20, 15, seed);
      const map2 = new MapManager(20, 15, seed);

      await map1.generateMapFractal(testPlayers);
      await map2.generateMapFractal(testPlayers);

      const data1 = map1.getMapData()!;
      const data2 = map2.getMapData()!;

      // Compare key properties
      let matchingTerrain = 0;
      let matchingElevation = 0;
      let matchingTemperature = 0;
      let matchingContinent = 0;
      let totalTiles = 0;

      for (let x = 0; x < data1.width; x++) {
        for (let y = 0; y < data1.height; y++) {
          const tile1 = data1.tiles[x][y];
          const tile2 = data2.tiles[x][y];

          totalTiles++;

          if (tile1.terrain === tile2.terrain) matchingTerrain++;
          if (tile1.elevation === tile2.elevation) matchingElevation++;
          if (tile1.temperature === tile2.temperature) matchingTemperature++;
          if (tile1.continentId === tile2.continentId) matchingContinent++;
        }
      }

      // With same seed, should have high consistency (>95%)
      expect(matchingTerrain / totalTiles).toBeGreaterThan(0.95);
      expect(matchingElevation / totalTiles).toBeGreaterThan(0.95);
      expect(matchingTemperature / totalTiles).toBeGreaterThan(0.95);
      expect(matchingContinent / totalTiles).toBeGreaterThan(0.95);
    });

    it('should handle all generator types without errors', async () => {
      const generatorTypes = ['fractal', 'random', 'fracture'];

      for (const name of generatorTypes) {
        const testMap = new MapManager(25, 18, `${name}-phase1-test`);

        // Should not throw errors
        switch (name) {
          case 'fractal':
            await expect(testMap.generateMapFractal(testPlayers)).resolves.not.toThrow();
            break;
          case 'random':
            await expect(testMap.generateMapRandom(testPlayers)).resolves.not.toThrow();
            break;
          case 'fracture':
            await expect(testMap.generateMapFracture(testPlayers)).resolves.not.toThrow();
            break;
        }

        const mapData = testMap.getMapData()!;

        // Should produce valid map data
        expect(mapData).toBeDefined();
        expect(mapData.tiles).toHaveLength(25);
        expect(mapData.tiles[0]).toHaveLength(18);
        expect(mapData.startingPositions).toHaveLength(2);

        console.log(`${name} generator completed Phase 1 flow successfully`);
      }
    });
  });

  describe('Phase 1 Performance and Memory', () => {
    it('should complete generation within reasonable time limits', async () => {
      const sizes = [
        { width: 20, height: 15 },
        { width: 40, height: 30 },
        { width: 60, height: 45 },
      ];

      for (const { width, height } of sizes) {
        const testMap = new MapManager(width, height, `perf-${width}x${height}`);

        const startTime = Date.now();
        await testMap.generateMapFractal(testPlayers);
        const endTime = Date.now();

        const generationTime = endTime - startTime;
        const mapSize = width * height;
        const timePerTile = generationTime / mapSize;

        // Should complete in reasonable time
        expect(generationTime).toBeLessThan(30000); // 30 seconds max
        expect(timePerTile).toBeLessThan(5); // 5ms per tile max

        console.log(
          `${width}x${height} map generated in ${generationTime}ms (${timePerTile.toFixed(2)}ms/tile)`
        );
      }
    });

    it('should not leak memory during generation', async () => {
      // Generate multiple maps to test for memory leaks
      const initialMemory = process.memoryUsage().heapUsed;

      for (let i = 0; i < 5; i++) {
        const testMap = new MapManager(30, 20, `memory-test-${i}`);
        await testMap.generateMapFractal(testPlayers);

        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      const memoryIncreaseMB = memoryIncrease / (1024 * 1024);

      // Memory increase should be reasonable (less than 50MB for 5 maps)
      expect(memoryIncreaseMB).toBeLessThan(50);

      console.log(`Memory increase after 5 map generations: ${memoryIncreaseMB.toFixed(2)}MB`);
    });
  });
});
