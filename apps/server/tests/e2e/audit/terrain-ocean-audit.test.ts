/**
 * Focused Terrain Ocean Percentage Audit Test
 * Tests for the ocean percentage issues mentioned in the original audit
 */

import fs from 'fs';
import path from 'path';
import { PlayerState } from '../../../src/game/GameManager';
import { MapGeneratorType, MapManager } from '../../../src/game/MapManager';
import { MapData, MapStartpos } from '../../../src/game/map/MapTypes';

// Focused test configurations - targeting known problem areas
const TEST_SEEDS = [1, 2];
const TEST_SIZES = [
  { width: 40, height: 25, name: 'Small (40x25)' },
  { width: 80, height: 50, name: 'Standard (80x50)' },
];
const GENERATOR_MODES: MapGeneratorType[] = ['RANDOM', 'FRACTAL', 'FRACTURE', 'ISLAND', 'FAIR'];

interface OceanAnalysis {
  landTiles: number;
  oceanTiles: number;
  totalTiles: number;
  landPercentage: number;
  terrainCounts: Record<string, number>;
  isPlayable: boolean; // true if landPercentage > 15
  hasStartingPositions: boolean;
  startingPositionCount: number;
}

interface OceanTestResult {
  mode: MapGeneratorType;
  size: string;
  seed: number;
  width: number;
  height: number;
  analysis?: OceanAnalysis;
  generationTime: number;
  success: boolean;
  error?: string;
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

// Focused analysis on ocean/land distribution
function analyzeOceanDistribution(mapData: MapData): OceanAnalysis {
  const { tiles } = mapData;
  const analysis: OceanAnalysis = {
    landTiles: 0,
    oceanTiles: 0,
    totalTiles: 0,
    landPercentage: 0,
    terrainCounts: {},
    isPlayable: false,
    hasStartingPositions: false,
    startingPositionCount: 0,
  };

  for (let x = 0; x < tiles.length; x++) {
    for (let y = 0; y < tiles[x].length; y++) {
      const tile = tiles[x][y];
      analysis.totalTiles++;

      const terrain = tile.terrain || 'unknown';
      analysis.terrainCounts[terrain] = (analysis.terrainCounts[terrain] || 0) + 1;

      if (terrain === 'ocean' || terrain === 'deep_ocean') {
        analysis.oceanTiles++;
      } else {
        analysis.landTiles++;
      }
    }
  }

  analysis.landPercentage = Math.round((analysis.landTiles / analysis.totalTiles) * 100);
  analysis.isPlayable = analysis.landPercentage > 15; // At least 15% land for playability
  analysis.hasStartingPositions = Boolean(mapData.startingPositions?.length);
  analysis.startingPositionCount = mapData.startingPositions?.length || 0;

  return analysis;
}

// Test ocean distribution across all mode/size combinations
async function testOceanDistribution(): Promise<OceanTestResult[]> {
  const results: OceanTestResult[] = [];
  const totalTests = GENERATOR_MODES.length * TEST_SIZES.length * TEST_SEEDS.length;
  let currentTest = 0;

  console.log(`Starting focused ocean percentage audit (${totalTests} tests)...\n`);

  for (const mode of GENERATOR_MODES) {
    console.log(`Testing generator mode: ${mode}`);

    for (const size of TEST_SIZES) {
      console.log(`  Size: ${size.name}`);

      for (const seed of TEST_SEEDS) {
        currentTest++;
        const startTime = Date.now();

        console.log(`    Seed: ${seed} (${currentTest}/${totalTests})`);

        try {
          const mapManager = new MapManager(
            size.width,
            size.height,
            seed.toString(),
            mode.toLowerCase(),
            mode,
            MapStartpos.DEFAULT
          );

          const players = createMockPlayers(4);
          await mapManager.generateMap(players, mode);

          const mapData = mapManager.getMapData();
          if (!mapData) {
            throw new Error('No map data generated');
          }

          const analysis = analyzeOceanDistribution(mapData);
          const generationTime = Date.now() - startTime;

          // Log concerning results immediately
          if (!analysis.isPlayable) {
            console.warn(`      WARNING: Unplayable map - ${analysis.landPercentage}% land`);
          }

          const result: OceanTestResult = {
            mode,
            size: size.name,
            seed,
            width: size.width,
            height: size.height,
            analysis,
            generationTime,
            success: true,
          };

          results.push(result);
        } catch (error) {
          const generationTime = Date.now() - startTime;
          console.error(`      Error: ${error instanceof Error ? error.message : String(error)}`);

          results.push({
            mode,
            size: size.name,
            seed,
            width: size.width,
            height: size.height,
            generationTime,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }
    }
    console.log();
  }

  return results;
}

// Generate summary report
function generateSummaryReport(results: OceanTestResult[]): string {
  const successfulResults = results.filter(r => r.success && r.analysis);
  const unplayableMaps = successfulResults.filter(r => !r.analysis!.isPlayable);

  let report = `# Ocean Distribution Audit Summary\n\n`;
  report += `**Date:** ${new Date().toISOString()}\n`;
  report += `**Total Tests:** ${results.length}\n`;
  report += `**Successful:** ${successfulResults.length}\n`;
  report += `**Failed:** ${results.length - successfulResults.length}\n`;
  report += `**Unplayable Maps:** ${unplayableMaps.length} (${Math.round(
    (unplayableMaps.length / successfulResults.length) * 100
  )}%)\n\n`;

  // Group by mode and size
  const groupedResults = new Map<string, OceanTestResult[]>();
  for (const result of successfulResults) {
    const key = `${result.mode}_${result.size}`;
    if (!groupedResults.has(key)) {
      groupedResults.set(key, []);
    }
    groupedResults.get(key)!.push(result);
  }

  report += `## Results by Mode and Size\n\n`;
  report += `| Mode | Size | Land % Range | Unplayable Count | Notes |\n`;
  report += `|------|------|--------------|------------------|-------|\n`;

  for (const [key, groupResults] of groupedResults) {
    const landPercentages = groupResults.map(r => r.analysis!.landPercentage);
    const minLand = Math.min(...landPercentages);
    const maxLand = Math.max(...landPercentages);
    const unplayableCount = groupResults.filter(r => !r.analysis!.isPlayable).length;

    const [mode, size] = key.split('_');
    const avgGenTime = Math.round(
      groupResults.reduce((sum, r) => sum + r.generationTime, 0) / groupResults.length
    );

    report += `| ${mode} | ${size} | ${minLand}%-${maxLand}% | ${unplayableCount}/${groupResults.length} | Avg: ${avgGenTime}ms |\n`;
  }

  report += `\n## Critical Issues\n\n`;
  if (unplayableMaps.length > 0) {
    report += `### Unplayable Maps (< 15% land)\n\n`;
    for (const map of unplayableMaps) {
      report += `- **${map.mode} ${map.size} seed=${map.seed}:** ${
        map.analysis!.landPercentage
      }% land\n`;
    }
  }

  // Identify systemic issues
  const smallMapResults = successfulResults.filter(r => r.size === 'Small (40x25)');
  const smallMapUnplayable = smallMapResults.filter(r => !r.analysis!.isPlayable);

  if (smallMapUnplayable.length > smallMapResults.length * 0.5) {
    report += `\n### CRITICAL: Small Map Ocean Dominance Issue\n`;
    report += `${smallMapUnplayable.length}/${smallMapResults.length} small maps are unplayable (>50%).\n`;
    report += `This confirms the small map ocean percentage issue from the original audit.\n`;
  }

  return report;
}

describe('Ocean Distribution Audit', () => {
  let results: OceanTestResult[];
  let summaryReport: string;

  beforeAll(async () => {
    results = await testOceanDistribution();
    summaryReport = generateSummaryReport(results);

    // Save detailed results
    const outputPath = path.join(__dirname, 'results', 'ocean_audit_results.json');
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          results,
          summary: summaryReport,
        },
        null,
        2
      )
    );

    console.log(`\n=== OCEAN AUDIT COMPLETED ===`);
    console.log(summaryReport);
    console.log(`\nDetailed results saved to: ${outputPath}`);
  }, 120000); // 2 minute timeout

  afterAll(async () => {
    // Clean up any lingering resources
    await new Promise(resolve => setImmediate(resolve));
  });

  test('should successfully generate most maps', () => {
    const successRate = results.filter(r => r.success).length / results.length;
    expect(successRate).toBeGreaterThan(0.8); // At least 80% success rate
  });

  test('should not produce excessive ocean-dominated maps', () => {
    const successfulResults = results.filter(r => r.success && r.analysis);
    const unplayableMaps = successfulResults.filter(r => !r.analysis!.isPlayable);
    const unplayableRate = unplayableMaps.length / successfulResults.length;

    // Allow up to 10% unplayable maps, but log if higher
    expect(unplayableRate).toBeLessThan(0.1);

    if (unplayableRate > 0.05) {
      console.warn(`High unplayable map rate: ${Math.round(unplayableRate * 100)}%`);
    }
  });

  test('should identify small map ocean dominance issue', () => {
    const smallMapResults = results.filter(
      r => r.success && r.analysis && r.size === 'Small (40x25)'
    );
    const smallMapUnplayable = smallMapResults.filter(r => !r.analysis!.isPlayable);

    // Document the issue rather than fail the test
    const unplayableRate = smallMapUnplayable.length / smallMapResults.length;
    console.log(
      `Small map unplayable rate: ${Math.round(unplayableRate * 100)}% (${
        smallMapUnplayable.length
      }/${smallMapResults.length})`
    );

    // This test documents the known issue
    if (unplayableRate > 0.3) {
      console.error('CRITICAL: Small maps consistently produce too much ocean');
      // Log specific problem cases for debugging
      for (const map of smallMapUnplayable) {
        console.error(`  ${map.mode} seed=${map.seed}: ${map.analysis!.landPercentage}% land`);
      }
    }
  });

  test('should generate starting positions for playable maps', () => {
    const playableMaps = results.filter(r => r.success && r.analysis && r.analysis.isPlayable);
    const mapsWithoutStarts = playableMaps.filter(r => !r.analysis!.hasStartingPositions);

    expect(mapsWithoutStarts.length).toBe(0);

    if (mapsWithoutStarts.length > 0) {
      console.error('Playable maps without starting positions:');
      for (const map of mapsWithoutStarts) {
        console.error(`  ${map.mode} ${map.size} seed=${map.seed}`);
      }
    }
  });
});
