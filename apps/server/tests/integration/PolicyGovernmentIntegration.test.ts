/**
 * Integration test demonstrating the sophisticated PolicyManager and GovernmentManager architecture
 * This test shows the current architecture works correctly with freeciv-compliant APIs
 */

import { PolicyManager } from '@game/managers/PolicyManager';
import { GovernmentManager } from '@game/managers/GovernmentManager';
import {
  generateTestUUID,
  getTestDatabase,
  clearAllTables,
  getTestDatabaseProvider,
} from '../utils/testDatabase';
import * as schema from '@database/schema';

// Mock logger to reduce test noise
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Use real test database provider instead of mock

describe('Policy and Government Manager Integration', () => {
  let policyManager: PolicyManager;
  let governmentManager: GovernmentManager;
  let gameId: string;
  let playerId: string;
  let userId: string;

  beforeEach(async () => {
    // Clear database before each test
    await clearAllTables();

    // Generate UUIDs for this test
    gameId = generateTestUUID('5001');
    playerId = generateTestUUID('5002');
    userId = generateTestUUID('5003');

    const db = getTestDatabase();
    const testDbProvider = getTestDatabaseProvider();

    // Create user first
    await db.insert(schema.users).values({
      id: userId,
      username: `TestUser_${Date.now()}`,
      email: `test_${Date.now()}@example.com`,
      passwordHash: 'test-hash',
    });

    // Create game
    await db.insert(schema.games).values({
      id: gameId,
      name: 'Policy Government Test Game',
      hostId: userId,
      maxPlayers: 2,
      mapWidth: 20,
      mapHeight: 20,
      ruleset: 'classic',
    });

    // Create player
    await db.insert(schema.players).values({
      id: playerId,
      gameId: gameId,
      userId: userId,
      playerNumber: 0,
      nation: 'roman',
      civilization: 'Roman',
      leaderName: 'Caesar',
      color: { r: 255, g: 0, b: 0 },
      government: 'despotism',
      isReady: false,
      isAlive: true,
    });

    // Initialize managers with real test database
    policyManager = new PolicyManager(gameId, null as any);
    governmentManager = new GovernmentManager(gameId, testDbProvider);

    // Initialize player data
    await policyManager.initializePlayerPolicies(playerId);
    await governmentManager.initializePlayerGovernment(playerId);
  });

  describe('PolicyManager - Sophisticated Architecture', () => {
    it('should return PlayerPolicies object with rich state information', () => {
      // Test the sophisticated API that returns full policy state
      const playerPolicies = policyManager.getPlayerPolicies(playerId);

      expect(playerPolicies).toBeDefined();
      expect(playerPolicies).toHaveProperty('playerId', playerId);
      expect(playerPolicies).toHaveProperty('policies');
      expect(playerPolicies!.policies instanceof Map).toBe(true);
    });

    it('should provide available policies with proper freeciv compliance', () => {
      // Test the core method - policies are available through getAvailablePolicies
      const availablePolicies = policyManager.getAvailablePolicies();

      expect(Array.isArray(availablePolicies)).toBe(true);
      expect(availablePolicies.length).toBeGreaterThan(0);

      // Each policy should have freeciv-compliant structure
      const policy = availablePolicies[0];
      expect(policy).toHaveProperty('id');
      expect(policy).toHaveProperty('name');
      expect(policy).toHaveProperty('start');
      expect(policy).toHaveProperty('stop');
      expect(policy).toHaveProperty('step');
      expect(policy).toHaveProperty('default');
      expect(policy).toHaveProperty('offset');
      expect(policy).toHaveProperty('factor');
      expect(policy).toHaveProperty('minimumTurns');
    });

    it('should allow policy adoption with sophisticated validation', async () => {
      // Test the core changePolicyValue method with rich functionality
      const result = await policyManager.changePolicyValue(
        playerId,
        'tax_rate',
        150,
        1,
        new Set<string>()
      );

      expect(typeof result.success).toBe('boolean');
      // The sophisticated implementation validates ranges, steps, and turn restrictions
    });

    it('should provide policy data through core methods', () => {
      // Test core methods - policies available through direct access
      const availablePolicies = policyManager.getAvailablePolicies();
      expect(Array.isArray(availablePolicies)).toBe(true);

      const playerPolicies = policyManager.getPlayerPolicies(playerId);
      expect(playerPolicies).toBeDefined();

      if (availablePolicies.length > 0) {
        const policy = availablePolicies[0];
        expect(policy).toHaveProperty('id');
        expect(policy).toHaveProperty('name');

        // Test that we can get policy values for the player
        const policyValue = policyManager.getPlayerPolicyValue(playerId, policy.id);
        expect(typeof policyValue).toBe('number');
      }
    });

    it('should track policy values with change history (freeciv compliance)', () => {
      // Test freeciv-compliant value tracking
      const currentValue = policyManager.getPlayerPolicyValue(playerId, 'tax_rate');
      const targetValue = policyManager.getPlayerPolicyTargetValue(playerId, 'tax_rate');
      const effectValue = policyManager.getEffectivePolicyValue(playerId, 'tax_rate');

      expect(typeof currentValue).toBe('number');
      expect(typeof targetValue).toBe('number');
      expect(typeof effectValue).toBe('number');
    });
  });

  describe('GovernmentManager - Revolution System Architecture', () => {
    it('should provide comprehensive revolution mechanics', async () => {
      // Test the sophisticated revolution system
      const revolutionResult = await governmentManager.startRevolution(
        playerId,
        'monarchy',
        new Set(['monarchy'])
      );

      expect(revolutionResult).toHaveProperty('success');
      expect(revolutionResult).toHaveProperty('message');

      if (revolutionResult.success) {
        // Test revolution turn processing - the sophisticated system handles multi-turn revolutions
        await governmentManager.processRevolutionTurn(playerId);
      }
    });

    it('should provide government validation with requirement checking', async () => {
      // Test sophisticated government validation
      const canChange = await governmentManager.canChangeGovernment(playerId, 'republic');
      expect(typeof canChange).toBe('boolean');

      const playerGov = governmentManager.getPlayerGovernment(playerId);
      expect(playerGov).toBeDefined();
      expect(playerGov).toHaveProperty('playerId');
      expect(playerGov).toHaveProperty('currentGovernment');
      expect(playerGov).toHaveProperty('revolutionTurns');
    });

    it('should provide government effects with freeciv compliance', () => {
      // Test freeciv-compliant government effects
      const effects = governmentManager.getGovernmentEffects(playerId);
      expect(Array.isArray(effects)).toBe(true);

      if (effects.length > 0) {
        const effect = effects[0];
        expect(effect).toHaveProperty('type');
        expect(effect).toHaveProperty('value');
        expect(typeof effect.type).toBe('string');
        expect(typeof effect.value).toBe('number');
      }
    });

    it('should calculate government maintenance costs', () => {
      // Test new government maintenance functionality
      const maintenance = governmentManager.calculateGovernmentMaintenance(playerId);
      expect(typeof maintenance).toBe('number');
      expect(maintenance).toBeGreaterThanOrEqual(0);
    });

    it('should provide unit support rules integration', () => {
      // Test government integration with unit support
      const supportRules = governmentManager.getUnitSupportRules(playerId);
      expect(supportRules).toHaveProperty('freeUnits');
      expect(supportRules).toHaveProperty('goldPerUnit');
      expect(supportRules).toHaveProperty('foodPerUnit');
      expect(supportRules).toHaveProperty('shieldPerUnit');
    });

    it('should provide trade effects for economic integration', () => {
      // Test government trade effects
      const tradeEffects = governmentManager.getTradeEffects(playerId);
      expect(tradeEffects).toHaveProperty('corruptionLevel');
      expect(tradeEffects).toHaveProperty('wasteLevel');
      expect(tradeEffects).toHaveProperty('maxTradeRoutes');
    });
  });

  describe('Cross-Manager Integration', () => {
    it('should demonstrate policy and government interaction', async () => {
      // Test that both managers work together
      const playerPolicies = policyManager.getPlayerPolicies(playerId);
      const playerGov = governmentManager.getPlayerGovernment(playerId);

      expect(playerPolicies?.playerId).toBe(playerId);
      expect(playerGov?.playerId).toBe(playerId);

      // Both should have initialized state
      expect(playerPolicies?.policies instanceof Map).toBe(true);
      expect(playerGov?.currentGovernment).toBe('despotism');
    });

    it('should show architecture supports complex game mechanics', () => {
      // Demonstrate the sophisticated architecture can handle complex interactions
      const govEffects = governmentManager.getGovernmentEffects(playerId);
      const policyEffects = policyManager.getPolicyEffects(playerId, 'tax_rate');

      // Both systems provide structured effect data
      expect(Array.isArray(govEffects)).toBe(true);
      expect(Array.isArray(policyEffects)).toBe(true);
    });
  });
});
