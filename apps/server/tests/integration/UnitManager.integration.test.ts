import { UnitManager } from '@game/managers/UnitManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { SINGLE_MOVE } from '@game/constants/MovementConstants';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import {
  getTestDatabase,
  getTestDatabaseProvider,
  clearAllTables,
  createTestGameAndPlayer,
  generateTestUUID,
} from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import * as schema from '@database/schema';
import { ActionType } from '@app-types/shared/actions';
import { eq } from 'drizzle-orm';

describe('UnitManager - Integration Tests with Real Database', () => {
  let unitManager: UnitManager;
  let testData: { game: any; player: any; user: any };
  const mapWidth = 80;
  const mapHeight = 50;

  beforeEach(async () => {
    // Clear database before each test FIRST
    await clearAllTables();

    // Then create test game and player with proper UUIDs
    testData = await createTestGameAndPlayer();

    // Initialize UnitManager with the test game ID and mock dependencies
    const mockMapManager = {
      getTile: () => ({ terrain: 'grassland', improvements: [] }),
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
      mockGameManagerCallback,
      new EffectsManager('civ2civ3')
    );
  });

  afterEach(async () => {
    // Database cleanup is handled by global test setup
    // No UnitManager cleanup needed for integration tests
  });

  describe('unit types validation', () => {
    it('should have valid unit type definitions', () => {
      expect(UNIT_TYPES.warriors).toBeDefined();
      expect(UNIT_TYPES.warriors.name).toBe('Warriors');
      expect(UNIT_TYPES.warriors.movement).toBe(1);
      expect(UNIT_TYPES.warriors.combat).toBe(1);

      expect(UNIT_TYPES.settlers).toBeDefined();
      expect(UNIT_TYPES.settlers.canFoundCity).toBe(true);
      expect(UNIT_TYPES.settlers.combat).toBe(0);

      expect(UNIT_TYPES.worker).toBeDefined();
      expect(UNIT_TYPES.worker.canBuildImprovements).toBe(true);
    });
  });

  describe('unit creation with real database persistence', () => {
    it('should create and persist units to database', async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warriors', 10, 10);

      // Verify unit in memory
      expect(unit.playerId).toBe(testData.player.id);
      expect(unit.unitTypeId).toBe('warriors');
      expect(unit.x).toBe(10);
      expect(unit.y).toBe(10);
      expect(unit.health).toBe(100);
      expect(unit.movementLeft).toBe(SINGLE_MOVE);
      expect(unit.veteranLevel).toBe(0);
      expect(unit.fortified).toBe(false);

      // Verify unit was persisted to database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });

      expect(dbUnits).toHaveLength(1);
      expect(dbUnits[0].playerId).toBe(testData.player.id);
      expect(dbUnits[0].unitType).toBe('warriors');
      expect(dbUnits[0].x).toBe(10);
      expect(dbUnits[0].y).toBe(10);
      expect(dbUnits[0].health).toBe(100);
      expect(Number(dbUnits[0].movementPoints)).toBe(SINGLE_MOVE);
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
      await expect(unitManager.createUnit(testData.player.id, 'warriors', -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );

      await expect(
        unitManager.createUnit(testData.player.id, 'warriors', mapWidth + 1, 10)
      ).rejects.toThrow('Invalid position: 81, 10');

      // Verify no units were created
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(dbUnits).toHaveLength(0);
    });

    it('should persist multiple civilian units on the same tile', async () => {
      // Create first civilian unit
      await unitManager.createUnit(testData.player.id, 'settlers', 10, 10);

      await unitManager.createUnit(testData.player.id, 'worker', 10, 10);

      // Verify only one unit exists in database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(dbUnits.map(unit => unit.unitType).sort()).toEqual(['settlers', 'worker']);
    });
  });

  describe('Civ2Civ3 unit actions', () => {
    it('does not invent a legacy upgrade chain for Warriors', async () => {
      const db = getTestDatabase();
      const [city] = await db
        .insert(schema.cities)
        .values({
          gameId: testData.game.id,
          playerId: testData.player.id,
          name: 'Upgrade City',
          x: 10,
          y: 10,
          foundedTurn: 1,
        })
        .returning();
      await db
        .update(schema.players)
        .set({ gold: 1000 })
        .where(eq(schema.players.id, testData.player.id));
      unitManager = new UnitManager(
        testData.game.id,
        getTestDatabaseProvider(),
        mapWidth,
        mapHeight,
        { getTile: () => ({ terrain: 'grassland', improvements: [] }) },
        {
          foundCity: async () => city.id,
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => {},
          getCityAt: () => ({ id: city.id, playerId: testData.player.id }),
        }
      );
      unitManager.setPlayerTechsProvider(() => new Set(['feudalism']));
      const unit = await unitManager.createUnit(testData.player.id, 'warriors', 10, 10, city.id);

      await expect(
        unitManager.executeUnitAction(
          unit.id,
          ActionType.UPGRADE_UNIT,
          undefined,
          undefined,
          testData.player.id
        )
      ).resolves.toMatchObject({
        success: false,
        message: 'Unit cannot be upgraded here',
      });

      const [persisted] = await db.select().from(schema.units).where(eq(schema.units.id, unit.id));
      const [player] = await db
        .select()
        .from(schema.players)
        .where(eq(schema.players.id, testData.player.id));
      // @reference reference/freeciv/data/civ2civ3/units.ruleset:333-348
      // C2C3 Warriors do not declare an obsoleted_by upgrade target.
      expect(persisted.unitType).toBe('warriors');
      expect(player.gold).toBe(1000);
    });
  });

  describe('unit movement with real terrain costs', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should move unit and persist position changes', async () => {
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(0);
      expect(unit!.fortified).toBe(false);

      // Verify position was persisted to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(11);
      expect(dbUnit.y).toBe(10);
      expect(dbUnit.movementPoints).toBe('0.00');
      expect(dbUnit.isFortified).toBe(false);
    });

    it('should reject moves with insufficient movement points', async () => {
      // Use up movement points with multiple moves
      await unitManager.moveUnit(unitId, 11, 10);

      await expect(unitManager.moveUnit(unitId, 12, 10)).rejects.toThrow(
        'Not enough movement points'
      );

      // Verify unit stayed at position 11,10 in database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(11);
      expect(dbUnit.y).toBe(10);
      expect(dbUnit.movementPoints).toBe('0.00');
    });

    it('should prevent moves to enemy unit positions', async () => {
      // Create enemy player first
      const enemyData = await createTestGameAndPlayer();

      // Create enemy unit
      const enemyUnit = await unitManager.createUnit(enemyData.player.id, 'warriors', 11, 10);

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
      const attacker = await unitManager.createUnit(testData.player.id, 'warriors', 10, 10);

      // Create enemy player first
      const enemyData = await createTestGameAndPlayer();
      const defender = await unitManager.createUnit(enemyData.player.id, 'warriors', 11, 10);
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
      if (result.attackerDestroyed) {
        expect(attacker).toBeUndefined();
      } else {
        expect(attacker?.movementLeft).toBe(0);
      }

      // Verify health changes were persisted
      const db = getTestDatabase();
      const [dbAttacker] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, attackerUnitId),
      });
      const [dbDefender] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, defenderUnitId),
      });

      if (result.attackerDestroyed) {
        expect(dbAttacker).toBeUndefined();
      } else {
        expect(dbAttacker.health).toBe(attacker!.health);
        expect(dbAttacker.movementPoints).toBe('0.00');
      }
      if (result.defenderDestroyed) {
        expect(dbDefender).toBeUndefined();
      } else {
        expect(dbDefender.health).toBeLessThan(100);
      }
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
        getTile: () => ({ terrain: 'grassland', improvements: [] }),
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
        expect(unit!.movementLeft).toBeLessThanOrEqual(parseFloat(unitData.movementPoints));
      }

      // No cleanup needed for integration tests
    });

    it('should handle corrupted unit data gracefully', async () => {
      // Insert corrupted data directly into database
      const db = getTestDatabase();
      // Create a valid UUID for the test
      const corruptUnitId = generateTestUUID();

      // Use existing test data instead of creating new records
      await db.insert(schema.units).values({
        id: corruptUnitId,
        gameId: testData.game.id,
        playerId: testData.player.id,
        unitType: 'warriors',
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

  describe('Milestone 15 consequence persistence', () => {
    it('removes every unit in a nuclear blast from the authoritative database', async () => {
      const tile = { terrain: 'grassland', improvements: [] as string[] };
      const mapData = { width: mapWidth, height: mapHeight, tiles: [], startingPositions: [] };
      unitManager = new UnitManager(
        testData.game.id,
        getTestDatabaseProvider(),
        mapWidth,
        mapHeight,
        {
          getTile: () => tile,
          updateTileProperty: (_x: number, _y: number, property: string, value: unknown) => {
            (tile as Record<string, unknown>)[property] = value;
          },
          getMapData: () => mapData,
        },
        {
          foundCity: async () => 'test-city-id',
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => {},
          applyNuclearCityDamage: async () => [],
        },
        new EffectsManager('civ2civ3'),
        () => 0
      );
      const nuclear = await unitManager.createUnit(testData.player.id, 'nuclear', 10, 10);
      await unitManager.createUnit(testData.player.id, 'warriors', 11, 10);

      await expect(
        unitManager.executeUnitAction(
          nuclear.id,
          ActionType.NUCLEAR_EXPLOSION,
          10,
          10,
          testData.player.id
        )
      ).resolves.toMatchObject({ success: true, unitDestroyed: true });

      const remaining = await getTestDatabase().query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, testData.game.id),
      });
      expect(remaining).toEqual([]);
    });
  });

  describe('turn management with real persistence', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit(testData.player.id, 'warriors', 10, 10);
      unitId = unit.id;
      // Use some movement
      await unitManager.moveUnit(unitId, 11, 10);
    });

    it('should reset movement and persist changes', async () => {
      await unitManager.resetMovement(testData.player.id);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.movementLeft).toBe(SINGLE_MOVE);

      // Verify movement was persisted
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(Number(dbUnit.movementPoints)).toBe(SINGLE_MOVE);
    });

    it('should heal fortified units and persist health', async () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 80;
      unit.fortified = true;

      await unitManager.resetMovement(testData.player.id);

      // C2C3 stacks 10 base regeneration with 10 fortified regeneration.
      expect(unit.health).toBe(100);

      // Verify health was persisted
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.health).toBe(100);
    });
  });

  describe('visibility and fog of war', () => {
    let scenario: any;
    let scenarioUnitManager: UnitManager;

    beforeEach(async () => {
      scenario = await createBasicGameScenario();
      // Create UnitManager with the scenario's game ID and mock dependencies
      const mockMapManager = {
        getTile: () => ({ terrain: 'grassland', improvements: [] }),
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
        getTile: () => ({ terrain: 'grassland', improvements: [] }),
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
