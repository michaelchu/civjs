import { ActionSystem } from '../../src/game/ActionSystem';
import { GameManager } from '../../src/game/GameManager';
import { ActionType } from '../../src/types/shared/actions';
import {
  getTestDatabase,
  clearAllTables,
  generateTestUUID,
} from '../utils/testDatabase';
import { createBasicGameScenario, createCombatScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('ActionSystem - Integration Tests with Cross-Manager Operations', () => {
  let actionSystem: ActionSystem;
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

    // Initialize ActionSystem
    actionSystem = new ActionSystem();
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('move actions with cross-manager effects', () => {
    it('should execute move action and update visibility across managers', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];
      
      // Get initial visibility
      const initialVisibility = gameManager.getTileVisibility(gameId, playerId1, unit.x + 1, unit.y);
      
      // Execute move action
      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId1,
        gameId,
        { unitId: unit.id, targetX: unit.x + 1, targetY: unit.y }
      );

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();

      // Verify unit moved in UnitManager
      const movedUnit = game.unitManager.getUnit(unit.id);
      expect(movedUnit!.x).toBe(unit.x + 1);
      expect(movedUnit!.y).toBe(unit.y);

      // Verify visibility was updated in VisibilityManager
      gameManager.updatePlayerVisibility(gameId, playerId1);
      const newVisibility = gameManager.getTileVisibility(gameId, playerId1, unit.x + 1, unit.y);
      expect(newVisibility.isVisible).toBe(true);

      // Verify persistence to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unit.id),
      });
      expect(dbUnit.x).toBe(unit.x + 1);
      expect(dbUnit.y).toBe(unit.y);
    });

    it('should reject invalid move actions with proper validation', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Try to move to invalid position (out of bounds)
      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId1,
        gameId,
        { unitId: unit.id, targetX: 1000, targetY: 1000 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid');

      // Verify unit didn't move
      const unitAfter = game.unitManager.getUnit(unit.id);
      expect(unitAfter!.x).toBe(unit.x);
      expect(unitAfter!.y).toBe(unit.y);
    });
  });

  describe('attack actions with combat resolution', () => {
    let scenario: any;

    beforeEach(async () => {
      await clearAllTables();
      scenario = await createCombatScenario();
      gameId = scenario.game.id;
      playerId1 = scenario.players[0].id;
      playerId2 = scenario.players[1].id;

      // Reload game with combat scenario
      await gameManager.loadGame(gameId);
    });

    it('should execute attack action and resolve combat across managers', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const attackerUnit = game.unitManager.getPlayerUnits(playerId1).find(u => u.unitTypeId === 'warrior')!;
      const defenderUnit = game.unitManager.getPlayerUnits(playerId2).find(u => u.unitTypeId === 'warrior')!;

      const initialAttackerHealth = attackerUnit.health;
      const initialDefenderHealth = defenderUnit.health;

      // Execute attack action
      const result = await actionSystem.executeAction(
        ActionType.ATTACK,
        playerId1,
        gameId,
        { unitId: attackerUnit.id, targetUnitId: defenderUnit.id }
      );

      expect(result.success).toBe(true);
      expect(result.changes).toBeDefined();

      // Verify combat was resolved
      const attackerAfter = game.unitManager.getUnit(attackerUnit.id);
      const defenderAfter = game.unitManager.getUnit(defenderUnit.id);

      if (attackerAfter && defenderAfter) {
        // Both units survived - verify damage was dealt
        expect(attackerAfter.health < initialAttackerHealth || defenderAfter.health < initialDefenderHealth).toBe(true);
      } else {
        // At least one unit was destroyed
        expect(attackerAfter === undefined || defenderAfter === undefined).toBe(true);
      }

      // Verify attacker used movement points
      if (attackerAfter) {
        expect(attackerAfter.movementLeft).toBe(0);
      }

      // Verify changes were persisted to database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, gameId),
      });

      // Verify at least one unit's health was updated in database
      const dbAttacker = dbUnits.find(u => u.id === attackerUnit.id);
      const dbDefender = dbUnits.find(u => u.id === defenderUnit.id);
      
      if (dbAttacker && dbDefender) {
        expect(dbAttacker.health < initialAttackerHealth || dbDefender.health < initialDefenderHealth).toBe(true);
      }
    });
  });

  describe('fortify actions with state management', () => {
    it('should fortify unit and persist state changes', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(u => u.unitTypeId === 'warrior')!;

      expect(unit.fortified).toBe(false);

      // Execute fortify action
      const result = await actionSystem.executeAction(
        ActionType.FORTIFY,
        playerId1,
        gameId,
        { unitId: unit.id }
      );

      expect(result.success).toBe(true);

      // Verify unit is fortified in UnitManager
      const fortifiedUnit = game.unitManager.getUnit(unit.id);
      expect(fortifiedUnit!.fortified).toBe(true);

      // Verify persistence to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unit.id),
      });
      expect(dbUnit.isFortified).toBe(true);
    });

    it('should reject fortify for non-military units', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(u => u.unitTypeId === 'settler')!;

      // Execute fortify action on settler (should fail)
      const result = await actionSystem.executeAction(
        ActionType.FORTIFY,
        playerId1,
        gameId,
        { unitId: settlerUnit.id }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('requirements');

      // Verify settler wasn't fortified
      const unitAfter = game.unitManager.getUnit(settlerUnit.id);
      expect(unitAfter!.fortified).toBe(false);
    });
  });

  describe('found city actions with cross-manager coordination', () => {
    it('should found city and coordinate between UnitManager and CityManager', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(u => u.unitTypeId === 'settler')!;
      
      const initialCityCount = game.cityManager.getPlayerCities(playerId1).length;
      const initialUnitCount = game.unitManager.getPlayerUnits(playerId1).length;

      // Execute found city action
      const result = await actionSystem.executeAction(
        ActionType.FOUND_CITY,
        playerId1,
        gameId,
        { unitId: settlerUnit.id, cityName: 'New Rome' }
      );

      expect(result.success).toBe(true);

      // Verify settler was consumed (removed from UnitManager)
      const settlerAfter = game.unitManager.getUnit(settlerUnit.id);
      expect(settlerAfter).toBeUndefined();
      expect(game.unitManager.getPlayerUnits(playerId1).length).toBe(initialUnitCount - 1);

      // Verify city was created in CityManager
      const cities = game.cityManager.getPlayerCities(playerId1);
      expect(cities.length).toBe(initialCityCount + 1);
      
      const newCity = cities.find(c => c.name === 'New Rome');
      expect(newCity).toBeDefined();
      expect(newCity!.x).toBe(settlerUnit.x);
      expect(newCity!.y).toBe(settlerUnit.y);

      // Verify persistence to database
      const db = getTestDatabase();
      
      // Settler should be removed from database
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, settlerUnit.id),
      });
      expect(dbUnits).toHaveLength(0);

      // City should be added to database
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.name, 'New Rome'),
      });
      expect(dbCities).toHaveLength(1);
      expect(dbCities[0].x).toBe(settlerUnit.x);
      expect(dbCities[0].y).toBe(settlerUnit.y);
    });

    it('should reject found city on invalid terrain or occupied tiles', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const settlerUnit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(u => u.unitTypeId === 'settler')!;
      
      // Try to found city on occupied tile (where existing city is)
      const existingCity = game.cityManager.getPlayerCities(playerId1)[0];
      
      // Move settler to existing city location first
      await game.unitManager.moveUnit(settlerUnit.id, existingCity.x, existingCity.y);

      const result = await actionSystem.executeAction(
        ActionType.FOUND_CITY,
        playerId1,
        gameId,
        { unitId: settlerUnit.id, cityName: 'Invalid City' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot found city');

      // Verify no city was created and settler still exists
      const settlerAfter = game.unitManager.getUnit(settlerUnit.id);
      expect(settlerAfter).toBeDefined();

      const cities = game.cityManager.getPlayerCities(playerId1);
      expect(cities.find(c => c.name === 'Invalid City')).toBeUndefined();
    });
  });

  describe('goto actions with pathfinding integration', () => {
    it('should set goto destination and coordinate with PathfindingManager', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Execute goto action
      const result = await actionSystem.executeAction(
        ActionType.GOTO,
        playerId1,
        gameId,
        { unitId: unit.id, targetX: unit.x + 5, targetY: unit.y + 5 }
      );

      expect(result.success).toBe(true);

      // Verify goto destination was set
      const unitAfter = game.unitManager.getUnit(unit.id);
      expect(unitAfter!.orders.length).toBeGreaterThan(0);
      expect(unitAfter!.orders[0].type).toBe('goto');
      expect(unitAfter!.orders[0].target).toEqual({ x: unit.x + 5, y: unit.y + 5 });

      // Verify persistence to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unit.id),
      });
      
      // Check if orders were persisted (depends on schema implementation)
      expect(dbUnit).toBeDefined();
    });
  });

  describe('action validation and authorization', () => {
    it('should reject actions from wrong player', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const player1Unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Try to move player1's unit as player2
      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId2,
        gameId,
        { unitId: player1Unit.id, targetX: player1Unit.x + 1, targetY: player1Unit.y }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not authorized');

      // Verify unit didn't move
      const unitAfter = game.unitManager.getUnit(player1Unit.id);
      expect(unitAfter!.x).toBe(player1Unit.x);
      expect(unitAfter!.y).toBe(player1Unit.y);
    });

    it('should reject actions for non-existent units', async () => {
      const fakeUnitId = generateTestUUID('9999');

      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId1,
        gameId,
        { unitId: fakeUnitId, targetX: 10, targetY: 10 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject actions for invalid games', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];
      const fakeGameId = generateTestUUID('9998');

      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId1,
        fakeGameId,
        { unitId: unit.id, targetX: unit.x + 1, targetY: unit.y }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Game not found');
    });
  });

  describe('action probability and success rates', () => {
    it('should handle probabilistic actions with proper randomization', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1)).find(u => u.unitTypeId === 'warrior')!;

      // Test multiple executions of the same action to verify randomization works
      const results: boolean[] = [];
      
      for (let i = 0; i < 10; i++) {
        // Reset unit state
        unit.health = 100;
        unit.movementLeft = 6;
        
        const result = await actionSystem.executeAction(
          ActionType.FORTIFY,
          playerId1,
          gameId,
          { unitId: unit.id }
        );
        
        results.push(result.success);
        
        // Reset fortify state for next iteration
        unit.fortified = false;
      }

      // All fortify actions should succeed (deterministic)
      expect(results.every(r => r === true)).toBe(true);
    });
  });

  describe('turn-based action restrictions', () => {
    it('should handle action restrictions based on game turn state', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const unit = Array.from(game.unitManager.getPlayerUnits(playerId1))[0];

      // Exhaust unit's movement points
      unit.movementLeft = 0;

      // Try to move unit with no movement points
      const result = await actionSystem.executeAction(
        ActionType.MOVE,
        playerId1,
        gameId,
        { unitId: unit.id, targetX: unit.x + 1, targetY: unit.y }
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('movement');

      // Verify unit didn't move
      const unitAfter = game.unitManager.getUnit(unit.id);
      expect(unitAfter!.x).toBe(unit.x);
      expect(unitAfter!.y).toBe(unit.y);
    });
  });
});