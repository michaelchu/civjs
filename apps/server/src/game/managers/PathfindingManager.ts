/**
 * @module server/game/managers/PathfindingManager
 * Coordinates authoritative Pathfinding Manager game state.
 */
import { logger } from '@utils/logger';
import { calculateMovementCost } from '@game/constants/MovementConstants';
import type { Unit } from '@game/units/UnitTypes';
import { MapTopology } from '@game/map/MapTopology';

export interface PathTile {
  x: number;
  y: number;
  moveCost: number;
  direction?: number;
}

export interface PathfindingResult {
  path: PathTile[];
  totalCost: number;
  estimatedTurns: number;
  valid: boolean;
  weightedCost?: number;
  budgetExceeded?: boolean;
}

export interface PathfindingTravelResult {
  totalCost: number;
  estimatedTurns: number;
  valid: boolean;
  weightedCost?: number;
  budgetExceeded?: boolean;
}

export interface PathfindingOptions {
  /**
   * Adds non-negative planning cost without changing authoritative movement
   * consumption. Return a negative value to make a step unavailable.
   */
  additionalStepCost?: (
    unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
  ) => number;
  /**
   * Stable identity for an additive planning policy. Paths using a callback
   * are cached only when the caller supplies this key because function
   * identity alone cannot prove that two closures have the same policy.
   */
  cacheKey?: string;
  /** Maximum nodes this individual search may expand. */
  maxIterations?: number;
  /** Optional cooperative budget for this search. */
  budget?: PathfindingBudget;
}

export interface PathDestination {
  x: number;
  y: number;
}

export function pathDestinationKey(x: number, y: number): string {
  return `${x},${y}`;
}

export interface AccessibleTile {
  x: number;
  y: number;
  remainingMovement: number;
}

interface AccessibleQueueEntry {
  index: number;
  remainingMovement: number;
  order: number;
}

interface LatticeSearchResult {
  path: number[] | null;
  weightedCost: number;
  budgetExceeded: boolean;
}

interface LatticeDestinationResult {
  parentIndex: number;
  moveCost: number;
  totalCost: number;
  weightedCost: number;
}

interface LatticeManySearchResult {
  destinations: Map<number, LatticeDestinationResult>;
  budgetExceeded: boolean;
}

export interface PathfindingBudget {
  canStartSearch(): boolean;
  consumeSearchNode(): boolean;
  consumePlanningStep?(): boolean;
}

export interface PathfindingDiagnostics {
  pathRequests: number;
  cacheHits: number;
  cacheMisses: number;
  searches: number;
  expandedNodes: number;
  budgetExhaustions: number;
  accessibleSearches: number;
}

/**
 * Small binary min-heap used by pathfinding's open sets. The position map
 * makes decrease-key updates O(log n) while retaining stable insertion-order
 * tie breaking in the A* comparator.
 */
export class BinaryMinHeap<T> {
  private readonly items: T[] = [];
  private readonly positions = new Map<T, number>();

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    if (this.positions.has(item)) {
      throw new Error('BinaryMinHeap cannot contain the same item twice');
    }
    this.positions.set(item, this.items.length);
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const root = this.items[0];
    if (root === undefined) return undefined;
    const last = this.items.pop()!;
    this.positions.delete(root);
    if (this.items.length > 0) {
      this.items[0] = last;
      this.positions.set(last, 0);
      this.siftDown(0);
    }
    return root;
  }

  /** Re-establishes heap order after an item's priority changes. */
  update(item: T): void {
    const index = this.positions.get(item);
    if (index === undefined) return;
    this.siftUp(index);
    this.siftDown(this.positions.get(item)!);
  }

  private siftUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) >= 0) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(start: number): void {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) return;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number): void {
    const leftItem = this.items[left];
    const rightItem = this.items[right];
    this.items[left] = rightItem;
    this.items[right] = leftItem;
    this.positions.set(leftItem, right);
    this.positions.set(rightItem, left);
  }
}

/**
 * Tile-indexed min heap matching Freeciv's map-index priority queue shape.
 * Positions live in a dense typed array, avoiding a Map lookup and node
 * allocation for every decrease-key operation in the path search.
 *
 * @reference reference/freeciv/common/aicore/path_finding.c:pf_normal_map
 */
class IndexedMinHeap {
  private readonly items: number[] = [];
  private readonly positions: Int32Array;

  constructor(
    capacity: number,
    private readonly compare: (left: number, right: number) => number
  ) {
    this.positions = new Int32Array(capacity);
    this.positions.fill(-1);
  }

  get size(): number {
    return this.items.length;
  }

  peek(): number | undefined {
    return this.items[0];
  }

  clear(): void {
    for (const index of this.items) this.positions[index] = -1;
    this.items.length = 0;
  }

  push(item: number): void {
    this.positions[item] = this.items.length;
    this.items.push(item);
    this.siftUp(this.items.length - 1);
  }

  pop(): number | undefined {
    const root = this.items[0];
    if (root === undefined) return undefined;
    const last = this.items.pop()!;
    this.positions[root] = -1;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.positions[last] = 0;
      this.siftDown(0);
    }
    return root;
  }

  update(item: number): void {
    const position = this.positions[item];
    if (position < 0) return;
    this.siftUp(position);
  }

  private siftUp(start: number): void {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.compare(this.items[index], this.items[parent]) >= 0) return;
      this.swap(index, parent);
      index = parent;
    }
  }

  private siftDown(start: number): void {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.items.length && this.compare(this.items[left], this.items[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.items.length && this.compare(this.items[right], this.items[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) return;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number): void {
    const leftItem = this.items[left];
    const rightItem = this.items[right];
    this.items[left] = rightItem;
    this.items[right] = leftItem;
    this.positions[leftItem] = right;
    this.positions[rightItem] = left;
  }
}

export interface PathfindingMovementPolicy {
  getPathStepCost(
    unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isDestination: boolean
  ): number;
  getUnitMaxMovement(unitTypeId: string): number;
  canContinuePathFrom?(unit: Unit, x: number, y: number): boolean;
  createPathSearchPolicy?(unit: Unit): PathfindingSearchPolicy;
}

export interface PathfindingSearchPolicy {
  getPathStepCost(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isDestination: boolean
  ): number;
  canContinuePathFrom?(x: number, y: number): boolean;
}

/**
 * A* Pathfinding Manager for unit movement
 * Based on Freeciv's pathfinding system and A* algorithm
 *
 * @reference freeciv/common/aicore/path_finding.h - Core pathfinding definitions
 * @reference freeciv/common/aicore/path_finding.c - PF algorithm implementation
 * @reference reference/freeciv-web/freeciv/patches/goto_fcweb.patch - Server-side goto handling
 * @compliance Implements A* algorithm with move cost calculations as per freeciv standards
 */
export class PathfindingManager {
  private mapWidth: number;
  private mapHeight: number;
  private mapManager: any; // MapManager instance for terrain access
  private topology: MapTopology;
  private movementPolicy?: PathfindingMovementPolicy;
  private activeBudget?: PathfindingBudget;
  private cacheTurn?: number;
  private cacheVersion = 0;
  private readonly pathCache = new Map<string, PathfindingResult>();
  private readonly travelCostCache = new Map<string, PathfindingTravelResult>();
  private readonly accessibleCache = new Map<string, AccessibleTile[]>();
  private readonly fallbackMovementCostCache = new Map<string, number>();
  private readonly maxCacheEntries = 4_096;
  private diagnostics: PathfindingDiagnostics = this.emptyDiagnostics();
  private readonly tileCount: number;
  private readonly neighborCounts: Uint8Array;
  private readonly neighborIndexes: Int32Array;
  private readonly searchGenerations: Uint32Array;
  private readonly searchStates: Uint8Array;
  private readonly searchCosts: Float64Array;
  private readonly searchTotalMoveCosts: Float64Array;
  private readonly searchParents: Int32Array;
  private readonly searchMoveCosts: Float64Array;
  private readonly searchQueueOrders: Uint32Array;
  private readonly searchOpenSet: IndexedMinHeap;
  private readonly stepCosts: Float64Array;
  private searchGeneration = 0;
  private stepCostScope?: string;
  private activeSearchPolicy?: PathfindingSearchPolicy;

  constructor(
    mapWidth: number,
    mapHeight: number,
    mapManager?: any,
    movementPolicy?: PathfindingMovementPolicy
  ) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
    this.topology = mapManager?.getTopology?.() ?? new MapTopology(mapWidth, mapHeight);
    this.movementPolicy = movementPolicy;
    this.tileCount = mapWidth * mapHeight;
    this.neighborCounts = new Uint8Array(this.tileCount);
    this.neighborIndexes = new Int32Array(this.tileCount * 8);
    this.neighborIndexes.fill(-1);
    this.buildNeighborIndex();
    this.searchGenerations = new Uint32Array(this.tileCount);
    this.searchStates = new Uint8Array(this.tileCount);
    this.searchCosts = new Float64Array(this.tileCount);
    this.searchTotalMoveCosts = new Float64Array(this.tileCount);
    this.searchParents = new Int32Array(this.tileCount);
    this.searchMoveCosts = new Float64Array(this.tileCount);
    this.searchQueueOrders = new Uint32Array(this.tileCount);
    this.searchOpenSet = new IndexedMinHeap(this.tileCount, (left, right) => {
      return (
        this.searchCosts[left] - this.searchCosts[right] ||
        this.searchQueueOrders[left] - this.searchQueueOrders[right]
      );
    });
    // Two cached costs per directed edge: ordinary transit and final-step
    // destination legality. Freeciv's path maps use tile-indexed arrays; a
    // dense array avoids hundreds of thousands of Map lookups as AI worker
    // counts grow.
    // @reference reference/freeciv/common/aicore/path_finding.c:pf_normal_map
    this.stepCosts = new Float64Array(this.tileCount * 8 * 2);
    this.stepCosts.fill(Number.NaN);
  }

  /** Starts a bounded path-cache scope for a single authoritative turn. */
  beginTurn(turn: number): void {
    this.cacheTurn = turn;
    this.invalidateCache();
  }

  /** Invalidates all cached route/reachability results after world changes. */
  invalidateCache(): void {
    this.cacheVersion++;
    this.pathCache.clear();
    this.travelCostCache.clear();
    this.accessibleCache.clear();
  }

  setPlanningBudget(budget?: PathfindingBudget): void {
    this.activeBudget = budget;
  }

  consumePlanningStep(): boolean {
    return this.activeBudget?.consumePlanningStep?.() ?? true;
  }

  getDiagnostics(): PathfindingDiagnostics {
    return { ...this.diagnostics };
  }

  resetDiagnostics(): void {
    this.diagnostics = this.emptyDiagnostics();
  }

  getCacheSizes(): { paths: number; travelCosts: number; accessible: number } {
    return {
      paths: this.pathCache.size,
      travelCosts: this.travelCostCache.size,
      accessible: this.accessibleCache.size,
    };
  }

  /**
   * Find path from unit to target using A* algorithm
   * Implements the core pathfinding logic similar to freeciv's PF system
   *
   * @reference freeciv/common/aicore/path_finding.c:pf_map_new() - Path finding initialization
   * @reference freeciv/common/aicore/path_finding.c:pf_map_iterate() - Path iteration algorithm
   * @compliance Uses movement cost calculation and heuristic matching freeciv standards
   */
  async findPath(
    unit: Unit,
    targetX: number,
    targetY: number,
    options: PathfindingOptions = {}
  ): Promise<PathfindingResult> {
    const startTime = Date.now();
    this.diagnostics.pathRequests++;

    logger.debug('PathfindingManager.findPath called', {
      unitId: unit.id,
      from: { x: unit.x, y: unit.y },
      to: { x: targetX, y: targetY },
      hasMapManager: !!this.mapManager,
      hasGetTile: !!this.mapManager?.getTile,
      mapSize: `${this.mapWidth}x${this.mapHeight}`,
    });

    try {
      // Validate coordinates
      if (!this.isValidCoordinate(targetX, targetY)) {
        logger.debug('Invalid coordinates in pathfinding', {
          targetX,
          targetY,
          mapSize: `${this.mapWidth}x${this.mapHeight}`,
        });
        return this.invalidResult();
      }

      // Check if already at target
      if (unit.x === targetX && unit.y === targetY) {
        return {
          path: [{ x: unit.x, y: unit.y, moveCost: 0 }],
          totalCost: 0,
          estimatedTurns: 0,
          valid: true,
        };
      }

      const cacheKey = this.pathCacheKey(unit, targetX, targetY, options);
      if (cacheKey !== undefined) {
        const cached = this.pathCache.get(cacheKey);
        if (cached) {
          this.diagnostics.cacheHits++;
          return this.clonePathResult(cached);
        }
        this.diagnostics.cacheMisses++;
      }

      const budget = options.budget ?? this.activeBudget;
      if (budget && !budget.canStartSearch()) {
        this.diagnostics.budgetExhaustions++;
        return this.invalidResult(true);
      }
      this.diagnostics.searches++;

      // Run A* pathfinding
      const search = this.searchLattice(
        { x: unit.x, y: unit.y },
        { x: targetX, y: targetY },
        unit,
        options,
        budget
      );

      if (search.budgetExceeded) {
        this.diagnostics.budgetExhaustions++;
        return this.invalidResult(true);
      }

      if (!search.path || search.path.length === 0) {
        const result = this.invalidResult();
        if (cacheKey !== undefined) this.cachePathResult(cacheKey, result);
        return result;
      }

      const result = this.buildSuccessfulResult(search.path, search.weightedCost, unit, options);
      if (cacheKey !== undefined) this.cachePathResult(cacheKey, result);

      const duration = Date.now() - startTime;
      logger.debug('Pathfinding completed', {
        unitId: unit.id,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        pathLength: result.path.length,
        totalCost: result.totalCost,
        estimatedTurns: result.estimatedTurns,
        durationMs: duration,
      });

      return result;
    } catch (error) {
      logger.error('Pathfinding error', {
        unitId: unit.id,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        error: error instanceof Error ? error.message : String(error),
      });

      return this.invalidResult();
    }
  }

  /**
   * Resolve many destinations from one unit with one reusable route map.
   * Transit edges are evaluated with ordinary movement legality; each goal's
   * final edge is evaluated separately with destination-only attack,
   * embarkation, and city-entry rules. This is equivalent to independent
   * searches for route cost while avoiding attacker-by-target map scans.
   *
   * @reference reference/freeciv/common/aicore/path_finding.c:pf_map_path
   * @reference reference/freeciv/ai/default/daimilitary.c:pf_map_new
   */
  async findPaths(
    unit: Unit,
    destinations: readonly PathDestination[],
    options: PathfindingOptions = {}
  ): Promise<Map<string, PathfindingResult>> {
    const results = new Map<string, PathfindingResult>();
    const pending = new Map<
      number,
      { x: number; y: number; resultKey: string; cacheKey?: string }
    >();

    for (const destination of destinations) {
      const resultKey = pathDestinationKey(destination.x, destination.y);
      if (results.has(resultKey)) continue;
      if (!this.isValidCoordinate(destination.x, destination.y)) {
        this.diagnostics.pathRequests++;
        results.set(resultKey, this.invalidResult());
        continue;
      }
      const destinationIndex = this.toIndex(destination.x, destination.y);
      if (pending.has(destinationIndex)) continue;
      this.diagnostics.pathRequests++;
      if (unit.x === destination.x && unit.y === destination.y) {
        results.set(resultKey, {
          path: [{ x: unit.x, y: unit.y, moveCost: 0 }],
          totalCost: 0,
          estimatedTurns: 0,
          valid: true,
        });
        continue;
      }

      const cacheKey = this.pathCacheKey(unit, destination.x, destination.y, options);
      const cached = cacheKey === undefined ? undefined : this.pathCache.get(cacheKey);
      if (cached) {
        this.diagnostics.cacheHits++;
        results.set(resultKey, this.clonePathResult(cached));
        continue;
      }
      if (cacheKey !== undefined) this.diagnostics.cacheMisses++;
      pending.set(destinationIndex, {
        ...destination,
        resultKey,
        cacheKey,
      });
    }

    if (pending.size === 0) return results;
    const budget = options.budget ?? this.activeBudget;
    if (budget && !budget.canStartSearch()) {
      this.diagnostics.budgetExhaustions++;
      for (const destination of pending.values()) {
        results.set(destination.resultKey, this.invalidResult(true));
      }
      return results;
    }

    this.diagnostics.searches++;
    const search = this.searchManyLattice(unit, pending, options, budget);
    if (search.budgetExceeded) this.diagnostics.budgetExhaustions++;

    for (const [index, destination] of pending) {
      const found = search.destinations.get(index);
      const result = found
        ? this.buildDestinationResult(index, found, unit, options)
        : this.invalidResult(search.budgetExceeded);
      results.set(destination.resultKey, result);
      if (destination.cacheKey !== undefined && !search.budgetExceeded) {
        this.cachePathResult(destination.cacheKey, result);
      }
    }
    return results;
  }

  /**
   * Resolve route costs without reconstructing or retaining every path. This
   * is the preferred API for AI scoring over large destination sets such as
   * worker tiles, military objectives, and city danger maps.
   */
  async findPathCosts(
    unit: Unit,
    destinations: readonly PathDestination[],
    options: PathfindingOptions = {}
  ): Promise<Map<string, PathfindingTravelResult>> {
    const results = new Map<string, PathfindingTravelResult>();
    const pending = new Map<number, { resultKey: string; cacheKey?: string }>();

    for (const destination of destinations) {
      const resultKey = pathDestinationKey(destination.x, destination.y);
      if (results.has(resultKey)) continue;
      if (!this.isValidCoordinate(destination.x, destination.y)) {
        this.diagnostics.pathRequests++;
        results.set(resultKey, this.invalidTravelResult());
        continue;
      }
      const destinationIndex = this.toIndex(destination.x, destination.y);
      if (pending.has(destinationIndex)) continue;
      this.diagnostics.pathRequests++;
      if (unit.x === destination.x && unit.y === destination.y) {
        results.set(resultKey, {
          totalCost: 0,
          estimatedTurns: 0,
          valid: true,
        });
        continue;
      }

      const cacheKey = this.pathCacheKey(unit, destination.x, destination.y, options);
      const cached = cacheKey === undefined ? undefined : this.travelCostCache.get(cacheKey);
      if (cached) {
        this.diagnostics.cacheHits++;
        results.set(resultKey, { ...cached });
        continue;
      }
      if (cacheKey !== undefined) this.diagnostics.cacheMisses++;
      pending.set(destinationIndex, { resultKey, cacheKey });
    }

    if (pending.size === 0) return results;
    const budget = options.budget ?? this.activeBudget;
    if (budget && !budget.canStartSearch()) {
      this.diagnostics.budgetExhaustions++;
      for (const destination of pending.values()) {
        results.set(destination.resultKey, this.invalidTravelResult(true));
      }
      return results;
    }

    this.diagnostics.searches++;
    const search = this.searchManyLattice(unit, pending, options, budget);
    if (search.budgetExceeded) this.diagnostics.budgetExhaustions++;
    for (const [index, destination] of pending) {
      const found = search.destinations.get(index);
      const result: PathfindingTravelResult = found
        ? {
            totalCost: found.totalCost,
            estimatedTurns: this.calculateTurns(found.totalCost, unit),
            ...(options.additionalStepCost ? { weightedCost: found.weightedCost } : {}),
            valid: true,
          }
        : this.invalidTravelResult(search.budgetExceeded);
      results.set(destination.resultKey, result);
      if (destination.cacheKey !== undefined && !search.budgetExceeded) {
        this.travelCostCache.set(destination.cacheKey, { ...result });
        this.trimCache(this.travelCostCache);
      }
    }
    return results;
  }

  private buildSuccessfulResult(
    path: number[],
    weightedCost: number,
    unit: Unit,
    options: PathfindingOptions,
    finalMoveCost?: number
  ): PathfindingResult {
    const pathTiles = this.convertToPathTiles(path, unit, finalMoveCost);
    const totalCost = pathTiles.reduce((sum, tile) => sum + tile.moveCost, 0);
    return {
      path: pathTiles,
      totalCost,
      estimatedTurns: this.calculateTurns(totalCost, unit),
      ...(options.additionalStepCost ? { weightedCost } : {}),
      valid: true,
    };
  }

  private buildDestinationResult(
    destinationIndex: number,
    destination: LatticeDestinationResult,
    unit: Unit,
    options: PathfindingOptions
  ): PathfindingResult {
    const path = this.reconstructLatticePath(destination.parentIndex);
    path.push(destinationIndex);
    return this.buildSuccessfulResult(
      path,
      destination.weightedCost,
      unit,
      options,
      destination.moveCost
    );
  }

  /**
   * Find every tile the unit can reach with its currently available movement.
   * Uses the same authoritative policy as goto pathfinding so occupancy, zones
   * of control, infrastructure, unit-class restrictions, and embarkation are
   * evaluated consistently.
   */
  findAccessibleTiles(unit: Unit, availableMovement: number = unit.movementLeft): AccessibleTile[] {
    if (!this.movementPolicy || availableMovement < 0) return [];

    const cacheKey = this.accessibleCacheKey(unit, availableMovement);
    const cached = cacheKey === undefined ? undefined : this.accessibleCache.get(cacheKey);
    if (cached) {
      this.diagnostics.cacheHits++;
      return cached.map(tile => ({ ...tile }));
    }
    if (cacheKey !== undefined) this.diagnostics.cacheMisses++;
    const budget = this.activeBudget;
    if (budget && !budget.canStartSearch()) {
      this.diagnostics.budgetExhaustions++;
      return [];
    }
    this.diagnostics.accessibleSearches++;
    this.prepareStepCostCache(unit);

    const bestRemaining = new Map<number, number>();
    const queue = new BinaryMinHeap<AccessibleQueueEntry>((left, right) => {
      return right.remainingMovement - left.remainingMovement || left.order - right.order;
    });
    let nextOrder = 0;
    const startIndex = this.toIndex(unit.x, unit.y);
    queue.push({
      index: startIndex,
      remainingMovement: availableMovement,
      order: nextOrder++,
    });
    bestRemaining.set(startIndex, availableMovement);

    while (queue.size > 0) {
      if (budget && !budget.consumeSearchNode()) {
        this.diagnostics.budgetExhaustions++;
        return [];
      }
      const entry = queue.pop()!;
      if (entry.remainingMovement < (bestRemaining.get(entry.index) ?? -1)) continue;
      const current = {
        ...this.fromIndex(entry.index),
        remainingMovement: entry.remainingMovement,
      };
      if (!this.canExpandAccessibleTile(unit, current)) continue;
      this.enqueueAccessibleNeighbors(
        unit,
        entry.index,
        current,
        bestRemaining,
        queue,
        () => nextOrder++
      );
    }

    const result = [...bestRemaining.entries()].map(([index, remainingMovement]) => ({
      ...this.fromIndex(index),
      remainingMovement,
    }));
    if (cacheKey !== undefined) this.cacheAccessibleResult(cacheKey, result);
    return result.map(tile => ({ ...tile }));
  }

  private canExpandAccessibleTile(unit: Unit, tile: AccessibleTile): boolean {
    if (tile.remainingMovement <= 0) return false;
    if (this.activeSearchPolicy?.canContinuePathFrom) {
      return this.activeSearchPolicy.canContinuePathFrom(tile.x, tile.y);
    }
    return (
      !this.movementPolicy?.canContinuePathFrom ||
      this.movementPolicy.canContinuePathFrom(unit, tile.x, tile.y)
    );
  }

  private enqueueAccessibleNeighbors(
    unit: Unit,
    currentIndex: number,
    current: AccessibleTile,
    bestRemaining: Map<number, number>,
    queue: BinaryMinHeap<AccessibleQueueEntry>,
    nextOrder: () => number
  ): void {
    const offset = currentIndex * 8;
    for (let position = 0; position < this.neighborCounts[currentIndex]; position++) {
      const neighborIndex = this.neighborIndexes[offset + position];
      const neighbor = this.fromIndex(neighborIndex);
      const moveCost = this.getCachedMovementCost(
        (currentIndex * 8 + position) * 2 + 1,
        unit,
        current.x,
        current.y,
        neighbor.x,
        neighbor.y,
        true
      );
      if (moveCost < 0) continue;

      // Freeciv permits one adjacent step with any positive movement
      // remaining, even when the terrain cost exceeds those fragments.
      const remainingMovement = Math.max(0, current.remainingMovement - moveCost);
      if (remainingMovement <= (bestRemaining.get(neighborIndex) ?? -1)) continue;
      bestRemaining.set(neighborIndex, remainingMovement);
      queue.push({ index: neighborIndex, remainingMovement, order: nextOrder() });
    }
  }

  /**
   * Dijkstra search over a reusable tile-indexed lattice. C2C3 railroads can
   * produce zero-cost edges, so a positive geometric A* heuristic would not
   * be admissible. The compact lattice and indexed queue preserve optimal
   * Freeciv movement costs without allocating coordinate keys and node
   * objects for every visited tile.
   *
   * @reference reference/freeciv/common/aicore/path_finding.c:pf_normal_map
   * @reference reference/freeciv/common/aicore/path_finding.c:pf_normal_map_iterate
   */
  private searchLattice(
    start: { x: number; y: number },
    goal: { x: number; y: number },
    unit: Unit,
    options: PathfindingOptions,
    budget?: PathfindingBudget
  ): LatticeSearchResult {
    const startIndex = this.toIndex(start.x, start.y);
    const goalIndex = this.toIndex(goal.x, goal.y);
    this.prepareStepCostCache(unit);
    const generation = this.beginLatticeSearch(startIndex);

    let iterations = 0;
    const maxIterations = Math.min(
      this.mapWidth * this.mapHeight,
      Math.max(0, options.maxIterations ?? this.mapWidth * this.mapHeight)
    );

    let nextQueueOrder = 1;
    while (this.searchOpenSet.size > 0 && iterations < maxIterations) {
      if (budget && !budget.consumeSearchNode()) {
        return { path: null, weightedCost: 0, budgetExceeded: true };
      }
      iterations++;
      this.diagnostics.expandedNodes++;

      const currentIndex = this.searchOpenSet.pop()!;
      this.searchStates[currentIndex] = 2;

      if (currentIndex === goalIndex) {
        return {
          path: this.reconstructLatticePath(currentIndex),
          weightedCost: this.searchCosts[currentIndex],
          budgetExceeded: false,
        };
      }

      nextQueueOrder = this.expandLatticeNode(
        currentIndex,
        goalIndex,
        unit,
        options,
        generation,
        nextQueueOrder
      );
    }

    // No path found
    logger.debug('Pathfinding lattice found no traversable route', {
      unitId: unit.id,
      from: start,
      to: goal,
      iterations,
      maxIterations,
    });

    return { path: null, weightedCost: 0, budgetExceeded: false };
  }

  private searchManyLattice(
    unit: Unit,
    destinations: ReadonlyMap<number, unknown>,
    options: PathfindingOptions,
    budget?: PathfindingBudget
  ): LatticeManySearchResult {
    const startIndex = this.toIndex(unit.x, unit.y);
    this.prepareStepCostCache(unit);
    const generation = this.beginLatticeSearch(startIndex);
    const found = new Map<number, LatticeDestinationResult>();
    let nextQueueOrder = 1;
    let iterations = 0;
    const maxIterations = Math.min(
      this.tileCount,
      Math.max(0, options.maxIterations ?? this.tileCount)
    );

    while (this.searchOpenSet.size > 0 && iterations < maxIterations) {
      if (found.size === destinations.size) {
        const nextIndex = this.searchOpenSet.peek();
        let highestFoundCost = 0;
        for (const destination of found.values()) {
          highestFoundCost = Math.max(highestFoundCost, destination.weightedCost);
        }
        if (nextIndex === undefined || this.searchCosts[nextIndex] >= highestFoundCost) break;
      }
      if (budget && !budget.consumeSearchNode()) {
        return { destinations: found, budgetExceeded: true };
      }

      iterations++;
      this.diagnostics.expandedNodes++;
      const currentIndex = this.searchOpenSet.pop()!;
      this.searchStates[currentIndex] = 2;
      const current = this.fromIndex(currentIndex);
      const offset = currentIndex * 8;

      for (let position = 0; position < this.neighborCounts[currentIndex]; position++) {
        const neighborIndex = this.neighborIndexes[offset + position];
        const neighbor = this.fromIndex(neighborIndex);
        const additionalCost =
          options.additionalStepCost?.(unit, current.x, current.y, neighbor.x, neighbor.y) ?? 0;
        if (!Number.isFinite(additionalCost) || additionalCost < 0) continue;

        if (destinations.has(neighborIndex)) {
          const destinationMoveCost = this.getCachedMovementCost(
            (currentIndex * 8 + position) * 2 + 1,
            unit,
            current.x,
            current.y,
            neighbor.x,
            neighbor.y,
            true
          );
          if (destinationMoveCost >= 0) {
            const weightedCost =
              this.searchCosts[currentIndex] + destinationMoveCost + additionalCost;
            const previous = found.get(neighborIndex);
            if (!previous || weightedCost < previous.weightedCost) {
              found.set(neighborIndex, {
                parentIndex: currentIndex,
                moveCost: destinationMoveCost,
                totalCost: this.searchTotalMoveCosts[currentIndex] + destinationMoveCost,
                weightedCost,
              });
            }
          }
        }

        if (
          this.searchGenerations[neighborIndex] === generation &&
          this.searchStates[neighborIndex] === 2
        ) {
          continue;
        }
        const moveCost = this.getCachedMovementCost(
          (currentIndex * 8 + position) * 2,
          unit,
          current.x,
          current.y,
          neighbor.x,
          neighbor.y,
          false
        );
        if (moveCost < 0) continue;
        const tentativeCost = this.searchCosts[currentIndex] + moveCost + additionalCost;
        const tentativeTotalMoveCost = this.searchTotalMoveCosts[currentIndex] + moveCost;
        if (this.searchGenerations[neighborIndex] !== generation) {
          this.initializeLatticeNode(
            neighborIndex,
            generation,
            tentativeCost,
            tentativeTotalMoveCost,
            currentIndex,
            moveCost,
            nextQueueOrder++
          );
          this.searchOpenSet.push(neighborIndex);
        } else if (tentativeCost < this.searchCosts[neighborIndex]) {
          this.searchCosts[neighborIndex] = tentativeCost;
          this.searchTotalMoveCosts[neighborIndex] = tentativeTotalMoveCost;
          this.searchParents[neighborIndex] = currentIndex;
          this.searchMoveCosts[neighborIndex] = moveCost;
          this.searchOpenSet.update(neighborIndex);
        }
      }
    }

    return { destinations: found, budgetExceeded: false };
  }

  private expandLatticeNode(
    currentIndex: number,
    goalIndex: number,
    unit: Unit,
    options: PathfindingOptions,
    generation: number,
    nextQueueOrder: number
  ): number {
    const current = this.fromIndex(currentIndex);
    const offset = currentIndex * 8;
    for (let position = 0; position < this.neighborCounts[currentIndex]; position++) {
      const neighborIndex = this.neighborIndexes[offset + position];
      if (
        this.searchGenerations[neighborIndex] === generation &&
        this.searchStates[neighborIndex] === 2
      ) {
        continue;
      }

      const neighbor = this.fromIndex(neighborIndex);
      const isDestination = neighborIndex === goalIndex;
      const moveCost = this.getCachedMovementCost(
        (currentIndex * 8 + position) * 2 + (isDestination ? 1 : 0),
        unit,
        current.x,
        current.y,
        neighbor.x,
        neighbor.y,
        isDestination
      );
      if (moveCost < 0) continue;

      const additionalCost =
        options.additionalStepCost?.(unit, current.x, current.y, neighbor.x, neighbor.y) ?? 0;
      if (!Number.isFinite(additionalCost) || additionalCost < 0) continue;
      const tentativeCost = this.searchCosts[currentIndex] + moveCost + additionalCost;
      const tentativeTotalMoveCost = this.searchTotalMoveCosts[currentIndex] + moveCost;

      if (this.searchGenerations[neighborIndex] !== generation) {
        this.initializeLatticeNode(
          neighborIndex,
          generation,
          tentativeCost,
          tentativeTotalMoveCost,
          currentIndex,
          moveCost,
          nextQueueOrder++
        );
        this.searchOpenSet.push(neighborIndex);
      } else if (tentativeCost < this.searchCosts[neighborIndex]) {
        this.searchCosts[neighborIndex] = tentativeCost;
        this.searchTotalMoveCosts[neighborIndex] = tentativeTotalMoveCost;
        this.searchParents[neighborIndex] = currentIndex;
        this.searchMoveCosts[neighborIndex] = moveCost;
        this.searchOpenSet.update(neighborIndex);
      }
    }
    return nextQueueOrder;
  }

  private beginLatticeSearch(startIndex: number): number {
    this.searchGeneration = (this.searchGeneration + 1) >>> 0;
    if (this.searchGeneration === 0) {
      this.searchGenerations.fill(0);
      this.searchGeneration = 1;
    }
    this.searchOpenSet.clear();
    this.initializeLatticeNode(startIndex, this.searchGeneration, 0, 0, -1, 0, 0);
    this.searchOpenSet.push(startIndex);
    return this.searchGeneration;
  }

  private initializeLatticeNode(
    index: number,
    generation: number,
    cost: number,
    totalMoveCost: number,
    parent: number,
    moveCost: number,
    queueOrder: number
  ): void {
    this.searchGenerations[index] = generation;
    this.searchStates[index] = 1;
    this.searchCosts[index] = cost;
    this.searchTotalMoveCosts[index] = totalMoveCost;
    this.searchParents[index] = parent;
    this.searchMoveCosts[index] = moveCost;
    this.searchQueueOrders[index] = queueOrder;
  }

  private reconstructLatticePath(goalIndex: number): number[] {
    const path: number[] = [];
    let currentIndex = goalIndex;
    while (currentIndex >= 0) {
      path.push(currentIndex);
      currentIndex = this.searchParents[currentIndex];
    }
    path.reverse();
    return path;
  }

  /**
   * Reuse authoritative edge costs while one unit is evaluated against many
   * AI destinations. Runtime movement changes advance either the manager's
   * cache version or the map revision, so a scope can never survive a change
   * in occupancy, diplomacy, infrastructure, or terrain.
   */
  private prepareStepCostCache(unit: Unit): void {
    const mapRevision = this.getMapRevision();
    if (mapRevision === undefined) {
      this.stepCostScope = undefined;
      this.stepCosts.fill(Number.NaN);
      this.activeSearchPolicy = this.movementPolicy?.createPathSearchPolicy?.(unit);
      return;
    }
    const scope = [
      this.cacheTurn ?? 'unscoped',
      this.cacheVersion,
      mapRevision,
      this.unitCacheKey(unit),
    ].join('|');
    if (scope === this.stepCostScope) return;

    this.stepCostScope = scope;
    this.stepCosts.fill(Number.NaN);
    this.activeSearchPolicy = this.movementPolicy?.createPathSearchPolicy?.(unit);
  }

  private getCachedMovementCost(
    slot: number,
    unit: Unit,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isDestination: boolean
  ): number {
    const cached = this.stepCosts[slot];
    if (!Number.isNaN(cached)) return cached;
    const cost = this.getMovementCost(fromX, fromY, toX, toY, unit, isDestination);
    this.stepCosts[slot] = cost;
    return cost;
  }

  /**
   * Get movement cost between two adjacent tiles
   */
  private getMovementCost(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    unit: Unit,
    isDestination: boolean
  ): number {
    // MapManager is required for terrain validation
    if (!this.mapManager || !this.mapManager.getTile) {
      logger.error('PathfindingManager: MapManager is required for movement validation', {
        unitId: unit.id,
        unitType: unit.unitTypeId,
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
        hasMapManager: !!this.mapManager,
        hasGetTile: !!this.mapManager?.getTile,
        mapManagerType: typeof this.mapManager,
      });
      return -1; // Impassable when no terrain data available
    }

    try {
      if (this.activeSearchPolicy) {
        return this.activeSearchPolicy.getPathStepCost(fromX, fromY, toX, toY, isDestination);
      }
      if (this.movementPolicy) {
        return this.movementPolicy.getPathStepCost(unit, fromX, fromY, toX, toY, isDestination);
      }
      const tile = this.mapManager.getTile(toX, toY);
      if (!tile || !tile.terrain) {
        logger.warn('PathfindingManager: No terrain data for tile', {
          x: toX,
          y: toY,
          unitId: unit.id,
          unitType: unit.unitTypeId,
        });
        return -1; // Impassable when terrain data is missing
      }

      // Use enhanced movement cost calculation with terrain validation
      const movementKey = `${unit.unitTypeId}|${tile.terrain}`;
      const cached = this.fallbackMovementCostCache.get(movementKey);
      if (cached !== undefined) return cached;
      const movementCost = calculateMovementCost(
        fromX,
        fromY,
        toX,
        toY,
        tile.terrain,
        unit.unitTypeId
      );
      this.fallbackMovementCostCache.set(movementKey, movementCost);
      return movementCost;
    } catch (error) {
      logger.error('PathfindingManager: Failed to get terrain data', {
        x: toX,
        y: toY,
        unitId: unit.id,
        unitType: unit.unitTypeId,
        error: error instanceof Error ? error.message : String(error),
      });
      return -1; // Impassable on error
    }
  }

  /**
   * Check if coordinate is valid on the map
   */
  private isValidCoordinate(x: number, y: number): boolean {
    return this.topology.isValidCoordinate(x, y);
  }

  private buildNeighborIndex(): void {
    for (let x = 0; x < this.mapWidth; x++) {
      for (let y = 0; y < this.mapHeight; y++) {
        const index = this.toIndex(x, y);
        const neighbors = this.topology.getNeighbors(x, y);
        this.neighborCounts[index] = neighbors.length;
        for (let position = 0; position < neighbors.length; position++) {
          const neighbor = neighbors[position];
          this.neighborIndexes[index * 8 + position] = this.toIndex(neighbor.x, neighbor.y);
        }
      }
    }
  }

  private toIndex(x: number, y: number): number {
    return y * this.mapWidth + x;
  }

  private fromIndex(index: number): { x: number; y: number } {
    return {
      x: index % this.mapWidth,
      y: Math.floor(index / this.mapWidth),
    };
  }

  /**
   * Convert lattice indexes to PathTile format with directions.
   */
  private convertToPathTiles(path: number[], _unit: Unit, finalMoveCost?: number): PathTile[] {
    const pathTiles: PathTile[] = [];

    for (let i = 0; i < path.length; i++) {
      const index = path[i];
      const node = this.fromIndex(index);
      const pathTile: PathTile = {
        x: node.x,
        y: node.y,
        moveCost:
          finalMoveCost !== undefined && i === path.length - 1
            ? finalMoveCost
            : this.searchMoveCosts[index],
      };

      // Calculate direction to next tile for rendering
      if (i < path.length - 1) {
        const nextNode = this.fromIndex(path[i + 1]);
        pathTile.direction = this.calculateDirection(node.x, node.y, nextNode.x, nextNode.y);
      }

      pathTiles.push(pathTile);
    }

    return pathTiles;
  }

  /**
   * Calculate direction from one tile to another (freeciv 8-direction system)
   */
  private calculateDirection(fromX: number, fromY: number, toX: number, toY: number): number {
    const { dx, dy } = this.topology.distanceVector(fromX, fromY, toX, toY);

    // Freeciv directions: 0=North, 1=NE, 2=East, 3=SE, 4=South, 5=SW, 6=West, 7=NW
    const directionMap: Record<string, number> = {
      '0,-1': 0, // North
      '1,-1': 1, // NE
      '1,0': 2, // East
      '1,1': 3, // SE
      '0,1': 4, // South
      '-1,1': 5, // SW
      '-1,0': 6, // West
      '-1,-1': 7, // NW
    };

    return directionMap[`${dx},${dy}`] ?? 2; // Default to east
  }

  /**
   * Calculate number of turns needed for path based on unit movement
   */
  private calculateTurns(totalCost: number, unit: Unit): number {
    const movementPerTurn =
      this.movementPolicy?.getUnitMaxMovement(unit.unitTypeId) || unit.movementLeft || 3;

    return Math.ceil(totalCost / movementPerTurn);
  }

  private emptyDiagnostics(): PathfindingDiagnostics {
    return {
      pathRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      searches: 0,
      expandedNodes: 0,
      budgetExhaustions: 0,
      accessibleSearches: 0,
    };
  }

  private invalidResult(budgetExceeded = false): PathfindingResult {
    return {
      path: [],
      totalCost: 0,
      estimatedTurns: 0,
      valid: false,
      ...(budgetExceeded ? { budgetExceeded: true } : {}),
    };
  }

  private invalidTravelResult(budgetExceeded = false): PathfindingTravelResult {
    return {
      totalCost: 0,
      estimatedTurns: 0,
      valid: false,
      ...(budgetExceeded ? { budgetExceeded: true } : {}),
    };
  }

  private clonePathResult(result: PathfindingResult): PathfindingResult {
    return {
      ...result,
      path: result.path.map(tile => ({ ...tile })),
    };
  }

  private pathCacheKey(
    unit: Unit,
    targetX: number,
    targetY: number,
    options: PathfindingOptions
  ): string | undefined {
    if (options.additionalStepCost && options.cacheKey === undefined) return undefined;
    const mapRevision = this.getMapRevision();
    if (mapRevision === undefined) return undefined;
    const policy = options.additionalStepCost ? `additional:${options.cacheKey}` : 'authoritative';
    return [
      this.cacheTurn ?? 'unscoped',
      this.cacheVersion,
      mapRevision,
      policy,
      this.unitCacheKey(unit),
      targetX,
      targetY,
      options.maxIterations ?? 'default',
    ].join('|');
  }

  private accessibleCacheKey(unit: Unit, availableMovement: number): string | undefined {
    const mapRevision = this.getMapRevision();
    if (mapRevision === undefined) return undefined;
    return [
      this.cacheTurn ?? 'unscoped',
      this.cacheVersion,
      mapRevision,
      'accessible',
      this.unitCacheKey(unit),
      availableMovement,
    ].join('|');
  }

  private unitCacheKey(unit: Unit): string {
    return [
      unit.id,
      unit.playerId,
      unit.unitTypeId,
      unit.x,
      unit.y,
      unit.movementLeft,
      unit.health,
      unit.veteranLevel,
      unit.experience,
      unit.transportedBy ?? '',
      unit.fortified ? 1 : 0,
      unit.sentryUntil ?? '',
      unit.cargoUnits?.join(',') ?? '',
    ].join(',');
  }

  private getMapRevision(): number | undefined {
    if (typeof this.mapManager?.getRevision !== 'function') return undefined;
    const revision = this.mapManager?.getRevision?.();
    return typeof revision === 'number' && Number.isFinite(revision) ? revision : 0;
  }

  private cachePathResult(key: string, result: PathfindingResult): void {
    this.pathCache.set(key, this.clonePathResult(result));
    this.trimCache(this.pathCache);
  }

  private cacheAccessibleResult(key: string, result: AccessibleTile[]): void {
    this.accessibleCache.set(
      key,
      result.map(tile => ({ ...tile }))
    );
    this.trimCache(this.accessibleCache);
  }

  private trimCache<T>(cache: Map<string, T>): void {
    while (cache.size > this.maxCacheEntries) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      cache.delete(oldest);
    }
  }
}
