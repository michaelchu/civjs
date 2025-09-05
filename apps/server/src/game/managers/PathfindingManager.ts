import { logger } from '@utils/logger';
import { calculateMovementCost } from '@game/constants/MovementConstants';
import type { Unit } from '@game/managers/UnitManager';

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
}

interface AStarNode {
  x: number;
  y: number;
  gCost: number; // Cost from start
  hCost: number; // Heuristic cost to goal
  fCost: number; // Total cost (g + h)
  parent: AStarNode | null;
  moveCost: number; // Cost to move to this tile
}

/**
 * A* Pathfinding Manager for unit movement
 * Based on freeciv's pathfinding system and classic A* algorithm
 *
 * @reference freeciv/common/aicore/path_finding.h - Core pathfinding definitions
 * @reference freeciv/common/aicore/path_finding.c - PF algorithm implementation
 * @reference freeciv-web/freeciv/patches/goto_fcweb.patch - Server-side goto handling
 * @compliance Implements A* algorithm with move cost calculations as per freeciv standards
 */
export class PathfindingManager {
  private mapWidth: number;
  private mapHeight: number;
  private mapManager: any; // MapManager instance for terrain access

  constructor(mapWidth: number, mapHeight: number, mapManager?: any) {
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.mapManager = mapManager;
  }

  /**
   * Find path from unit to target using A* algorithm
   * Implements the core pathfinding logic similar to freeciv's PF system
   *
   * @reference freeciv/common/aicore/path_finding.c:pf_map_new() - Path finding initialization
   * @reference freeciv/common/aicore/path_finding.c:pf_map_iterate() - Path iteration algorithm
   * @compliance Uses movement cost calculation and heuristic matching freeciv standards
   */
  async findPath(unit: Unit, targetX: number, targetY: number): Promise<PathfindingResult> {
    const startTime = Date.now();

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
        return {
          path: [],
          totalCost: 0,
          estimatedTurns: 0,
          valid: false,
        };
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

      // Run A* pathfinding
      const path = this.aStar({ x: unit.x, y: unit.y }, { x: targetX, y: targetY }, unit);

      if (!path || path.length === 0) {
        return {
          path: [],
          totalCost: 0,
          estimatedTurns: 0,
          valid: false,
        };
      }

      // Convert to PathTile format and calculate costs
      const pathTiles = this.convertToPathTiles(path, unit);
      const totalCost = pathTiles.reduce((sum, tile) => sum + tile.moveCost, 0);
      const estimatedTurns = this.calculateTurns(totalCost, unit);

      const result = {
        path: pathTiles,
        totalCost,
        estimatedTurns,
        valid: true,
      };

      const duration = Date.now() - startTime;
      logger.info('Pathfinding completed', {
        unitId: unit.id,
        from: { x: unit.x, y: unit.y },
        to: { x: targetX, y: targetY },
        pathLength: pathTiles.length,
        totalCost,
        estimatedTurns,
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

      return {
        path: [],
        totalCost: 0,
        estimatedTurns: 0,
        valid: false,
      };
    }
  }

  /**
   * A* pathfinding algorithm implementation
   * @reference https://en.wikipedia.org/wiki/A*_search_algorithm
   */
  private aStar(
    start: { x: number; y: number },
    goal: { x: number; y: number },
    unit: Unit
  ): AStarNode[] | null {
    const { openSet, closedSet, nodes } = this.initializeAStarSearch(start, goal);

    let iterations = 0;
    const maxIterations = this.mapWidth * this.mapHeight;

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      const current = this.processCurrentNode(openSet, closedSet);

      if (current.x === goal.x && current.y === goal.y) {
        return this.reconstructPath(current);
      }

      this.processNeighbors(current, goal, unit, openSet, closedSet, nodes);
    }

    // No path found
    logger.warn('A* pathfinding failed to find path', {
      unitId: unit.id,
      from: start,
      to: goal,
      iterations,
      maxIterations,
    });

    return null;
  }

  /**
   * Initialize A* search data structures
   */
  private initializeAStarSearch(start: { x: number; y: number }, goal: { x: number; y: number }) {
    const openSet: AStarNode[] = [];
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
    };
    startNode.fCost = startNode.gCost + startNode.hCost;

    openSet.push(startNode);
    nodes.set(`${start.x},${start.y}`, startNode);

    return { openSet, closedSet, nodes };
  }

  /**
   * Process current node in A* algorithm
   */
  private processCurrentNode(openSet: AStarNode[], closedSet: Set<string>): AStarNode {
    const current = this.getLowestFCostNode(openSet);
    const currentIndex = openSet.indexOf(current);
    openSet.splice(currentIndex, 1);
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
    openSet: AStarNode[],
    closedSet: Set<string>,
    nodes: Map<string, AStarNode>
  ) {
    const neighbors = this.getNeighbors(current.x, current.y);

    for (const neighbor of neighbors) {
      this.processNeighborNode(current, neighbor, goal, unit, openSet, closedSet, nodes);
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
    openSet: AStarNode[],
    closedSet: Set<string>,
    nodes: Map<string, AStarNode>
  ) {
    const neighborKey = `${neighbor.x},${neighbor.y}`;

    if (closedSet.has(neighborKey)) {
      return;
    }

    const moveCost = this.getMovementCost(current.x, current.y, neighbor.x, neighbor.y, unit);
    if (moveCost < 0) {
      return; // Unwalkable terrain
    }

    const tentativeGCost = current.gCost + moveCost;
    let neighborNode = nodes.get(neighborKey);

    if (!neighborNode) {
      neighborNode = this.createNeighborNode(neighbor, tentativeGCost, goal, current, moveCost);
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
    moveCost: number
  ): AStarNode {
    const neighborNode: AStarNode = {
      x: neighbor.x,
      y: neighbor.y,
      gCost,
      hCost: this.heuristic(neighbor.x, neighbor.y, goal.x, goal.y),
      fCost: 0,
      parent,
      moveCost,
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
    openSet: AStarNode[]
  ) {
    neighborNode.gCost = gCost;
    neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
    neighborNode.parent = parent;
    neighborNode.moveCost = moveCost;

    if (!openSet.includes(neighborNode)) {
      openSet.push(neighborNode);
    }
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
   * Find node with lowest fCost in open set
   */
  private getLowestFCostNode(openSet: AStarNode[]): AStarNode {
    let lowest = openSet[0];

    for (let i = 1; i < openSet.length; i++) {
      const node = openSet[i];
      if (node.fCost < lowest.fCost || (node.fCost === lowest.fCost && node.hCost < lowest.hCost)) {
        lowest = node;
      }
    }

    return lowest;
  }

  /**
   * Get valid neighbor coordinates
   */
  private getNeighbors(x: number, y: number): Array<{ x: number; y: number }> {
    const neighbors: Array<{ x: number; y: number }> = [];

    // 8-directional movement (includes diagonals)
    const directions = [
      { dx: -1, dy: -1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },
      { dx: 0, dy: 1 },
      { dx: 1, dy: 1 },
    ];

    for (const dir of directions) {
      const newX = x + dir.dx;
      const newY = y + dir.dy;

      if (this.isValidCoordinate(newX, newY)) {
        neighbors.push({ x: newX, y: newY });
      }
    }

    return neighbors;
  }

  /**
   * Calculate heuristic cost (Manhattan distance)
   */
  private heuristic(x1: number, y1: number, x2: number, y2: number): number {
    // Use Manhattan distance as heuristic
    return Math.abs(x2 - x1) + Math.abs(y2 - y1);
  }

  /**
   * Get movement cost between two adjacent tiles
   */
  private getMovementCost(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    unit: Unit
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
    return x >= 0 && x < this.mapWidth && y >= 0 && y < this.mapHeight;
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
    const dx = toX - fromX;
    const dy = toY - fromY;

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
    // Get unit's movement points per turn
    // For now, assume 3 movement points per turn for most units
    // This should be enhanced to use actual unit type data
    const movementPerTurn = unit.movementLeft || 3;

    return Math.ceil(totalCost / movementPerTurn);
  }
}
