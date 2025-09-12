/**
 * CitizenTileType Unit Tests
 * Tests the tile type binning and dominance analysis system
 */

import {
  CitizenTileTypeFactory,
  CitizenTileTypeUtils,
  type CitizenTileType,
} from '@game/systems/CitizenManagement/CitizenTileType';
import { SpecialistType } from '@game/managers/CityManager';
import { OutputType } from '@game/constants/GameConstants';

describe('CitizenTileType', () => {
  describe('CitizenTileTypeFactory', () => {
    it('should create tile type from tile output', () => {
      const production = {
        [OutputType.FOOD]: 3,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 2,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 0,
      };
      const tileIndices = [5, 12, 18];

      const tileType = CitizenTileTypeFactory.createFromTileOutput(
        'test-tile',
        production,
        tileIndices
      );

      expect(tileType.id).toBe('test-tile');
      expect(tileType.production).toEqual(production);
      expect(tileType.is_specialist).toBe(false);
      expect(tileType.specialist_type).toBeUndefined();
      expect(tileType.tile_indices).toEqual(tileIndices);
      expect(tileType.available_count).toBe(3);
      expect(tileType.estimated_fitness).toBe(0); // Should be calculated later
      expect(tileType.lattice_index).toBe(-1);
      expect(tileType.lattice_depth).toBe(0);
      expect(tileType.better_types).toEqual([]);
      expect(tileType.worse_types).toEqual([]);
    });

    it('should create deep copy of production and indices', () => {
      const production = {
        [OutputType.FOOD]: 2,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 1,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 0,
      };
      const tileIndices = [1, 2, 3];

      const tileType = CitizenTileTypeFactory.createFromTileOutput('test', production, tileIndices);

      // Modify original arrays - should not affect tile type
      production[OutputType.FOOD] = 999;
      tileIndices.push(999);

      expect(tileType.production[OutputType.FOOD]).toBe(2);
      expect(tileType.tile_indices).toEqual([1, 2, 3]);
    });

    it('should create specialist tile type', () => {
      const production = {
        [OutputType.FOOD]: 0,
        [OutputType.SHIELD]: 0,
        [OutputType.TRADE]: 0,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
        [OutputType.SCIENCE]: 3,
      };

      const tileType = CitizenTileTypeFactory.createFromSpecialist(
        SpecialistType.SCIENTIST,
        production,
        5
      );

      expect(tileType.id).toBe('specialist_0'); // SpecialistType.SCIENTIST = 0
      expect(tileType.production).toEqual(production);
      expect(tileType.is_specialist).toBe(true);
      expect(tileType.specialist_type).toBe(SpecialistType.SCIENTIST);
      expect(tileType.tile_indices).toEqual([]);
      expect(tileType.available_count).toBe(5);
    });

    it('should create idle citizen type', () => {
      const tileType = CitizenTileTypeFactory.createIdle();

      expect(tileType.id).toBe('idle');
      expect(tileType.is_specialist).toBe(true);
      expect(tileType.specialist_type).toBe(SpecialistType.WORKER);
      expect(tileType.available_count).toBe(Number.MAX_SAFE_INTEGER);

      // Should have zero production
      Object.values(OutputType).forEach(outputType => {
        expect(tileType.production[outputType]).toBe(0);
      });
    });
  });

  describe('CitizenTileTypeUtils', () => {
    const createSampleTileType = (
      id: string,
      food: number,
      shield: number,
      trade: number
    ): CitizenTileType => {
      return CitizenTileTypeFactory.createFromTileOutput(
        id,
        {
          [OutputType.FOOD]: food,
          [OutputType.SHIELD]: shield,
          [OutputType.TRADE]: trade,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        },
        []
      );
    };

    describe('Fitness Calculation', () => {
      it('should calculate fitness using weighted factors', () => {
        const tileType = createSampleTileType('test', 2, 1, 3);
        const factors = {
          [OutputType.FOOD]: 2,
          [OutputType.SHIELD]: 3,
          [OutputType.TRADE]: 1,
          [OutputType.GOLD]: 1,
          [OutputType.LUXURY]: 1,
          [OutputType.SCIENCE]: 1,
        };

        const fitness = CitizenTileTypeUtils.calculateFitness(tileType, factors);

        // (2 * 2) + (1 * 3) + (3 * 1) = 4 + 3 + 3 = 10
        expect(fitness).toBe(10);
      });

      it('should update fitness in place', () => {
        const tileType = createSampleTileType('test', 1, 2, 1);
        const factors = {
          [OutputType.FOOD]: 1,
          [OutputType.SHIELD]: 1,
          [OutputType.TRADE]: 1,
          [OutputType.GOLD]: 1,
          [OutputType.LUXURY]: 1,
          [OutputType.SCIENCE]: 1,
        };

        expect(tileType.estimated_fitness).toBe(0);

        CitizenTileTypeUtils.updateFitness(tileType, factors);

        expect(tileType.estimated_fitness).toBe(4); // 1 + 2 + 1 = 4
      });

      it('should handle zero factors', () => {
        const tileType = createSampleTileType('test', 5, 5, 5);
        const factors = {
          [OutputType.FOOD]: 0,
          [OutputType.SHIELD]: 0,
          [OutputType.TRADE]: 0,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        };

        const fitness = CitizenTileTypeUtils.calculateFitness(tileType, factors);
        expect(fitness).toBe(0);
      });
    });

    describe('Dominance Analysis', () => {
      it('should detect when one tile type dominates another', () => {
        const better = createSampleTileType('better', 3, 2, 2); // Better in all outputs
        const worse = createSampleTileType('worse', 2, 1, 1);

        const dominates = CitizenTileTypeUtils.dominates(better, worse);
        expect(dominates).toBe(true);

        const reverseDominates = CitizenTileTypeUtils.dominates(worse, better);
        expect(reverseDominates).toBe(false);
      });

      it('should not detect dominance when tiles are equal', () => {
        const tile1 = createSampleTileType('tile1', 2, 1, 2);
        const tile2 = createSampleTileType('tile2', 2, 1, 2);

        const dominates = CitizenTileTypeUtils.dominates(tile1, tile2);
        expect(dominates).toBe(false);
      });

      it('should not detect dominance when trades are mixed', () => {
        const tile1 = createSampleTileType('tile1', 3, 1, 1); // Better food, worse shield
        const tile2 = createSampleTileType('tile2', 2, 2, 1); // Worse food, better shield

        const dominates1 = CitizenTileTypeUtils.dominates(tile1, tile2);
        const dominates2 = CitizenTileTypeUtils.dominates(tile2, tile1);

        expect(dominates1).toBe(false);
        expect(dominates2).toBe(false);
      });

      it('should require strict improvement in at least one output', () => {
        const tile1 = createSampleTileType('tile1', 2, 2, 2);
        const tile2 = createSampleTileType('tile2', 2, 2, 1); // Equal except trade

        const dominates = CitizenTileTypeUtils.dominates(tile1, tile2);
        expect(dominates).toBe(true);
      });
    });

    describe('Dominance Relationships Building', () => {
      it('should build correct dominance relationships', () => {
        const excellent = createSampleTileType('excellent', 3, 3, 3);
        const good = createSampleTileType('good', 2, 2, 2);
        const poor = createSampleTileType('poor', 1, 1, 1);
        const different = createSampleTileType('different', 2, 3, 0); // Mixed outputs, doesn't dominate others

        const tileTypes = [excellent, good, poor, different];
        CitizenTileTypeUtils.buildDominanceRelationships(tileTypes);

        // Excellent should dominate good and poor
        expect(excellent.worse_types).toContain(good);
        expect(excellent.worse_types).toContain(poor);
        expect(excellent.better_types).toHaveLength(0);

        // Good should dominate poor but be dominated by excellent
        expect(good.worse_types).toContain(poor);
        expect(good.better_types).toContain(excellent);

        // Poor should be dominated by excellent and good
        expect(poor.worse_types).toHaveLength(0);
        expect(poor.better_types).toContain(excellent);
        expect(poor.better_types).toContain(good);

        // Different should be dominated by excellent but not dominate others
        expect(different.better_types).toContain(excellent);
        expect(different.worse_types).toHaveLength(0);
      });

      it('should clear existing relationships', () => {
        const tile1 = createSampleTileType('tile1', 2, 2, 2);
        const tile2 = createSampleTileType('tile2', 1, 1, 1);

        // Manually set some relationships
        tile1.worse_types = [tile2];
        tile2.better_types = [tile1];

        // Build relationships again
        CitizenTileTypeUtils.buildDominanceRelationships([tile1, tile2]);

        // Should still have the same relationships (not duplicated)
        expect(tile1.worse_types).toHaveLength(1);
        expect(tile2.better_types).toHaveLength(1);
      });
    });

    describe('Sorting and Utility Functions', () => {
      it('should sort tile types by fitness', () => {
        const tiles = [
          createSampleTileType('low', 1, 0, 0),
          createSampleTileType('high', 3, 2, 1),
          createSampleTileType('medium', 2, 1, 0),
        ];

        // Set fitness values
        tiles[0].estimated_fitness = 5;
        tiles[1].estimated_fitness = 15;
        tiles[2].estimated_fitness = 10;

        const sorted = CitizenTileTypeUtils.sortByFitness(tiles);

        expect(sorted[0].id).toBe('high');
        expect(sorted[1].id).toBe('medium');
        expect(sorted[2].id).toBe('low');

        // Original array should be unchanged
        expect(tiles[0].id).toBe('low');
      });

      it('should generate consistent production keys', () => {
        const production1 = {
          [OutputType.FOOD]: 2,
          [OutputType.SHIELD]: 1,
          [OutputType.TRADE]: 0,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        };

        const production2 = {
          [OutputType.FOOD]: 2,
          [OutputType.SHIELD]: 1,
          [OutputType.TRADE]: 0,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        };

        const key1 = CitizenTileTypeUtils.getProductionKey(production1);
        const key2 = CitizenTileTypeUtils.getProductionKey(production2);

        expect(key1).toBe(key2);
        expect(typeof key1).toBe('string');
        expect(key1.length).toBeGreaterThan(0);
      });
    });

    describe('Tile Grouping', () => {
      it('should group tiles with identical production', () => {
        const tiles = [
          {
            index: 0,
            production: {
              [OutputType.FOOD]: 2,
              [OutputType.SHIELD]: 1,
              [OutputType.TRADE]: 0,
              [OutputType.GOLD]: 0,
              [OutputType.LUXURY]: 0,
              [OutputType.SCIENCE]: 0,
            },
          },
          {
            index: 1,
            production: {
              [OutputType.FOOD]: 2,
              [OutputType.SHIELD]: 1,
              [OutputType.TRADE]: 0,
              [OutputType.GOLD]: 0,
              [OutputType.LUXURY]: 0,
              [OutputType.SCIENCE]: 0,
            },
          },
          {
            index: 2,
            production: {
              [OutputType.FOOD]: 3,
              [OutputType.SHIELD]: 0,
              [OutputType.TRADE]: 1,
              [OutputType.GOLD]: 0,
              [OutputType.LUXURY]: 0,
              [OutputType.SCIENCE]: 0,
            },
          },
          {
            index: 3,
            production: {
              [OutputType.FOOD]: 2,
              [OutputType.SHIELD]: 1,
              [OutputType.TRADE]: 0,
              [OutputType.GOLD]: 0,
              [OutputType.LUXURY]: 0,
              [OutputType.SCIENCE]: 0,
            },
          },
        ];

        const tileTypes = CitizenTileTypeUtils.groupTilesByProduction(tiles);

        expect(tileTypes).toHaveLength(2); // Two unique production patterns

        // Find the groups
        const group1 = tileTypes.find(t => t.tile_indices.includes(0));
        const group2 = tileTypes.find(t => t.tile_indices.includes(2));

        expect(group1).toBeDefined();
        expect(group2).toBeDefined();
        expect(group1!.tile_indices).toEqual([0, 1, 3]); // Tiles with same production
        expect(group2!.tile_indices).toEqual([2]); // Unique tile
        expect(group1!.available_count).toBe(3);
        expect(group2!.available_count).toBe(1);
      });

      it('should handle empty tile array', () => {
        const tileTypes = CitizenTileTypeUtils.groupTilesByProduction([]);
        expect(tileTypes).toEqual([]);
      });

      it('should handle single tile', () => {
        const tiles = [
          {
            index: 5,
            production: {
              [OutputType.FOOD]: 1,
              [OutputType.SHIELD]: 2,
              [OutputType.TRADE]: 1,
              [OutputType.GOLD]: 0,
              [OutputType.LUXURY]: 0,
              [OutputType.SCIENCE]: 0,
            },
          },
        ];

        const tileTypes = CitizenTileTypeUtils.groupTilesByProduction(tiles);

        expect(tileTypes).toHaveLength(1);
        expect(tileTypes[0].tile_indices).toEqual([5]);
        expect(tileTypes[0].available_count).toBe(1);
      });
    });

    describe('Description Generation', () => {
      it('should describe regular tile types', () => {
        const tileType = CitizenTileTypeFactory.createFromTileOutput(
          'test',
          {
            [OutputType.FOOD]: 2,
            [OutputType.SHIELD]: 1,
            [OutputType.TRADE]: 0,
            [OutputType.GOLD]: 0,
            [OutputType.LUXURY]: 0,
            [OutputType.SCIENCE]: 0,
          },
          [1, 2, 3]
        );
        tileType.estimated_fitness = 7.5;

        const description = CitizenTileTypeUtils.describe(tileType);

        expect(description).toContain('Tile (3 available)');
        expect(description).toContain('2 food');
        expect(description).toContain('1 shield');
        expect(description).not.toContain('trade'); // Zero values should be omitted
        expect(description).toContain('fitness: 7.5');
      });

      it('should describe specialist types', () => {
        const tileType = CitizenTileTypeFactory.createFromSpecialist(
          SpecialistType.SCIENTIST,
          {
            [OutputType.FOOD]: 0,
            [OutputType.SHIELD]: 0,
            [OutputType.TRADE]: 0,
            [OutputType.GOLD]: 0,
            [OutputType.LUXURY]: 0,
            [OutputType.SCIENCE]: 3,
          },
          2
        );
        tileType.estimated_fitness = 12.0;

        const description = CitizenTileTypeUtils.describe(tileType);

        expect(description).toContain('0 specialist'); // SpecialistType.SCIENTIST = 0
        expect(description).toContain('3 science');
        expect(description).toContain('fitness: 12.0');
      });

      it('should describe tile with no output', () => {
        const tileType = CitizenTileTypeFactory.createFromTileOutput(
          'empty',
          {
            [OutputType.FOOD]: 0,
            [OutputType.SHIELD]: 0,
            [OutputType.TRADE]: 0,
            [OutputType.GOLD]: 0,
            [OutputType.LUXURY]: 0,
            [OutputType.SCIENCE]: 0,
          },
          [1]
        );
        tileType.estimated_fitness = 0;

        const description = CitizenTileTypeUtils.describe(tileType);

        expect(description).toContain('no output');
        expect(description).toContain('fitness: 0.0');
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle tile types with all zero production', () => {
      const tileType = CitizenTileTypeFactory.createFromTileOutput(
        'zero',
        {
          [OutputType.FOOD]: 0,
          [OutputType.SHIELD]: 0,
          [OutputType.TRADE]: 0,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        },
        []
      );

      expect(tileType.available_count).toBe(0);

      const factors = {
        [OutputType.FOOD]: 1,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 1,
        [OutputType.GOLD]: 1,
        [OutputType.LUXURY]: 1,
        [OutputType.SCIENCE]: 1,
      };

      const fitness = CitizenTileTypeUtils.calculateFitness(tileType, factors);
      expect(fitness).toBe(0);
    });

    it('should handle very large production values', () => {
      const tileType = CitizenTileTypeFactory.createFromTileOutput(
        'mega',
        {
          [OutputType.FOOD]: 1000000,
          [OutputType.SHIELD]: 999999,
          [OutputType.TRADE]: 888888,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        },
        new Array(100).fill(0).map((_, i) => i)
      );

      expect(tileType.available_count).toBe(100);
      expect(tileType.production[OutputType.FOOD]).toBe(1000000);
    });

    it('should handle empty better/worse type arrays', () => {
      const tileType = CitizenTileTypeFactory.createFromTileOutput(
        'solo',
        {
          [OutputType.FOOD]: 2,
          [OutputType.SHIELD]: 1,
          [OutputType.TRADE]: 1,
          [OutputType.GOLD]: 0,
          [OutputType.LUXURY]: 0,
          [OutputType.SCIENCE]: 0,
        },
        [1]
      );

      CitizenTileTypeUtils.buildDominanceRelationships([tileType]);

      expect(tileType.better_types).toEqual([]);
      expect(tileType.worse_types).toEqual([]);
    });
  });

  describe('Performance', () => {
    it('should handle large numbers of tile types efficiently', () => {
      const tileTypes: CitizenTileType[] = [];

      // Create 1000 tile types
      for (let i = 0; i < 1000; i++) {
        const tileType = CitizenTileTypeFactory.createFromTileOutput(
          `tile_${i}`,
          {
            [OutputType.FOOD]: Math.floor(Math.random() * 5),
            [OutputType.SHIELD]: Math.floor(Math.random() * 5),
            [OutputType.TRADE]: Math.floor(Math.random() * 5),
            [OutputType.GOLD]: 0,
            [OutputType.LUXURY]: 0,
            [OutputType.SCIENCE]: 0,
          },
          [i]
        );
        tileType.estimated_fitness = Math.random() * 15;
        tileTypes.push(tileType);
      }

      const startTime = Date.now();
      const sorted = CitizenTileTypeUtils.sortByFitness(tileTypes);
      const endTime = Date.now();

      expect(sorted).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(100); // Should be fast

      // Check that sorting worked
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i - 1].estimated_fitness).toBeGreaterThanOrEqual(sorted[i].estimated_fitness);
      }
    });
  });
});
