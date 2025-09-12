/**
 * CitizenParameter Unit Tests
 * Tests the parameter configuration system for citizen management
 */

import {
  CitizenParameterFactory,
  CitizenParameterUtils,
} from '@game/systems/CitizenManagement/CitizenParameter';
import { OutputType } from '@game/constants/GameConstants';

describe('CitizenParameter', () => {
  describe('CitizenParameterFactory', () => {
    it('should create default parameters with equal weighting', () => {
      const params = CitizenParameterFactory.createDefault();

      expect(params).toBeDefined();
      expect(params.max_growth).toBe(false);
      expect(params.require_happy).toBe(false);
      expect(params.allow_disorder).toBe(false);
      expect(params.allow_specialists).toBe(true);
      expect(params.happy_factor).toBe(1);

      // Check that all output types have equal factors
      Object.values(OutputType).forEach(outputType => {
        expect(params.factor[outputType]).toBe(1);
        expect(params.minimal_surplus[outputType]).toBe(0);
      });
    });

    it('should create emergency parameters that always work', () => {
      const params = CitizenParameterFactory.createEmergency();

      expect(params).toBeDefined();
      expect(params.allow_disorder).toBe(true);
      expect(params.allow_specialists).toBe(true);
      expect(params.require_happy).toBe(false);

      // Emergency parameters should allow negative surpluses
      Object.values(OutputType).forEach(outputType => {
        expect(params.minimal_surplus[outputType]).toBe(-Infinity);
        expect(params.factor[outputType]).toBe(1);
      });
    });

    it('should create growth-focused parameters', () => {
      const params = CitizenParameterFactory.createGrowthFocused();

      expect(params).toBeDefined();
      expect(params.max_growth).toBe(true);
      expect(params.factor[OutputType.FOOD]).toBe(3);
      expect(params.factor[OutputType.SHIELD]).toBe(1);
      expect(params.factor[OutputType.TRADE]).toBe(1);

      // Other defaults should be maintained
      expect(params.allow_specialists).toBe(true);
      expect(params.require_happy).toBe(false);
      expect(params.allow_disorder).toBe(false);
    });

    it('should create production-focused parameters', () => {
      const params = CitizenParameterFactory.createProductionFocused();

      expect(params).toBeDefined();
      expect(params.factor[OutputType.FOOD]).toBe(1);
      expect(params.factor[OutputType.SHIELD]).toBe(3);
      expect(params.factor[OutputType.TRADE]).toBe(1);

      // Other defaults should be maintained
      expect(params.max_growth).toBe(false);
      expect(params.allow_specialists).toBe(true);
    });

    it('should create trade-focused parameters', () => {
      const params = CitizenParameterFactory.createTradeFocused();

      expect(params).toBeDefined();
      expect(params.factor[OutputType.FOOD]).toBe(1);
      expect(params.factor[OutputType.SHIELD]).toBe(1);
      expect(params.factor[OutputType.TRADE]).toBe(2);
      expect(params.factor[OutputType.GOLD]).toBe(2);
      expect(params.factor[OutputType.SCIENCE]).toBe(2);

      // Luxury should have normal weight
      expect(params.factor[OutputType.LUXURY]).toBe(1);
    });
  });

  describe('CitizenParameterUtils', () => {
    it('should correctly identify equal parameters', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createDefault();

      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(true);
    });

    it('should correctly identify different parameters', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createGrowthFocused();

      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
    });

    it('should detect differences in minimal_surplus', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createDefault();
      params2.minimal_surplus[OutputType.FOOD] = 5;

      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
    });

    it('should detect differences in factors', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createDefault();
      params2.factor[OutputType.SHIELD] = 2;

      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
    });

    it('should detect differences in boolean flags', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createDefault();

      params2.max_growth = true;
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);

      params2.max_growth = false;
      params2.require_happy = true;
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);

      params2.require_happy = false;
      params2.allow_disorder = true;
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);

      params2.allow_disorder = false;
      params2.allow_specialists = false;
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
    });

    it('should detect differences in happy_factor', () => {
      const params1 = CitizenParameterFactory.createDefault();
      const params2 = CitizenParameterFactory.createDefault();
      params2.happy_factor = 2;

      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
    });

    it('should create deep copies', () => {
      const params1 = CitizenParameterFactory.createGrowthFocused();
      const params2 = CitizenParameterUtils.copy(params1);

      // Should be equal but different objects
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(true);
      expect(params1).not.toBe(params2);
      expect(params1.minimal_surplus).not.toBe(params2.minimal_surplus);
      expect(params1.factor).not.toBe(params2.factor);

      // Modifying copy should not affect original
      params2.factor[OutputType.FOOD] = 5;
      expect(CitizenParameterUtils.areEqual(params1, params2)).toBe(false);
      expect(params1.factor[OutputType.FOOD]).toBe(3); // Original unchanged
    });
  });

  describe('Parameter Validation', () => {
    it('should have all required output types in minimal_surplus', () => {
      const params = CitizenParameterFactory.createDefault();

      Object.values(OutputType).forEach(outputType => {
        expect(params.minimal_surplus).toHaveProperty(outputType);
        expect(typeof params.minimal_surplus[outputType]).toBe('number');
      });
    });

    it('should have all required output types in factor', () => {
      const params = CitizenParameterFactory.createDefault();

      Object.values(OutputType).forEach(outputType => {
        expect(params.factor).toHaveProperty(outputType);
        expect(typeof params.factor[outputType]).toBe('number');
        expect(params.factor[outputType]).toBeGreaterThan(0);
      });
    });

    it('should have valid boolean flags', () => {
      const parameterTypes = [
        CitizenParameterFactory.createDefault(),
        CitizenParameterFactory.createEmergency(),
        CitizenParameterFactory.createGrowthFocused(),
        CitizenParameterFactory.createProductionFocused(),
        CitizenParameterFactory.createTradeFocused(),
      ];

      parameterTypes.forEach(params => {
        expect(typeof params.max_growth).toBe('boolean');
        expect(typeof params.require_happy).toBe('boolean');
        expect(typeof params.allow_disorder).toBe('boolean');
        expect(typeof params.allow_specialists).toBe('boolean');
        expect(typeof params.happy_factor).toBe('number');
        expect(params.happy_factor).toBeGreaterThan(0);
      });
    });
  });

  describe('Custom Parameter Creation', () => {
    it('should allow custom minimal surplus requirements', () => {
      const params = CitizenParameterFactory.createDefault();
      params.minimal_surplus[OutputType.FOOD] = 10;
      params.minimal_surplus[OutputType.SHIELD] = 5;

      expect(params.minimal_surplus[OutputType.FOOD]).toBe(10);
      expect(params.minimal_surplus[OutputType.SHIELD]).toBe(5);
      expect(params.minimal_surplus[OutputType.TRADE]).toBe(0); // Others unchanged
    });

    it('should allow custom optimization factors', () => {
      const params = CitizenParameterFactory.createDefault();
      params.factor[OutputType.SCIENCE] = 10;
      params.factor[OutputType.GOLD] = 0.1;

      expect(params.factor[OutputType.SCIENCE]).toBe(10);
      expect(params.factor[OutputType.GOLD]).toBe(0.1);
      expect(params.factor[OutputType.FOOD]).toBe(1); // Others unchanged
    });

    it('should allow custom happiness settings', () => {
      const params = CitizenParameterFactory.createDefault();
      params.require_happy = true;
      params.allow_disorder = false;
      params.happy_factor = 5;

      expect(params.require_happy).toBe(true);
      expect(params.allow_disorder).toBe(false);
      expect(params.happy_factor).toBe(5);
    });

    it('should allow disabling specialists', () => {
      const params = CitizenParameterFactory.createDefault();
      params.allow_specialists = false;

      expect(params.allow_specialists).toBe(false);
    });
  });

  describe('Parameter Combinations', () => {
    it('should handle conflicting requirements gracefully', () => {
      const params = CitizenParameterFactory.createDefault();
      params.require_happy = true;
      params.allow_disorder = false; // Conflicting with require_happy in some cases
      params.allow_specialists = false; // Makes it harder to achieve happiness

      // Parameters should still be valid even if difficult to satisfy
      expect(params).toBeDefined();
      expect(typeof params.require_happy).toBe('boolean');
      expect(typeof params.allow_disorder).toBe('boolean');
      expect(typeof params.allow_specialists).toBe('boolean');
    });

    it('should handle extreme factor weights', () => {
      const params = CitizenParameterFactory.createDefault();
      params.factor[OutputType.FOOD] = 1000000;
      params.factor[OutputType.SHIELD] = 0.000001;

      expect(params.factor[OutputType.FOOD]).toBe(1000000);
      expect(params.factor[OutputType.SHIELD]).toBe(0.000001);
    });

    it('should handle negative minimal surplus (emergency mode)', () => {
      const params = CitizenParameterFactory.createDefault();
      params.minimal_surplus[OutputType.FOOD] = -10;
      params.minimal_surplus[OutputType.SHIELD] = -5;

      expect(params.minimal_surplus[OutputType.FOOD]).toBe(-10);
      expect(params.minimal_surplus[OutputType.SHIELD]).toBe(-5);
    });
  });
});
