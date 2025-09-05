import { logger } from '@utils/logger';
import { PlayerState } from '@game/managers/GameManager';
import { MapData, MapTile } from './MapTypes';
import { MapValidator, ValidationResult } from './MapValidator';

/**
 * Map access and utility service
 * Provides shared utilities for map data access, tile operations, and validation
 * Contains methods that don't belong to specific generation strategies
 * @reference freeciv/common/map.c map utility functions
 */
export class MapAccessService {
  private width: number;
  private height: number;
  private mapData: MapData | null = null;
  private mapValidator: MapValidator;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.mapValidator = new MapValidator(width, height);
  }

  /**
   * Set the current map data
   */
  public setMapData(mapData: MapData | null): void {
    this.mapData = mapData;
  }

  /**
   * Get current map data
   */
  public getMapData(): MapData | null {
    return this.mapData;
  }

  /**
   * Get a specific tile by coordinates
   * @param x X coordinate
   * @param y Y coordinate
   * @returns MapTile or null if coordinates are invalid or no map data
   */
  public getTile(x: number, y: number): MapTile | null {
    if (!this.mapData || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.mapData.tiles[x][y];
  }

  /**
   * Check if a position is valid within map bounds
   * @param x X coordinate
   * @param y Y coordinate
   * @returns true if position is valid, false otherwise
   */
  public isValidPosition(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Get neighboring tiles for a given position
   * @param x X coordinate
   * @param y Y coordinate
   * @returns Array of neighboring MapTiles
   */
  public getNeighbors(x: number, y: number): MapTile[] {
    if (!this.mapData) return [];

    const neighbors: MapTile[] = [];
    const directions = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.isValidPosition(nx, ny)) {
        neighbors.push(this.mapData.tiles[nx][ny]);
      }
    }

    return neighbors;
  }

  /**
   * Get tiles visible from a position within radius
   * @param x center X coordinate
   * @param y center Y coordinate
   * @param radius visibility radius
   * @returns Array of visible MapTiles
   */
  public getVisibleTiles(x: number, y: number, radius: number): MapTile[] {
    if (!this.mapData) return [];

    const visible: MapTile[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radius) {
            visible.push(this.mapData.tiles[nx][ny]);
          }
        }
      }
    }
    return visible;
  }

  /**
   * Update tile visibility for a player
   * @param playerId player identifier
   * @param x center X coordinate
   * @param y center Y coordinate
   * @param radius visibility radius
   */
  public updateTileVisibility(playerId: string, x: number, y: number, radius: number): void {
    if (!this.mapData) return;

    const visibleTiles = this.getVisibleTiles(x, y, radius);
    for (const tile of visibleTiles) {
      tile.isVisible = true;
      tile.isExplored = true;
    }

    logger.debug('Updated tile visibility', {
      playerId,
      centerX: x,
      centerY: y,
      radius,
      tilesRevealed: visibleTiles.length,
    });
  }

  /**
   * Update a specific property of a tile
   * @param x X coordinate
   * @param y Y coordinate
   * @param property Property name to update
   * @param value New value for the property
   */
  public updateTileProperty(x: number, y: number, property: string, value: any): void {
    if (!this.mapData || !this.isValidPosition(x, y)) return;

    const tile = this.mapData.tiles[x][y];
    (tile as any)[property] = value;

    logger.debug('Updated tile property', {
      x,
      y,
      property,
      value,
    });
  }

  /**
   * Get movement cost for a tile
   * @reference freeciv/common/movement.c map_move_cost_unit()
   * @param x tile x coordinate
   * @param y tile y coordinate
   * @param unitTypeId optional unit type for specific movement rules
   * @returns movement cost in fragments, or -1 if impassable
   */
  public getMovementCost(x: number, y: number, unitTypeId?: string): number {
    const tile = this.getTile(x, y);
    if (!tile) return -1;

    // Basic movement cost based on terrain type
    // This is a simplified version - full implementation would use MovementConstants
    const baseCosts: Record<string, number> = {
      ocean: 3,
      coast: 3,
      deep_ocean: 3,
      lake: 3,
      plains: 3,
      grassland: 3,
      desert: 3,
      tundra: 3,
      hills: 6,
      forest: 6,
      jungle: 6,
      swamp: 6,
      mountains: -1, // impassable for most units
    };

    const baseCost = baseCosts[tile.terrain] ?? 3;

    // Apply unit-specific modifiers if needed
    if (unitTypeId) {
      // This would normally lookup unit-specific movement rules
      // For now, return base cost
    }

    return baseCost;
  }

  /**
   * Calculate distance between two points using Manhattan distance
   * @reference freeciv/common/map.c map_distance()
   * @param x1 first point x coordinate
   * @param y1 first point y coordinate
   * @param x2 second point x coordinate
   * @param y2 second point y coordinate
   * @returns distance between the two points
   */
  public getDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);

    // Handle wrapping for world maps (simplified for now)
    const wrappedDx = Math.min(dx, this.width - dx);
    const wrappedDy = Math.min(dy, this.height - dy);

    return Math.max(wrappedDx, wrappedDy);
  }

  /**
   * Get tiles accessible within movement range
   * @reference freeciv/common/aicore/path_finding.c pf_create_map()
   * @param x starting x coordinate
   * @param y starting y coordinate
   * @param movementPoints available movement points
   * @param unitTypeId unit type for movement rules
   * @returns array of accessible tiles
   */
  public getAccessibleTiles(
    x: number,
    y: number,
    movementPoints: number,
    unitTypeId?: string
  ): MapTile[] {
    const accessibleTiles: MapTile[] = [];
    const visited = new Set<string>();
    const queue: Array<{ x: number; y: number; remainingMoves: number }> = [
      { x, y, remainingMoves: movementPoints * 3 },
    ]; // Convert to movement fragments

    visited.add(`${x},${y}`);

    while (queue.length > 0) {
      const current = queue.shift()!;

      // Add current tile to accessible tiles
      const tile = this.getTile(current.x, current.y);
      if (tile) {
        accessibleTiles.push(tile);
      }

      // Check all neighboring tiles
      const neighbors = this.getNeighbors(current.x, current.y);
      for (const neighbor of neighbors) {
        const key = `${neighbor.x},${neighbor.y}`;
        if (visited.has(key)) continue;

        const moveCost = this.getMovementCost(neighbor.x, neighbor.y, unitTypeId);
        if (moveCost < 0) continue; // Impassable

        const remainingAfterMove = current.remainingMoves - moveCost;
        if (remainingAfterMove >= 0) {
          visited.add(key);
          queue.push({
            x: neighbor.x,
            y: neighbor.y,
            remainingMoves: remainingAfterMove,
          });
        }
      }
    }

    return accessibleTiles;
  }

  /**
   * Validate the current map data using the comprehensive validation system
   * @param players Optional player states for enhanced validation context
   * @returns Comprehensive validation result with metrics and issues
   */
  public validateCurrentMap(players?: Map<string, PlayerState>): ValidationResult | null {
    if (!this.mapData) {
      logger.warn('Cannot validate map: no map data available');
      return null;
    }

    logger.debug('Validating current map data', {
      width: this.width,
      height: this.height,
      startingPositions: this.mapData.startingPositions.length,
      players: players?.size || 0,
    });

    return this.mapValidator.validateMap(
      this.mapData.tiles,
      this.mapData.startingPositions,
      players
    );
  }

  /**
   * Get the map validator instance for advanced validation operations
   * @returns MapValidator instance
   */
  public getMapValidator(): MapValidator {
    return this.mapValidator;
  }

  /**
   * Validate map structure and properties
   * @reference freeciv/server/maphand.c map_fractal_generate()
   * @returns validation result with issues found
   */
  public validateMap(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check map dimensions
    if (this.width < 1 || this.height < 1) {
      issues.push('Invalid map dimensions');
    }

    // Check if map is generated
    if (!this.mapData || this.mapData.tiles.length === 0) {
      issues.push('Map not generated');
      return { valid: false, issues };
    }

    // Check tile count matches dimensions
    const expectedTileCount = this.width * this.height;
    let actualTileCount = 0;
    for (const tileArray of this.mapData.tiles) {
      actualTileCount += tileArray.length;
    }

    if (actualTileCount !== expectedTileCount) {
      issues.push(`Tile count mismatch: expected ${expectedTileCount}, got ${actualTileCount}`);
    }

    // Check for valid terrain types
    const validTerrains = [
      'ocean',
      'coast',
      'deep_ocean',
      'lake',
      'plains',
      'grassland',
      'desert',
      'tundra',
      'hills',
      'forest',
      'jungle',
      'swamp',
      'mountains',
    ];
    let invalidTerrainCount = 0;

    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        if (!validTerrains.includes(tile.terrain)) {
          invalidTerrainCount++;
        }
      }
    }

    if (invalidTerrainCount > 0) {
      issues.push(`${invalidTerrainCount} tiles have invalid terrain types`);
    }

    // Check starting positions
    if (this.mapData.startingPositions.length === 0) {
      issues.push('No starting positions found');
    } else {
      // Validate starting positions are within map bounds
      let invalidStartingPositions = 0;
      for (const position of this.mapData.startingPositions) {
        if (!this.isValidPosition(position.x, position.y)) {
          invalidStartingPositions++;
        }
      }
      if (invalidStartingPositions > 0) {
        issues.push(`${invalidStartingPositions} starting positions are out of bounds`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Get all land tiles belonging to a specific continent
   * @param tiles tile array to search
   * @param continentId continent identifier
   * @returns array of tiles belonging to the continent
   */
  public getContinentTiles(tiles: MapTile[][], continentId: number): MapTile[] {
    const continentTiles: MapTile[] = [];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (
          tile.continentId === continentId &&
          (tile.terrain === 'grassland' || tile.terrain === 'plains')
        ) {
          continentTiles.push(tile);
        }
      }
    }

    return continentTiles;
  }

  /**
   * Calculate land percentage of the map
   * @param tiles optional tile array, uses current map data if not provided
   * @returns land percentage (0-100)
   */
  public getLandPercent(tiles?: MapTile[][]): number {
    const mapTiles = tiles || this.mapData?.tiles;
    if (!mapTiles) return 0;

    let landTiles = 0;
    let totalTiles = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        totalTiles++;
        if (mapTiles[x][y].terrain !== 'ocean') {
          landTiles++;
        }
      }
    }

    const landPercent = totalTiles > 0 ? (landTiles / totalTiles) * 100 : 0;

    logger.debug('Calculated land percentage', {
      landTiles,
      totalTiles,
      landPercent: landPercent.toFixed(2) + '%',
    });

    return landPercent;
  }

  /**
   * Find all tiles of a specific terrain type
   * @param terrainType terrain type to search for
   * @returns array of matching tiles
   */
  public findTilesByTerrain(terrainType: string): MapTile[] {
    if (!this.mapData) return [];

    const matchingTiles: MapTile[] = [];
    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        if (tile.terrain === terrainType) {
          matchingTiles.push(tile);
        }
      }
    }

    return matchingTiles;
  }

  /**
   * Find all tiles with a specific resource
   * @param resourceType resource type to search for
   * @returns array of tiles with the resource
   */
  public findTilesByResource(resourceType: string): MapTile[] {
    if (!this.mapData) return [];

    const matchingTiles: MapTile[] = [];
    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        if (tile.resource === resourceType) {
          matchingTiles.push(tile);
        }
      }
    }

    return matchingTiles;
  }

  /**
   * Get map statistics summary
   * @returns object with various map statistics
   */
  public getMapStatistics(): {
    dimensions: { width: number; height: number };
    landPercent: number;
    terrainCounts: Record<string, number>;
    resourceCounts: Record<string, number>;
    startingPositions: number;
    continentIds: number[];
  } {
    const stats = {
      dimensions: { width: this.width, height: this.height },
      landPercent: this.getLandPercent(),
      terrainCounts: {} as Record<string, number>,
      resourceCounts: {} as Record<string, number>,
      startingPositions: this.mapData?.startingPositions.length || 0,
      continentIds: [] as number[],
    };

    if (!this.mapData) return stats;

    // Count terrain and resource types
    const continentIdSet = new Set<number>();

    for (const tileArray of this.mapData.tiles) {
      for (const tile of tileArray) {
        // Count terrain types
        stats.terrainCounts[tile.terrain] = (stats.terrainCounts[tile.terrain] || 0) + 1;

        // Count resource types (skip none/undefined)
        if (tile.resource && tile.resource !== ('none' as any)) {
          stats.resourceCounts[tile.resource] = (stats.resourceCounts[tile.resource] || 0) + 1;
        }

        // Track continent IDs
        if (tile.continentId > 0) {
          continentIdSet.add(tile.continentId);
        }
      }
    }

    stats.continentIds = Array.from(continentIdSet).sort((a, b) => a - b);

    return stats;
  }
}
