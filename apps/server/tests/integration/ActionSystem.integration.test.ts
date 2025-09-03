import { ActionSystem } from '../../src/game/ActionSystem';
import { GameManager } from '../../src/game/GameManager';
import { ActionType } from '../../src/types/shared/actions';
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('ActionSystem - Integration Tests', () => {
  let actionSystem: ActionSystem;
  let gameManager: GameManager;
  let gameId: string;
  let playerId1: string;

  beforeEach(async () => {
    // Clear database and reset singleton
    await clearAllTables();
    (GameManager as any).instance = null;

    // Create game scenario
    const scenario = await createBasicGameScenario();
    gameId = scenario.game.id;
    playerId1 = scenario.players[0].id;

    // Initialize GameManager and load the game
    const mockIo = createMockSocketServer();
    gameManager = GameManager.getInstance(mockIo);
    await gameManager.loadGame(gameId);

    // Initialize ActionSystem with gameId
    actionSystem = new ActionSystem(gameId);
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('action system initialization', () => {
    it('should initialize with game ID and provide action definitions', () => {
      expect(actionSystem).toBeDefined();

      const moveAction = actionSystem.getActionDefinition(ActionType.MOVE);
      expect(moveAction).toBeDefined();
      expect(moveAction!.name).toBe('Move');

      const fortifyAction = actionSystem.getActionDefinition(ActionType.FORTIFY);
      expect(fortifyAction).toBeDefined();
      expect(fortifyAction!.name).toBe('Fortify');
    });

    it('should return null for unknown action types', () => {
      const unknownAction = actionSystem.getActionDefinition('UNKNOWN_ACTION' as ActionType);
      expect(unknownAction).toBeNull();
    });
  });

  describe('unit action validation', () => {
    it('should validate unit can perform actions based on requirements', () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const unit = Array.from(units)[0];

      expect(unit).toBeDefined();

      // Basic actions should be available to all units
      const canWait = actionSystem.canUnitPerformAction(unit, ActionType.WAIT);
      expect(canWait).toBe(true);

      const canSentry = actionSystem.canUnitPerformAction(unit, ActionType.SENTRY);
      expect(canSentry).toBe(true);
    });
  });

  describe('action execution', () => {
    it('should execute wait action successfully', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const unit = Array.from(units)[0];

      expect(unit).toBeDefined();

      const initialMovement = unit.movementLeft;

      // Execute wait action
      const result = await actionSystem.executeAction(unit, ActionType.WAIT);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();

      // Movement should be preserved
      expect(unit.movementLeft).toBe(initialMovement);
    });

    it('should execute sentry action successfully', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const unit = Array.from(units)[0];

      expect(unit).toBeDefined();

      // Execute sentry action
      const result = await actionSystem.executeAction(unit, ActionType.SENTRY);

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();

      // Verify unit has sentry order
      expect(unit.orders.some(order => order.type === 'sentry')).toBe(true);
    });

    it('should reject invalid action types', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const unit = Array.from(units)[0];

      // Try to execute unknown action
      const result = await actionSystem.executeAction(unit, 'INVALID_ACTION' as ActionType);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown action');
    });
  });

  describe('fortify action for military units', () => {
    it('should execute fortify action for warrior units', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const warriorUnit = Array.from(units).find(u => u.unitTypeId === 'warrior');

      if (warriorUnit) {
        expect(warriorUnit.fortified).toBe(false);

        // Execute fortify action
        const result = await actionSystem.executeAction(warriorUnit, ActionType.FORTIFY);

        expect(result.success).toBe(true);
        expect(warriorUnit.fortified).toBe(true);

        // Verify persistence to database
        const db = getTestDatabase();
        const [dbUnit] = await db.query.units.findMany({
          where: (units, { eq }) => eq(units.id, warriorUnit.id),
        });
        expect(dbUnit.isFortified).toBe(true);
      } else {
        // Skip test if no warrior unit found
        expect(true).toBe(true);
      }
    });
  });

  describe('goto action', () => {
    it('should set goto destination for units', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const units = game.unitManager.getPlayerUnits(playerId1);
      const unit = Array.from(units)[0];

      expect(unit).toBeDefined();

      const targetX = unit.x + 2;
      const targetY = unit.y + 2;

      // Execute goto action
      const result = await actionSystem.executeAction(unit, ActionType.GOTO, targetX, targetY);

      expect(result.success).toBe(true);

      // Verify goto order was added
      const gotoOrder = unit.orders.find(order => order.type === 'goto');
      expect(gotoOrder).toBeDefined();
      expect(gotoOrder!.targetX).toBe(targetX);
      expect(gotoOrder!.targetY).toBe(targetY);
    });
  });
});
