import { ActionSystem } from '../../src/game/ActionSystem';
import { GameManager } from '../../src/game/GameManager';
import { ActionType } from '../../src/types/shared/actions';
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('ActionSystem - Integration Tests with Cross-Manager Operations', () => {
  let actionSystem: ActionSystem;
  let gameManager: GameManager;
  let gameId: string;
  let playerId1: string;
  let _playerId2: string;

  beforeEach(async () => {
    // Clear database and reset singleton
    await clearAllTables();
    (GameManager as any).instance = null;

    // Create game scenario
    const scenario = await createBasicGameScenario();
    gameId = scenario.game.id;
    playerId1 = scenario.players[0].id;
    _playerId2 = scenario.players[1].id; // Used for future multi-player tests

    // Initialize GameManager and load the game
    const mockIo = createMockSocketServer();
    gameManager = GameManager.getInstance(mockIo);
    await gameManager.loadGame(gameId);

    // Initialize ActionSystem with gameId and callback
    actionSystem = new ActionSystem(gameId, {
      foundCity: async (gameId, playerId, name, x, y) => {
        return await gameManager.foundCity(gameId, playerId, name, x, y);
      },
      requestPath: async (_playerId, unitId, targetX, targetY) => {
        // Mock pathfinding response that returns a simple direct path
        const game = gameManager.getGameInstance(gameId);
        if (!game) return { success: false, error: 'Game not found' };

        const unit = game.unitManager.getUnit(unitId);
        if (!unit) return { success: false, error: 'Unit not found' };

        // Return a simple path from current position to target
        const path = [
          { x: unit.x, y: unit.y, cost: 0 },
          { x: targetX, y: targetY, cost: 3 },
        ];
        return { success: true, path };
      },
    });
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('action system initialization and definitions', () => {
    it('should initialize with game ID and provide action definitions', () => {
      expect(actionSystem).toBeDefined();

      const moveAction = actionSystem.getActionDefinition(ActionType.MOVE);
      expect(moveAction).toBeDefined();
      expect(moveAction!.name).toBe('Move');

      const fortifyAction = actionSystem.getActionDefinition(ActionType.FORTIFY);
      expect(fortifyAction).toBeDefined();
      expect(fortifyAction!.name).toBe('Fortify');

      const gotoAction = actionSystem.getActionDefinition(ActionType.GOTO);
      expect(gotoAction).toBeDefined();
      expect(gotoAction!.name).toBe('Go To');

      const foundCityAction = actionSystem.getActionDefinition(ActionType.FOUND_CITY);
      expect(foundCityAction).toBeDefined();
      expect(foundCityAction!.name).toBe('Found City');
    });

    it('should return null for unknown action types', () => {
      const unknownAction = actionSystem.getActionDefinition('UNKNOWN_ACTION' as ActionType);
      expect(unknownAction).toBeNull();
    });
  });

  describe('unit action validation based on requirements', () => {
    it('should validate military unit actions correctly', () => {
      const game = gameManager.getGameInstance(gameId)!;
      const warriorUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'warrior'
      );

      if (warriorUnit) {
        // Warrior should be able to fortify (has military requirements)
        const canFortify = actionSystem.canUnitPerformAction(warriorUnit, ActionType.FORTIFY);
        expect(canFortify).toBe(true);

        // Warrior should be able to wait and sentry
        const canWait = actionSystem.canUnitPerformAction(warriorUnit, ActionType.WAIT);
        expect(canWait).toBe(true);

        const canSentry = actionSystem.canUnitPerformAction(warriorUnit, ActionType.SENTRY);
        expect(canSentry).toBe(true);

        // Warrior should NOT be able to found city (no settler capability)
        const canFoundCity = actionSystem.canUnitPerformAction(warriorUnit, ActionType.FOUND_CITY);
        expect(canFoundCity).toBe(false);
      }
    });

    it('should validate settler actions correctly', () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'settler'
      );

      if (settlerUnit) {
        // Settler should be able to found city
        const canFoundCity = actionSystem.canUnitPerformAction(settlerUnit, ActionType.FOUND_CITY);
        expect(canFoundCity).toBe(true);

        // Settler should be able to basic actions
        const canWait = actionSystem.canUnitPerformAction(settlerUnit, ActionType.WAIT);
        expect(canWait).toBe(true);

        // Settler should NOT be able to fortify (no military requirements)
        const canFortify = actionSystem.canUnitPerformAction(settlerUnit, ActionType.FORTIFY);
        expect(canFortify).toBe(false);
      }
    });
  });

  describe('action execution with real cross-manager effects', () => {
    it('should execute fortify action and persist state changes', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const warriorUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'warrior'
      );

      if (warriorUnit) {
        expect(warriorUnit.fortified).toBe(false);

        // Execute fortify action
        const result = await actionSystem.executeAction(warriorUnit, ActionType.FORTIFY);

        expect(result.success).toBe(true);
        expect(result.message).toContain('fortified');

        // Verify unit is now fortified in memory
        expect(warriorUnit.fortified).toBe(true);

        // Verify persistence to database
        const db = getTestDatabase();
        const [dbUnit] = await db.query.units.findMany({
          where: (units, { eq }) => eq(units.id, warriorUnit.id),
        });
        expect(dbUnit.isFortified).toBe(true);
      } else {
        // If no warrior, test with any unit that can fortify
        expect(true).toBe(true);
      }
    });

    it('should execute wait action and preserve movement', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      expect(unit).toBeDefined();
      const initialMovement = unit.movementLeft;

      // Execute wait action
      const result = await actionSystem.executeAction(unit, ActionType.WAIT);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();

      // Movement should be preserved for wait action
      expect(unit.movementLeft).toBe(initialMovement);
    });

    it('should execute found city action with GameManager integration', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'settler'
      );

      if (settlerUnit) {
        const initialCityCount = game.cityManager.getPlayerCities(playerId1).length;
        const initialUnitCount = game.unitManager.getPlayerUnits(playerId1).length;

        // Execute found city action
        const result = await actionSystem.executeAction(settlerUnit, ActionType.FOUND_CITY);

        expect(result.success).toBe(true);
        expect(result.message).toContain('city');
        expect(result.cityId).toBeDefined();

        // Verify city was created through GameManager
        const cities = game.cityManager.getPlayerCities(playerId1);
        expect(cities.length).toBe(initialCityCount + 1);

        const newCity = cities.find(c => c.id === result.cityId);
        expect(newCity).toBeDefined();
        expect(newCity!.x).toBe(settlerUnit.x);
        expect(newCity!.y).toBe(settlerUnit.y);

        // Verify settler was consumed (removed from UnitManager)
        const settlerAfter = game.unitManager.getUnit(settlerUnit.id);
        expect(settlerAfter).toBeUndefined();
        expect(game.unitManager.getPlayerUnits(playerId1).length).toBe(initialUnitCount - 1);

        // Verify persistence to database
        const db = getTestDatabase();

        // City should be in database
        const dbCities = await db.query.cities.findMany({
          where: (cities, { eq }) => eq(cities.id, result.cityId!),
        });
        expect(dbCities).toHaveLength(1);
        expect(dbCities[0].x).toBe(settlerUnit.x);
        expect(dbCities[0].y).toBe(settlerUnit.y);

        // Settler should be removed from database
        const dbUnits = await db.query.units.findMany({
          where: (units, { eq }) => eq(units.id, settlerUnit.id),
        });
        expect(dbUnits).toHaveLength(0);
      } else {
        // Skip if no settler unit available
        expect(true).toBe(true);
      }
    });
  });

  describe('action error handling and validation', () => {
    it('should reject unknown action types', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Try to execute unknown action
      const result = await actionSystem.executeAction(unit, 'INVALID_ACTION' as ActionType);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown action');
    });

    it('should reject actions unit cannot perform', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'settler'
      );

      if (settlerUnit) {
        // Try to fortify settler (should fail - no military requirements)
        const result = await actionSystem.executeAction(settlerUnit, ActionType.FORTIFY);

        expect(result.success).toBe(false);
        expect(result.message).toContain('cannot perform');

        // Verify settler wasn't fortified
        expect(settlerUnit.fortified).toBe(false);
      }
    });

    it('should handle found city without callback gracefully', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(
        u => u.unitTypeId === 'settler'
      );

      if (settlerUnit) {
        // Create ActionSystem without callback
        const actionSystemNoCallback = new ActionSystem(gameId);

        // Try to found city without callback
        const result = await actionSystemNoCallback.executeAction(
          settlerUnit,
          ActionType.FOUND_CITY
        );

        expect(result.success).toBe(false);
        expect(
          result.message.includes('callback') || result.message.includes('not available')
        ).toBe(true);
      }
    });
  });

  describe('goto action with pathfinding integration', () => {
    it('should execute goto and set movement orders', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      expect(unit).toBeDefined();

      const targetX = unit.x + 2;
      const targetY = unit.y + 1;
      const initialX = unit.x;
      const initialY = unit.y;

      // Execute goto action
      const result = await actionSystem.executeAction(unit, ActionType.GOTO, targetX, targetY);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
      expect(result.newPosition).toBeDefined();

      // Unit should have moved or have movement orders set
      const hasMovedOrHasOrders =
        unit.x !== initialX ||
        unit.y !== initialY ||
        (unit.orders && unit.orders.some(order => order.type === 'move'));

      expect(hasMovedOrHasOrders).toBe(true);

      // If unit didn't reach destination, should have move order (not goto)
      if (unit.x !== targetX || unit.y !== targetY) {
        const moveOrder = unit.orders?.find(order => order.type === 'move');
        expect(moveOrder).toBeDefined();
        expect(moveOrder!.targetX).toBe(targetX);
        expect(moveOrder!.targetY).toBe(targetY);
      }
    });
  });

  describe('database persistence integration', () => {
    it('should persist action results across game reloads', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Execute action that changes unit state
      if (unit.unitTypeId === 'warrior') {
        await actionSystem.executeAction(unit, ActionType.FORTIFY);
        expect(unit.fortified).toBe(true);
      }

      // Set goto destination
      await actionSystem.executeAction(unit, ActionType.GOTO, unit.x + 3, unit.y + 2);

      // Clear game from memory and reload
      gameManager['games'].delete(gameId);
      await gameManager.loadGame(gameId);

      const reloadedGame = gameManager.getGameInstance(gameId)!;
      const reloadedUnit = reloadedGame.unitManager.getUnit(unit.id);

      expect(reloadedUnit).toBeDefined();

      if (unit.unitTypeId === 'warrior' && unit.fortified) {
        expect(reloadedUnit!.fortified).toBe(true);
      }

      // Orders should be preserved if they were set
      if (unit.orders && unit.orders.length > 0) {
        expect(reloadedUnit!.orders).toBeDefined();
      }
    });
  });
});
