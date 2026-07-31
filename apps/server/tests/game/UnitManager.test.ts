import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { EffectsManager } from '@game/managers/EffectsManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { ActionType } from '@app-types/shared/actions';
import { MapTopology } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';

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

    it('uses ruleset target classes for unreachable air units', async () => {
      const bomber = await unitManager.createUnit('player-123', 'bomber', 10, 10);
      const fighter = await unitManager.createUnit('player-456', 'fighter', 11, 10);

      expect(unitManager.canUnitTargetUnit(bomber, fighter)).toBe(false);
      expect(unitManager.canUnitTargetUnit(fighter, bomber)).toBe(true);
    });

    it('applies ruleset air-defense multipliers to authoritative combat ratings', async () => {
      const bomber = await unitManager.createUnit('player-123', 'bomber', 10, 10);
      const aegis = await unitManager.createUnit('player-456', 'aegis_cruiser', 11, 10);

      const ordinaryRating = unitManager.calculateUnitDefenseRating(aegis);
      const interceptedRating = unitManager.calculateUnitDefenseRating(aegis, bomber);

      expect(interceptedRating).toBe(ordinaryRating * 5);
    });

    it('calculates the exact symmetric combat win probability', async () => {
      const attacker = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await unitManager.createUnit('player-456', 'warriors', 11, 10);

      expect(unitManager.calculateUnitWinChance(attacker, defender)).toBeCloseTo(0.5);
    });
  });

  describe('unit creation', () => {
    it('wakes sentried units when a hostile unit enters their vision', async () => {
      unitManager.setHostilePlayersProvider(playerId =>
        playerId === 'player-123' ? new Set(['player-456']) : new Set()
      );
      const sentry = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const hostile = await unitManager.createUnit('player-456', 'warriors', 11, 10);
      sentry.sentryUntil = 'enemy_sighted';

      await unitManager.wakeSentriesForUnit(hostile);

      expect(sentry.sentryUntil).toBeUndefined();
    });

    it('applies a city rally point as a persisted movement order', async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      await unitManager.applyRallyPoint(unit, { x: 12, y: 10 });

      expect(unit.orders).toEqual([{ type: 'move', targetX: 12, targetY: 10 }]);
      expect(mockDbProvider.getDatabase().update).toHaveBeenCalled();
    });

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

    it('cancels queued orders and persists the idle state', async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitManager.addOrderToUnit(unit.id, { type: 'patrol' });
      unit.activity = { type: 'patrolling', turnsRemaining: 1, totalTurns: 2 };

      await expect(
        unitManager.executeUnitAction(
          unit.id,
          ActionType.CANCEL_ORDERS,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({
        success: true,
        message: 'Unit orders cancelled',
        newOrders: [],
      });
      expect(unit.orders).toEqual([]);
      expect(unit.activity).toEqual({ type: 'idle', turnsRemaining: 0, totalTurns: 0 });
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenCalledWith({
        isAutomated: false,
        orders: [],
        currentOrder: null,
      });
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
      getTile: jest.fn((..._coordinates: number[]) => tile),
      getTopology: jest.fn(() => ({
        getCardinalNeighbors: jest.fn(() => [{ x: 10, y: 9 }]),
        isValidCoordinate: jest.fn(() => true),
      })),
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
      mapManager.getTile.mockImplementation((..._coordinates: number[]) => tile);
      mapManager.getTopology.mockClear();
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

    it('combines compatible workers into one shared activity', async () => {
      const first = await unitManager.createUnit('player-123', 'worker', 10, 10);
      const second = await unitManager.createUnit('player-123', 'worker', 10, 10);

      await unitManager.executeUnitAction(
        first.id,
        ActionType.BUILD_ROAD,
        undefined,
        undefined,
        'player-123'
      );
      await unitManager.executeUnitAction(
        second.id,
        ActionType.BUILD_ROAD,
        undefined,
        undefined,
        'player-123'
      );

      await unitManager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(true);
      expect(first.orders).toEqual([]);
      expect(second.orders).toEqual([]);
    });

    it('treats fallout as a cleanable extra and removes it on completion', async () => {
      tile.improvements = ['fallout'];
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.canUnitPerformAction(worker.id, ActionType.CLEAN_POLLUTION)).toBe(true);
      await (unitManager as any).completeActivity(worker, { type: 'cleanPollution' });

      expect(tile.improvements).not.toContain('fallout');
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

    it('requires a cardinal water source before starting classic irrigation', async () => {
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(false);

      mapManager.getTile.mockImplementation((...coordinates: number[]) => {
        const [x, y] = coordinates;
        return x === 10 && y === 9 ? ({ ...tile, x, y, terrain: 'ocean' } as typeof tile) : tile;
      });
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(true);
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

    it('persists cultivate, plant, fortress, and airbase ruleset outcomes', async () => {
      unitManager.setPlayerTechsProvider(() => new Set(['construction', 'radio']));
      tile.terrain = 'forest';
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.CULTIVATE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      for (let turn = 0; turn < 5; turn++) await unitManager.processUnitOrders('player-123');
      expect(tile.terrain).toBe('plains');

      worker.movementLeft = 3;
      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.PLANT,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      for (let turn = 0; turn < 15; turn++) await unitManager.processUnitOrders('player-123');
      expect(tile.terrain).toBe('forest');

      worker.movementLeft = 3;
      await expect(
        unitManager.executeUnitAction(
          worker.id,
          ActionType.BUILD_FORTRESS,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      for (let turn = 0; turn < 3; turn++) await unitManager.processUnitOrders('player-123');
      expect(tile.improvements).toContain('fortress');

      const engineer = await unitManager.createUnit('player-123', 'engineers', 10, 10);
      await expect(
        unitManager.executeUnitAction(
          engineer.id,
          ActionType.BUILD_AIRBASE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      for (let turn = 0; turn < 2; turn++) await unitManager.processUnitOrders('player-123');
      expect(tile.improvements).toContain('airbase');
    });

    it('enforces base technology requirements', async () => {
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(false);
      unitManager.setPlayerTechsProvider(() => new Set(['construction']));
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(true);
    });
  });

  describe('Milestone 14 city actions', () => {
    it('creates Partisans on legal surrounding land tiles', async () => {
      const created = await unitManager.createPartisans('player-456', { x: 10, y: 10 }, 4, 1);

      expect(created).toHaveLength(4);
      expect(created.every(unit => unit.playerId === 'player-456')).toBe(true);
      expect(created.every(unit => unit.unitTypeId === 'partisan')).toBe(true);
      expect(created.every(unit => unit.x !== 10 || unit.y !== 10)).toBe(true);
    });

    it('reconciles units when a city changes owner', async () => {
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 12 && y === 10 ? { id: 'city-2', playerId: 'player-456' } : null,
      });
      const inside = await unitManager.createUnit('player-456', 'warriors', 10, 10, 'city-1');
      const nearby = await unitManager.createUnit('player-456', 'warriors', 11, 10, 'city-1');
      const farAway = await unitManager.createUnit('player-456', 'warriors', 20, 20, 'city-1');
      const inAnotherCity = await unitManager.createUnit(
        'player-456',
        'warriors',
        12,
        10,
        'city-1'
      );
      const homeless = await unitManager.createUnit('player-456', 'warriors', 10, 10);

      await unitManager.reconcileCityOwnership(
        { id: 'city-1', x: 10, y: 10 },
        'player-456',
        'player-123'
      );

      expect(inside).toMatchObject({ playerId: 'player-123', homeCityId: 'city-1' });
      expect(nearby).toMatchObject({ playerId: 'player-123', homeCityId: 'city-1' });
      expect(homeless).toMatchObject({ playerId: 'player-123', homeCityId: undefined });
      expect(inAnotherCity).toMatchObject({ playerId: 'player-456', homeCityId: 'city-2' });
      expect(unitManager.getUnit(farAway.id)).toBeUndefined();
    });

    it('broadcasts settler destruction after a successful found-city action', async () => {
      const broadcastUnitDestroyed = jest.fn();
      const foundCity = jest.fn().mockResolvedValue('city-1');
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity,
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        broadcastUnitDestroyed,
      });
      const lifecycleObserver = jest.fn();
      unitManager.setUnitLifecycleObserver(lifecycleObserver);
      const settlers = await unitManager.createUnit('player-123', 'settlers', 10, 10);
      lifecycleObserver.mockClear();

      await expect(
        unitManager.executeUnitAction(
          settlers.id,
          ActionType.FOUND_CITY,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true, unitDestroyed: true, cityId: 'city-1' });

      expect(unitManager.getUnit(settlers.id)).toBeUndefined();
      expect(broadcastUnitDestroyed).toHaveBeenCalledWith(gameId, settlers);
      expect(broadcastUnitDestroyed).toHaveBeenCalledTimes(1);
      expect(lifecycleObserver).toHaveBeenCalledWith({ type: 'destroyed', unit: settlers });
      expect(lifecycleObserver).toHaveBeenCalledTimes(1);
    });

    it('delegates a legal join-city action and consumes the actor', async () => {
      const executeCityUnitAction = jest.fn().mockResolvedValue({
        success: true,
        message: 'Unit joined the city',
        unitDestroyed: true,
      });
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: () => ({ id: 'city-1', playerId: 'player-123' }),
        executeCityUnitAction,
      });
      const settlers = await unitManager.createUnit('player-123', 'settlers', 10, 10, 'city-1');

      await expect(
        unitManager.executeUnitAction(settlers.id, ActionType.JOIN_CITY, 10, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, unitDestroyed: true });
      expect(executeCityUnitAction).toHaveBeenCalledWith(
        ActionType.JOIN_CITY,
        'player-123',
        'settlers',
        'city-1',
        10,
        10
      );
      expect(unitManager.getUnit(settlers.id)).toBeUndefined();
    });

    it('persists home-city reassignment only in a friendly city under the unit', async () => {
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: () => ({ id: 'city-2', playerId: 'player-123' }),
      });
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10, 'city-1');

      await expect(
        unitManager.executeUnitAction(unit.id, ActionType.CHANGE_HOME_CITY, 10, 10, 'player-123')
      ).resolves.toMatchObject({ success: true });
      expect(unit.homeCityId).toBe('city-2');
      expect(unit.movementLeft).toBe(0);
    });
  });

  describe('unit movement', () => {
    let unitId: string;

    beforeEach(async () => {
      const unit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      unitId = unit.id;
    });

    it('should move unit successfully', async () => {
      const lifecycleObserver = jest.fn();
      unitManager.setUnitLifecycleObserver(lifecycleObserver);
      const result = await unitManager.moveUnit(unitId, 11, 10);

      expect(result).toBe(true);

      const unit = unitManager.getUnit(unitId);
      expect(unit!.x).toBe(11);
      expect(unit!.y).toBe(10);
      expect(unit!.movementLeft).toBe(0); // Used 1 movement point for basic terrain
      expect(unit!.fortified).toBe(false);
      expect(lifecycleObserver).toHaveBeenCalledWith({
        type: 'moved',
        unit,
        previousX: 10,
        previousY: 10,
      });

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

    it('allows military goto paths to end at a foreign city but warns until war is declared', async () => {
      const requestPath = jest.fn(async () => ({
        success: true,
        path: {
          tiles: [
            { x: 10, y: 10, moveCost: 0 },
            { x: 11, y: 10, moveCost: 3 },
          ],
        },
      }));
      let cityOwner = 'player-456';
      const captureCity = jest.fn().mockImplementation(async () => {
        cityOwner = 'player-123';
        return true;
      });
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath,
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 11 && y === 10 ? { id: 'foreign-city', playerId: cityOwner } : null,
        captureCity,
      });
      manager.setAlliedPlayersProvider(() => new Set());
      manager.setHostilityProvider(async () => false);
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        manager.executeUnitAction(warrior.id, ActionType.GOTO, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: false,
        message: "Cannot enter player-456's city unless you declare war first.",
      });
      expect(warrior).toMatchObject({ x: 10, y: 10, movementLeft: 3 });
      expect(requestPath).not.toHaveBeenCalled();

      manager.setHostilityProvider(async () => true);
      await expect(
        manager.executeUnitAction(warrior.id, ActionType.GOTO, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, newPosition: { x: 11, y: 10 } });
      expect(captureCity).toHaveBeenCalledWith('foreign-city', 'player-123', warrior.id);
    });

    it('treats a foreign city as a legal military path destination', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 11 && y === 10 ? { id: 'foreign-city', playerId: 'player-456' } : null,
      });
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      (manager as any).calculateTerrainMovementCost = jest.fn(() => 3);

      expect((manager as any).getPathStepCost(warrior, 10, 10, 11, 10, true)).toBe(3);
      expect((manager as any).getPathStepCost(warrior, 10, 10, 11, 10, false)).toBe(-1);
    });

    it('moves RandomMovement units to a legal adjacent tile during random events', async () => {
      const topology = new MapTopology(20, 20);
      const mapManager = {
        getTopology: () => topology,
        getMapData: () => ({ width: 20, height: 20, tiles: [] }),
        getTile: () => ({ terrain: 'ocean', improvements: [] }),
      };
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        20,
        20,
        mapManager,
        undefined,
        undefined,
        undefined,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const storm = await manager.createUnit('player-123', 'storm', 10, 10);

      expect(manager.getUnitsWithRandomMovement('player-123')).toEqual([storm]);
      const result = await manager.executeRandomMovement(storm.id);

      expect(result).toMatchObject({
        success: true,
        fromTile: { x: 10, y: 10 },
        movementPointsUsed: 3,
      });
      expect(storm.x !== 10 || storm.y !== 10).toBe(true);
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
      unitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        undefined,
        new EffectsManager('civ2civ3'),
        Math.random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
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

    it('does not treat allied units as enemy zones of control', async () => {
      unitManager.setHostilePlayersProvider(() => new Set());
      const mover = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.createUnit('player-456', 'warriors', 9, 10);
      await unitManager.createUnit('player-456', 'warriors', 12, 10);

      await expect(unitManager.moveUnit(mover.id, 11, 10)).resolves.toBe(true);
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

    it('rescues cargo to a legal tile when its transport is destroyed', async () => {
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.loadUnitOntoTransport(transport.id, cargo.id);

      await unitManager.removeUnit(transport.id);

      expect(unitManager.getUnit(transport.id)).toBeUndefined();
      expect(unitManager.getUnit(cargo.id)).toMatchObject({
        transportedBy: undefined,
        x: 10,
        y: 10,
        movementLeft: 0,
      });
    });

    it('prioritizes GameLoss cargo for a compatible rescue transport', async () => {
      for (let x = 9; x <= 11; x++) {
        for (let y = 9; y <= 11; y++) terrain.set(`${x},${y}`, 'ocean');
      }
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const ordinary = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const leader = await unitManager.createUnit('player-123', 'leader', 10, 10);
      await unitManager.loadUnitOntoTransport(transport.id, ordinary.id);
      await unitManager.loadUnitOntoTransport(transport.id, leader.id);
      const rescueTransport = await unitManager.createUnit('player-123', 'helicopter', 11, 10);

      await unitManager.removeUnit(transport.id);

      expect(unitManager.getUnit(leader.id)).toMatchObject({
        transportedBy: rescueTransport.id,
      });
      expect(unitManager.getUnit(ordinary.id)).toBeUndefined();
      expect(rescueTransport.cargoUnits).toEqual([leader.id]);
    });

    it('destroys cargo that has no legal evacuation location', async () => {
      for (let x = 9; x <= 11; x++) {
        for (let y = 9; y <= 11; y++) terrain.set(`${x},${y}`, 'ocean');
      }
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.loadUnitOntoTransport(transport.id, cargo.id);

      await unitManager.removeUnit(transport.id);

      expect(unitManager.getUnit(cargo.id)).toBeUndefined();
    });

    it('preserves missile movement when launching from a compatible transport', async () => {
      terrain.set('10,10', 'ocean');
      const transport = await unitManager.createUnit('player-123', 'submarine', 10, 10);
      const missile = await unitManager.createUnit('player-123', 'cruise_missile', 10, 10);

      await expect(unitManager.loadUnitOntoTransport(transport.id, missile.id)).resolves.toBe(true);
      missile.movementLeft = UNIT_TYPES.cruise_missile.movement;
      await expect(unitManager.unloadUnit(missile.id, 10, 10)).resolves.toBe(true);

      expect(missile.transportedBy).toBeUndefined();
      expect(missile.movementLeft).toBe(UNIT_TYPES.cruise_missile.movement);
    });

    it('allows Marines to attack from a transport and disembark after victory', async () => {
      terrain.set('10,10', 'ocean');
      terrain.set('11,10', 'grassland');
      const marineManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        undefined,
        new EffectsManager('civ2civ3'),
        () => 0.99,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const transport = await marineManager.createUnit('player-123', 'trireme', 10, 10);
      const marine = await marineManager.createUnit('player-123', 'marines', 10, 10);
      await marineManager.loadUnitOntoTransport(transport.id, marine.id);
      const defender = await marineManager.createUnit('player-456', 'warriors', 11, 10);
      defender.health = 1;

      const result = await marineManager.attackUnit(marine.id, defender.id);

      expect(result.defenderDestroyed).toBe(true);
      expect(marine.transportedBy).toBeUndefined();
      expect(transport.cargoUnits).toEqual([]);
      expect(marine).toMatchObject({ x: 11, y: 10 });
    });

    it('keeps ordinary transported land units from attacking directly', async () => {
      terrain.set('10,10', 'ocean');
      terrain.set('11,10', 'grassland');
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const warrior = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.loadUnitOntoTransport(transport.id, warrior.id);
      const defender = await unitManager.createUnit('player-456', 'warriors', 11, 10);

      await expect(unitManager.attackUnit(warrior.id, defender.id)).rejects.toThrow(
        'Transported units cannot directly participate in combat'
      );
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

    it('requires war for city capture and permits entry into an allied city', async () => {
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
              ? { id: 'foreign-city', playerId: 'player-456', buildings: [] }
              : null,
          captureCity,
        }
      );
      cityAwareManager.setHostilityProvider(async () => false);
      cityAwareManager.setContactProvider(async () => undefined);
      const blocked = await cityAwareManager.createUnit('player-123', 'warriors', 10, 10);
      await expect(cityAwareManager.moveUnit(blocked.id, 11, 10)).rejects.toThrow(
        'unless its owner is at war'
      );

      cityAwareManager.setAlliedPlayersProvider(() => new Set(['player-456']));
      await expect(cityAwareManager.moveUnit(blocked.id, 11, 10)).resolves.toBe(true);
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

    it('charges the ruleset attack movement cost instead of clearing excess movement', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3')
      );
      const attacker = await manager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);
      attacker.movementLeft = 9;

      await manager.attackUnit(attacker.id, defender.id);

      if (manager.getUnit(attacker.id)) expect(manager.getUnit(attacker.id)!.movementLeft).toBe(3);
    });

    it('rejects a submarine attack against a non-native land tile', async () => {
      const map = {
        getTile: jest.fn((x: number) => ({ terrain: x === 10 ? 'ocean' : 'plains' })),
      };
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        map as any,
        undefined,
        new EffectsManager('civ2civ3')
      );
      const submarine = await manager.createUnit('player-123', 'submarine', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(manager.attackUnit(submarine.id, defender.id)).rejects.toThrow(
        'non-native target tile'
      );
    });

    it('rejects attacks against friendly units', async () => {
      const friendly = await unitManager.createUnit('player-123', 'warriors', 12, 10);
      await expect(unitManager.attackUnit(attackerUnitId, friendly.id)).rejects.toThrow(
        'friendly unit'
      );
    });

    it('rejects attacks when diplomacy does not report war', async () => {
      unitManager.setHostilityProvider(async () => false);

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).rejects.toThrow(
        'Cannot attack a player unless at war'
      );
    });

    it('allows attacks when diplomacy reports war', async () => {
      unitManager.setHostilityProvider(async () => true);

      await expect(unitManager.attackUnit(attackerUnitId, defenderUnitId)).resolves.toMatchObject({
        attackerId: attackerUnitId,
        defenderId: defenderUnitId,
      });
    });

    it('does not select a non-hostile defender from a mixed-owner stack', async () => {
      const ally = await unitManager.createUnit('player-ally', 'legion', 11, 10);
      unitManager.setHostilityProvider(
        async (_attackerPlayerId, defenderPlayerId) => defenderPlayerId === 'player-456'
      );

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      expect(result.defenderId).toBe(defenderUnitId);
      expect(result.defenderId).not.toBe(ally.id);
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

    it('invokes the GameLoss handler when a GameLoss unit is removed', async () => {
      const gameLossHandler = jest.fn().mockResolvedValue(undefined);
      unitManager.setGameLossHandler(gameLossHandler);
      const leader = await unitManager.createUnit('player-123', 'leader', 10, 10);

      await unitManager.removeUnit(leader.id);

      expect(gameLossHandler).toHaveBeenCalledTimes(1);
      expect(gameLossHandler).toHaveBeenCalledWith('player-123');
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
        experienceGained: { attacker: 0, defender: 1 },
      });
      expect(deterministicManager.getUnit(defender.id)?.veteranLevel).toBe(1);
    });

    it('applies the classic pearl-harbor firepower rule in a city', async () => {
      const cityAwareManager = new UnitManager(
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
              ? { id: 'port-city', playerId: 'player-456', buildings: [] }
              : null,
        }
      );
      const attacker = await cityAwareManager.createUnit('player-123', 'bomber', 10, 10);
      const defender = await cityAwareManager.createUnit('player-456', 'battleship', 11, 10);

      const firepower = (cityAwareManager as any).calculateModifiedFirepower(
        attacker,
        defender,
        { ...UNIT_TYPES.bomber, firepower: 2 },
        { ...UNIT_TYPES.battleship, firepower: 2 }
      );

      expect(firepower).toEqual({ attacker: 4, defender: 1 });
    });

    it('reduces helicopter firepower when attacked by a fighter', async () => {
      const attacker = await unitManager.createUnit('player-123', 'fighter', 10, 10);
      const defender = await unitManager.createUnit('player-456', 'helicopter', 11, 10);

      const firepower = (unitManager as any).calculateModifiedFirepower(
        attacker,
        defender,
        { ...UNIT_TYPES.fighter, firepower: 2 },
        { ...UNIT_TYPES.helicopter, firepower: 2 }
      );

      expect(firepower).toEqual({ attacker: 2, defender: 1 });
    });

    it('caps BadWallAttacker firepower when city defense applies', async () => {
      const cityAwareManager = new UnitManager(
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
              ? {
                  id: 'walled-city',
                  playerId: 'player-456',
                  buildings: ['city_walls'],
                }
              : null,
        },
        new EffectsManager()
      );
      const attacker = await cityAwareManager.createUnit('player-123', 'catapult', 10, 10);
      const defender = await cityAwareManager.createUnit('player-456', 'warriors', 11, 10);

      const firepower = (cityAwareManager as any).calculateModifiedFirepower(
        attacker,
        defender,
        { ...UNIT_TYPES.catapult, firepower: 2, flags: ['BadWallAttacker'] },
        UNIT_TYPES.warriors
      );

      expect(firepower.attacker).toBe(1);
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

      expect(result.defenderId).toBe(stackedDefender.id);
      expect(result.collateralDestroyedIds).toEqual([defender.id]);
      expect(deterministicManager.getUnit(defender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(stackedDefender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(attacker.id)).toMatchObject({ x: 11, y: 10 });
    });

    it('captures a hostile city after its final defender is defeated', async () => {
      let owner = 'player-456';
      const captureCity = jest.fn(async () => {
        owner = 'player-123';
        return true;
      });
      const cityAwareManager = new UnitManager(
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
            x === 11 && y === 10 ? { id: 'target-city', playerId: owner, buildings: [] } : null,
          captureCity,
        },
        undefined,
        () => 0.99
      );
      const attacker = await cityAwareManager.createUnit('player-123', 'legion', 10, 10);
      const defender = await cityAwareManager.createUnit('player-456', 'warriors', 11, 10);
      defender.health = 1;

      const result = await cityAwareManager.attackUnit(attacker.id, defender.id);

      expect(result.defenderDestroyed).toBe(true);
      expect(captureCity).toHaveBeenCalledWith('target-city', 'player-123', attacker.id);
      expect(cityAwareManager.getUnit(attacker.id)).toMatchObject({ x: 11, y: 10 });
    });

    it('reduces a defended city population when a KillCitizen attacker wins', async () => {
      let population = 3;
      const applyCityPopulationLoss = jest.fn(async () => {
        population -= 1;
        return true;
      });
      const cityAwareManager = new UnitManager(
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
              ? { id: 'target-city', playerId: 'player-456', buildings: [], population }
              : null,
          applyCityPopulationLoss,
        },
        new EffectsManager('civ2civ3'),
        () => 0.99
      );
      const attacker = await cityAwareManager.createUnit('player-123', 'legion', 10, 10);
      const defender = await cityAwareManager.createUnit('player-456', 'warriors', 11, 10);
      defender.health = 1;

      await cityAwareManager.attackUnit(attacker.id, defender.id);

      expect(applyCityPopulationLoss).toHaveBeenCalledWith('target-city');
      expect(population).toBe(2);
    });

    it('does not reduce city population when City Walls grant Unit_No_Lose_Pop', async () => {
      const applyCityPopulationLoss = jest.fn(async () => true);
      const cityAwareManager = new UnitManager(
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
              ? {
                  id: 'walled-city',
                  playerId: 'player-456',
                  buildings: ['city_walls'],
                  population: 3,
                }
              : null,
          applyCityPopulationLoss,
        },
        new EffectsManager('civ2civ3'),
        () => 0.99
      );
      const attacker = await cityAwareManager.createUnit('player-123', 'legion', 10, 10);
      const defender = await cityAwareManager.createUnit('player-456', 'warriors', 11, 10);
      defender.health = 1;

      await cityAwareManager.attackUnit(attacker.id, defender.id);

      expect(applyCityPopulationLoss).not.toHaveBeenCalled();
    });

    it('selects the strongest eligible defender instead of trusting the requested unit id', async () => {
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
      const weak = await deterministicManager.createUnit('player-456', 'warriors', 11, 10);
      const strong = await deterministicManager.createUnit('player-456', 'musketeers', 11, 10);

      const result = await deterministicManager.attackUnit(attacker.id, weak.id);

      expect(result.defenderId).toBe(strong.id);
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

    it('applies the ruleset Fortress defense bonus to land defenders', async () => {
      const tile = { terrain: 'grassland', improvements: [] as string[] };
      const fortressMap = { getTile: jest.fn(() => tile) };
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, fortressMap);
      const defender = await manager.createUnit('player-456', 'phalanx', 11, 10);
      const unfortified = (manager as any).calculateCombatStrength(defender, UNIT_TYPES.phalanx);
      tile.improvements = ['fortress'];

      const inFortress = (manager as any).calculateCombatStrength(defender, UNIT_TYPES.phalanx);

      expect(inFortress).toBe(unfortified * 2);
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
              ? { id: 'city-walls', playerId: 'player-456', buildings: ['city_walls'] }
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

    it('evaluates City Walls against the attacker and lets Howitzers ignore them', async () => {
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
              ? { id: 'city-walls', playerId: 'player-456', buildings: ['city_walls'] }
              : null,
        },
        new EffectsManager()
      );
      const defender = await cityAwareUnitManager.createUnit('player-456', 'warriors', 11, 10);
      const legion = await cityAwareUnitManager.createUnit('player-123', 'legion', 10, 10);
      const howitzer = await cityAwareUnitManager.createUnit('player-123', 'howitzer', 10, 9);

      const versusLegion = (cityAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.warriors,
        legion,
        UNIT_TYPES.legion
      );
      const versusHowitzer = (cityAwareUnitManager as any).calculateCombatStrength(
        defender,
        UNIT_TYPES.warriors,
        howitzer,
        UNIT_TYPES.howitzer
      );

      expect(versusLegion).toBe(3);
      expect(versusHowitzer).toBe(1);
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

  describe('Super Spy diplomatic contests', () => {
    it('gives a Super Spy attacker and defender the reference precedence', async () => {
      const ordinary = await unitManager.createUnit('player-123', 'diplomat', 10, 10);
      const superSpy = await unitManager.createUnit('player-456', 'leader', 11, 10);
      expect(
        unitManager.calculateDiplomatActionOdds(ordinary, ActionType.SABOTAGE_CITY, superSpy)
          .successChance
      ).toBe(0);

      const superSpyAttacker = await unitManager.createUnit('player-123', 'leader', 10, 11);
      const diplomat = await unitManager.createUnit('player-456', 'diplomat', 11, 11);
      expect(
        unitManager.calculateDiplomatActionOdds(
          superSpyAttacker,
          ActionType.SABOTAGE_CITY,
          diplomat
        ).successChance
      ).toBe(1);
    });
  });

  describe('city-targeted unit actions', () => {
    it('allows configured adjacent-city caravan actions but rejects farther cities', async () => {
      const cityAwareManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          executeCityUnitAction: jest.fn(),
          getCityAt: (x: number, _y: number) =>
            x === 11 || x === 12 ? { id: `city-${x}`, playerId: 'player-123' } : null,
        },
        new EffectsManager('civ2civ3')
      );
      const caravan = await cityAwareManager.createUnit('player-123', 'caravan', 10, 10);
      expect(
        (cityAwareManager as any).canPerformCityUnitAction(caravan, ActionType.HELP_WONDER, 11, 10)
      ).toBe(true);
      expect(
        (cityAwareManager as any).canPerformCityUnitAction(caravan, ActionType.HELP_WONDER, 12, 10)
      ).toBe(false);
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

    it('applies Min_HP_Pct as Freeciv minimum coordinate regeneration', () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 50;
      const effects = (unitManager as any).effectsManager as EffectsManager;
      jest.spyOn(effects, 'calculateEffect').mockImplementation((type: any) => ({
        value: type === 'Min_HP_Pct' ? 33 : type === 'HP_Regen_2' ? 10 : 0,
        effects: [],
      }));

      expect(unitManager.calculateUnitHitpointRecovery(unit)).toMatchObject({
        minimum: 33,
        secondary: 10,
        gain: 43,
      });
    });

    it('uses regeneration buildings in an allied city', () => {
      const alliedCityManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        { getTile: () => ({ improvements: [] }) },
        {
          getCityAt: () => ({
            id: 'allied-city',
            playerId: 'ally',
            buildings: ['barracks'],
          }),
        } as any
      );
      const unit = unitManager.getUnit(unitId)!;

      expect(alliedCityManager.calculateUnitHitpointRecovery(unit, 4, 4).regeneration).toBe(100);
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

    it('scales damaged DamageSlows units while preserving class minimum speed', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        undefined,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const warriorType = manager.getUnitType('warriors')!;

      expect((manager as any).getUnitMovementPoints('player-123', warriorType, 0, 100)).toBe(3);
      expect((manager as any).getUnitMovementPoints('player-123', warriorType, 0, 50)).toBe(1);
      expect((manager as any).getUnitMovementPoints('player-123', warriorType, 0, 1)).toBe(1);
    });

    it('does not slow a unit class without DamageSlows', () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        undefined,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const missileType = manager.getUnitType('cruise_missile')!;

      expect((manager as any).getUnitMovementPoints('player-123', missileType, 0, 100)).toBe(
        missileType.movement * 3
      );
      expect((manager as any).getUnitMovementPoints('player-123', missileType, 0, 10)).toBe(
        missileType.movement * 3
      );
    });

    it('should heal fortified units', async () => {
      const unit = unitManager.getUnit(unitId)!;
      unit.health = 80;
      unit.fortified = true;

      await unitManager.resetMovement('player-123');

      // Classic base regeneration (10%) stacks with fortified regeneration
      // (10%), both sourced from effects.json.
      expect(unit.health).toBe(100);
    });

    it('retires an isolated age-five Barbarian unit through Retire_Pct', async () => {
      const database = mockDbProvider.getDatabase() as any;
      database.query.players.findFirst.mockResolvedValue({ nation: 'barbarian' });
      let turn = 1;
      const retiringManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager(),
        () => 0
      );
      retiringManager.setCurrentTurnProvider(() => turn);
      const barbarian = await retiringManager.createUnit('barbarian-player', 'warriors', 20, 20);
      turn = 6;

      await retiringManager.resetMovement('barbarian-player');

      expect(retiringManager.getUnit(barbarian.id)).toBeUndefined();
    });

    it('consumes aircraft fuel and destroys an aircraft that cannot refuel', async () => {
      const fighter = await unitManager.createUnit('player-123', 'fighter', 10, 10);
      expect(fighter.fuel).toBe(1);

      await unitManager.resetMovement('player-123');

      expect(unitManager.getUnit(fighter.id)).toBeUndefined();
    });

    it('refuels fueled aircraft in a friendly city and on an airbase', async () => {
      const tile = { terrain: 'grassland', improvements: ['airbase'] };
      const mapManager = { getTile: jest.fn(() => tile) };
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, mapManager, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: jest.fn(() => null),
      });
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);
      bomber.fuel = 1;

      await manager.resetMovement('player-123');

      expect(manager.getUnit(bomber.id)?.fuel).toBe(UNIT_TYPES.bomber.fuel);
    });

    it('refuels aircraft in an allied city', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        { getTile: jest.fn(() => ({ terrain: 'grassland', improvements: [] })) },
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: jest.fn(() => ({ id: 'allied-city', playerId: 'ally' })),
        }
      );
      manager.setAlliedPlayersProvider(() => new Set(['ally']));
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);
      bomber.fuel = 1;

      await manager.resetMovement('player-123');

      expect(manager.getUnit(bomber.id)?.fuel).toBe(UNIT_TYPES.bomber.fuel);
    });

    it('lets a fueled aircraft launch from a carrier with its movement intact', async () => {
      const carrier = await unitManager.createUnit('player-123', 'carrier', 10, 10);
      const bomber = await unitManager.createUnit('player-123', 'bomber', 10, 10);
      expect(await unitManager.loadUnitOntoTransport(carrier.id, bomber.id)).toBe(true);
      bomber.movementLeft = UNIT_TYPES.bomber.movement;

      expect(await unitManager.unloadUnit(bomber.id, 10, 10)).toBe(true);

      expect(bomber.transportedBy).toBeUndefined();
      expect(bomber.movementLeft).toBe(UNIT_TYPES.bomber.movement);
    });
  });

  describe('classic espionage mutations', () => {
    it('resolves covert success and spy escape as separate probability checks', async () => {
      const random = jest.fn().mockReturnValueOnce(0.5).mockReturnValueOnce(0.99);
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        random
      );
      const spy = await manager.createUnit('player-123', 'spy', 10, 10);

      expect(manager.resolveDiplomatAction(spy.id, ActionType.SABOTAGE_CITY)).toMatchObject({
        success: true,
        actorSurvives: false,
        successChance: 75,
        escapeChance: 75,
      });
    });

    it('persists bribed ownership and clears the unit orders and movement', async () => {
      const lifecycleObserver = jest.fn();
      unitManager.setUnitLifecycleObserver(lifecycleObserver);
      const unit = await unitManager.createUnit('player-456', 'warriors', 10, 10);
      unit.orders = [{ type: 'move', targetX: 11, targetY: 10 }];
      expect(lifecycleObserver).toHaveBeenLastCalledWith({ type: 'created', unit });
      lifecycleObserver.mockClear();

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
      expect(lifecycleObserver).toHaveBeenCalledWith({
        type: 'owner_changed',
        unit,
        previousPlayerId: 'player-456',
      });
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

  describe('classic special actions and automation', () => {
    const tile = {
      x: 10,
      y: 10,
      terrain: 'grassland',
      owner: undefined as string | undefined,
      improvements: [] as string[],
      hasRoad: false,
      hasRailroad: false,
    };
    const specialMap = {
      getTile: jest.fn((x: number, y: number) => ({ ...tile, x, y })),
      updateTileProperty: jest.fn(),
    };

    it('paradrops a capable unit from a friendly city within ruleset range', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 10 && y === 10
            ? { id: 'source-city', playerId: 'player-123', buildings: [] }
            : null,
      });
      const paratroopers = await manager.createUnit('player-123', 'paratroopers', 10, 10);

      await expect(
        manager.executeUnitAction(paratroopers.id, ActionType.PARADROP, 16, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        newPosition: { x: 16, y: 10 },
        newMovementLeft: 3,
      });
      expect(manager.getUnit(paratroopers.id)).toMatchObject({ x: 16, y: 10 });
      await expect(
        manager.executeUnitAction(paratroopers.id, ActionType.PARADROP, 17, 10, 'player-123')
      ).resolves.toMatchObject({ success: false });
    });

    it('allows a paradrop to launch from an allied city', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 10 && y === 10 ? { id: 'allied-source', playerId: 'player-456' } : null,
      });
      manager.setAlliedPlayersProvider(() => new Set(['player-456']));
      const paratroopers = await manager.createUnit('player-123', 'paratroopers', 10, 10);

      await expect(
        manager.executeUnitAction(paratroopers.id, ActionType.PARADROP, 16, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, newPosition: { x: 16, y: 10 } });
    });

    it('allows a paradrop to launch from an allied airbase', async () => {
      const alliedAirbaseMap = {
        getTile: jest.fn((x: number, y: number) => ({
          ...tile,
          x,
          y,
          owner: x === 10 && y === 10 ? 'player-456' : undefined,
          improvements: x === 10 && y === 10 ? ['airbase'] : [],
        })),
        updateTileProperty: jest.fn(),
      };
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        alliedAirbaseMap,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: () => null,
        }
      );
      manager.setAlliedPlayersProvider(() => new Set(['player-456']));
      const paratroopers = await manager.createUnit('player-123', 'paratroopers', 10, 10);

      await expect(
        manager.executeUnitAction(paratroopers.id, ActionType.PARADROP, 16, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, newPosition: { x: 16, y: 10 } });
    });

    it('resolves a contested paradrop by destroying the landing unit', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) =>
          x === 10 && y === 10
            ? { id: 'source-city', playerId: 'player-123', buildings: [] }
            : null,
      });
      const paratroopers = await manager.createUnit('player-123', 'paratroopers', 10, 10);
      await manager.createUnit('player-456', 'warriors', 16, 10);

      await expect(
        manager.executeUnitAction(paratroopers.id, ActionType.PARADROP, 16, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, unitDestroyed: true });
      expect(manager.getUnit(paratroopers.id)).toBeUndefined();
    });

    it('airlifts from an airport to a classic unlimited-capacity destination', async () => {
      const usedCities = new Set<string>();
      const reserveAirlift = jest.fn(async (source: string, destination: string) => {
        if (usedCities.has(source) || usedCities.has(destination)) return false;
        usedCities.add(source);
        usedCities.add(destination);
        return true;
      });
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: (x, y) => {
          if (x === 10 && y === 10)
            return { id: 'source-city', playerId: 'player-123', buildings: ['airport'] };
          if (x === 30 && y === 20)
            return { id: 'destination-city', playerId: 'player-123', buildings: [] };
          return null;
        },
        reserveAirlift,
      });
      manager.setCurrentTurnProvider(() => 8);
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        manager.executeUnitAction(warrior.id, ActionType.AIRLIFT, 30, 20, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        newPosition: { x: 30, y: 20 },
        newMovementLeft: 0,
      });
      expect(reserveAirlift).toHaveBeenCalledWith(
        'source-city',
        'destination-city',
        'player-123',
        8
      );
    });

    it('persists auto-explore and advances toward authoritative unexplored tiles', async () => {
      const requestPath = jest.fn(async () => ({
        success: true,
        path: {
          tiles: [
            { x: 10, y: 10 },
            { x: 11, y: 10 },
          ],
        },
      }));
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath,
        broadcastUnitMoved: jest.fn(),
      });
      manager.setExploredTilesProvider(() => {
        const explored = new Set<string>();
        for (let y = 0; y < mapHeight; y++) {
          for (let x = 0; x < mapWidth; x++) explored.add(`${x},${y}`);
        }
        explored.delete('11,10');
        return explored;
      });
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.AUTO_EXPLORE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      await manager.processUnitOrders('player-123');

      expect(warrior).toMatchObject({
        x: 11,
        y: 10,
        automation: 'explore',
        orders: [{ type: 'autoExplore' }],
      });
    });

    it('creates and preserves a targeted patrol route', async () => {
      const requestPath = jest.fn(
        async (_playerId: string, _unitId: string, targetX: number, targetY: number) => ({
          success: true,
          path: {
            tiles: [
              { x: targetX === 10 ? 11 : 10, y: 10 },
              { x: targetX, y: targetY },
            ],
          },
        })
      );
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap, {
        foundCity: jest.fn(),
        requestPath,
        broadcastUnitMoved: jest.fn(),
      });
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        manager.executeUnitAction(warrior.id, ActionType.PATROL, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true });
      expect(warrior.orders).toEqual([
        {
          type: 'patrol',
          patrolStart: { x: 10, y: 10 },
          patrolEnd: { x: 11, y: 10 },
        },
      ]);

      await manager.resetMovement('player-123');
      await manager.processUnitOrders('player-123');
      expect(warrior.orders?.[0]).toMatchObject({ type: 'patrol' });
    });

    it('keeps auto-settler queued behind the selected worker activity', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap);
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      await manager.executeUnitAction(
        worker.id,
        ActionType.AUTO_SETTLER,
        undefined,
        undefined,
        'player-123'
      );
      await manager.processUnitOrders('player-123');

      expect(worker.orders).toEqual([{ type: 'road' }, { type: 'autoSettler' }]);
      expect(worker.automation).toBe('settler');
    });

    it('applies non-lethal bombard damage for a ruleset-capable unit', async () => {
      const originalRate = UNIT_TYPES.archers.bombardRate;
      UNIT_TYPES.archers.bombardRate = 1;
      try {
        const attacker = await unitManager.createUnit('player-123', 'archers', 10, 10);
        const defender = await unitManager.createUnit('player-456', 'warriors', 11, 10);

        await expect(
          unitManager.executeUnitAction(attacker.id, ActionType.BOMBARD, 11, 10, 'player-123')
        ).resolves.toMatchObject({
          success: true,
          affectedUnitIds: [defender.id],
        });
        expect(defender.health).toBeGreaterThanOrEqual(1);
        expect(defender.health).toBeLessThan(100);
        expect(attacker.movementLeft).toBe(0);
      } finally {
        UNIT_TYPES.archers.bombardRate = originalRate;
      }
    });

    it('recovers persisted automation mode and order', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'automated-unit',
          gameId,
          playerId: 'player-123',
          unitType: 'warriors',
          x: 10,
          y: 10,
          movementPoints: '3',
          health: 100,
          veteranLevel: 0,
          experience: 0,
          isFortified: false,
          isAutomated: true,
          orders: [{ type: 'autoExplore' }],
          currentOrder: 'autoExplore',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('automated-unit')).toMatchObject({
        automation: 'explore',
        orders: [{ type: 'autoExplore' }],
      });
    });
  });

  describe('Milestone 15 consequences', () => {
    const makeMap = (hut = false) => {
      const tiles = new Map<string, any>();
      for (const [x, y] of [
        [10, 10],
        [11, 10],
        [12, 10],
        [11, 9],
        [11, 11],
      ]) {
        tiles.set(`${x},${y}`, {
          x,
          y,
          terrain: 'grassland',
          improvements: hut && x === 11 && y === 10 ? ['Hut'] : [],
          hasRoad: false,
          hasRailroad: false,
          claimer: undefined,
        });
      }
      const mapData = { width: mapWidth, height: mapHeight, tiles: [] };
      return {
        tiles,
        manager: {
          getTile: jest.fn((x: number, y: number) => tiles.get(`${x},${y}`)),
          updateTileProperty: jest.fn((x: number, y: number, property: string, value: unknown) => {
            tiles.get(`${x},${y}`)[property] = value;
          }),
          getMapData: jest.fn(() => mapData),
        },
      };
    };

    it('detonates a nuclear actor, destroys the blast stack, damages cities, and adds fallout', async () => {
      const map = makeMap();
      const applyNuclearCityDamage = jest.fn(async () => ['city-1']);
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        map.manager,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          applyNuclearCityDamage,
          broadcastMapChanged: jest.fn(),
        },
        undefined,
        () => 0.99
      );
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        unitDestroyed: true,
        affectedUnitIds: expect.arrayContaining([nuclear.id, defender.id]),
      });
      expect(manager.getUnit(nuclear.id)).toBeUndefined();
      expect(manager.getUnit(defender.id)).toBeUndefined();
      expect(applyNuclearCityDamage).toHaveBeenCalledWith(11, 10, 1, 'player-123');
      expect(map.tiles.get('11,10').improvements).toContain('fallout');
    });

    it('always consumes a missile after its suicide attack', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        undefined,
        () => 0.99
      );
      const missile = await manager.createUnit('player-123', 'cruise_missile', 10, 10);
      await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(missile.id, ActionType.SUICIDE_ATTACK, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, unitDestroyed: true });
      expect(manager.getUnit(missile.id)).toBeUndefined();
    });

    it('collects ruleset ransom from and destroys a barbarian stack', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.query.players.findFirst.mockResolvedValue({
        nation: 'barbarian',
        civilization: 'Barbarian',
        gold: 500,
      });
      const collector = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const leader = await unitManager.createUnit('barbarian-player', 'barbarian_leader', 11, 10);

      await expect(
        unitManager.executeUnitAction(collector.id, ActionType.COLLECT_RANSOM, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        targetDestroyed: true,
        message: expect.stringContaining('100 gold'),
      });
      expect(unitManager.getUnit(leader.id)).toBeUndefined();
    });

    it('does not ransom a barbarian leader protected by an ordinary escort', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.query.players.findFirst.mockResolvedValue({
        nation: 'barbarian',
        civilization: 'Barbarian',
        gold: 500,
      });
      const collector = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      const leader = await unitManager.createUnit('barbarian-player', 'barbarian_leader', 11, 10);
      const escort = await unitManager.createUnit('barbarian-player', 'warriors', 11, 10);

      await expect(
        unitManager.executeUnitAction(collector.id, ActionType.COLLECT_RANSOM, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false });
      expect(unitManager.getUnit(leader.id)).toBeDefined();
      expect(unitManager.getUnit(escort.id)).toBeDefined();
    });

    it('treats a barbarian attacker as hostile without a diplomacy record', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.query.players.findFirst.mockImplementation(({ where }: any) => {
        void where;
        return Promise.resolve({ nation: 'barbarian', civilization: 'barbarian-land' });
      });
      unitManager.setHostilityProvider(async () => false);
      const attacker = await unitManager.createUnit('barbarian-player', 'horsemen', 10, 10);
      const defender = await unitManager.createUnit('player-123', 'warriors', 11, 10);

      await expect(unitManager.attackUnit(attacker.id, defender.id)).resolves.toMatchObject({
        attackerId: attacker.id,
        defenderId: defender.id,
      });
    });

    it('resolves and persists a hut reward when movement enters the tile', async () => {
      const map = makeMap(true);
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        map.manager,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          broadcastMapChanged: jest.fn(),
        },
        undefined,
        () => 0
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);

      await manager.moveUnit(explorer.id, 11, 10);

      expect(map.tiles.get('11,10').improvements).not.toContain('Hut');
      expect(map.manager.getMapData).toHaveBeenCalled();
      expect((mockDbProvider.getDatabase() as any).update).toHaveBeenCalled();
    });

    it('delegates the barbarian hut roll without killing a protected explorer', async () => {
      const spawnHutBarbarians = jest.fn().mockResolvedValue(true);
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          spawnHutBarbarians,
        },
        undefined,
        () => 10 / 14
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);

      await (manager as any).resolveHutReward(explorer);

      expect(spawnHutBarbarians).toHaveBeenCalledWith('player-123', 10, 10);
      expect(manager.getUnit(explorer.id)).toBeDefined();
    });

    it('creates nomad settlers when a hut city roll cannot found a city', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity: jest.fn().mockRejectedValue(new Error('Tile cannot host a city')),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
        },
        undefined,
        () => 11 / 14
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);

      await (manager as any).resolveHutReward(explorer);

      expect(
        manager.getPlayerUnits('player-123').some(unit => unit.unitTypeId === 'settlers')
      ).toBe(true);
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
