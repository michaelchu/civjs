/**
 * @module server/game/map/RiverGenerator
 * Implements River Generator map behavior.
 */
import { logger } from '@utils/logger';
import { MapTile, TerrainType, TerrainProperty } from './MapTypes';
import { MapTopology, type MapTopologyOptions } from './MapTopology';

/**
 * River map state tracking for sophisticated river generation
 * @reference freeciv/server/generator/mapgen.c:115-118
 */
export interface RiverMapState {
  blocked: Set<number>; // Tiles marked as blocked for river placement
  ok: Set<number>; // Tiles marked as valid river tiles
}

export class RiverGenerator {
  private width: number;
  private height: number;
  private random: () => number;
  private topology: MapTopology;

  constructor(
    width: number,
    height: number,
    random: () => number,
    topologyOptions: MapTopologyOptions = {}
  ) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.topology = new MapTopology(width, height, topologyOptions);
  }

  /**
   * Generate advanced river system with flowing networks
   */
  public async generateAdvancedRivers(
    tiles: MapTile[][],
    densityPercent: number = 50
  ): Promise<void> {
    logger.info('Starting advanced river generation');
    const startTime = Date.now();

    // Create river map state
    const riverMap: RiverMapState = {
      blocked: new Set<number>(),
      ok: new Set<number>(),
    };

    // Calculate number of river networks based on map size (fewer networks, longer rivers)
    const mapArea = this.width * this.height;
    const densityScale = Math.max(0, Math.min(100, densityPercent)) / 50;
    const baselineNetworks = Math.max(3, Math.floor(Math.sqrt(mapArea) / 8));
    const targetNetworks =
      densityScale === 0 ? 0 : Math.max(1, Math.round(baselineNetworks * densityScale));

    let networksCreated = 0;
    let totalRiverTiles = 0;

    // Generate river networks from high elevation to ocean
    for (
      let attempt = 0;
      attempt < targetNetworks * 10 && networksCreated < targetNetworks;
      attempt++
    ) {
      const startPos = this.findRiverStartPosition(tiles);
      if (startPos) {
        const networkLength = this.generateRiverNetwork(startPos.x, startPos.y, tiles, riverMap);
        if (networkLength > 0) {
          networksCreated++;
          totalRiverTiles += networkLength;
        }
      }
    }

    // After generating networks, calculate connection masks for all river tiles
    this.calculateRiverConnections(tiles);

    const endTime = Date.now();
    logger.info(
      `Advanced river generation completed: ${networksCreated} networks with ${totalRiverTiles} total river tiles in ${
        endTime - startTime
      }ms`
    );
  }

  /**
   * Check if a tile is suitable for river placement
   */
  private isRiverSuitable(x: number, y: number, tiles: MapTile[][]): boolean {
    const tile = tiles[x][y];

    // Prefer mountainous terrain
    const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
    if (mountainous > 30) {
      return true;
    }

    // Avoid dry terrain unless it's near water
    const dry = tile.properties[TerrainProperty.DRY] || 0;
    if (dry > 70) {
      return this.isNearWater(x, y, tiles);
    }

    // Generally suitable for temperate terrain
    return tile.terrain === 'grassland' || tile.terrain === 'plains' || tile.terrain === 'forest';
  }

  /**
   * Check if tile is near water
   */
  private isNearWater(x: number, y: number, tiles: MapTile[][]): boolean {
    return this.topology
      .getPositionsWithinRadius(x, y, 2)
      .some(position => !this.isLandTile(tiles[position.x][position.y].terrain));
  }

  /**
   * Convert terrain to be more suitable for rivers
   */
  private convertTerrainForRiver(tile: MapTile): void {
    // Convert desert near rivers to more fertile land
    if (tile.terrain === 'desert') {
      tile.terrain = 'plains';
    }
    // Swamps can stay as swamps (natural for rivers)
    // Mountains become hills when rivers flow through
    else if (tile.terrain === 'mountains') {
      if (this.random() < 0.4) {
        tile.terrain = 'hills';
      }
    }
  }

  /**
   * Check if terrain type is land (not water)
   */
  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }

  /**
   * Mark river blocks for advanced placement
   */
  public riverBlockMark(riverMap: RiverMapState, x: number, y: number): void {
    const tileIndex = y * this.width + x;
    riverMap.blocked.add(tileIndex);
  }

  /**
   * Check if river density is acceptable in area
   */
  public checkNearbyRiverDensity(startX: number, startY: number, tiles: MapTile[][]): boolean {
    const radius = 5;
    let riverCount = 0;
    let totalCount = 0;

    for (const position of this.topology.getPositionsWithinRadius(startX, startY, radius)) {
      totalCount++;
      if (tiles[position.x][position.y].riverMask > 0) {
        riverCount++;
      }
    }

    const density = riverCount / totalCount;
    return density < 0.25; // Max 25% river density in local area
  }

  /**
   * Find suitable starting position for river network (high elevation, away from existing rivers)
   */
  private findRiverStartPosition(tiles: MapTile[][]): { x: number; y: number } | null {
    // Create randomized positions to eliminate spatial bias
    const positions = this.getAllPositionsShuffled();

    // Primary strategy: mountainous candidates
    let candidates = this.collectMountainCandidates(tiles, positions);

    // Fallback: very high elevation
    if (candidates.length === 0) {
      candidates = this.collectHighElevationCandidates(tiles, positions, 180, 20);
    }

    // Last resort: high elevation
    if (candidates.length === 0) {
      candidates = this.collectHighElevationCandidates(tiles, positions, 160, 15);
    }

    if (candidates.length === 0) return null;

    // Sort by elevation and pick from top candidates
    candidates.sort((a, b) => b.elevation - a.elevation);
    const topCandidates = candidates.slice(0, Math.min(10, candidates.length));
    return topCandidates[Math.floor(this.random() * topCandidates.length)];
  }

  /**
   * Generate all map positions and return them shuffled
   */
  private getAllPositionsShuffled(): { x: number; y: number }[] {
    const all: { x: number; y: number }[] = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        all.push({ x, y });
      }
    }
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all;
  }

  /**
   * Collect mountainous candidates with elevation preference
   */
  private collectMountainCandidates(
    tiles: MapTile[][],
    positions: { x: number; y: number }[]
  ): { x: number; y: number; elevation: number }[] {
    const result: { x: number; y: number; elevation: number }[] = [];
    for (const pos of positions) {
      const tile = tiles[pos.x][pos.y];
      if (this.isSuitableStartBase(tile) && tile.elevation > 150) {
        const mountainous = tile.properties[TerrainProperty.MOUNTAINOUS] || 0;
        if (mountainous > 20) {
          result.push({ x: pos.x, y: pos.y, elevation: tile.elevation + mountainous });
        }
      }
    }
    return result;
  }

  /**
   * Collect high elevation candidates with optional limit
   */
  private collectHighElevationCandidates(
    tiles: MapTile[][],
    positions: { x: number; y: number }[],
    threshold: number,
    limit: number
  ): { x: number; y: number; elevation: number }[] {
    const result: { x: number; y: number; elevation: number }[] = [];
    for (const pos of positions) {
      const tile = tiles[pos.x][pos.y];
      if (this.isSuitableStartBase(tile) && tile.elevation > threshold) {
        result.push({ x: pos.x, y: pos.y, elevation: tile.elevation });
        if (result.length >= limit) break;
      }
    }
    return result;
  }

  /**
   * Common suitability checks for river start
   */
  private isSuitableStartBase(tile: MapTile): boolean {
    return this.isLandTile(tile.terrain) && tile.riverMask === 0;
  }

  /**
   * Generate a flowing river network from start position to ocean
   */
  private generateRiverNetwork(
    startX: number,
    startY: number,
    tiles: MapTile[][],
    riverMap: RiverMapState
  ): number {
    const riverPath: { x: number; y: number }[] = [];
    let currentX = startX;
    let currentY = startY;
    let length = 0;
    const maxLength = 30; // Prevent infinite loops
    const visited = new Set<string>();

    while (length < maxLength) {
      const key = `${currentX},${currentY}`;

      // Avoid cycles
      if (visited.has(key)) break;
      visited.add(key);

      // Mark current tile as river
      tiles[currentX][currentY].riverMask = 1; // Temporary value, will be recalculated
      riverPath.push({ x: currentX, y: currentY });
      this.convertTerrainForRiver(tiles[currentX][currentY]);
      length++;

      // Try to find next position (flow downhill toward ocean)
      const nextPos = this.findNextRiverPosition(currentX, currentY, tiles, visited);
      if (!nextPos) break;

      currentX = nextPos.x;
      currentY = nextPos.y;

      // Stop if we reached ocean
      if (!this.isLandTile(tiles[currentX][currentY].terrain)) {
        break;
      }
    }

    // Mark all positions in river map
    for (const pos of riverPath) {
      const tileIndex = pos.y * this.width + pos.x;
      riverMap.ok.add(tileIndex);
    }

    return length;
  }

  /**
   * Find next position for river to flow (prefer downhill, toward ocean)
   */
  private findNextRiverPosition(
    x: number,
    y: number,
    tiles: MapTile[][],
    visited: Set<string>
  ): { x: number; y: number } | null {
    const currentElevation = tiles[x][y].elevation;
    const candidates: { x: number; y: number; score: number }[] = [];

    for (const position of this.topology.getCardinalNeighbors(x, y)) {
      const nx = position.x;
      const ny = position.y;
      const key = `${nx},${ny}`;

      if (!visited.has(key)) {
        const neighborTile = tiles[nx][ny];

        // Don't flow through existing rivers
        if (neighborTile.riverMask > 0) continue;

        let score = 0;

        // Prefer flowing toward ocean
        if (!this.isLandTile(neighborTile.terrain)) {
          score += 1000; // High priority for reaching ocean
        } else {
          // Prefer flowing downhill
          if (neighborTile.elevation < currentElevation) {
            score += (currentElevation - neighborTile.elevation) * 2;
          }

          // Prefer suitable river terrain
          if (this.isRiverSuitable(nx, ny, tiles)) {
            score += 50;
          }

          // Avoid mountains unless coming from higher mountains
          const mountainous = neighborTile.properties[TerrainProperty.MOUNTAINOUS] || 0;
          if (mountainous > 80 && neighborTile.elevation >= currentElevation) {
            continue; // Can't flow uphill into mountains
          }
        }

        candidates.push({ x: nx, y: ny, score });
      }
    }

    if (candidates.length === 0) return null;

    // Pick best candidate (highest score)
    candidates.sort((a, b) => b.score - a.score);

    // Add some randomness - pick from top 3 candidates
    const topCandidates = candidates.slice(0, Math.min(3, candidates.length));
    return topCandidates[Math.floor(this.random() * topCandidates.length)];
  }

  /**
   * Calculate river connection masks for all river tiles after network generation
   */
  private calculateRiverConnections(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].riverMask > 0) {
          tiles[x][y].riverMask = this.calculateRiverMaskForTile(tiles, x, y);
        }
      }
    }
  }

  /**
   * Calculate river connection mask for a specific tile
   */
  private calculateRiverMaskForTile(tiles: MapTile[][], x: number, y: number): number {
    let mask = 0;

    // Check cardinal directions for river connections
    const cardinalDirs = [
      { dx: 0, dy: -1, mask: 1 }, // North
      { dx: 1, dy: 0, mask: 2 }, // East
      { dx: 0, dy: 1, mask: 4 }, // South
      { dx: -1, dy: 0, mask: 8 }, // West
    ];

    for (const dir of cardinalDirs) {
      const neighbor = this.topology.normalize(x + dir.dx, y + dir.dy);
      if (neighbor && this.shouldConnectToNeighbor(tiles, neighbor.x, neighbor.y)) {
        mask |= dir.mask;
      }
    }

    return mask;
  }

  /**
   * Check if river should connect to neighbor tile
   */
  private shouldConnectToNeighbor(tiles: MapTile[][], nx: number, ny: number): boolean {
    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
      return false;
    }

    const neighborTile = tiles[nx][ny];

    // Connect to other rivers or ocean
    return neighborTile.riverMask > 0 || !this.isLandTile(neighborTile.terrain);
  }
}
