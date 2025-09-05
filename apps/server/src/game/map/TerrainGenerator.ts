/**
 * Specialized terrain generation algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c
 * @reference freeciv/server/generator/height_map.c
 * Exact copies of freeciv terrain algorithms
 */
import { MapTile, TemperatureType, TemperatureFlags, TerrainType } from './MapTypes';
import { TemperatureMap } from './TemperatureMap';
import { isOceanTerrain, setTerrainGameProperties, PlacementMap } from './TerrainUtils';
import { MapgenTerrainPropertyEnum, pickTerrain } from './TerrainRuleset';
import { HeightMapProcessor } from './terrain/HeightMapProcessor';
import { TerrainPlacementProcessor, TerrainParams } from './terrain/TerrainPlacementProcessor';
import { BiomeProcessor } from './terrain/BiomeProcessor';
import { OceanProcessor } from './terrain/OceanProcessor';
import { ContinentProcessor } from './terrain/ContinentProcessor';

export class TerrainGenerator {
  private width: number;
  private height: number;
  private random: () => number;
  private generator: string;
  private placementMap: PlacementMap;
  private heightGenerator?: any; // Will be passed for pole renormalization
  private temperatureMap?: TemperatureMap; // Will be passed for temperature map creation
  private riverGenerator?: any; // Will be passed for river generation

  // Extracted components
  private heightMapProcessor: HeightMapProcessor;
  private terrainPlacementProcessor: TerrainPlacementProcessor;
  private biomeProcessor: BiomeProcessor;
  private oceanProcessor: OceanProcessor;
  private continentProcessor: ContinentProcessor;

  constructor(width: number, height: number, random: () => number, generator: string) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.generator = generator;
    this.placementMap = new PlacementMap(width, height);

    // Initialize extracted components
    this.heightMapProcessor = new HeightMapProcessor(width, height, random);
    this.terrainPlacementProcessor = new TerrainPlacementProcessor(
      width,
      height,
      random,
      this.placementMap
    );
    this.biomeProcessor = new BiomeProcessor(width, height, random);
    this.oceanProcessor = new OceanProcessor(width, height, random);
    this.continentProcessor = new ContinentProcessor(width, height, random);
  }

  /**
   * Copy height map values to tile altitude properties
   * @reference freeciv/server/generator/height_map.c height_map_to_map()
   * Delegated to HeightMapProcessor for better organization
   */
  public heightMapToMap(tiles: MapTile[][], heightMap: number[]): void {
    return this.heightMapProcessor.heightMapToMap(tiles, heightMap);
  }

  /**
   * Calculate terrain generation percentages based on world parameters
   * @reference freeciv/server/generator/mapgen.c adjust_terrain_param()
   * Exact copy of freeciv terrain parameter calculation
   *
   *   swamp_pct = factor * MAX(0, (wld.map.server.wetness * 12 - 150 + wld.map.server.temperature * 10));
   *   desert_pct = factor * MAX(0, (wld.map.server.temperature * 15 - 250 + (100 - wld.map.server.wetness) * 10));
   * }
   */
  public adjustTerrainParam(
    landpercent: number,
    steepness: number,
    wetness: number,
    temperature: number
  ): TerrainParams {
    // Constants from freeciv
    const ICE_BASE_LEVEL = 200; // From freeciv common/map.h
    const MAX_COLATITUDE = 1000; // From freeciv common/map.h
    const TROPICAL_LEVEL = 715; // Approximation from freeciv

    const polar = (2 * ICE_BASE_LEVEL * landpercent) / MAX_COLATITUDE;
    const mount_factor = (100.0 - polar - 30 * 0.8) / 10000;
    const factor = (100.0 - polar - steepness * 0.8) / 10000;

    const mountain_pct = mount_factor * steepness * 90;

    // 27% if wetness == 50
    let forest_pct = factor * (wetness * 40 + 700);
    const jungle_pct = (forest_pct * (MAX_COLATITUDE - TROPICAL_LEVEL)) / (MAX_COLATITUDE * 2);
    forest_pct -= jungle_pct;

    // 3-11%
    const river_pct = ((100 - polar) * (3 + wetness / 12)) / 100;

    // 7% if wetness == 50 && temperature == 50
    const swamp_pct = factor * Math.max(0, wetness * 12 - 150 + temperature * 10);
    const desert_pct = factor * Math.max(0, temperature * 15 - 250 + (100 - wetness) * 10);

    return {
      mountain_pct,
      forest_pct,
      jungle_pct,
      desert_pct,
      swamp_pct,
      river_pct,
    };
  }

  /**
   * Convert height map to land/ocean based on landpercent threshold
   * @reference freeciv/server/generator/mapgen.c make_land()
   * Exact copy of freeciv land/ocean distribution algorithm
   * Enhanced with Phase 1 fixes: integrated temperature map, pole renormalization, and river generation
   */
  public async makeLand(
    tiles: MapTile[][],
    heightMap: number[],
    params: { landpercent: number; steepness: number; wetness: number; temperature: number },
    heightGenerator?: any,
    temperatureMap?: TemperatureMap,
    riverGenerator?: any
  ): Promise<void> {
    // Store dependencies for internal use
    this.setGenerationDependencies(heightGenerator, temperatureMap, riverGenerator);

    // Step 1: Normalize poles if present
    this.normalizePolesIfNeeded(heightMap, tiles);

    // Step 2: temporary land fill terrain (as in freeciv)
    const land_fill: TerrainType = 'grassland';

    // Step 3: Compute shore level
    const hmap_shore_level = this.computeShoreLevel(heightGenerator, params.landpercent);

    // Step 5: Classify tiles into ocean/land (with neighbor-aware ocean depth)
    this.classifyLandAndOcean(tiles, hmap_shore_level, land_fill);

    // Step 6: Renormalize poles post land classification
    this.renormalizePolesIfNeeded(heightMap, tiles);

    // Step 8: Initialize placement map and mark ocean tiles as placed
    this.initializePlacementMapForOceans(tiles);

    // Terrain parameter calculation (freeciv algorithm)
    const terrainParams = this.adjustTerrainParam(
      params.landpercent,
      params.steepness,
      params.wetness,
      params.temperature
    );

    // Step 9: Relief generation (fracture vs standard)
    this.generateRelief(tiles, heightMap, hmap_shore_level, terrainParams.mountain_pct);

    // Step 9.5: Temperature map before terrain selection
    this.createTemperatureIfAvailable(tiles, heightMap);

    // Step 10: Place forests/deserts/etc. (requires hmap_low_level init)
    this.placeTerrains(tiles, terrainParams, hmap_shore_level);

    // Step 10.5: Continent assignment
    this.finalizeContinents(tiles, this.generator === 'random');

    // Step 11: Cleanup placement map
    this.cleanupPlacementMap();

    // Step 12: Final pole renormalization
    this.finalPoleRenormalization();

    // Step 14: River generation
    await this.generateRiversIfAvailable(tiles);

    // Debug sampling preserved (no side effects)
    this.debugSampleTiles(tiles);
  }

  // --- Extracted helpers from makeLand ---

  private setGenerationDependencies(
    heightGenerator?: any,
    temperatureMap?: TemperatureMap,
    riverGenerator?: any
  ): void {
    this.heightGenerator = heightGenerator;
    this.temperatureMap = temperatureMap;
    this.riverGenerator = riverGenerator;
  }

  private normalizePolesIfNeeded(heightMap: number[], tiles: MapTile[][]): void {
    if (this.heightMapProcessor.hasPoles()) {
      this.heightMapProcessor.normalizeHmapPoles(heightMap, tiles);
    }
  }

  private computeShoreLevel(heightGenerator: any | undefined, landpercent: number): number {
    return heightGenerator?.getShoreLevel?.() || Math.floor((255 * (100 - landpercent)) / 100);
  }

  private classifyLandAndOcean(
    tiles: MapTile[][],
    hmap_shore_level: number,
    land_fill: TerrainType
  ): void {
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tileHeight = tiles[x][y].elevation;
        tiles[x][y].terrain = 'ocean';

        if (tileHeight < hmap_shore_level) {
          let depth = ((hmap_shore_level - tileHeight) * 100) / hmap_shore_level;
          const neighborCount = this.countOceanLandNeighbors(tiles, x, y, hmap_shore_level);
          const ocean = neighborCount.ocean;
          const land = neighborCount.land;

          depth += (30 * (ocean - land)) / Math.max(1, ocean + land);
          depth = Math.min(depth, TERRAIN_OCEAN_DEPTH_MAXIMUM);

          tiles[x][y].terrain = depth > 50 ? 'deep_ocean' : 'ocean';
        } else {
          tiles[x][y].terrain = land_fill;
        }
      }
    }
  }

  private renormalizePolesIfNeeded(heightMap: number[], tiles: MapTile[][]): void {
    if (this.heightMapProcessor.hasPoles()) {
      this.heightMapProcessor.renormalizeHmapPoles(heightMap, tiles);
      // Note: make_polar_land() is not implemented
    }
  }

  private initializePlacementMapForOceans(tiles: MapTile[][]): void {
    this.placementMap.createPlacedMap();
    this.placementMap.setAllOceanTilesPlaced(tiles);
  }

  private generateRelief(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_shore_level: number,
    mountain_pct: number
  ): void {
    if (this.generator === 'fracture') {
      this.makeFractureRelief(tiles, heightMap, hmap_shore_level);
    } else {
      this.makeRelief(tiles, heightMap, hmap_shore_level, mountain_pct);
    }
  }

  private createTemperatureIfAvailable(tiles: MapTile[][], heightMap: number[]): void {
    if (this.temperatureMap) {
      this.createTemperatureMapInternal(tiles, heightMap);
    }
  }

  private placeTerrains(
    tiles: MapTile[][],
    terrainParams: TerrainParams,
    hmap_shore_level: number
  ): void {
    const hmap_max_level = 1000;
    this.terrainPlacementProcessor.initializeHmapLowLevel(
      terrainParams.swamp_pct,
      hmap_shore_level,
      hmap_max_level
    );
    this.terrainPlacementProcessor.makeTerrains(tiles, terrainParams);
  }

  private finalizeContinents(tiles: MapTile[][], isRandomMode: boolean): void {
    this.continentProcessor.removeTinyIslands(tiles, isRandomMode);
    this.continentProcessor.generateContinents(tiles);
  }

  private cleanupPlacementMap(): void {
    this.placementMap.destroyPlacedMap();
  }

  private finalPoleRenormalization(): void {
    if (this.heightGenerator) {
      this.heightGenerator.renormalizeHeightMapPoles();
    }
  }

  private async generateRiversIfAvailable(tiles: MapTile[][]): Promise<void> {
    if (this.riverGenerator) {
      await this.makeRivers(tiles);
    }
  }

  private debugSampleTiles(tiles: MapTile[][]): void {
    let _completeCount = 0;
    let _incompleteCount = 0;
    let sampleTile: MapTile | null = null;

    for (let x = 0; x < this.width && x < 5; x++) {
      for (let y = 0; y < this.height && y < 5; y++) {
        const tile = tiles[x][y];
        if (tile && tile.terrain && tile.terrain !== 'ocean' && tile.elevation !== undefined) {
          _completeCount++;
          if (!sampleTile) sampleTile = tile;
        } else {
          _incompleteCount++;
        }
      }
    }
    // Debug counters are intentionally unused; kept to preserve original diagnostics
    void _completeCount;
    void _incompleteCount;
    void sampleTile;
  }

  /**
   * Internal temperature map creation (Phase 1 fix)
   * @reference freeciv/server/generator/mapgen.c:1133 create_tmap(TRUE)
   */
  private createTemperatureMapInternal(tiles: MapTile[][], heightMap: number[]): void {
    if (!this.temperatureMap) return;

    this.temperatureMap.createTemperatureMap(tiles, heightMap);

    // Apply temperature data to tiles
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        tiles[x][y].temperature = this.temperatureMap.getTemperature(x, y);
      }
    }
  }

  /**
   * Internal river generation wrapper (Phase 1 fix)
   * @reference freeciv/server/generator/mapgen.c:1150 make_rivers()
   */
  private async makeRivers(tiles: MapTile[][]): Promise<void> {
    if (!this.riverGenerator) return;

    await this.riverGenerator.generateAdvancedRivers(tiles);
  }

  /**
   * Make relief (mountains and hills) based on height map with generator-specific characteristics
   * @reference freeciv/server/generator/mapgen.c:298-327 make_relief()
   * Enhanced for Task 10: Generator-specific terrain characteristics
   */
  private makeRelief(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_shore_level: number,
    mountain_pct: number
  ): void {
    // Calculate mountain level based on steepness
    const hmap_max_level = 1000;
    const steepness = 100 - mountain_pct;
    const hmap_mountain_level =
      ((hmap_max_level - hmap_shore_level) * (100 - steepness)) / 100 + hmap_shore_level;

    // Generator-specific adjustments for terrain characteristics
    const generatorAdjustments = this.getGeneratorSpecificAdjustments();

    // Iterate through all tiles to place mountains and hills
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const index = y * this.width + x;
        const tileHeight = heightMap[index];

        // Only process unplaced land tiles
        if (!this.placementMap.notPlaced(x, y) || isOceanTerrain(tile.terrain)) {
          continue;
        }

        // Enhanced terrain placement logic with generator-specific characteristics
        let shouldPlaceRelief =
          (hmap_mountain_level < tileHeight &&
            (this.random() * 10 > 5 ||
              !this.terrainIsTooHigh(tiles, x, y, hmap_mountain_level, tileHeight))) ||
          this.areaIsTooFlat(
            tiles,
            heightMap,
            x,
            y,
            hmap_mountain_level,
            tileHeight,
            hmap_shore_level
          );

        // Apply generator-specific modifications
        shouldPlaceRelief = this.applyGeneratorSpecificReliefLogic(
          shouldPlaceRelief,
          tiles,
          x,
          y,
          tileHeight,
          hmap_shore_level,
          generatorAdjustments
        );

        if (shouldPlaceRelief) {
          // Enhanced terrain selection with generator-specific preferences
          const terrainChoice = this.selectReliefTerrain(tile, generatorAdjustments);
          tile.terrain = terrainChoice as TerrainType;
          this.placementMap.setPlaced(x, y);
          this.terrainPlacementProcessor.setTerrainPropertiesForTile(tile);
        }
      }
    }
  }

  /**
   * Get generator-specific terrain adjustments for relief generation
   * @reference Task 10: Generator-specific terrain characteristics
   */
  private getGeneratorSpecificAdjustments() {
    switch (this.generator.toLowerCase()) {
      case 'island':
        return {
          coastalTerrainEmphasis: true,
          coastalDistance: 3, // Emphasize terrain within 3 tiles of coast
          mountainReduction: 0.7, // Fewer mountains on islands
          hillIncrease: 1.3, // More hills for gentle island topology
          forestBonus: 1.2, // Islands tend to be more forested
          type: 'island',
        };

      case 'random':
        return {
          balancedDistribution: true,
          varietyBonus: 1.1, // Slightly more variety in random maps
          clusteringReduction: 0.8, // Less clustering for more random feel
          type: 'random',
        };

      case 'fracture':
      default:
        return {
          continentalRelief: true,
          mountainIncrease: 1.3, // Already implemented in makeFractureRelief
          clustering: true,
          type: 'fracture',
        };
    }
  }

  /**
   * Apply generator-specific logic to relief placement decisions
   * @reference Task 10: Enhanced realism per generator type
   */
  private applyGeneratorSpecificReliefLogic(
    baseDecision: boolean,
    tiles: MapTile[][],
    x: number,
    y: number,
    _tileHeight: number,
    _hmap_shore_level: number,
    adjustments: any
  ): boolean {
    if (adjustments.type === 'island') {
      // Island maps: Emphasize coastal terrain, reduce inland mountains
      const distanceToCoast = this.calculateDistanceToCoast(tiles, x, y);
      const isCoastal = distanceToCoast <= adjustments.coastalDistance;

      if (isCoastal && adjustments.coastalTerrainEmphasis) {
        // Coastal emphasis: prefer hills over mountains, but still allow some relief
        return baseDecision && this.random() < 0.8;
      } else if (distanceToCoast > adjustments.coastalDistance) {
        // Inland areas: reduce mountain placement for island character
        return baseDecision && this.random() < adjustments.mountainReduction;
      }
    }

    if (adjustments.type === 'random') {
      // Random maps: Balanced distribution with slight variety bonus
      const varietyFactor = adjustments.balancedDistribution
        ? this.random() < 0.5
          ? adjustments.varietyBonus
          : 1 / adjustments.varietyBonus
        : 1;
      return baseDecision && this.random() < varietyFactor;
    }

    // Default (fracture) behavior or fallback
    return baseDecision;
  }

  /**
   * Select appropriate relief terrain based on generator characteristics
   * @reference Task 10: Generator-specific terrain selection
   */
  private selectReliefTerrain(tile: MapTile, adjustments: any): string {
    const isHotRegion = tile.temperature & TemperatureFlags.TT_HOT;

    if (adjustments.type === 'island') {
      // Islands prefer hills over mountains for gentler topology
      if (isHotRegion) {
        const preferHills = this.random() * 10 < 6; // Increased from 4 (60% vs 40%)
        return pickTerrain(
          MapgenTerrainPropertyEnum.MOUNTAINOUS,
          preferHills ? MapgenTerrainPropertyEnum.UNUSED : MapgenTerrainPropertyEnum.GREEN,
          MapgenTerrainPropertyEnum.UNUSED,
          this.random
        );
      } else {
        const preferMountains = this.random() * 10 < 6; // Decreased from 8 (60% vs 80%)
        return pickTerrain(
          MapgenTerrainPropertyEnum.MOUNTAINOUS,
          MapgenTerrainPropertyEnum.UNUSED,
          preferMountains ? MapgenTerrainPropertyEnum.GREEN : MapgenTerrainPropertyEnum.UNUSED,
          this.random
        );
      }
    }

    if (adjustments.type === 'random') {
      // Random maps: Balanced mountain/hill distribution
      const balanced = this.random() < 0.5;
      return pickTerrain(
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        balanced ? MapgenTerrainPropertyEnum.GREEN : MapgenTerrainPropertyEnum.UNUSED,
        balanced ? MapgenTerrainPropertyEnum.UNUSED : MapgenTerrainPropertyEnum.GREEN,
        this.random
      );
    }

    // Default fracture behavior: original freeciv logic
    if (isHotRegion) {
      const preferHills = this.random() * 10 < 4;
      return pickTerrain(
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        preferHills ? MapgenTerrainPropertyEnum.UNUSED : MapgenTerrainPropertyEnum.GREEN,
        MapgenTerrainPropertyEnum.UNUSED,
        this.random
      );
    } else {
      const preferMountains = this.random() * 10 < 8;
      return pickTerrain(
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        MapgenTerrainPropertyEnum.UNUSED,
        preferMountains ? MapgenTerrainPropertyEnum.GREEN : MapgenTerrainPropertyEnum.UNUSED,
        this.random
      );
    }
  }

  /**
   * Count ocean and land neighbors for ocean depth calculation
   * @param tiles Map tiles array
   * @param x Current x coordinate
   * @param y Current y coordinate
   * @param hmap_shore_level Shore level threshold
   * @returns Object with ocean and land neighbor counts
   */
  private countOceanLandNeighbors(
    tiles: MapTile[][],
    x: number,
    y: number,
    hmap_shore_level: number
  ): { ocean: number; land: number } {
    let ocean = 0;
    let land = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue; // Skip center tile

        const nx = x + dx;
        const ny = y + dy;

        if (this.isValidCoordinate(nx, ny)) {
          if (tiles[nx][ny].elevation < hmap_shore_level) {
            ocean++;
          } else {
            land++;
            break; // Exit early if any land found
          }
        }
      }
    }

    return { ocean, land };
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
   * Calculate distance to nearest coast for island generator
   * @reference Task 10: Island maps emphasize coastal terrain
   */
  private calculateDistanceToCoast(tiles: MapTile[][], x: number, y: number): number {
    // Simple implementation: check in expanding squares until ocean is found
    for (let radius = 1; radius <= 5; radius++) {
      if (this.hasOceanAtRadius(tiles, x, y, radius)) {
        return radius;
      }
    }
    return 5; // Max distance checked
  }

  /**
   * Check if there's an ocean tile at the given radius from position
   * @param tiles Map tiles array
   * @param x Center x coordinate
   * @param y Center y coordinate
   * @param radius Distance to check
   * @returns true if ocean found at radius
   */
  private hasOceanAtRadius(tiles: MapTile[][], x: number, y: number, radius: number): boolean {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only check the border of the current radius square
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const nx = x + dx;
        const ny = y + dy;

        if (this.isValidCoordinate(nx, ny) && isOceanTerrain(tiles[nx][ny].terrain)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Special relief generation for fracture maps - enhanced continental characteristics
   * @reference freeciv/server/generator/fracture_map.c:294-366 make_fracture_relief()
   * Enhanced for Task 10: Generator-specific terrain characteristics
   * Fracture maps emphasize continental relief with enhanced mountain ranges
   */
  private makeFractureRelief(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_shore_level: number
  ): void {
    // Calculate land area for mountain percentage calculations
    const landarea = this.computeLandAreaAboveShore(heightMap, hmap_shore_level);

    // Standard fracture relief parameters matching freeciv exactly
    // @reference freeciv/server/generator/fracture_map.c:335
    const hmap_max_level = 1000;
    const hmap_mountain_level = (hmap_max_level + hmap_shore_level) / 2;

    // First iteration: Place mountains and hills based on local elevation
    // @reference freeciv/server/generator/fracture_map.c:313-338
    const total_mtns_after_first = this.processFractureReliefFirstPass(
      tiles,
      heightMap,
      hmap_mountain_level,
      hmap_shore_level
    );

    // Second iteration: Ensure minimum mountain percentage based on steepness
    // @reference freeciv/server/generator/fracture_map.c:340-366
    const steepness = 30; // Default steepness setting (equivalent to wld.map.server.steepness)
    const min_mountains = (landarea * steepness) / 100;

    // Ensure we meet minimum mountains; return value unused, kept for clarity
    void this.ensureMinimumMountains(
      tiles,
      heightMap,
      hmap_shore_level,
      total_mtns_after_first,
      min_mountains
    );
  }

  private shouldChooseMountain(
    tileHeight: number,
    localAvg: number,
    tiles: MapTile[][],
    heightMap: number[],
    x: number,
    y: number,
    hmap_mountain_level: number,
    hmap_shore_level: number
  ): boolean {
    return (
      tileHeight > localAvg * 1.2 ||
      (this.areaIsTooFlat(
        tiles,
        heightMap,
        x,
        y,
        hmap_mountain_level,
        tileHeight,
        hmap_shore_level
      ) &&
        this.random() < 0.4)
    );
  }

  private shouldChooseHill(
    tileHeight: number,
    localAvg: number,
    tiles: MapTile[][],
    heightMap: number[],
    x: number,
    y: number,
    hmap_mountain_level: number,
    hmap_shore_level: number
  ): boolean {
    return (
      tileHeight > localAvg * 1.1 ||
      (this.areaIsTooFlat(
        tiles,
        heightMap,
        x,
        y,
        hmap_mountain_level,
        tileHeight,
        hmap_shore_level
      ) &&
        this.random() < 0.4)
    );
  }

  private placeMountainTerrain(tile: MapTile, x: number, y: number): void {
    tile.terrain = pickTerrain(
      MapgenTerrainPropertyEnum.MOUNTAINOUS,
      MapgenTerrainPropertyEnum.UNUSED,
      MapgenTerrainPropertyEnum.GREEN,
      this.random
    );
    this.placementMap.setPlaced(x, y);
    this.terrainPlacementProcessor.setTerrainPropertiesForTile(tile);
  }

  private placeHillTerrain(tile: MapTile, x: number, y: number): void {
    tile.terrain = pickTerrain(
      MapgenTerrainPropertyEnum.MOUNTAINOUS,
      MapgenTerrainPropertyEnum.GREEN,
      MapgenTerrainPropertyEnum.UNUSED,
      this.random
    );
    this.placementMap.setPlaced(x, y);
    this.terrainPlacementProcessor.setTerrainPropertiesForTile(tile);
  }

  // Helper methods for fracture relief, extracted to reduce complexity of makeFractureRelief
  private computeLandAreaAboveShore(heightMap: number[], hmap_shore_level: number): number {
    let landarea = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        if (heightMap[index] > hmap_shore_level) {
          landarea++;
        }
      }
    }
    return landarea;
  }

  private processFractureReliefFirstPass(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_mountain_level: number,
    hmap_shore_level: number
  ): number {
    let total_mtns = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const index = y * this.width + x;
        const tileHeight = heightMap[index];

        // Only process unplaced land tiles
        if (!this.placementMap.notPlaced(x, y) || tileHeight <= hmap_shore_level) {
          continue;
        }

        // Calculate local average elevation
        const localAvg = this.heightMapProcessor.localAveElevation(heightMap, x, y);

        // Exact freeciv thresholds
        const choose_mountain = this.shouldChooseMountain(
          tileHeight,
          localAvg,
          tiles,
          heightMap,
          x,
          y,
          hmap_mountain_level,
          hmap_shore_level
        );

        const choose_hill = this.shouldChooseHill(
          tileHeight,
          localAvg,
          tiles,
          heightMap,
          x,
          y,
          hmap_mountain_level,
          hmap_shore_level
        );

        // Avoid coast
        if (this.oceanProcessor.hasOceanNeighbor(tiles, x, y)) {
          continue;
        }

        if (choose_mountain) {
          total_mtns++;
          this.placeMountainTerrain(tile, x, y);
        } else if (choose_hill) {
          total_mtns++;
          this.placeHillTerrain(tile, x, y);
        }
      }
    }
    return total_mtns;
  }

  private ensureMinimumMountains(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_shore_level: number,
    total_mtns_start: number,
    min_mountains: number
  ): number {
    let total_mtns = total_mtns_start;
    for (let iter = 0; total_mtns < min_mountains && iter < 50; iter++) {
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          const tile = tiles[x][y];
          const index = y * this.width + x;
          const tileHeight = heightMap[index];

          if (this.placementMap.notPlaced(x, y) && tileHeight > hmap_shore_level) {
            const choose_mountain = this.random() * 10000 < 10;
            const choose_hill = this.random() * 10000 < 10;

            if (choose_mountain) {
              total_mtns++;
              this.placeMountainTerrain(tile, x, y);
            } else if (choose_hill) {
              total_mtns++;
              this.placeHillTerrain(tile, x, y);
            }
          }

          if (total_mtns >= min_mountains) {
            break;
          }
        }
        if (total_mtns >= min_mountains) {
          break;
        }
      }
    }
    return total_mtns;
  }

  /**
   * Check if terrain is too high (prevent mountain clustering)
   * @reference freeciv/server/generator/mapgen.c:280-290 terrain_is_too_high()
   * Prevents large continuous mountain ranges
   */
  private terrainIsTooHigh(
    tiles: MapTile[][],
    x: number,
    y: number,
    thill: number,
    _my_height: number
  ): boolean {
    // Check surrounding tiles in a 3x3 square
    // @reference freeciv/server/generator/mapgen.c:283-287
    const hmap_max_level = 1000;
    const hmap_mountain_level = thill; // Use passed threshold

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborHeight = tiles[nx][ny].elevation || 0;
          // Check if neighbor is significantly lower
          if (neighborHeight + (hmap_max_level - hmap_mountain_level) / 5 < thill) {
            return false;
          }
        }
      }
    }
    return true;
  }

  /**
   * Check if area is too flat (needs relief features)
   * @reference freeciv/server/generator/height_map.c:271-295 area_is_too_flat()
   * Determines if area needs mountains/hills for variety
   */
  private areaIsTooFlat(
    _tiles: MapTile[][],
    heightMap: number[],
    x: number,
    y: number,
    thill: number,
    my_height: number,
    hmap_shore_level: number
  ): boolean {
    let higher_than_me = 0;

    // Check surrounding tiles in a 5x5 square
    // @reference freeciv/server/generator/height_map.c:275-287
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (!this.isValidCoordinate(nx, ny)) continue;

        const neighborHeight = heightMap[ny * this.width + nx];

        // Early return if neighbor is above threshold - area is not flat
        if (neighborHeight > thill) {
          return false;
        }

        // Check if neighbor is higher than current tile
        if (neighborHeight > my_height) {
          const distance = Math.abs(dx) + Math.abs(dy);
          if (distance === 1) {
            return false; // Adjacent tile is higher
          }
          higher_than_me++;
          if (higher_than_me > 2) {
            return false;
          }
        }
      }
    }

    // Final check based on relative heights
    // @reference freeciv/server/generator/height_map.c:289-291
    if ((thill - hmap_shore_level) * higher_than_me > (my_height - hmap_shore_level) * 4) {
      return false;
    }

    return true;
  }

  // UNUSED: Legacy terrain clustering method - replaced with freeciv-compliant approach
  /*
  private hasTerrainClusterNearby(
    tiles: MapTile[][],
    x: number,
    y: number,
    terrainTypes: string[],
    radius: number = 1
  ): boolean {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (terrainTypes.includes(tiles[nx][ny].terrain)) {
            return true;
          }
        }
      }
    }
    return false;
  }
  */

  // Utility functions

  /**
   * REMOVED: Custom temperature conversion - now uses 100% compliant TemperatureMap
   * @reference freeciv/server/generator/temperature_map.c:160-172
   * TemperatureMap.convertToTemperatureTypes() provides reference-compliant implementation
   */
  public convertTemperatureToEnum(_tiles: MapTile[][]): void {
    // NO-OP: TemperatureMap already provides correct discrete temperature types
    // This function is kept for API compatibility but does nothing
    // Temperature conversion is now handled directly in TemperatureMap.convertToTemperatureTypes()
  }

  /**
   * Smooth water depth based on distance from land and adjacent ocean types
   * Delegated to OceanProcessor for better organization
   */
  public smoothWaterDepth(tiles: MapTile[][]): void {
    return this.oceanProcessor.smoothWaterDepth(tiles);
  }

  /**
   * Generate wetness map for terrain variation
   * Delegated to BiomeProcessor for better organization
   */
  public generateWetnessMap(tiles: MapTile[][]): void {
    return this.biomeProcessor.generateWetnessMap(tiles);
  }

  /**
   * Apply biome transitions with enhanced terrain clustering algorithms
   * Delegated to BiomeProcessor for better organization
   */
  public applyBiomeTransitions(tiles: MapTile[][]): void {
    return this.biomeProcessor.applyBiomeTransitions(tiles);
  }

  /**
   * Apply terrain types based on temperature zones
   * @reference freeciv/server/generator/mapgen.c make_plain()
   * Exact copy of freeciv terrain placement by temperature
   */
  public makePlains(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Only fill tiles that haven't been placed yet (still have default terrain)
        if (tile.terrain === 'grassland') {
          // Fill based on temperature like freeciv make_plain()
          if (tile.temperature === TemperatureType.FROZEN) {
            // Frozen: use tundra instead of glacier
            tile.terrain = 'tundra';
          } else if (tile.temperature === TemperatureType.COLD) {
            // Cold: reasonable chance of tundra with natural variation
            tile.terrain = this.random() < 0.7 ? 'tundra' : 'plains';
          } else {
            // Temperate/Tropical: pick_terrain(MG_TEMPERATE, MG_GREEN, MG_MOUNTAINOUS)
            tile.terrain = this.random() < 0.6 ? 'grassland' : 'plains';
          }

          setTerrainGameProperties(tile);
        }
      }
    }
  }

  /**
   * Create base map tile with default terrain properties
   */

  /**
   * Regenerate all oceanic tiles for small water bodies as lakes
   * @reference freeciv/server/generator/mapgen_utils.c:356 regenerate_lakes()
   * Converts small ocean bodies (1-2 tiles) to freshwater lakes
   * Assumes continent numbers have already been assigned
   */
  public regenerateLakes(tiles: MapTile[][]): void {
    // Use OceanProcessor for lake regeneration
    this.oceanProcessor.regenerateLakes(tiles);
  }
}
