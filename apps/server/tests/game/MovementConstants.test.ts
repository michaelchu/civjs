import {
  SINGLE_MOVE,
  TERRAIN_MOVEMENT_COSTS,
  MovementType,
  UNIT_MOVEMENT_TYPES,
  getTerrainMovementCost,
  canUnitEnterTerrain,
  calculateMovementCost,
} from '@game/constants/MovementConstants';

describe('MovementConstants', () => {
  describe('basic constants', () => {
    it('should have correct SINGLE_MOVE value', () => {
      expect(SINGLE_MOVE).toBe(3);
    });

    it('should have terrain movement costs defined', () => {
      expect(TERRAIN_MOVEMENT_COSTS.grassland).toBe(SINGLE_MOVE);
      expect(TERRAIN_MOVEMENT_COSTS.hills).toBe(SINGLE_MOVE * 2);
      expect(TERRAIN_MOVEMENT_COSTS.mountains).toBe(SINGLE_MOVE * 3);
    });

    it('should have unit movement types defined', () => {
      expect(UNIT_MOVEMENT_TYPES.warrior).toBe(MovementType.LAND);
      expect(UNIT_MOVEMENT_TYPES.trireme).toBe(MovementType.SEA);
    });
  });

  describe('getTerrainMovementCost', () => {
    it('should return correct base costs without unit type', () => {
      expect(getTerrainMovementCost('grassland')).toBe(3);
      expect(getTerrainMovementCost('hills')).toBe(6);
      expect(getTerrainMovementCost('mountains')).toBe(9);
    });

    it('should return default cost for unknown terrain', () => {
      expect(getTerrainMovementCost('unknown_terrain')).toBe(SINGLE_MOVE);
    });

    it('should handle land units correctly', () => {
      expect(getTerrainMovementCost('grassland', 'warrior')).toBe(3);
      expect(getTerrainMovementCost('hills', 'warrior')).toBe(6);
      expect(getTerrainMovementCost('ocean', 'warrior')).toBe(-1); // Impassable
      expect(getTerrainMovementCost('deep_ocean', 'warrior')).toBe(-1); // Impassable
    });

    it('should handle sea units correctly', () => {
      expect(getTerrainMovementCost('ocean', 'trireme')).toBe(3);
      expect(getTerrainMovementCost('coast', 'trireme')).toBe(3);
      expect(getTerrainMovementCost('grassland', 'trireme')).toBe(-1); // Impassable
      expect(getTerrainMovementCost('hills', 'trireme')).toBe(-1); // Impassable
    });

    it('should default to land movement for unknown unit types', () => {
      expect(getTerrainMovementCost('grassland', 'unknown_unit')).toBe(3);
      expect(getTerrainMovementCost('ocean', 'unknown_unit')).toBe(-1);
    });
  });

  describe('canUnitEnterTerrain', () => {
    it('should allow land units on land terrain', () => {
      expect(canUnitEnterTerrain('grassland', 'warrior')).toBe(true);
      expect(canUnitEnterTerrain('hills', 'warrior')).toBe(true);
      expect(canUnitEnterTerrain('mountains', 'warrior')).toBe(true);
    });

    it('should prevent land units from entering water', () => {
      expect(canUnitEnterTerrain('ocean', 'warrior')).toBe(false);
      expect(canUnitEnterTerrain('deep_ocean', 'warrior')).toBe(false);
    });

    it('should allow sea units on water terrain', () => {
      expect(canUnitEnterTerrain('ocean', 'trireme')).toBe(true);
      expect(canUnitEnterTerrain('coast', 'trireme')).toBe(true);
      expect(canUnitEnterTerrain('lake', 'trireme')).toBe(true);
    });

    it('should prevent sea units from entering land', () => {
      expect(canUnitEnterTerrain('grassland', 'trireme')).toBe(false);
      expect(canUnitEnterTerrain('hills', 'trireme')).toBe(false);
    });
  });

  describe('calculateMovementCost', () => {
    it('should calculate correct cost for straight movement', () => {
      const cost = calculateMovementCost(0, 0, 1, 0, 'grassland', 'warrior');
      expect(cost).toBe(3); // SINGLE_MOVE
    });

    it('should calculate higher cost for diagonal movement', () => {
      const straightCost = calculateMovementCost(0, 0, 1, 0, 'grassland', 'warrior');
      const diagonalCost = calculateMovementCost(0, 0, 1, 1, 'grassland', 'warrior');

      expect(diagonalCost).toBeGreaterThan(straightCost);
      expect(diagonalCost).toBe(Math.floor(3 * 1.5)); // 1.5x multiplier for diagonal
    });

    it('should return -1 for impassable terrain', () => {
      const cost = calculateMovementCost(0, 0, 1, 0, 'ocean', 'warrior');
      expect(cost).toBe(-1);
    });

    it('should handle different terrain types correctly', () => {
      const grasslandCost = calculateMovementCost(0, 0, 1, 0, 'grassland', 'warrior');
      const hillsCost = calculateMovementCost(0, 0, 1, 0, 'hills', 'warrior');
      const mountainsCost = calculateMovementCost(0, 0, 1, 0, 'mountains', 'warrior');

      expect(grasslandCost).toBe(3);
      expect(hillsCost).toBe(6);
      expect(mountainsCost).toBe(9);
    });

    it('should handle diagonal movement on different terrains', () => {
      const grasslandDiagonal = calculateMovementCost(0, 0, 1, 1, 'grassland', 'warrior');
      const hillsDiagonal = calculateMovementCost(0, 0, 1, 1, 'hills', 'warrior');

      expect(grasslandDiagonal).toBe(Math.floor(3 * 1.5));
      expect(hillsDiagonal).toBe(Math.floor(6 * 1.5));
    });

    it('should validate movement distances', () => {
      // Test that it only calculates for adjacent tiles
      const validCost = calculateMovementCost(0, 0, 1, 0, 'grassland', 'warrior');
      expect(validCost).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle null/undefined inputs gracefully', () => {
      expect(getTerrainMovementCost('')).toBe(SINGLE_MOVE);
      expect(getTerrainMovementCost('grassland', '')).toBe(3);
    });

    it('should handle coast terrain correctly for different unit types', () => {
      expect(getTerrainMovementCost('coast', 'warrior')).toBe(3); // Land units can use coast
      expect(getTerrainMovementCost('coast', 'trireme')).toBe(3); // Sea units can use coast
    });

    it('should handle lake terrain correctly', () => {
      expect(getTerrainMovementCost('lake', 'warrior')).toBe(-1); // Land units cannot cross lakes
      expect(getTerrainMovementCost('lake', 'trireme')).toBe(3); // Sea units can use lakes
    });
  });

  describe('movement type system', () => {
    it('should have all movement types defined', () => {
      expect(MovementType.LAND).toBe('land');
      expect(MovementType.SEA).toBe('sea');
      expect(MovementType.BOTH).toBe('both');
      expect(MovementType.AIR).toBe('air');
    });

    it('should support future unit types', () => {
      // Test that the system can handle adding new unit types
      const newUnitCost = getTerrainMovementCost('grassland', 'future_unit');
      expect(newUnitCost).toBe(3); // Should default to land movement
    });
  });

  describe('terrain coverage', () => {
    it('should have costs for all basic terrain types', () => {
      const basicTerrains = [
        'ocean',
        'coast',
        'deep_ocean',
        'lake',
        'plains',
        'grassland',
        'desert',
        'tundra',
        'hills',
        'forest',
        'jungle',
        'swamp',
        'mountains',
      ];

      basicTerrains.forEach(terrain => {
        expect(TERRAIN_MOVEMENT_COSTS[terrain]).toBeDefined();
        expect(TERRAIN_MOVEMENT_COSTS[terrain]).toBeGreaterThan(0);
      });
    });

    it('should categorize terrain costs logically', () => {
      // Easy terrain (1 movement point)
      const easyTerrains = ['ocean', 'coast', 'plains', 'grassland'];
      easyTerrains.forEach(terrain => {
        expect(TERRAIN_MOVEMENT_COSTS[terrain]).toBe(SINGLE_MOVE);
      });

      // Difficult terrain (2 movement points)
      const difficultTerrains = ['hills', 'forest', 'jungle', 'swamp'];
      difficultTerrains.forEach(terrain => {
        expect(TERRAIN_MOVEMENT_COSTS[terrain]).toBe(SINGLE_MOVE * 2);
      });

      // Very difficult terrain (3 movement points)
      expect(TERRAIN_MOVEMENT_COSTS.mountains).toBe(SINGLE_MOVE * 3);
    });
  });
});
