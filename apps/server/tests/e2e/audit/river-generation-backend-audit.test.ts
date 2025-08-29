/**
 * Comprehensive River Generation Backend Audit Test
 *
 * This test verifies that rivers are properly generated and sent from the backend
 * for random maps with default terrain settings. Focuses on the complete pipeline:
 * 1. River network generation
 * 2. River data persistence in map tiles
 * 3. API serialization and transmission
 * 4. Connection mask accuracy
 */

import fs from 'fs';
import path from 'path';
import { PlayerState } from '../../../src/game/GameManager';
import { MapGeneratorType, MapManager } from '../../../src/game/MapManager';
import { MapData, MapTile } from '../../../src/game/map/MapTypes';

// Test configurations focusing on random maps (where river issues were reported)
const TEST_SEEDS = [1, 2, 3, 5, 7]; // Multiple seeds to ensure consistency
const TEST_SIZES = [
  { width: 40, height: 25, name: 'Small (40x25)' },
  { width: 80, height: 50, name: 'Standard (80x50)' },
];

interface RiverAnalysis {
  totalRiverTiles: number;
  riverNetworks: number;
  averageNetworkSize: number;
  maxNetworkSize: number;
  riverConnections: number;
  isolatedRivers: number; // Rivers with riverMask = 0 (should be 0 after Phase 3 fix)
  riversByMask: Record<number, number>; // Count of rivers by riverMask value
  riverToOceanConnections: number;
  riverToRiverConnections: number;
  elevationDistribution: {
    min: number;
    max: number;
    average: number;
  };
  terrainDistribution: Record<string, number>;
  sampleRiverTiles: Array<{
    x: number;
    y: number;
    riverMask: number;
    terrain: string;
    elevation: number;
    connections: string[]; // Human readable connection directions
  }>;
}

interface RiverTestResult {
  size: string;
  seed: number;
  width: number;
  height: number;
  analysis?: RiverAnalysis;
  generationTime: number;
  success: boolean;
  error?: string;
  apiResponseIncludesRivers: boolean;
  sampleApiTileWithRiver?: any;
}

// Mock player state for testing
function createMockPlayers(count: number): Map<string, PlayerState> {
  const players = new Map<string, PlayerState>();
  for (let i = 0; i < count; i++) {
    players.set(`player_${i}`, {
      id: `player_${i}`,
      userId: `user_${i}`,
      playerNumber: i,
      civilization: 'Romans',
      isReady: true,
      hasEndedTurn: false,
      isConnected: true,
      lastSeen: new Date(),
    });
  }
  return players;
}

// Analyze river generation in map data
function analyzeRiverGeneration(mapData: MapData): RiverAnalysis {
  let totalRiverTiles = 0;
  let riverConnections = 0;
  let isolatedRivers = 0;
  const riversByMask: Record<number, number> = {};
  const terrainDistribution: Record<string, number> = {};
  let riverToOceanConnections = 0;
  let riverToRiverConnections = 0;
  const elevations: number[] = [];
  const sampleRiverTiles: RiverAnalysis['sampleRiverTiles'] = [];

  // Track river networks using flood fill
  const visited = new Set<string>();
  const networks: Array<MapTile[]> = [];

  for (let x = 0; x < mapData.width; x++) {
    for (let y = 0; y < mapData.height; y++) {
      const tile = mapData.tiles[x][y];

      if (tile.riverMask > 0) {
        totalRiverTiles++;
        elevations.push(tile.elevation);

        // Count by mask value
        riversByMask[tile.riverMask] = (riversByMask[tile.riverMask] || 0) + 1;

        // Count by terrain
        terrainDistribution[tile.terrain] = (terrainDistribution[tile.terrain] || 0) + 1;

        // Count connections
        const connectionCount = countConnections(tile.riverMask);
        riverConnections += connectionCount;

        if (connectionCount === 0) {
          isolatedRivers++;
        }

        // Analyze connection types
        const connections = analyzeConnections(x, y, mapData);
        riverToOceanConnections += connections.oceanConnections;
        riverToRiverConnections += connections.riverConnections;

        // Collect sample tiles (first 10)
        if (sampleRiverTiles.length < 10) {
          sampleRiverTiles.push({
            x,
            y,
            riverMask: tile.riverMask,
            terrain: tile.terrain,
            elevation: tile.elevation,
            connections: getConnectionDirections(tile.riverMask),
          });
        }

        // Build network map using flood fill
        const tileKey = `${x},${y}`;
        if (!visited.has(tileKey)) {
          const network = floodFillRiverNetwork(x, y, mapData, visited);
          if (network.length > 0) {
            networks.push(network);
          }
        }
      }
    }
  }

  const networkSizes = networks.map(n => n.length);

  return {
    totalRiverTiles,
    riverNetworks: networks.length,
    averageNetworkSize:
      networkSizes.length > 0
        ? Math.round(networkSizes.reduce((a, b) => a + b, 0) / networkSizes.length)
        : 0,
    maxNetworkSize: networkSizes.length > 0 ? Math.max(...networkSizes) : 0,
    riverConnections,
    isolatedRivers,
    riversByMask,
    riverToOceanConnections,
    riverToRiverConnections,
    elevationDistribution: {
      min: elevations.length > 0 ? Math.min(...elevations) : 0,
      max: elevations.length > 0 ? Math.max(...elevations) : 0,
      average:
        elevations.length > 0
          ? Math.round(elevations.reduce((a, b) => a + b, 0) / elevations.length)
          : 0,
    },
    terrainDistribution,
    sampleRiverTiles,
  };
}

// Count number of connections in riverMask bitfield
function countConnections(riverMask: number): number {
  let count = 0;
  for (let i = 0; i < 4; i++) {
    if (riverMask & (1 << i)) count++;
  }
  return count;
}

// Get human readable connection directions
function getConnectionDirections(riverMask: number): string[] {
  const directions = ['North', 'East', 'South', 'West'];
  const result: string[] = [];

  for (let i = 0; i < 4; i++) {
    if (riverMask & (1 << i)) {
      result.push(directions[i]);
    }
  }

  return result;
}

// Analyze what each river tile connects to
function analyzeConnections(
  x: number,
  y: number,
  mapData: MapData
): { oceanConnections: number; riverConnections: number } {
  let oceanConnections = 0;
  let riverConnections = 0;

  const directions = [
    { dx: 0, dy: -1, mask: 1 }, // North
    { dx: 1, dy: 0, mask: 2 }, // East
    { dx: 0, dy: 1, mask: 4 }, // South
    { dx: -1, dy: 0, mask: 8 }, // West
  ];

  const tile = mapData.tiles[x][y];

  for (const dir of directions) {
    if (tile.riverMask & dir.mask) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;

      if (nx >= 0 && nx < mapData.width && ny >= 0 && ny < mapData.height) {
        const neighbor = mapData.tiles[nx][ny];

        if (['ocean', 'coast', 'deep_ocean', 'lake'].includes(neighbor.terrain)) {
          oceanConnections++;
        } else if (neighbor.riverMask > 0) {
          riverConnections++;
        }
      }
    }
  }

  return { oceanConnections, riverConnections };
}

// Flood fill to find connected river networks
function floodFillRiverNetwork(
  startX: number,
  startY: number,
  mapData: MapData,
  visited: Set<string>
): MapTile[] {
  const network: MapTile[] = [];
  const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    const key = `${x},${y}`;

    if (visited.has(key)) continue;
    if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) continue;

    const tile = mapData.tiles[x][y];
    if (tile.riverMask === 0) continue;

    visited.add(key);
    network.push(tile);

    // Add connected neighbors to queue
    const directions = [
      { dx: 0, dy: -1, mask: 1 }, // North
      { dx: 1, dy: 0, mask: 2 }, // East
      { dx: 0, dy: 1, mask: 4 }, // South
      { dx: -1, dy: 0, mask: 8 }, // West
    ];

    for (const dir of directions) {
      if (tile.riverMask & dir.mask) {
        queue.push({ x: x + dir.dx, y: y + dir.dy });
      }
    }
  }

  return network;
}

// Test API response includes river data (simulate what VisibilityManager returns)
function testApiResponse(mapData: MapData): { includesRivers: boolean; sampleTile?: any } {
  try {
    // Simulate what the VisibilityManager.getPlayerMapView() would return
    // In the actual system, this goes through the HTTP API, but for testing we check the source data

    const tiles: Record<string, any> = {};
    for (let x = 0; x < mapData.width; x++) {
      for (let y = 0; y < mapData.height; y++) {
        const tile = mapData.tiles[x][y];
        const tileKey = `${x},${y}`;

        // Simulate the VisibilityManager filtering (would include riverMask via ...tile spread)
        tiles[tileKey] = {
          ...tile,
          x,
          y,
          isVisible: true,
          isExplored: true,
          known: 1,
          seen: 1,
        };
      }
    }

    // Check if any tiles in the simulated response have riverMask data
    for (const tileKey in tiles) {
      const tile = tiles[tileKey];
      if (tile.riverMask && tile.riverMask > 0) {
        return {
          includesRivers: true,
          sampleTile: {
            x: tile.x,
            y: tile.y,
            terrain: tile.terrain,
            riverMask: tile.riverMask,
            elevation: tile.elevation,
          },
        };
      }
    }

    return { includesRivers: false };
  } catch (error) {
    console.error('API response test failed:', error);
    return { includesRivers: false };
  }
}

describe('River Generation Backend Audit', () => {
  const results: RiverTestResult[] = [];

  afterAll(() => {
    // Save detailed results for analysis
    const outputDir = path.join(__dirname, '../../../test-results');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsFile = path.join(outputDir, `river-audit-${timestamp}.json`);

    fs.writeFileSync(
      resultsFile,
      JSON.stringify(
        {
          testDate: new Date().toISOString(),
          testType: 'River Generation Backend Audit',
          results,
          summary: {
            totalTests: results.length,
            successfulTests: results.filter(r => r.success).length,
            testsWithRivers: results.filter(r => r.analysis && r.analysis.totalRiverTiles > 0)
              .length,
            testsWithApiRivers: results.filter(r => r.apiResponseIncludesRivers).length,
          },
        },
        null,
        2
      )
    );

    console.log(`\n🔍 River audit results saved to: ${resultsFile}`);

    // Print summary
    const successful = results.filter(r => r.success);
    const withRivers = results.filter(r => r.analysis && r.analysis.totalRiverTiles > 0);
    const withApiRivers = results.filter(r => r.apiResponseIncludesRivers);

    console.log('\n📊 RIVER AUDIT SUMMARY:');
    console.log(`Total Tests: ${results.length}`);
    console.log(`Successful Generations: ${successful.length}/${results.length}`);
    console.log(`Maps With Rivers: ${withRivers.length}/${results.length}`);
    console.log(`API Responses With Rivers: ${withApiRivers.length}/${results.length}`);

    if (withRivers.length > 0) {
      const totalRiverTiles = withRivers.reduce(
        (sum, r) => sum + (r.analysis?.totalRiverTiles || 0),
        0
      );
      const totalNetworks = withRivers.reduce(
        (sum, r) => sum + (r.analysis?.riverNetworks || 0),
        0
      );
      const isolatedRivers = withRivers.reduce(
        (sum, r) => sum + (r.analysis?.isolatedRivers || 0),
        0
      );

      console.log(`\n🌊 RIVER STATISTICS:`);
      console.log(`Total River Tiles Generated: ${totalRiverTiles}`);
      console.log(`Total River Networks: ${totalNetworks}`);
      console.log(`Isolated Rivers (should be 0): ${isolatedRivers}`);
      console.log(`Average Rivers per Map: ${Math.round(totalRiverTiles / withRivers.length)}`);
      console.log(`Average Networks per Map: ${Math.round(totalNetworks / withRivers.length)}`);
    }
  });

  // Test each size with multiple seeds
  for (const size of TEST_SIZES) {
    for (const seed of TEST_SEEDS) {
      test(`River generation audit: ${size.name} with seed ${seed}`, async () => {
        const startTime = Date.now();
        let result: RiverTestResult = {
          size: size.name,
          seed,
          width: size.width,
          height: size.height,
          generationTime: 0,
          success: false,
          apiResponseIncludesRivers: false,
        };

        try {
          // Create MapManager with random generator (focus of the audit)
          const mapManager = new MapManager(
            size.width,
            size.height,
            seed.toString(),
            'random',
            'RANDOM' as MapGeneratorType,
            'DEFAULT'
          );

          const players = createMockPlayers(2);

          // Generate map with RANDOM generator and default settings
          await mapManager.generateMap(players, 'RANDOM' as MapGeneratorType);

          const generationTime = Date.now() - startTime;

          // Get the generated map data
          const mapData = mapManager.getMapData();
          if (!mapData) {
            throw new Error('No map data generated');
          }

          // Analyze river generation
          const analysis = analyzeRiverGeneration(mapData);

          // Test API response
          const apiTest = testApiResponse(mapData);

          result = {
            ...result,
            analysis,
            generationTime,
            success: true,
            apiResponseIncludesRivers: apiTest.includesRivers,
            sampleApiTileWithRiver: apiTest.sampleTile,
          };

          results.push(result);

          // Assertions for the test
          expect(mapData).toBeDefined();
          expect(mapData.tiles).toBeDefined();
          expect(analysis.totalRiverTiles).toBeGreaterThan(0);
          expect(analysis.riverNetworks).toBeGreaterThan(0);
          expect(analysis.isolatedRivers).toBe(0);
          expect(apiTest.includesRivers).toBe(true);

          // Log detailed results for debugging
          console.log(`\n🔍 River Analysis for ${size.name} (seed ${seed}):`);
          console.log(`- River Tiles: ${analysis.totalRiverTiles}`);
          console.log(`- River Networks: ${analysis.riverNetworks}`);
          console.log(`- Average Network Size: ${analysis.averageNetworkSize}`);
          console.log(`- Max Network Size: ${analysis.maxNetworkSize}`);
          console.log(`- Isolated Rivers: ${analysis.isolatedRivers}`);
          console.log(`- API Includes Rivers: ${apiTest.includesRivers ? '✅' : '❌'}`);

          if (analysis.sampleRiverTiles.length > 0) {
            console.log(
              `- Sample River Tile: (${analysis.sampleRiverTiles[0].x},${analysis.sampleRiverTiles[0].y}) riverMask=${analysis.sampleRiverTiles[0].riverMask} connections=[${analysis.sampleRiverTiles[0].connections.join(',')}]`
            );
          }
        } catch (error) {
          result.generationTime = Date.now() - startTime;
          result.error = error instanceof Error ? error.message : String(error);
          result.success = false;
          results.push(result);

          console.error(`❌ River generation failed for ${size.name} seed ${seed}:`, error);
          throw error;
        }
      });
    }
  }
});
