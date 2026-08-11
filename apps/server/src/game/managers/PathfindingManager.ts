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

export interface AccessibleTile {
  x: number;
  y: number;
  remainingMovement: number;
}

interface AStarNode {
  x: number;
  y: number;
  gCost: number; // Cost from start
  hCost: number; // Heuristic cost to goal
  fCost: number; // Total cost (g + h)
  parent: AStarNode | null;
  moveCost: number; // Cost to move to this tile
  queueOrder: number;
}

interface AccessibleQueueEntry {
  tile: AccessibleTile;
  order: number;
}

interface AStarSearchResult {
  path: AStarNode[] | null;
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
  private readonly accessibleCache = new Map<string, AccessibleTile[]>();
  private readonly maxCacheEntries = 4_096;
  private diagnostics: PathfindingDiagnostics = this.emptyDiagnostics();

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

  getCacheSizes(): { paths: number; accessible: number } {
    return { paths: this.pathCache.size, accessible: this.accessibleCache.size };
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
      const search = this.aStar(
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

      const result = this.buildSuccessfulResult(search.path, unit, options);
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

  private buildSuccessfulResult(
    path: AStarNode[],
    unit: Unit,
    options: PathfindingOptions
  ): PathfindingResult {
    const pathTiles = this.convertToPathTiles(path, unit);
    const totalCost = pathTiles.reduce((sum, tile) => sum + tile.moveCost, 0);
    const lastNode = path[path.length - 1];
    return {
      path: pathTiles,
      totalCost,
      estimatedTurns: this.calculateTurns(totalCost, unit),
      ...(options.additionalStepCost ? { weightedCost: lastNode.gCost } : {}),
      valid: true,
    };
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

    const bestRemaining = new Map<string, number>();
    const queue = new BinaryMinHeap<AccessibleQueueEntry>((left, right) => {
      return right.tile.remainingMovement - left.tile.remainingMovement || left.order - right.order;
    });
    let nextOrder = 0;
    queue.push({
      tile: { x: unit.x, y: unit.y, remainingMovement: availableMovement },
      order: nextOrder++,
    });
    bestRemaining.set(`${unit.x},${unit.y}`, availableMovement);

    while (queue.size > 0) {
      if (budget && !budget.consumeSearchNode()) {
        this.diagnostics.budgetExhaustions++;
        return [];
      }
      const current = queue.pop()!.tile;
      const currentKey = `${current.x},${current.y}`;
      if (current.remainingMovement < (bestRemaining.get(currentKey) ?? -1)) continue;
      if (!this.canExpandAccessibleTile(unit, current)) continue;
      this.enqueueAccessibleNeighbors(unit, current, bestRemaining, queue, () => nextOrder++);
    }

    const result = [...bestRemaining.entries()].map(([key, remainingMovement]) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, remainingMovement };
    });
    if (cacheKey !== undefined) this.cacheAccessibleResult(cacheKey, result);
    return result.map(tile => ({ ...tile }));
  }

  private canExpandAccessibleTile(unit: Unit, tile: AccessibleTile): boolean {
    if (tile.remainingMovement <= 0) return false;
    return (
      !this.movementPolicy?.canContinuePathFrom ||
      this.movementPolicy.canContinuePathFrom(unit, tile.x, tile.y)
    );
  }

  private enqueueAccessibleNeighbors(
    unit: Unit,
    current: AccessibleTile,
    bestRemaining: Map<string, number>,
    queue: BinaryMinHeap<AccessibleQueueEntry>,
    nextOrder: () => number
  ): void {
    for (const neighbor of this.getNeighbors(current.x, current.y)) {
      const moveCost = this.movementPolicy!.getPathStepCost(
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
      const key = `${neighbor.x},${neighbor.y}`;
      if (remainingMovement <= (bestRemaining.get(key) ?? -1)) continue;
      bestRemaining.set(key, remainingMovement);
      queue.push({ tile: { ...neighbor, remainingMovement }, order: nextOrder() });
    }
  }

  /**
   * A* pathfinding algorithm implementation
   * @reference https://en.wikipedia.org/wiki/A*_search_algorithm
   */
  private aStar(
    start: { x: number; y: number },
    goal: { x: number; y: number },
    unit: Unit,
    options: PathfindingOptions,
    budget?: PathfindingBudget
  ): AStarSearchResult {
    const { openSet, closedSet, nodes } = this.initializeAStarSearch(start, goal);

    let iterations = 0;
    const maxIterations = Math.min(
      this.mapWidth * this.mapHeight,
      Math.max(0, options.maxIterations ?? this.mapWidth * this.mapHeight)
    );

    while (openSet.size > 0 && iterations < maxIterations) {
      if (budget && !budget.consumeSearchNode()) {
        return { path: null, budgetExceeded: true };
      }
      iterations++;
      this.diagnostics.expandedNodes++;

      const current = this.processCurrentNode(openSet, closedSet);

      if (current.x === goal.x && current.y === goal.y) {
        return { path: this.reconstructPath(current), budgetExceeded: false };
      }

      this.processNeighbors(current, goal, unit, options, openSet, closedSet, nodes);
    }

    // No path found
    logger.debug('A* pathfinding found no traversable route', {
      unitId: unit.id,
      from: start,
      to: goal,
      iterations,
      maxIterations,
    });

    return { path: null, budgetExceeded: false };
  }

  /**
   * Initialize A* search data structures
   */
  private initializeAStarSearch(start: { x: number; y: number }, goal: { x: number; y: number }) {
    const openSet = new BinaryMinHeap<AStarNode>((left, right) => {
      return (
        left.fCost - right.fCost || left.hCost - right.hCost || left.queueOrder - right.queueOrder
      );
    });
    const closedSet = new Set<string>();
    const nodes = new Map<string, AStarNode>();

    const startNode: AStarNode = {
      x: start.x,
      y: start.y,
      gCost: 0,
      hCost: this.heuristic(start.x, start.y, goal.x, goal.y),
      fCost: 0,
      parent: null,
      moveCost: 0,
      queueOrder: 0,
    };
    startNode.fCost = startNode.gCost + startNode.hCost;

    openSet.push(startNode);
    nodes.set(`${start.x},${start.y}`, startNode);

    return { openSet, closedSet, nodes };
  }

  /**
   * Process current node in A* algorithm
   */
  private processCurrentNode(openSet: BinaryMinHeap<AStarNode>, closedSet: Set<string>): AStarNode {
    const current = openSet.pop()!;
    closedSet.add(`${current.x},${current.y}`);
    return current;
  }

  /**
   * Process neighbors of current node in A* algorithm
   */
  private processNeighbors(
    current: AStarNode,
    goal: { x: number; y: number },
    unit: Unit,
    options: PathfindingOptions,
    openSet: BinaryMinHeap<AStarNode>,
    closedSet: Set<string>,
    nodes: Map<string, AStarNode>
  ) {
    const neighbors = this.getNeighbors(current.x, current.y);

    for (const neighbor of neighbors) {
      this.processNeighborNode(current, neighbor, goal, unit, options, openSet, closedSet, nodes);
    }
  }

  /**
   * Process individual neighbor node
   */
  private processNeighborNode(
    current: AStarNode,
    neighbor: { x: number; y: number },
    goal: { x: number; y: number },
    unit: Unit,
    options: PathfindingOptions,
    openSet: BinaryMinHeap<AStarNode>,
    closedSet: Set<string>,
    nodes: Map<string, AStarNode>
  ) {
    const neighborKey = `${neighbor.x},${neighbor.y}`;

    if (closedSet.has(neighborKey)) {
      return;
    }

    const moveCost = this.getMovementCost(
      current.x,
      current.y,
      neighbor.x,
      neighbor.y,
      unit,
      neighbor.x === goal.x && neighbor.y === goal.y
    );
    if (moveCost < 0) {
      return; // Unwalkable terrain
    }

    const additionalCost =
      options.additionalStepCost?.(unit, current.x, current.y, neighbor.x, neighbor.y) ?? 0;
    if (!Number.isFinite(additionalCost)) return;
    if (additionalCost < 0) return;
    const tentativeGCost = current.gCost + moveCost + additionalCost;
    let neighborNode = nodes.get(neighborKey);

    if (!neighborNode) {
      neighborNode = this.createNeighborNode(
        neighbor,
        tentativeGCost,
        goal,
        current,
        moveCost,
        nodes.size
      );
      nodes.set(neighborKey, neighborNode);
      openSet.push(neighborNode);
    } else if (tentativeGCost < neighborNode.gCost) {
      this.updateNeighborNode(neighborNode, tentativeGCost, current, moveCost, openSet);
    }
  }

  /**
   * Create new neighbor node
   */
  private createNeighborNode(
    neighbor: { x: number; y: number },
    gCost: number,
    goal: { x: number; y: number },
    parent: AStarNode,
    moveCost: number,
    queueOrder: number
  ): AStarNode {
    const neighborNode: AStarNode = {
      x: neighbor.x,
      y: neighbor.y,
      gCost,
      hCost: this.heuristic(neighbor.x, neighbor.y, goal.x, goal.y),
      fCost: 0,
      parent,
      moveCost,
      queueOrder,
    };
    neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
    return neighborNode;
  }

  /**
   * Update existing neighbor node with better path
   */
  private updateNeighborNode(
    neighborNode: AStarNode,
    gCost: number,
    parent: AStarNode,
    moveCost: number,
    openSet: BinaryMinHeap<AStarNode>
  ) {
    neighborNode.gCost = gCost;
    neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
    neighborNode.parent = parent;
    neighborNode.moveCost = moveCost;

    openSet.update(neighborNode);
  }

  /**
   * Reconstruct path from goal node back to start
   */
  private reconstructPath(goalNode: AStarNode): AStarNode[] {
    const path: AStarNode[] = [];
    let current: AStarNode | null = goalNode;

    while (current) {
      path.unshift(current);
      current = current.parent;
    }

    return path;
  }

  /**
   * Get valid neighbor coordinates
   */
  private getNeighbors(x: number, y: number): Array<{ x: number; y: number }> {
    return this.topology.getNeighbors(x, y);
  }

  /**
   * Calculate heuristic cost (Manhattan distance)
   */
  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    // Ruleset railroads can have zero-cost edges, so no positive geometric
    // heuristic is admissible for every map. Dijkstra mode preserves optimal
    // paths across mixed terrain, roads, and railroad networks.
    void x1;
    void y1;
    void x2;
    void y2;
    return 0;
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
      return calculateMovementCost(fromX, fromY, toX, toY, tile.terrain, unit.unitTypeId);
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

  /**
   * Convert A* nodes to PathTile format with directions
   */
  private convertToPathTiles(path: AStarNode[], _unit: Unit): PathTile[] {
    const pathTiles: PathTile[] = [];

    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      const pathTile: PathTile = {
        x: node.x,
        y: node.y,
        moveCost: node.moveCost,
      };

      // Calculate direction to next tile for rendering
      if (i < path.length - 1) {
        const nextNode = path[i + 1];
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
