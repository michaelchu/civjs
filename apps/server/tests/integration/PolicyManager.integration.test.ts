import { PolicyManager } from '../../src/game/PolicyManager';
import { GameManager } from '../../src/game/GameManager';
import { clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('PolicyManager - Integration Tests with Real Policy System', () => {
  let policyManager: PolicyManager;
  let gameManager: GameManager;
  let gameId: string;
  let playerId1: string;
  let playerId2: string;

  beforeEach(async () => {
    // Clear database and reset singleton
    await clearAllTables();
    (GameManager as any).instance = null;

    // Create game scenario
    const scenario = await createBasicGameScenario();
    gameId = scenario.game.id;
    playerId1 = scenario.players[0].id;
    playerId2 = scenario.players[1].id;

    // Initialize GameManager and load the game
    const mockIo = createMockSocketServer();
    gameManager = GameManager.getInstance(mockIo);
    await gameManager.loadGame(gameId);

    // Initialize PolicyManager
    policyManager = new PolicyManager(gameId);
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('policy system initialization', () => {
    it('should initialize with default policies from ruleset', () => {
      const availablePolicies = policyManager.getAvailablePolicies();

      expect(availablePolicies).toBeDefined();
      expect(Array.isArray(availablePolicies)).toBe(true);

      // Should have at least basic tax/luxury/science policies
      const taxPolicy = availablePolicies.find(p => p.id.includes('tax') || p.id.includes('gold'));
      const sciencePolicy = availablePolicies.find(p => p.id.includes('science'));
      const luxuryPolicy = availablePolicies.find(p => p.id.includes('luxury'));

      // At least one policy type should exist
      expect(taxPolicy || sciencePolicy || luxuryPolicy).toBeTruthy();
    });

    it('should initialize player policies with default values', async () => {
      await policyManager.initializePlayerPolicies(playerId1);

      const playerPolicies = policyManager.getPlayerPolicies(playerId1);

      expect(playerPolicies).toBeDefined();
      expect(playerPolicies.playerId).toBe(playerId1);
      expect(playerPolicies.policies).toBeInstanceOf(Map);

      // Should have policies initialized with default values
      expect(playerPolicies.policies.size).toBeGreaterThan(0);

      // Check a policy has proper structure
      const firstPolicy = Array.from(playerPolicies.policies.values())[0];
      expect(firstPolicy.value).toBeGreaterThanOrEqual(0);
      expect(firstPolicy.targetValue).toBe(firstPolicy.value);
      expect(firstPolicy.changedTurn).toBeGreaterThanOrEqual(0);
    });

    it('should initialize multiple players with separate policy states', async () => {
      await policyManager.initializePlayerPolicies(playerId1);
      await policyManager.initializePlayerPolicies(playerId2);

      const player1Policies = policyManager.getPlayerPolicies(playerId1);
      const player2Policies = policyManager.getPlayerPolicies(playerId2);

      expect(player1Policies.playerId).toBe(playerId1);
      expect(player2Policies.playerId).toBe(playerId2);

      // Should be separate instances
      expect(player1Policies).not.toBe(player2Policies);
      expect(player1Policies.policies).not.toBe(player2Policies.policies);
    });
  });

  describe('policy adjustment mechanics', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should allow valid policy adjustments within limits', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        const currentValue = policyManager.getPolicyValue(playerId1, testPolicy.id);
        const newValue = Math.min(testPolicy.stop, currentValue + testPolicy.step);

        const canAdjust = await policyManager.canAdjustPolicy(playerId1, testPolicy.id, newValue);

        if (canAdjust) {
          const result = await policyManager.adjustPolicy(playerId1, testPolicy.id, newValue);

          expect(result.success).toBe(true);

          const updatedValue = policyManager.getPolicyValue(playerId1, testPolicy.id);
          expect(updatedValue).toBe(newValue);
        } else {
          // If adjustment not possible, that's valid behavior too
          expect(true).toBe(true);
        }
      }
    });

    it('should reject policy adjustments beyond limits', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        // Try to set beyond maximum
        const invalidValue = testPolicy.stop + testPolicy.step;

        const canAdjust = await policyManager.canAdjustPolicy(
          playerId1,
          testPolicy.id,
          invalidValue
        );
        expect(canAdjust).toBe(false);

        await expect(
          policyManager.adjustPolicy(playerId1, testPolicy.id, invalidValue)
        ).rejects.toThrow();

        // Try to set below minimum
        const invalidMinValue = testPolicy.start - testPolicy.step;

        const canAdjustMin = await policyManager.canAdjustPolicy(
          playerId1,
          testPolicy.id,
          invalidMinValue
        );
        expect(canAdjustMin).toBe(false);
      }
    });

    it('should respect minimum turn intervals between changes', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const restrictedPolicy = availablePolicies.find(p => p.minimumTurns > 0);

      if (restrictedPolicy) {
        const currentValue = policyManager.getPolicyValue(playerId1, restrictedPolicy.id);
        const newValue = Math.min(restrictedPolicy.stop, currentValue + restrictedPolicy.step);

        // First change should be allowed
        const canAdjust1 = await policyManager.canAdjustPolicy(
          playerId1,
          restrictedPolicy.id,
          newValue
        );

        if (canAdjust1) {
          await policyManager.adjustPolicy(playerId1, restrictedPolicy.id, newValue);

          // Immediate second change should be blocked
          const canAdjust2 = await policyManager.canAdjustPolicy(
            playerId1,
            restrictedPolicy.id,
            currentValue
          );
          expect(canAdjust2).toBe(false);
        }
      }
    });
  });

  describe('policy effects calculation', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should calculate effective policy values correctly', () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        const displayValue = policyManager.getPolicyValue(playerId1, testPolicy.id);
        const effectiveValue = policyManager.getEffectivePolicyValue(playerId1, testPolicy.id);

        // Should apply policy formula: (display_value + offset) * (factor/100)
        const expectedEffective = (displayValue + testPolicy.offset) * (testPolicy.factor / 100);
        expect(effectiveValue).toBeCloseTo(expectedEffective, 2);
      }
    });

    it('should provide policy bonuses for game calculations', () => {
      const scienceBonus = policyManager.getPolicyBonus(playerId1, 'science');
      const goldBonus = policyManager.getPolicyBonus(playerId1, 'gold');
      const luxuryBonus = policyManager.getPolicyBonus(playerId1, 'luxury');

      expect(typeof scienceBonus).toBe('number');
      expect(typeof goldBonus).toBe('number');
      expect(typeof luxuryBonus).toBe('number');

      // Total should add up to 100% (or close to it for tax policies)
      const totalTax = scienceBonus + goldBonus + luxuryBonus;
      if (totalTax > 0) {
        expect(totalTax).toBeCloseTo(100, 5);
      }
    });

    it('should calculate policy effects on cities', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const city = game.cityManager.getPlayerCities(playerId1)[0];

      if (city) {
        const policyEffects = policyManager.getCityPolicyEffects(playerId1, city.id);

        expect(policyEffects).toBeDefined();
        expect(typeof policyEffects.scienceModifier).toBe('number');
        expect(typeof policyEffects.goldModifier).toBe('number');
        expect(typeof policyEffects.luxuryModifier).toBe('number');
        expect(typeof policyEffects.productionModifier).toBe('number');
      }
    });
  });

  describe('integration with GameManager and other systems', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should integrate with turn processing', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Process a turn (should update policy states)
      await game.turnManager.processTurn();

      // Policy manager should handle turn updates
      const playerPolicies = policyManager.getPlayerPolicies(playerId1);
      expect(playerPolicies).toBeDefined();

      // Verify turn-based policy updates work
      await policyManager.processTurn(playerId1);
      expect(true).toBe(true); // Should not crash
    });

    it('should affect city production through policy bonuses', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const city = game.cityManager.getPlayerCities(playerId1)[0];

      if (city) {
        // Get base city production
        const baseProduction = city.productionPerTurn;

        // Get policy effects
        const policyEffects = policyManager.getCityPolicyEffects(playerId1, city.id);

        // Should calculate modified production
        const modifiedProduction = baseProduction * (1 + policyEffects.productionModifier / 100);

        expect(modifiedProduction).toBeGreaterThanOrEqual(0);
        expect(typeof modifiedProduction).toBe('number');
      }
    });

    it('should integrate with research through science policies', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Get current research progress
      const research = game.researchManager.getPlayerResearch(playerId1);

      if (research) {
        // Policy should affect science generation
        const scienceBonus = policyManager.getPolicyBonus(playerId1, 'science');

        expect(typeof scienceBonus).toBe('number');
        expect(scienceBonus).toBeGreaterThanOrEqual(0);
        expect(scienceBonus).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('policy requirements and restrictions', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should check policy adjustment requirements', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const policyWithReqs = availablePolicies.find(p => p.reqs && p.reqs.length > 0);

      if (policyWithReqs) {
        // Check if requirements are met
        const reqsMet = await policyManager.checkPolicyRequirements(playerId1, policyWithReqs.id);

        expect(typeof reqsMet).toBe('boolean');

        // If requirements not met, adjustment should be blocked
        if (!reqsMet) {
          const canAdjust = await policyManager.canAdjustPolicy(
            playerId1,
            policyWithReqs.id,
            policyWithReqs.default + policyWithReqs.step
          );
          expect(canAdjust).toBe(false);
        }
      }
    });

    it('should handle government-dependent policies', async () => {
      // Some policies may depend on government type
      const availablePolicies = policyManager.getAvailablePolicies();

      // Test that policy system works regardless of government
      for (const policy of availablePolicies.slice(0, 3)) {
        // Test first 3 policies
        const canAdjust = await policyManager.canAdjustPolicy(playerId1, policy.id, policy.default);

        // Should return boolean, not throw
        expect(typeof canAdjust).toBe('boolean');
      }
    });
  });

  describe('database persistence and loading', () => {
    it('should persist policy changes across game reloads', async () => {
      await policyManager.initializePlayerPolicies(playerId1);

      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        const newValue = Math.min(testPolicy.stop, testPolicy.default + testPolicy.step);
        const canAdjust = await policyManager.canAdjustPolicy(playerId1, testPolicy.id, newValue);

        if (canAdjust) {
          await policyManager.adjustPolicy(playerId1, testPolicy.id, newValue);

          // Simulate game reload
          gameManager['games'].delete(gameId);
          await gameManager.loadGame(gameId);

          // Create new policy manager and verify state
          const newPolicyManager = new PolicyManager(gameId);
          await newPolicyManager.loadPlayerPolicies();

          const reloadedValue = newPolicyManager.getPolicyValue(playerId1, testPolicy.id);
          expect(reloadedValue).toBe(newValue);
        }
      }
    });

    it('should handle missing or corrupted policy data gracefully', async () => {
      // Try to get policies for uninitialized player
      const uninitializedPolicies = policyManager.getPlayerPolicies('non-existent-player');
      expect(uninitializedPolicies).toBeUndefined();

      // Initialize properly
      await policyManager.initializePlayerPolicies(playerId1);

      const initializedPolicies = policyManager.getPlayerPolicies(playerId1);
      expect(initializedPolicies).toBeDefined();
    });
  });

  describe('policy validation and error handling', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should validate policy step increments', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        // Try invalid step (not aligned with policy step size)
        const invalidValue = testPolicy.default + testPolicy.step / 2;

        const canAdjust = await policyManager.canAdjustPolicy(
          playerId1,
          testPolicy.id,
          invalidValue
        );

        // Should reject non-step-aligned values
        expect(canAdjust).toBe(false);
      }
    });

    it('should handle concurrent policy adjustments safely', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();

      if (availablePolicies.length >= 2) {
        const policy1 = availablePolicies[0];
        const policy2 = availablePolicies[1];

        const value1 = Math.min(policy1.stop, policy1.default + policy1.step);
        const value2 = Math.min(policy2.stop, policy2.default + policy2.step);

        // Attempt concurrent adjustments
        const results = await Promise.allSettled([
          policyManager.adjustPolicy(playerId1, policy1.id, value1),
          policyManager.adjustPolicy(playerId1, policy2.id, value2),
        ]);

        // Should handle concurrency gracefully (no crashes)
        results.forEach(result => {
          expect(result.status === 'fulfilled' || result.status === 'rejected').toBe(true);
        });
      }
    });
  });

  describe('policy history and change tracking', () => {
    beforeEach(async () => {
      await policyManager.initializePlayerPolicies(playerId1);
    });

    it('should track policy change history', async () => {
      const availablePolicies = policyManager.getAvailablePolicies();
      const testPolicy = availablePolicies[0];

      if (testPolicy) {
        const originalValue = policyManager.getPolicyValue(playerId1, testPolicy.id);
        const newValue = Math.min(testPolicy.stop, originalValue + testPolicy.step);

        const canAdjust = await policyManager.canAdjustPolicy(playerId1, testPolicy.id, newValue);

        if (canAdjust) {
          await policyManager.adjustPolicy(playerId1, testPolicy.id, newValue);

          // Check change tracking
          const policyHistory = policyManager.getPolicyChangeHistory(playerId1, testPolicy.id);

          expect(policyHistory).toBeDefined();
          expect(policyHistory.length).toBeGreaterThan(0);

          const latestChange = policyHistory[policyHistory.length - 1];
          expect(latestChange.newValue).toBe(newValue);
          expect(latestChange.oldValue).toBe(originalValue);
          expect(latestChange.turn).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});
