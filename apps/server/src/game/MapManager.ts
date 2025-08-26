import { logger } from '../utils/logger';
import { PlayerState } from './GameManager';
import { MapData, MapTile, TerrainType, TemperatureType, TerrainProperty } from './map/MapTypes';
import { FractalHeightGenerator } from './map/FractalHeightGenerator';
import { TemperatureMap } from './map/TemperatureMap';
import { TerrainSelectionEngine } from './map/TerrainSelectionEngine';
import { IslandGenerator, IslandGeneratorState, TerrainPercentages } from './map/IslandGenerator';
import { RiverGenerator } from './map/RiverGenerator';
import { ResourceGenerator } from './map/ResourceGenerator';
import { StartingPositionGenerator } from './map/StartingPositionGenerator';

// Re-export commonly used types for backward compatibility
export {
  MapData,
  MapTile,
  TerrainType,
  TemperatureType,
  TerrainProperty,
  ResourceType,
} from './map/MapTypes';

export class MapManager {
  private width: number;
  private height: number;
  private mapData: MapData | null = null;
  private seed: string;
  private generator: string;
  private random: () => number;

  // Sub-generators
  private heightGenerator: FractalHeightGenerator;
  private temperatureMap: TemperatureMap;
  private islandGenerator: IslandGenerator;
  private riverGenerator: RiverGenerator;
  private resourceGenerator: ResourceGenerator;
  private startingPositionGenerator: StartingPositionGenerator;

  // Default terrain percentages (from freeciv mapgen.c:1498-1512)
  private terrainPercentages: TerrainPercentages = {
    river: 15, // Base 15% river coverage
    mountain: 25, // 25% mountainous terrain
    desert: 20, // 20% arid terrain
    forest: 30, // 30% forested areas
    swamp: 10, // 10% wetlands
  };

  constructor(width: number, height: number, seed?: string, generator: string = 'random') {
    this.width = width;
    this.height = height;
    this.seed = seed || this.generateSeed();
    this.generator = generator;
    this.random = this.createSeededRandom(this.seed);

    // Initialize sub-generators with generator type
    this.heightGenerator = new FractalHeightGenerator(
      width,
      height,
      this.random,
      30,
      100,
      this.generator
    );
    this.temperatureMap = new TemperatureMap(width, height);
    this.islandGenerator = new IslandGenerator(width, height, this.random);
    this.riverGenerator = new RiverGenerator(width, height, this.random);
    this.resourceGenerator = new ResourceGenerator(width, height, this.random);
    this.startingPositionGenerator = new StartingPositionGenerator(width, height);
  }

  /**
   * Generate map using traditional fractal method
   */
  public async generateMap(players: Map<string, PlayerState>): Promise<void> {
    logger.info('Generating map', { width: this.width, height: this.height, seed: this.seed });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Generate height map
    this.heightGenerator.generateHeightMap();
    const heightMap = this.heightGenerator.getHeightMap();

    // Apply height data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }

    // Generate temperature map
    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }

    // Generate terrain using terrain engine
    await this.generateTerrain(tiles);

    // Generate continents
    await this.generateContinents(tiles);

    // Generate climate data and wetness
    this.generateClimateData(tiles, this.random);
    this.generateWetnessMap(tiles, this.random);

    // Generate rivers
    await this.riverGenerator.generateAdvancedRivers(tiles);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const generationTime = Date.now() - startTime;
    logger.info('Map generation completed', {
      width: this.width,
      height: this.height,
      generationTime,
    });
  }

  /**
   * Generate map using island-based algorithm
   */
  public async generateMapWithIslands(
    players: Map<string, PlayerState>,
    generatorType: 2 | 3 | 4 = 4
  ): Promise<void> {
    logger.info('Generating map with island system', {
      width: this.width,
      height: this.height,
      seed: this.seed,
    });

    const startTime = Date.now();

    // Initialize map structure
    const tiles: MapTile[][] = [];
    for (let x = 0; x < this.width; x++) {
      tiles[x] = [];
      for (let y = 0; y < this.height; y++) {
        tiles[x][y] = this.createBaseTile(x, y);
      }
    }

    // Initialize climate and height data first
    this.generateClimateData(tiles, this.random);
    this.generateWetnessMap(tiles, this.random);

    // Initialize world for island generation
    const state = this.islandGenerator.initializeWorldForIslands(tiles);

    // Initialize bucket system
    await this.islandGenerator.makeIsland(0, 0, state, tiles, this.terrainPercentages);

    logger.info(`Using map generator ${generatorType} for ${players.size} players`);

    // Generate islands using specified generator algorithm
    switch (generatorType) {
      case 2:
        await this.mapGenerator2(state, tiles, players.size);
        break;
      case 3:
        await this.mapGenerator3(state, tiles, players.size);
        break;
      case 4:
      default:
        await this.mapGenerator4(state, tiles, players.size);
        break;
    }

    // Cleanup
    this.islandGenerator.cleanup();

    // Apply final terrain improvements
    this.applyBiomeTransitions(tiles, this.random);

    // Generate resources
    await this.resourceGenerator.generateResources(tiles);

    // Find suitable starting positions
    const startingPositions = await this.startingPositionGenerator.generateStartingPositions(
      tiles,
      players
    );

    this.mapData = {
      width: this.width,
      height: this.height,
      tiles,
      startingPositions,
      seed: this.seed,
      generatedAt: new Date(),
    };

    const endTime = Date.now();
    logger.info(`Island-based map generation completed in ${endTime - startTime}ms`);
  }

  private createBaseTile(x: number, y: number): MapTile {
    return {
      x,
      y,
      terrain: 'ocean',
      elevation: 0,
      riverMask: 0,
      continentId: 0,
      isExplored: false,
      isVisible: false,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      unitIds: [],
      properties: {},
      temperature: TemperatureType.TEMPERATE,
      wetness: 50,
    };
  }

  private async generateTerrain(tiles: MapTile[][]): Promise<void> {
    // Phase 4: Generate sophisticated height map using fractal algorithms (following freeciv reference)
    logger.info('Generating fractal height map with diamond-square and fracture algorithms');

    // Generate sophisticated height map
    this.heightGenerator.generateHeightMap();

    // Apply smoothing passes for natural terrain transitions
    this.heightGenerator.applySmoothingPasses(2);

    // Get generated height map and apply to tiles
    const generatedHeights = this.heightGenerator.getHeightMap();
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].elevation = generatedHeights[y * this.width + x];
      }
    }

    const shoreLevel = this.heightGenerator.getShoreLevel();
    const mountainLevel = this.heightGenerator.getMountainLevel();

    logger.info('Fractal height generation completed', {
      shoreLevel,
      mountainLevel,
    });

    // Create terrain engine with proper freeciv reference levels
    const terrainEngine = new TerrainSelectionEngine(this.random, shoreLevel, mountainLevel);

    // Phase 2: Assign terrain using property-based selection (following freeciv reference)
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const selectedTerrain = terrainEngine.pickTerrain(
          tile.temperature,
          tile.wetness,
          tile.elevation
        );

        tile.terrain = selectedTerrain;

        // Set terrain properties based on selected terrain
        this.setTerrainProperties(tile);
      }
    }

    // Phase 3: Apply biome transition logic for more natural borders
    this.applyBiomeTransitions(tiles, this.random);
  }

  private setTerrainProperties(tile: MapTile): void {
    // Set terrain properties based on terrain type
    const terrainPropertyMap: Record<TerrainType, Partial<Record<TerrainProperty, number>>> = {
      // Water terrains
      ocean: { [TerrainProperty.OCEAN_DEPTH]: 0 },
      coast: { [TerrainProperty.OCEAN_DEPTH]: 32 },
      deep_ocean: { [TerrainProperty.OCEAN_DEPTH]: 87 },
      lake: { [TerrainProperty.WET]: 100 },

      // Land terrains
      desert: {
        [TerrainProperty.DRY]: 100,
        [TerrainProperty.TROPICAL]: 50,
        [TerrainProperty.TEMPERATE]: 20,
      },
      plains: {
        [TerrainProperty.COLD]: 20,
        [TerrainProperty.WET]: 20,
        [TerrainProperty.FOLIAGE]: 50,
        [TerrainProperty.TEMPERATE]: 50,
      },
      grassland: { [TerrainProperty.GREEN]: 50, [TerrainProperty.TEMPERATE]: 50 },
      forest: { [TerrainProperty.GREEN]: 50, [TerrainProperty.MOUNTAINOUS]: 30 },
      jungle: {
        [TerrainProperty.FOLIAGE]: 50,
        [TerrainProperty.TROPICAL]: 50,
        [TerrainProperty.WET]: 50,
      },
      hills: { [TerrainProperty.MOUNTAINOUS]: 70 },
      mountains: { [TerrainProperty.GREEN]: 50, [TerrainProperty.TEMPERATE]: 50 },
      swamp: {
        [TerrainProperty.WET]: 100,
        [TerrainProperty.TROPICAL]: 10,
        [TerrainProperty.TEMPERATE]: 10,
        [TerrainProperty.COLD]: 10,
      },
      tundra: { [TerrainProperty.COLD]: 50 },
      snow: { [TerrainProperty.FROZEN]: 100 },
      glacier: { [TerrainProperty.FROZEN]: 100 },
    };

    const properties = terrainPropertyMap[tile.terrain] || {};
    tile.properties = properties;
  }

  private async generateContinents(tiles: MapTile[][]): Promise<void> {
    let continentId = 1;
    const visited = new Set<string>();

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const key = `${x},${y}`;
        if (visited.has(key) || !this.isLandTile(tiles[x][y].terrain)) {
          continue;
        }

        // Flood fill to mark continent
        this.floodFillContinent(tiles, x, y, continentId, visited);
        continentId++;
      }
    }
  }

  private floodFillContinent(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    continentId: number,
    visited: Set<string>
  ): void {
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      if (visited.has(key) || x < 0 || x >= this.width || y < 0 || y >= this.height) {
        continue;
      }

      if (!this.isLandTile(tiles[x][y].terrain)) {
        continue;
      }

      visited.add(key);
      tiles[x][y].continentId = continentId;

      // Add neighbors to stack
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private generateClimateData(tiles: MapTile[][], random: () => number): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Simple latitude-based temperature
        const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);

        if (latitudeFactor > 0.8) {
          tile.temperature = TemperatureType.FROZEN;
        } else if (latitudeFactor > 0.6) {
          tile.temperature = TemperatureType.COLD;
        } else if (latitudeFactor < 0.3) {
          tile.temperature = TemperatureType.TROPICAL;
        } else {
          tile.temperature = TemperatureType.TEMPERATE;
        }

        // Add some randomness
        if (random() < 0.1) {
          const temps = [
            TemperatureType.FROZEN,
            TemperatureType.COLD,
            TemperatureType.TEMPERATE,
            TemperatureType.TROPICAL,
          ];
          tile.temperature = temps[Math.floor(random() * temps.length)];
        }
      }
    }
  }

  private generateWetnessMap(tiles: MapTile[][], random: () => number): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // Base wetness on proximity to water
        let wetness = 30; // Base dryness

        // Check nearby for water
        wetness += this.calculateWetnessFromNearbyWater(tiles, x, y);

        // Add randomness
        wetness += (random() - 0.5) * 30;

        tiles[x][y].wetness = Math.max(0, Math.min(100, wetness));
      }
    }
  }

  private applyBiomeTransitions(tiles: MapTile[][], random: () => number): void {
    // Simple biome transition smoothing
    const newTerrain = tiles.map(col => col.map(tile => ({ ...tile })));

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!this.isLandTile(tile.terrain)) continue;

        // Check neighbors for terrain consistency
        const neighbors = this.getNeighbors(tiles, x, y);
        const landNeighbors = neighbors.filter(n => this.isLandTile(n.terrain));

        if (landNeighbors.length > 0 && random() < 0.1) {
          // 10% chance to blend with neighbors
          const randomNeighbor = landNeighbors[Math.floor(random() * landNeighbors.length)];
          if (this.isClimateCompatible(tile, randomNeighbor)) {
            newTerrain[x][y].terrain = randomNeighbor.terrain;
          }
        }
      }
    }

    // Apply changes
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].terrain = newTerrain[x][y].terrain;
      }
    }
  }

  private isClimateCompatible(tile1: MapTile, tile2: MapTile): boolean {
    return tile1.temperature === tile2.temperature || Math.abs(tile1.wetness - tile2.wetness) < 30;
  }

  private calculateWetnessFromNearbyWater(tiles: MapTile[][], x: number, y: number): number {
    let wetnessBonus = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (!this.isLandTile(terrain)) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            wetnessBonus += 20 / (1 + distance);
          }
        }
      }
    }
    return wetnessBonus;
  }

  private getNeighbors(tiles: MapTile[][], x: number, y: number): MapTile[] {
    const neighbors: MapTile[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          neighbors.push(tiles[nx][ny]);
        }
      }
    }
    return neighbors;
  }

  // Placeholder generator methods (simplified versions)
  private async mapGenerator2(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Simple generator - create one large continent
    const islandMass = Math.floor(state.totalMass * 0.8);
    await this.islandGenerator.makeIsland(
      islandMass,
      playerCount,
      state,
      tiles,
      this.terrainPercentages
    );
  }

  private async mapGenerator3(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Medium complexity - create a few large islands
    const islandCount = Math.min(4, Math.max(2, Math.floor(playerCount / 2)));
    const islandMass = Math.floor(state.totalMass / islandCount);

    for (let i = 0; i < islandCount; i++) {
      await this.islandGenerator.makeIsland(
        islandMass,
        Math.ceil(playerCount / islandCount),
        state,
        tiles,
        this.terrainPercentages
      );
    }
  }

  private async mapGenerator4(
    state: IslandGeneratorState,
    tiles: MapTile[][],
    playerCount: number
  ): Promise<void> {
    // Complex generator - many varied islands
    const largeIslands = Math.floor(playerCount / 2);
    const smallIslands = playerCount;

    // Create large islands
    const largeIslandMass = Math.floor((state.totalMass * 0.6) / largeIslands);
    for (let i = 0; i < largeIslands; i++) {
      await this.islandGenerator.makeIsland(
        largeIslandMass,
        2,
        state,
        tiles,
        this.terrainPercentages
      );
    }

    // Create small islands
    const smallIslandMass = Math.floor((state.totalMass * 0.4) / smallIslands);
    for (let i = 0; i < smallIslands; i++) {
      await this.islandGenerator.makeIsland(
        smallIslandMass,
        1,
        state,
        tiles,
        this.terrainPercentages
      );
    }
  }

  private isLandTile(terrain: TerrainType): boolean {
    return !['ocean', 'coast', 'deep_ocean', 'lake'].includes(terrain);
  }

  private generateSeed(): string {
    // Use timestamp + random values + performance counter for better uniqueness
    const timestamp = Date.now().toString(36);
    const random1 = Math.random().toString(36).substring(2, 15);
    const random2 = Math.random().toString(36).substring(2, 15);
    const performanceNow = (typeof performance !== 'undefined' ? performance.now() : 0).toString(
      36
    );

    return `${timestamp}-${random1}-${random2}-${performanceNow}`.replace(/\./g, '');
  }

  private createSeededRandom(seed: string): () => number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const char = seed.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Linear congruential generator
    return () => {
      hash = (hash * 1664525 + 1013904223) & 0x7fffffff;
      return hash / 0x80000000;
    };
  }

  // Public API methods
  public getMapData(): MapData | null {
    return this.mapData;
  }

  public getTile(x: number, y: number): MapTile | null {
    if (!this.mapData || x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return null;
    }
    return this.mapData.tiles[x][y];
  }

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

  public updateTileVisibility(_playerId: string, x: number, y: number, radius: number): void {
    if (!this.mapData) return;

    const visibleTiles = this.getVisibleTiles(x, y, radius);
    for (const tile of visibleTiles) {
      tile.isVisible = true;
      tile.isExplored = true;
    }
  }
}
