/**
 * BorderManager Tile Border Strength Tests
 *
 * Tests the tile border strength calculation following Freeciv reference:
 * - freeciv/common/borders.c:101-111 tile_border_strength()
 *
 * Formula: full_strength * full_strength / sq_dist
 * Special case: source tile itself returns FC_INFINITY
 */

import { BorderManager } from '@game/managers/BorderManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { CityManager } from '@game/managers/CityManager';
import { FC_INFINITY } from '@game/constants/BorderConstants';
import type { BorderSource } from '../../../src/types/shared/BorderTypes';

// Mock dependencies
jest.mock('@game/managers/MapManager');
jest.mock('@game/managers/CityManager');
jest.mock('@game/managers/EffectsManager');

describe('BorderManager Tile Border Strength - Reference Compliance', () => {
  let borderManager: BorderManager;
  let mockMapManager: jest.Mocked<MapManager>;
  let mockCityManager: jest.Mocked<CityManager>;
  let mockEffectsManager: jest.Mocked<EffectsManager>;

  beforeEach(() => {
    mockMapManager = {
      getMapData: jest.fn(),
      getTile: jest.fn(),
    } as any;
    mockCityManager = {
      getCityAt: jest.fn(),
    } as any;
    mockEffectsManager = {
      calculateEffect: jest.fn(),
    } as any;

    mockMapManager.getMapData.mockReturnValue({
      width: 100,
      height: 100,
    } as any);

    borderManager = new BorderManager(mockMapManager, mockCityManager, mockEffectsManager);
  });

  describe('Freeciv Tile Border Strength Formula', () => {
    it('should return FC_INFINITY for source tile itself (sq_dist = 0)', () => {
      const source: BorderSource = {
        x: 10,
        y: 10,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 8,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'source_city',
        size: 6,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Test tile at same coordinates as source
      const strength = borderManager.getTileBorderStrength(10, 10, source);

      // Source tile should have infinite strength
      expect(strength).toBe(FC_INFINITY);
    });

    it('should calculate strength using freeciv formula: full_strength² / sq_dist', () => {
      // Test cases based on freeciv distance calculations
      const testCases = [
        {
          distance: { dx: 1, dy: 0 }, // Adjacent tile
          expectedSqDist: 1,
          fullStrength: 5, // (3 + 2) * 100 / 100 = 5
          expectedTileStrength: 25, // 5² / 1 = 25
        },
        {
          distance: { dx: 2, dy: 0 }, // 2 tiles away
          expectedSqDist: 4,
          fullStrength: 5,
          expectedTileStrength: 6.25, // 5² / 4 = 6.25
        },
        {
          distance: { dx: 1, dy: 1 }, // Diagonal
          expectedSqDist: 2,
          fullStrength: 5,
          expectedTileStrength: 12.5, // 5² / 2 = 12.5
        },
        {
          distance: { dx: 3, dy: 4 }, // Pythagorean triple
          expectedSqDist: 25,
          fullStrength: 10,
          expectedTileStrength: 4, // 10² / 25 = 4
        },
      ];

      testCases.forEach(
        ({ distance, expectedSqDist, fullStrength, expectedTileStrength }, index) => {
          const source: BorderSource = {
            x: 20,
            y: 20,
            type: 'city',
            playerId: 'player1',
            radius: 5,
            strength: 10,
          };

          // Setup city to produce the expected full strength
          mockCityManager.getCityAt.mockReturnValue({
            id: `test_city_${index}`,
            size: 3,
            buildings: [],
          } as any);

          // Mock effects to achieve desired full strength
          const cultureBonusNeeded = (fullStrength / 5) * 100 - 100; // Solve for bonus
          mockEffectsManager.calculateEffect.mockReturnValue({
            value: cultureBonusNeeded,
            effects: [],
          });

          // Calculate tile strength at offset position
          const tileX = source.x + distance.dx;
          const tileY = source.y + distance.dy;
          const calculatedSqDist = distance.dx * distance.dx + distance.dy * distance.dy;

          expect(calculatedSqDist).toBe(expectedSqDist); // Verify our test math

          const tileStrength = borderManager.getTileBorderStrength(tileX, tileY, source);
          expect(tileStrength).toBeCloseTo(expectedTileStrength, 2);
        }
      );
    });

    it('should handle culture bonuses in tile strength calculations', () => {
      const source: BorderSource = {
        x: 30,
        y: 30,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      // City with temple providing 25% border strength bonus
      mockCityManager.getCityAt.mockReturnValue({
        id: 'temple_city',
        size: 4,
        buildings: ['temple'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 25, // 25% bonus from temple
        effects: [],
      });

      // Full strength: (4 + 2) * (100 + 25) / 100 = 7.5
      // Full strength: (4 + 2) * (100 + 25) / 100 = 7.5

      // Test at distance 1 (adjacent tile)
      const tileStrength = borderManager.getTileBorderStrength(31, 30, source);

      // Expected: 7.5² / 1 = 56.25
      expect(tileStrength).toBeCloseTo(56.25, 2);
    });

    it('should handle very large distances correctly', () => {
      const source: BorderSource = {
        x: 50,
        y: 50,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'distant_city',
        size: 8,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Full strength: (8 + 2) * 100 / 100 = 10
      // Distance: dx=10, dy=10, sq_dist = 200
      const tileStrength = borderManager.getTileBorderStrength(60, 60, source);

      // Expected: 10² / 200 = 0.5
      expect(tileStrength).toBeCloseTo(0.5, 2);
    });
  });

  describe('Distance Calculation Accuracy', () => {
    it('should calculate squared distance correctly for all directions', () => {
      const source: BorderSource = {
        x: 40,
        y: 40,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'center_city',
        size: 5,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Full strength: (5 + 2) * 100 / 100 = 7
      const expectedFullStrength = 7;

      // Test cardinal directions
      const cardinalTests = [
        { pos: [41, 40], direction: 'East', expectedSqDist: 1 },
        { pos: [39, 40], direction: 'West', expectedSqDist: 1 },
        { pos: [40, 41], direction: 'South', expectedSqDist: 1 },
        { pos: [40, 39], direction: 'North', expectedSqDist: 1 },
      ];

      cardinalTests.forEach(({ pos, expectedSqDist }) => {
        const strength = borderManager.getTileBorderStrength(pos[0], pos[1], source);
        const expectedStrength = (expectedFullStrength * expectedFullStrength) / expectedSqDist;

        expect(strength).toBeCloseTo(expectedStrength, 2);
      });

      // Test diagonal directions
      const diagonalTests = [
        { pos: [41, 41], direction: 'Southeast', expectedSqDist: 2 },
        { pos: [39, 39], direction: 'Northwest', expectedSqDist: 2 },
        { pos: [41, 39], direction: 'Northeast', expectedSqDist: 2 },
        { pos: [39, 41], direction: 'Southwest', expectedSqDist: 2 },
      ];

      diagonalTests.forEach(({ pos, expectedSqDist }) => {
        const strength = borderManager.getTileBorderStrength(pos[0], pos[1], source);
        const expectedStrength = (expectedFullStrength * expectedFullStrength) / expectedSqDist;

        expect(strength).toBeCloseTo(expectedStrength, 2);
      });
    });

    it('should handle asymmetric distances correctly', () => {
      const source: BorderSource = {
        x: 0,
        y: 0,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'origin_city',
        size: 3,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Full strength: (3 + 2) * 100 / 100 = 5

      // Test asymmetric distances
      const asymmetricTests = [
        { pos: [3, 1], expectedSqDist: 10 }, // 3² + 1² = 10
        { pos: [1, 4], expectedSqDist: 17 }, // 1² + 4² = 17
        { pos: [5, 2], expectedSqDist: 29 }, // 5² + 2² = 29
      ];

      asymmetricTests.forEach(({ pos, expectedSqDist }) => {
        const strength = borderManager.getTileBorderStrength(pos[0], pos[1], source);
        const expectedStrength = (5 * 5) / expectedSqDist;

        expect(strength).toBeCloseTo(expectedStrength, 2);
      });
    });
  });

  describe('Error Conditions and Edge Cases', () => {
    it('should handle negative coordinates correctly', () => {
      const source: BorderSource = {
        x: 5,
        y: 5,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'negative_test_city',
        size: 4,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Test with coordinates that would create negative distances
      const strength = borderManager.getTileBorderStrength(2, 2, source);

      // Distance: dx=-3, dy=-3, sq_dist = 18
      // Full strength: (4 + 2) * 100 / 100 = 6
      // Expected: 6² / 18 = 2
      expect(strength).toBeCloseTo(2, 2);
    });

    it('should maintain precision with very small distances', () => {
      const source: BorderSource = {
        x: 100,
        y: 100,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'precision_city',
        size: 1,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Full strength: (1 + 2) * 100 / 100 = 3
      // Test minimal distance
      const strength = borderManager.getTileBorderStrength(100, 101, source);

      // Distance: dx=0, dy=1, sq_dist = 1
      // Expected: 3² / 1 = 9
      expect(strength).toBe(9);
    });

    it('should handle maximum theoretical strength correctly', () => {
      const source: BorderSource = {
        x: 75,
        y: 75,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      // Very large city with maximum culture bonus
      mockCityManager.getCityAt.mockReturnValue({
        id: 'max_city',
        size: 50,
        buildings: ['mega_palace'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 1000, // 1000% bonus (extreme theoretical case)
        effects: [],
      });

      // Full strength: (50 + 2) * (100 + 1000) / 100 = 572
      const strength = borderManager.getTileBorderStrength(76, 75, source);

      // Distance: dx=1, dy=0, sq_dist = 1
      // Expected: 572² / 1 = 327184
      expect(strength).toBe(327184);
    });
  });

  describe('Consistency with Border Source Strength', () => {
    it('should use same border source strength calculation', () => {
      const source: BorderSource = {
        x: 60,
        y: 60,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'consistency_city',
        size: 7,
        buildings: ['temple'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 25,
        effects: [],
      });

      // Get border source strength directly
      const sourceStrength = borderManager.getBorderSourceStrength(source);

      // Get tile strength at distance 2
      const tileStrength = borderManager.getTileBorderStrength(62, 60, source);

      // Distance: dx=2, dy=0, sq_dist = 4
      // Tile strength should be sourceStrength² / 4
      const expectedTileStrength = (sourceStrength * sourceStrength) / 4;

      expect(tileStrength).toBeCloseTo(expectedTileStrength, 2);
    });
  });
});
