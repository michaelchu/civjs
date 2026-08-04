import {
  BinaryMinHeap,
  PathfindingManager,
  type PathfindingMovementPolicy,
} from '@game/managers/PathfindingManager';
import type { Unit } from '@game/units/UnitTypes';
import { MapTopology } from '@game/map/MapTopology';
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
});
