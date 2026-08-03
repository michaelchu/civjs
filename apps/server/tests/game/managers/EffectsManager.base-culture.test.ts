/**
 * EffectsManager Base Culture Tests
 *
 * Simple focused tests for culture-related base effects.
 * Verifies that culture is entirely ruleset-driven, as in Freeciv.
 */

import { EffectsManager, EffectType, type EffectContext } from '@game/managers/EffectsManager';

// Mock the rulesetLoader
jest.mock('@shared/data/rulesets/RulesetLoader', () => ({
  rulesetLoader: {
    getEffects: jest.fn().mockReturnValue({}),
  },
}));

// Mock the logger
jest.mock('@utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('EffectsManager - Base Culture Effects', () => {
  let effectsManager: EffectsManager;

  const mockContext: EffectContext = {
    cityId: 'test-city',
    playerId: 'test-player',
    tileX: 10,
    tileY: 10,
    cityBuildings: new Set(['temple']),
    playerTechs: new Set(['writing']),
  };

  beforeEach(() => {
    effectsManager = new EffectsManager('civ2civ3');
  });

  describe('Base Culture Effect Values', () => {
    it('should not invent a base value for EFT_HISTORY', () => {
      const result = effectsManager.calculateEffect(EffectType.HISTORY, mockContext);

      expect(result.value).toBe(0);
      expect(typeof result.effects).toBe('object');
      expect(Array.isArray(result.effects)).toBe(true);
    });

    it('should return base value of 0 for EFT_PERFORMANCE (no base performance bonus)', () => {
      const result = effectsManager.calculateEffect(EffectType.PERFORMANCE, mockContext);

      expect(result.value).toBe(0);
      expect(Array.isArray(result.effects)).toBe(true);
    });

    it('should return base value of 0 for EFT_CULTURE_PCT (no base percentage bonus)', () => {
      const result = effectsManager.calculateEffect(EffectType.CULTURE_PCT, mockContext);

      expect(result.value).toBe(0);
      expect(Array.isArray(result.effects)).toBe(true);
    });

    it('should return base value of 0 for non-culture effects', () => {
      const result = effectsManager.calculateEffect(EffectType.MAKE_HAPPY, mockContext);

      expect(result.value).toBe(0);
      expect(Array.isArray(result.effects)).toBe(true);
    });
  });

  describe('Context Independence for Base Effects', () => {
    it('should return zero HISTORY when the ruleset defines no matching effect', () => {
      const emptyContext: EffectContext = {
        cityBuildings: new Set(),
        playerTechs: new Set(),
      };

      const result = effectsManager.calculateEffect(EffectType.HISTORY, emptyContext);

      expect(result.value).toBe(0);
    });

    it('should return base HISTORY value with no context at all', () => {
      const minimalContext: EffectContext = {};

      const result = effectsManager.calculateEffect(EffectType.HISTORY, minimalContext);

      expect(result.value).toBe(0);
    });

    it('should handle undefined/null context gracefully', () => {
      expect(() => {
        effectsManager.calculateEffect(EffectType.HISTORY, {} as EffectContext);
      }).not.toThrow();

      const result = effectsManager.calculateEffect(EffectType.HISTORY, {} as EffectContext);
      expect(result.value).toBe(0);
    });
  });

  describe('Effect Result Structure', () => {
    it('should return properly structured EffectResult', () => {
      const result = effectsManager.calculateEffect(EffectType.HISTORY, mockContext);

      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('effects');
      expect(typeof result.value).toBe('number');
      expect(Array.isArray(result.effects)).toBe(true);

      // Verify effects array structure (if any effects exist)
      result.effects.forEach(effect => {
        expect(effect).toHaveProperty('effectId');
        expect(effect).toHaveProperty('type');
        expect(effect).toHaveProperty('value');
        expect(effect).toHaveProperty('source');
        expect(typeof effect.effectId).toBe('string');
        expect(typeof effect.value).toBe('number');
        expect(typeof effect.source).toBe('string');
      });
    });

    it('should return finite numeric values', () => {
      const historyResult = effectsManager.calculateEffect(EffectType.HISTORY, mockContext);
      const performanceResult = effectsManager.calculateEffect(EffectType.PERFORMANCE, mockContext);
      const culturePctResult = effectsManager.calculateEffect(EffectType.CULTURE_PCT, mockContext);

      expect(Number.isFinite(historyResult.value)).toBe(true);
      expect(Number.isFinite(performanceResult.value)).toBe(true);
      expect(Number.isFinite(culturePctResult.value)).toBe(true);

      expect(historyResult.value).toBeGreaterThanOrEqual(0);
      expect(performanceResult.value).toBeGreaterThanOrEqual(0);
      expect(culturePctResult.value).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Multiplier Support', () => {
    it('should handle multipliers for culture effects', () => {
      const baseResult = effectsManager.calculateEffect(EffectType.HISTORY, mockContext);
      const multipliedResult = effectsManager.calculateEffect(EffectType.HISTORY, mockContext, 150);

      expect(typeof baseResult.value).toBe('number');
      expect(typeof multipliedResult.value).toBe('number');
      expect(Number.isFinite(baseResult.value)).toBe(true);
      expect(Number.isFinite(multipliedResult.value)).toBe(true);
    });

    it('should handle zero multiplier gracefully', () => {
      const result = effectsManager.calculateEffect(EffectType.HISTORY, mockContext, 0);

      expect(Number.isFinite(result.value)).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(0);
    });

    it('should handle negative multiplier gracefully', () => {
      const result = effectsManager.calculateEffect(EffectType.HISTORY, mockContext, -50);

      expect(Number.isFinite(result.value)).toBe(true);
      expect(result.value).toBeGreaterThanOrEqual(0);
    });
  });
});
