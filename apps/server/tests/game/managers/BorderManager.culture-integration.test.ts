/**
 * BorderManager Culture Integration Tests
 *
 * Tests the integration between culture effects and border strength calculations
 * following Freeciv's formula: (city_size + 2) * (100 + border_strength_pct) / 100
 */

import { BorderManager } from '@game/managers/BorderManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { CityManager } from '@game/managers/CityManager';
import type { BorderSource } from '@game/types/shared/BorderTypes';

// Mock dependencies
jest.mock('@game/managers/MapManager');
jest.mock('@game/managers/CityManager');
jest.mock('@game/managers/EffectsManager');

const MockedMapManager = MapManager as jest.MockedClass<typeof MapManager>;
const MockedCityManager = CityManager as jest.MockedClass<typeof CityManager>;
const MockedEffectsManager = EffectsManager as jest.MockedClass<typeof EffectsManager>;

describe('BorderManager Culture Integration', () => {
  let borderManager: BorderManager;
  let mockMapManager: jest.Mocked<MapManager>;
  let mockCityManager: jest.Mocked<CityManager>;
  let mockEffectsManager: jest.Mocked<EffectsManager>;

  beforeEach(() => {
    mockMapManager = new MockedMapManager() as jest.Mocked<MapManager>;
    mockCityManager = new MockedCityManager() as jest.Mocked<CityManager>;
    mockEffectsManager = new MockedEffectsManager() as jest.Mocked<EffectsManager>;

    // Setup map data mock
    mockMapManager.getMapData.mockReturnValue({
      width: 100,
      height: 100,
    } as any);

    borderManager = new BorderManager(mockMapManager, mockCityManager, mockEffectsManager);
  });

  describe('Border Strength with Culture Effects', () => {
    it('should calculate base border strength without culture effects', () => {
      // Setup: City with size 3, no culture buildings
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
        size: 3,
        buildings: [],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0, // No border strength bonus
        effects: [],
      });

      // Act
      const strength = borderManager.getBorderSourceStrength(source);

      // Assert: Base formula (3 + 2) * (100 + 0) / 100 = 5
      expect(strength).toBe(5);
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        'Border_Strength_Pct',
        expect.objectContaining({
          cityId: 'city1',
          tileX: 10,
          tileY: 10,
          cityBuildings: new Set([]),
        })
      );
    });

    it('should calculate enhanced border strength with temple (25% bonus)', () => {
      // Setup: City with size 3, has temple
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
        size: 3,
        buildings: ['temple'],
      } as any);

      // Temple provides 25% border strength bonus (from effects.json)
      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 25,
        effects: [
          {
            effectId: 'temple_border_strength',
            type: 'Border_Strength_Pct' as any,
            value: 25,
            source: 'Building: temple',
          },
        ],
      });

      // Act
      const strength = borderManager.getBorderSourceStrength(source);

      // Assert: Enhanced formula (3 + 2) * (100 + 25) / 100 = 6.25
      expect(strength).toBe(6.25);
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        'Border_Strength_Pct',
        expect.objectContaining({
          cityId: 'city2',
          cityBuildings: new Set(['temple']),
        })
      );
    });

    it('should calculate maximum border strength with palace (50% bonus)', () => {
      // Setup: Large city with palace
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
        size: 8,
        buildings: ['palace'],
      } as any);

      // Palace provides 50% border strength bonus (from effects.json)
      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 50,
        effects: [
          {
            effectId: 'palace_border_strength',
            type: 'Border_Strength_Pct' as any,
            value: 50,
            source: 'Building: palace',
          },
        ],
      });

      // Act
      const strength = borderManager.getBorderSourceStrength(source);

      // Assert: Maximum formula (8 + 2) * (100 + 50) / 100 = 15
      expect(strength).toBe(15);
    });

    it('should stack multiple cultural buildings effects', () => {
      // Setup: City with both temple and library effects
      const source: BorderSource = {
        x: 25,
        y: 25,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'city4',
        size: 5,
        buildings: ['temple', 'library'],
      } as any);

      // Combined effects: temple (25%) + library buildings might give additional bonuses
      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 30, // Combined cultural influence
        effects: [
          {
            effectId: 'temple_border_strength',
            type: 'Border_Strength_Pct' as any,
            value: 25,
            source: 'Building: temple',
          },
          {
            effectId: 'library_indirect_bonus',
            type: 'Border_Strength_Pct' as any,
            value: 5,
            source: 'Building: library',
          },
        ],
      });

      // Act
      const strength = borderManager.getBorderSourceStrength(source);

      // Assert: Stacked formula (5 + 2) * (100 + 30) / 100 = 9.1
      expect(strength).toBe(9.1);
    });

    it('should handle cities without buildings gracefully', () => {
      // Setup: City with no buildings
      const source: BorderSource = {
        x: 30,
        y: 30,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'city5',
        size: 2,
        buildings: null, // No buildings
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 0,
        effects: [],
      });

      // Act
      const strength = borderManager.getBorderSourceStrength(source);

      // Assert: Base formula (2 + 2) * (100 + 0) / 100 = 4
      expect(strength).toBe(4);
      expect(mockEffectsManager.calculateEffect).toHaveBeenCalledWith(
        'Border_Strength_Pct',
        expect.objectContaining({
          cityBuildings: new Set([]),
        })
      );
    });
  });

  describe('Culture Border Integration Edge Cases', () => {
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

      // Should return 0 for missing cities
      expect(strength).toBe(0);
    });

    it('should maintain Freeciv formula accuracy with decimal results', () => {
      const source: BorderSource = {
        x: 35,
        y: 35,
        type: 'city',
        playerId: 'player1',
        radius: 5,
        strength: 10,
      };

      mockCityManager.getCityAt.mockReturnValue({
        id: 'city6',
        size: 1,
        buildings: ['temple'],
      } as any);

      mockEffectsManager.calculateEffect.mockReturnValue({
        value: 25, // 25% bonus
        effects: [],
      });

      const strength = borderManager.getBorderSourceStrength(source);

      // Exact Freeciv calculation: (1 + 2) * (100 + 25) / 100 = 3.75
      expect(strength).toBe(3.75);
    });
  });
});
