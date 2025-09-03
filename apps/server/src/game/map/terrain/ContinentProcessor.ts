/**
 * Continent generation and landmass processing algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c continent generation
 * Handles continent assignment, tiny island removal, and landmass processing
 */
import { MapTile, TerrainType } from '../MapTypes';
import { isOceanTerrain, isLandTile, isTinyIsland, isFrozenTerrain } from '../TerrainUtils';

/**
 * Handles continent identification, tiny island removal, and landmass processing
 * Extracted from TerrainGenerator for better separation of concerns
 * @reference freeciv/server/generator/mapgen.c continent processing logic
 */
export class ContinentProcessor {
  private width: number;
  private height: number;
  private _random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this._random = random;
  }

  /**
   * Assign continent IDs to connected landmasses
   * @reference freeciv/server/generator/mapgen.c continent assignment
   */
  public generateContinents(tiles: MapTile[][]): void {
    const visited: boolean[][] = Array(this.width)
      .fill(null)
      .map(() => Array(this.height).fill(false));

    let continentId = 1;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!visited[x][y] && isLandTile(tile.terrain)) {
          this.floodFillContinent(tiles, x, y, continentId, visited);
          continentId++;
        } else if (!visited[x][y] && isOceanTerrain(tile.terrain)) {
          // Mark ocean tiles with continent ID 0
          tiles[x][y].continentId = 0; // Ocean continent ID
          visited[x][y] = true;
        }
      }
    }
  }

  /**
   * Flood fill to assign continent ID to connected land tiles
   * @reference freeciv/server/generator/mapgen.c flood fill for continents
   */
  private floodFillContinent(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    continentId: number,
    visited: boolean[][]
  ): void {
    const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;

      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      if (visited[x][y]) continue;
      if (!isLandTile(tiles[x][y].terrain)) continue;

      visited[x][y] = true;
      tiles[x][y].continentId = continentId;

      // Add neighboring tiles to stack for 4-connectivity
      stack.push({ x: x - 1, y });
      stack.push({ x: x + 1, y });
      stack.push({ x, y: y - 1 });
      stack.push({ x, y: y + 1 });
    }
  }

  /**
   * Remove tiny islands that are too small to be interesting
   * @reference freeciv/server/generator/mapgen.c tiny island removal
   */
  public removeTinyIslands(tiles: MapTile[][], isRandomMode: boolean = false): void {
    const oceanBodies = this.identifyOceanBodies(tiles);

    // Convert tiny landmasses to ocean
    oceanBodies.forEach(_oceanBody => {
      // Find land tiles that might be tiny islands
      const potentialIslands: Array<{ x: number; y: number; tiles: MapTile[] }> = [];

      // Check each tile for tiny island detection
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          const tile = tiles[x][y];

          if (
            isLandTile(tile.terrain) &&
            isTinyIsland(tiles, x, y, this.width, this.height, this._random, isRandomMode)
          ) {
            // Gather connected tiny island tiles
            const islandTiles = this.getConnectedLandTiles(tiles, x, y);

            // Islands smaller than threshold become ocean
            const threshold = isRandomMode ? 3 : 5;
            if (islandTiles.length <= threshold) {
              potentialIslands.push({ x, y, tiles: islandTiles });
            }
          }
        }
      }

      // Convert tiny islands to ocean
      potentialIslands.forEach(island => {
        island.tiles.forEach(tile => {
          const currentTerrain = tile.terrain;

          // Choose appropriate ocean type based on surrounding water
          if (!isFrozenTerrain(currentTerrain)) {
            tile.terrain = this.chooseOceanTerrainForLocation(tiles, tile.x, tile.y);
            tile.continentId = 0; // Ocean continent ID
          }
        });
      });
    });
  }

  /**
   * Identify separate ocean bodies
   * @reference freeciv/server/generator/mapgen.c ocean body identification
   */
  private identifyOceanBodies(tiles: MapTile[][]): Array<{ tiles: MapTile[]; id: number }> {
    const visited: boolean[][] = Array(this.width)
      .fill(null)
      .map(() => Array(this.height).fill(false));

    const oceanBodies: Array<{ tiles: MapTile[]; id: number }> = [];
    let oceanBodyId = 1;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!isOceanTerrain(tile.terrain)) continue;
        if (visited[x][y]) continue;

        const oceanTiles: MapTile[] = [];
        this.floodFillOceanBody(tiles, x, y, visited, oceanTiles);

        if (oceanTiles.length > 0) {
          oceanBodies.push({
            tiles: oceanTiles,
            id: oceanBodyId++,
          });
        }
      }
    }

    return oceanBodies;
  }

  /**
   * Flood fill to identify connected ocean tiles
   * @reference freeciv/server/generator/mapgen.c flood fill for ocean bodies
   */
  private floodFillOceanBody(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    visited: boolean[][],
    oceanTiles: MapTile[]
  ): void {
    const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;

      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      if (visited[x][y]) continue;

      const tile = tiles[x][y];
      if (!isOceanTerrain(tile.terrain)) {
        continue;
      }

      visited[x][y] = true;
      oceanTiles.push(tile);

      // Add neighboring tiles to stack
      stack.push({ x: x - 1, y });
      stack.push({ x: x + 1, y });
      stack.push({ x, y: y - 1 });
      stack.push({ x, y: y + 1 });
    }
  }

  /**
   * Get all connected land tiles from a starting position
   */
  private getConnectedLandTiles(tiles: MapTile[][], startX: number, startY: number): MapTile[] {
    const visited: boolean[][] = Array(this.width)
      .fill(null)
      .map(() => Array(this.height).fill(false));

    const landTiles: MapTile[] = [];
    const stack: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];

    while (stack.length > 0) {
      const { x, y } = stack.pop()!;

      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      if (visited[x][y]) continue;
      if (!isLandTile(tiles[x][y].terrain)) continue;

      visited[x][y] = true;
      landTiles.push(tiles[x][y]);

      // Add neighboring tiles to stack
      stack.push({ x: x - 1, y });
      stack.push({ x: x + 1, y });
      stack.push({ x, y: y - 1 });
      stack.push({ x, y: y + 1 });
    }

    return landTiles;
  }

  /**
   * Choose appropriate ocean terrain type based on location
   */
  private chooseOceanTerrainForLocation(tiles: MapTile[][], x: number, y: number): TerrainType {
    // Count surrounding ocean types to choose the most appropriate
    const oceanTypeCounts: Record<string, number> = {
      coast: 0,
      ocean: 0,
      deep_ocean: 0,
    };

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborTerrain = tiles[nx][ny].terrain;
          if (isOceanTerrain(neighborTerrain)) {
            oceanTypeCounts[neighborTerrain]++;
          }
        }
      }
    }

    // Choose most common ocean type, defaulting to coast
    let mostCommon: TerrainType = 'coast' as TerrainType;
    let maxCount = 0;

    Object.entries(oceanTypeCounts).forEach(([terrainType, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = terrainType as TerrainType;
      }
    });

    return mostCommon;
  }

  /**
   * Public method to create lakes from small ocean bodies
   */
  public createLakesFromOceanBodies(tiles: MapTile[][]): void {
    const oceanBodies = this.identifyOceanBodies(tiles);

    oceanBodies.forEach(oceanBody => {
      // Convert small ocean bodies to lakes (< 15 tiles)
      if (oceanBody.tiles.length < 15) {
        oceanBody.tiles.forEach(tile => {
          if (!isFrozenTerrain(tile.terrain)) {
            tile.terrain = 'lake' as TerrainType;
            // Lakes belong to the nearest land continent
            tile.continentId = this.findNearestLandContinentId(tiles, tile.x, tile.y);
          }
        });
      }
    });
  }

  /**
   * Find the continent ID of the nearest land tile
   */
  private findNearestLandContinentId(tiles: MapTile[][], x: number, y: number): number {
    const maxSearchRadius = 5;

    for (let radius = 1; radius <= maxSearchRadius; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          // Only check perimeter of search square
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
            continue;
          }

          const nx = x + dx;
          const ny = y + dy;

          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            const tile = tiles[nx][ny];
            if (isLandTile(tile.terrain) && tile.continentId > 0) {
              return tile.continentId;
            }
          }
        }
      }
    }

    return 0; // Default to ocean continent ID if no land found
  }
}
