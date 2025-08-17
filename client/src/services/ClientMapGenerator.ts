/**
 * Client-side Map Generator - Deterministic procedural generation
 * Replaces database tile storage with seed-based generation
 * Based on server MapGenerationService but runs in browser
 */

export interface MapDimensions {
  width: number;
  height: number;
}

export interface MapSeed {
  gameId: string;
  seed: string;
  mapSize: 'small' | 'medium' | 'large';
  generatedAt: string;
}

export type TerrainType =
  | 'ocean'
  | 'coast'
  | 'grassland'
  | 'plains'
  | 'desert'
  | 'tundra'
  | 'forest'
  | 'hills'
  | 'mountains';

export interface MapTile {
  x: number;
  y: number;
  terrain: TerrainType;
}

// Seeded random number generator - identical to server implementation
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashCode(seed);
  }

  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }
}

export class ClientMapGenerator {
  private rng!: SeededRandom;

  /**
   * Generate a complete map from seed - matches server algorithm exactly
   */
  public generateFromSeed(mapSeed: MapSeed): TerrainType[][] {
    console.log(`🌍 Generating map client-side from seed: ${mapSeed.seed}`);

    // Initialize with exact same seed as server would use
    this.rng = new SeededRandom(mapSeed.seed);

    const dimensions = this.getMapDimensions(mapSeed.mapSize);
    console.log(`📏 Map dimensions: ${dimensions.width}x${dimensions.height}`);

    // Generate continent layout
    const landMap = this.generateContinents(dimensions);

    // Generate elevation map for terrain variation
    const elevationMap = this.generateElevationMap(dimensions, landMap);

    // Build 2D terrain array
    const terrainMap: TerrainType[][] = Array(dimensions.height)
      .fill(null)
      .map(() => Array(dimensions.width).fill('ocean' as TerrainType));

    // Generate terrain for each tile
    for (let y = 0; y < dimensions.height; y++) {
      for (let x = 0; x < dimensions.width; x++) {
        const terrain = this.getTerrainAtPosition(
          x,
          y,
          dimensions,
          landMap,
          elevationMap
        );
        terrainMap[y][x] = terrain;
      }
    }

    console.log(
      `✅ Generated ${dimensions.width}x${dimensions.height} map with ${this.countTerrain(terrainMap, 'grassland')} grassland tiles`
    );

    return terrainMap;
  }

  /**
   * Count tiles of specific terrain type (for debugging)
   */
  private countTerrain(map: TerrainType[][], terrain: TerrainType): number {
    return map.flat().filter(t => t === terrain).length;
  }

  public getMapDimensions(
    mapSize: 'small' | 'medium' | 'large'
  ): MapDimensions {
    switch (mapSize) {
      case 'small':
        return { width: 60, height: 60 };
      case 'medium':
        return { width: 80, height: 80 };
      case 'large':
        return { width: 100, height: 100 };
      default:
        return { width: 80, height: 80 };
    }
  }

  private generateContinents(dimensions: MapDimensions): boolean[][] {
    const landMap: boolean[][] = Array(dimensions.width)
      .fill(null)
      .map(() => Array(dimensions.height).fill(false));

    // Generate 2-4 random continent centers based on map size
    const continentCount = this.rng.nextInt(
      2,
      Math.min(4, Math.floor(dimensions.width / 15))
    );
    const continents: { x: number; y: number; size: number }[] = [];

    for (let i = 0; i < continentCount; i++) {
      const x = this.rng.nextInt(
        Math.floor(dimensions.width * 0.1),
        Math.floor(dimensions.width * 0.9)
      );
      const y = this.rng.nextInt(
        Math.floor(dimensions.height * 0.1),
        Math.floor(dimensions.height * 0.9)
      );
      const size =
        this.rng.nextFloat(0.15, 0.35) *
        Math.min(dimensions.width, dimensions.height);
      continents.push({ x, y, size });
    }

    // Generate landmasses around continent centers
    for (let x = 0; x < dimensions.width; x++) {
      for (let y = 0; y < dimensions.height; y++) {
        let isLand = false;

        for (const continent of continents) {
          const distance = Math.sqrt(
            Math.pow(x - continent.x, 2) + Math.pow(y - continent.y, 2)
          );

          // Add multiple octaves of noise for natural coastlines
          const noise = this.multilayerNoise(x, y, dimensions);
          const adjustedDistance = distance + noise * (continent.size * 0.3);

          if (adjustedDistance < continent.size) {
            isLand = true;
            break;
          }
        }

        landMap[x]![y] = isLand;
      }
    }

    return landMap;
  }

  private multilayerNoise(
    x: number,
    y: number,
    dimensions: MapDimensions
  ): number {
    // Create layered noise using seeded random for natural terrain
    const scale1 = Math.min(dimensions.width, dimensions.height) * 0.1;
    const scale2 = Math.min(dimensions.width, dimensions.height) * 0.05;
    const scale3 = Math.min(dimensions.width, dimensions.height) * 0.02;

    const noise1 = this.noise2D(x / scale1, y / scale1) * 0.5;
    const noise2 = this.noise2D(x / scale2, y / scale2) * 0.3;
    const noise3 = this.noise2D(x / scale3, y / scale3) * 0.2;

    return noise1 + noise2 + noise3;
  }

  private noise2D(x: number, y: number): number {
    // Simple 2D noise function using seeded random
    const intX = Math.floor(x);
    const intY = Math.floor(y);
    const fracX = x - intX;
    const fracY = y - intY;

    const a = this.pseudoRandom(intX, intY);
    const b = this.pseudoRandom(intX + 1, intY);
    const c = this.pseudoRandom(intX, intY + 1);
    const d = this.pseudoRandom(intX + 1, intY + 1);

    const i1 = this.interpolate(a, b, fracX);
    const i2 = this.interpolate(c, d, fracX);

    return this.interpolate(i1, i2, fracY);
  }

  private pseudoRandom(x: number, y: number): number {
    // Create deterministic "random" value from coordinates
    const n =
      Math.sin(x * 12.9898 + y * 78.233 + this.rng.next() * 37.719) *
      43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  }

  private interpolate(a: number, b: number, t: number): number {
    // Smooth interpolation
    const ft = t * Math.PI;
    const f = (1 - Math.cos(ft)) * 0.5;
    return a * (1 - f) + b * f;
  }

  private generateElevationMap(
    dimensions: MapDimensions,
    landMap: boolean[][]
  ): number[][] {
    const elevationMap: number[][] = Array(dimensions.width)
      .fill(null)
      .map(() => Array(dimensions.height).fill(0));

    for (let x = 0; x < dimensions.width; x++) {
      for (let y = 0; y < dimensions.height; y++) {
        if (landMap[x]?.[y]) {
          elevationMap[x]![y] = Math.max(
            0,
            this.multilayerNoise(x, y, dimensions) + 0.5
          );
        }
      }
    }

    return elevationMap;
  }

  private getTerrainAtPosition(
    x: number,
    y: number,
    dimensions: MapDimensions,
    landMap: boolean[][],
    elevationMap: number[][]
  ): TerrainType {
    if (!landMap[x] || !landMap[x][y]) {
      // Check if adjacent to land for coast
      const isCoast = this.isAdjacentToLand(x, y, dimensions, landMap);
      return isCoast ? 'coast' : 'ocean';
    }

    const elevation = elevationMap[x]?.[y] || 0;
    const latitude =
      Math.abs(y - dimensions.height / 2) / (dimensions.height / 2);
    const distanceFromCoast = this.getDistanceFromCoast(
      x,
      y,
      dimensions,
      landMap
    );

    // Mountain ranges based on elevation
    if (elevation > 0.7) {
      return 'mountains';
    }

    if (elevation > 0.4) {
      return 'hills';
    }

    // Climate-based terrain generation
    const temperature = this.getTemperature(latitude, elevation);
    const moisture = this.getMoisture(x, y, dimensions, distanceFromCoast);

    return this.getTerrainFromClimate(temperature, moisture);
  }

  private isAdjacentToLand(
    x: number,
    y: number,
    dimensions: MapDimensions,
    landMap: boolean[][]
  ): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx >= 0 &&
          nx < dimensions.width &&
          ny >= 0 &&
          ny < dimensions.height
        ) {
          if (landMap[nx]?.[ny]) return true;
        }
      }
    }
    return false;
  }

  private getDistanceFromCoast(
    x: number,
    y: number,
    _dimensions: MapDimensions,
    landMap: boolean[][]
  ): number {
    let minDistance = Infinity;

    // Sample every 4th tile for performance
    for (let ox = 0; ox < landMap.length; ox += 4) {
      for (let oy = 0; oy < landMap[0].length; oy += 4) {
        if (!landMap[ox]?.[oy]) {
          const distance = Math.sqrt(Math.pow(x - ox, 2) + Math.pow(y - oy, 2));
          minDistance = Math.min(minDistance, distance);
        }
      }
    }

    return Math.min(minDistance, 20) / 20; // Normalize to 0-1
  }

  private getTemperature(latitude: number, elevation: number): number {
    // Higher latitude = colder, higher elevation = colder
    return Math.max(
      0,
      1 - latitude * 1.2 - elevation * 0.3 + this.rng.nextFloat(-0.2, 0.2)
    );
  }

  private getMoisture(
    x: number,
    y: number,
    _dimensions: MapDimensions,
    distanceFromCoast: number
  ): number {
    // Closer to coast = more moisture, add some randomness
    const baseHumidity = Math.max(0, 1 - distanceFromCoast * 0.7);
    const noiseHumidity = this.noise2D(x * 0.1, y * 0.1) * 0.3;
    return Math.max(
      0,
      Math.min(1, baseHumidity + noiseHumidity + this.rng.nextFloat(-0.2, 0.2))
    );
  }

  private getTerrainFromClimate(
    temperature: number,
    moisture: number
  ): TerrainType {
    // Climate-based terrain assignment
    if (temperature < 0.3) {
      return moisture > 0.3 ? 'tundra' : 'tundra';
    }

    if (temperature > 0.8) {
      if (moisture < 0.2) return 'desert';
      if (moisture < 0.5) return 'plains';
      return 'grassland';
    }

    // Temperate zones
    if (moisture < 0.3) {
      return 'plains';
    } else if (moisture < 0.6) {
      return this.rng.next() > 0.5 ? 'grassland' : 'plains';
    } else {
      return this.rng.next() > 0.4 ? 'forest' : 'grassland';
    }
  }
}
