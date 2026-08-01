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
import { MapTopology, type MapTopologyOptions } from './MapTopology';

// Deliberately disabled: the separate Freeciv polar-land pass creates long,
// artificial glacier strips along map edges in CivJS. Keep the implementation
// available for parity work, but do not enable it in production generation.
const POLAR_LAND_GENERATION_ENABLED = false;

export class TerrainGenerator {
  private width: number;
  private height: number;
  private random: () => number;
  private generator: string;
  private placementMap: PlacementMap;
  private temperatureMap?: TemperatureMap; // Will be passed for temperature map creation
  private riverGenerator?: any; // Will be passed for river generation

  // Extracted components
  private heightMapProcessor: HeightMapProcessor;
  private terrainPlacementProcessor: TerrainPlacementProcessor;
  private biomeProcessor: BiomeProcessor;
  private oceanProcessor: OceanProcessor;
  private continentProcessor: ContinentProcessor;
  private topology: MapTopology;

  constructor(
    width: number,
    height: number,
    random: () => number,
    generator: string,
    topologyOptions: MapTopologyOptions = {},
    climateOptions: { temperature?: number; separatePoles?: boolean; flatPoles?: number } = {}
  ) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.generator = generator;
    this.placementMap = new PlacementMap(width, height, topologyOptions);
    this.topology = new MapTopology(width, height, topologyOptions);

    // Initialize extracted components
    this.heightMapProcessor = new HeightMapProcessor(
      width,
      height,
      random,
      topologyOptions,
      climateOptions
    );
    this.terrainPlacementProcessor = new TerrainPlacementProcessor(
      width,
      height,
      random,
      this.placementMap
    );
    this.biomeProcessor = new BiomeProcessor(width, height, random, topologyOptions);
    this.oceanProcessor = new OceanProcessor(width, height, random, topologyOptions);
    this.continentProcessor = new ContinentProcessor(width, height, random, topologyOptions);
  }

  public setGenerator(generator: string): void {
    this.generator = generator.toLowerCase();
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
    const ICE_BASE_LEVEL = 20; // Classic separate-poles default at temperature 50
    const MAX_COLATITUDE = 1000; // From freeciv common/map.h
    const TROPICAL_LEVEL = Math.min(
      (MAX_COLATITUDE * 9) / 10,
      (MAX_COLATITUDE * (143 * 7 - temperature * 10)) / 700
    );

    const polar = (2 * ICE_BASE_LEVEL * landpercent) / MAX_COLATITUDE;
    const mount_factor = (100.0 - polar - steepness * 0.8) / 10000;
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
    params: {
      landpercent: number;
      steepness: number;
      wetness: number;
      temperature: number;
      riverDensity?: number;
    },
    heightGenerator?: any,
    temperatureMap?: TemperatureMap,
    riverGenerator?: any
  ): Promise<void> {
    // Store dependencies for internal use
    void heightGenerator;
    this.setGenerationDependencies(temperatureMap, riverGenerator);

    // Step 1: Normalize poles if present
    this.normalizePolesIfNeeded(heightMap, tiles);

    // Step 2: temporary land fill terrain (as in freeciv)
    const land_fill: TerrainType = 'grassland';

    // Step 3: Compute shore level
    const hmap_shore_level = this.computeShoreLevel(heightMap, params.landpercent);

    // Step 5: Classify tiles into ocean/land (with neighbor-aware ocean depth)
    this.classifyLandAndOcean(tiles, heightMap, hmap_shore_level, land_fill);

    // Step 6: Renormalize poles post land classification
    this.renormalizePolesIfNeeded(heightMap, tiles);

    // Recreate the real temperature map after oceans are known. The separate
    // polar-land pass is deliberately disabled above because it creates long,
    // artificial glacier strips along map edges on standard and small maps.
    this.createTemperatureIfAvailable(tiles, heightMap, hmap_shore_level);
    if (POLAR_LAND_GENERATION_ENABLED) {
      this.makePolarLand(tiles, hmap_shore_level);
    }

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
    this.generateRelief(tiles, heightMap, hmap_shore_level, params.steepness);

    // Step 10: Place forests/deserts/etc. (requires hmap_low_level init)
    this.placeTerrains(tiles, terrainParams, hmap_shore_level);

    // Step 10.5: Continent assignment
    this.finalizeContinents(tiles, this.generator === 'random');

    // Step 11: Cleanup placement map
    this.cleanupPlacementMap();

    // Step 14: River generation
    await this.generateRiversIfAvailable(tiles, params.riverDensity);

    // Debug sampling preserved (no side effects)
    this.debugSampleTiles(tiles);
  }

  // --- Extracted helpers from makeLand ---

  private setGenerationDependencies(temperatureMap?: TemperatureMap, riverGenerator?: any): void {
    this.temperatureMap = temperatureMap;
    this.riverGenerator = riverGenerator;
  }

  private normalizePolesIfNeeded(heightMap: number[], tiles: MapTile[][]): void {
    if (this.heightMapProcessor.hasPoles()) {
      this.heightMapProcessor.normalizeHmapPoles(heightMap, tiles);
    }
  }

  private computeShoreLevel(heightMap: number[], landpercent: number): number {
    void heightMap;
    return Math.floor((255 * (100 - landpercent)) / 100);
  }

  private classifyLandAndOcean(
    tiles: MapTile[][],
    heightMap: number[],
    hmap_shore_level: number,
    land_fill: TerrainType
  ): void {
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tileHeight = heightMap[y * this.width + x];
        tiles[x][y].terrain = 'ocean';

        if (tileHeight < hmap_shore_level) {
          let depth = ((hmap_shore_level - tileHeight) * 100) / hmap_shore_level;
          const neighborCount = this.countOceanLandNeighbors(heightMap, x, y, hmap_shore_level);
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
    }
  }

  private makePolarLand(tiles: MapTile[][], shoreLevel: number): void {
    if (!['random', 'fracture'].includes(this.generator.toLowerCase())) return;

    this.continentProcessor.generateContinents(tiles);
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (!isOceanTerrain(tile.terrain)) continue;

        const neighbors = this.topology.getNeighbors(x, y);
        const separateFromLand = neighbors.every(
          position => tiles[position.x][position.y].continentId <= 0
        );
        const nextToFrozen = neighbors.some(
          position => tiles[position.x][position.y].temperature === TemperatureType.FROZEN
        );
        const shouldFreeze =
          tile.temperature === TemperatureType.FROZEN ||
          (tile.temperature === TemperatureType.COLD && nextToFrozen && this.random() > 0.7);

        if (shouldFreeze && separateFromLand) {
          tile.terrain = 'glacier';
          tile.elevation = Math.max(tile.elevation, shoreLevel);
          tile.continentId = 0;
          setTerrainGameProperties(tile);
        }
      }
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
    steepness: number
  ): void {
    if (this.generator === 'fracture') {
      this.makeFractureRelief(tiles, heightMap, hmap_shore_level, steepness);
    } else {
      this.makeRelief(tiles, heightMap, hmap_shore_level, steepness);
    }
  }

  private createTemperatureIfAvailable(
    tiles: MapTile[][],
    heightMap: number[],
    shoreLevel: number
  ): void {
    if (this.temperatureMap) {
      this.createTemperatureMapInternal(tiles, heightMap, shoreLevel);
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
    // On compact maps every generated landmass can fall below the normal
    // tiny-island threshold. Freeciv's production map-size constraints avoid
    // this case; retaining those islands keeps direct small-map API use valid.
    if (this.width * this.height >= 400) {
      this.continentProcessor.removeTinyIslands(tiles, isRandomMode);
    }
    this.continentProcessor.generateContinents(tiles);
  }

  private cleanupPlacementMap(): void {
    this.placementMap.destroyPlacedMap();
  }

  private async generateRiversIfAvailable(
    tiles: MapTile[][],
    riverDensity?: number
  ): Promise<void> {
    if (this.riverGenerator) {
      await this.makeRivers(tiles, riverDensity);
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
  private createTemperatureMapInternal(
    tiles: MapTile[][],
    heightMap: number[],
    shoreLevel: number
  ): void {
    if (!this.temperatureMap) return;

    this.temperatureMap.createTemperatureMap(tiles, heightMap, true, shoreLevel);

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
  private async makeRivers(tiles: MapTile[][], riverDensity?: number): Promise<void> {
    if (!this.riverGenerator) return;

    await this.riverGenerator.generateAdvancedRivers(tiles, riverDensity);
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
    steepness: number
  ): void {
    const hmap_max_level = Math.max(...heightMap);
    const hmap_mountain_level =
      ((hmap_max_level - hmap_shore_level) * (100 - steepness)) / 100 + hmap_shore_level;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        const index = y * this.width + x;
        const tileHeight = heightMap[index];

        if (!this.placementMap.notPlaced(x, y) || isOceanTerrain(tile.terrain)) {
          continue;
        }

        const shouldPlaceRelief =
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

        if (shouldPlaceRelief) {
          const isHotRegion = (tile.temperature & TemperatureFlags.TT_HOT) !== 0;
          tile.terrain = isHotRegion
            ? pickTerrain(
                MapgenTerrainPropertyEnum.MOUNTAINOUS,
                this.random() * 10 < 4
                  ? MapgenTerrainPropertyEnum.UNUSED
                  : MapgenTerrainPropertyEnum.GREEN,
                MapgenTerrainPropertyEnum.UNUSED,
                this.random
              )
            : pickTerrain(
                MapgenTerrainPropertyEnum.MOUNTAINOUS,
                MapgenTerrainPropertyEnum.UNUSED,
                this.random() * 10 < 8
                  ? MapgenTerrainPropertyEnum.GREEN
                  : MapgenTerrainPropertyEnum.UNUSED,
                this.random
              );
          this.placementMap.setPlaced(x, y);
          this.terrainPlacementProcessor.setTerrainPropertiesForTile(tile);
        }
      }
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
    heightMap: number[],
    x: number,
    y: number,
    hmap_shore_level: number
  ): { ocean: number; land: number } {
    let ocean = 0;
    let land = 0;

    for (const { x: nx, y: ny } of this.topology.getNeighbors(x, y)) {
      if (heightMap[ny * this.width + nx] < hmap_shore_level) {
        ocean++;
      } else {
        land++;
      }
    }

    return { ocean, land };
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
    hmap_shore_level: number,
    steepness: number
  ): void {
    // Calculate land area for mountain percentage calculations
    const landarea = this.computeLandAreaAboveShore(heightMap, hmap_shore_level);

    // Standard fracture relief parameters matching freeciv exactly
    // @reference freeciv/server/generator/fracture_map.c:335
    const hmap_max_level = Math.max(...heightMap);
    const hmap_mountain_level =
      ((hmap_max_level - hmap_shore_level) * (100 - steepness)) / 100 + hmap_shore_level;

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

    for (const { x: nx, y: ny } of this.topology.getPositionsWithinRadius(x, y, 1)) {
      const neighborHeight = tiles[nx][ny].elevation || 0;
      if (neighborHeight + (hmap_max_level - hmap_mountain_level) / 5 < thill) {
        return false;
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
    for (const { x: nx, y: ny } of this.topology.getPositionsWithinRadius(x, y, 2)) {
      const neighborHeight = heightMap[ny * this.width + nx];

      // Early return if neighbor is above threshold - area is not flat
      if (neighborHeight > thill) {
        return false;
      }

      // Check if neighbor is higher than current tile
      if (neighborHeight > my_height) {
        const distance = this.topology.mapDistance(x, y, nx, ny);
        if (distance === 1) {
          return false; // Adjacent tile is higher
        }
        higher_than_me++;
        if (higher_than_me > 2) {
          return false;
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
  public generateWetnessMap(tiles: MapTile[][], baseWetness: number = 50): void {
    return this.biomeProcessor.generateWetnessMap(tiles, baseWetness);
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
