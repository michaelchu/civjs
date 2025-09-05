import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '../../src/game/constants/UnitConstants';
import {
  getTestDatabase,
  getTestDatabaseProvider,
  clearAllTables,
  createTestGameAndPlayer,
  generateTestUUID,
} from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import * as schema from '../../src/database/schema';

describe('UnitManager - Integration Tests with Real Database', () => {
  let unitManager: UnitManager;
  let testData: { game: any; player: any; user: any };
  const mapWidth = 80;
  const mapHeight = 50;

  beforeEach(async () => {
    // Clear database before each test FIRST
    await clearAllTables();

    // Then create test game and player with proper UUIDs
    testData = await createTestGameAndPlayer('0010', '0020');

    // Initialize UnitManager with the test game ID and mock dependencies
    const mockMapManager = {
      getTileAt: () => ({ terrain: 'grassland' }),
      getTerrainMovementCost: () => 1,
    };

    const mockGameManagerCallback = {
      foundCity: async () => 'test-city-id',
      requestPath: async () => ({ success: true }),
      broadcastUnitMoved: () => {},
      getCityAt: () => null,
    };

    // Initialize UnitManager with test database provider
    const testDbProvider = getTestDatabaseProvider();
    unitManager = new UnitManager(
      testData.game.id,
      testDbProvider,
      mapWidth,
      mapHeight,
      mockMapManager,
      mockGameManagerCallback
    );
  });

  afterEach(async () => {
    // Database cleanup is handled by global test setup
    // No UnitManager cleanup needed for integration tests
  });

  describe('unit types validation', () => {
    it('should have valid unit type definitions', () => {
      expect(UNIT_TYPES.warrior).toBeDefined();
      expect(UNIT_TYPES.warrior.name).toBe('Warrior');
      expect(UNIT_TYPES.warrior.movement).toBe(6); // 2 movement points = 6 fragments
      expect(UNIT_TYPES.warrior.combat).toBe(20);

      expect(UNIT_TYPES.settler).toBeDefined();
      expect(UNIT_TYPES.settler.canFoundCity).toBe(true);
      expect(UNIT_TYPES.settler.combat).toBe(0);

      expect(UNIT_TYPES.worker).toBeDefined();
      expect(UNIT_TYPES.worker.canBuildImprovements).toBe(true);
    });
  });

  describe('unit creation with real database persistence', () => {
    it('should create and persist units to database', async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warrior', 10, 10);

      // Verify unit in memory
      expect(unit.playerId).toBe(testData.player.id);
      expect(unit.unitTypeId).toBe('warrior');
      expect(unit.x).toBe(10);
      expect(unit.y).toBe(10);
      expect(unit.health).toBe(100);
      expect(unit.movementLeft).toBe(6); // Warrior movement in fragments
      expect(unit.veteranLevel).toBe(0);
      expect(unit.fortified).toBe(false);

      // Verify unit was persisted to database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });

      expect(dbUnits).toHaveLength(1);
      expect(dbUnits[0].playerId).toBe(testData.player.id);
      expect(dbUnits[0].unitType).toBe('warrior');
      expect(dbUnits[0].x).toBe(10);
      expect(dbUnits[0].y).toBe(10);
      expect(dbUnits[0].health).toBe(100);
      expect(dbUnits[0].movementPoints).toBe('6.00'); // Stored as decimal string
      expect(dbUnits[0].veteranLevel).toBe(0);
      expect(dbUnits[0].isFortified).toBe(false);
    });

    it('should reject invalid unit type with database constraint', async () => {
      await expect(
        unitManager.createUnit(testData.player.id, 'invalid-unit', 10, 10)
      ).rejects.toThrow('Unknown unit type: invalid-unit');

      // Verify no unit was created in database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(dbUnits).toHaveLength(0);
    });

    it('should reject invalid positions', async () => {
      await expect(unitManager.createUnit(testData.player.id, 'warrior', -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );

      await expect(
        unitManager.createUnit(testData.player.id, 'warrior', mapWidth + 1, 10)
      ).rejects.toThrow('Invalid position: 81, 10');

      // Verify no units were created
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(dbUnits).toHaveLength(0);
    });

    it('should prevent stacking civilian units', async () => {
      // Create first civilian unit
      await unitManager.createUnit(testData.player.id, 'settler', 10, 10);

      // Try to create another civilian at same position (should fail)
      await expect(unitManager.createUnit(testData.player.id, 'worker', 10, 10)).rejects.toThrow(
        'Cannot stack civilian units'
      );

      // Verify only one unit exists in database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(dbUnits).toHaveLength(1);
      expect(dbUnits[0].unitType).toBe('settler');
    });
  });

  describe('unit movement with real terrain costs', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warrior', 10, 10);
      unitId = unit.id;
    });

    it('should move unit and persist position changes', async () => {
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(3); // Used 3 fragments for plains terrain
      expect(unit!.fortified).toBe(false);

      // Verify position was persisted to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(11);
      expect(dbUnit.y).toBe(10);
      expect(dbUnit.movementPoints).toBe('3.00'); // 3 fragments remaining
      expect(dbUnit.isFortified).toBe(false);
    });

    it('should reject moves with insufficient movement points', async () => {
      // Use up movement points with multiple moves
      await unitManager.moveUnit(unitId, 11, 10); // 3 fragments left
      await unitManager.moveUnit(unitId, 12, 10); // 0 fragments left

      // Should fail on third move
      await expect(unitManager.moveUnit(unitId, 13, 10)).rejects.toThrow(
        'Not enough movement points'
      );

      // Verify unit stayed at position 12,10 in database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(12);
      expect(dbUnit.y).toBe(10);
      expect(dbUnit.movementPoints).toBe('0.00');
    });

    it('should prevent moves to enemy unit positions', async () => {
      // Create enemy player first
      const enemyData = await createTestGameAndPlayer('0011', '0456');

      // Create enemy unit
      const enemyUnit = await unitManager.createUnit(enemyData.player.id, 'warrior', 11, 10);

      await expect(unitManager.moveUnit(unitId, 11, 10)).rejects.toThrow(
        'Cannot move to tile occupied by enemy unit'
      );

      // Verify unit didn't move in database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(10);
      expect(dbUnit.y).toBe(10);

      // Verify enemy unit is still there
      const [dbEnemyUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, enemyUnit.id),
      });
      expect(dbEnemyUnit.x).toBe(11);
      expect(dbEnemyUnit.y).toBe(10);
    });
  });

  describe('unit combat with realistic damage calculation', () => {
    let attackerUnitId: string;
    let defenderUnitId: string;

    beforeEach(async () => {
      const attacker = await unitManager.createUnit(testData.player.id, 'warrior', 10, 10);

      // Create enemy player first
      const enemyData = await createTestGameAndPlayer('0012', '0457');
      const defender = await unitManager.createUnit(enemyData.player.id, 'warrior', 11, 10);
      attackerUnitId = attacker.id;
      defenderUnitId = defender.id;
    });

    it('should conduct combat and persist health changes', async () => {
      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      expect(result.attackerId).toBe(attackerUnitId);
      expect(result.defenderId).toBe(defenderUnitId);
      expect(result.attackerDamage).toBeGreaterThan(0);
      expect(result.defenderDamage).toBeGreaterThan(0);

      const attacker = unitManager.getUnit(attackerUnitId);
      expect(attacker!.movementLeft).toBe(0); // Attack uses all movement

      // Verify health changes were persisted
      const db = getTestDatabase();
      const [dbAttacker] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, attackerUnitId),
      });
      const [dbDefender] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, defenderUnitId),
      });

      expect(dbAttacker.health).toBe(attacker!.health);
      expect(dbDefender.health).toBeLessThan(100);
      expect(dbAttacker.movementPoints).toBe('0.00');
    });

    it('should handle unit destruction and database cleanup', async () => {
      const attacker = unitManager.getUnit(attackerUnitId)!;
      const defender = unitManager.getUnit(defenderUnitId)!;

      // Set low health to ensure destruction
      attacker.health = 10;
      defender.health = 10;

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      // At least one unit should be destroyed
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);

      // Verify destruction was persisted to database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });

      if (result.attackerDestroyed && result.defenderDestroyed) {
        expect(dbUnits).toHaveLength(0);
      } else {
        expect(dbUnits).toHaveLength(1);
        const survivingUnit = dbUnits[0];
        expect(survivingUnit.health).toBeGreaterThan(0);
      }
    });
  });

  describe('unit loading from database', () => {
    it('should load existing units from database correctly', async () => {
      const scenario = await createBasicGameScenario();

      // Create new unit manager instance
      const testDbProvider = getTestDatabaseProvider();
      const mockMapManager = {
        getTileAt: () => ({ terrain: 'grassland' }),
        getTerrainMovementCost: () => 1,
      };

      const mockGameManagerCallback = {
        foundCity: async () => 'test-city-id',
        requestPath: async () => ({ success: true }),
        broadcastUnitMoved: () => {},
        getCityAt: () => null,
      };

      const newUnitManager = new UnitManager(
        scenario.game.id,
        testDbProvider,
        mapWidth,
        mapHeight,
        mockMapManager,
        mockGameManagerCallback
      );

      // Load units from database
      await newUnitManager.loadUnits();

      // Verify all units were loaded
      const units = scenario.units;
      for (const unitData of units) {
        const unit = newUnitManager.getUnit(unitData.id);
        expect(unit).toBeDefined();
        expect(unit!.unitTypeId).toBe(unitData.unitType);
        expect(unit!.x).toBe(unitData.x);
        expect(unit!.y).toBe(unitData.y);
        expect(unit!.health).toBe(unitData.health);
        expect(unit!.movementLeft).toBe(parseFloat(unitData.movementPoints));
      }

      // No cleanup needed for integration tests
    });

    it('should handle corrupted unit data gracefully', async () => {
      // Insert corrupted data directly into database
      const db = getTestDatabase();
      // Create a valid UUID for the test
      const corruptUnitId = generateTestUUID('9999');

      // Use existing test data instead of creating new records
      await db.insert(schema.units).values({
        id: corruptUnitId,
        gameId: testData.game.id,
        playerId: testData.player.id,
        unitType: 'warrior',
        x: 5,
        y: 5,
        health: 100,
        attackStrength: 20,
        defenseStrength: 20,
        movementPoints: '999.99', // Invalid high value - test graceful parsing
        maxMovementPoints: '6',
        veteranLevel: 0,
        isFortified: false,
        createdTurn: 1,
      });

      // Should handle invalid data gracefully
      await unitManager.loadUnits();

      const unit = unitManager.getUnit(corruptUnitId);
      expect(unit).toBeDefined();
      expect(unit!.movementLeft).toBeLessThanOrEqual(6); // Should be handled gracefully
    });
  });

  describe('turn management with real persistence', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warrior', 10, 10);
      unitId = unit.id;
      // Use some movement
      await unitManager.moveUnit(unitId, 11, 10);
    });

    it('should reset movement and persist changes', async () => {
      await unitManager.resetMovement(testData.player.id);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.movementLeft).toBe(6); // Reset to warrior's full movement

      // Verify movement was persisted
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.movementPoints).toBe('6.00');
    });

    it('should heal fortified units and persist health', async () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 80;
      unit.fortified = true;

      await unitManager.resetMovement(testData.player.id);

      expect(unit.health).toBe(90); // Healed 10 points

      // Verify health was persisted
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.health).toBe(90);
    });
  });

  describe('visibility and fog of war', () => {
    let scenario: any;
    let scenarioUnitManager: UnitManager;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      // Create UnitManager with the scenario's game ID and mock dependencies
      const mockMapManager = {
        getTileAt: () => ({ terrain: 'grassland' }),
        getTerrainMovementCost: () => 1,
      };

      const mockGameManagerCallback = {
        foundCity: async () => 'test-city-id',
        requestPath: async () => ({ success: true }),
        broadcastUnitMoved: () => {},
        getCityAt: () => null,
      };

      const testDbProvider = getTestDatabaseProvider();
      scenarioUnitManager = new UnitManager(
        scenario.game.id,
        testDbProvider,
        mapWidth,
        mapHeight,
        mockMapManager,
        mockGameManagerCallback
      );
      await scenarioUnitManager.loadUnits();
    });

    it('should return visible units based on real game state', () => {
      const visibleTiles = new Set(['11,11', '16,15', '9,10']);
      const player1Id = scenario.players[0].id;

      const visibleUnits = scenarioUnitManager.getVisibleUnits(player1Id, visibleTiles);

      // Should see own units + enemy units in visible range
      expect(visibleUnits.length).toBeGreaterThan(0);

      const ownUnits = visibleUnits.filter(u => u.playerId === player1Id);
      const enemyUnits = visibleUnits.filter(u => u.playerId === scenario.players[1].id);

      // Should always see own units
      expect(ownUnits.length).toBeGreaterThan(0);

      // Enemy units only if in visible tiles
      for (const unit of enemyUnits) {
        expect(visibleTiles.has(`${unit.x},${unit.y}`)).toBe(true);
      }
    });
  });

  describe('unit queries with real data', () => {
    let scenario: any;

    beforeEach(async () => {
      // Clear previous test data
      await clearAllTables();

      // Create a fresh scenario and reinitialize the UnitManager with the correct game ID
      scenario = await createBasicGameScenario();

      const mockMapManager = {
        getTileAt: () => ({ terrain: 'grassland' }),
        getTerrainMovementCost: () => 1,
      };

      const mockGameManagerCallback = {
        foundCity: async () => 'test-city-id',
        requestPath: async () => ({ success: true }),
        broadcastUnitMoved: () => {},
        getCityAt: () => null,
      };

      const testDbProvider = getTestDatabaseProvider();
      unitManager = new UnitManager(
        scenario.game.id,
        testDbProvider,
        mapWidth,
        mapHeight,
        mockMapManager,
        mockGameManagerCallback
      );
      await unitManager.loadUnits();
    });

    it('should get player units correctly', () => {
      const player1Id = scenario.players[0].id;
      const player2Id = scenario.players[1].id;
      const player1Units = unitManager.getPlayerUnits(player1Id);
      const player2Units = unitManager.getPlayerUnits(player2Id);

      expect(player1Units.length).toBeGreaterThan(0);
      expect(player2Units.length).toBeGreaterThan(0);

      expect(player1Units.every(u => u.playerId === player1Id)).toBe(true);
      expect(player2Units.every(u => u.playerId === player2Id)).toBe(true);
    });

    it('should find units at specific positions', () => {
      const unitAt11_11 = unitManager.getUnitAt(11, 11);
      const unitAt16_15 = unitManager.getUnitAt(16, 15);
      const noUnit = unitManager.getUnitAt(50, 50);

      expect(unitAt11_11).toBeDefined();
      expect(unitAt16_15).toBeDefined();
      expect(noUnit).toBeUndefined();
    });
  });
});
