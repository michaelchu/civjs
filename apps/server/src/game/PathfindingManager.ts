import { logger } from '../utils/logger';
import { calculateMovementCost, canUnitEnterTerrain } from './constants/MovementConstants';
import type { Unit } from './UnitManager';

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
   * @reference freeciv/common/aicore/path_finding.c
   */
  async findPath(
    unit: Unit,
    targetX: number,
    targetY: number
  ): Promise<PathfindingResult> {
    const startTime = Date.now();
    
    try {
      // Validate coordinates
      if (!this.isValidCoordinate(targetX, targetY)) {
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
      const path = this.aStar(
        { x: unit.x, y: unit.y },
        { x: targetX, y: targetY },
        unit
      );

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
        error: error.message,
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
    const openSet: AStarNode[] = [];
    const closedSet = new Set<string>();
    const nodes = new Map<string, AStarNode>();

    // Create start node
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

    let iterations = 0;
    const maxIterations = this.mapWidth * this.mapHeight; // Prevent infinite loops

    while (openSet.length > 0 && iterations < maxIterations) {
      iterations++;

      // Find node with lowest fCost
      const current = this.getLowestFCostNode(openSet);
      const currentIndex = openSet.indexOf(current);
      openSet.splice(currentIndex, 1);

      closedSet.add(`${current.x},${current.y}`);

      // Check if we reached the goal
      if (current.x === goal.x && current.y === goal.y) {
        return this.reconstructPath(current);
      }

      // Check all neighbors
      const neighbors = this.getNeighbors(current.x, current.y);
      
      for (const neighbor of neighbors) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;
        
        // Skip if in closed set
        if (closedSet.has(neighborKey)) {
          continue;
        }

        // Check if neighbor is walkable
        const moveCost = this.getMovementCost(
          current.x,
          current.y,
          neighbor.x,
          neighbor.y,
          unit
        );
        
        if (moveCost < 0) {
          continue; // Unwalkable terrain
        }

        const tentativeGCost = current.gCost + moveCost;

        let neighborNode = nodes.get(neighborKey);
        if (!neighborNode) {
          // Create new node
          neighborNode = {
            x: neighbor.x,
            y: neighbor.y,
            gCost: tentativeGCost,
            hCost: this.heuristic(neighbor.x, neighbor.y, goal.x, goal.y),
            fCost: 0,
            parent: current,
            moveCost,
          };
          neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
          
          nodes.set(neighborKey, neighborNode);
          openSet.push(neighborNode);
        } else if (tentativeGCost < neighborNode.gCost) {
          // Found better path to this neighbor
          neighborNode.gCost = tentativeGCost;
          neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
          neighborNode.parent = current;
          neighborNode.moveCost = moveCost;

          // Add to open set if not already there
          if (!openSet.includes(neighborNode)) {
            openSet.push(neighborNode);
          }
        }
      }
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
      if (node.fCost < lowest.fCost || 
          (node.fCost === lowest.fCost && node.hCost < lowest.hCost)) {
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
      { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
      { dx: -1, dy: 0 },                     { dx: 1, dy: 0 },
      { dx: -1, dy: 1 },  { dx: 0, dy: 1 },  { dx: 1, dy: 1 },
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
    // Try to get terrain from MapManager
    if (this.mapManager && this.mapManager.getTile) {
      try {
        const tile = this.mapManager.getTile(toX, toY);
        if (tile && tile.terrain) {
          // Use enhanced movement cost calculation
          return calculateMovementCost(fromX, fromY, toX, toY, tile.terrain, unit.unitTypeId);
        }
      } catch (error) {
        logger.debug('MapManager.getTile failed, using default costs', { error: error.message });
      }
    }

    // Fallback movement costs for basic testing when no terrain data available
    const isDiagonal = Math.abs(fromX - toX) === 1 && Math.abs(fromY - toY) === 1;
    return isDiagonal ? 4 : 3; // Use movement fragments (3 = 1 movement point)
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
  private convertToPathTiles(path: AStarNode[], unit: Unit): PathTile[] {
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
        pathTile.direction = this.calculateDirection(
          node.x,
          node.y,
          nextNode.x,
          nextNode.y
        );
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
    if (dx === 0 && dy === -1) return 0; // North
    if (dx === 1 && dy === -1) return 1; // NE  
    if (dx === 1 && dy === 0) return 2;  // East
    if (dx === 1 && dy === 1) return 3;  // SE
    if (dx === 0 && dy === 1) return 4;  // South
    if (dx === -1 && dy === 1) return 5; // SW
    if (dx === -1 && dy === 0) return 6; // West
    if (dx === -1 && dy === -1) return 7; // NW

    return 2; // Default to east
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