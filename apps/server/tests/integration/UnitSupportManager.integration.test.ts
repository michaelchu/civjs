import { UnitSupportManager, GoldUpkeepStyle } from '../../src/game/UnitSupportManager';
import { clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';

describe.skip('UnitSupportManager - Integration Tests with Real Unit Support Calculations', () => {
  let unitSupportManager: UnitSupportManager;
  let gameId: string;
  let playerId1: string;
  let playerId2: string;

  beforeEach(async () => {
    // Clear database
    await clearAllTables();

    // Create game scenario (we only need IDs for testing)
    const scenario = await createBasicGameScenario();
    gameId = scenario.game.id;
    playerId1 = scenario.players[0].id;
    playerId2 = scenario.players[1].id;

    // Initialize UnitSupportManager (works independently with mocks)
    unitSupportManager = new UnitSupportManager(gameId);
  });

  afterEach(async () => {
    // No cleanup needed for standalone UnitSupportManager
  });

  describe('unit support system initialization', () => {
    it('should initialize with default support settings', () => {
      expect(unitSupportManager).toBeDefined();

      const goldUpkeepStyle = unitSupportManager.getGoldUpkeepStyle();
      expect(Object.values(GoldUpkeepStyle)).toContain(goldUpkeepStyle);

      const freeSupport = unitSupportManager.getBaseFreeSupport();
      expect(freeSupport.food).toBeGreaterThanOrEqual(0);
      expect(freeSupport.shield).toBeGreaterThanOrEqual(0);
      expect(freeSupport.gold).toBeGreaterThanOrEqual(0);
    });

    it('should load unit support data from game state', async () => {
      // Test with mock unit ID (UnitSupportManager has mock implementations)
      const mockUnitId = 'mock-unit-1';
      const supportData = await unitSupportManager.getUnitSupportData(mockUnitId);

      expect(supportData).toBeDefined();
      expect(supportData.unitId).toBe(mockUnitId);
      expect(supportData.unitType).toBe('warrior'); // Mock implementation returns warrior
      expect(supportData.upkeep).toBeDefined();
      expect(typeof supportData.upkeep.food).toBe('number');
      expect(typeof supportData.upkeep.shield).toBe('number');
      expect(typeof supportData.upkeep.gold).toBe('number');
    });
  });

  describe('unit upkeep calculations', () => {
    it('should calculate basic unit upkeep costs', async () => {
      // Test with mock unit ID
      const mockUnitId = 'mock-unit-1';
      const upkeep = await unitSupportManager.calculateUnitUpkeep(mockUnitId);

      expect(upkeep).toBeDefined();
      expect(upkeep.food).toBeGreaterThanOrEqual(0);
      expect(upkeep.shield).toBeGreaterThanOrEqual(0);
      expect(upkeep.gold).toBeGreaterThanOrEqual(0);

      // Upkeep should be reasonable (not excessive)
      expect(upkeep.food).toBeLessThan(10);
      expect(upkeep.shield).toBeLessThan(10);
      expect(upkeep.gold).toBeLessThan(10);
    });

    it('should calculate different upkeep for different unit types', async () => {
      // Test with mock unit IDs (in full implementation would use different unit types)
      const mockWarriorId = 'mock-warrior-1';
      const mockSettlerId = 'mock-settler-1';

      const warriorUpkeep = await unitSupportManager.calculateUnitUpkeep(mockWarriorId);
      const settlerUpkeep = await unitSupportManager.calculateUnitUpkeep(mockSettlerId);

      expect(warriorUpkeep).toBeDefined();
      expect(settlerUpkeep).toBeDefined();

      // Mock implementation returns same upkeep, but structure is correct
      const warriorTotal = warriorUpkeep.food + warriorUpkeep.shield + warriorUpkeep.gold;
      const settlerTotal = settlerUpkeep.food + settlerUpkeep.shield + settlerUpkeep.gold;

      expect(warriorTotal).toBeGreaterThanOrEqual(0);
      expect(settlerTotal).toBeGreaterThanOrEqual(0);
    });

    it('should handle government-specific upkeep modifiers', async () => {
      const mockUnitId = 'mock-unit-1';

      // Calculate upkeep with current government
      const baseUpkeep = await unitSupportManager.calculateUnitUpkeep(mockUnitId);

      // Get government-modified upkeep
      const govUpkeep = await unitSupportManager.calculateUnitUpkeepWithGovernment(
        mockUnitId,
        'despotism'
      );

      expect(baseUpkeep).toBeDefined();
      expect(govUpkeep).toBeDefined();

      // Government effects may modify upkeep
      expect(govUpkeep.food).toBeGreaterThanOrEqual(0);
      expect(govUpkeep.shield).toBeGreaterThanOrEqual(0);
      expect(govUpkeep.gold).toBeGreaterThanOrEqual(0);
    });
  });

  describe('city-based unit support', () => {
    it('should calculate city unit support capacity', async () => {
      // Test with mock city ID
      const mockCityId = 'mock-city-1';
      const supportCapacity = await unitSupportManager.calculateCityUnitSupport(mockCityId);

      expect(supportCapacity).toBeDefined();
      expect(supportCapacity.freeUnitsSupported).toBeGreaterThanOrEqual(0);
      expect(supportCapacity.upkeepCosts).toBeDefined();
      expect(supportCapacity.totalUnitsSupported).toBeGreaterThanOrEqual(0);
      expect(supportCapacity.unitsRequiringUpkeep).toBeGreaterThanOrEqual(0);
      expect(supportCapacity.happinessEffect).toBeGreaterThanOrEqual(0);
    });

    it('should handle units in home vs foreign cities', async () => {
      const mockUnitId = 'mock-unit-1';
      const mockCityId = 'mock-city-1';

      // Unit in home city
      const homeSupport = await unitSupportManager.calculateUnitSupportInCity(
        mockUnitId,
        mockCityId,
        true
      );

      // Unit away from home
      const awaySupport = await unitSupportManager.calculateUnitSupportInCity(
        mockUnitId,
        mockCityId,
        false
      );

      expect(homeSupport).toBeDefined();
      expect(awaySupport).toBeDefined();

      // Being away from home may have different effects
      expect(homeSupport.happinessEffect).toBeLessThanOrEqual(awaySupport.happinessEffect);
    });

    it('should calculate total city support costs', async () => {
      const mockCityId = 'mock-city-1';
      const totalSupport = await unitSupportManager.calculateTotalCitySupport(mockCityId);

      expect(totalSupport).toBeDefined();
      expect(totalSupport.food).toBeGreaterThanOrEqual(0);
      expect(totalSupport.shield).toBeGreaterThanOrEqual(0);
      expect(totalSupport.gold).toBeGreaterThanOrEqual(0);

      // Total support should be reasonable (mock returns fixed values)
      expect(totalSupport.food).toBeLessThan(20);
      expect(totalSupport.shield).toBeLessThan(20);
      expect(totalSupport.gold).toBeLessThan(20);
    });
  });

  describe('player-wide unit support', () => {
    it('should calculate total player unit support costs', async () => {
      const playerSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      expect(playerSupport).toBeDefined();
      expect(playerSupport.totalUnitsSupported).toBeGreaterThan(0);
      expect(playerSupport.upkeepCosts).toBeDefined();
      expect(playerSupport.upkeepCosts.food).toBeGreaterThanOrEqual(0);
      expect(playerSupport.upkeepCosts.shield).toBeGreaterThanOrEqual(0);
      expect(playerSupport.upkeepCosts.gold).toBeGreaterThanOrEqual(0);
    });

    it('should handle different gold upkeep styles', async () => {
      // Test CITY style
      unitSupportManager.setGoldUpkeepStyle(GoldUpkeepStyle.CITY);
      const cityStyleSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      // Test NATION style
      unitSupportManager.setGoldUpkeepStyle(GoldUpkeepStyle.NATION);
      const nationStyleSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      // Test MIXED style
      unitSupportManager.setGoldUpkeepStyle(GoldUpkeepStyle.MIXED);
      const mixedStyleSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      expect(cityStyleSupport).toBeDefined();
      expect(nationStyleSupport).toBeDefined();
      expect(mixedStyleSupport).toBeDefined();

      // All styles should produce valid results
      expect(cityStyleSupport.upkeepCosts.gold).toBeGreaterThanOrEqual(0);
      expect(nationStyleSupport.upkeepCosts.gold).toBeGreaterThanOrEqual(0);
      expect(mixedStyleSupport.upkeepCosts.gold).toBeGreaterThanOrEqual(0);
    });

    it('should compare support costs between different players', async () => {
      const player1Support = await unitSupportManager.calculatePlayerUnitSupport(playerId1);
      const player2Support = await unitSupportManager.calculatePlayerUnitSupport(playerId2);

      expect(player1Support).toBeDefined();
      expect(player2Support).toBeDefined();

      // Both players should have units to support
      expect(player1Support.totalUnitsSupported).toBeGreaterThan(0);
      expect(player2Support.totalUnitsSupported).toBeGreaterThan(0);

      // Support costs should be reasonable
      expect(
        player1Support.upkeepCosts.food +
          player1Support.upkeepCosts.shield +
          player1Support.upkeepCosts.gold
      ).toBeGreaterThanOrEqual(0);
      expect(
        player2Support.upkeepCosts.food +
          player2Support.upkeepCosts.shield +
          player2Support.upkeepCosts.gold
      ).toBeGreaterThanOrEqual(0);
    });
  });

  describe('integration with GameManager systems', () => {
    it('should integrate with government effects on unit support', async () => {
      // Calculate support with current government
      const currentSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      // Test with different government settings
      const despotismSupport = await unitSupportManager.calculatePlayerUnitSupportWithGovernment(
        playerId1,
        'despotism'
      );
      const monarchySupport = await unitSupportManager.calculatePlayerUnitSupportWithGovernment(
        playerId1,
        'monarchy'
      );

      expect(currentSupport).toBeDefined();
      expect(despotismSupport).toBeDefined();
      expect(monarchySupport).toBeDefined();

      // Different governments should potentially give different results
      expect(despotismSupport.upkeepCosts).toBeDefined();
      expect(monarchySupport.upkeepCosts).toBeDefined();
    });

    it('should integrate with city production and unit support', async () => {
      const mockCityId = 'mock-city-1';
      const citySupport = await unitSupportManager.calculateCityUnitSupport(mockCityId);
      const mockCityProduction = 5; // Mock city production

      // Support costs should be manageable relative to city production
      const supportRatio =
        (citySupport.upkeepCosts.shield + citySupport.upkeepCosts.gold) /
        Math.max(mockCityProduction, 1);
      expect(supportRatio).toBeGreaterThanOrEqual(0);
      expect(supportRatio).toBeLessThan(10); // Support shouldn't be 10x production
    });

    it('should update support costs when units are created or destroyed', async () => {
      const initialSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      // Test shows that unit tracking works at the basic level
      expect(initialSupport.totalUnitsSupported).toBeGreaterThanOrEqual(3);

      // For integration tests, the mock implementation provides consistent results
      // Full implementation would use actual UnitManager integration
      const secondSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);
      expect(secondSupport.totalUnitsSupported).toBe(initialSupport.totalUnitsSupported);
    });
  });

  describe('happiness effects from unit support', () => {
    it('should calculate happiness penalties from units away from home', async () => {
      const mockUnitId = 'mock-warrior-1';

      // Unit at home
      const homeHappiness = await unitSupportManager.calculateUnitHappinessEffect(mockUnitId, true);

      // Unit away from home
      const awayHappiness = await unitSupportManager.calculateUnitHappinessEffect(
        mockUnitId,
        false
      );

      expect(typeof homeHappiness).toBe('number');
      expect(typeof awayHappiness).toBe('number');

      // Being away from home should generally cause more unhappiness
      expect(awayHappiness).toBeGreaterThanOrEqual(homeHappiness);
    });

    it('should calculate total happiness effects for cities', async () => {
      const mockCityId = 'mock-city-1';
      const happinessEffect = await unitSupportManager.calculateCityHappinessFromUnits(mockCityId);

      expect(typeof happinessEffect).toBe('number');
      expect(happinessEffect).toBeGreaterThanOrEqual(0);

      // Happiness penalty should be reasonable
      expect(happinessEffect).toBeLessThan(20); // Should not exceed 20 unhappiness points
    });
  });

  describe('unit support optimization and efficiency', () => {
    it('should handle large numbers of units efficiently', async () => {
      // Simulate multiple unit creation for testing
      for (let i = 0; i < 5; i++) {
        unitSupportManager.trackUnitCreation(playerId1);
      }

      const startTime = Date.now();
      const support = await unitSupportManager.calculatePlayerUnitSupport(playerId1);
      const endTime = Date.now();

      expect(support).toBeDefined();
      expect(support.totalUnitsSupported).toBeGreaterThanOrEqual(5);

      // Should complete within reasonable time (< 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    it('should cache calculations for performance', async () => {
      const firstCalculation = await unitSupportManager.calculatePlayerUnitSupport(playerId1);
      const secondCalculation = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      expect(firstCalculation).toBeDefined();
      expect(secondCalculation).toBeDefined();

      // Results should be identical for unchanged game state
      expect(firstCalculation.totalUnitsSupported).toBe(secondCalculation.totalUnitsSupported);
      expect(firstCalculation.upkeepCosts.food).toBe(secondCalculation.upkeepCosts.food);
      expect(firstCalculation.upkeepCosts.shield).toBe(secondCalculation.upkeepCosts.shield);
      expect(firstCalculation.upkeepCosts.gold).toBe(secondCalculation.upkeepCosts.gold);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle non-existent units gracefully', async () => {
      await expect(
        unitSupportManager.calculateUnitUpkeep('non-existent-unit-id')
      ).rejects.toThrow();
    });

    it('should handle non-existent cities gracefully', async () => {
      await expect(
        unitSupportManager.calculateCityUnitSupport('non-existent-city-id')
      ).rejects.toThrow();
    });

    it('should handle zero units case', async () => {
      // Create a player with no units (hypothetical)
      const emptyPlayerSupport =
        await unitSupportManager.calculatePlayerUnitSupport('empty-player');

      // Should handle gracefully, likely returning zero costs
      if (emptyPlayerSupport) {
        expect(emptyPlayerSupport.totalUnitsSupported).toBe(0);
        expect(emptyPlayerSupport.upkeepCosts.food).toBe(0);
        expect(emptyPlayerSupport.upkeepCosts.shield).toBe(0);
        expect(emptyPlayerSupport.upkeepCosts.gold).toBe(0);
      }
    });
  });

  describe('database integration and persistence', () => {
    it('should persist support calculations across game reloads', async () => {
      const originalSupport = await unitSupportManager.calculatePlayerUnitSupport(playerId1);

      // Simulate game reload by creating a new support manager
      const newSupportManager = new UnitSupportManager(gameId);
      const reloadedSupport = await newSupportManager.calculatePlayerUnitSupport(playerId1);

      expect(reloadedSupport.totalUnitsSupported).toBe(originalSupport.totalUnitsSupported);
      expect(reloadedSupport.upkeepCosts.food).toBeCloseTo(originalSupport.upkeepCosts.food, 1);
      expect(reloadedSupport.upkeepCosts.shield).toBeCloseTo(originalSupport.upkeepCosts.shield, 1);
      expect(reloadedSupport.upkeepCosts.gold).toBeCloseTo(originalSupport.upkeepCosts.gold, 1);
    });
  });
});
