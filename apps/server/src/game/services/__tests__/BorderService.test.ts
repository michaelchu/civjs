/**
 * BorderService tests - Verify compliance with reference implementation
 * Based on reference/freeciv/common/borders.c and reference/freeciv/server/maphand.c
 */

import { BorderService, BorderSource } from '../BorderService';
import { BorderMode, BorderConfiguration, City } from '../../types/common';

describe('BorderService', () => {
  const mockBorderConfig: BorderConfiguration = {
    borderMode: BorderMode.ENABLED,
    borderCityRadiusSquared: 17, // Default freeciv city radius^2 (~4 tiles)
    borderSizeEffect: 1, // Each city size adds 1 to radius
    borderVision: false,
    borderStrengthPct: 0,
    happyBorders: false
  };

  let borderService: BorderService;

  beforeEach(() => {
    borderService = new BorderService(mockBorderConfig, 50, 50); // 50x50 map
  });

  describe('Border Source Radius Calculation', () => {
    it('should calculate correct base radius for size 1 city', () => {
      // Reference: freeciv/common/borders.c:tile_border_source_radius_sq()
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const radiusSquared = borderService.calculateBorderSourceRadiusSquared(source, 1);
      
      // Expected: base radius (17) + city size effect (1 * 1) = 18
      expect(radiusSquared).toBe(18);
    });

    it('should calculate correct radius for larger cities', () => {
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const radiusSquared = borderService.calculateBorderSourceRadiusSquared(source, 5);
      
      // Expected: base radius (17) + city size effect (5 * 1) = 22
      expect(radiusSquared).toBe(22);
    });

    it('should respect maximum city radius limits', () => {
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      // Test very large city size (should be capped)
      const radiusSquared = borderService.calculateBorderSourceRadiusSquared(source, 100);
      
      // Expected: base radius (17) + max city size effect (26 * 1) = 43
      // Reference: CITY_MAP_MAX_RADIUS_SQ = 26
      expect(radiusSquared).toBe(43);
    });

    it('should return 0 when borders are disabled', () => {
      const disabledConfig: BorderConfiguration = {
        ...mockBorderConfig,
        borderMode: BorderMode.DISABLED
      };
      const disabledService = new BorderService(disabledConfig, 50, 50);

      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const radiusSquared = disabledService.calculateBorderSourceRadiusSquared(source, 5);
      expect(radiusSquared).toBe(0);
    });
  });

  describe('Border Strength Calculation', () => {
    it('should calculate correct strength for cities', () => {
      // Reference: freeciv/common/borders.c:tile_border_source_strength()
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const strength = borderService.calculateBorderSourceStrength(source, 5);
      
      // Expected: (city_size + 2) * (100 + strength_pct) / 100
      // (5 + 2) * (100 + 0) / 100 = 7
      expect(strength).toBe(7);
    });

    it('should apply strength percentage bonuses', () => {
      const bonusConfig: BorderConfiguration = {
        ...mockBorderConfig,
        borderStrengthPct: 50 // 50% bonus
      };
      const bonusService = new BorderService(bonusConfig, 50, 50);

      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const strength = bonusService.calculateBorderSourceStrength(source, 5);
      
      // Expected: (5 + 2) * (100 + 50) / 100 = 10.5
      expect(strength).toBe(10.5);
    });

    it('should calculate distance-based strength falloff', () => {
      // Reference: freeciv/common/borders.c:tile_border_strength()
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const strengthAtSource = borderService.calculateBorderStrengthAtTile(10, 10, source, 5);
      const strengthNearby = borderService.calculateBorderStrengthAtTile(11, 11, source, 5);

      // Strength at source should be maximum (infinity in original)
      expect(strengthAtSource).toBe(Number.MAX_SAFE_INTEGER);
      
      // Strength should decrease with distance
      expect(strengthNearby).toBeLessThan(strengthAtSource);
      expect(strengthNearby).toBeGreaterThan(0);
    });
  });

  describe('Tile Radius Calculation', () => {
    it('should return tiles within circular radius', () => {
      const tiles = borderService.getTilesInRadius(10, 10, 5);
      
      // Should include center tile
      expect(tiles).toContainEqual({ x: 10, y: 10 });
      
      // Should include tiles at distance sqrt(5) or less
      expect(tiles).toContainEqual({ x: 12, y: 11 }); // distance^2 = 5
      
      // Should not include tiles outside radius
      expect(tiles).not.toContainEqual({ x: 13, y: 13 }); // distance^2 = 18
    });

    it('should respect map boundaries', () => {
      const tiles = borderService.getTilesInRadius(1, 1, 10);
      
      // Should not return tiles with negative coordinates
      const negativeTiles = tiles.filter(tile => tile.x < 0 || tile.y < 0);
      expect(negativeTiles).toHaveLength(0);
    });
  });

  describe('Border Claiming', () => {
    it('should claim tiles within city border radius', () => {
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const initialTiles = {
        '10,10': { x: 10, y: 10, terrain: 'grassland', visible: true, known: true },
        '11,10': { x: 11, y: 10, terrain: 'grassland', visible: true, known: true },
        '12,10': { x: 12, y: 10, terrain: 'grassland', visible: true, known: true },
      };

      const cities = {
        'city1': {
          id: 'city1',
          name: 'TestCity',
          playerId: 'player1',
          x: 10,
          y: 10,
          size: 1
        } as City
      };

      const updatedTiles = borderService.claimBorders(source, initialTiles, cities, 1, -1);

      // Tiles within radius should be claimed
      expect(updatedTiles['10,10'].owner).toBe('player1');
      expect(updatedTiles['10,10'].claimer).toBe('city1');
      expect(updatedTiles['11,10'].owner).toBe('player1');
      expect(updatedTiles['11,10'].claimer).toBe('city1');
    });

    it('should resolve border conflicts based on strength', () => {
      const source1: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 10,
        y: 10,
        type: 'city'
      };

      const source2: BorderSource = {
        id: 'city2',
        playerId: 'player2',
        x: 12,
        y: 10,
        type: 'city'
      };

      const initialTiles = {
        '11,10': { x: 11, y: 10, terrain: 'grassland', visible: true, known: true },
      };

      const cities = {
        'city1': { id: 'city1', name: 'City1', playerId: 'player1', x: 10, y: 10, size: 1 } as City,
        'city2': { id: 'city2', name: 'City2', playerId: 'player2', x: 12, y: 10, size: 3 } as City
      };

      // First city claims
      let updatedTiles = borderService.claimBorders(source1, initialTiles, cities, 1, -1);
      
      // Second (larger) city claims - should override due to higher strength
      updatedTiles = borderService.claimBorders(source2, updatedTiles, cities, 3, -1);

      // Larger city should win the contested tile
      expect(updatedTiles['11,10'].owner).toBe('player2');
      expect(updatedTiles['11,10'].claimer).toBe('city2');
    });
  });

  describe('Integration with Freeciv Reference Values', () => {
    it('should match reference implementation defaults', () => {
      // Test against known freeciv default values
      // Reference: freeciv/server/settings.c default border settings
      
      const source: BorderSource = {
        id: 'city1',
        playerId: 'player1',
        x: 25,
        y: 25,
        type: 'city'
      };

      // Size 1 city with default settings
      const radius = borderService.calculateBorderSourceRadiusSquared(source, 1);
      const strength = borderService.calculateBorderSourceStrength(source, 1);

      // These values should match freeciv's calculations
      expect(radius).toBe(18); // base 17 + size effect 1
      expect(strength).toBe(3); // (1 + 2) * 100 / 100
    });
  });
});