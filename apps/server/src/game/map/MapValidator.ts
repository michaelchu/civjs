import { MapTile, TerrainType } from './MapTypes';
import { PlayerState } from '../GameManager';
import { logger } from '../../utils/logger';

export interface ValidationResult {
  passed: boolean;
  score: number;
  issues: ValidationIssue[];
  metrics: ValidationMetrics;
}

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info';
  category: 'terrain' | 'continent' | 'position' | 'performance';
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidationMetrics {
  landPercentage: number;
  oceanPercentage: number;
  terrainDistribution: Record<TerrainType, number>;
  continentCount: number;
  continentSizes: number[];
  averageContinentSize: number;
  largestContinentSize: number;
  smallestContinentSize: number;
  startingPositionDistance: {
    average: number;
    minimum: number;
    maximum: number;
  };
  riverMetrics?: {
    totalRiverLength: number;
    riverPercentage: number;
    riverNetworks: number;
    averageNetworkSize: number;
    averageRiverMask: number;
  };
  performanceMetrics: {
    generationTimeMs?: number;
    memoryUsageMB?: number;
    tilesPerSecond?: number;
  };
}

export interface Position {
  x: number;
  y: number;
  playerId?: string;
}

/**
 * Comprehensive map validation system for terrain generation quality assurance
 * Implements validation checks similar to freeciv's map validation routines
 * @reference freeciv/server/generator/mapgen.c validation functions
 */
export class MapValidator {
  private width: number;
  private height: number;
  private totalTiles: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.totalTiles = width * height;
  }

  /**
   * Comprehensive map validation that runs all validation checks
   * @param tiles Generated map tiles
   * @param startingPositions Array of starting positions
   * @param players Player states for validation context
   * @param performanceData Optional performance metrics from generation
   * @param terrainParams Optional terrain parameters used for generation
   * @returns Overall validation result with aggregated score
   */
  public validateMap(
    tiles: MapTile[][],
    startingPositions?: Position[],
    players?: Map<string, PlayerState>,
    performanceData?: { generationTimeMs: number; memoryUsageMB?: number },
    terrainParams?: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    }
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const metrics = this.calculateMetrics(tiles, startingPositions, performanceData);

    logger.debug('Starting comprehensive map validation', {
      width: this.width,
      height: this.height,
      totalTiles: this.totalTiles,
      startingPositions: startingPositions?.length || 0,
      players: players?.size || 0,
    });

    // Run terrain distribution validation
    const terrainResult = this.validateTerrainDistribution(tiles);
    issues.push(...terrainResult.issues);

    // Run continent validation
    const continentResult = this.validateContinentSizes(tiles);
    issues.push(...continentResult.issues);

    // Run river validation (Task 4.1)
    const riverResult = this.validateRiverDistribution(tiles, terrainParams?.river_pct);
    issues.push(...riverResult.issues);

    // Run parameter compliance validation (Task 4.2)
    if (terrainParams) {
      const parameterResult = this.validateParameterCompliance(tiles, terrainParams);
      issues.push(...parameterResult.issues);
    }

    // Run starting position validation if positions provided
    if (startingPositions && startingPositions.length > 0) {
      const positionResult = this.validateStartingPositions(tiles, startingPositions);
      issues.push(...positionResult.issues);
    }

    // Run performance validation if data provided
    if (performanceData) {
      const performanceResult = this.validatePerformanceMetrics(performanceData);
      issues.push(...performanceResult.issues);
    }

    // Calculate overall validation score (0-100)
    const score = this.calculateOverallScore(terrainResult, continentResult, issues);

    const result: ValidationResult = {
      passed: score >= 70, // 70% threshold for passing validation
      score,
      issues,
      metrics,
    };

    logger.info('Map validation completed', {
      passed: result.passed,
      score: result.score,
      issuesCount: issues.length,
      errorCount: issues.filter(i => i.severity === 'error').length,
      warningCount: issues.filter(i => i.severity === 'warning').length,
    });

    return result;
  }

  /**
   * Validate terrain type distribution for realistic world generation
   * @reference freeciv/server/generator/mapgen.c terrain distribution checks
   * @param tiles Generated map tiles
   * @returns Validation result for terrain distribution
   */
  public validateTerrainDistribution(tiles: MapTile[][]): ValidationResult {
    const issues: ValidationIssue[] = [];
    const terrainCounts: Record<TerrainType, number> = {} as Record<TerrainType, number>;

    // Handle empty tiles array
    if (!tiles || tiles.length === 0 || !tiles[0] || tiles[0].length === 0) {
      issues.push({
        severity: 'error',
        category: 'terrain',
        message: 'No map tiles provided for validation',
        details: { tilesProvided: false },
      });
      return {
        passed: false,
        score: 0,
        issues,
        metrics: this.getEmptyMetrics(),
      };
    }

    // Count terrain types
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x] && tiles[x][y]) {
          const terrain = tiles[x][y].terrain;
          terrainCounts[terrain] = (terrainCounts[terrain] || 0) + 1;
        }
      }
    }

    // Calculate percentages
    const terrainPercentages: Record<TerrainType, number> = {} as Record<TerrainType, number>;
    Object.keys(terrainCounts).forEach(terrain => {
      terrainPercentages[terrain as TerrainType] =
        (terrainCounts[terrain as TerrainType] / this.totalTiles) * 100;
    });

    // Validate land/ocean ratio (target: 20-40% land)
    const landTerrains: TerrainType[] = [
      'grassland',
      'plains',
      'desert',
      'tundra',
      'snow',
      'forest',
      'jungle',
      'swamp',
      'hills',
      'mountains',
    ];

    const landPercentage = landTerrains.reduce(
      (sum, terrain) => sum + (terrainPercentages[terrain] || 0),
      0
    );

    // Validate land percentage (freeciv typically uses 20-40%)
    if (landPercentage < 15) {
      issues.push({
        severity: 'error',
        category: 'terrain',
        message: 'Land percentage too low - map may be unplayable',
        details: { landPercentage, target: '20-40%' },
      });
    } else if (landPercentage < 20) {
      issues.push({
        severity: 'warning',
        category: 'terrain',
        message: 'Land percentage below recommended range',
        details: { landPercentage, target: '20-40%' },
      });
    } else if (landPercentage > 60) {
      issues.push({
        severity: 'error',
        category: 'terrain',
        message: 'Land percentage too high - insufficient ocean',
        details: { landPercentage, target: '20-40%' },
      });
    } else if (landPercentage > 40) {
      issues.push({
        severity: 'warning',
        category: 'terrain',
        message: 'Land percentage above recommended range',
        details: { landPercentage, target: '20-40%' },
      });
    }

    // Validate terrain variety (no single terrain should dominate)
    Object.entries(terrainPercentages).forEach(([terrain, percentage]) => {
      if (terrain !== 'ocean' && percentage > 50) {
        issues.push({
          severity: 'error',
          category: 'terrain',
          message: `Terrain '${terrain}' dominates the map`,
          details: { terrain, percentage, threshold: '50%' },
        });
      } else if (terrain !== 'ocean' && percentage > 30) {
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Terrain '${terrain}' percentage high`,
          details: { terrain, percentage, threshold: '30%' },
        });
      }
    });

    // Validate essential terrain presence
    const essentialTerrains: TerrainType[] = ['grassland', 'plains', 'forest'];
    essentialTerrains.forEach(terrain => {
      if (!terrainPercentages[terrain] || terrainPercentages[terrain] < 1) {
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Essential terrain '${terrain}' is missing or very rare`,
          details: { terrain, percentage: terrainPercentages[terrain] || 0 },
        });
      }
    });

    const score = this.calculateTerrainScore(terrainPercentages, issues);
    const metrics = this.calculateMetrics(tiles);

    return {
      passed: score >= 70,
      score,
      issues,
      metrics,
    };
  }

  /**
   * Validate continent sizes and connectivity for balanced gameplay
   * @reference freeciv/server/generator/mapgen.c continent analysis
   * @param tiles Generated map tiles
   * @returns Validation result for continent distribution
   */
  public validateContinentSizes(tiles: MapTile[][]): ValidationResult {
    const issues: ValidationIssue[] = [];
    const continentSizes: Record<number, number> = {};

    // Count tiles per continent
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.continentId > 0) {
          continentSizes[tile.continentId] = (continentSizes[tile.continentId] || 0) + 1;
        }
      }
    }

    const continentSizeArray = Object.values(continentSizes).sort((a, b) => b - a);
    const continentCount = continentSizeArray.length;

    if (continentCount === 0) {
      issues.push({
        severity: 'error',
        category: 'continent',
        message: 'No continents found - map generation failed',
        details: { continentCount },
      });
      return {
        passed: false,
        score: 0,
        issues,
        metrics: this.calculateMetrics(tiles),
      };
    }

    const largestContinent = continentSizeArray[0];
    const averageContinentSize = continentSizeArray.reduce((a, b) => a + b, 0) / continentCount;

    // Validate continent count (should be reasonable for map size)
    const expectedContinents = Math.max(1, Math.floor(this.totalTiles / 5000)); // Rough estimate
    if (continentCount > expectedContinents * 3) {
      issues.push({
        severity: 'warning',
        category: 'continent',
        message: 'Too many small continents - may fragment gameplay',
        details: { continentCount, expected: expectedContinents },
      });
    } else if (continentCount < Math.max(1, expectedContinents / 2)) {
      issues.push({
        severity: 'warning',
        category: 'continent',
        message: 'Too few continents - may limit strategic options',
        details: { continentCount, expected: expectedContinents },
      });
    }

    // Validate continent size distribution
    const totalLandTiles = continentSizeArray.reduce((a, b) => a + b, 0);
    const largestContinentRatio = largestContinent / totalLandTiles;

    if (largestContinentRatio > 0.8) {
      issues.push({
        severity: 'warning',
        category: 'continent',
        message: 'Single continent dominates the map',
        details: { largestContinentRatio: Math.round(largestContinentRatio * 100) },
      });
    }

    // Validate minimum continent sizes (avoid tiny islands unless intentional)
    const tinyIslands = continentSizeArray.filter(size => size < 10).length;
    if (tinyIslands > continentCount / 2) {
      issues.push({
        severity: 'warning',
        category: 'continent',
        message: 'Too many tiny islands (< 10 tiles)',
        details: { tinyIslands, totalContinents: continentCount },
      });
    }

    // Validate connectivity (basic check for isolated single tiles)
    const isolatedTiles = this.findIsolatedLandTiles(tiles);
    if (isolatedTiles > totalLandTiles * 0.05) {
      issues.push({
        severity: 'warning',
        category: 'continent',
        message: 'High number of isolated land tiles',
        details: { isolatedTiles, percentage: (isolatedTiles / totalLandTiles) * 100 },
      });
    }

    const score = this.calculateContinentScore(
      continentCount,
      largestContinentRatio,
      averageContinentSize,
      issues
    );

    return {
      passed: score >= 70,
      score,
      issues,
      metrics: this.calculateMetrics(tiles),
    };
  }

  /**
   * Validate starting positions for fair and balanced gameplay
   * @reference freeciv/server/generator/startpos.c validation routines
   * @param tiles Generated map tiles
   * @param startPos Array of starting positions to validate
   * @returns Validation result for starting positions
   */
  public validateStartingPositions(tiles: MapTile[][], startPos: Position[]): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (startPos.length === 0) {
      issues.push({
        severity: 'error',
        category: 'position',
        message: 'No starting positions provided',
        details: { positionCount: 0 },
      });
      return {
        passed: false,
        score: 0,
        issues,
        metrics: this.calculateMetrics(tiles, startPos),
      };
    }

    // Validate position validity
    const validPositions = startPos.filter(pos => {
      if (pos.x < 0 || pos.x >= this.width || pos.y < 0 || pos.y >= this.height) {
        issues.push({
          severity: 'error',
          category: 'position',
          message: 'Starting position outside map bounds',
          details: { position: pos, mapBounds: { width: this.width, height: this.height } },
        });
        return false;
      }

      const tile = tiles[pos.x][pos.y];
      if (tile.terrain === 'ocean' || tile.terrain === 'deep_ocean') {
        issues.push({
          severity: 'error',
          category: 'position',
          message: 'Starting position in ocean',
          details: { position: pos, terrain: tile.terrain },
        });
        return false;
      }

      return true;
    });

    if (validPositions.length === 0) {
      return {
        passed: false,
        score: 0,
        issues,
        metrics: this.calculateMetrics(tiles, startPos),
      };
    }

    // Calculate distances between starting positions
    const distances: number[] = [];
    for (let i = 0; i < validPositions.length; i++) {
      for (let j = i + 1; j < validPositions.length; j++) {
        const pos1 = validPositions[i];
        const pos2 = validPositions[j];
        const distance = Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
        distances.push(distance);
      }
    }

    if (distances.length > 0) {
      const averageDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      const minDistance = Math.min(...distances);
      const maxDistance = Math.max(...distances);

      // Validate minimum distance (positions shouldn't be too close)
      const minExpectedDistance = Math.min(this.width, this.height) / 8;
      if (minDistance < minExpectedDistance) {
        issues.push({
          severity: 'warning',
          category: 'position',
          message: 'Starting positions too close together',
          details: { minDistance, expected: minExpectedDistance },
        });
      }

      // Validate maximum distance (positions shouldn't be too far apart)
      const maxExpectedDistance = Math.max(this.width, this.height);
      if (maxDistance > maxExpectedDistance) {
        issues.push({
          severity: 'warning',
          category: 'position',
          message: 'Some starting positions very far apart',
          details: { maxDistance, expected: maxExpectedDistance },
        });
      }

      // Validate distance variance (fairly balanced distribution)
      const distanceVariance =
        distances.reduce((sum, d) => sum + Math.pow(d - averageDistance, 2), 0) / distances.length;
      const distanceStdDev = Math.sqrt(distanceVariance);

      if (distanceStdDev > averageDistance * 0.5) {
        issues.push({
          severity: 'warning',
          category: 'position',
          message: 'Uneven distribution of starting positions',
          details: {
            averageDistance: Math.round(averageDistance),
            standardDeviation: Math.round(distanceStdDev),
          },
        });
      }
    }

    // Validate position quality (terrain around starting positions)
    validPositions.forEach((pos, index) => {
      const quality = this.assessStartingPositionQuality(tiles, pos);
      if (quality.score < 50) {
        issues.push({
          severity: 'warning',
          category: 'position',
          message: `Poor quality starting position ${index + 1}`,
          details: {
            position: pos,
            quality: quality.score,
            issues: quality.issues,
          },
        });
      }
    });

    const score = this.calculateStartingPositionScore(distances, validPositions.length, issues);

    return {
      passed: score >= 70,
      score,
      issues,
      metrics: this.calculateMetrics(tiles, startPos),
    };
  }

  /**
   * Validate performance metrics against expected benchmarks
   * @param performanceData Performance data from map generation
   * @returns Validation result for performance metrics
   */
  private validatePerformanceMetrics(performanceData: {
    generationTimeMs: number;
    memoryUsageMB?: number;
  }): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Validate generation time (should scale reasonably with map size)
    const expectedTimeMs = (this.totalTiles / 1000) * 100; // 100ms per 1000 tiles baseline
    const maxReasonableTime = expectedTimeMs * 5; // 5x baseline is concerning

    if (performanceData.generationTimeMs > maxReasonableTime) {
      issues.push({
        severity: 'warning',
        category: 'performance',
        message: 'Map generation took significantly longer than expected',
        details: {
          actualTime: performanceData.generationTimeMs,
          expectedTime: expectedTimeMs,
          ratio: performanceData.generationTimeMs / expectedTimeMs,
        },
      });
    }

    // Validate memory usage if provided
    if (performanceData.memoryUsageMB !== undefined) {
      const expectedMemoryMB = (this.totalTiles / 10000) * 50; // 50MB per 10k tiles baseline
      const maxReasonableMemory = expectedMemoryMB * 3;

      if (performanceData.memoryUsageMB > maxReasonableMemory) {
        issues.push({
          severity: 'warning',
          category: 'performance',
          message: 'Memory usage higher than expected',
          details: {
            actualMemory: performanceData.memoryUsageMB,
            expectedMemory: expectedMemoryMB,
            ratio: performanceData.memoryUsageMB / expectedMemoryMB,
          },
        });
      }
    }

    const score = issues.length === 0 ? 100 : Math.max(50, 100 - issues.length * 20);

    return {
      passed: score >= 70,
      score,
      issues,
      metrics: {
        landPercentage: 0,
        oceanPercentage: 0,
        terrainDistribution: {} as Record<TerrainType, number>,
        continentCount: 0,
        continentSizes: [],
        averageContinentSize: 0,
        largestContinentSize: 0,
        smallestContinentSize: 0,
        startingPositionDistance: {
          average: 0,
          minimum: 0,
          maximum: 0,
        },
        performanceMetrics: {
          generationTimeMs: performanceData.generationTimeMs,
          memoryUsageMB: performanceData.memoryUsageMB,
          tilesPerSecond: this.totalTiles / (performanceData.generationTimeMs / 1000),
        },
      },
    };
  }

  /**
   * Validate river distribution and connectivity for realistic water networks
   * @reference freeciv/server/generator/mapgen.c:3000-3100 river validation
   * @param tiles Generated map tiles
   * @param expectedRiverPct Expected river percentage from terrain parameters
   * @returns Validation result for river distribution
   */
  public validateRiverDistribution(
    tiles: MapTile[][],
    expectedRiverPct?: number
  ): ValidationResult {
    const issues: ValidationIssue[] = [];

    // Count tiles with rivers (riverMask > 0)
    const riverTiles = tiles.flat().filter(tile => tile.riverMask && tile.riverMask > 0);
    const landTiles = tiles.flat().filter(tile => this.isLandTile(tile.terrain));
    const totalTiles = tiles.flat().length;

    logger.debug('River validation started', {
      riverTiles: riverTiles.length,
      landTiles: landTiles.length,
      totalTiles,
      expectedRiverPct,
    });

    // Validate river presence (error if no rivers found)
    if (riverTiles.length === 0) {
      issues.push({
        severity: 'error',
        category: 'terrain',
        message: 'No rivers found on map - river generation may have failed',
        details: { riverTiles: 0, landTiles: landTiles.length },
      });
    } else {
      // Calculate actual river percentage
      const actualRiverPct = (riverTiles.length / landTiles.length) * 100;

      // Validate river density matches expected percentage (± 2%)
      if (expectedRiverPct !== undefined) {
        const deviation = Math.abs(actualRiverPct - expectedRiverPct);

        if (deviation > 3) {
          issues.push({
            severity: 'error',
            category: 'terrain',
            message: `River percentage (${actualRiverPct.toFixed(1)}%) significantly differs from expected (${expectedRiverPct.toFixed(1)}%)`,
            details: {
              actualRiverPct: Number(actualRiverPct.toFixed(1)),
              expectedRiverPct: Number(expectedRiverPct.toFixed(1)),
              deviation: Number(deviation.toFixed(1)),
            },
          });
        } else if (deviation > 2) {
          issues.push({
            severity: 'warning',
            category: 'terrain',
            message: `River percentage (${actualRiverPct.toFixed(1)}%) differs from expected (${expectedRiverPct.toFixed(1)}%)`,
            details: {
              actualRiverPct: Number(actualRiverPct.toFixed(1)),
              expectedRiverPct: Number(expectedRiverPct.toFixed(1)),
              deviation: Number(deviation.toFixed(1)),
            },
          });
        }
      }

      // Validate river connectivity (rivers form networks)
      const connectivityIssues = this.validateRiverConnectivity(tiles, riverTiles);
      issues.push(...connectivityIssues);
    }

    // Calculate river-specific metrics
    const riverMetrics = this.calculateRiverMetrics(tiles, riverTiles);

    const score = this.calculateRiverScore(
      riverTiles.length,
      landTiles.length,
      expectedRiverPct,
      issues
    );
    const metrics = this.calculateMetrics(tiles);

    logger.debug('River validation completed', {
      score,
      issuesCount: issues.length,
      riverMetrics,
    });

    return {
      passed: score >= 70,
      score,
      issues,
      metrics,
    };
  }

  /**
   * Validate parameter compliance - verify calculated terrain parameters are reflected in final map
   * @reference freeciv/server/generator/mapgen.c:2850-2950 adjust_terrain_param() validation
   * @param tiles Generated map tiles
   * @param terrainParams Expected terrain parameters used during generation
   * @returns Validation result for parameter compliance
   */
  public validateParameterCompliance(
    tiles: MapTile[][],
    terrainParams: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    }
  ): ValidationResult {
    const issues: ValidationIssue[] = [];
    const flatTiles = tiles.flat();
    const landTiles = flatTiles.filter(tile => this.isLandTile(tile.terrain));

    logger.debug('Parameter compliance validation started', terrainParams);

    // Validate each terrain parameter against actual distribution
    const actualDistribution = this.calculateActualTerrainDistribution(flatTiles, landTiles);

    // Check river percentage
    if (terrainParams.river_pct > 0) {
      const deviation = Math.abs(actualDistribution.river_pct - terrainParams.river_pct);
      if (deviation > 3) {
        issues.push({
          severity: 'error',
          category: 'terrain',
          message: `River parameter compliance failed: expected ${terrainParams.river_pct}%, actual ${actualDistribution.river_pct}%`,
          details: {
            parameter: 'river_pct',
            expected: terrainParams.river_pct,
            actual: actualDistribution.river_pct,
            deviation,
          },
        });
      }
    }

    // Check forest percentage
    if (terrainParams.forest_pct > 0) {
      const deviation = Math.abs(actualDistribution.forest_pct - terrainParams.forest_pct);
      if (deviation > 5) {
        // Slightly higher tolerance for forest
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Forest parameter compliance issue: expected ${terrainParams.forest_pct}%, actual ${actualDistribution.forest_pct}%`,
          details: {
            parameter: 'forest_pct',
            expected: terrainParams.forest_pct,
            actual: actualDistribution.forest_pct,
            deviation,
          },
        });
      }
    }

    // Check desert percentage
    if (terrainParams.desert_pct > 0) {
      const deviation = Math.abs(actualDistribution.desert_pct - terrainParams.desert_pct);
      if (deviation > 5) {
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Desert parameter compliance issue: expected ${terrainParams.desert_pct}%, actual ${actualDistribution.desert_pct}%`,
          details: {
            parameter: 'desert_pct',
            expected: terrainParams.desert_pct,
            actual: actualDistribution.desert_pct,
            deviation,
          },
        });
      }
    }

    // Check mountain percentage
    if (terrainParams.mountain_pct > 0) {
      const deviation = Math.abs(actualDistribution.mountain_pct - terrainParams.mountain_pct);
      if (deviation > 5) {
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Mountain parameter compliance issue: expected ${terrainParams.mountain_pct}%, actual ${actualDistribution.mountain_pct}%`,
          details: {
            parameter: 'mountain_pct',
            expected: terrainParams.mountain_pct,
            actual: actualDistribution.mountain_pct,
            deviation,
          },
        });
      }
    }

    // Check for signs of hardcoded overrides
    const hardcodedOverrideIssues = this.detectHardcodedOverrides(
      actualDistribution,
      terrainParams
    );
    issues.push(...hardcodedOverrideIssues);

    const score = this.calculateParameterComplianceScore(actualDistribution, terrainParams, issues);

    logger.debug('Parameter compliance validation completed', {
      score,
      issuesCount: issues.length,
      actualDistribution,
      terrainParams,
    });

    return {
      passed: score >= 70,
      score,
      issues,
      metrics: this.calculateMetrics(tiles),
    };
  }

  /**
   * Calculate comprehensive metrics for the generated map
   * @param tiles Generated map tiles
   * @param startingPositions Optional starting positions
   * @param performanceData Optional performance data
   * @returns Detailed validation metrics
   */
  private calculateMetrics(
    tiles: MapTile[][],
    startingPositions?: Position[],
    performanceData?: { generationTimeMs: number; memoryUsageMB?: number }
  ): ValidationMetrics {
    const terrainCounts: Record<TerrainType, number> = {} as Record<TerrainType, number>;
    const continentSizes: Record<number, number> = {};

    // Count terrain types and continent sizes
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        terrainCounts[tile.terrain] = (terrainCounts[tile.terrain] || 0) + 1;

        if (tile.continentId > 0) {
          continentSizes[tile.continentId] = (continentSizes[tile.continentId] || 0) + 1;
        }
      }
    }

    const continentSizeArray = Object.values(continentSizes);
    const landTiles = Object.entries(terrainCounts)
      .filter(([terrain]) => !['ocean', 'deep_ocean', 'coast'].includes(terrain))
      .reduce((sum, [, count]) => sum + count, 0);

    const oceanTiles = this.totalTiles - landTiles;

    // Calculate starting position distances if provided
    let startingPositionDistance = {
      average: 0,
      minimum: 0,
      maximum: 0,
    };

    if (startingPositions && startingPositions.length > 1) {
      const distances: number[] = [];
      for (let i = 0; i < startingPositions.length; i++) {
        for (let j = i + 1; j < startingPositions.length; j++) {
          const pos1 = startingPositions[i];
          const pos2 = startingPositions[j];
          const distance = Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
          distances.push(distance);
        }
      }

      if (distances.length > 0) {
        startingPositionDistance = {
          average: distances.reduce((a, b) => a + b, 0) / distances.length,
          minimum: Math.min(...distances),
          maximum: Math.max(...distances),
        };
      }
    }

    // Calculate river metrics
    const flatTilesForRivers = tiles.flat();
    const riverTiles = flatTilesForRivers.filter(tile => tile.riverMask && tile.riverMask > 0);
    const riverMetrics =
      riverTiles.length > 0
        ? {
            totalRiverLength: riverTiles.length,
            riverPercentage:
              landTiles > 0 ? Number(((riverTiles.length / landTiles) * 100).toFixed(1)) : 0,
            riverNetworks: this.countRiverNetworks(tiles, riverTiles),
            averageNetworkSize:
              riverTiles.length > 0
                ? Number(
                    (
                      riverTiles.length / Math.max(1, this.countRiverNetworks(tiles, riverTiles))
                    ).toFixed(1)
                  )
                : 0,
            averageRiverMask: Number(
              (
                riverTiles.reduce((sum, tile) => sum + tile.riverMask, 0) / riverTiles.length
              ).toFixed(2)
            ),
          }
        : undefined;

    return {
      landPercentage: (landTiles / this.totalTiles) * 100,
      oceanPercentage: (oceanTiles / this.totalTiles) * 100,
      terrainDistribution: Object.fromEntries(
        Object.entries(terrainCounts).map(([terrain, count]) => [
          terrain,
          (count / this.totalTiles) * 100,
        ])
      ) as Record<TerrainType, number>,
      continentCount: continentSizeArray.length,
      continentSizes: continentSizeArray.sort((a, b) => b - a),
      averageContinentSize:
        continentSizeArray.length > 0
          ? continentSizeArray.reduce((a, b) => a + b, 0) / continentSizeArray.length
          : 0,
      largestContinentSize: continentSizeArray.length > 0 ? continentSizeArray[0] : 0,
      smallestContinentSize:
        continentSizeArray.length > 0 ? continentSizeArray[continentSizeArray.length - 1] : 0,
      startingPositionDistance,
      riverMetrics,
      performanceMetrics: performanceData
        ? {
            generationTimeMs: performanceData.generationTimeMs,
            memoryUsageMB: performanceData.memoryUsageMB,
            tilesPerSecond: this.totalTiles / (performanceData.generationTimeMs / 1000),
          }
        : {},
    };
  }

  /**
   * Calculate terrain distribution score based on realistic world patterns
   * @param terrainPercentages Calculated terrain percentages
   * @param issues Array of issues found during validation
   * @returns Score from 0-100
   */
  private calculateTerrainScore(
    terrainPercentages: Record<TerrainType, number>,
    issues: ValidationIssue[]
  ): number {
    let score = 100;

    // Deduct points for errors and warnings
    issues.forEach(issue => {
      if (issue.severity === 'error') {
        score -= 20;
      } else if (issue.severity === 'warning') {
        score -= 10;
      }
    });

    // Reward balanced terrain distribution
    const landTerrains = ['grassland', 'plains', 'desert', 'forest', 'hills', 'mountains'];
    const terrainBalance = landTerrains.reduce((balance, terrain) => {
      const percentage = terrainPercentages[terrain as TerrainType] || 0;
      const ideal = 100 / landTerrains.length; // Even distribution ideal
      return balance - Math.abs(percentage - ideal);
    }, 0);

    score += Math.max(-20, terrainBalance / 5); // Bonus/penalty for balance

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate continent distribution score for strategic gameplay balance
   * @param continentCount Number of continents
   * @param largestContinentRatio Ratio of largest continent to total land
   * @param averageContinentSize Average size of continents
   * @param issues Array of issues found
   * @returns Score from 0-100
   */
  private calculateContinentScore(
    continentCount: number,
    largestContinentRatio: number,
    averageContinentSize: number,
    issues: ValidationIssue[]
  ): number {
    let score = 100;

    // Deduct points for issues
    issues.forEach(issue => {
      if (issue.severity === 'error') {
        score -= 25;
      } else if (issue.severity === 'warning') {
        score -= 15;
      }
    });

    // Reward reasonable continent count (neither too fragmented nor too unified)
    const expectedContinents = Math.max(1, Math.floor(this.totalTiles / 5000));
    const continentRatio = continentCount / expectedContinents;
    if (continentRatio >= 0.5 && continentRatio <= 2.0) {
      score += 10; // Bonus for reasonable continent count
    }

    // Reward balanced continent sizes (no single dominant continent)
    if (largestContinentRatio < 0.6) {
      score += 10; // Bonus for balanced continents
    }

    // Reward reasonable average continent size
    const expectedAvgSize = (this.totalTiles * 0.3) / Math.max(1, expectedContinents); // 30% land
    if (averageContinentSize > expectedAvgSize * 0.5) {
      score += 5; // Bonus for viable continent sizes
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate starting position score based on distance distribution and quality
   * @param distances Array of distances between starting positions
   * @param positionCount Number of valid starting positions
   * @param issues Array of issues found
   * @returns Score from 0-100
   */
  private calculateStartingPositionScore(
    distances: number[],
    _positionCount: number,
    issues: ValidationIssue[]
  ): number {
    let score = 100;

    // Deduct points for issues
    issues.forEach(issue => {
      if (issue.severity === 'error') {
        score -= 30;
      } else if (issue.severity === 'warning') {
        score -= 15;
      }
    });

    if (distances.length > 0) {
      const averageDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
      const expectedDistance = Math.min(this.width, this.height) / 4;

      // Reward reasonable average distance
      const distanceRatio = averageDistance / expectedDistance;
      if (distanceRatio >= 0.5 && distanceRatio <= 2.0) {
        score += 10;
      }

      // Reward consistent distances (low variance)
      const variance =
        distances.reduce((sum, d) => sum + Math.pow(d - averageDistance, 2), 0) / distances.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev < averageDistance * 0.3) {
        score += 10; // Bonus for consistent positioning
      }
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate overall validation score by combining all sub-scores
   * @param terrainResult Terrain validation result
   * @param continentResult Continent validation result
   * @param allIssues All issues found during validation
   * @returns Overall score from 0-100
   */
  private calculateOverallScore(
    terrainResult: ValidationResult,
    continentResult: ValidationResult,
    allIssues: ValidationIssue[]
  ): number {
    // Weight the different aspects of validation
    const terrainWeight = 0.4;
    const continentWeight = 0.3;
    const issueWeight = 0.3;

    const terrainScore = terrainResult.score * terrainWeight;
    const continentScore = continentResult.score * continentWeight;

    // Calculate issue penalty
    const errorCount = allIssues.filter(i => i.severity === 'error').length;
    const warningCount = allIssues.filter(i => i.severity === 'warning').length;
    const issuePenalty = (errorCount * 15 + warningCount * 8) * issueWeight;

    const baseScore = terrainScore + continentScore;
    const finalScore = Math.max(0, baseScore - issuePenalty);

    return Math.min(100, finalScore);
  }

  /**
   * Find isolated land tiles (single tiles surrounded by water)
   * @param tiles Map tiles to analyze
   * @returns Number of isolated land tiles
   */
  private findIsolatedLandTiles(tiles: MapTile[][]): number {
    let isolatedCount = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (tile.terrain !== 'ocean' && tile.terrain !== 'deep_ocean' && tile.terrain !== 'coast') {
          // Check if surrounded by water
          const neighbors = this.getNeighbors(tiles, x, y);
          const landNeighbors = neighbors.filter(
            n => n.terrain !== 'ocean' && n.terrain !== 'deep_ocean' && n.terrain !== 'coast'
          );

          if (landNeighbors.length === 0) {
            isolatedCount++;
          }
        }
      }
    }

    return isolatedCount;
  }

  /**
   * Get neighboring tiles for connectivity analysis
   * @param tiles Map tiles
   * @param x X coordinate
   * @param y Y coordinate
   * @returns Array of neighboring tiles
   */
  private getNeighbors(tiles: MapTile[][], x: number, y: number): MapTile[] {
    const neighbors: MapTile[] = [];
    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];

    directions.forEach(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
        neighbors.push(tiles[nx][ny]);
      }
    });

    return neighbors;
  }

  /**
   * Assess the quality of a starting position based on nearby terrain
   * @param tiles Map tiles
   * @param position Starting position to assess
   * @returns Quality assessment with score and issues
   */
  private assessStartingPositionQuality(
    tiles: MapTile[][],
    position: Position
  ): { score: number; issues: string[] } {
    const issues: string[] = [];
    let score = 100;

    const tile = tiles[position.x][position.y];

    // Check immediate tile quality
    if (tile.terrain === 'desert' || tile.terrain === 'tundra' || tile.terrain === 'snow') {
      score -= 20;
      issues.push(`Starting on harsh terrain: ${tile.terrain}`);
    }

    // Check nearby resources and terrain variety
    const nearbyTiles = this.getTilesInRadius(tiles, position.x, position.y, 3);
    const terrainTypes = new Set(nearbyTiles.map(t => t.terrain));
    const resourceCount = nearbyTiles.filter(t => t.resource).length;

    if (terrainTypes.size < 3) {
      score -= 15;
      issues.push('Limited terrain variety nearby');
    }

    if (resourceCount === 0) {
      score -= 25;
      issues.push('No resources in starting area');
    }

    // Check access to water
    const hasWaterAccess = nearbyTiles.some(t => t.terrain === 'coast' || t.terrain === 'ocean');
    if (!hasWaterAccess) {
      score -= 10;
      issues.push('No water access nearby');
    }

    // Check for mountains (good for defense but can block expansion)
    const mountainCount = nearbyTiles.filter(t => t.terrain === 'mountains').length;
    if (mountainCount > nearbyTiles.length * 0.3) {
      score -= 15;
      issues.push('Surrounded by mountains - limited expansion');
    }

    return {
      score: Math.max(0, score),
      issues,
    };
  }

  /**
   * Get all tiles within a specified radius
   * @param tiles Map tiles
   * @param centerX Center X coordinate
   * @param centerY Center Y coordinate
   * @param radius Radius to search
   * @returns Array of tiles within radius
   */
  private getTilesInRadius(
    tiles: MapTile[][],
    centerX: number,
    centerY: number,
    radius: number
  ): MapTile[] {
    const tilesInRadius: MapTile[] = [];

    for (
      let x = Math.max(0, centerX - radius);
      x <= Math.min(this.width - 1, centerX + radius);
      x++
    ) {
      for (
        let y = Math.max(0, centerY - radius);
        y <= Math.min(this.height - 1, centerY + radius);
        y++
      ) {
        const distance = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
        if (distance <= radius) {
          tilesInRadius.push(tiles[x][y]);
        }
      }
    }

    return tilesInRadius;
  }

  /**
   * Get empty metrics for error cases
   * @returns Empty ValidationMetrics object
   */
  private getEmptyMetrics(): ValidationMetrics {
    return {
      landPercentage: 0,
      oceanPercentage: 0,
      terrainDistribution: {} as Record<TerrainType, number>,
      continentCount: 0,
      continentSizes: [],
      averageContinentSize: 0,
      largestContinentSize: 0,
      smallestContinentSize: 0,
      startingPositionDistance: {
        average: 0,
        minimum: 0,
        maximum: 0,
      },
      performanceMetrics: {},
    };
  }

  /**
   * Check if a terrain type is land (not water)
   * @param terrain Terrain type to check
   * @returns True if terrain is land, false if water
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'deep_ocean', 'coast', 'lake'].includes(terrain);
  }

  /**
   * Validate river connectivity to ensure rivers form proper networks
   * @param tiles Map tiles
   * @param riverTiles Tiles with rivers
   * @returns Array of connectivity issues
   */
  private validateRiverConnectivity(tiles: MapTile[][], riverTiles: MapTile[]): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    let isolatedRivers = 0;
    let brokenConnections = 0;

    riverTiles.forEach(riverTile => {
      const neighbors = this.getNeighbors(tiles, riverTile.x, riverTile.y);
      const riverNeighbors = neighbors.filter(n => n.riverMask && n.riverMask > 0);

      // Check for isolated river segments (should connect to other rivers or water bodies)
      if (riverNeighbors.length === 0) {
        const hasWaterAccess = neighbors.some(n => !this.isLandTile(n.terrain));
        if (!hasWaterAccess) {
          isolatedRivers++;
        }
      }

      // Validate river mask connections match neighbor rivers
      const riverMask = riverTile.riverMask;
      const directions = [
        { bit: 1, dx: 0, dy: -1 }, // North
        { bit: 2, dx: 1, dy: 0 }, // East
        { bit: 4, dx: 0, dy: 1 }, // South
        { bit: 8, dx: -1, dy: 0 }, // West
      ];

      directions.forEach(({ bit, dx, dy }) => {
        if (riverMask & bit) {
          // This direction claims to have a river connection
          const nx = riverTile.x + dx;
          const ny = riverTile.y + dy;

          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            const neighborTile = tiles[nx][ny];

            // Check if neighbor actually has a river or is water
            if (!neighborTile.riverMask && this.isLandTile(neighborTile.terrain)) {
              brokenConnections++;
            }
          }
        }
      });
    });

    if (isolatedRivers > riverTiles.length * 0.1) {
      issues.push({
        severity: 'warning',
        category: 'terrain',
        message: 'High number of isolated river segments',
        details: { isolatedRivers, totalRivers: riverTiles.length },
      });
    }

    if (brokenConnections > 0) {
      issues.push({
        severity: 'warning',
        category: 'terrain',
        message: 'River connectivity issues detected',
        details: { brokenConnections },
      });
    }

    return issues;
  }

  /**
   * Calculate river-specific metrics
   * @param tiles Map tiles
   * @param riverTiles Tiles with rivers
   * @returns River metrics
   */
  private calculateRiverMetrics(tiles: MapTile[][], riverTiles: MapTile[]): Record<string, number> {
    const totalRiverLength = riverTiles.length;
    const averageRiverMask =
      riverTiles.length > 0
        ? riverTiles.reduce((sum, tile) => sum + tile.riverMask, 0) / riverTiles.length
        : 0;

    // Count river networks (connected components)
    const networks = this.countRiverNetworks(tiles, riverTiles);

    return {
      totalRiverLength,
      averageRiverMask: Number(averageRiverMask.toFixed(2)),
      riverNetworks: networks,
      averageNetworkSize: networks > 0 ? Number((totalRiverLength / networks).toFixed(1)) : 0,
    };
  }

  /**
   * Count distinct river networks using flood fill algorithm
   * @param tiles Map tiles
   * @param riverTiles Tiles with rivers
   * @returns Number of distinct river networks
   */
  private countRiverNetworks(tiles: MapTile[][], riverTiles: MapTile[]): number {
    const visited = new Set<string>();
    let networks = 0;

    riverTiles.forEach(riverTile => {
      const key = `${riverTile.x},${riverTile.y}`;
      if (!visited.has(key)) {
        // Start a new network exploration
        this.exploreRiverNetwork(tiles, riverTile.x, riverTile.y, visited);
        networks++;
      }
    });

    return networks;
  }

  /**
   * Explore a river network using depth-first search
   * @param tiles Map tiles
   * @param startX Starting X coordinate
   * @param startY Starting Y coordinate
   * @param visited Set of visited tile coordinates
   */
  private exploreRiverNetwork(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    visited: Set<string>
  ): void {
    const stack = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key)) continue;
      visited.add(key);

      // Add connected river neighbors to stack
      const neighbors = this.getNeighbors(tiles, x, y);
      neighbors.forEach(neighbor => {
        if (neighbor.riverMask && neighbor.riverMask > 0) {
          const neighborKey = `${neighbor.x},${neighbor.y}`;
          if (!visited.has(neighborKey)) {
            stack.push({ x: neighbor.x, y: neighbor.y });
          }
        }
      });
    }
  }

  /**
   * Calculate actual terrain distribution from map tiles
   * @param flatTiles All tiles flattened
   * @param landTiles Land tiles only
   * @returns Actual distribution percentages
   */
  private calculateActualTerrainDistribution(
    flatTiles: MapTile[],
    landTiles: MapTile[]
  ): {
    river_pct: number;
    forest_pct: number;
    desert_pct: number;
    mountain_pct: number;
  } {
    const riverTiles = flatTiles.filter(tile => tile.riverMask && tile.riverMask > 0);
    const forestTiles = flatTiles.filter(
      tile => tile.terrain === 'forest' || tile.terrain === 'jungle'
    );
    const desertTiles = flatTiles.filter(tile => tile.terrain === 'desert');
    const mountainTiles = flatTiles.filter(tile => tile.terrain === 'mountains');

    const landCount = landTiles.length;

    return {
      river_pct: landCount > 0 ? Number(((riverTiles.length / landCount) * 100).toFixed(1)) : 0,
      forest_pct: landCount > 0 ? Number(((forestTiles.length / landCount) * 100).toFixed(1)) : 0,
      desert_pct: landCount > 0 ? Number(((desertTiles.length / landCount) * 100).toFixed(1)) : 0,
      mountain_pct:
        landCount > 0 ? Number(((mountainTiles.length / landCount) * 100).toFixed(1)) : 0,
    };
  }

  /**
   * Detect signs of hardcoded parameter overrides
   * @param actualDistribution Actual terrain distribution
   * @param terrainParams Expected parameters
   * @returns Array of override detection issues
   */
  private detectHardcodedOverrides(
    actualDistribution: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    },
    terrainParams: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    }
  ): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for suspiciously round numbers that don't match parameters
    const commonOverrides = [15, 20, 25, 30]; // Common hardcoded values

    Object.entries(actualDistribution).forEach(([key, actual]) => {
      const expected = terrainParams[key as keyof typeof terrainParams];
      const deviation = Math.abs(actual - expected);

      if (deviation > 5 && commonOverrides.some(override => Math.abs(actual - override) < 1)) {
        issues.push({
          severity: 'warning',
          category: 'terrain',
          message: `Possible hardcoded override detected for ${key}: actual ${actual}% matches common override value`,
          details: {
            parameter: key,
            expected,
            actual,
            suspectedOverride: commonOverrides.find(override => Math.abs(actual - override) < 1),
          },
        });
      }
    });

    return issues;
  }

  /**
   * Calculate river validation score
   * @param riverCount Number of river tiles
   * @param landCount Number of land tiles
   * @param expectedRiverPct Expected river percentage
   * @param issues Array of issues found
   * @returns Score from 0-100
   */
  private calculateRiverScore(
    riverCount: number,
    landCount: number,
    expectedRiverPct?: number,
    issues?: ValidationIssue[]
  ): number {
    let score = 100;

    // Deduct points for issues
    if (issues) {
      issues.forEach(issue => {
        if (issue.severity === 'error') {
          score -= 25;
        } else if (issue.severity === 'warning') {
          score -= 15;
        }
      });
    }

    // Bonus for having rivers at all
    if (riverCount > 0) {
      score += 10;
    }

    // Bonus for reasonable river density
    const actualRiverPct = landCount > 0 ? (riverCount / landCount) * 100 : 0;
    if (actualRiverPct >= 2 && actualRiverPct <= 15) {
      score += 5; // Reasonable river density
    }

    // Bonus for matching expected percentage
    if (expectedRiverPct && Math.abs(actualRiverPct - expectedRiverPct) <= 2) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate parameter compliance score
   * @param actualDistribution Actual terrain distribution
   * @param terrainParams Expected parameters
   * @param issues Array of issues found
   * @returns Score from 0-100
   */
  private calculateParameterComplianceScore(
    actualDistribution: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    },
    terrainParams: {
      river_pct: number;
      forest_pct: number;
      desert_pct: number;
      mountain_pct: number;
    },
    issues: ValidationIssue[]
  ): number {
    let score = 100;

    // Deduct points for issues
    issues.forEach(issue => {
      if (issue.severity === 'error') {
        score -= 20;
      } else if (issue.severity === 'warning') {
        score -= 10;
      }
    });

    // Bonus for good parameter compliance
    let compliantParameters = 0;
    Object.entries(terrainParams).forEach(([key, expected]) => {
      const actual = actualDistribution[key as keyof typeof actualDistribution];
      const deviation = Math.abs(actual - expected);

      if (deviation <= 2) {
        compliantParameters++;
      }
    });

    // Award bonus based on number of compliant parameters
    const complianceBonus = (compliantParameters / Object.keys(terrainParams).length) * 20;
    score += complianceBonus;

    return Math.max(0, Math.min(100, score));
  }
}
