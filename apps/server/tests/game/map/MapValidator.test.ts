/**
 * Unit Tests for MapValidator
 * Comprehensive testing for map validation system
 * @reference freeciv/server/generator/mapgen.c validation functions
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { MapValidator, Position } from '../../../src/game/map/MapValidator';
import { MapTile, TerrainType, TemperatureType } from '../../../src/game/map/MapTypes';
import { PlayerState } from '../../../src/game/GameManager';

describe('MapValidator', () => {
  let validator: MapValidator;
  let mockTiles: MapTile[][];
  let mockPlayers: Map<string, PlayerState>;
  const width = 20;
  const height = 15;

  beforeEach(() => {
    validator = new MapValidator(width, height);
    mockTiles = createMockTiles(width, height);
    mockPlayers = createMockPlayers();
  });

  describe('Constructor', () => {
    it('should initialize with correct dimensions', () => {
      expect(validator['width']).toBe(width);
      expect(validator['height']).toBe(height);
      expect(validator['totalTiles']).toBe(width * height);
    });
  });

  describe('validateTerrainDistribution', () => {
    it('should pass validation for balanced terrain distribution', () => {
      const balancedTiles = createBalancedTerrainTiles(width, height);
      const result = validator.validateTerrainDistribution(balancedTiles);

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.metrics.landPercentage).toBeGreaterThan(20);
      expect(result.metrics.landPercentage).toBeLessThan(40);
    });

    it('should fail validation when land percentage is too low', () => {
      const oceanTiles = createMostlyOceanTiles(width, height, 0.1); // 10% land
      const result = validator.validateTerrainDistribution(oceanTiles);

      expect(result.passed).toBe(false);
      expect(
        result.issues.some(
          issue => issue.severity === 'error' && issue.message.includes('Land percentage too low')
        )
      ).toBe(true);
      expect(result.metrics.landPercentage).toBeLessThan(15);
    });

    it('should fail validation when land percentage is too high', () => {
      const landTiles = createMostlyLandTiles(width, height, 0.8); // 80% land
      const result = validator.validateTerrainDistribution(landTiles);

      expect(result.passed).toBe(false);
      expect(
        result.issues.some(
          issue => issue.severity === 'error' && issue.message.includes('Land percentage too high')
        )
      ).toBe(true);
      expect(result.metrics.landPercentage).toBeGreaterThan(60);
    });

    it('should warn about terrain dominance', () => {
      const dominatedTiles = createDominatedTerrainTiles(width, height, 'grassland', 0.6);
      const result = validator.validateTerrainDistribution(dominatedTiles);

      expect(
        result.issues.some(
          issue => issue.severity === 'error' && issue.message.includes('dominates the map')
        )
      ).toBe(true);
      expect(result.metrics.terrainDistribution['grassland']).toBeGreaterThan(50);
    });

    it('should warn about missing essential terrains', () => {
      const limitedTiles = createLimitedTerrainTiles(width, height, ['desert', 'mountains']);
      const result = validator.validateTerrainDistribution(limitedTiles);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' &&
            issue.message.includes('Essential terrain') &&
            issue.message.includes('missing or very rare')
        )
      ).toBe(true);
    });

    it('should calculate terrain distribution metrics correctly', () => {
      const customTiles = createCustomTerrainTiles(width, height, {
        grassland: 0.3,
        forest: 0.2,
        ocean: 0.5,
      });
      const result = validator.validateTerrainDistribution(customTiles);

      expect(result.metrics.terrainDistribution['grassland']).toBeCloseTo(30, 1);
      expect(result.metrics.terrainDistribution['forest']).toBeCloseTo(20, 1);
      expect(result.metrics.terrainDistribution['ocean']).toBeCloseTo(50, 1);
      expect(result.metrics.landPercentage).toBeCloseTo(50, 1);
    });
  });

  describe('validateContinentSizes', () => {
    it('should pass validation for well-distributed continents', () => {
      const tilesWithContinents = createTilesWithContinents(width, height, [60, 45, 35, 20]);
      const result = validator.validateContinentSizes(tilesWithContinents);

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.metrics.continentCount).toBe(4);
      expect(result.metrics.largestContinentSize).toBe(60);
      expect(result.metrics.smallestContinentSize).toBe(20);
    });

    it('should fail validation when no continents found', () => {
      const oceanOnlyTiles = createMostlyOceanTiles(width, height, 0);
      const result = validator.validateContinentSizes(oceanOnlyTiles);

      expect(result.passed).toBe(false);
      expect(
        result.issues.some(
          issue => issue.severity === 'error' && issue.message.includes('No continents found')
        )
      ).toBe(true);
      expect(result.metrics.continentCount).toBe(0);
    });

    it('should warn about too many small continents', () => {
      // Create many tiny continents
      const continentSizes = Array(20).fill(5); // 20 continents of 5 tiles each
      const tilesWithManyContinents = createTilesWithContinents(width, height, continentSizes);
      const result = validator.validateContinentSizes(tilesWithManyContinents);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' && issue.message.includes('Too many small continents')
        )
      ).toBe(true);
    });

    it('should warn about single dominant continent', () => {
      const dominantContinent = [200, 10, 5]; // One very large continent
      const tilesWithDominantContinent = createTilesWithContinents(
        width,
        height,
        dominantContinent
      );
      const result = validator.validateContinentSizes(tilesWithDominantContinent);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' && issue.message.includes('Single continent dominates')
        )
      ).toBe(true);
    });

    it('should calculate continent metrics correctly', () => {
      const continentSizes = [80, 60, 40, 20];
      const tilesWithContinents = createTilesWithContinents(width, height, continentSizes);
      const result = validator.validateContinentSizes(tilesWithContinents);

      expect(result.metrics.continentCount).toBe(4);
      expect(result.metrics.largestContinentSize).toBe(80);
      expect(result.metrics.smallestContinentSize).toBe(20);
      expect(result.metrics.averageContinentSize).toBe(50);
      expect(result.metrics.continentSizes).toEqual([80, 60, 40, 20]); // Sorted descending
    });

    it('should detect isolated land tiles', () => {
      const tilesWithIsolatedLand = createTilesWithIsolatedLand(width, height);
      const result = validator.validateContinentSizes(tilesWithIsolatedLand);

      expect(
        result.issues.some(
          issue => issue.severity === 'warning' && issue.message.includes('isolated land tiles')
        )
      ).toBe(true);
    });
  });

  describe('validateStartingPositions', () => {
    it('should pass validation for well-distributed starting positions', () => {
      const goodPositions: Position[] = [
        { x: 2, y: 2, playerId: 'player1' },
        { x: 17, y: 2, playerId: 'player2' },
        { x: 2, y: 12, playerId: 'player3' },
        { x: 17, y: 12, playerId: 'player4' },
      ];
      const tilesWithGoodTerrain = createTilesForStartingPositions(width, height, goodPositions);
      const result = validator.validateStartingPositions(tilesWithGoodTerrain, goodPositions);

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(70);
      expect(result.metrics.startingPositionDistance.average).toBeGreaterThan(10);
    });

    it('should fail validation for empty starting positions', () => {
      const result = validator.validateStartingPositions(mockTiles, []);

      expect(result.passed).toBe(false);
      expect(
        result.issues.some(
          issue =>
            issue.severity === 'error' && issue.message.includes('No starting positions provided')
        )
      ).toBe(true);
    });

    it('should fail validation for positions outside map bounds', () => {
      const invalidPositions: Position[] = [
        { x: -1, y: 5, playerId: 'player1' },
        { x: 25, y: 5, playerId: 'player2' }, // x > width
        { x: 10, y: -1, playerId: 'player3' },
        { x: 10, y: 20, playerId: 'player4' }, // y > height
      ];
      const result = validator.validateStartingPositions(mockTiles, invalidPositions);

      expect(result.passed).toBe(false);
      expect(
        result.issues.filter(
          issue => issue.severity === 'error' && issue.message.includes('outside map bounds')
        ).length
      ).toBe(4);
    });

    it('should fail validation for positions in ocean', () => {
      const oceanPositions: Position[] = [
        { x: 5, y: 5, playerId: 'player1' },
        { x: 10, y: 10, playerId: 'player2' },
      ];
      const oceanTiles = createMostlyOceanTiles(width, height, 0);
      const result = validator.validateStartingPositions(oceanTiles, oceanPositions);

      expect(result.passed).toBe(false);
      expect(
        result.issues.filter(
          issue =>
            issue.severity === 'error' && issue.message.includes('Starting position in ocean')
        ).length
      ).toBe(2);
    });

    it('should warn about positions too close together', () => {
      const closePositions: Position[] = [
        { x: 5, y: 5, playerId: 'player1' },
        { x: 6, y: 5, playerId: 'player2' }, // Only 1 tile apart
      ];
      const landTiles = createMostlyLandTiles(width, height, 1.0);
      const result = validator.validateStartingPositions(landTiles, closePositions);

      expect(
        result.issues.some(
          issue => issue.severity === 'warning' && issue.message.includes('too close together')
        )
      ).toBe(true);
      expect(result.metrics.startingPositionDistance.minimum).toBeLessThan(2);
    });

    it('should calculate distance metrics correctly', () => {
      const positions: Position[] = [
        { x: 0, y: 0, playerId: 'player1' },
        { x: 10, y: 0, playerId: 'player2' },
        { x: 0, y: 10, playerId: 'player3' },
      ];
      const landTiles = createMostlyLandTiles(width, height, 1.0);
      const result = validator.validateStartingPositions(landTiles, positions);

      expect(result.metrics.startingPositionDistance.minimum).toBeCloseTo(10, 1);
      expect(result.metrics.startingPositionDistance.maximum).toBeCloseTo(Math.sqrt(200), 1);
    });

    it('should assess starting position quality', () => {
      const positions: Position[] = [{ x: 5, y: 5, playerId: 'player1' }];
      const poorQualityTiles = createTilesWithPoorStartingQuality(width, height, positions[0]);
      const result = validator.validateStartingPositions(poorQualityTiles, positions);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' && issue.message.includes('Poor quality starting position')
        )
      ).toBe(true);
    });
  });

  describe('validateMap (comprehensive)', () => {
    it('should pass validation for high-quality map', () => {
      const qualityTiles = createTrulyBalancedMap(width, height);
      const goodPositions: Position[] = [
        { x: 3, y: 3, playerId: 'player1' },
        { x: 16, y: 11, playerId: 'player2' },
      ];
      const performanceData = { generationTimeMs: 150 };

      const result = validator.validateMap(
        qualityTiles,
        goodPositions,
        mockPlayers,
        performanceData
      );

      expect(result.score).toBeGreaterThan(60); // More realistic for comprehensive validation
      expect(result.issues).toHaveLength(0); // Should have no issues
      expect(result.metrics.performanceMetrics.generationTimeMs).toBe(150);
      expect(result.metrics.performanceMetrics.tilesPerSecond).toBeGreaterThan(0);
    });

    it('should fail validation for poor-quality map', () => {
      const poorTiles = createPoorQualityMap(width, height);
      const badPositions: Position[] = [
        { x: 1, y: 1, playerId: 'player1' },
        { x: 2, y: 1, playerId: 'player2' }, // Too close
      ];

      const result = validator.validateMap(poorTiles, badPositions, mockPlayers);

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(70);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should handle missing optional parameters', () => {
      const result = validator.validateMap(mockTiles);

      expect(result).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.issues).toBeDefined();
    });

    it('should validate performance metrics when provided', () => {
      const slowPerformance = { generationTimeMs: 10000 }; // Very slow
      const result = validator.validateMap(mockTiles, [], mockPlayers, slowPerformance);

      expect(
        result.issues.some(
          issue =>
            issue.category === 'performance' && issue.message.includes('longer than expected')
        )
      ).toBe(true);
    });
  });

  describe('Performance Validation', () => {
    it('should validate generation time against baseline', () => {
      const fastTime = { generationTimeMs: 50 }; // Fast generation
      const result = validator['validatePerformanceMetrics'](fastTime);

      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
    });

    it('should warn about slow generation time', () => {
      const slowTime = { generationTimeMs: 5000 }; // 5 seconds for small map
      const result = validator['validatePerformanceMetrics'](slowTime);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' &&
            issue.message.includes('significantly longer than expected')
        )
      ).toBe(true);
    });

    it('should validate memory usage when provided', () => {
      const highMemory = { generationTimeMs: 100, memoryUsageMB: 500 }; // High memory
      const result = validator['validatePerformanceMetrics'](highMemory);

      expect(
        result.issues.some(
          issue =>
            issue.severity === 'warning' &&
            issue.message.includes('Memory usage higher than expected')
        )
      ).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty map tiles', () => {
      const emptyTiles: MapTile[][] = [];
      expect(() => validator.validateTerrainDistribution(emptyTiles)).not.toThrow();
    });

    it('should handle single tile maps', () => {
      const singleTileValidator = new MapValidator(1, 1);
      const singleTile = [[createMockTile(0, 0, 'grassland')]];
      const result = singleTileValidator.validateTerrainDistribution(singleTile);

      expect(result).toBeDefined();
      expect(result.metrics.terrainDistribution['grassland']).toBe(100);
    });

    it('should handle positions with no valid positions', () => {
      const oceanTiles = createMostlyOceanTiles(width, height, 0);
      const oceanPositions: Position[] = [{ x: 5, y: 5, playerId: 'player1' }];
      const result = validator.validateStartingPositions(oceanTiles, oceanPositions);

      expect(result.passed).toBe(false);
      expect(result.score).toBe(0);
    });
  });
});

// Helper functions for creating test data

function createMockTiles(width: number, height: number): MapTile[][] {
  const tiles: MapTile[][] = [];
  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      tiles[x][y] = createMockTile(x, y, 'grassland');
    }
  }
  return tiles;
}

function createMockTile(
  x: number,
  y: number,
  terrain: TerrainType,
  continentId: number = 1
): MapTile {
  return {
    x,
    y,
    terrain,
    riverMask: 0,
    elevation: 100,
    continentId,
    isExplored: false,
    isVisible: false,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: TemperatureType.TEMPERATE,
    wetness: 50,
  };
}

function createMockPlayers(): Map<string, PlayerState> {
  return new Map([
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
}

function createBalancedTerrainTiles(width: number, height: number): MapTile[][] {
  const tiles: MapTile[][] = [];
  let continentId = 1;

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      let terrain: TerrainType;
      const ratio = (x * height + y) / (width * height);

      // Create 30% land, 70% ocean (within acceptable range)
      if (ratio < 0.1) terrain = 'grassland';
      else if (ratio < 0.15) terrain = 'forest';
      else if (ratio < 0.2) terrain = 'plains';
      else if (ratio < 0.25) terrain = 'hills';
      else if (ratio < 0.3) terrain = 'desert';
      else terrain = 'ocean';

      const isLand = terrain !== 'ocean';
      tiles[x][y] = createMockTile(x, y, terrain, isLand ? continentId : 0);

      // Create continent boundaries
      if (isLand && x % 10 === 0 && y % 8 === 0) {
        continentId++;
      }
    }
  }

  return tiles;
}

function createMostlyOceanTiles(width: number, height: number, landRatio: number): MapTile[][] {
  const tiles: MapTile[][] = [];
  const totalTiles = width * height;
  const landTiles = Math.floor(totalTiles * landRatio);
  let landCount = 0;

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      const terrain: TerrainType = landCount < landTiles ? 'grassland' : 'ocean';
      const continentId = terrain === 'ocean' ? 0 : 1;
      tiles[x][y] = createMockTile(x, y, terrain, continentId);
      if (terrain !== 'ocean') landCount++;
    }
  }

  return tiles;
}

function createMostlyLandTiles(width: number, height: number, landRatio: number): MapTile[][] {
  const tiles: MapTile[][] = [];
  const totalTiles = width * height;
  const oceanTiles = Math.floor(totalTiles * (1 - landRatio));
  let oceanCount = 0;

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      const terrain: TerrainType = oceanCount < oceanTiles ? 'ocean' : 'grassland';
      const continentId = terrain === 'ocean' ? 0 : 1;
      tiles[x][y] = createMockTile(x, y, terrain, continentId);
      if (terrain === 'ocean') oceanCount++;
    }
  }

  return tiles;
}

function createDominatedTerrainTiles(
  width: number,
  height: number,
  dominantTerrain: TerrainType,
  ratio: number
): MapTile[][] {
  const tiles: MapTile[][] = [];
  const totalTiles = width * height;
  const dominantTiles = Math.floor(totalTiles * ratio);
  let dominantCount = 0;

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      let terrain: TerrainType;
      if (dominantCount < dominantTiles) {
        terrain = dominantTerrain;
        dominantCount++;
      } else {
        terrain = 'ocean';
      }

      const continentId = terrain === 'ocean' ? 0 : 1;
      tiles[x][y] = createMockTile(x, y, terrain, continentId);
    }
  }

  return tiles;
}

function createLimitedTerrainTiles(
  width: number,
  height: number,
  allowedTerrains: TerrainType[]
): MapTile[][] {
  const tiles: MapTile[][] = [];

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      const terrainIndex = (x + y) % allowedTerrains.length;
      const terrain = allowedTerrains[terrainIndex];
      const continentId = terrain === 'ocean' ? 0 : 1;
      tiles[x][y] = createMockTile(x, y, terrain, continentId);
    }
  }

  return tiles;
}

function createCustomTerrainTiles(
  width: number,
  height: number,
  terrainRatios: Record<string, number>
): MapTile[][] {
  const tiles: MapTile[][] = [];
  const totalTiles = width * height;
  const terrainCounts: Record<string, number> = {};

  // Calculate target counts
  Object.entries(terrainRatios).forEach(([terrain, ratio]) => {
    terrainCounts[terrain] = Math.floor(totalTiles * ratio);
  });

  const terrainQueue: TerrainType[] = [];
  Object.entries(terrainCounts).forEach(([terrain, count]) => {
    for (let i = 0; i < count; i++) {
      terrainQueue.push(terrain as TerrainType);
    }
  });

  // Fill remaining with ocean
  while (terrainQueue.length < totalTiles) {
    terrainQueue.push('ocean');
  }

  let tileIndex = 0;
  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      const terrain = terrainQueue[tileIndex++];
      const continentId = terrain === 'ocean' ? 0 : 1;
      tiles[x][y] = createMockTile(x, y, terrain, continentId);
    }
  }

  return tiles;
}

function createTilesWithContinents(
  width: number,
  height: number,
  continentSizes: number[]
): MapTile[][] {
  const tiles: MapTile[][] = [];
  let continentId = 1;

  // Initialize with ocean
  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      tiles[x][y] = createMockTile(x, y, 'ocean', 0);
    }
  }

  // Place continents
  for (const size of continentSizes) {
    let placed = 0;
    let attempts = 0;

    while (placed < size && attempts < 1000) {
      const x = Math.floor(Math.random() * width);
      const y = Math.floor(Math.random() * height);

      if (tiles[x][y].terrain === 'ocean') {
        tiles[x][y] = createMockTile(x, y, 'grassland', continentId);
        placed++;
      }
      attempts++;
    }
    continentId++;
  }

  return tiles;
}

function createTilesWithIsolatedLand(width: number, height: number): MapTile[][] {
  const tiles: MapTile[][] = [];

  // Create mostly ocean
  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      tiles[x][y] = createMockTile(x, y, 'ocean', 0);
    }
  }

  // Add isolated land tiles (single tiles surrounded by ocean)
  const isolatedPositions = [
    [5, 5],
    [10, 8],
    [15, 3],
    [3, 12],
    [18, 10],
  ];

  isolatedPositions.forEach(([x, y], index) => {
    if (x < width && y < height) {
      tiles[x][y] = createMockTile(x, y, 'grassland', index + 1);
    }
  });

  return tiles;
}

function createTilesForStartingPositions(
  width: number,
  height: number,
  positions: Position[]
): MapTile[][] {
  const tiles = createBalancedTerrainTiles(width, height);

  // Ensure starting positions are on good land terrain
  positions.forEach(pos => {
    if (pos.x >= 0 && pos.x < width && pos.y >= 0 && pos.y < height) {
      tiles[pos.x][pos.y] = createMockTile(pos.x, pos.y, 'grassland', 1);
      tiles[pos.x][pos.y].resource = 'wheat'; // Add resource for quality
    }
  });

  return tiles;
}

function createTilesWithPoorStartingQuality(
  width: number,
  height: number,
  position: Position
): MapTile[][] {
  const tiles = createMockTiles(width, height);

  // Make the starting area harsh
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const x = position.x + dx;
      const y = position.y + dy;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        tiles[x][y] = createMockTile(x, y, 'desert', 1); // Harsh terrain
        // No resources
        tiles[x][y].resource = undefined;
      }
    }
  }

  return tiles;
}

function createTrulyBalancedMap(width: number, height: number): MapTile[][] {
  const tiles: MapTile[][] = [];

  for (let x = 0; x < width; x++) {
    tiles[x] = [];
    for (let y = 0; y < height; y++) {
      tiles[x][y] = createMockTile(x, y, 'ocean', 0);
    }
  }

  // Create two medium-sized continents
  // Continent 1: left side
  for (let x = 1; x < 8; x++) {
    for (let y = 1; y < 7; y++) {
      const terrainTypes: TerrainType[] = ['grassland', 'plains', 'forest', 'hills'];
      const terrain = terrainTypes[(x + y) % terrainTypes.length];
      tiles[x][y] = createMockTile(x, y, terrain, 1);
      if (x === 3 && y === 3) tiles[x][y].resource = 'wheat'; // Ensure good starting position
    }
  }

  // Continent 2: right side
  for (let x = 12; x < 19; x++) {
    for (let y = 8; y < 14; y++) {
      const terrainTypes: TerrainType[] = ['grassland', 'plains', 'forest', 'hills'];
      const terrain = terrainTypes[(x + y) % terrainTypes.length];
      tiles[x][y] = createMockTile(x, y, terrain, 2);
      if (x === 16 && y === 11) tiles[x][y].resource = 'cattle'; // Ensure good starting position
    }
  }

  return tiles;
}

function createPoorQualityMap(width: number, height: number): MapTile[][] {
  // Create a map with many issues
  const tiles = createMostlyOceanTiles(width, height, 0.05); // Too much ocean

  // Add a few tiny isolated lands
  tiles[5][5] = createMockTile(5, 5, 'desert', 1);
  tiles[15][10] = createMockTile(15, 10, 'tundra', 2);

  return tiles;
}
