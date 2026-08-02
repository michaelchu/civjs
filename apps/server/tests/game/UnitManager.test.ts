import { UnitManager } from '@game/managers/UnitManager';
import { UNIT_TYPES } from '@game/constants/UnitConstants';
import { EffectsManager } from '@game/managers/EffectsManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { ActionType } from '@app-types/shared/actions';
import { MapTopology, TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { CIV2CIV3_ORACLE_BASELINE, loadCiv2Civ3OracleResults } from './Civ2Civ3OracleResults';

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
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenCalledWith(
        expect.objectContaining({
          isAutomated: false,
          automationMode: null,
          automationTask: null,
          orders: [],
          currentOrder: null,
        })
      );
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

    const createCiv2Civ3Manager = (random: () => number = Math.random) =>
      new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        undefined,
        new EffectsManager('civ2civ3'),
        random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );

    it('cancels a persisted terrain activity on a city founder', async () => {
      const settler = await unitManager.createUnit('player-123', 'settlers', 10, 10);
      settler.automation = 'worker';
      settler.orders = [
        {
          type: 'mine',
          activity: {
            type: 'mining',
            turnsRemaining: 1,
            totalTurns: 2,
            target: { x: 10, y: 10 },
          },
        },
      ];

      await unitManager.processUnitOrders('player-123');

      expect(settler.orders).toEqual([]);
      expect(settler.automation).toBeUndefined();
      expect(tile.improvements).not.toContain('mine');
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenCalledWith(
        expect.objectContaining({
          isAutomated: false,
          automationMode: null,
          automationTask: null,
          orders: [],
          currentOrder: null,
        })
      );
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

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1110-1119
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:574-614
     * @reference reference/freeciv/common/unit.c:969-1118
     * @assertion A c2c3 Worker can start Build Road on roadable Grassland and queues the authoritative road activity.
     * @c2c3-action Build Road
     * @c2c3-scenario normal
     */
    it('starts Build Road from the c2c3 Worker and terrain enablers', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_ROAD)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_ROAD,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'road' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1110-1119
     * @reference reference/freeciv/common/unit.c:969-1118
     * @assertion A c2c3 non-Worker cannot start Build Road even on a terrain where roads are possible.
     * @c2c3-action Build Road
     * @c2c3-scenario rejected
     */
    it('rejects Build Road from a c2c3 non-Worker', async () => {
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.BUILD_ROAD)).toBe(false);
      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.BUILD_ROAD,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false });
      expect(warrior.orders).toBeUndefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1110-1119
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:574-614
     * @reference reference/freeciv/common/unit.c:969-1118
     * @assertion C2c3 Grassland road_time is exactly two turns: its road activity remains incomplete after one turn and completes after the second.
     * @c2c3-action Build Road
     * @c2c3-scenario boundary
     * @c2c3-surface workers-extras
     * @c2c3-surface-scenario turn
     */
    it('uses the exact two-turn c2c3 Grassland road duration', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      await manager.executeUnitAction(
        worker.id,
        ActionType.BUILD_ROAD,
        undefined,
        undefined,
        'player-123'
      );
      await manager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(false);
      expect(worker.orders?.[0].activity).toMatchObject({
        type: 'building_road',
        turnsRemaining: 1,
        totalTurns: 2,
      });

      await manager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(true);
      expect(tile.improvements).toContain('road');
      expect(worker.orders).toEqual([]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:70-88
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:612-646
     * @reference reference/freeciv/server/unittools.c:893-900
     * @assertion A c2c3 Engineer rolls its configured work veterancy chance once per useful activity turn, before terrain transformation is complete.
     * @c2c3-surface workers-extras
     * @c2c3-surface-scenario turn
     */
    it('applies c2c3 Engineer work veterancy during an unfinished transform activity', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager(() => 0);
      manager.setPlayerTechsProvider(() => new Set(['Fusion Power']));
      const engineer = await manager.createUnit('player-123', 'engineers', 10, 10);

      await manager.executeUnitAction(
        engineer.id,
        ActionType.TRANSFORM_TERRAIN,
        undefined,
        undefined,
        'player-123'
      );
      await manager.processUnitOrders('player-123');

      expect(engineer.orders?.[0]?.activity?.turnsRemaining).toBe(11);
      expect(engineer.veteranLevel).toBe(1);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1179-1205
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-614
     * @assertion A c2c3 Worker can start Build Irrigation on Grassland when an ocean tile shares an edge with the worksite.
     * @c2c3-action Build Irrigation
     * @c2c3-scenario normal
     */
    it('starts c2c3 Build Irrigation beside an ocean source', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);
      mapManager.getTile.mockImplementation((x: number, y: number) =>
        x === 10 && y === 9 ? ({ ...tile, x, y, terrain: 'ocean' } as typeof tile) : tile
      );

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_IRRIGATION,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'irrigate' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1179-1205
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-614
     * @assertion A c2c3 Worker without Electricity cannot start Build Irrigation on Grassland without an edge-adjacent ocean or IrrigationSource extra.
     * @c2c3-action Build Irrigation
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Build Irrigation without a source before Electricity', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(false);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_IRRIGATION,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false });
      expect(worker.orders).toBeUndefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1165-1177
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-614
     * @assertion Electricity lets a c2c3 Worker start Grassland irrigation with no edge-adjacent water or IrrigationSource extra.
     * @c2c3-action Build Irrigation
     * @c2c3-scenario boundary
     */
    it('allows c2c3 Build Irrigation without a source after Electricity', async () => {
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Electricity']));
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_IRRIGATION)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_IRRIGATION,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'irrigate' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1131-1142
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:637-666
     * @assertion A c2c3 Worker can start Build Mine on Hills, where the terrain exposes CanMine.
     * @c2c3-action Build Mine
     * @c2c3-scenario normal
     */
    it('starts c2c3 Build Mine for a Worker on Hills', async () => {
      tile.terrain = 'hills';
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_MINE)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_MINE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'mine' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1131-1142
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:637-666
     * @assertion A c2c3 non-Worker cannot start Build Mine even on a mineable Hills tile.
     * @c2c3-action Build Mine
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Build Mine from a non-Worker', async () => {
      tile.terrain = 'hills';
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.BUILD_MINE)).toBe(false);
      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.BUILD_MINE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false });
      expect(warrior.orders).toBeUndefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1144-1154
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:368-397
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:1355-1372
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:2267-2280
     * @assertion A c2c3 Transport with Miniaturization can start Build Mine on Deep Ocean, selecting an Oil Platform rather than a land Mine.
     * @c2c3-action Build Mine
     * @c2c3-scenario boundary
     */
    it('selects the c2c3 Oil Platform mine result on Deep Ocean', async () => {
      tile.terrain = 'deep_ocean';
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Miniaturization']));
      const transport = await manager.createUnit('player-123', 'transport', 10, 10);

      expect(manager.canUnitPerformAction(transport.id, ActionType.BUILD_MINE)).toBe(true);
      await expect(
        manager.executeUnitAction(
          transport.id,
          ActionType.BUILD_MINE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(transport.orders).toEqual([{ type: 'mine', improvementType: 'oil_platform' }]);

      for (let turn = 0; turn < 10; turn++) {
        await manager.processUnitOrders('player-123');
      }

      expect(tile.improvements).toContain('oil_platform');
      expect(tile.improvements).not.toContain('mine');
      expect(transport.orders).toEqual([]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1060-1066
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:532-561
     * @assertion A c2c3 Worker can start Cultivate only on terrain with a cultivate result, such as Forest.
     * @c2c3-action Cultivate
     * @c2c3-scenario normal
     */
    it('starts c2c3 Cultivate for a Worker on Forest', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.CULTIVATE)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.CULTIVATE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'cultivate' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1060-1066
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:532-561
     * @assertion A c2c3 non-Worker cannot start Cultivate even when Forest has a cultivate result.
     * @c2c3-action Cultivate
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Cultivate from a non-Worker', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.CULTIVATE)).toBe(false);
      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.CULTIVATE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1060-1066
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-614
     * @assertion A c2c3 Worker cannot start Cultivate on Grassland because it has no cultivate result or duration.
     * @c2c3-action Cultivate
     * @c2c3-scenario boundary
     */
    it('rejects c2c3 Cultivate on terrain without a cultivate result', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.CULTIVATE)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1068-1074
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:532-561
     * @assertion A c2c3 Worker can start Plant on Forest, which has Grassland as its plant result.
     * @c2c3-action Plant
     * @c2c3-scenario normal
     */
    it('starts c2c3 Plant for a Worker on Forest', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.PLANT)).toBe(true);
      await expect(
        manager.executeUnitAction(worker.id, ActionType.PLANT, undefined, undefined, 'player-123')
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'plant' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1068-1074
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:532-561
     * @assertion A c2c3 non-Worker cannot start Plant even when Forest has a plant result.
     * @c2c3-action Plant
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Plant from a non-Worker', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.PLANT)).toBe(false);
      await expect(
        manager.executeUnitAction(warrior.id, ActionType.PLANT, undefined, undefined, 'player-123')
      ).resolves.toMatchObject({ success: false });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1068-1074
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:637-666
     * @assertion A c2c3 Worker cannot start Plant on Hills because Hills has no plant result or duration.
     * @c2c3-action Plant
     * @c2c3-scenario boundary
     */
    it('rejects c2c3 Plant on terrain without a plant result', async () => {
      tile.terrain = 'hills';
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.PLANT)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1051-1058
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:532-561
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:612-654
     * @assertion An Engineer with Fusion Power can start c2c3 Transform Terrain on Forest.
     * @c2c3-action Transform Terrain
     * @c2c3-scenario normal
     */
    it('starts c2c3 Transform Terrain for an Engineer with Fusion Power', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Fusion Power']));
      const engineer = await manager.createUnit('player-123', 'engineers', 10, 10);

      expect(manager.canUnitPerformAction(engineer.id, ActionType.TRANSFORM_TERRAIN)).toBe(true);
      await expect(
        manager.executeUnitAction(
          engineer.id,
          ActionType.TRANSFORM_TERRAIN,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(engineer.orders).toEqual([{ type: 'transform' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1051-1058
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:573-609
     * @assertion A Worker lacks c2c3's Transform unit flag and cannot start Transform Terrain even after Fusion Power.
     * @c2c3-action Transform Terrain
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Transform Terrain from a Worker without the Transform flag', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Fusion Power']));
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.TRANSFORM_TERRAIN)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1051-1058
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:612-654
     * @assertion An Engineer without Fusion Power cannot start c2c3 Transform Terrain.
     * @c2c3-action Transform Terrain
     * @c2c3-scenario boundary
     */
    it('requires Fusion Power before c2c3 Transform Terrain', async () => {
      tile.terrain = 'forest';
      const manager = createCiv2Civ3Manager();
      const engineer = await manager.createUnit('player-123', 'engineers', 10, 10);

      expect(manager.canUnitPerformAction(engineer.id, ActionType.TRANSFORM_TERRAIN)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1083-1088
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-620
     * @assertion A c2c3 Worker can start Clean when Pollution is present on the tile.
     * @c2c3-action Clean
     * @c2c3-scenario normal
     */
    it('starts c2c3 Clean for a Worker on Pollution', async () => {
      tile.improvements = ['pollution'];
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.CLEAN_POLLUTION)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.CLEAN_POLLUTION,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'cleanPollution' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1083-1088
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-620
     * @assertion A c2c3 non-Worker cannot start Clean even when Pollution is present.
     * @c2c3-action Clean
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Clean from a non-Worker', async () => {
      tile.improvements = ['pollution'];
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.CLEAN_POLLUTION)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1083-1088
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:586-620
     * @assertion A c2c3 Worker cannot start Clean on a tile with neither Pollution nor Fallout.
     * @c2c3-action Clean
     * @c2c3-scenario boundary
     */
    it('requires a c2c3 nuisance extra before starting Clean', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.CLEAN_POLLUTION)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1076-1081
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:157-175
     * @assertion A Land-class c2c3 Warrior can start Pillage when a road is present.
     * @c2c3-action Pillage
     * @c2c3-scenario normal
     */
    it('starts c2c3 Pillage for a CanPillage unit on a road', async () => {
      tile.hasRoad = true;
      tile.improvements = ['road'];
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.PILLAGE)).toBe(true);
      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.PILLAGE,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(warrior.orders).toEqual([{ type: 'pillage' }]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1076-1081
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:167-175
     * @assertion A Small Land c2c3 Worker lacks CanPillage and cannot start Pillage even when a road is present.
     * @c2c3-action Pillage
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Pillage from a unit class without CanPillage', async () => {
      tile.hasRoad = true;
      tile.improvements = ['road'];
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.PILLAGE)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1076-1081
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:157-175
     * @assertion A c2c3 CanPillage unit cannot start Pillage without an existing removable extra.
     * @c2c3-action Pillage
     * @c2c3-scenario boundary
     */
    it('requires a removable c2c3 extra before starting Pillage', async () => {
      const manager = createCiv2Civ3Manager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.PILLAGE)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1121-1129
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:1547-1580
     * @assertion A c2c3 Worker with Construction starts Build Base by creating the prerequisite Fort on a legal land tile.
     * @c2c3-action Build Base
     * @c2c3-scenario normal
     */
    it('starts the c2c3 Fort stage of Build Base before Fortress', async () => {
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Construction']));
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_FORTRESS,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'fortress', improvementType: 'fort' }]);

      await manager.processUnitOrders('player-123');
      expect(worker.orders?.[0].activity).toMatchObject({ turnsRemaining: 1, totalTurns: 2 });
      await manager.processUnitOrders('player-123');
      expect(tile.improvements).toContain('fort');
      expect(tile.improvements).not.toContain('fortress');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1121-1129
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:1547-1580
     * @assertion c2c3 Build Base rejects a Worker without the Construction technology required to create Fort.
     * @c2c3-action Build Base
     * @c2c3-scenario rejected
     */
    it('requires Construction before c2c3 Build Base can create Fort', async () => {
      const manager = createCiv2Civ3Manager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1121-1129
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:1581-1626
     * @assertion Once a c2c3 Fort is present, the same Build Base action advances to Fortress instead of placing another Fort.
     * @c2c3-action Build Base
     * @c2c3-scenario boundary
     */
    it('advances c2c3 Build Base from Fort to Fortress', async () => {
      tile.improvements = ['fort'];
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Construction']));
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(true);
      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.BUILD_FORTRESS,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(worker.orders).toEqual([{ type: 'fortress' }]);

      await manager.processUnitOrders('player-123');
      await manager.processUnitOrders('player-123');
      expect(tile.improvements).toEqual(expect.arrayContaining(['fort', 'fortress']));
    });

    it('uses the same c2c3 Build Base progression for Airstrip and Airbase', async () => {
      const manager = createCiv2Civ3Manager();
      manager.setPlayerTechsProvider(() => new Set(['Radio']));
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.BUILD_AIRBASE)).toBe(true);
      await manager.executeUnitAction(
        worker.id,
        ActionType.BUILD_AIRBASE,
        undefined,
        undefined,
        'player-123'
      );
      expect(worker.orders).toEqual([{ type: 'airbase', improvementType: 'airstrip' }]);
      await manager.processUnitOrders('player-123');
      await manager.processUnitOrders('player-123');
      expect(tile.improvements).toContain('airstrip');

      const upgrader = await manager.createUnit('player-123', 'worker', 10, 10);
      expect(manager.canUnitPerformAction(upgrader.id, ActionType.BUILD_AIRBASE)).toBe(true);
      await manager.executeUnitAction(
        upgrader.id,
        ActionType.BUILD_AIRBASE,
        undefined,
        undefined,
        'player-123'
      );
      expect(upgrader.orders).toEqual([{ type: 'airbase' }]);
      await manager.processUnitOrders('player-123');
      await manager.processUnitOrders('player-123');
      expect(tile.improvements).toEqual(expect.arrayContaining(['airstrip', 'airbase']));
    });

    it('validates a planned worker activity against its future worksite', async () => {
      const current = {
        x: 10,
        y: 10,
        terrain: 'grassland',
        hasRoad: true,
        hasRailroad: false,
        improvements: ['road'],
      };
      const target = {
        x: 11,
        y: 10,
        terrain: 'grassland',
        hasRoad: false,
        hasRailroad: false,
        improvements: [] as string[],
      };
      mapManager.getTile.mockImplementation((x: number, y: number) =>
        x === target.x && y === target.y ? target : current
      );
      const worker = await unitManager.createUnit('player-123', 'worker', current.x, current.y);

      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_ROAD)).toBe(false);
      expect(
        unitManager.canUnitPerformActionAt(worker.id, ActionType.BUILD_ROAD, target.x, target.y)
      ).toBe(true);
      expect(worker).toMatchObject({ x: current.x, y: current.y });
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

    it('applies the Engineer double work rate', async () => {
      const engineer = await unitManager.createUnit('player-123', 'engineers', 10, 10);

      await unitManager.executeUnitAction(
        engineer.id,
        ActionType.BUILD_ROAD,
        undefined,
        undefined,
        'player-123'
      );
      await unitManager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(true);
      expect(engineer.orders).toEqual([]);
    });

    it('lets a worker join an activity that already has progress', async () => {
      const first = await unitManager.createUnit('player-123', 'worker', 10, 10);
      await unitManager.executeUnitAction(
        first.id,
        ActionType.BUILD_ROAD,
        undefined,
        undefined,
        'player-123'
      );
      await unitManager.processUnitOrders('player-123');
      expect(first.orders?.[0]?.activity?.turnsRemaining).toBe(1);

      const second = await unitManager.createUnit('player-123', 'worker', 10, 10);
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

    it('keeps conflicting activities independent on the same tile', async () => {
      const roadBuilder = await unitManager.createUnit('player-123', 'worker', 10, 10);
      const miner = await unitManager.createUnit('player-123', 'worker', 10, 10);
      roadBuilder.orders = [{ type: 'road' }];
      miner.orders = [{ type: 'mine' }];

      await unitManager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(false);
      expect(roadBuilder.orders?.[0]?.type).toBe('road');
      expect(miner.orders).toEqual([]);
      expect(tile.improvements).toContain('mine');

      await unitManager.processUnitOrders('player-123');

      expect(tile.hasRoad).toBe(true);
      expect(roadBuilder.orders).toEqual([]);
      expect(tile.improvements).toContain('mine');
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

    it('projects only currently executable worker actions', async () => {
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);

      expect(unitManager.getAvailableWorkerActions(worker.id)).toEqual(
        expect.arrayContaining([ActionType.BUILD_ROAD, ActionType.PLANT])
      );
      expect(unitManager.getAvailableWorkerActions(worker.id)).not.toContain(
        ActionType.BUILD_RAILROAD
      );
      expect(unitManager.getAvailableWorkerActions(worker.id)).not.toContain(
        ActionType.BUILD_IRRIGATION
      );

      tile.hasRoad = true;
      unitManager.setPlayerTechsProvider(() => new Set(['railroad']));
      expect(unitManager.getAvailableWorkerActions(worker.id)).toContain(ActionType.BUILD_RAILROAD);
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

    it('returns no Partisans when every surrounding tile is illegal', async () => {
      mapManager.getTile.mockImplementation((x: number, y: number) => ({
        ...tile,
        x,
        y,
        terrain: 'ocean',
      }));

      await expect(
        unitManager.createPartisans('player-456', { x: 10, y: 10 }, 4, 1)
      ).resolves.toEqual([]);
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
      tile.improvements = ['fort', 'airstrip'];
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
      tile.improvements = ['fort'];
      unitManager.setPlayerTechsProvider(() => new Set(['construction']));
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_FORTRESS)).toBe(true);
    });

    it('evaluates civ2civ3 extra requirements before exposing railroad work', async () => {
      unitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        undefined,
        new EffectsManager('civ2civ3'),
        undefined,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const worker = await unitManager.createUnit('player-123', 'worker', 10, 10);
      tile.hasRoad = true;
      unitManager.setPlayerTechsProvider(() => new Set());
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_RAILROAD)).toBe(false);
      unitManager.setPlayerTechsProvider(() => new Set(['Railroad']));
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_RAILROAD)).toBe(true);

      tile.hasRoad = false;
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_RAILROAD)).toBe(false);
      tile.terrain = 'ocean';
      tile.hasRoad = true;
      expect(unitManager.canUnitPerformAction(worker.id, ActionType.BUILD_ROAD)).toBe(false);
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

    it('transfers transported stacks together with the city tile', async () => {
      unitManager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, undefined, {
        foundCity: jest.fn(),
        requestPath: jest.fn(),
        broadcastUnitMoved: jest.fn(),
        getCityAt: jest.fn((x, y) =>
          x === 10 && y === 10 ? { id: 'city-1', playerId: 'player-456' } : null
        ),
      });
      const transport = await unitManager.createUnit('player-456', 'trireme', 10, 10, 'city-1');
      const cargo = await unitManager.createUnit('player-456', 'warriors', 10, 10, 'city-1');
      await unitManager.loadUnitOntoTransport(transport.id, cargo.id);

      await unitManager.reconcileCityOwnership(
        { id: 'city-1', x: 10, y: 10 },
        'player-456',
        'player-123'
      );

      expect(transport).toMatchObject({ playerId: 'player-123', homeCityId: 'city-1' });
      expect(cargo).toMatchObject({
        playerId: 'player-123',
        homeCityId: 'city-1',
        transportedBy: transport.id,
      });
    });

    it('leaves allied units occupying a transferred city untouched', async () => {
      const allied = await unitManager.createUnit('player-789', 'warriors', 10, 10, 'ally-city');
      const formerOwner = await unitManager.createUnit('player-456', 'warriors', 10, 10, 'city-1');

      await unitManager.reconcileCityOwnership(
        { id: 'city-1', x: 10, y: 10 },
        'player-456',
        'player-123'
      );

      expect(allied).toMatchObject({ playerId: 'player-789', homeCityId: 'ally-city' });
      expect(formerOwner).toMatchObject({ playerId: 'player-123', homeCityId: 'city-1' });
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

    it('blocks peaceful military border entry while allowing civilian entry', async () => {
      const requestPath = jest.fn(async () => ({
        success: true,
        path: {
          tiles: [
            { x: 10, y: 10, moveCost: 0 },
            { x: 11, y: 10, moveCost: 3 },
          ],
        },
      }));
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        {
          getTile: (x: number, y: number) => ({
            x,
            y,
            terrain: 'grassland',
            improvements: [],
            owner: x === 11 ? 'player-456' : undefined,
          }),
        } as any,
        {
          foundCity: jest.fn().mockResolvedValue('city-1'),
          requestPath,
          broadcastUnitMoved: jest.fn(),
        },
        undefined,
        undefined,
        rulesetUnitsService.getUnitTypes('classic')
      );
      manager.setAlliedPlayersProvider(() => new Set());
      manager.setHostilePlayersProvider(() => new Set());
      manager.setHostilityProvider(async () => false);
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      await expect(
        manager.executeUnitAction(warrior.id, ActionType.GOTO, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: false,
        message: 'Cannot invade unless you break peace with player-456 first.',
      });
      expect(requestPath).not.toHaveBeenCalled();
      await expect(manager.moveUnit(warrior.id, 11, 10)).rejects.toThrow(
        'Cannot invade unless you break peace with player-456 first.'
      );

      const settler = await manager.createUnit('player-123', 'settlers', 10, 11);
      (manager as any).calculateTerrainMovementCost = jest.fn(() => 3);
      expect((manager as any).getPathStepCost(settler, 10, 11, 11, 11, true)).toBe(3);
      await expect(manager.moveUnit(settler.id, 11, 11)).resolves.toBe(true);
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
        new EffectsManager('civ2civ3'),
        undefined,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const storm = await manager.createUnit('player-123', 'storm', 10, 10);

      expect(manager.getUnitsWithRandomMovement('player-123')).toEqual([storm]);
      const result = await manager.executeRandomMovement(storm.id);

      expect(result).toMatchObject({
        success: true,
        fromTile: { x: 10, y: 10 },
        movementPointsUsed: 6,
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
    const cities = new Map<string, { id: string; playerId: string }>();
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
      cities.clear();
      mapManager.getTile.mockClear();
      unitManager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        mapManager,
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: (x, y) => cities.get(`${x},${y}`) ?? null,
        },
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

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:74-79
     * @reference reference/freeciv/common/movement.c:117-128
     * @assertion Civ2Civ3 units receive six movement fragments and its road and railroad costs are expressed in those fragments.
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario normal, boundary
     */
    it('uses Civ2Civ3 six-fragment road and railroad costs', async () => {
      const openGroundUnit = await unitManager.createUnit('player-123', 'warriors', 5, 5);
      expect(openGroundUnit.movementLeft).toBe(6);
      await unitManager.moveUnit(openGroundUnit.id, 6, 5);
      expect(openGroundUnit.movementLeft).toBe(0);

      roads.add('10,10');
      roads.add('11,10');
      const roadUnit = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      await unitManager.moveUnit(roadUnit.id, 11, 10);
      expect(roadUnit.movementLeft).toBe(5);

      railroads.add('20,20');
      railroads.add('21,20');
      const railUnit = await unitManager.createUnit('player-123', 'warriors', 20, 20);
      await unitManager.moveUnit(railUnit.id, 21, 20);
      expect(railUnit.movementLeft).toBe(6);
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

    /**
     * @evidence parity
     * @reference reference/freeciv/common/unit.c:743-840
     * @reference reference/freeciv/server/unithand.c:918-941
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1327-1364
     * @assertion Civ2Civ3 cargo boards in a city, sails with its transport, then disembarks to a legal adjacent tile while spending terrain movement.
     * @c2c3-action Transport Disembark
     * @c2c3-scenario normal
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario normal
     */
    it('loads ruleset-compatible cargo, moves it, and unloads onto land', async () => {
      terrain.set('10,10', 'grassland');
      terrain.set('11,10', 'ocean');
      terrain.set('12,10', 'grassland');
      cities.set('10,10', { id: 'port-city', playerId: 'player-123' });
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
      expect(cargo.movementLeft).toBe(0);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/unit.c:743-840
     * @reference reference/freeciv/server/unithand.c:838-917
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1292-1325
     * @assertion Transport Board permits allied cargo and transfers it directly between compatible transports on a shared city tile; Transport Deboard preserves movement on that tile.
     * @c2c3-action Transport Board
     * @c2c3-scenario normal
     * @c2c3-action Transport Deboard
     * @c2c3-scenario normal
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario normal
     */
    it('boards allied transports, transfers cargo, and deboards without spending movement', async () => {
      terrain.set('10,10', 'grassland');
      cities.set('10,10', { id: 'port-city', playerId: 'player-123' });
      unitManager.setAlliedPlayersProvider(
        playerId => new Set(playerId === 'player-123' ? ['player-456'] : ['player-123'])
      );
      const firstTransport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const alliedTransport = await unitManager.createUnit('player-456', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      await expect(unitManager.loadUnitOntoTransport(firstTransport.id, cargo.id)).resolves.toBe(
        true
      );
      const movementBeforeTransfer = cargo.movementLeft;
      await expect(unitManager.loadUnitOntoTransport(alliedTransport.id, cargo.id)).resolves.toBe(
        true
      );
      expect(firstTransport.cargoUnits).toEqual([]);
      expect(alliedTransport.cargoUnits).toEqual([cargo.id]);
      expect(cargo.transportedBy).toBe(alliedTransport.id);

      await expect(unitManager.unloadUnit(cargo.id, 10, 10)).resolves.toBe(true);
      expect(cargo.transportedBy).toBeUndefined();
      expect(cargo.movementLeft).toBe(movementBeforeTransfer);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/unit.c:743-789
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:290-294
     * @assertion A cargo unit without an embarks declaration cannot board its transport away from a city or compatible native base.
     * @c2c3-action Transport Board
     * @c2c3-scenario rejected
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario boundary
     */
    it('rejects Civ2Civ3 boarding away from a city or native base', async () => {
      terrain.set('10,10', 'ocean');
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit('player-123', 'warriors', 10, 10);

      expect(unitManager.canLoadUnit(transport.id, cargo.id)).toBe(false);
      await expect(unitManager.loadUnitOntoTransport(transport.id, cargo.id)).resolves.toBe(false);
    });

    it('rescues cargo to a legal tile when its transport is destroyed', async () => {
      const transport = await unitManager.createUnit('player-123', 'trireme', 10, 10);
      const cargo = await unitManager.createUnit(
        'player-123',
        'warriors',
        10,
        10,
        undefined,
        transport.id
      );

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
      const ordinary = await unitManager.createUnit(
        'player-123',
        'warriors',
        10,
        10,
        undefined,
        transport.id
      );
      const leader = await unitManager.createUnit(
        'player-123',
        'leader',
        10,
        10,
        undefined,
        transport.id
      );
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
      const cargo = await unitManager.createUnit(
        'player-123',
        'warriors',
        10,
        10,
        undefined,
        transport.id
      );

      await unitManager.removeUnit(transport.id);

      expect(unitManager.getUnit(cargo.id)).toBeUndefined();
    });

    it('preserves missile movement when launching from a compatible transport', async () => {
      terrain.set('10,10', 'ocean');
      terrain.set('11,10', 'ocean');
      const transport = await unitManager.createUnit('player-123', 'submarine', 10, 10);
      const missile = await unitManager.createUnit(
        'player-123',
        'cruise_missile',
        10,
        10,
        undefined,
        transport.id
      );

      missile.movementLeft = unitManager.getUnitMaxMovement('cruise_missile');
      await expect(unitManager.unloadUnit(missile.id, 11, 10)).resolves.toBe(true);

      expect(missile.transportedBy).toBeUndefined();
      expect(missile.movementLeft).toBe(unitManager.getUnitMaxMovement('cruise_missile') - 6);
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
      const marine = await marineManager.createUnit(
        'player-123',
        'marines',
        10,
        10,
        undefined,
        transport.id
      );
      marine.movementLeft = marineManager.getUnitMaxMovement('marines');
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
      const warrior = await unitManager.createUnit(
        'player-123',
        'warriors',
        10,
        10,
        undefined,
        transport.id
      );
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
      const combatObserver = jest.fn();
      unitManager.setCombatObserver(combatObserver);

      const result = await unitManager.attackUnit(attackerUnitId, defenderUnitId);

      expect(result.attackerId).toBe(attackerUnitId);
      expect(result.defenderId).toBe(defenderUnitId);
      expect(result.attackerDamage + result.defenderDamage).toBeGreaterThan(0);
      expect(result.attackerDestroyed || result.defenderDestroyed).toBe(true);
      expect(combatObserver).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({
            attackerId: attackerUnitId,
            defenderId: defenderUnitId,
          }),
        })
      );

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

    it('applies tired attack from the active ruleset', async () => {
      const classicAttacker = await unitManager.createUnit('player-123', 'warriors', 10, 10);
      classicAttacker.movementLeft = 1;

      const civ2civ3Manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        Math.random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const civ2civ3Attacker = await civ2civ3Manager.createUnit('player-123', 'warriors', 10, 10);
      civ2civ3Attacker.movementLeft = 1;

      expect(
        (unitManager as any).calculateAttackStrength(classicAttacker, UNIT_TYPES.warriors)
      ).toBe(1);
      expect(
        (civ2civ3Manager as any).calculateAttackStrength(
          civ2civ3Attacker,
          civ2civ3Manager.getUnitType('warriors')
        )
      ).toBe(0);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:70-88
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1547-1556
     * @reference reference/freeciv/server/unittools.c:238-278
     * @assertion A Tribal c2c3 Legion that defeats a Warrior gains veterancy when the +50 Veteran_Combat effect raises its odds above the deterministic roll.
     * @c2c3-action Gain Veterancy
     * @c2c3-scenario normal
     * @c2c3-surface combat
     * @c2c3-surface-scenario normal
     */
    it('applies c2c3 Tribal Veteran_Combat to a real combat promotion', async () => {
      const rolls = [...Array(10).fill(0.99), 0.4];
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        () => rolls.shift() ?? 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      manager.setPlayerGovernmentProvider(() => 'Tribal');
      const legion = await manager.createUnit('player-123', 'legion', 10, 10);
      const warrior = await manager.createUnit('player-456', 'warriors', 11, 10);

      const result = await manager.attackUnit(legion.id, warrior.id);

      expect(result).toMatchObject({
        attackerDestroyed: false,
        defenderDestroyed: true,
        experienceGained: { attacker: 1, defender: 0 },
      });
      expect(manager.getUnit(legion.id)?.veteranLevel).toBe(1);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/server/unittools.c:238-278
     * @assertion Accumulated CivJS experience bookkeeping cannot bypass Freeciv's Gain Veterancy opportunity and promote a c2c3 unit.
     */
    it('does not promote c2c3 units from the legacy accumulated experience table', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(manager.awardExperience(warrior.id, 1000)).resolves.toBe(false);
      expect(manager.getUnit(warrior.id)).toMatchObject({ experience: 1000, veteranLevel: 0 });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/server/diplomats.c:2414-2426
     * @reference reference/freeciv/server/unittools.c:238-278
     * @assertion A surviving c2c3 Spy mission receives the source-defined Gain Veterancy roll instead of an accumulated experience promotion.
     * @c2c3-action Gain Veterancy
     * @c2c3-scenario normal
     */
    it('applies the c2c3 veterancy opportunity for a surviving Spy mission', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const spy = await manager.createUnit('player-123', 'spy', 10, 10);

      await expect(manager.maybePromoteAfterDiplomaticAction(spy.id)).resolves.toBe(true);
      expect(manager.getUnit(spy.id)?.veteranLevel).toBe(1);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1430-1435
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:2859-2887
     * @reference reference/freeciv/server/unittools.c:248-278
     * @assertion A c2c3 Storm's NoVeteran flag rejects the Gain Veterancy action even when it is given a guaranteed combat roll.
     * @c2c3-action Gain Veterancy
     * @c2c3-scenario rejected
     */
    it('rejects c2c3 Gain Veterancy for a NoVeteran unit', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const storm = await manager.createUnit('player-123', 'storm', 10, 10);

      await expect((manager as any).maybePromoteAfterCombat(storm, 200, 1, 1)).resolves.toBe(false);
      expect(storm.veteranLevel).toBe(0);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:2349-2367
     * @reference reference/freeciv/server/unittools.c:248-278
     * @assertion A c2c3 Nuclear unit has exactly one veteran level, so Gain Veterancy cannot promote it beyond green even with a guaranteed roll.
     * @c2c3-action Gain Veterancy
     * @c2c3-scenario boundary
     */
    it('caps c2c3 Gain Veterancy at a unit-specific one-level profile', async () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);

      await expect((manager as any).maybePromoteAfterCombat(nuclear, 200, 1, 1)).resolves.toBe(
        false
      );
      expect(nuclear.veteranLevel).toBe(0);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:70-88
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:612-646
     * @assertion A hardened c2c3 Engineer receives no movement fragments from veterancy; its source-defined move bonus remains zero while its two whole moves use Civ2Civ3's six fragments each.
     */
    it('keeps c2c3 veteran movement source-derived instead of using a generic bonus', () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        undefined,
        new EffectsManager('civ2civ3'),
        Math.random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const engineerType = manager.getUnitType('engineers')!;

      expect((manager as any).getUnitMovementPoints('player-123', engineerType, 2, 100)).toBe(12);
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
      const combatObserver = jest.fn();
      deterministicManager.setCombatObserver(combatObserver);

      const result = await deterministicManager.attackUnit(attacker.id, defender.id);

      expect(result.defenderId).toBe(stackedDefender.id);
      expect(result.collateralDestroyedIds).toEqual([defender.id]);
      expect(deterministicManager.getUnit(defender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(stackedDefender.id)).toBeUndefined();
      expect(deterministicManager.getUnit(attacker.id)).toMatchObject({ x: 11, y: 10 });
      expect(combatObserver).toHaveBeenCalledWith(
        expect.objectContaining({
          collateralUnits: [
            expect.objectContaining({
              id: defender.id,
              playerId: 'player-456',
              unitTypeId: 'warriors',
              x: 11,
              y: 10,
            }),
          ],
        })
      );
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

    /**
     * @evidence parity
     * @reference reference/freeciv/data/classic/effects.ruleset:953-962
     * @assertion City Walls and city fortification effects produce the same integer defense multiplier for a land defender.
     */
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

    it('reduces repeated covert mission odds using persisted theft count', async () => {
      const spy = await unitManager.createUnit('player-123', 'spy', 10, 10);
      expect(
        unitManager.calculateDiplomatActionOdds(spy, ActionType.STEAL_TECH, undefined, 0)
          .successChance
      ).toBe(0.75);
      expect(
        unitManager.calculateDiplomatActionOdds(spy, ActionType.STEAL_TECH, undefined, 2)
          .successChance
      ).toBe(0.55);
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

    /**
     * @evidence parity
     * @reference reference/freeciv/server/unittools.c:429-465
     * @reference reference/freeciv/server/unittools.c:1558-1597
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3280-3286
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:127-128
     * @assertion Leonardo's Workshop upgrades one otherwise eligible Civ2Civ3 unit for free outside a city before its new type receives movement for the next usable turn and the auto-upgrade veteran loss.
     * @c2c3-surface cities
     * @c2c3-surface-scenario turn
     */
    it("applies Leonardo's Workshop's free Civ2Civ3 upgrade when movement resets", async () => {
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
          getPlayerBuildings: () => ['leonardos_workshop'],
        },
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      manager.setPlayerTechsProvider(() => new Set(['gunpowder']));
      const warrior = await manager.createUnit('player-123', 'warriors', 15, 10);
      warrior.veteranLevel = 2;
      warrior.movementLeft = 0;
      const database = mockDbProvider.getDatabase() as any;

      await manager.resetMovement('player-123');

      expect(warrior).toMatchObject({
        unitTypeId: 'musketeers',
        veteranLevel: 1,
        movementLeft: 6,
      });
      expect(database.select).not.toHaveBeenCalled();
      expect(database.set).toHaveBeenCalledWith(
        expect.objectContaining({
          unitType: 'musketeers',
          veteranLevel: 1,
          maxMovementPoints: '6',
        })
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/server/unittools.c:429-465
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3280-3286
     * @assertion Leonardo's Workshop only upgrades as many eligible Civ2Civ3 units as its Upgrade_Unit effect value each turn.
     * @c2c3-surface cities
     * @c2c3-surface-scenario turn
     */
    it("limits Leonardo's Workshop to one free Civ2Civ3 upgrade per turn", async () => {
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
          getPlayerBuildings: () => ['leonardos_workshop'],
        },
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      manager.setPlayerTechsProvider(() => new Set(['gunpowder']));
      const warrior = await manager.createUnit('player-123', 'warriors', 15, 10);
      const archer = await manager.createUnit('player-123', 'archers', 16, 10);

      await manager.resetMovement('player-123');

      expect([warrior, archer].filter(unit => unit.unitTypeId === 'musketeers')).toHaveLength(1);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/server/unittools.c:429-465
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3280-3286
     * @assertion An obsolete Civ2Civ3 unit remains unchanged at turn start without the player-scoped Leonardo's Workshop Upgrade_Unit effect.
     * @c2c3-surface cities
     * @c2c3-surface-scenario turn
     */
    it("does not grant a free upgrade without Leonardo's Workshop", async () => {
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
          getPlayerBuildings: () => [],
        },
        new EffectsManager('civ2civ3'),
        () => 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      manager.setPlayerTechsProvider(() => new Set(['gunpowder']));
      const warrior = await manager.createUnit('player-123', 'warriors', 15, 10);

      await manager.resetMovement('player-123');

      expect(warrior).toMatchObject({ unitTypeId: 'warriors', movementLeft: 6 });
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

    it('spends air movement when a fueled aircraft launches from a carrier', async () => {
      const carrier = await unitManager.createUnit('player-123', 'carrier', 10, 10);
      const bomber = await unitManager.createUnit(
        'player-123',
        'bomber',
        10,
        10,
        undefined,
        carrier.id
      );
      bomber.movementLeft = unitManager.getUnitMaxMovement('bomber');

      expect(await unitManager.unloadUnit(bomber.id, 11, 10)).toBe(true);

      expect(bomber.transportedBy).toBeUndefined();
      expect(bomber.movementLeft).toBe(unitManager.getUnitMaxMovement('bomber') - 3);
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
      const unit = await unitManager.createUnit('player-456', 'worker', 10, 10);
      await unitManager.executeUnitAction(unit.id, ActionType.AUTO_SETTLER);
      await unitManager.setWorkerAutomationTask(unit.id, {
        action: ActionType.BUILD_ROAD,
        targetX: 11,
        targetY: 10,
        assignedTurn: 2,
      });
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
        automation: undefined,
        automationTask: undefined,
      });
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          playerId: 'player-123',
          movementPoints: '0',
          automationMode: null,
          automationTask: null,
        })
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

  describe('Civ2Civ3 transport-sensitive relocation actions', () => {
    const actionMap = {
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: 'grassland',
        improvements: [],
      })),
    };

    const createManager = () => {
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        actionMap,
        {
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
          reserveAirlift: jest.fn().mockResolvedValue(true),
        },
        new EffectsManager('civ2civ3'),
        Math.random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      return manager;
    };

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:983-1013
     * @reference reference/freeciv/server/unittools.c:4083-4122
     * @assertion A transported paratrooper can paradrop from a city when it has no cargo of its own; the relocation unloads it from the former transport.
     * @c2c3-action Paradrop Unit Enter
     * @c2c3-scenario normal
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario normal
     */
    it('unloads a transported Civ2Civ3 paratrooper when it paradrops', async () => {
      const manager = createManager();
      const transport = await manager.createUnit('player-123', 'trireme', 10, 10);
      const paratrooper = await manager.createUnit('player-123', 'paratroopers', 10, 10);
      await expect(manager.loadUnitOntoTransport(transport.id, paratrooper.id)).resolves.toBe(true);

      await expect(
        manager.executeUnitAction(paratrooper.id, ActionType.PARADROP, 16, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, newPosition: { x: 16, y: 10 } });

      expect(paratrooper).toMatchObject({ x: 16, y: 10, transportedBy: undefined });
      expect(transport.cargoUnits).toEqual([]);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1043-1049
     * @reference reference/freeciv/server/unittools.c:3062-3095
     * @reference reference/freeciv/server/unittools.c:4083-4122
     * @assertion Airlift Unit accepts an Airliftable passenger, rejects an actor carrying cargo, and unit_move unloads the passenger before relocation.
     * @c2c3-action Airlift Unit
     * @c2c3-scenario normal, rejected
     * @c2c3-surface movement-transport
     * @c2c3-surface-scenario boundary
     */
    it('airlifts a passenger but not a cargo-carrying Civ2Civ3 actor', async () => {
      const manager = createManager();
      const transport = await manager.createUnit('player-123', 'trireme', 10, 10);
      const passenger = await manager.createUnit('player-123', 'warriors', 10, 10);
      await expect(manager.loadUnitOntoTransport(transport.id, passenger.id)).resolves.toBe(true);

      await expect(
        manager.executeUnitAction(passenger.id, ActionType.AIRLIFT, 30, 20, 'player-123')
      ).resolves.toMatchObject({ success: true, newPosition: { x: 30, y: 20 } });
      expect(passenger).toMatchObject({ x: 30, y: 20, movementLeft: 0, transportedBy: undefined });
      expect(transport.cargoUnits).toEqual([]);

      const helicopter = await manager.createUnit('player-123', 'helicopter', 10, 10);
      const helicopterCargo = await manager.createUnit('player-123', 'warriors', 10, 10);
      await expect(manager.loadUnitOntoTransport(helicopter.id, helicopterCargo.id)).resolves.toBe(
        true
      );
      expect(manager.canUnitPerformAction(helicopter.id, ActionType.AIRLIFT, 30, 20)).toBe(false);
    });
  });

  describe('Civ2Civ3 direct combat action enablers', () => {
    const createManager = () => {
      const terrain = new Map<string, string>();
      const cityOwners = new Map<string, string>();
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        {
          getTile: jest.fn((x: number, y: number) => ({
            x,
            y,
            terrain: terrain.get(`${x},${y}`) ?? 'grassland',
            improvements: [],
          })),
        },
        {
          foundCity: jest.fn(),
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          getCityAt: (x, y) =>
            cityOwners.has(`${x},${y}`)
              ? {
                  id: `city-${x}-${y}`,
                  playerId: cityOwners.get(`${x},${y}`)!,
                  buildings: [],
                  population: 4,
                }
              : null,
        },
        new EffectsManager('civ2civ3'),
        () => 0.99,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      return { manager, terrain, cityOwners };
    };

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1090-1108
     * @assertion Fortify permits a CanFortify unit on ordinary terrain even after it has spent its movement, because the source enabler has no MinMoveFrags requirement.
     * @c2c3-action Fortify
     * @c2c3-scenario normal
     */
    it('fortifies an exhausted Civ2Civ3 warrior on ordinary terrain', async () => {
      const { manager } = createManager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      warrior.movementLeft = 0;

      expect(manager.canUnitPerformAction(warrior.id, ActionType.FORTIFY)).toBe(true);
      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.FORTIFY,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true });
      expect(warrior).toMatchObject({ fortified: true, movementLeft: 0 });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1090-1108
     * @assertion Fortify rejects a unit with the Cant_Fortify type flag even when its class has CanFortify.
     * @c2c3-action Fortify
     * @c2c3-scenario rejected
     */
    it('rejects Civ2Civ3 worker fortification', async () => {
      const { manager } = createManager();
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      expect(manager.canUnitPerformAction(worker.id, ActionType.FORTIFY)).toBe(false);
      await expect(
        manager.executeUnitAction(worker.id, ActionType.FORTIFY, undefined, undefined, 'player-123')
      ).resolves.toMatchObject({ success: false });
      expect(worker.fortified).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1090-1108
     * @reference reference/freeciv/data/civ2civ3/terrain.ruleset:353-358
     * @assertion Fortify rejects NoFortify ocean terrain, while the CityTile Center enabler remains an explicit exception.
     * @c2c3-action Fortify
     * @c2c3-scenario boundary
     */
    it('applies the Civ2Civ3 NoFortify terrain and city-center exception', async () => {
      const { manager, terrain, cityOwners } = createManager();
      terrain.set('10,10', 'ocean');
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      expect(manager.canUnitPerformAction(warrior.id, ActionType.FORTIFY)).toBe(false);
      await expect(manager.fortifyUnit(warrior.id)).rejects.toThrow('Unit cannot perform Fortify');

      cityOwners.set('10,10', 'player-123');
      expect(manager.canUnitPerformAction(warrior.id, ActionType.FORTIFY)).toBe(true);
      await expect(manager.fortifyUnit(warrior.id)).resolves.toBeUndefined();
      expect(warrior).toMatchObject({ fortified: true, movementLeft: 0 });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:794-824
     * @assertion Attack allows a non-Missile military unit with movement to attack an adjacent hostile unit from a native tile.
     * @c2c3-action Attack
     * @c2c3-scenario normal
     */
    it('allows a native Civ2Civ3 attack against a hostile adjacent unit', async () => {
      const { manager } = createManager();
      manager.setHostilityProvider(async () => true);
      const attacker = await manager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(manager.attackUnit(attacker.id, defender.id)).resolves.toMatchObject({
        attackerId: attacker.id,
        defenderId: defender.id,
      });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:794-824
     * @assertion Attack requires the C2C3 War diplomatic relation before combat can begin.
     * @c2c3-action Attack
     * @c2c3-scenario rejected
     */
    it('rejects a Civ2Civ3 attack at peace', async () => {
      const { manager } = createManager();
      manager.setHostilityProvider(async () => false);
      const attacker = await manager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(manager.attackUnit(attacker.id, defender.id)).rejects.toThrow(
        'Cannot attack a player unless at war'
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:794-824
     * @reference reference/freeciv/data/civ2civ3/units.ruleset:39-44
     * @assertion Attack rejects a land unit launched from a non-native tile, but permits the Marines type-flag exception.
     * @c2c3-action Attack
     * @c2c3-scenario boundary
     */
    it('enforces Civ2Civ3 native attack origins and the Marines exception', async () => {
      const { manager, terrain } = createManager();
      manager.setHostilityProvider(async () => true);
      terrain.set('10,10', 'ocean');
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(manager.attackUnit(warrior.id, defender.id)).rejects.toThrow(
        'Unit cannot attack from a non-native tile'
      );

      terrain.set('10,12', 'ocean');
      const marine = await manager.createUnit('player-123', 'marines', 10, 12);
      const coastalDefender = await manager.createUnit('player-456', 'warriors', 11, 12);
      coastalDefender.health = 1;

      await expect(manager.attackUnit(marine.id, coastalDefender.id)).resolves.toMatchObject({
        defenderDestroyed: true,
      });

      const missile = await manager.createUnit('player-123', 'cruise_missile', 10, 14);
      const missileTarget = await manager.createUnit('player-456', 'warriors', 11, 14);
      await expect(manager.attackUnit(missile.id, missileTarget.id)).rejects.toThrow(
        'Missile units must use a suicide attack'
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:697-727
     * @assertion Bombard allows an untransported Bombarder unit to damage an adjacent hostile land stack.
     * @c2c3-action Bombard
     * @c2c3-scenario normal
     */
    it('bombards a hostile Civ2Civ3 land unit', async () => {
      const { manager } = createManager();
      manager.setHostilityProvider(async () => true);
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      expect(manager.canUnitPerformAction(bomber.id, ActionType.BOMBARD, 11, 10)).toBe(true);
      await expect(
        manager.executeUnitAction(bomber.id, ActionType.BOMBARD, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, affectedUnitIds: [defender.id] });
      expect(defender.health).toBeLessThan(100);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:697-710
     * @reference reference/freeciv/server/unithand.c:4632-4735
     * @assertion Bombard remains legal against a hostile city even when its tile has no unit stack to damage.
     * @c2c3-action Bombard
     * @c2c3-scenario normal
     */
    it('allows Civ2Civ3 bombardment of an undefended hostile city', async () => {
      const { manager, cityOwners } = createManager();
      manager.setHostilityProvider(async () => true);
      cityOwners.set('11,10', 'player-456');
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);

      expect(manager.canUnitPerformAction(bomber.id, ActionType.BOMBARD, 11, 10)).toBe(true);
      await expect(
        manager.executeUnitAction(bomber.id, ActionType.BOMBARD, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, affectedUnitIds: [] });
      expect(bomber.movementLeft).toBe(0);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:697-727
     * @assertion Bombard rejects a target area when diplomacy does not report War.
     * @c2c3-action Bombard
     * @c2c3-scenario rejected
     */
    it('rejects Civ2Civ3 bombardment at peace', async () => {
      const { manager } = createManager();
      manager.setHostilityProvider(async () => false);
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);
      await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(bomber.id, ActionType.BOMBARD, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false, message: 'Bombardment requires a state of war' });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:697-727
     * @assertion Bombard excludes Oceanic targets and transported actors before it can be offered to the player.
     * @c2c3-action Bombard
     * @c2c3-scenario boundary
     */
    it('excludes Civ2Civ3 ocean targets and transported bombarding actors', async () => {
      const { manager, terrain } = createManager();
      terrain.set('11,10', 'ocean');
      const bomber = await manager.createUnit('player-123', 'bomber', 10, 10);
      await manager.createUnit('player-456', 'warriors', 11, 10);

      expect(manager.canUnitPerformAction(bomber.id, ActionType.BOMBARD, 11, 10)).toBe(false);

      terrain.set('11,10', 'grassland');
      bomber.transportedBy = 'carrier-id';
      expect(manager.canUnitPerformAction(bomber.id, ActionType.BOMBARD, 11, 10)).toBe(false);
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:872-881
     * @assertion Suicide Attack lets a Missile-class unit spend movement on an adjacent hostile target and always consumes the actor.
     * @c2c3-action Suicide Attack
     * @c2c3-scenario normal
     */
    it('consumes a Civ2Civ3 cruise missile after its suicide attack', async () => {
      const { manager } = createManager();
      manager.setHostilityProvider(async () => true);
      const missile = await manager.createUnit('player-123', 'cruise_missile', 10, 10);
      await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(missile.id, ActionType.SUICIDE_ATTACK, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: true, unitDestroyed: true });
      expect(manager.getUnit(missile.id)).toBeUndefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:872-881
     * @assertion Suicide Attack rejects an actor outside the Missile unit class.
     * @c2c3-action Suicide Attack
     * @c2c3-scenario rejected
     */
    it('rejects a non-Missile Civ2Civ3 suicide attack', async () => {
      const { manager } = createManager();
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(warrior.id, ActionType.SUICIDE_ATTACK, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false, message: 'Unit cannot perform a suicide attack' });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:872-881
     * @assertion Suicide Attack has a MinMoveFrags requirement, so a missile with no movement cannot act.
     * @c2c3-action Suicide Attack
     * @c2c3-scenario boundary
     */
    it('requires movement for a Civ2Civ3 suicide attack', async () => {
      const { manager } = createManager();
      const missile = await manager.createUnit('player-123', 'cruise_missile', 10, 10);
      missile.movementLeft = 0;
      await manager.createUnit('player-456', 'warriors', 11, 10);

      expect(manager.canUnitPerformAction(missile.id, ActionType.SUICIDE_ATTACK, 11, 10)).toBe(
        false
      );
      await expect(
        manager.executeUnitAction(missile.id, ActionType.SUICIDE_ATTACK, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false, message: 'Unit cannot perform a suicide attack' });
    });
  });

  describe('Civ2Civ3 unit upgrades', () => {
    const createManager = () => {
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
          getCityAt: (x, y) =>
            x === 10 && y === 10 ? { id: 'upgrade-city', playerId: 'player-123' } : null,
        },
        new EffectsManager('civ2civ3'),
        Math.random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      manager.setPlayerTechsProvider(() => new Set(['explosives', 'invention']));
      return manager;
    };

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1034-1039
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:465-473
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4618-4625
     * @reference reference/freeciv/common/unittype.c:1757-1771
     * @reference reference/freeciv/server/unittools.c:1558-1597
     * @assertion Civ2Civ3 upgrades value the old unit at 50 percent, apply the Invention price reduction, and retain proportional movement.
     * @c2c3-action Upgrade Unit
     * @c2c3-scenario normal
     */
    it('applies Civ2Civ3 upgrade effects and proportional movement', async () => {
      const manager = createManager();
      const database = mockDbProvider.getDatabase() as any;
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);
      database.where.mockResolvedValueOnce([{ gold: 30 }]);
      worker.movementLeft = 3;

      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.UPGRADE_UNIT,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({
        success: true,
        message: 'Workers upgraded to Engineers for 30 gold',
      });

      expect(worker).toMatchObject({
        unitTypeId: 'engineers',
        veteranLevel: 0,
        movementLeft: 6,
      });
      expect(database.set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          unitType: 'engineers',
          veteranLevel: 0,
          movementPoints: '6',
          maxMovementPoints: '12',
        })
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/game.ruleset:121-128
     * @reference reference/freeciv/server/unittools.c:1558-1597
     * @assertion Civ2Civ3 clips the destination veteran profile and then removes one veteran level during a manual upgrade.
     * @c2c3-action Upgrade Unit
     * @c2c3-scenario normal
     */
    it('loses one Civ2Civ3 veteran level during an upgrade', async () => {
      const manager = createManager();
      manager.setPlayerTechsProvider(() => new Set(['gunpowder', 'invention']));
      const database = mockDbProvider.getDatabase() as any;
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);
      database.where.mockResolvedValueOnce([{ gold: 65 }]);
      warrior.veteranLevel = 2;
      warrior.movementLeft = 3;

      await expect(
        manager.executeUnitAction(
          warrior.id,
          ActionType.UPGRADE_UNIT,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({
        success: true,
        message: 'Warriors upgraded to Musketeers for 65 gold',
      });
      expect(warrior).toMatchObject({ unitTypeId: 'musketeers', veteranLevel: 1, movementLeft: 3 });
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/unit.c:2052-2082
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:465-473
     * @assertion The discount is still a real treasury cost: an otherwise eligible unit cannot upgrade when the player has less than the effect-adjusted price.
     * @c2c3-action Upgrade Unit
     * @c2c3-scenario rejected
     */
    it('rejects an upgrade without the effect-adjusted treasury cost', async () => {
      const manager = createManager();
      const database = mockDbProvider.getDatabase() as any;
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);
      database.where.mockResolvedValueOnce([{ gold: 29 }]);

      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.UPGRADE_UNIT,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false, message: 'Upgrade requires 30 gold' });
      expect(worker.unitTypeId).toBe('worker');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/unit.c:2052-2082
     * @assertion Upgrade Unit requires an owned city even when the unit has a researched obsolete replacement and enough gold.
     * @c2c3-action Upgrade Unit
     * @c2c3-scenario boundary
     */
    it('requires an owned Civ2Civ3 city to upgrade a unit', async () => {
      const manager = createManager();
      const database = mockDbProvider.getDatabase() as any;
      database.where.mockResolvedValueOnce([{ gold: 100 }]);
      const worker = await manager.createUnit('player-123', 'worker', 11, 10);

      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.UPGRADE_UNIT,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: false, message: 'Unit cannot be upgraded here' });
      expect(worker.unitTypeId).toBe('worker');
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

    it('defers auto-worker selection to the shared end-of-turn service', async () => {
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

      expect(worker.orders).toEqual([{ type: 'autoSettler' }]);
      expect(worker.automation).toBe('worker');
    });

    it('toggles Auto Worker off and clears its persisted assignment', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap);
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);

      await manager.executeUnitAction(
        worker.id,
        ActionType.AUTO_SETTLER,
        undefined,
        undefined,
        'player-123'
      );
      await manager.setWorkerAutomationTask(worker.id, {
        action: ActionType.BUILD_ROAD,
        targetX: 12,
        targetY: 10,
        assignedTurn: 3,
      });

      await expect(
        manager.executeUnitAction(
          worker.id,
          ActionType.AUTO_SETTLER,
          undefined,
          undefined,
          'player-123'
        )
      ).resolves.toMatchObject({ success: true, newOrders: [] });
      expect(worker).toMatchObject({ orders: [], automation: undefined });
      expect(worker.automationTask).toBeUndefined();
      expect((mockDbProvider.getDatabase() as any).set).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isAutomated: false,
          automationMode: null,
          automationTask: null,
          orders: [],
        })
      );
    });

    it('clears assignment-owned movement when a worker task is invalidated', async () => {
      const manager = new UnitManager(gameId, mockDbProvider, mapWidth, mapHeight, specialMap);
      const worker = await manager.createUnit('player-123', 'worker', 10, 10);
      await manager.executeUnitAction(
        worker.id,
        ActionType.AUTO_SETTLER,
        undefined,
        undefined,
        'player-123'
      );
      const task = {
        action: ActionType.BUILD_ROAD,
        targetX: 12,
        targetY: 10,
        assignedTurn: 3,
      };
      await manager.setWorkerAutomationTask(worker.id, task);
      worker.orders = [{ type: 'move', targetX: 12, targetY: 10 }];

      await manager.setWorkerAutomationTask(worker.id, undefined);

      expect(worker).toMatchObject({
        automation: 'worker',
        automationTask: undefined,
        orders: [{ type: 'autoSettler' }],
      });
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

    it('recovers persisted cooperative worker activity progress', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'persisted-worker',
          gameId,
          playerId: 'player-123',
          unitType: 'worker',
          x: 10,
          y: 10,
          movementPoints: '0',
          health: 100,
          veteranLevel: 0,
          experience: 0,
          isFortified: false,
          isAutomated: false,
          orders: [
            {
              type: 'road',
              activity: {
                type: 'building_road',
                turnsRemaining: 1,
                totalTurns: 2,
                target: { x: 10, y: 10 },
              },
            },
          ],
          currentOrder: 'road',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('persisted-worker')).toMatchObject({
        orders: [
          expect.objectContaining({
            type: 'road',
            activity: expect.objectContaining({ turnsRemaining: 1, totalTurns: 2 }),
          }),
        ],
      });
    });

    it('recovers legacy worker mode from an activity followed by autoSettler', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'legacy-auto-worker',
          gameId,
          playerId: 'player-123',
          unitType: 'worker',
          x: 10,
          y: 10,
          movementPoints: '0',
          health: 100,
          veteranLevel: 0,
          experience: 0,
          isFortified: false,
          isAutomated: true,
          automationMode: null,
          automationTask: null,
          orders: [{ type: 'road' }, { type: 'autoSettler' }],
          currentOrder: 'road',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('legacy-auto-worker')).toMatchObject({
        automation: 'worker',
        orders: [{ type: 'road' }, { type: 'autoSettler' }],
      });
    });

    it('recovers canonical worker mode and task independently from current activity', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'canonical-auto-worker',
          gameId,
          playerId: 'player-123',
          unitType: 'worker',
          x: 10,
          y: 10,
          movementPoints: '0',
          health: 100,
          veteranLevel: 0,
          experience: 0,
          isFortified: false,
          isAutomated: true,
          automationMode: 'worker',
          automationTask: {
            action: ActionType.BUILD_ROAD,
            targetX: 10,
            targetY: 10,
            assignedTurn: 4,
          },
          orders: [{ type: 'road' }, { type: 'autoSettler' }],
          currentOrder: 'road',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('canonical-auto-worker')).toMatchObject({
        automation: 'worker',
        automationTask: {
          action: ActionType.BUILD_ROAD,
          targetX: 10,
          targetY: 10,
          assignedTurn: 4,
        },
      });
    });

    it('keeps worker mode but discards a semantically invalid persisted task', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'invalid-task-auto-worker',
          gameId,
          playerId: 'player-123',
          unitType: 'worker',
          x: 10,
          y: 10,
          movementPoints: '3',
          health: 100,
          veteranLevel: 0,
          experience: 0,
          isFortified: false,
          isAutomated: true,
          automationMode: 'worker',
          automationTask: {
            action: ActionType.ATTACK,
            targetX: 11,
            targetY: 10,
            assignedTurn: 4,
          },
          orders: [{ type: 'autoSettler' }],
          currentOrder: 'autoSettler',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('invalid-task-auto-worker')).toMatchObject({
        automation: 'worker',
        orders: [{ type: 'autoSettler' }],
      });
      expect(unitManager.getUnit('invalid-task-auto-worker')?.automationTask).toBeUndefined();
    });

    it('does not infer explore mode for legacy automated rally movement', async () => {
      const db = mockDbProvider.getDatabase() as any;
      db.where.mockResolvedValueOnce([
        {
          id: 'legacy-rally-unit',
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
          automationMode: null,
          automationTask: null,
          orders: [{ type: 'move', targetX: 12, targetY: 10 }],
          currentOrder: 'move',
          transportedBy: null,
          cargoUnits: [],
          homeCityId: null,
        },
      ]);

      await unitManager.loadUnits();

      expect(unitManager.getUnit('legacy-rally-unit')?.automation).toBeUndefined();
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

    const makeNuclearMap = () => {
      const tiles = new Map<string, any>();
      for (let x = 7; x <= 15; x += 1) {
        for (let y = 7; y <= 15; y += 1) {
          tiles.set(`${x},${y}`, {
            x,
            y,
            terrain: 'grassland',
            improvements: [],
            hasRoad: false,
            hasRailroad: false,
          });
        }
      }
      const mapData = { width: mapWidth, height: mapHeight, tiles: [] };
      return {
        tiles,
        manager: {
          getTile: jest.fn((x: number, y: number) => tiles.get(`${x},${y}`)),
          getTopology: jest.fn(
            () =>
              new MapTopology(mapWidth, mapHeight, {
                topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
                wrapId: WrapFlag.X | WrapFlag.Y,
              })
          ),
          updateTileProperty: jest.fn((x: number, y: number, property: string, value: unknown) => {
            tiles.get(`${x},${y}`)[property] = value;
          }),
          getMapData: jest.fn(() => mapData),
        },
      };
    };

    const createCiv2Civ3NuclearManager = (
      map: ReturnType<typeof makeNuclearMap>,
      cities = new Map<string, { id: string; playerId: string; buildings?: string[] }>(),
      random: () => number = () => 0.99
    ) => {
      const applyNuclearCityDamage = jest.fn(async () => [] as string[]);
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
          getCityAt: (x, y) => cities.get(`${x},${y}`) ?? null,
          applyNuclearCityDamage,
        },
        new EffectsManager('civ2civ3'),
        random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      return { manager, applyNuclearCityDamage };
    };

    const oracle = loadCiv2Civ3OracleResults();

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

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:173-187
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:765-770
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4135-4141
     * @reference reference/freeciv/server/unittools.c:3039-3065
     * @assertion Explode Nuclear can be performed in place with zero movement, consumes the actor, and uses the c2c3 squared blast radius of two.
     * @c2c3-action Explode Nuclear
     * @c2c3-scenario normal, boundary
     * @c2c3-surface combat
     * @c2c3-surface-scenario normal, boundary
     */
    it('detonates a c2c3 Nuclear in place without movement and kills an in-range hex unit', async () => {
      const map = makeNuclearMap();
      const { manager, applyNuclearCityDamage } = createCiv2Civ3NuclearManager(map);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 0;
      const hexNeighbor = await manager.createUnit('player-456', 'warriors', 11, 11);

      expect(manager.canUnitPerformAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 10, 10)).toBe(
        true
      );
      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 10, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        unitDestroyed: true,
        affectedUnitIds: expect.arrayContaining([nuclear.id, hexNeighbor.id]),
      });

      expect(manager.getUnit(nuclear.id)).toBeUndefined();
      expect(manager.getUnit(hexNeighbor.id)).toBeUndefined();
      expect(applyNuclearCityDamage).toHaveBeenCalledWith(10, 10, 2, 'player-123');
      expect(map.tiles.get('11,11').improvements).toContain('fallout');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:765-770
     * @assertion Explode Nuclear is unavailable to an actor without the Nuclear unit-type flag.
     * @c2c3-action Explode Nuclear
     * @c2c3-scenario rejected
     */
    it('rejects in-place detonation by a non-Nuclear c2c3 unit', async () => {
      const map = makeNuclearMap();
      const { manager } = createCiv2Civ3NuclearManager(map);
      const warrior = await manager.createUnit('player-123', 'warriors', 10, 10);

      await expect(
        manager.executeUnitAction(warrior.id, ActionType.NUCLEAR_EXPLOSION, 10, 10, 'player-123')
      ).resolves.toMatchObject({ success: false });
      expect(manager.getUnit(warrior.id)).toBeDefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:189-208
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:772-779
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4151-4157
     * @assertion Nuke City requires an adjacent foreign city and war, then applies the c2c3 squared blast effect to its target tile.
     * @c2c3-action Nuke City
     * @c2c3-scenario normal
     */
    it('nukes an adjacent enemy c2c3 city while at war', async () => {
      const map = makeNuclearMap();
      const cities = new Map([
        ['11,10', { id: 'target-city', playerId: 'player-456', buildings: [] }],
      ]);
      const { manager, applyNuclearCityDamage } = createCiv2Civ3NuclearManager(map, cities);
      manager.setHostilityProvider(async () => true);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;
      const hexNeighbor = await manager.createUnit('player-456', 'warriors', 12, 11);

      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        affectedUnitIds: expect.arrayContaining([nuclear.id, hexNeighbor.id]),
      });

      expect(applyNuclearCityDamage).toHaveBeenCalledWith(11, 10, 2, 'player-123');
      expect(manager.getUnit(hexNeighbor.id)).toBeUndefined();
      expect(map.tiles.get('11,10').improvements).not.toContain('fallout');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:772-779
     * @assertion Nuke City is rejected without the source action's required war relation and leaves the actor intact.
     * @c2c3-action Nuke City
     * @c2c3-scenario rejected
     */
    it('rejects a c2c3 city nuke against a non-hostile foreign city', async () => {
      const map = makeNuclearMap();
      const cities = new Map([
        ['11,10', { id: 'target-city', playerId: 'player-456', buildings: [] }],
      ]);
      const { manager, applyNuclearCityDamage } = createCiv2Civ3NuclearManager(map, cities);
      manager.setHostilityProvider(async () => false);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;

      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false });

      expect(manager.getUnit(nuclear.id)).toBeDefined();
      expect(applyNuclearCityDamage).not.toHaveBeenCalled();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2616-2625
     * @reference reference/freeciv/common/combat.c:499-526
     * @reference reference/freeciv/server/unithand.c:4739-4805
     * @assertion A foreign SDI city in the source's square radius two intercepts an adjacent Nuke City action, consumes the actor, and prevents all blast consequences.
     * @c2c3-action Nuke City
     * @c2c3-scenario boundary
     * @c2c3-surface combat
     * @c2c3-surface-scenario boundary
     */
    it('intercepts a c2c3 city nuke from an SDI city at square radius two', async () => {
      const map = makeNuclearMap();
      const cities = new Map([
        ['11,10', { id: 'target-city', playerId: 'player-456', buildings: [] }],
        ['13,12', { id: 'sdi-city', playerId: 'player-789', buildings: ['sdi_defense'] }],
      ]);
      const { manager, applyNuclearCityDamage } = createCiv2Civ3NuclearManager(
        map,
        cities,
        () => 0
      );
      manager.setHostilityProvider(async () => true);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;

      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false, unitDestroyed: true });

      expect(manager.getUnit(nuclear.id)).toBeUndefined();
      expect(applyNuclearCityDamage).not.toHaveBeenCalled();
      expect(map.tiles.get('11,10').improvements).not.toContain('fallout');
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:210-223
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:781-792
     * @reference reference/freeciv/common/actions.c:2925-2929
     * @assertion Nuke Units requires an eligible foreign stack on a non-city tile and a war relation before detonating.
     * @c2c3-action Nuke Units
     * @c2c3-scenario normal
     */
    it('nukes an adjacent foreign c2c3 unit stack while at war', async () => {
      const map = makeNuclearMap();
      const { manager } = createCiv2Civ3NuclearManager(map);
      manager.setHostilityProvider(async () => true);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;
      const defender = await manager.createUnit('player-456', 'warriors', 11, 10);

      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        affectedUnitIds: expect.arrayContaining([nuclear.id, defender.id]),
      });
      expect(manager.getUnit(defender.id)).toBeUndefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/common/actions.c:4640-4664
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:781-792
     * @assertion Nuke Units is unavailable for a known empty tile.
     * @c2c3-action Nuke Units
     * @c2c3-scenario rejected
     */
    it('rejects a c2c3 unit nuke against an empty tile', async () => {
      const map = makeNuclearMap();
      const { manager } = createCiv2Civ3NuclearManager(map);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;

      expect(manager.canUnitPerformAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10)).toBe(
        false
      );
      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 10, 'player-123')
      ).resolves.toMatchObject({ success: false });
      expect(manager.getUnit(nuclear.id)).toBeDefined();
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:210-223
     * @reference reference/freeciv/common/actions.c:4558-4589
     * @assertion Nuke Units accepts an adjacent ISO-hex stack at its exact maximum source range of one.
     * @c2c3-action Nuke Units
     * @c2c3-scenario boundary
     */
    it('accepts an ISO-hex adjacent c2c3 unit nuke at range one', async () => {
      const map = makeNuclearMap();
      const { manager } = createCiv2Civ3NuclearManager(map);
      manager.setHostilityProvider(async () => true);
      const nuclear = await manager.createUnit('player-123', 'nuclear', 10, 10);
      nuclear.movementLeft = 1;
      const defender = await manager.createUnit('player-456', 'warriors', 11, 11);

      expect(manager.canUnitPerformAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 11)).toBe(
        true
      );
      await expect(
        manager.executeUnitAction(nuclear.id, ActionType.NUCLEAR_EXPLOSION, 11, 11, 'player-123')
      ).resolves.toMatchObject({
        success: true,
        affectedUnitIds: expect.arrayContaining([nuclear.id, defender.id]),
      });
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
      const broadcastHutEvent = jest.fn();
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
          broadcastHutEvent,
        },
        undefined,
        () => 0
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);

      await manager.moveUnit(explorer.id, 11, 10);

      expect(map.tiles.get('11,10').improvements).not.toContain('Hut');
      expect(map.manager.getMapData).toHaveBeenCalled();
      expect((mockDbProvider.getDatabase() as any).update).toHaveBeenCalled();
      expect(broadcastHutEvent).toHaveBeenCalledWith(
        gameId,
        'player-123',
        'Your unit found 25 gold in a goody hut.'
      );
    });

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/script.lua:12-15
     * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1402-1428
     * @reference reference/freeciv/server/unittools.c:3357-3380
     * @reference reference/freeciv/data/default/default.lua:177-185
     * @assertion A c2c3 HutFrighten-class unit on a non-native tile removes a hut without rolling a hut reward, and emits the inherited tribe-scatter event.
     * @c2c3-action Frighten Hut 2
     * @c2c3-scenario normal
     * @c2c3-surface workers-extras
     * @c2c3-surface-scenario boundary
     * @c2c3-script-hook hut_frighten
     */
    it('frightens a hut instead of claiming its reward for a c2c3 aircraft', async () => {
      const map = makeMap(true);
      const broadcastHutEvent = jest.fn();
      const random = jest.fn(() => {
        throw new Error('Frightening a hut must not roll a hut reward');
      });
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
          broadcastHutEvent,
        },
        new EffectsManager('civ2civ3'),
        random,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const fighter = await manager.createUnit('player-123', 'fighter', 10, 10);

      await manager.moveUnit(fighter.id, 11, 10);

      expect(map.tiles.get('11,10').improvements).not.toContain('Hut');
      expect(random).not.toHaveBeenCalled();
      expect(broadcastHutEvent).toHaveBeenCalledWith(
        gameId,
        'player-123',
        'Your overflight frightens the tribe; they scatter in terror.'
      );
    });

    if (oracle) {
      /**
       * @evidence parity
       * @reference reference/freeciv/data/civ2civ3/actions.ruleset:1402-1428
       * @reference reference/freeciv/server/unittools.c:3357-3380
       * @reference reference/freeciv/data/default/default.lua:177-185
       * @assertion CivJS and the pinned Freeciv c2c3 server both preserve the aircraft and remove the hut on the HutFrighten movement path.
       * @c2c3-surface workers-extras
       * @c2c3-surface-scenario differential
       */
      it('matches the batched pinned Freeciv hut-frighten fixture', async () => {
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
            broadcastHutEvent: jest.fn(),
          },
          new EffectsManager('civ2civ3'),
          () => {
            throw new Error('Frightening a hut must not roll a hut reward');
          },
          rulesetUnitsService.getUnitTypes('civ2civ3')
        );
        const fighter = await manager.createUnit('player-123', 'fighter', 10, 10);

        await manager.moveUnit(fighter.id, 11, 10);

        expect(oracle.baseline).toEqual(CIV2CIV3_ORACLE_BASELINE);
        expect(manager.getUnit(fighter.id)).toBeDefined();
        expect(map.tiles.get('11,10').improvements).not.toContain('Hut');
        expect(oracle.results.hut_frighten_unit_survived).toBe(1);
        expect(oracle.results.hut_frighten_hut_removed).toBe(1);
      });
    } else {
      it.skip('matches the batched pinned Freeciv hut-frighten fixture when an oracle bundle exists', () =>
        undefined);
    }

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

    /**
     * @evidence parity
     * @reference reference/freeciv/data/civ2civ3/script.lua:12-15
     * @reference reference/freeciv/data/default/default.lua:145-175
     * @assertion Civ2Civ3's inherited hut-enter script uses the same fourteen deterministic outcome slots: gold, technology, mercenaries, barbarians, city, and map reveal.
     * @c2c3-action Enter Hut
     * @c2c3-scenario normal
     * @c2c3-surface workers-extras
     * @c2c3-surface-scenario normal
     * @c2c3-script-hook hut_enter
     */
    it('covers every deterministic hut roll outcome', async () => {
      const grantHutTechnology = jest.fn().mockResolvedValue('writing');
      const revealHutMap = jest.fn().mockReturnValue(['10,10', '11,10']);
      const spawnHutBarbarians = jest.fn().mockResolvedValue(true);
      const foundCity = jest.fn().mockResolvedValue(undefined);
      const broadcastHutEvent = jest.fn();
      const rolls = Array.from({ length: 14 }, (_, value) => (value + 0.1) / 14);
      const manager = new UnitManager(
        gameId,
        mockDbProvider,
        mapWidth,
        mapHeight,
        undefined,
        {
          foundCity,
          requestPath: jest.fn(),
          broadcastUnitMoved: jest.fn(),
          grantHutTechnology,
          revealHutMap,
          spawnHutBarbarians,
          broadcastHutEvent,
        },
        new EffectsManager('civ2civ3'),
        () => rolls.shift() ?? 0,
        rulesetUnitsService.getUnitTypes('civ2civ3')
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);

      for (let roll = 0; roll < 14; roll++) {
        await (manager as any).resolveHutReward(explorer);
      }

      expect(grantHutTechnology).toHaveBeenCalledTimes(3);
      expect(spawnHutBarbarians).toHaveBeenCalledTimes(1);
      expect(foundCity).toHaveBeenCalledWith(gameId, 'player-123', 'Hut Settlement', 10, 10);
      expect(revealHutMap).toHaveBeenCalledTimes(2);
      // Successful city founding is the one outcome that has no separate
      // hut-result notification; the city lifecycle announces it instead.
      expect(broadcastHutEvent).toHaveBeenCalledTimes(13);
    });

    it('falls back to gold when no legal mercenary is available', async () => {
      const broadcastHutEvent = jest.fn();
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
          broadcastHutEvent,
        },
        undefined,
        () => 8 / 14
      );
      const explorer = await manager.createUnit('player-123', 'warriors', 10, 10);
      (manager as any).unitTypes = { warriors: (manager as any).unitTypes.warriors };

      await (manager as any).resolveHutReward(explorer);

      expect(broadcastHutEvent).toHaveBeenCalledWith(
        gameId,
        'player-123',
        'No mercenary was available; your unit found 25 gold instead.'
      );
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
