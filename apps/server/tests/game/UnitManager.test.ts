import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { EffectsManager } from '@game/managers/EffectsManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { ActionType } from '@app-types/shared/actions';

describe('UnitManager', () => {
  let unitManager: UnitManager;
  let mockDbProvider: ReturnType<typeof createMockDatabaseProvider>;
  const gameId = 'test-game-id';
  const mapWidth = 80;
  const mapHeight = 50;

  beforeEach(() => {
    mockDbProvider = createMockDatabaseProvider();
    unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight);
    jest.clearAllMocks();
  });

  describe('unit types', () => {
    it('should have valid unit type definitions', () => {
      expect(UNIT_TYPES.warriors).toBeDefined();
      expect(UNIT_TYPES.warriors.name).toBe('Warriors'); // From freeciv ruleset
      expect(UNIT_TYPES.warriors.movement).toBe(1); // Freeciv movement points (not fragments)
      expect(UNIT_TYPES.warriors.attack).toBe(1); // Freeciv attack value
      expect(UNIT_TYPES.warriors.cost).toBe(10); // Corrected freeciv cost

      expect(UNIT_TYPES.settlers).toBeDefined(); // 'settlers' not 'settler'
      expect(UNIT_TYPES.settlers.flags).toContain('Cities'); // Can found cities via flag
      expect(UNIT_TYPES.settlers.attack).toBe(0); // Non-combat unit

      expect(UNIT_TYPES.worker).toBeDefined();
      expect(UNIT_TYPES.worker.flags).toContain('Workers'); // Can build improvements via flag
    });
  });

  describe('unit creation', () => {
    it('records the authoritative turn when creating a unit', async () => {
      unitManager.setCurrentTurnProvider(() => 7);

      await unitManager.createUnit('player-123', 'warriors', 10, 10);

      expect(
        ((mockDbProvider.getDatabase() as any).values as jest.Mock).mock.calls[0][0]
      ).toMatchObject({
        createdTurn: 7,
      });
    });

    it('should create a unit successfully', async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      expect(unit.playerId).toBe('player-123');
      expect(unit.unitTypeId).toBe('warriors');
      expect(unit.x).toBe(10);
      expect(unit.y).toBe(10);
      expect(unit.health).toBe(100);
      expect(unit.movementLeft).toBe(3); // Warrior movement in fragments (1 * 3)
      expect(unit.veteranLevel).toBe(0);
      expect(unit.fortified).toBe(false);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should reject invalid unit type', async () => {
      await expect(unitManager.createUnit('player-123', 'invalid-unit', 10, 10)).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );
    });

    it('should reject invalid position', async () => {
      await expect(unitManager.createUnit('player-123', 'warriors', -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );

      await expect(unitManager.createUnit('player-123', 'warriors', 100, 10)).rejects.toThrow(
        'Invalid position: 100, 10'
      );
    });

    it('allows friendly unit stacks', async () => {
      await unitManager.createUnit('player-123', 'settlers', 10, 10);
      await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.getUnitsAt(10, 10)).toHaveLength(2);
    });
  });

  describe('worker activities', () => {
    const tile = {
      x: 10,
      y: 10,
      terrain: 'grassland',
      hasRoad: false,
      hasRailroad: false,
      improvements: [] as string[],
    };
    const mapManager = {
      getTile: jest.fn(() => tile),
      updateTileProperty: jest.fn((_x: number, _y: number, property: string, value: unknown) => {
        (tile as Record<string, unknown>)[property] = value;
      }),
    };

    beforeEach(() => {
      tile.terrain = 'grassland';
      tile.hasRoad = false;
      tile.hasRailroad = false;
      tile.improvements = [];
      mapManager.getTile.mockClear();
      mapManager.updateTileProperty.mockClear();
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, mapManager);
    });

    it('persists a multi-turn road order and mutates the map on completion', async () => {
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.BUILD_ROAD,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'road' }]);

      await unitManager.processUnitOrders('player-123');
      expect(tile.hasRoad).toBe(false);
      expect(worker.orders?.[0].activity?.turnsRemaining).toBe(1);

      await unitManager.processUnitOrders('player-123');
      expect(tile.hasRoad).toBe(true);
      expect(tile.improvements).toContain('road');
      expect(worker.orders).toEqual([]);
    });

    it('rejects acting on another player unit', async () => {
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.BUILD_ROAD,
          undefined,
          undefined,
          'player-456'
        )
      ).resolves.toMatchObject({
        success: false,
        message: expect.stringContaining('does not belong'),
      });
    });

    it('uses terrain-specific legality instead of a hardcoded terrain', async () => {
      tile.terrain = 'forest';
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(false);
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_ROAD)).toBe(true);
    });

    it('completes a queued pillage activity and removes the authoritative extra', async () => {
      tile.hasRoad = true;
      tile.improvements = ['road'];
      const worker = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.PILLAGE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      await unitManager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(false);
      expect(tile.improvements).not.toContain('road');
      expect(worker.orders).toEqual([]);
    });
  });

  describe('unit movement', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should move unit successfully', async () => {
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(0); // Used 1 movement point for basic terrain
      expect(unit!.fortified).toBe(false);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should reject move with insufficient movement', async () => {
      // Use up movement point (warrior has only 1 movement in freeciv)
      await unitManager.moveUnit(unitId, 11, 10);

      // Should fail on second move - no movement left
      await expect(unitManager.moveUnit(unitId, 12, 10)).rejects.toThrow(
        'Not enough movement points'
      );
    });

    it('should reject move to invalid position', async () => {
      await expect(unitManager.moveUnit(unitId, -1, 10)).rejects.toThrow(
        'Invalid position: -1, 10'
      );
    });

    it('should reject move to enemy unit position', async () => {
      // Create enemy unit
      await unitManager.createUnit('player-456', 'warriors', 11, 10);

      await expect(unitManager.moveUnit(unitId, 11, 10)).rejects.toThrow(
        'Cannot move to tile occupied by enemy unit'
      );
    });

    it('rejects non-adjacent direct moves', async () => {
      await expect(unitManager.moveUnit(unitId, 12, 10)).rejects.toThrow(
        'only move to an adjacent tile'
      );
    });
  });

  describe('terrain movement, ZOC, and transports', () => {
    const terrain = new Map<string, string>();
    const roads = new Set<string>();
    const railroads = new Set<string>();
    const mapManager = {
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: terrain.get(`${x},${y}`) ?? 'grassland',
        hasRoad: roads.has(`${x},${y}`),
        hasRailroad: railroads.has(`${x},${y}`),
        improvements: [],
      })),
    };

    beforeEach(() => {
      terrain.clear();
      roads.clear();
      railroads.clear();
      mapManager.getTile.mockClear();
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, mapManager);
    });

    it('enforces loaded land and sea terrain classes', async () => {
      terrain.set('10,10', 'grassland');
      terrain.set('11,10', 'ocean');
      const warrior = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await expect(unitManager.moveUnit(warrior.id, 11, 10)).rejects.toThrow(
        'cannot enter terrain'
      );

      terrain.set('20,20', 'ocean');
      terrain.set('21,20', 'grassland');
      const trireme = await unitManager.createUnit('player-123', 'trireme', 20, 20);
      await expect(unitManager.moveUnit(trireme.id, 21, 20)).rejects.toThrow(
        'cannot enter terrain'
      );

      terrain.set('21,20', 'deep_ocean');
      await expect(unitManager.moveUnit(trireme.id, 21, 20)).rejects.toThrow(
        'cannot enter terrain'
      );
    });

    it('uses classic road and railroad fragment costs', async () => {
      roads.add('10,10');
      roads.add('11,10');
      const roadUnit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.moveUnit(roadUnit.id, 11, 10);
      expect(roadUnit.movementLeft).toBe(2);

      railroads.add('20,20');
      railroads.add('21,20');
      const railUnit = await unitManager.createUnit('player-123', 'warriors', 20, 20);
      await unitManager.moveUnit(railUnit.id, 21, 20);
      expect(railUnit.movementLeft).toBe(3);
    });

    it('blocks a ground step between two enemy zones of control', async () => {
      const mover = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-456', 'warriors', 9, 10);
      await unitManager.createUnit('player-456', 'warriors', 12, 10);

      await expect(unitManager.moveUnit(mover.id, 11, 10)).rejects.toThrow('enemy zone of control');
    });

    it('loads ruleset-compatible cargo, moves it, and unloads onto land', async () => {
      terrain.set('10,10', 'ocean');
      terrain.set('11,10', 'ocean');
      terrain.set('12,10', 'grassland');
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      await expect(unitManager.loadUnitOntoTransport(transport.id, cargo.id)).resolves.toBe(true);
      expect(cargo.transportedBy).toBe(transport.id);
      expect(transport.cargoUnits).toEqual([cargo.id]);

      await unitManager.moveUnit(transport.id, 11, 10);
      expect({ x: cargo.x, y: cargo.y }).toEqual({ x: 11, y: 10 });

      await expect(unitManager.unloadUnit(cargo.id, 12, 10)).resolves.toBe(true);
      expect(cargo.transportedBy).toBeUndefined();
      expect({ x: cargo.x, y: cargo.y }).toEqual({ x: 12, y: 10 });
    });

    it('captures an undefended enemy city through the authoritative callback', async () => {
      let cityOwner = 'player-456';
      const captureCity = jest.fn(async () => {
        cityOwner = 'player-123';
        return true;
      });
      const cityAwareManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: (x, y) =>
            x === 11 && y === 10 ? { id: 'enemy-city', playerId: cityOwner, buildings: [] } : null,
          captureCity,
        }
      );
      const warrior = await cityAwareManager.createUnit('player-123', 'warriors', 10, 10);

      await expect(cityAwareManager.moveUnit(warrior.id, 11, 10)).resolves.toBe(true);
      expect(captureCity).toHaveBeenCalledWith('enemy-city', 'player-123', warrior.id);
    });

    it('rejects city capture by a NonMil unit', async () => {
      const captureCity = jest.fn(async () => true);
      const cityAwareManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: (x, y) =>
            x === 11 && y === 10
              ? { id: 'enemy-city', playerId: 'player-456', buildings: [] }
              : null,
          captureCity,
        }
      );
      const settlers = await cityAwareManager.createUnit('player-123', 'settlers', 10, 10);

      await expect(cityAwareManager.moveUnit(settlers.id, 11, 10)).rejects.toThrow(
        'Cannot capture enemy city'
      );
      expect(captureCity).not.toHaveBeenCalled();
    });
  });

  describe('unit combat', () => {
    let attackerUnitId: string;
    let defenderUnitId: string;

    beforeEach(async () => {
      const attacker = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await unitManager.createUnit('player-456', 'warriors', 11, 10);
      attackerUnitId = attacker.id;
      defenderUnitId = defender.id;
    });

    it('should conduct combat successfully', async () => {
      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      expect(result.attackerId).toBe(attackerUnitId);
      expect(result.defenderId).toBe(defenderUnitId);
      expect(result.attackerDamage + result.defenderDamage).toBeGreaterThan(0);
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);

      const attacker = unitManager.getUnit(attackerUnitId);
      if (attacker) {
        expect(attacker.movementLeft).toBe(0); // Attack uses all movement
      }
    });

    it('rejects attacks against friendly units', async () => {
      const friendly = await unitManager.createUnit('player-123', 'warriors', 12, 10);
      await expect(unitManager.attackUnit(attackerUnitId, friendly.id)).rejects.toThrow(
        'friendly unit'
      );
    });

    it('should reject attack out of range', async () => {
      // Move attacker away to position out of range
      const attacker = unitManager.getUnit(attackerUnitId)!;
      attacker.x = 5; // Far from defender at (11, 10)
      attacker.y = 5;
      attacker.movementLeft = 1; // Give movement for attack attempt

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'Target out of range'
      );
    });

    it('should reject attack with no movement', async () => {
      // Use up movement point (warrior has only 1 movement)
      const attacker = unitManager.getUnit(attackerUnitId)!;
      attacker.movementLeft = 0; // No movement left

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'No movement points remaining' // Actual error message from UnitManager
      );
    });

    it('should handle unit destruction', async () => {
      const attacker = unitManager.getUnit(attackerUnitId)!;
      const defender = unitManager.getUnit(defenderUnitId)!;

      // Set low health to ensure destruction
      attacker.health = 1;
      defender.health = 1;
      attacker.movementLeft = 1; // Give movement for attack

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      // At least one unit should be destroyed with such low health
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);
    });

    it('uses attack versus defense and resolves classic combat until one unit dies', async () => {
      const deterministicManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        () => 0
      );
      const attacker = await deterministicManager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await deterministicManager.createUnit('player-456', 'phalanx', 11, 10);

      const result = await deterministicManager.attackUnit(attacker.id, defender.id);

      // A roll of zero always falls in the defender's defense-power share.
      expect(result).toMatchObject({
        attackerDestroyed: true,
        defenderDestroyed: false,
        attackerDamage: 100,
        defenderDamage: 0,
      });
    });

    it('applies classic field killstack and moves the winning attacker onto the tile', async () => {
      const deterministicManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        () => 0.99
      );
      const attacker = await deterministicManager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await deterministicManager.createUnit('player-456', 'warriors', 11, 10);
      const stackedDefender = await deterministicManager.createUnit(
        'player-456',
        'phalanx',
        11,
        10
      );

      const result = await deterministicManager.attackUnit(attacker.id, defender.id);

      expect(result.collateralDestroyedIds).toEqual([stackedDefender.id]);
      expect(deterministicManager.getUnit(defender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(stackedDefender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(attacker.id)).toMatchObject({ x: 11, y: 10 });
    });

    it('applies the classic terrain defense bonus only to TerrainDefense classes', async () => {
      const hillsMap = {
        getTile: jest.fn(() => ({ terrain: 'hills' })),
      };
      const terrainAwareManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        hillsMap
      );
      const defender = await terrainAwareManager.createUnit('player-456', 'phalanx', 11, 10);

      const strength = (terrainAwareManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.phalanx
      );

      // Phalanx defense 2 receives the classic hills +100% defense bonus.
      expect(strength).toBe(4);
    });

    it('applies the classic City Walls defense bonus to a land defender in the city', async () => {
      const cityAwareUnitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: async () => '',
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => undefined,
          getCityAt: (x, y) =>
            x === 11 && y === 10
              ? { id: 'city-walls', playerId: 'player-456', buildings: ['walls'] }
              : null,
        },
        new EffectsManager()
      );
      const defender = await cityAwareUnitManager.createUnit('player-456', 'warriors', 11, 10);

      const strength = (cityAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.warriors
      );

      // @reference reference/freeciv/data/classic/effects.ruleset:953-962
      // Warriors (combat 1) receive City Walls +200% and city fortify +50%:
      // floor(floor(1 * 150 / 100) * 300 / 100) === 3
      expect(strength).toBe(3);
    });

    it('applies the classic fortified defense bonus from Fortify_Defense_Bonus', async () => {
      const effectsAwareUnitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: async () => '',
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => undefined,
        },
        new EffectsManager()
      );
      const defender = await effectsAwareUnitManager.createUnit('player-456', 'archers', 12, 10);
      defender.fortified = true;

      const strength = (effectsAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.archers
      );

      // @reference reference/freeciv/data/classic/effects.ruleset:157-162
      // Archers defense 2 with +50% fortify: floor(2 * 150 / 100) === 3
      expect(strength).toBe(3);
    });

    it('applies the classic city fortify defense bonus when unfortified in a city', async () => {
      const cityAwareUnitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: async () => '',
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => undefined,
          getCityAt: (x, y) =>
            x === 13 && y === 10
              ? { id: 'city-fortify', playerId: 'player-456', buildings: [] }
              : null,
        },
        new EffectsManager()
      );
      const defender = await cityAwareUnitManager.createUnit('player-456', 'archers', 13, 10);

      const strength = (cityAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.archers
      );

      // @reference reference/freeciv/data/classic/effects.ruleset:164-173
      // Unfortified land unit in city center: +50% city fortify bonus
      expect(strength).toBe(3);
    });

    it('does not give settlers the city fortify bonus because they Cant_Fortify', async () => {
      const cityAwareUnitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: async () => '',
          requestPath: async () => ({ success: true }),
          broadcastUnitMoved: () => undefined,
          getCityAt: (x, y) =>
            x === 14 && y === 10
              ? { id: 'city-settlers', playerId: 'player-456', buildings: [] }
              : null,
        },
        new EffectsManager()
      );
      const defender = await cityAwareUnitManager.createUnit('player-456', 'settlers', 14, 10);

      const strength = (cityAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.settlers
      );

      // Settlers defense 1 remains 1 with no fortify bonus.
      expect(strength).toBe(1);
      expect(UNIT_TYPES.settlers.flags).toContain('Cant_Fortify');
      expect(
        (cityAwareUnitManager as any).calculateFortifyDefenseBonus(defender, UNIT_TYPES.settlers)
      ).toBe(0);
    });
  });

  describe('unit fortification', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should fortify unit successfully', async () => {
      await unitManager.fortifyUnit(unitId);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.fortified).toBe(true);
      expect(unit!.movementLeft).toBe(0);

      // Database operations are handled by MockDatabaseProvider
    });
  });

  describe('unit healing', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
      unit.health = 50; // Damaged unit
    });

    it('should heal unit', async () => {
      await unitManager.healUnit(unitId, 20);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.health).toBe(70);

      // Database operations are handled by MockDatabaseProvider
    });

    it('should not heal above max health', async () => {
      await unitManager.healUnit(unitId, 80);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.health).toBe(100); // Capped at 100
    });
  });

  describe('turn management', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
      // Use some movement (unit starts with 1 movement)
      await unitManager.moveUnit(unitId, 11, 10);
    });

    it('should reset movement for player units', async () => {
      await unitManager.resetMovement('player-123');

      const unit = unitManager.getUnit(unitId);
      expect(unit!.movementLeft).toBe(3); // Reset to warrior's full movement in fragments
    });

    it('should heal fortified units', async () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 80;
      unit.fortified = true;

      await unitManager.resetMovement('player-123');

      expect(unit.health).toBe(90); // Healed 10 points
    });
  });

  describe('classic espionage mutations', () => {
    it('persists bribed ownership and clears the unit orders and movement', async () => {
      const unit = await unitManager.createUnit('player-456', 'warriors', 10, 10);
      unit.orders = [{ type: 'move', targetX: 11, targetY: 10 }];

      await unitManager.bribeUnit(unit.id, 'player-123', 'home-city');

      expect(unit).toMatchObject({
        playerId: 'player-123',
        homeCityId: 'home-city',
        movementLeft: 0,
        orders: [],
        fortified: false,
      });
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenLastCalledWith(
        expect.objectContaining({ playerId: 'player-123', movementPoints: '0' })
      );
    });

    it('halves the target unit remaining health', async () => {
      const unit = await unitManager.createUnit('player-456', 'warriors', 10, 10);
      unit.health = 75;

      await expect(unitManager.sabotageUnit(unit.id)).resolves.toMatchObject({
        destroyed: false,
        unit: { health: 37 },
      });
      expect(unitManager.getUnit(unit.id)?.health).toBe(37);
    });
  });

  describe('unit queries', () => {
    beforeEach(async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-123', 'settlers', 11, 10); // Use 'settlers'
      await unitManager.createUnit('player-456', 'warriors', 12, 10);
    });

    it('should get player units', () => {
      const player123Units = unitManager.getPlayerUnits('player-123');
      const player456Units = unitManager.getPlayerUnits('player-456');

      expect(player123Units).toHaveLength(2);
      expect(player456Units).toHaveLength(1);

      expect(player123Units.every(u => u.playerId === 'player-123')).toBe(true);
      expect(player456Units.every(u => u.playerId === 'player-456')).toBe(true);
    });

    it('should get unit at position', () => {
      const unit = unitManager.getUnitAt(10, 10);
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('warriors');

      const noUnit = unitManager.getUnitAt(50, 50);
      expect(noUnit).toBeUndefined();
    });

    it('should get all units at position', () => {
      const units = unitManager.getUnitsAt(10, 10);
      expect(units).toHaveLength(1);

      const noUnits = unitManager.getUnitsAt(50, 50);
      expect(noUnits).toHaveLength(0);
    });
  });

  describe('visibility', () => {
    beforeEach(async () => {
      await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-456', 'warriors', 11, 10);
      await unitManager.createUnit('player-456', 'settlers', 20, 20); // Use 'settlers'
    });

    it('should return visible units for player', () => {
      const visibleTiles = new Set(['10,10', '11,10', '12,10']);

      const visibleUnits = unitManager.getVisibleUnits('player-123', visibleTiles);

      // Should see own unit + enemy unit in visible range
      expect(visibleUnits).toHaveLength(2);
      expect(visibleUnits.some(u => u.playerId === 'player-123')).toBe(true);
      expect(visibleUnits.some(u => u.playerId === 'player-456' && u.x === 11)).toBe(true);
      expect(visibleUnits.every(u => u.x !== 20)).toBe(true); // Shouldn't see distant unit
    });

    it('should always see own units', () => {
      const visibleTiles = new Set(['15,15']); // Random visible area

      const visibleUnits = unitManager.getVisibleUnits('player-123', visibleTiles);

      // Should still see own unit even if not in visible tiles
      expect(visibleUnits).toHaveLength(1);
      expect(visibleUnits[0].playerId).toBe('player-123');
    });
  });

  // Database integration is tested in integration tests
  // Unit tests focus on business logic without database interactions
});
