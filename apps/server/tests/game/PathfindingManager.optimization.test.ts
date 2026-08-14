import {
  BinaryMinHeap,
  PathfindingManager,
  pathDestinationKey,
  type PathfindingMovementPolicy,
} from '@game/managers/PathfindingManager';
import type { Unit } from '@game/units/UnitTypes';
import { MapTopology, TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import { AIPlanningBudget } from '@game/ai/AIPlanningBudget';

function unit(overrides: Partial<Unit> = {}): Unit {
  return {
    id: 'unit',
    gameId: 'game',
    playerId: 'player',
    unitTypeId: 'warriors',
    x: 2,
    y: 2,
    movementLeft: 6,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
    ...overrides,
  };
}

function mapFixture() {
  let revision = 1;
  const map = {
    getRevision: jest.fn(() => revision),
    getTopology: () => new MapTopology(20, 20),
    getTile: jest.fn((): { terrain: string } | null => ({ terrain: 'grassland' })),
    bumpRevision: () => {
      revision++;
    },
  };
  return map;
}

describe('PathfindingManager optimization primitives', () => {
  it('orders a binary heap and repairs its position after a priority decrease', () => {
    const heap = new BinaryMinHeap<{ priority: number; id: string }>(
      (left, right) => left.priority - right.priority
    );
    const high = { priority: 5, id: 'high' };
    const middle = { priority: 3, id: 'middle' };
    const low = { priority: 1, id: 'low' };
    heap.push(high);
    heap.push(middle);
    heap.push(low);

    expect(heap.pop()).toBe(low);
    middle.priority = 0;
    heap.update(middle);
    expect(heap.pop()).toBe(middle);
    expect(heap.pop()).toBe(high);
    expect(heap.size).toBe(0);
  });

  it('reuses identical paths only inside the current map/turn scope', async () => {
    const map = mapFixture();
    const manager = new PathfindingManager(20, 20, map);
    const actor = unit();
    manager.beginTurn(1);

    const first = await manager.findPath(actor, 8, 8);
    const callsAfterFirst = map.getTile.mock.calls.length;
    const second = await manager.findPath(actor, 8, 8);

    expect(second).toEqual(first);
    expect(map.getTile).toHaveBeenCalledTimes(callsAfterFirst);
    expect(manager.getDiagnostics().cacheHits).toBe(1);

    manager.beginTurn(2);
    await manager.findPath(actor, 8, 8);
    expect(map.getTile.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('invalidates cached paths when the map revision changes', async () => {
    const map = mapFixture();
    const manager = new PathfindingManager(20, 20, map);
    const actor = unit();
    manager.beginTurn(1);
    const first = await manager.findPath(actor, 8, 8);
    expect(first.valid).toBe(true);

    map.bumpRevision();
    map.getTile.mockReturnValue(null);
    const second = await manager.findPath(actor, 8, 8);

    expect(second.valid).toBe(false);
    expect(manager.getDiagnostics().cacheHits).toBe(0);
  });

  it('reuses and invalidates reachable-tile searches with the same policy', () => {
    const map = mapFixture();
    const policy: PathfindingMovementPolicy = {
      getPathStepCost: jest.fn(() => 1),
      getUnitMaxMovement: jest.fn(() => 6),
    };
    const manager = new PathfindingManager(20, 20, map, policy);
    const actor = unit();
    manager.beginTurn(1);

    const first = manager.findAccessibleTiles(actor, 2);
    const callsAfterFirst = (policy.getPathStepCost as jest.Mock).mock.calls.length;
    const second = manager.findAccessibleTiles(actor, 2);
    expect(second).toEqual(first);
    expect((policy.getPathStepCost as jest.Mock).mock.calls.length).toBe(callsAfterFirst);

    map.bumpRevision();
    manager.findAccessibleTiles(actor, 2);
    expect((policy.getPathStepCost as jest.Mock).mock.calls.length).toBeGreaterThan(
      callsAfterFirst
    );
  });

  it('returns a bounded result when the cooperative search budget is exhausted', async () => {
    const map = mapFixture();
    const manager = new PathfindingManager(20, 20, map);
    manager.beginTurn(1);
    manager.setPlanningBudget(
      new AIPlanningBudget({
        maxPlanningMs: 10_000,
        maxPathQueries: 10,
        maxSearchNodes: 1,
        maxPlanningSteps: 10,
      })
    );

    const result = await manager.findPath(unit(), 18, 18);

    expect(result).toMatchObject({ valid: false, budgetExceeded: true });
    expect(manager.getDiagnostics().budgetExhaustions).toBeGreaterThan(0);
  });

  it('matches independent route costs in one destination-aware route map', async () => {
    const makePolicy = (): PathfindingMovementPolicy => ({
      getPathStepCost: (_unit, _fromX, fromY, toX, toY, isDestination) => {
        if (toX === 5 && toY === 5) return isDestination ? 2 : -1;
        if (toX === 6 && toY >= 3 && toY <= 8) return -1;
        if (fromY === 1 && toY === 1) return 0;
        return toX === 4 ? 3 : 1;
      },
      getUnitMaxMovement: () => 6,
    });
    const targets = [
      { x: 5, y: 5 },
      { x: 8, y: 8 },
      { x: 12, y: 2 },
    ];
    const actor = unit({ x: 2, y: 2 });
    const bulkManager = new PathfindingManager(20, 20, mapFixture(), makePolicy());
    const individualManager = new PathfindingManager(20, 20, mapFixture(), makePolicy());
    const options = {
      cacheKey: 'risk',
      additionalStepCost: (
        _unit: Unit,
        _fromX: number,
        _fromY: number,
        toX: number,
        toY: number
      ) => (toX === 3 && toY === 3 ? 5 : 0),
    };

    const bulk = await bulkManager.findPaths(actor, targets, options);
    for (const target of targets) {
      const individual = await individualManager.findPath(actor, target.x, target.y, options);
      expect(bulk.get(pathDestinationKey(target.x, target.y))).toMatchObject({
        valid: individual.valid,
        totalCost: individual.totalCost,
        weightedCost: individual.weightedCost,
        estimatedTurns: individual.estimatedTurns,
      });
    }
  });

  it('expands one shared lattice for many destinations and caches each result', async () => {
    const map = mapFixture();
    const manager = new PathfindingManager(20, 20, map);
    const actor = unit();
    const targets = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
      { x: 12, y: 11 },
    ];
    manager.beginTurn(1);

    const first = await manager.findPaths(actor, targets);
    const firstDiagnostics = manager.getDiagnostics();
    expect(first.size).toBe(targets.length);
    expect([...first.values()].every(result => result.valid)).toBe(true);
    expect(firstDiagnostics).toMatchObject({
      pathRequests: targets.length,
      searches: 1,
      cacheHits: 0,
    });

    manager.resetDiagnostics();
    const second = await manager.findPaths(actor, targets);
    expect(second).toEqual(first);
    expect(manager.getDiagnostics()).toMatchObject({
      pathRequests: targets.length,
      searches: 0,
      cacheHits: targets.length,
      expandedNodes: 0,
    });
  });

  it('returns and caches cost-only route maps without materializing paths', async () => {
    const manager = new PathfindingManager(20, 20, mapFixture());
    const actor = unit();
    const targets = [
      { x: 10, y: 10 },
      { x: 11, y: 10 },
      { x: 12, y: 10 },
    ];
    manager.beginTurn(1);

    const costs = await manager.findPathCosts(actor, targets);
    for (const target of targets) {
      const cost = costs.get(pathDestinationKey(target.x, target.y));
      expect(cost).toMatchObject({ valid: true, totalCost: expect.any(Number) });
      expect(cost).not.toHaveProperty('path');
    }
    expect(manager.getCacheSizes()).toMatchObject({ paths: 0, travelCosts: targets.length });

    manager.resetDiagnostics();
    expect(await manager.findPathCosts(actor, targets)).toEqual(costs);
    expect(manager.getDiagnostics()).toMatchObject({
      searches: 0,
      cacheHits: targets.length,
      expandedNodes: 0,
    });
  });

  it('keeps bulk route costs equal across square, wrapped, and iso-hex topologies', async () => {
    const configurations = [
      {},
      { wrapId: WrapFlag.X },
      { topologyId: TopologyFlag.ISO | TopologyFlag.HEX, wrapId: WrapFlag.X },
    ];
    const targets = [
      { x: 0, y: 4 },
      { x: 5, y: 7 },
      { x: 9, y: 1 },
      { x: 11, y: 8 },
    ];
    const actor = unit({ x: 2, y: 2 });
    const options = {
      cacheKey: 'deterministic-risk',
      additionalStepCost: (
        _unit: Unit,
        _fromX: number,
        _fromY: number,
        toX: number,
        toY: number
      ) => ((toX * 3 + toY * 5) % 7 === 0 ? 2 : 0),
    };

    for (const topologyOptions of configurations) {
      const makeMap = () => ({
        getRevision: () => 1,
        getTopology: () => new MapTopology(12, 10, topologyOptions),
        getTile: () => ({ terrain: 'grassland' }),
      });
      const makePolicy = (): PathfindingMovementPolicy => ({
        getPathStepCost: (_unit, _fromX, fromY, toX, toY, isDestination) => {
          if ((toX * 11 + toY * 7) % 29 === 0) return isDestination ? 2 : -1;
          if (fromY === 3 && toY === 3) return 0;
          return 1 + ((toX + 2 * toY) % 3);
        },
        getUnitMaxMovement: () => 6,
      });
      const bulkManager = new PathfindingManager(12, 10, makeMap(), makePolicy());
      const costManager = new PathfindingManager(12, 10, makeMap(), makePolicy());
      const individualManager = new PathfindingManager(12, 10, makeMap(), makePolicy());
      const bulk = await bulkManager.findPaths(actor, targets, options);
      const costs = await costManager.findPathCosts(actor, targets, options);

      for (const target of targets) {
        const individual = await individualManager.findPath(actor, target.x, target.y, options);
        const expected = {
          valid: individual.valid,
          totalCost: individual.totalCost,
          weightedCost: individual.weightedCost,
          estimatedTurns: individual.estimatedTurns,
        };
        expect(bulk.get(pathDestinationKey(target.x, target.y))).toMatchObject(expected);
        expect(costs.get(pathDestinationKey(target.x, target.y))).toMatchObject(expected);
      }
    }
  });

  it('reuses a search-scoped movement snapshot until authoritative invalidation', async () => {
    const map = mapFixture();
    const getPathStepCost = jest.fn(() => 1);
    const createPathSearchPolicy = jest.fn(() => ({ getPathStepCost }));
    const legacyStepCost = jest.fn(() => {
      throw new Error('legacy global scan should not run');
    });
    const manager = new PathfindingManager(20, 20, map, {
      getPathStepCost: legacyStepCost,
      getUnitMaxMovement: () => 6,
      createPathSearchPolicy,
    });
    const actor = unit();
    manager.beginTurn(1);

    expect((await manager.findPath(actor, 8, 8)).valid).toBe(true);
    expect((await manager.findPath(actor, 9, 8)).valid).toBe(true);
    expect(createPathSearchPolicy).toHaveBeenCalledTimes(1);
    expect(legacyStepCost).not.toHaveBeenCalled();

    manager.invalidateCache();
    expect((await manager.findPath(actor, 8, 8)).valid).toBe(true);
    expect(createPathSearchPolicy).toHaveBeenCalledTimes(2);
  });
});
