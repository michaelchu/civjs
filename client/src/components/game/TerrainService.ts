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

  static generateContinentTerrain(
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

    const centerX = Math.floor(width / 2);
    const centerY = Math.floor(height / 2);
    const continentWidth = Math.floor(width * 0.6);
    const continentHeight = Math.floor(height * 0.6);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxDistance = Math.min(continentWidth, continentHeight) / 2;

        const noise =
          (Math.sin(x * 0.1) +
            Math.cos(y * 0.1) +
            Math.sin(x * 0.05 + y * 0.05)) *
          3;
        const adjustedDistance = distance + noise;

        if (adjustedDistance < maxDistance) {
          const normalizedDistance = adjustedDistance / maxDistance;
          const elevation =
            Math.random() * 0.3 + (1 - normalizedDistance) * 0.7;

          if (elevation > 0.8) {
            terrain[y][x] = 'mountains';
          } else if (elevation > 0.6) {
            terrain[y][x] = 'hills';
          } else if (elevation > 0.4) {
            terrain[y][x] = Math.random() > 0.5 ? 'forest' : 'grassland';
          } else if (elevation > 0.2) {
            terrain[y][x] = Math.random() > 0.3 ? 'plains' : 'grassland';
          } else {
            terrain[y][x] = 'grassland';
          }

          if (Math.abs(dy) < continentHeight / 6 && Math.random() > 0.85) {
            terrain[y][x] = 'desert';
          }

          if (normalizedDistance > 0.7 && Math.random() > 0.7) {
            terrain[y][x] = 'tundra';
          }
        } else if (adjustedDistance < maxDistance + 2) {
          terrain[y][x] = 'coast';
        }
      }
    }

    return terrain;
  }

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
