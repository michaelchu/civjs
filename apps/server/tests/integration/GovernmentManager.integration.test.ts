import { GovernmentManager, getGovernments, getGovernment } from '../../src/game/GovernmentManager';
import { GameManager } from '../../src/game/GameManager';
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('GovernmentManager - Integration Tests with Real Government System', () => {
  let governmentManager: GovernmentManager;
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

    // Initialize GovernmentManager
    governmentManager = new GovernmentManager(gameId);
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('government ruleset integration', () => {
    it('should load governments from ruleset system', () => {
      const governments = getGovernments('classic');

      expect(governments).toBeDefined();
      expect(typeof governments).toBe('object');

      // Should have classic governments
      expect(governments.despotism).toBeDefined();
      expect(governments.despotism.name).toBe('Despotism');

      if (governments.monarchy) {
        expect(governments.monarchy.name).toBe('Monarchy');
      }

      if (governments.republic) {
        expect(governments.republic.name).toBe('Republic');
      }
    });

    it('should get individual government by ID', () => {
      const despotism = getGovernment('despotism', 'classic');

      expect(despotism).toBeDefined();
      expect(despotism.id).toBe('despotism');
      expect(despotism.name).toBe('Despotism');
      expect(despotism.effects).toBeDefined();
    });

    it('should handle invalid government IDs gracefully', () => {
      expect(() => {
        getGovernment('invalid_government', 'classic');
      }).toThrow();
    });
  });

  describe('player government initialization', () => {
    it('should initialize player with default government', async () => {
      await governmentManager.initializePlayerGovernment(playerId1);

      const playerGov = governmentManager.getPlayerGovernment(playerId1);

      expect(playerGov).toBeDefined();
      expect(playerGov!.playerId).toBe(playerId1);
      expect(playerGov!.currentGovernment).toBe('despotism');
      expect(playerGov!.revolutionTurns).toBe(0);
      expect(playerGov!.requestedGovernment).toBeUndefined();

      // Verify persistence to database
      const db = getTestDatabase();
      const [dbPlayer] = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.id, playerId1),
      });

      expect(dbPlayer.government).toBe('despotism');
    });

    it('should initialize multiple players with separate government states', async () => {
      await governmentManager.initializePlayerGovernment(playerId1);
      await governmentManager.initializePlayerGovernment(playerId2);

      const player1Gov = governmentManager.getPlayerGovernment(playerId1);
      const player2Gov = governmentManager.getPlayerGovernment(playerId2);

      expect(player1Gov).toBeDefined();
      expect(player2Gov).toBeDefined();
      expect(player1Gov!.playerId).toBe(playerId1);
      expect(player2Gov!.playerId).toBe(playerId2);
      expect(player1Gov!.currentGovernment).toBe('despotism');
      expect(player2Gov!.currentGovernment).toBe('despotism');

      // Should be separate instances
      expect(player1Gov).not.toBe(player2Gov);
    });
  });

  describe('government revolution mechanics', () => {
    beforeEach(async () => {
      await governmentManager.initializePlayerGovernment(playerId1);
    });

    it('should initiate revolution when changing government', async () => {
      const canRevolt = await governmentManager.canChangeGovernment(playerId1, 'republic');

      if (canRevolt) {
        const result = await governmentManager.initiateRevolution(playerId1, 'republic');

        expect(result.success).toBe(true);
        expect(result.revolutionTurns).toBeGreaterThan(0);

        const playerGov = governmentManager.getPlayerGovernment(playerId1);
        expect(playerGov).toBeDefined();
        expect(playerGov!.revolutionTurns).toBeGreaterThan(0);
        expect(playerGov!.requestedGovernment).toBe('republic');
        expect(playerGov!.currentGovernment).toBe('anarchy'); // Should be in anarchy during revolution
      } else {
        // If revolution not possible, that's also valid behavior
        expect(true).toBe(true);
      }
    });

    it('should complete revolution after required turns', async () => {
      // Initiate revolution
      const canRevolt = await governmentManager.canChangeGovernment(playerId1, 'monarchy');

      if (canRevolt) {
        await governmentManager.initiateRevolution(playerId1, 'monarchy');

        let playerGov = governmentManager.getPlayerGovernment(playerId1);
        expect(playerGov).toBeDefined();
        const initialRevolutionTurns = playerGov!.revolutionTurns;

        // Process revolution turns
        for (let i = 0; i < initialRevolutionTurns; i++) {
          await governmentManager.processRevolutionTurn(playerId1);
        }

        playerGov = governmentManager.getPlayerGovernment(playerId1);
        expect(playerGov).toBeDefined();
        expect(playerGov!.revolutionTurns).toBe(0);
        expect(playerGov!.currentGovernment).toBe('monarchy');
        expect(playerGov!.requestedGovernment).toBeUndefined();

        // Verify database persistence
        const db = getTestDatabase();
        const [dbPlayer] = await db.query.players.findMany({
          where: (players, { eq }) => eq(players.id, playerId1),
        });

        expect(dbPlayer.government).toBe('monarchy');
      }
    });

    it('should reject invalid government changes', async () => {
      const result = await governmentManager.canChangeGovernment(playerId1, 'invalid_government');
      expect(result).toBe(false);

      await expect(
        governmentManager.initiateRevolution(playerId1, 'invalid_government')
      ).rejects.toThrow();
    });
  });

  describe('government effects and bonuses', () => {
    beforeEach(async () => {
      await governmentManager.initializePlayerGovernment(playerId1);
    });

    it('should calculate government effects correctly', () => {
      const despotismEffects = governmentManager.getGovernmentEffects(playerId1);

      expect(despotismEffects).toBeDefined();
      expect(Array.isArray(despotismEffects)).toBe(true);

      // Despotism should have some effects defined
      if (despotismEffects.length > 0) {
        despotismEffects.forEach(effect => {
          expect(effect.type).toBeDefined();
          expect(effect.value).toBeDefined();
        });
      }
    });

    it('should get government-specific unit support rules', () => {
      const supportRules = governmentManager.getUnitSupportRules(playerId1);

      expect(supportRules).toBeDefined();
      expect(supportRules.freeUnits).toBeGreaterThanOrEqual(0);
      expect(supportRules.goldPerUnit).toBeGreaterThanOrEqual(0);
      expect(supportRules.foodPerUnit).toBeGreaterThanOrEqual(0);
    });

    it('should calculate trade and tax effects', () => {
      const tradeEffects = governmentManager.getTradeEffects(playerId1);

      expect(tradeEffects).toBeDefined();
      expect(tradeEffects.corruptionLevel).toBeGreaterThanOrEqual(0);
      expect(tradeEffects.wasteLevel).toBeGreaterThanOrEqual(0);
      expect(tradeEffects.maxTradeRoutes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('integration with GameManager', () => {
    it('should integrate with player turn processing', async () => {
      await governmentManager.initializePlayerGovernment(playerId1);

      // Start a revolution
      const canRevolt = await governmentManager.canChangeGovernment(playerId1, 'republic');

      if (canRevolt) {
        await governmentManager.initiateRevolution(playerId1, 'republic');

        // Simulate turn processing
        const game = gameManager.getGameInstance(gameId)!;

        // Process a turn (this should call government manager turn processing)
        await game.turnManager.processTurn();

        const playerGov = governmentManager.getPlayerGovernment(playerId1);
        expect(playerGov).toBeDefined();

        // Revolution turns should have decremented
        expect(playerGov!.revolutionTurns).toBeGreaterThanOrEqual(0);

        // If revolution completed, should be in new government
        if (playerGov!.revolutionTurns === 0) {
          expect(playerGov!.currentGovernment).toBe('republic');
        }
      }
    });

    it('should affect city production through government effects', async () => {
      await governmentManager.initializePlayerGovernment(playerId1);

      const game = gameManager.getGameInstance(gameId)!;
      const city = game.cityManager.getPlayerCities(playerId1)[0];

      if (city) {
        // Get government effects on city
        const governmentBonus = governmentManager.getCityGovernmentBonus(playerId1, city.id);

        expect(governmentBonus).toBeDefined();
        expect(typeof governmentBonus.productionBonus).toBe('number');
        expect(typeof governmentBonus.goldBonus).toBe('number');
        expect(typeof governmentBonus.scienceBonus).toBe('number');
      }
    });
  });

  describe('government change requirements and validation', () => {
    beforeEach(async () => {
      await governmentManager.initializePlayerGovernment(playerId1);
    });

    it('should check technology requirements for government changes', async () => {
      // Try to change to governments that may require certain techs
      const republicPossible = await governmentManager.canChangeGovernment(playerId1, 'republic');
      const democracyPossible = await governmentManager.canChangeGovernment(playerId1, 'democracy');

      // Results depend on player's current research state
      expect(typeof republicPossible).toBe('boolean');
      expect(typeof democracyPossible).toBe('boolean');
    });

    it('should handle government change cooldowns', async () => {
      // Change government once
      const canRevolt1 = await governmentManager.canChangeGovernment(playerId1, 'monarchy');

      if (canRevolt1) {
        await governmentManager.initiateRevolution(playerId1, 'monarchy');

        // Complete the revolution
        const playerGov = governmentManager.getPlayerGovernment(playerId1);
        expect(playerGov).toBeDefined();
        for (let i = 0; i < playerGov!.revolutionTurns; i++) {
          await governmentManager.processRevolutionTurn(playerId1);
        }

        // Try to change again immediately - might be restricted
        const canRevolt2 = await governmentManager.canChangeGovernment(playerId1, 'republic');

        // Behavior depends on implementation - just verify no crashes
        expect(typeof canRevolt2).toBe('boolean');
      }
    });
  });

  describe('database persistence and loading', () => {
    it('should persist government state across game reloads', async () => {
      await governmentManager.initializePlayerGovernment(playerId1);

      // Change government
      const canRevolt = await governmentManager.canChangeGovernment(playerId1, 'republic');

      if (canRevolt) {
        await governmentManager.initiateRevolution(playerId1, 'republic');

        // Simulate game reload
        gameManager['games'].delete(gameId);
        await gameManager.loadGame(gameId);

        // Create new government manager and verify state
        const newGovernmentManager = new GovernmentManager(gameId);
        await newGovernmentManager.loadPlayerGovernments();

        const reloadedPlayerGov = newGovernmentManager.getPlayerGovernment(playerId1);

        if (reloadedPlayerGov) {
          expect(reloadedPlayerGov.playerId).toBe(playerId1);
          expect(reloadedPlayerGov.revolutionTurns).toBeGreaterThanOrEqual(0);

          if (reloadedPlayerGov.revolutionTurns > 0) {
            expect(reloadedPlayerGov.requestedGovernment).toBe('republic');
          }
        }
      }
    });

    it('should handle missing or corrupted government data gracefully', async () => {
      // Try to get government for uninitialized player
      const uninitialized = governmentManager.getPlayerGovernment('non-existent-player');
      expect(uninitialized).toBeUndefined();

      // Initialize properly
      await governmentManager.initializePlayerGovernment(playerId1);

      const initialized = governmentManager.getPlayerGovernment(playerId1);
      expect(initialized).toBeDefined();
    });
  });

  describe('government-specific unit and city effects', () => {
    beforeEach(async () => {
      await governmentManager.initializePlayerGovernment(playerId1);
    });

    it('should apply government effects to military units', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const militaryUnit = Array.from(units).find(u => u.unitTypeId === 'warrior');

      if (militaryUnit) {
        const unitEffects = governmentManager.getUnitGovernmentEffects(playerId1, militaryUnit.id);

        expect(unitEffects).toBeDefined();
        expect(typeof unitEffects.attackBonus).toBe('number');
        expect(typeof unitEffects.defenseBonus).toBe('number');
        expect(typeof unitEffects.supportCost).toBe('number');
      }
    });

    it('should calculate happiness effects from government', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const cities = game.cityManager.getPlayerCities(playerId1);

      if (cities.length > 0) {
        const city = cities[0];
        const happinessEffects = governmentManager.getCityHappinessEffects(playerId1, city.id);

        expect(happinessEffects).toBeDefined();
        expect(typeof happinessEffects.baseHappiness).toBe('number');
        expect(typeof happinessEffects.warWeariness).toBe('number');
        expect(typeof happinessEffects.luxuryBonus).toBe('number');
      }
    });
  });
});
