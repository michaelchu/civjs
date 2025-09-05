/**
 * Unit tests for HeightMapProcessor
 * Validates height map processing algorithms extracted from TerrainGenerator
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { MapTile, TemperatureType } from '@game/map/MapTypes';
import { HeightMapProcessor } from '@game/map/terrain/HeightMapProcessor';

describe('HeightMapProcessor', () => {
  let processor: HeightMapProcessor;
  let tiles: MapTile[][];
  let heightMap: number[];
  const width = 20;
  const height = 20;

  // Seeded random for deterministic tests
  const seededRandom = (() => {
    let seed = 12345;
    return () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  })();

  beforeEach(() => {
    processor = new HeightMapProcessor(width, height, seededRandom);
    tiles = [];
    heightMap = new Array(width * height);

    // Initialize tiles
    for (let x = 0; x < width; x++) {
      tiles[x] = [];
      for (let y = 0; y < height; y++) {
        tiles[x][y] = {
          x,
          y,
          terrain: 'grassland',
          riverMask: 0,
          elevation: 0,
          continentId: 1,
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
    }

    // Initialize height map with known values
    for (let i = 0; i < heightMap.length; i++) {
      heightMap[i] = Math.floor(seededRandom() * 255);
    }
  });

  describe('heightMapToMap()', () => {
    it('should correctly transfer height map values to tile elevations', () => {
      // Set specific height values for testing
      heightMap[0] = 100; // (0,0)
      heightMap[width] = 200; // (0,1)
      heightMap[width * 5 + 5] = 150; // (5,5)

      processor.heightMapToMap(tiles, heightMap);

      expect(tiles[0][0].elevation).toBe(100);
      expect(tiles[0][1].elevation).toBe(200);
      expect(tiles[5][5].elevation).toBe(150);
    });

    it('should handle edge cases correctly', () => {
      // Set edge and corner values
      heightMap[0] = 50; // Top-left corner (0,0)
      heightMap[width - 1] = 75; // Top-right corner (width-1,0)
      heightMap[width * (height - 1)] = 25; // Bottom-left corner (0,height-1)
      heightMap[width * height - 1] = 255; // Bottom-right corner (width-1,height-1)

      processor.heightMapToMap(tiles, heightMap);

      expect(tiles[0][0].elevation).toBe(50);
      expect(tiles[width - 1][0].elevation).toBe(75);
      expect(tiles[0][height - 1].elevation).toBe(25);
      expect(tiles[width - 1][height - 1].elevation).toBe(255);
    });
  });

  describe('hasPoles()', () => {
    it('should return true for maps that require pole processing', () => {
      expect(processor.hasPoles()).toBe(true);
    });
  });

  describe('localAveElevation()', () => {
    it('should calculate correct average for interior points', () => {
      // Create a 7x7 area with known values around center point (10,10)
      // to match the radius 3 neighborhood used by localAveElevation
      const centerX = 10;
      const centerY = 10;
      let total = 0;
      let count = 0;

      // Set known values in 7x7 area around center (radius 3)
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const x = centerX + dx;
          const y = centerY + dy;
          const value = 100 + dx * 10 + dy * 5; // Predictable values
          const index = y * width + x;
          heightMap[index] = value;
          total += value;
          count++;
        }
      }

      const expected = total / count;
      const actual = processor.localAveElevation(heightMap, centerX, centerY);

      expect(actual).toBeCloseTo(expected, 2);
    });

    it('should handle edge cases without crashing', () => {
      // Test corners and edges
      expect(() => processor.localAveElevation(heightMap, 0, 0)).not.toThrow();
      expect(() => processor.localAveElevation(heightMap, width - 1, 0)).not.toThrow();
      expect(() => processor.localAveElevation(heightMap, 0, height - 1)).not.toThrow();
      expect(() => processor.localAveElevation(heightMap, width - 1, height - 1)).not.toThrow();
    });

    it('should return reasonable values for edge positions', () => {
      // Fill heightMap with consistent values
      heightMap.fill(100);

      const cornerAvg = processor.localAveElevation(heightMap, 0, 0);
      const centerAvg = processor.localAveElevation(heightMap, 10, 10);

      // Both should be close to 100 since all values are 100
      expect(cornerAvg).toBeCloseTo(100, 1);
      expect(centerAvg).toBeCloseTo(100, 1);
    });
  });

  describe('normalizeHmapPoles()', () => {
    it('should reduce height values near poles', () => {
      // Fill with high values to see normalization effect
      heightMap.fill(200);

      // Store original values for comparison
      const originalNorthPole = heightMap[0]; // Top row
      const originalSouthPole = heightMap[(height - 1) * width]; // Bottom row

      processor.normalizeHmapPoles(heightMap, tiles);

      // Polar regions should have reduced heights
      const newNorthPole = heightMap[0];
      const newSouthPole = heightMap[(height - 1) * width];

      // Values should be reduced (exact values depend on freeciv algorithm)
      expect(newNorthPole).toBeLessThanOrEqual(originalNorthPole);
      expect(newSouthPole).toBeLessThanOrEqual(originalSouthPole);
    });

    it('should not crash with various height distributions', () => {
      // Test with different height patterns
      expect(() => processor.normalizeHmapPoles(heightMap, tiles)).not.toThrow();

      heightMap.fill(0);
      expect(() => processor.normalizeHmapPoles(heightMap, tiles)).not.toThrow();

      heightMap.fill(255);
      expect(() => processor.normalizeHmapPoles(heightMap, tiles)).not.toThrow();
    });
  });

  describe('renormalizeHmapPoles()', () => {
    it('should restore height values after normalization', () => {
      // Fill with test values
      heightMap.fill(150);

      // Make copies to track changes
      const originalHeights = [...heightMap];

      // Normalize then renormalize
      processor.normalizeHmapPoles(heightMap, tiles);
      const normalizedHeights = [...heightMap];
      processor.renormalizeHmapPoles(heightMap, tiles);

      // Most non-zero values should be closer to original after renormalization
      let restoredCount = 0;

      for (let i = 0; i < heightMap.length; i++) {
        if (originalHeights[i] > 0 && heightMap[i] > 0) {
          const originalDiff = Math.abs(normalizedHeights[i] - originalHeights[i]);
          const restoredDiff = Math.abs(heightMap[i] - originalHeights[i]);

          // Renormalization should generally move values closer to original
          if (restoredDiff <= originalDiff) {
            restoredCount++;
          }
        }
      }

      // At least some values should be restored closer to original
      expect(restoredCount).toBeGreaterThan(0);
    });

    it('should handle zero values correctly', () => {
      // Set some values to zero and others to positive values
      for (let i = 0; i < heightMap.length; i++) {
        heightMap[i] = i % 3 === 0 ? 0 : 100;
      }

      processor.normalizeHmapPoles(heightMap, tiles);
      processor.renormalizeHmapPoles(heightMap, tiles);

      // Zero values should remain zero
      for (let i = 0; i < heightMap.length; i++) {
        if (i % 3 === 0) {
          expect(heightMap[i]).toBe(0);
        }
      }
    });
  });

  describe('validateHeightConstraints()', () => {
    it('should validate height-terrain consistency', () => {
      const shoreLevel = 100;

      // Set up consistent height-terrain mapping
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const index = y * width + x;
          if (x < width / 2) {
            heightMap[index] = 50; // Below shore level
            tiles[x][y].terrain = 'ocean';
          } else {
            heightMap[index] = 150; // Above shore level
            tiles[x][y].terrain = 'grassland';
          }
        }
      }

      const isValid = processor.validateHeightConstraints(tiles, heightMap, shoreLevel);
      expect(isValid).toBe(true);
    });

    it('should detect height-terrain inconsistencies', () => {
      const shoreLevel = 100;

      // Set up inconsistent mapping (high land as ocean)
      for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          const index = y * width + x;
          heightMap[index] = 150; // High elevation
          tiles[x][y].terrain = 'ocean'; // But marked as ocean
        }
      }

      const isValid = processor.validateHeightConstraints(tiles, heightMap, shoreLevel);
      expect(isValid).toBe(false);
    });
  });

  describe('getHeightStatistics()', () => {
    it('should calculate correct statistics', () => {
      // Create height map with known values
      heightMap = [10, 20, 30, 40, 50];

      const stats = processor.getHeightStatistics(heightMap);

      expect(stats.min).toBe(10);
      expect(stats.max).toBe(50);
      expect(stats.avg).toBe(30);
      expect(stats.median).toBe(30);
    });

    it('should handle edge cases', () => {
      // Single value
      heightMap = [100];
      let stats = processor.getHeightStatistics(heightMap);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(100);
      expect(stats.avg).toBe(100);
      expect(stats.median).toBe(100);

      // Two values
      heightMap = [50, 150];
      stats = processor.getHeightStatistics(heightMap);
      expect(stats.min).toBe(50);
      expect(stats.max).toBe(150);
      expect(stats.avg).toBe(100);
      expect(stats.median).toBe(150); // Median is the element at floor(length/2) after sorting
    });
  });
});
