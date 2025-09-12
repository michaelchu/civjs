/**
 * CitizenResult Unit Tests
 * Tests the result structure and utilities for citizen management optimization
 */

import {
  CitizenResultFactory,
  CitizenResultUtils,
} from '@game/systems/CitizenManagement/CitizenResult';
import { SpecialistType } from '@game/managers/CityManager';
import { OutputType } from '@game/constants/GameConstants';

describe('CitizenResult', () => {
  describe('CitizenResultFactory', () => {
    it('should create a valid result with default values', () => {
      const cityRadius = 5;
      const result = CitizenResultFactory.create(cityRadius);

      expect(result).toBeDefined();
      expect(result.found_valid).toBe(false);
      expect(result.aborted).toBe(false);
      expect(result.disorder).toBe(false);
      expect(result.happy).toBe(false);
      expect(result.city_radius_sq).toBe(cityRadius);
      expect(result.workers_count).toBe(0);
      expect(result.specialists_count).toBe(0);
      expect(result.fitness).toBe(0);

      // Check surplus initialization
      Object.values(OutputType).forEach(outputType => {
        expect(result.surplus).toHaveProperty(outputType);
        expect(result.surplus[outputType]).toBe(0);
      });

      // Check specialists initialization
      Object.values(SpecialistType).forEach(specialistType => {
        if (typeof specialistType === 'number') {
          expect(result.specialists).toHaveProperty(specialistType.toString());
          expect(result.specialists[specialistType]).toBe(0);
        }
      });

      // Check worker positions array
      expect(Array.isArray(result.worker_positions)).toBe(true);
      expect(result.worker_positions.length).toBeGreaterThan(0);
      result.worker_positions.forEach(position => {
        expect(typeof position).toBe('boolean');
        expect(position).toBe(false); // Should start as false
      });
    });

    it('should create worker positions array with correct size', () => {
      const testRadii = [1, 5, 10, 25];

      testRadii.forEach(radius => {
        const result = CitizenResultFactory.create(radius);
        const expectedSize = (2 * Math.floor(Math.sqrt(radius)) + 1) ** 2;

        expect(result.worker_positions.length).toBe(expectedSize);
        expect(result.city_radius_sq).toBe(radius);
      });
    });

    it('should create a failed result', () => {
      const cityRadius = 5;
      const result = CitizenResultFactory.createFailed(cityRadius);

      expect(result.found_valid).toBe(false);
      expect(result.aborted).toBe(true);
      expect(result.city_radius_sq).toBe(cityRadius);

      // Failed result should have same structure as normal result
      expect(result.surplus).toBeDefined();
      expect(result.specialists).toBeDefined();
      expect(result.worker_positions).toBeDefined();
    });
  });

  describe('CitizenResultUtils', () => {
    it('should calculate total citizens correctly', () => {
      const result = CitizenResultFactory.create(5);
      result.workers_count = 3;
      result.specialists_count = 2;

      const total = CitizenResultUtils.getTotalCitizens(result);
      expect(total).toBe(5);
    });

    it('should calculate specialists count from breakdown', () => {
      const specialists = {
        [SpecialistType.SCIENTIST]: 2,
        [SpecialistType.TAX_COLLECTOR]: 1,
        [SpecialistType.ENTERTAINER]: 3,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 1,
        [SpecialistType.MERCHANT]: 0,
      };

      const count = CitizenResultUtils.calculateSpecialistsCount(specialists);
      expect(count).toBe(7); // 2 + 1 + 3 + 0 + 1 + 0
    });

    it('should calculate workers count from positions', () => {
      const workerPositions = [true, false, true, true, false, false, true];

      const count = CitizenResultUtils.calculateWorkersCount(workerPositions);
      expect(count).toBe(4); // Four true positions
    });

    it('should update counts based on assignments', () => {
      const result = CitizenResultFactory.create(5);

      // Set up some assignments
      result.worker_positions = [true, true, false, true, false];
      result.specialists[SpecialistType.SCIENTIST] = 2;
      result.specialists[SpecialistType.ENTERTAINER] = 1;

      CitizenResultUtils.updateCounts(result);

      expect(result.workers_count).toBe(3); // Three worked tiles
      expect(result.specialists_count).toBe(3); // 2 scientists + 1 entertainer
    });

    it('should validate consistent results', () => {
      const expectedPopulation = 5;
      const result = CitizenResultFactory.create(5);

      // Set up a valid configuration
      result.workers_count = 3;
      result.specialists_count = 2;
      // Worker positions array needs to match the expected size
      const expectedSize = (2 * Math.floor(Math.sqrt(5)) + 1) ** 2; // = 9
      result.worker_positions = new Array(expectedSize).fill(false);
      result.worker_positions[0] = true;
      result.worker_positions[1] = true;
      result.worker_positions[2] = true;

      const isValid = CitizenResultUtils.validate(result, expectedPopulation);
      expect(isValid).toBe(true);
    });

    it('should detect invalid population count', () => {
      const expectedPopulation = 5;
      const result = CitizenResultFactory.create(5);

      // Set up invalid configuration (wrong total population)
      result.workers_count = 2;
      result.specialists_count = 2; // Total = 4, expected 5

      const isValid = CitizenResultUtils.validate(result, expectedPopulation);
      expect(isValid).toBe(false);
    });

    it('should detect negative specialist counts', () => {
      const expectedPopulation = 5;
      const result = CitizenResultFactory.create(5);

      result.workers_count = 3;
      result.specialists_count = 2;
      result.specialists[SpecialistType.SCIENTIST] = -1; // Invalid negative count

      const isValid = CitizenResultUtils.validate(result, expectedPopulation);
      expect(isValid).toBe(false);
    });

    it('should detect incorrect worker positions array size', () => {
      const expectedPopulation = 5;
      const result = CitizenResultFactory.create(5);

      result.workers_count = 3;
      result.specialists_count = 2;
      result.worker_positions = [true, false]; // Too small array

      const isValid = CitizenResultUtils.validate(result, expectedPopulation);
      expect(isValid).toBe(false);
    });

    it('should create human-readable summary for valid results', () => {
      const result = CitizenResultFactory.create(5);
      result.found_valid = true;
      result.workers_count = 3;
      result.specialists_count = 2;
      result.surplus = {
        [OutputType.FOOD]: 5,
        [OutputType.SHIELD]: 3,
        [OutputType.TRADE]: 2,
        [OutputType.SCIENCE]: 4,
        [OutputType.GOLD]: 1,
        [OutputType.LUXURY]: 0,
      };
      result.disorder = false;
      result.happy = true;
      result.fitness = 15.5;

      const summary = CitizenResultUtils.summarize(result);

      expect(summary).toContain('Workers: 3');
      expect(summary).toContain('Specialists: 2');
      expect(summary).toContain('Happy');
      expect(summary).toContain('Fitness: 15.5');
      expect(summary).toContain('food:5');
      expect(summary).toContain('shield:3');
    });

    it('should create summary for invalid results', () => {
      const result = CitizenResultFactory.create(5);
      result.found_valid = false;

      const summary = CitizenResultUtils.summarize(result);

      expect(summary).toBe('No valid solution found');
    });

    it('should indicate disorder in summary', () => {
      const result = CitizenResultFactory.create(5);
      result.found_valid = true;
      result.workers_count = 5;
      result.specialists_count = 0;
      result.disorder = true;
      result.happy = false;
      result.surplus = {
        [OutputType.FOOD]: 2,
        [OutputType.SHIELD]: 1,
        [OutputType.TRADE]: 1,
        [OutputType.SCIENCE]: 0,
        [OutputType.GOLD]: 0,
        [OutputType.LUXURY]: 0,
      };
      result.fitness = 4;

      const summary = CitizenResultUtils.summarize(result);

      expect(summary).toContain('Disorder');
      expect(summary).not.toContain('Happy');
    });
  });

  describe('Result State Management', () => {
    it('should maintain consistent state when updating worker positions', () => {
      const result = CitizenResultFactory.create(9); // 3x3 grid

      // Set some worked positions
      result.worker_positions[0] = true; // City center
      result.worker_positions[1] = true;
      result.worker_positions[4] = true;

      CitizenResultUtils.updateCounts(result);

      expect(result.workers_count).toBe(3);
      expect(CitizenResultUtils.calculateWorkersCount(result.worker_positions)).toBe(3);
    });

    it('should maintain consistent state when updating specialists', () => {
      const result = CitizenResultFactory.create(5);

      result.specialists[SpecialistType.SCIENTIST] = 2;
      result.specialists[SpecialistType.ENTERTAINER] = 1;
      result.specialists[SpecialistType.TAX_COLLECTOR] = 1;

      CitizenResultUtils.updateCounts(result);

      expect(result.specialists_count).toBe(4);
      expect(CitizenResultUtils.calculateSpecialistsCount(result.specialists)).toBe(4);
    });

    it('should handle zero population case', () => {
      const result = CitizenResultFactory.create(5);
      // Leave everything at 0

      CitizenResultUtils.updateCounts(result);

      expect(result.workers_count).toBe(0);
      expect(result.specialists_count).toBe(0);
      expect(CitizenResultUtils.getTotalCitizens(result)).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very small city radius', () => {
      const result = CitizenResultFactory.create(1);

      const expectedSize = (2 * Math.floor(Math.sqrt(1)) + 1) ** 2; // = (2*1 + 1)^2 = 9
      expect(result.worker_positions.length).toBe(expectedSize);
      expect(result.city_radius_sq).toBe(1);
    });

    it('should handle large city radius', () => {
      const result = CitizenResultFactory.create(100);

      expect(result.worker_positions.length).toBeGreaterThan(100);
      expect(result.city_radius_sq).toBe(100);

      // All positions should be initialized to false
      result.worker_positions.forEach(position => {
        expect(position).toBe(false);
      });
    });

    it('should handle all specialists of one type', () => {
      const specialists = {
        [SpecialistType.SCIENTIST]: 10,
        [SpecialistType.TAX_COLLECTOR]: 0,
        [SpecialistType.ENTERTAINER]: 0,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 0,
        [SpecialistType.MERCHANT]: 0,
      };

      const count = CitizenResultUtils.calculateSpecialistsCount(specialists);
      expect(count).toBe(10);
    });

    it('should handle empty worker positions array', () => {
      const count = CitizenResultUtils.calculateWorkersCount([]);
      expect(count).toBe(0);
    });

    it('should handle all worked positions', () => {
      const positions = new Array(20).fill(true);
      const count = CitizenResultUtils.calculateWorkersCount(positions);
      expect(count).toBe(20);
    });
  });

  describe('Performance', () => {
    it('should handle large arrays efficiently', () => {
      const largeArray = new Array(10000).fill(false);
      // Set every 10th position to true
      for (let i = 0; i < largeArray.length; i += 10) {
        largeArray[i] = true;
      }

      const startTime = Date.now();
      const count = CitizenResultUtils.calculateWorkersCount(largeArray);
      const endTime = Date.now();

      expect(count).toBe(1000); // 10000 / 10 = 1000
      expect(endTime - startTime).toBeLessThan(100); // Should be very fast
    });

    it('should validate large results efficiently', () => {
      const result = CitizenResultFactory.create(1000);
      result.workers_count = 50;
      result.specialists_count = 50;

      const startTime = Date.now();
      const isValid = CitizenResultUtils.validate(result, 100);
      const endTime = Date.now();

      expect(isValid).toBe(true);
      expect(endTime - startTime).toBeLessThan(50); // Should be fast
    });
  });
});
