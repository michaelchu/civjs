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

export class TerrainService {
  static getTerrainColor(terrain: TerrainType): number {
    const terrainColors: Record<TerrainType, number> = {
      ocean: 0x1e40af,
      coast: 0x3b82f6,
      grassland: 0x22c55e,
      plains: 0x84cc16,
      forest: 0x166534,
      hills: 0xa3a3a3,
      mountains: 0x525252,
      desert: 0xfbbf24,
      tundra: 0xe5e7eb,
    };
    return terrainColors[terrain];
  }

  static getTerrainStrokeColor(terrain: TerrainType): number {
    if (terrain === 'ocean' || terrain === 'coast') return 0x1e3a8a;
    if (terrain === 'mountains') return 0x374151;
    if (terrain === 'desert') return 0xd97706;
    return 0x16a34a;
  }

  // Removed generateContinentTerrain - all maps should come from server

  static buildTerrainMapFromServerData(
    mapTiles: Array<{ x: number; y: number; terrain: string }>,
    width: number,
    height: number
  ): TerrainType[][] {
    const terrain: TerrainType[][] = [];

    for (let y = 0; y < height; y++) {
      terrain[y] = [];
      for (let x = 0; x < width; x++) {
        terrain[y][x] = 'ocean';
      }
    }

    mapTiles.forEach(tile => {
      if (tile.x >= 0 && tile.x < width && tile.y >= 0 && tile.y < height) {
        terrain[tile.y][tile.x] = tile.terrain as TerrainType;
      }
    });

    return terrain;
  }
}
