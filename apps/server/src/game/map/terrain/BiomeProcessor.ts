/**
 * Biome and wetness processing algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c biome and wetness processing
 * Handles biome-based terrain grouping, natural transitions, and wetness calculations
 */
import { MapTile, TemperatureType, TerrainType } from '../MapTypes';
import { isOceanTerrain, isLandTile, setTerrainGameProperties } from '../TerrainUtils';

/**
 * Handles biome identification, wetness calculation, and biome-based terrain transitions
 * Extracted from TerrainGenerator for better separation of concerns
 * @reference freeciv/server/generator/mapgen.c biome and wetness logic
 */
export class BiomeProcessor {
  private width: number;
  private height: number;
  private random: () => number;

  constructor(width: number, height: number, random: () => number) {
    this.width = width;
    this.height = height;
    this.random = random;
  }

  /**
   * Generate wetness map for terrain variation
   */
  public generateWetnessMap(tiles: MapTile[][]): void {
    // Use default wetness base for better terrain variety
    const baseWetness = 50;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // Start with user's wetness setting
        let wetness = baseWetness;

        // Add wetness from nearby water sources
        wetness += this.calculateWetnessFromNearbyWater(tiles, x, y) * 0.3;

        // Store final wetness value
        tiles[x][y].wetness = Math.max(0, Math.min(100, Math.round(wetness)));
      }
    }
  }

  /**
   * Apply biome-based terrain transitions and grouping
   * @reference Task 10: Biome-based terrain grouping and natural transitions
   */
  public applyBiomeTransitions(tiles: MapTile[][]): void {
    const generatorAdjustments = { clusteringStrength: 0.8, transitionSmoothness: 0.6 };
    const newTerrain = tiles.map(col => col.map(tile => ({ ...tile })));

    // Phase 1: Biome-based terrain grouping
    this.applyBiomeBasedGrouping(tiles, newTerrain, generatorAdjustments);

    // Phase 2: Natural terrain transitions
    this.applyNaturalTerrainTransitions(tiles, newTerrain, generatorAdjustments);

    // Phase 3: Regional climate consistency
    this.enforceRegionalClimateConsistency(tiles, newTerrain, generatorAdjustments);

    // Apply terrain changes
    this.applyTerrainChanges(tiles, newTerrain);

    // Apply smoothing for better visual transitions
    this.applyBiomeTransitionSmoothing(tiles);
  }

  /**
   * Apply biome-based terrain grouping
   * @reference Task 10: Biome-based terrain grouping
   */
  private applyBiomeBasedGrouping(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    generatorAdjustments: any
  ): void {
    const clusteringStrength = generatorAdjustments?.clusteringStrength || 0.8;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (isOceanTerrain(tile.terrain)) continue;

        // Identify biome type for this tile
        const biomeType = this.identifyBiomeType(tile);

        // Find similar biome neighbors
        const similarBiomeNeighbors = this.findSimilarBiomeNeighbors(tiles, x, y, biomeType);

        if (similarBiomeNeighbors.length >= 3 && this.random() < 0.15 * clusteringStrength) {
          // Apply biome-based terrain grouping
          const dominantTerrain = this.findDominantTerrainInBiome(similarBiomeNeighbors, biomeType);
          if (dominantTerrain && this.isBiomeCompatible(tile.terrain, dominantTerrain, biomeType)) {
            newTerrain[x][y].terrain = dominantTerrain as TerrainType;
          }
        }
      }
    }
  }

  /**
   * Apply natural terrain transitions based on environmental gradients
   * @reference Task 10: Natural terrain transitions
   */
  private applyNaturalTerrainTransitions(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    generatorAdjustments: any
  ): void {
    const transitionSmoothness = generatorAdjustments?.transitionSmoothness || 0.6;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (isOceanTerrain(tile.terrain)) continue;

        // Calculate environmental gradients
        const elevationGradient = this.calculateElevationGradient(tiles, x, y);
        const temperatureGradient = this.calculateTemperatureGradient(tiles, x, y);
        const wetnessGradient = this.calculateWetnessGradient(tiles, x, y);

        // Apply elevation-based transitions
        if (elevationGradient > 100 && this.random() < 0.2 * transitionSmoothness) {
          const transitionTerrain = this.getElevationTransitionTerrain(tile, elevationGradient);
          if (transitionTerrain) {
            newTerrain[x][y].terrain = transitionTerrain as TerrainType;
          }
        }

        // Apply climate-based transitions
        if (
          (temperatureGradient > 200 || wetnessGradient > 15) &&
          this.random() < 0.25 * transitionSmoothness
        ) {
          const transitionTerrain = this.getClimateTransitionTerrain(
            tile,
            temperatureGradient,
            wetnessGradient
          );
          if (transitionTerrain) {
            newTerrain[x][y].terrain = transitionTerrain as TerrainType;
          }
        }
      }
    }
  }

  /**
   * Enforce regional climate consistency
   * @reference Task 10: Regional climate consistency
   */
  private enforceRegionalClimateConsistency(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    _generatorAdjustments: any
  ): void {
    const regionSize = 3;
    for (let x = regionSize; x < this.width - regionSize; x += regionSize) {
      for (let y = regionSize; y < this.height - regionSize; y += regionSize) {
        if (this.random() < 0.3) {
          this.enforceRegionalConsistency(tiles, newTerrain, x, y, regionSize);
        }
      }
    }
  }

  /**
   * Identify biome type based on temperature and wetness
   */
  private identifyBiomeType(tile: MapTile): string {
    const temp = tile.temperature as TemperatureType;
    const wetness = tile.wetness || 50;

    if (temp & TemperatureType.TROPICAL) {
      return wetness > 60 ? 'tropical_wet' : 'tropical_dry';
    } else if (temp & TemperatureType.TEMPERATE) {
      return wetness > 50 ? 'temperate_wet' : 'temperate_dry';
    } else if (temp & TemperatureType.COLD) {
      return wetness > 40 ? 'cold_wet' : 'cold_dry';
    } else if (temp & TemperatureType.FROZEN) {
      return 'arctic';
    }

    return 'temperate_dry'; // default
  }

  /**
   * Find neighbors with similar biome type
   */
  private findSimilarBiomeNeighbors(
    tiles: MapTile[][],
    x: number,
    y: number,
    biomeType: string
  ): MapTile[] {
    const neighbors = this.getNeighbors(tiles, x, y);
    return neighbors.filter((neighbor: MapTile) => {
      return isLandTile(neighbor.terrain) && this.identifyBiomeType(neighbor) === biomeType;
    });
  }

  /**
   * Find dominant terrain type in a biome
   */
  private findDominantTerrainInBiome(neighbors: MapTile[], biomeType: string): string | null {
    const terrainCounts: Record<string, number> = {};

    neighbors.forEach(neighbor => {
      if (this.isValidTerrainForBiome(neighbor.terrain, biomeType)) {
        terrainCounts[neighbor.terrain] = (terrainCounts[neighbor.terrain] || 0) + 1;
      }
    });

    let dominantTerrain: string | null = null;
    let maxCount = 0;

    Object.entries(terrainCounts).forEach(([terrain, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantTerrain = terrain;
      }
    });

    return maxCount >= 2 ? dominantTerrain : null; // Require at least 2 neighbors
  }

  /**
   * Check if terrain type is valid for a biome
   */
  private isValidTerrainForBiome(terrain: string, biomeType: string): boolean {
    const biomeTerrains: Record<string, string[]> = {
      tropical_wet: ['jungle', 'forest', 'swamp', 'grassland'],
      tropical_dry: ['desert', 'plains', 'grassland'],
      temperate_wet: ['forest', 'grassland', 'plains', 'swamp'],
      temperate_dry: ['plains', 'grassland', 'desert'],
      cold_wet: ['forest', 'tundra', 'swamp'],
      cold_dry: ['tundra', 'plains'],
      arctic: ['tundra', 'glacier'],
    };

    return biomeTerrains[biomeType]?.includes(terrain) || false;
  }

  /**
   * Check if two terrain types are compatible within a biome
   */
  private isBiomeCompatible(terrain1: string, terrain2: string, biomeType: string): boolean {
    return (
      this.isValidTerrainForBiome(terrain1, biomeType) &&
      this.isValidTerrainForBiome(terrain2, biomeType)
    );
  }

  /**
   * Calculate elevation gradient
   */
  private calculateElevationGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerElevation = tiles[x][y].elevation || 0;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && (dx !== 0 || dy !== 0)) {
          const neighborElevation = tiles[nx][ny].elevation || 0;
          totalDifference += Math.abs(centerElevation - neighborElevation);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Calculate temperature gradient
   */
  private calculateTemperatureGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerTemp = tiles[x][y].temperature as number;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && (dx !== 0 || dy !== 0)) {
          const neighborTemp = tiles[nx][ny].temperature as number;
          totalDifference += Math.abs(centerTemp - neighborTemp);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Calculate wetness gradient
   */
  private calculateWetnessGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerWetness = tiles[x][y].wetness || 0;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && (dx !== 0 || dy !== 0)) {
          const neighborWetness = tiles[nx][ny].wetness || 0;
          totalDifference += Math.abs(centerWetness - neighborWetness);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Get elevation-based transition terrain
   */
  private getElevationTransitionTerrain(tile: MapTile, gradient: number): string | null {
    const currentTerrain = tile.terrain;

    if (currentTerrain === 'mountains' && gradient > 150) {
      return 'hills';
    } else if (currentTerrain === 'hills' && gradient > 120) {
      // Transition hills to appropriate lower terrain
      return tile.temperature & TemperatureType.FROZEN ? 'tundra' : 'grassland';
    }

    return null;
  }

  /**
   * Get climate-based transition terrain
   */
  private getClimateTransitionTerrain(tile: MapTile, temp: number, wetness: number): string | null {
    const currentTerrain = tile.terrain;

    // Wetness-based transitions
    if (wetness > 10) {
      if (currentTerrain === 'desert' && tile.wetness > 40) {
        return 'grassland';
      } else if (currentTerrain === 'forest' && tile.wetness < 30) {
        return 'grassland';
      } else if (currentTerrain === 'jungle' && tile.wetness < 50) {
        return 'forest';
      }
    }

    // Temperature-based transitions
    if (temp > 500) {
      if (
        tile.temperature & TemperatureType.FROZEN &&
        ['grassland', 'plains'].includes(currentTerrain)
      ) {
        return 'tundra';
      } else if (temp > 700 && currentTerrain === 'forest') {
        return 'jungle';
      }
    }

    return null;
  }

  /**
   * Enforce regional consistency for terrain
   */
  private enforceRegionalConsistency(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    centerX: number,
    centerY: number,
    regionSize: number
  ): void {
    // Calculate regional averages
    let avgTemp = 0;
    let avgElevation = 0;
    let avgWetness = 0;
    let count = 0;

    for (let dx = -regionSize; dx <= regionSize; dx++) {
      for (let dy = -regionSize; dy <= regionSize; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          avgTemp += tiles[x][y].temperature as number;
          avgElevation += tiles[x][y].elevation || 0;
          avgWetness += tiles[x][y].wetness || 0;
          count++;
        }
      }
    }

    avgTemp /= count;
    avgElevation /= count;
    avgWetness /= count;
    const dominantBiome = this.identifyBiomeType({
      temperature: avgTemp as TemperatureType,
      elevation: avgElevation,
      wetness: avgWetness,
    } as MapTile);

    // Apply regional consistency
    for (let dx = -regionSize; dx <= regionSize; dx++) {
      for (let dy = -regionSize; dy <= regionSize; dy++) {
        this.applyRegionalConsistencyToTile(
          tiles,
          newTerrain,
          centerX + dx,
          centerY + dy,
          dominantBiome
        );
      }
    }
  }

  /**
   * Apply regional consistency to a single tile
   * @param tiles Original tile array
   * @param newTerrain New terrain array
   * @param x X coordinate
   * @param y Y coordinate
   * @param dominantBiome The dominant biome for the region
   */
  private applyRegionalConsistencyToTile(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    x: number,
    y: number,
    dominantBiome: string
  ): void {
    if (!this.isValidCoordinate(x, y)) return;

    const tile = tiles[x][y];
    if (this.isValidTerrainForBiome(tile.terrain, dominantBiome) || this.random() >= 0.3) {
      return;
    }

    const suitableTerrains = this.getValidTerrainsForBiome(dominantBiome);
    if (suitableTerrains.length > 0) {
      newTerrain[x][y].terrain = suitableTerrains[
        Math.floor(this.random() * suitableTerrains.length)
      ] as TerrainType;
    }
  }

  /**
   * Check if coordinates are within map bounds
   * @param x X coordinate
   * @param y Y coordinate
   * @returns true if coordinates are valid
   */
  private isValidCoordinate(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /**
   * Apply smoothing logic to a single tile
   * @param tiles Original tile array
   * @param newTerrain New terrain array to modify
   * @param x X coordinate
   * @param y Y coordinate
   * @returns Number of changes applied (0 or 1)
   */
  private applySingleTileSmoothing(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    x: number,
    y: number
  ): number {
    const tile = tiles[x][y];
    const closeNeighbors = this.getNeighborTerrain(tiles, x, y, 1);
    const neighbors = this.getNeighborTerrain(tiles, x, y, 2);

    // Smooth isolated desert tiles
    if (tile.terrain === 'desert') {
      return this.smoothDesertTile(newTerrain, x, y, closeNeighbors, neighbors);
    }

    // Smooth forest transitions
    if (tile.terrain === 'forest') {
      return this.smoothForestTile(newTerrain, x, y, closeNeighbors);
    }

    // Create forest buffers
    if (['grassland', 'plains'].includes(tile.terrain)) {
      return this.createForestBuffer(newTerrain, x, y, neighbors);
    }

    return 0;
  }

  /**
   * Smooth isolated desert tiles
   */
  private smoothDesertTile(
    newTerrain: MapTile[][],
    x: number,
    y: number,
    closeNeighbors: string[],
    neighbors: string[]
  ): number {
    const desertNeighbors = closeNeighbors.filter(t => t === 'desert').length;
    const forestNeighbors = neighbors.filter(t => t === 'forest').length;

    if (desertNeighbors === 0 && forestNeighbors >= 4) {
      newTerrain[x][y].terrain = 'plains';
      setTerrainGameProperties(newTerrain[x][y]);
      return 1;
    }
    return 0;
  }

  /**
   * Smooth forest transitions
   */
  private smoothForestTile(
    newTerrain: MapTile[][],
    x: number,
    y: number,
    closeNeighbors: string[]
  ): number {
    const forestNeighbors = closeNeighbors.filter(t => t === 'forest').length;
    if (forestNeighbors <= 1) {
      newTerrain[x][y].terrain = 'plains';
      setTerrainGameProperties(newTerrain[x][y]);
      return 1;
    }
    return 0;
  }

  /**
   * Create forest buffers around forest areas
   */
  private createForestBuffer(
    newTerrain: MapTile[][],
    x: number,
    y: number,
    neighbors: string[]
  ): number {
    const forestNeighbors = neighbors.filter(t => t === 'forest').length;
    if (forestNeighbors >= 5 && this.random() < 0.4) {
      newTerrain[x][y].terrain = 'forest';
      setTerrainGameProperties(newTerrain[x][y]);
      return 1;
    }
    return 0;
  }

  /**
   * Get valid terrain types for a biome
   */
  private getValidTerrainsForBiome(biomeType: string): string[] {
    const biomeTerrains: Record<string, string[]> = {
      tropical_wet: ['jungle', 'forest', 'swamp', 'grassland'],
      tropical_dry: ['desert', 'plains', 'grassland'],
      temperate_wet: ['forest', 'grassland', 'plains', 'swamp'],
      temperate_dry: ['plains', 'grassland', 'desert'],
      cold_wet: ['forest', 'tundra', 'swamp'],
      cold_dry: ['tundra', 'plains'],
      arctic: ['tundra', 'glacier'],
    };

    return biomeTerrains[biomeType] || ['grassland'];
  }

  /**
   * Apply terrain changes from new terrain array to original
   */
  private applyTerrainChanges(tiles: MapTile[][], newTerrain: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].terrain !== newTerrain[x][y].terrain) {
          tiles[x][y].terrain = newTerrain[x][y].terrain;
          setTerrainGameProperties(tiles[x][y]);
        }
      }
    }

    // Apply final smoothing pass
    this.applyBiomeTransitionSmoothing(tiles);
  }

  /**
   * Apply biome transition smoothing for better visual transitions
   */
  private applyBiomeTransitionSmoothing(tiles: MapTile[][]): number {
    let changesApplied = 0;
    const maxPasses = 2;

    for (let pass = 0; pass < maxPasses; pass++) {
      const newTerrain = tiles.map(row => [...row]);

      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const tile = tiles[x][y];
          if (isOceanTerrain(tile.terrain)) continue;

          const smoothingResult = this.applySingleTileSmoothing(tiles, newTerrain, x, y);
          changesApplied += smoothingResult;
        }
      }

      // Apply changes for this pass
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          if (tiles[x][y].terrain !== newTerrain[x][y].terrain) {
            tiles[x][y].terrain = newTerrain[x][y].terrain;
          }
        }
      }
    }

    return changesApplied;
  }

  /**
   * Get neighbor terrain types within specified radius
   */
  private getNeighborTerrain(
    tiles: MapTile[][],
    centerX: number,
    centerY: number,
    radius: number
  ): string[] {
    const neighbors: string[] = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;

        const x = centerX + dx;
        const y = centerY + dy;

        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          neighbors.push(tiles[x][y].terrain);
        }
      }
    }

    return neighbors;
  }

  /**
   * Calculate wetness contribution from nearby water sources
   */
  private calculateWetnessFromNearbyWater(tiles: MapTile[][], x: number, y: number): number {
    let wetnessBonus = 0;
    const searchRadius = 3;

    for (let dx = -searchRadius; dx <= searchRadius; dx++) {
      for (let dy = -searchRadius; dy <= searchRadius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const tile = tiles[nx][ny];
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (isOceanTerrain(tile.terrain)) {
            // Ocean tiles contribute wetness based on distance
            const contribution = Math.max(0, 30 - distance * 8);
            wetnessBonus += contribution;
          } else if (tile.riverMask > 0) {
            // River tiles also contribute wetness
            const contribution = Math.max(0, 15 - distance * 4);
            wetnessBonus += contribution;
          }
        }
      }
    }

    return Math.min(wetnessBonus, 40); // Cap at 40 bonus wetness
  }

  /**
   * Get neighbor tiles
   */
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
}
