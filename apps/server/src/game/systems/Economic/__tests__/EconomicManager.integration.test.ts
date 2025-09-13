/**
 * EconomicManager Integration Tests
 * Tests the integration between EconomicManager and existing systems
 */

import { EconomicManager } from '../EconomicManager';
import type { DatabaseProvider } from '@database';
import type { CityEconomicOutput } from '../types/EconomicTypes';

// Mock DatabaseProvider
const mockDatabase = {
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([{ gold: 50 }]),
      }),
    }),
  }),
  update: jest.fn().mockReturnValue({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue({}),
    }),
  }),
};

const mockDatabaseProvider = {
  getDatabase: jest.fn().mockReturnValue(mockDatabase),
} as unknown as DatabaseProvider;

describe('EconomicManager Integration', () => {
  let economicManager: EconomicManager;
  const gameId = 'test-game-id';
  const playerId = 'test-player-id';

  beforeEach(() => {
    jest.clearAllMocks();
    economicManager = new EconomicManager(gameId, mockDatabaseProvider);
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await economicManager.initialize();
      const status = economicManager.getSystemStatus();

      expect(status.isInitialized).toBe(true);
      expect(status.gameId).toBe(gameId);
      expect(status.services).toHaveLength(2);
      expect(status.services).toContain('TaxRateService');
      expect(status.services).toContain('TreasuryService');
    });

    test('should initialize player with default values', async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId);

      const taxRates = economicManager.getPlayerTaxRates(playerId);
      expect(taxRates.tax).toBe(50);
      expect(taxRates.luxury).toBe(20);
      expect(taxRates.science).toBe(30);
    });

    test('should initialize player with custom values', async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(
        playerId,
        100, // starting gold
        { tax: 60, luxury: 10, science: 30 }
      );

      const taxRates = economicManager.getPlayerTaxRates(playerId);
      expect(taxRates.tax).toBe(60);
      expect(taxRates.luxury).toBe(10);
      expect(taxRates.science).toBe(30);
    });
  });

  describe('Tax Rate Management', () => {
    beforeEach(async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId);
    });

    test('should validate and set tax rates', () => {
      const validation = economicManager.setPlayerTaxRates({
        playerId,
        newRates: { tax: 70, luxury: 20, science: 10 },
        immediate: true,
      });

      expect(validation.isValid).toBe(true);

      const updatedRates = economicManager.getPlayerTaxRates(playerId);
      expect(updatedRates.tax).toBe(70);
      expect(updatedRates.luxury).toBe(20);
      expect(updatedRates.science).toBe(10);
    });

    test('should reject invalid tax rates', () => {
      const validation = economicManager.setPlayerTaxRates({
        playerId,
        newRates: { tax: 50, luxury: 30, science: 30 }, // sums to 110%
        immediate: true,
      });

      expect(validation.isValid).toBe(false);
      expect(validation.error).toContain('Total rate allocation must equal 100%');
    });

    test('should convert trade to outputs based on rates', () => {
      // Set specific tax rates
      economicManager.setPlayerTaxRates({
        playerId,
        newRates: { tax: 60, luxury: 20, science: 20 },
        immediate: true,
      });

      const outputs = economicManager.convertTradeToOutputs(playerId, 10);

      expect(outputs.gold).toBe(6); // 60% of 10
      expect(outputs.luxury).toBe(2); // 20% of 10
      expect(outputs.science).toBe(2); // 20% of 10
    });
  });

  describe('City Economic Calculations', () => {
    beforeEach(async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId);
    });

    test('should calculate city economic output', () => {
      const cityId = 'test-city-id';
      const rawTrade = 10;
      const directGold = 5;
      const buildingUpkeep = 2;
      const unitUpkeep = 1;

      const output = economicManager.calculateCityEconomicOutput(
        cityId,
        playerId,
        rawTrade,
        directGold,
        buildingUpkeep,
        unitUpkeep
      );

      expect(output.cityId).toBe(cityId);
      expect(output.playerId).toBe(playerId);
      expect(output.rawTrade).toBe(rawTrade);
      expect(output.directGold).toBe(directGold);
      expect(output.costs.buildingUpkeep).toBe(buildingUpkeep);
      expect(output.costs.unitUpkeep).toBe(unitUpkeep);
      expect(output.costs.total).toBe(buildingUpkeep + unitUpkeep);
    });

    test('should process turn economics for player', async () => {
      const cityOutputs: CityEconomicOutput[] = [
        {
          cityId: 'city-1',
          playerId,
          rawTrade: 10,
          netTrade: 10,
          tradeConversion: { gold: 5, luxury: 2, science: 3 },
          directGold: 3,
          totalGoldProduced: 8,
          costs: { buildingUpkeep: 2, unitUpkeep: 1, total: 3 },
          netGoldContribution: 5,
        },
        {
          cityId: 'city-2',
          playerId,
          rawTrade: 8,
          netTrade: 8,
          tradeConversion: { gold: 4, luxury: 2, science: 2 },
          directGold: 2,
          totalGoldProduced: 6,
          costs: { buildingUpkeep: 1, unitUpkeep: 1, total: 2 },
          netGoldContribution: 4,
        },
      ];

      const summary = await economicManager.processTurnEconomics(
        playerId,
        cityOutputs,
        1 // turn number
      );

      expect(summary.playerId).toBe(playerId);
      expect(summary.turn).toBe(1);
      expect(summary.cities).toHaveLength(2);
      expect(summary.totals.goldProduced).toBe(14); // 8 + 6
      expect(summary.totals.buildingUpkeep).toBe(3); // 2 + 1
      expect(summary.totals.netGoldChange).toBe(9); // 5 + 4
    });
  });

  describe('Rush Building System', () => {
    beforeEach(async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId, 100); // Start with 100 gold
    });

    test('should calculate rush building cost', async () => {
      const cityId = 'test-city-id';
      const calculation = await economicManager.getRushBuildingCalculation(
        playerId,
        cityId,
        'temple',
        20, // current progress
        60 // total cost
      );

      expect(calculation.cityId).toBe(cityId);
      expect(calculation.productionTarget).toBe('temple');
      expect(calculation.remainingCost).toBe(40); // 60 - 20
      expect(calculation.rushCost).toBe(80); // 40 * 2 (base multiplier)
      expect(calculation.canAfford).toBe(true); // Player has 100 gold
    });

    test('should execute rush building when affordable', async () => {
      const cityId = 'test-city-id';
      const calculation = await economicManager.getRushBuildingCalculation(
        playerId,
        cityId,
        'temple',
        50, // current progress
        60 // total cost
      );

      expect(calculation.canAfford).toBe(true);

      const result = await economicManager.executeRushBuilding(playerId, cityId, calculation);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('Economic Status', () => {
    beforeEach(async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId);
    });

    test('should get comprehensive economic status', async () => {
      const status = await economicManager.getPlayerEconomicStatus(playerId);

      expect(status.currentGold).toBe(50); // Default starting gold
      expect(status.taxRates).toBeDefined();
      expect(status.warnings).toBeDefined();
      expect(status.recentTransactions).toBeDefined();
      expect(status.treasuryStats).toBeDefined();
    });

    test('should track transaction history', async () => {
      // Add some gold
      await economicManager.addPlayerGold(playerId, 25, 'Test income');

      // Spend some gold
      await economicManager.spendPlayerGold(playerId, 10, 'Test expense');

      const transactions = economicManager.getTransactionHistory(playerId);
      expect(transactions).toHaveLength(2);

      // Check most recent transaction first (spending)
      expect(transactions[0].amount).toBe(-10);
      expect(transactions[0].description).toBe('Test expense');

      // Check income transaction
      expect(transactions[1].amount).toBe(25);
      expect(transactions[1].description).toBe('Test income');
    });
  });

  describe('Cleanup', () => {
    test('should cleanup resources properly', async () => {
      await economicManager.initialize();
      await economicManager.initializePlayer(playerId);

      // Verify initialized
      expect(economicManager.getSystemStatus().isInitialized).toBe(true);

      // Cleanup
      economicManager.cleanup();

      // Verify cleaned up
      expect(economicManager.getSystemStatus().isInitialized).toBe(false);
    });
  });
});
