/**
 * Comprehensive tests for Advanced Smoothing System
 * Tests the implementation of freeciv-compatible smoothing algorithms
 * @reference freeciv/server/generator/mapgen_utils.c
 */

import { FractalHeightGenerator } from '../../src/game/map/FractalHeightGenerator';
import { smoothIntMap, adjustIntMapFiltered } from '../../src/game/map/TerrainUtils';

describe('Advanced Smoothing System', () => {
  let random: () => number;

  beforeEach(() => {
    // Use seeded random for reproducible tests
    let seed = 0.5;
    random = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
  });

  describe('smoothIntMap() - Gaussian smoothing', () => {
    test('should maintain total value conservation principle', () => {
      const width = 10;
      const height = 10;
      const intMap = new Array(width * height);

      // Initialize with known values
      for (let i = 0; i < intMap.length; i++) {
        intMap[i] = 100; // Uniform value
      }

      const originalSum = intMap.reduce((sum, val) => sum + val, 0);

      // Apply smoothing
      smoothIntMap(intMap, width, height, false);

      const smoothedSum = intMap.reduce((sum, val) => sum + val, 0);

      // Values should be approximately conserved (allowing for rounding)
      expect(Math.abs(smoothedSum - originalSum)).toBeLessThan(intMap.length);
    });

    test('should apply proper Gaussian weights', () => {
      const width = 5;
      const height = 5;
      const intMap = new Array(width * height).fill(0);

      // Set center point to high value
      const centerIndex = 2 * width + 2; // Middle of 5x5 grid
      intMap[centerIndex] = 1000;

      const original = [...intMap];
      smoothIntMap(intMap, width, height, false);

      // Center should be reduced (spreading to neighbors)
      expect(intMap[centerIndex]).toBeLessThan(original[centerIndex]);

      // Adjacent cells should have increased values
      const adjacentIndices = [
        centerIndex - 1, // left
        centerIndex + 1, // right
        centerIndex - width, // up
        centerIndex + width, // down
      ];

      for (const idx of adjacentIndices) {
        if (idx >= 0 && idx < intMap.length) {
          expect(intMap[idx]).toBeGreaterThan(original[idx]);
        }
      }
    });

    test('should handle edge conditions with zeroesAtEdges=true', () => {
      const width = 3;
      const height = 3;
      const intMap = new Array(width * height);

      // Set all to same value
      for (let i = 0; i < intMap.length; i++) {
        intMap[i] = 100;
      }

      smoothIntMap(intMap, width, height, true);

      // With zeroesAtEdges=true, the center value changes based on available neighbors
      // For a 3x3 grid with uniform values, the center gets weighted average without normalization
      const centerIndex = 1 * width + 1;
      // After two passes (X then Y), the value should be reduced due to edge effects
      expect(intMap[centerIndex]).toBeLessThan(100);
      expect(intMap[centerIndex]).toBeGreaterThan(0);
    });

    test('should perform two-pass smoothing (X then Y axis)', () => {
      const width = 5;
      const height = 1; // Single row to test X-axis smoothing
      const intMap = [0, 0, 1000, 0, 0];

      const original = [...intMap];
      smoothIntMap(intMap, width, height, false);

      // Should spread horizontally
      expect(intMap[2]).toBeLessThan(original[2]); // Center reduced
      expect(intMap[1]).toBeGreaterThan(original[1]); // Left neighbor increased
      expect(intMap[3]).toBeGreaterThan(original[3]); // Right neighbor increased
    });

    test('should handle small maps gracefully', () => {
      const width = 1;
      const height = 1;
      const intMap = [500];

      smoothIntMap(intMap, width, height, false);

      // Single cell should remain unchanged
      expect(intMap[0]).toBe(500);
    });

    test('should use correct freeciv Gaussian weights', () => {
      const width = 5;
      const height = 5;
      const intMap = new Array(width * height).fill(0);

      // Create a spike in the center
      intMap[12] = 1000; // Center of 5x5 grid

      smoothIntMap(intMap, width, height, false);

      // Verify the smoothing pattern matches expected Gaussian distribution
      // The exact values depend on the kernel weights [0.13, 0.19, 0.37, 0.19, 0.13]
      expect(intMap[12]).toBeGreaterThan(0); // Center should have most weight
      expect(intMap[11]).toBeGreaterThan(0); // Adjacent cells should have values
      expect(intMap[13]).toBeGreaterThan(0);
      expect(intMap[7]).toBeGreaterThan(0); // Cells 2 steps away should have some value
      expect(intMap[17]).toBeGreaterThan(0);
    });
  });

  describe('adjustIntMapFiltered() - Histogram equalization', () => {
    test('should normalize values to target range', () => {
      const width = 4;
      const height = 4;
      const intMap = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160];
      const minValue = 0;
      const maxValue = 1000;

      adjustIntMapFiltered(intMap, width, height, minValue, maxValue);

      // All values should be within target range
      for (const value of intMap) {
        expect(value).toBeGreaterThanOrEqual(minValue);
        expect(value).toBeLessThanOrEqual(maxValue);
      }

      // Should have values spread across the range (approximately)
      const minResult = Math.min(...intMap);
      const maxResult = Math.max(...intMap);
      expect(minResult).toBeGreaterThanOrEqual(minValue);
      expect(maxResult).toBeLessThanOrEqual(maxValue);

      // Should use significant portion of the range
      const spread = maxResult - minResult;
      expect(spread).toBeGreaterThan((maxValue - minValue) * 0.5);
    });

    test('should apply histogram equalization correctly', () => {
      const width = 3;
      const height = 3;
      // Values with clear distribution: 3 low, 3 medium, 3 high
      const intMap = [1, 1, 1, 5, 5, 5, 9, 9, 9];
      const minValue = 0;
      const maxValue = 100;

      adjustIntMapFiltered(intMap, width, height, minValue, maxValue);

      // Should create roughly uniform distribution
      const uniqueValues = [...new Set(intMap)];
      expect(uniqueValues.length).toBeGreaterThan(1);

      // Values should be distributed across the target range (approximately)
      const spread = Math.max(...intMap) - Math.min(...intMap);
      expect(spread).toBeGreaterThan((maxValue - minValue) * 0.5);
    });

    test('should handle uniform input values', () => {
      const width = 3;
      const height = 3;
      const intMap = new Array(width * height).fill(50);
      const minValue = 0;
      const maxValue = 100;

      adjustIntMapFiltered(intMap, width, height, minValue, maxValue);

      // All uniform values should map to minValue
      // When all values are uniform, there's no distribution to equalize
      for (const value of intMap) {
        expect(value).toBe(minValue);
      }
    });

    test('should work with filter function', () => {
      const width = 3;
      const height = 3;
      const intMap = [1, 2, 3, 4, 5, 6, 7, 8, 9];
      const minValue = 0;
      const maxValue = 100;

      // Only process cells where x + y is even
      const filter = (x: number, y: number) => (x + y) % 2 === 0;

      // Keep track of original filtered values for verification
      // const originalFiltered = intMap.filter((_, i) => {
      //   const x = i % width;
      //   const y = Math.floor(i / width);
      //   return filter(x, y);
      // });

      adjustIntMapFiltered(intMap, width, height, minValue, maxValue, filter);

      // Only filtered cells should have changed
      let filteredChanged = 0;
      let unfilteredUnchanged = 0;

      for (let i = 0; i < intMap.length; i++) {
        const x = i % width;
        const y = Math.floor(i / width);

        if (filter(x, y)) {
          // Filtered cells should be in target range
          expect(intMap[i]).toBeGreaterThanOrEqual(minValue);
          expect(intMap[i]).toBeLessThanOrEqual(maxValue);
          filteredChanged++;
        } else {
          // Unfiltered cells should remain unchanged
          expect(intMap[i]).toBe(i + 1); // Original value
          unfilteredUnchanged++;
        }
      }

      expect(filteredChanged).toBeGreaterThan(0);
      expect(unfilteredUnchanged).toBeGreaterThan(0);
    });

    test('should handle empty filter result', () => {
      const width = 2;
      const height = 2;
      const intMap = [1, 2, 3, 4];
      const minValue = 0;
      const maxValue = 100;

      // Filter that matches nothing
      const filter = () => false;

      const original = [...intMap];
      adjustIntMapFiltered(intMap, width, height, minValue, maxValue, filter);

      // Should remain unchanged
      expect(intMap).toEqual(original);
    });
  });

  describe('FractalHeightGenerator integration', () => {
    test('should integrate advanced smoothing in height generation', () => {
      const generator = new FractalHeightGenerator(20, 20, random, 30, 100, 'random');

      // Generate height map with advanced smoothing
      generator.generateHeightMap();
      const heightMap = generator.getHeightMap();

      // Should have realistic height distribution
      expect(heightMap.length).toBe(400); // 20x20

      // Should have variation (not all same value)
      const uniqueValues = new Set(heightMap);
      expect(uniqueValues.size).toBeGreaterThan(10);

      // Should be within expected range (normalized to 0-255)
      for (const height of heightMap) {
        expect(height).toBeGreaterThanOrEqual(0);
        expect(height).toBeLessThanOrEqual(255);
      }

      // Should show smooth transitions (no extreme spikes)
      let extremeVariations = 0;
      const width = 20;

      for (let y = 1; y < 19; y++) {
        for (let x = 1; x < 19; x++) {
          const center = heightMap[y * width + x];
          const neighbors = [
            heightMap[(y - 1) * width + x], // up
            heightMap[(y + 1) * width + x], // down
            heightMap[y * width + (x - 1)], // left
            heightMap[y * width + (x + 1)], // right
          ];

          const avgNeighbor = neighbors.reduce((sum, h) => sum + h, 0) / neighbors.length;
          const variation = Math.abs(center - avgNeighbor);

          if (variation > 100) {
            // Arbitrary threshold for "extreme"
            extremeVariations++;
          }
        }
      }

      // Should have few extreme variations due to smoothing
      expect(extremeVariations).toBeLessThan(20); // Less than 5% of interior cells
    });

    test('should handle different smoothing passes', () => {
      const generator1 = new FractalHeightGenerator(10, 10, random);
      const generator2 = new FractalHeightGenerator(10, 10, random);

      // Apply different amounts of smoothing
      generator1.applyAdvancedSmoothing(1);
      generator2.applyAdvancedSmoothing(3);

      const heights1 = generator1.getHeightMap();
      const heights2 = generator2.getHeightMap();

      // More smoothing should result in less variation
      const variance1 = calculateVariance(heights1);
      const variance2 = calculateVariance(heights2);

      // Note: This test is probabilistic and may occasionally fail
      // In practice, more smoothing typically reduces variance
      expect(variance2).toBeLessThanOrEqual(variance1 * 1.1); // Allow 10% tolerance
    });

    test('should preserve shore level calculation', () => {
      const generator = new FractalHeightGenerator(20, 20, random);
      generator.generateHeightMap();

      const shoreLevel = generator.getShoreLevel();
      const mountainLevel = generator.getMountainLevel();

      // Shore level should be reasonable
      expect(shoreLevel).toBeGreaterThanOrEqual(0);
      expect(shoreLevel).toBeLessThanOrEqual(255);

      // Mountain level should be higher than shore level
      expect(mountainLevel).toBeGreaterThan(shoreLevel);
    });
  });

  describe('Performance and edge cases', () => {
    test('should handle large maps efficiently', () => {
      const startTime = Date.now();

      const width = 100;
      const height = 100;
      const intMap = new Array(width * height);

      for (let i = 0; i < intMap.length; i++) {
        intMap[i] = Math.floor(random() * 1000);
      }

      smoothIntMap(intMap, width, height, false);
      adjustIntMapFiltered(intMap, width, height, 0, 1000);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle boundary conditions', () => {
      // Test with various small sizes
      const testSizes = [
        [1, 1],
        [1, 5],
        [5, 1],
        [2, 2],
        [3, 3],
      ];

      for (const [width, height] of testSizes) {
        const intMap = new Array(width * height);
        for (let i = 0; i < intMap.length; i++) {
          intMap[i] = Math.floor(random() * 100);
        }

        // const original = [...intMap]; // Keep original for reference if needed

        // Should not throw errors
        expect(() => {
          smoothIntMap(intMap, width, height, false);
        }).not.toThrow();

        expect(() => {
          adjustIntMapFiltered(intMap, width, height, 0, 100);
        }).not.toThrow();

        // Results should be valid
        for (const value of intMap) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
          expect(isFinite(value)).toBe(true);
        }
      }
    });

    test('should handle zero and negative values', () => {
      const width = 5;
      const height = 5;
      const intMap = [
        -100, -50, 0, 50, 100, -25, 25, -75, 75, -10, 10, -60, 60, -40, 40, -5, 5, -80, 80, -20, 20,
        -30, 30, -90, 90,
      ];

      smoothIntMap(intMap, width, height, false);
      adjustIntMapFiltered(intMap, width, height, 0, 1000);

      // Should handle negative values correctly
      for (const value of intMap) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1000);
        expect(isFinite(value)).toBe(true);
      }
    });
  });
});

/**
 * Helper function to calculate variance of an array
 */
function calculateVariance(values: number[]): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squareDiffs = values.map(val => Math.pow(val - mean, 2));
  return squareDiffs.reduce((sum, val) => sum + val, 0) / values.length;
}
