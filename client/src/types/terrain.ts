/**
 * Terrain type definitions shared across the application
 */

export type TerrainType =
  | 'ocean'
  | 'coast'
  | 'grassland'
  | 'plains'
  | 'forest'
  | 'hills'
  | 'mountains'
  | 'desert'
  | 'tundra';

/**
 * Build a 2D terrain map from server data
 */
export function buildTerrainMapFromServerData(
  mapTiles: Array<{ x: number; y: number; terrain: string }>,
  width: number,
  height: number
): TerrainType[][] {
  const terrain: TerrainType[][] = [];

  // Initialize with ocean
  for (let y = 0; y < height; y++) {
    terrain[y] = [];
    for (let x = 0; x < width; x++) {
      terrain[y][x] = 'ocean';
    }
  }

  // Fill with server data
  mapTiles.forEach(tile => {
    if (tile.x >= 0 && tile.x < width && tile.y >= 0 && tile.y < height) {
      terrain[tile.y][tile.x] = tile.terrain as TerrainType;
    }
  });

  return terrain;
}
