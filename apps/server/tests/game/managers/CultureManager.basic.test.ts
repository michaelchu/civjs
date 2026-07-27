/**
 * CultureManager Basic Unit Tests
 *
 * Focused tests for core culture calculations without complex mocking.
 * These tests verify the mathematical formulas match Freeciv exactly.
 */

import { CultureManager, type CityWithBuildings } from '@game/managers/CultureManager';
import { EffectType } from '@game/managers/EffectsManager';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';
import type { Game } from '@database/schema';

// Mock the logger
jest.mock('@utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('CultureManager - Core Calculations', () => {
  let cultureManager: CultureManager;
  let mockDatabase: any;

  const mockGame = {
    id: 'test-game',
    historyInterestPml: 5, // 0.5% per turn interest
  } as Game;

  beforeEach(() => {
    mockDatabase = createMockDatabaseProvider();
    cultureManager = new CultureManager(mockDatabase, 'classic');
  });

  describe('calculateCityCulture', () => {
    it('should calculate basic city culture (Freeciv formula verification)', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 100,
        buildings: [],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      // Mock EffectsManager to return predictable values
      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.HISTORY:
              return { value: 1, effects: [] }; // Base 1 culture per turn
            case EffectType.PERFORMANCE:
              return { value: 0, effects: [] }; // No immediate culture boost
            case EffectType.CULTURE_PCT:
              return { value: 0, effects: [] }; // No percentage bonus
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const result = cultureManager.calculateCityCulture(city);

      // Verify Freeciv formula: history + performance * (100 + culture_pct) / 100
      // = 100 + 0 * (100 + 0) / 100 = 100
      expect(result.culture).toBe(100);
      expect(result.breakdown.baseHistory).toBe(100);
      expect(result.breakdown.performance).toBe(0);
      expect(result.breakdown.culturePct).toBe(0);
    });

    it('should apply performance bonus correctly', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 50,
        buildings: ['temple'],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.PERFORMANCE:
              return { value: 3, effects: [] }; // Temple provides +3 performance
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const result = cultureManager.calculateCityCulture(city);

      // Formula: 50 + 3 * (100 + 0) / 100 = 50 + 3 = 53
      expect(result.culture).toBe(53);
      expect(result.breakdown.performance).toBe(3);
    });

    it('should apply culture percentage bonus correctly', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 100,
        buildings: ['temple', 'library'],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.PERFORMANCE:
              return { value: 3, effects: [] }; // +3 performance from ruleset effects
            case EffectType.CULTURE_PCT:
              return { value: 50, effects: [] }; // +50% culture bonus
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const result = cultureManager.calculateCityCulture(city);

      // C integer arithmetic truncates the adjusted term independently:
      // 100 + trunc(3 * (100 + 50) / 100) = 100 + 4 = 104
      expect(result.culture).toBe(104);
      expect(result.breakdown.performance).toBe(3);
      expect(result.breakdown.culturePct).toBe(50);
    });
  });

  describe('calculateCityHistoryGain', () => {
    it('should calculate basic history gain with compound interest', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 200, // Starting history for compound interest
        buildings: [],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.HISTORY:
              return { value: 2, effects: [] }; // +2 history per turn
            case EffectType.CULTURE_PCT:
              return { value: 0, effects: [] }; // No percentage bonus
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const historyGain = cultureManager.calculateCityHistoryGain(city, mockGame);

      // Formula: history_effect * (100 + culture_pct) / 100 + existing_history * interest_pml / 1000
      // = 2 * (100 + 0) / 100 + 200 * 5 / 1000
      // = 2 + 1 = 3
      expect(historyGain).toBe(3);
    });

    it('should apply culture percentage to history generation', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 100,
        buildings: ['temple'],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.HISTORY:
              return { value: 3, effects: [] }; // +3 base history
            case EffectType.CULTURE_PCT:
              return { value: 100, effects: [] }; // +100% culture bonus
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const historyGain = cultureManager.calculateCityHistoryGain(city, mockGame);

      // Formula: 3 * (100 + 100) / 100 + 100 * 5 / 1000
      // = trunc(3 * 2) + trunc(0.5) = 6
      expect(historyGain).toBe(6);
    });

    it('should handle zero history correctly', () => {
      const newCity: CityWithBuildings = {
        id: 'new-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'New City',
        x: 5,
        y: 5,
        population: 1,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 0, // New city with no history
        buildings: [],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 10,
        capturedTurn: null,
        createdAt: new Date(),
      };

      const mockEffectsManager = {
        calculateEffect: jest.fn().mockImplementation(effectType => {
          switch (effectType) {
            case EffectType.HISTORY:
              return { value: 1, effects: [] }; // Base 1 history
            default:
              return { value: 0, effects: [] };
          }
        }),
      };
      (cultureManager as any).effectsManager = mockEffectsManager;

      const historyGain = cultureManager.calculateCityHistoryGain(newCity, mockGame);

      // Formula: 1 * (100 + 0) / 100 + 0 * 5 / 1000 = 1 + 0 = 1
      expect(historyGain).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing EffectsManager gracefully', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: 50,
        buildings: [],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      // Don't inject a mock EffectsManager - let it use the real one
      const result = cultureManager.calculateCityCulture(city);

      // Should not throw and should return reasonable values
      expect(typeof result.culture).toBe('number');
      expect(result.culture).toBeGreaterThanOrEqual(50); // At least the base history
    });

    it('should handle invalid history values', () => {
      const city: CityWithBuildings = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 10,
        y: 10,
        population: 3,
        food: 0,
        foodPerTurn: 2,
        production: 0,
        productionPerTurn: 1,
        tradePerTurn: 0,
        goldPerTurn: 0,
        luxuryPerTurn: 0,
        sciencePerTurn: 0,
        pollution: 0,
        tradeRoutes: [],
        governor: null,
        faithPerTurn: 0,
        history: -10, // Invalid negative history
        buildings: [],
        currentProduction: 'warrior',
        productionQueue: [],
        workedTiles: [],
        specialists: {},
        happiness: 0,
        health: 100,
        isCapital: false,
        isPuppet: false,
        isOccupied: false,
        defenseStrength: 1,
        wallsLevel: 0,
        foundedTurn: 1,
        capturedTurn: null,
        createdAt: new Date(),
      };

      expect(() => {
        cultureManager.calculateCityCulture(city);
      }).not.toThrow();

      expect(() => {
        cultureManager.calculateCityHistoryGain(city, mockGame);
      }).not.toThrow();
    });
  });

  describe('processCultureGain', () => {
    it('persists gains and keeps live city/player history synchronized', async () => {
      const db = mockDatabase.getDatabase();
      const game = { id: 'test-game', historyInterestPml: 0 };
      const player = {
        id: 'test-player',
        gameId: 'test-game',
        history: 10,
        technologies: [],
      };
      const city = {
        id: 'test-city',
        gameId: 'test-game',
        playerId: 'test-player',
        name: 'Test City',
        x: 1,
        y: 2,
        history: 20,
        buildings: [],
      };
      db.select
        .mockImplementationOnce(() => ({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([game]) }) }),
        }))
        .mockImplementationOnce(() => ({
          from: () => ({ where: () => Promise.resolve([player]) }),
        }))
        .mockImplementationOnce(() => ({
          from: () => ({ where: () => Promise.resolve([city]) }),
        }));
      db.update.mockImplementation(() => ({
        set: () => ({ where: () => Promise.resolve() }),
      }));

      jest.spyOn(cultureManager, 'calculateCityHistoryGain').mockReturnValue(3);
      jest.spyOn(cultureManager, 'calculateNationHistoryGain').mockReturnValue(2);
      jest.spyOn(cultureManager, 'calculateCityCulture').mockReturnValue({
        culture: 23,
        historyGain: 0,
        breakdown: { baseHistory: 23, performance: 0, culturePct: 0, interestGain: 0 },
      });
      jest.spyOn(cultureManager, 'calculatePlayerCulture').mockResolvedValue({
        totalCulture: 35,
        nationalHistory: 12,
        nationalHistoryGain: 0,
        cityCulture: 23,
        breakdown: {
          nationalPerformance: 0,
          nationalHistory: 12,
          nationalCulturePct: 0,
          totalCityCulture: 23,
        },
      });

      const liveCity = { history: 20 };
      const livePlayer = { history: 10 };
      cultureManager.setRuntimeState({
        getCity: () => liveCity,
        getPlayer: () => livePlayer,
      });

      await expect(cultureManager.processCultureGain('test-game')).resolves.toEqual({
        cities: { 'test-city': { history: 23, culture: 23 } },
        players: { 'test-player': { history: 12, totalCulture: 35 } },
      });
      expect(liveCity.history).toBe(23);
      expect(livePlayer.history).toBe(12);
      expect(db.update).toHaveBeenCalledTimes(2);
    });
  });
});
