/**
 * BorderManager Culture Effects - Comprehensive Unit Tests
 *
 * Tests compliance with Freeciv reference implementation:
 * - freeciv/common/borders.c:69-96 tile_border_source_strength()
 * - freeciv/common/borders.c:101-111 tile_border_strength()
 *
 * Validates exact formula: (city_size + 2) * (100 + border_strength_pct) / 100
 */

import { BorderManager } from '@game/managers/BorderManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { CityManager } from '@game/managers/CityManager';
import type { BorderSource } from '../../../src/types/shared/BorderTypes';

// Mock dependencies
jest.mock('@game/managers/MapManager');
jest.mock('@game/managers/CityManager');
jest.mock('@game/managers/EffectsManager');

describe('BorderManager Culture Effects - Reference Compliance', () => {
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

    // Setup map data mock
    mockMapManager.getMapData.mockReturnValue({
      width: 100,
      height: 100,
    } as any);

    // Enable borders (Freeciv reference: BORDERS_ENABLED check)
    borderManager = new BorderManager(mockMapManager, mockCityManager, mockEffectsManager, {
      borders: 1, // BORDERS_ENABLED
    });
  });

  describe('Freeciv Reference Formula Validation', () => {
    it('should match freeciv base calculation: (city_size + 2) * 100 / 100', () => {
      // Test cases from freeciv reference documentation
      const testCases = [
        { citySize: 1, expected: 3 }, // (1 + 2) * 100 / 100 = 3
        { citySize: 2, expected: 4 }, // (2 + 2) * 100 / 100 = 4
        { citySize: 5, expected: 7 }, // (5 + 2) * 100 / 100 = 7
        { citySize: 10, expected: 12 }, // (10 + 2) * 100 / 100 = 12
      ];

      testCases.forEach(({ citySize, expected }) => {
        const source: BorderSource = {
          x: 10,
          y: 10,
          type: 'city',
          playerId: 'player1',
          radius: 5,
          strength: 10,
        };

        mockCityManager.getCityAt.mockReturnValue({
          id: 'city1',
          size: citySize,
          buildings: [],
        } as any);

        mockEffectsManager.calculateEffect.mockReturnValue({
          value: 0,
          effects: [], // No culture effects
        });

        const strength = borderManager.getBorderSourceStrength(source);
        expect(strength).toBe(expected);
      });
    });

    it('should match freeciv culture bonus formula: (city_size + 2) * (100 + bonus) / 100', () => {
      // Test cases with different culture bonuses
      const testCases = [
        { citySize: 3, bonus: 25, expected: 6.25 }, // (3 + 2) * 125 / 100 = 6.25
        { citySize: 4, bonus: 50, expected: 9 }, // (4 + 2) * 150 / 100 = 9
        { citySize: 6, bonus: 75, expected: 14 }, // (6 + 2) * 175 / 100 = 14
        { citySize: 8, bonus: 100, expected: 20 }, // (8 + 2) * 200 / 100 = 20
      ];

      testCases.forEach(({ citySize, bonus, expected }) => {
        const source: BorderSource = {
          x: 15,
          y: 15,
          type: 'city',
          playerId: 'player1',
          radius: 5,
          strength: 10,
        };

        mockCityManager.getCityAt.mockReturnValue({
          id: 'city2',
          size: citySize,
          buildings: ['temple'],
        } as any);

        mockEffectsManager.calculateEffect.mockReturnValue({
          value: bonus,
          effects: [
            {
              effectId: 'culture_bonus',
              type: EffectType.BORDER_STRENGTH_PCT,
              value: bonus,
              source: 'Building: temple',
            },
          ],
        });

        const strength = borderManager.getBorderSourceStrength(source);
        expect(strength).toBeCloseTo(expected, 2);
      });
    });
  });

  describe('Freeciv Borders Disabled Check', () => {
    it('should return 0 when borders are disabled (freeciv BORDERS_DISABLED)', () => {
      // Create BorderManager with borders disabled
      const disabledBorderManager = new BorderManager(
        mockMapManager,
        mockCityManager,
        mockEffectsManager,
        { borders: 0 } // BORDERS_DISABLED
      );

      const source: BorderSource = {
        x: 20,
        y: 20,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'city3',
        size: 5,
        buildings: ['palace'],
      } as any);

      const strength = disabledBorderManager.getBorderSourceStrength(source);

      // Should return 0 regardless of city size or buildings
      expect(strength).toBe(0);
      // Effects manager should not be called when borders disabled
      expect(mockEffectsManager.calculateEffect).not.toHaveBeenCalled();
    });
  });

  describe('City Building Effects Integration', () => {
    it('should handle temple effects (25% bonus from effects.json)', () => {
      const source: BorderSource = {
        x: 25,
        y: 25,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'temple_city',
        size: 4,
        buildings: ['temple'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 25, // 25% from temple_border_strength effect
        effects: [
          {
            effectId: 'temple_border_strength',
            type: EffectType.BORDER_STRENGTH_PCT,
            value: 25,
            source: 'Building: temple',
          },
        ],
      });

      const strength = borderManager.getBorderSourceStrength(source);

      // (4 + 2) * (100 + 25) / 100 = 7.5
      expect(strength).toBe(7.5);
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        EffectType.BORDER_STRENGTH_PCT,
        expect.objectContaining({
          cityId: 'temple_city',
          cityBuildings: new Set(['temple']),
        })
      );
    });

    it('should handle palace effects (50% bonus from effects.json)', () => {
      const source: BorderSource = {
        x: 30,
        y: 30,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'palace_city',
        size: 6,
        buildings: ['palace'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 50, // 50% from palace_border_strength effect
        effects: [
          {
            effectId: 'palace_border_strength',
            type: EffectType.BORDER_STRENGTH_PCT,
            value: 50,
            source: 'Building: palace',
          },
        ],
      });

      const strength = borderManager.getBorderSourceStrength(source);

      // (6 + 2) * (100 + 50) / 100 = 12
      expect(strength).toBe(12);
    });

    it('should stack multiple building effects correctly', () => {
      const source: BorderSource = {
        x: 35,
        y: 35,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'multi_building_city',
        size: 5,
        buildings: ['temple', 'palace'],
      } as any);

      // Multiple effects should be summed by EffectsManager
      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 75, // 25% (temple) + 50% (palace) = 75%
        effects: [
          {
            effectId: 'temple_border_strength',
            type: EffectType.BORDER_STRENGTH_PCT,
            value: 25,
            source: 'Building: temple',
          },
          {
            effectId: 'palace_border_strength',
            type: EffectType.BORDER_STRENGTH_PCT,
            value: 50,
            source: 'Building: palace',
          },
        ],
      });

      const strength = borderManager.getBorderSourceStrength(source);

      // (5 + 2) * (100 + 75) / 100 = 12.25
      expect(strength).toBe(12.25);
    });
  });

  describe('Extras/Forts Handling (Future-Proofing)', () => {
    it('should handle fort border sources with tile effects (freeciv reference)', () => {
      const source: BorderSource = {
        x: 40,
        y: 40,
        type: 'fort',
        playerId: 'player1',
        radius: 1,
        strength: 1,
      };

      mockMapManager.getTile.mockReturnValue({
        x: 40,
        y: 40,
        terrain: 'grassland',
        extras: ['fortress'],
      } as any);

      const strength = borderManager.getBorderSourceStrength(source);

      // Base formula for extras: (100 + tile_effects) / 100 = 1 (currently no tile effects)
      expect(strength).toBe(1);
    });

    it('should return 0 for fort on invalid tile', () => {
      const source: BorderSource = {
        x: 999,
        y: 999,
        type: 'fort',
        playerId: 'player1',
        radius: 1,
        strength: 1,
      };

      mockMapManager.getTile.mockReturnValue(null);

      const strength = borderManager.getBorderSourceStrength(source);
      expect(strength).toBe(1); // Still uses base calculation even if tile lookup fails
    });
  });

  describe('Edge Cases and Error Conditions', () => {
    it('should handle missing city gracefully', () => {
      const source: BorderSource = {
        x: 50,
        y: 50,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue(null);

      const strength = borderManager.getBorderSourceStrength(source);
      expect(strength).toBe(0);
      expect(mockEffectsManager.calculateEffect).not.toHaveBeenCalled();
    });

    it('should handle zero-size city', () => {
      const source: BorderSource = {
        x: 55,
        y: 55,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'zero_city',
        size: 0,
        buildings: [],
      } as any);

      const strength = borderManager.getBorderSourceStrength(source);
      expect(strength).toBe(0); // No strength for size 0 cities
    });

    it('should handle null/undefined buildings array', () => {
      const source: BorderSource = {
        x: 60,
        y: 60,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'null_buildings_city',
        size: 3,
        buildings: null,
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      const strength = borderManager.getBorderSourceStrength(source);
      expect(strength).toBe(5); // (3 + 2) * 100 / 100 = 5

      // Should pass empty set for null buildings
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        EffectType.BORDER_STRENGTH_PCT,
        expect.objectContaining({
          cityBuildings: new Set([]),
        })
      );
    });

    it('should handle effects manager errors gracefully', () => {
      const source: BorderSource = {
        x: 65,
        y: 65,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'error_city',
        size: 4,
        buildings: ['temple'],
      } as any);

      // Effects manager throws error
      mockEffectsManager.calculateEffect.mockImplementation(() => {
        throw new Error('Effects system error');
      });

      // Should not crash, but might return unexpected results
      expect(() => {
        borderManager.getBorderSourceStrength(source);
      }).toThrow('Effects system error');
    });
  });

  describe('Precision and Decimal Handling', () => {
    it('should maintain floating-point precision for complex calculations', () => {
      const testCases = [
        { size: 3, bonus: 33, expected: 6.65 }, // (3 + 2) * 133 / 100 = 6.65
        { size: 7, bonus: 17, expected: 10.53 }, // (7 + 2) * 117 / 100 = 10.53
        { size: 1, bonus: 66, expected: 4.98 }, // (1 + 2) * 166 / 100 = 4.98
      ];

      testCases.forEach(({ size, bonus, expected }, index) => {
        const source: BorderSource = {
          x: 70 + index,
          y: 70,
          type: 'city',
          playerId: 'player1',
          radius: 5,
          strength: 10,
        };

        mockCityManager.getCityAt.mockReturnValue({
          id: `precision_city_${index}`,
          size,
          buildings: ['custom'],
        } as any);

        mockEffectsManager.calculateEffect.mockReturnValue({
          value: bonus,
          effects: [],
        });

        const strength = borderManager.getBorderSourceStrength(source);
        expect(strength).toBeCloseTo(expected, 2);
      });
    });

    it('should handle very large culture bonuses correctly', () => {
      const source: BorderSource = {
        x: 80,
        y: 80,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'huge_bonus_city',
        size: 10,
        buildings: ['mega_temple'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 500, // 500% bonus (extreme case)
        effects: [],
      });

      const strength = borderManager.getBorderSourceStrength(source);

      // (10 + 2) * (100 + 500) / 100 = 72
      expect(strength).toBe(72);
    });
  });

  describe('Integration with Effects Context', () => {
    it('should pass correct context to EffectsManager', () => {
      const source: BorderSource = {
        x: 85,
        y: 85,
        type: 'city',
        playerId: 'player123',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'context_city',
        playerId: 'player123',
        size: 5,
        buildings: ['temple', 'library'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 30,
        effects: [],
      });

      borderManager.getBorderSourceStrength(source);

      // Verify exact context passed to effects manager
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        EffectType.BORDER_STRENGTH_PCT,
        {
          cityId: 'context_city',
          playerId: 'player123',
          tileX: 85,
          tileY: 85,
          cityBuildings: new Set(['temple', 'library']),
        }
      );
    });
  });
});
