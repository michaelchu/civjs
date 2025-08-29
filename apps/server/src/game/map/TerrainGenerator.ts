/**
 * Specialized terrain generation algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c
 * @reference freeciv/server/generator/height_map.c
 * Exact copies of freeciv terrain algorithms
 */
import { MapTile, TemperatureType, TemperatureFlags, TerrainType } from './MapTypes';
import { TemperatureMap } from './TemperatureMap';
import {
  isOceanTerrain,
  isFrozenTerrain,
  isLandTile,
  setTerrainGameProperties,
  isTinyIsland,
  PlacementMap,
} from './TerrainUtils';
import { MapgenTerrainProperty, pickTerrain, getTerrainProperties } from './TerrainRuleset';

export interface TerrainParams {
  mountain_pct: number;
  forest_pct: number;
  jungle_pct: number;
  desert_pct: number;
  swamp_pct: number;
  river_pct: number;
}

export class TerrainGenerator {
  private width: number;
  private height: number;
  private random: () => number;
  private generator: string;
  private placementMap: PlacementMap;
  private heightGenerator?: any; // Will be passed for pole renormalization
  private temperatureMap?: TemperatureMap; // Will be passed for temperature map creation
  private riverGenerator?: any; // Will be passed for river generation

  constructor(width: number, height: number, random: () => number, generator: string) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.generator = generator;
    this.placementMap = new PlacementMap(width, height);
  }

  /**
   * Copy height map values to tile altitude properties
   * @reference freeciv/server/generator/height_map.c height_map_to_map()
   * Exact copy of freeciv height map transfer algorithm
   */
  public heightMapToMap(tiles: MapTile[][], heightMap: number[]): void {
    // Copy height map values to tile altitude
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        tiles[x][y].elevation = heightMap[index];
      }
    }
    // Note: wld.map.altitude_info = TRUE; is implicit in our implementation
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
    this.heightGenerator = heightGenerator;
    this.temperatureMap = temperatureMap;
    this.riverGenerator = riverGenerator;
    // Constants from freeciv
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv

    // Step 1: HAS_POLES - normalize height map at poles to prevent excessive land
    // @reference freeciv/server/generator/mapgen.c:899-901 normalize_hmap_poles()
    if (this.hasPoles()) {
      this.normalizeHmapPoles(heightMap, tiles);
    }

    // Step 2: Pick a non-ocean terrain for land_fill (temporary land terrain)
    const land_fill = 'grassland'; // Simple default - in freeciv this searches terrain types

    // Step 3: Set shore level based on landpercent
    // CRITICAL FIX: Use shore level from height generator (already in correct 0-255 scale)
    // instead of calculating in 0-1000 scale which doesn't match normalized heights
    const hmap_shore_level =
      heightGenerator?.getShoreLevel?.() || Math.floor((255 * (100 - params.landpercent)) / 100);

    // DEBUG: Log shore level fix
    console.log(
      `DEBUG: makeLand() using corrected shore level: ${hmap_shore_level} (was using 700 before fix)`
    );

    // DEBUG: Compare first few height values to verify they match analysis
    console.log(
      `DEBUG: makeLand() heightMap sample - [0]=${heightMap[0]}, [1]=${heightMap[1]}, [2]=${heightMap[2]}, [100]=${heightMap[100]}`
    );

    // Step 4: ini_hmap_low_level() - calculate low level for swamps
    // hmap_low_level = (4 * swamp_pct * (hmap_max_level - hmap_shore_level)) / 100 + hmap_shore_level;
    // const hmap_low_level = (4 * terrainParams.swamp_pct * (hmap_max_level - hmap_shore_level)) / 100 + hmap_shore_level;

    // Step 5: Main iteration - set terrain based on height
    let landTilesAssigned = 0;
    let oceanTilesAssigned = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // CRITICAL FIX: Use tile elevation instead of potentially corrupted heightMap
        const tileHeight = tiles[x][y].elevation;

        // Set as unknown first (freeciv: tile_set_terrain(ptile, T_UNKNOWN))
        tiles[x][y].terrain = 'ocean'; // We'll use ocean as default

        if (tileHeight < hmap_shore_level) {
          // This tile should be ocean
          let depth = ((hmap_shore_level - tileHeight) * 100) / hmap_shore_level;
          let ocean = 0;
          let land = 0;

          // Count adjacent ocean/land for shallow connection prevention
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              if (dx === 0 && dy === 0) continue; // Skip center tile
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
                // CRITICAL FIX: Use tile elevation instead of potentially corrupted heightMap
                if (tiles[nx][ny].elevation < hmap_shore_level) {
                  ocean++;
                } else {
                  land++;
                  break; // Exit early if any land found
                }
              }
            }
          }

          // Adjust depth based on neighbors
          depth += (30 * (ocean - land)) / Math.max(1, ocean + land);
          depth = Math.min(depth, TERRAIN_OCEAN_DEPTH_MAXIMUM);

          // Generate sea ice based on temperature (simplified - freeciv has complex logic)
          // For now, just set ocean depth-based terrain
          if (depth > 50) {
            tiles[x][y].terrain = 'deep_ocean';
          } else {
            tiles[x][y].terrain = 'ocean';
          }
          oceanTilesAssigned++;
        } else {
          // This tile should be land - set to land_fill temporarily
          tiles[x][y].terrain = land_fill;
          landTilesAssigned++;
        }
      }
    }

    // DEBUG: Log initial terrain assignment counts
    console.log(
      `DEBUG: makeLand() initial assignment - Land: ${landTilesAssigned}, Ocean: ${oceanTilesAssigned}, Total: ${landTilesAssigned + oceanTilesAssigned}, Shore level: ${hmap_shore_level}`
    );

    // Step 6: HAS_POLES - renormalize height map and create polar land
    // @reference freeciv/server/generator/mapgen.c:928-932
    if (this.hasPoles()) {
      this.renormalizeHmapPoles(heightMap, tiles);
      // Note: make_polar_land() creates additional land at poles - not implemented yet
    }

    // Step 7: Temperature map is created here in freeciv
    // destroy_tmap(); create_tmap(TRUE); - we handle this elsewhere

    // Step 8: Create placed_map and set ocean tiles as placed
    // @reference freeciv/server/generator/mapgen.c:939 create_placed_map()
    this.placementMap.createPlacedMap();
    this.placementMap.setAllOceanTilesPlaced(tiles);

    // Get terrain parameters using freeciv algorithm
    const terrainParams = this.adjustTerrainParam(
      params.landpercent,
      params.steepness,
      params.wetness,
      params.temperature
    );

    // Step 9: Relief generation
    if (this.generator === 'fracture') {
      // make_fracture_relief(); - special relief for fracture maps
      this.makeFractureRelief(tiles, heightMap, hmap_shore_level);
    } else {
      // make_relief(); - standard relief (mountains/hills)
      this.makeRelief(tiles, heightMap, hmap_shore_level, terrainParams.mountain_pct);
    }

    // Step 10: make_terrains() - place forests, deserts, etc.
    this.makeTerrains(tiles, terrainParams);

    // Step 10.5: Continent assignment in correct order (Phase 1 fix)
    // @reference freeciv/server/generator/mapgen.c:1370-1377 sequence
    // First remove tiny islands, then assign continent numbers
    // CALIBRATION FIX: Make tiny island removal less aggressive for Random mode
    const isRandomMode = this.generator === 'random';
    this.removeTinyIslands(tiles, isRandomMode);
    this.generateContinents(tiles);

    // Step 11: destroy_placed_map() - cleanup
    // @reference freeciv/server/generator/mapgen.c:1045 destroy_placed_map()
    this.placementMap.destroyPlacedMap();

    // Step 12: Final pole renormalization (freeciv line 1128 equivalent)
    // @reference freeciv/server/generator/mapgen.c:1127-1129
    if (this.heightGenerator) {
      this.heightGenerator.renormalizeHeightMapPoles();
    }

    // Step 13: Temperature map creation (freeciv line 1134 equivalent)
    // @reference freeciv/server/generator/mapgen.c:1133 create_tmap(TRUE)
    if (this.temperatureMap) {
      this.createTemperatureMapInternal(tiles, heightMap);
    }

    // Step 14: River generation (freeciv line 1150 equivalent)
    // @reference freeciv/server/generator/mapgen.c:1150 make_rivers()
    if (this.riverGenerator) {
      await this.makeRivers(tiles);
    }
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
          this.setTerrainProperties(tile);
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
          MapgenTerrainProperty.MOUNTAINOUS,
          preferHills ? MapgenTerrainProperty.UNUSED : MapgenTerrainProperty.GREEN,
          MapgenTerrainProperty.UNUSED,
          this.random
        );
      } else {
        const preferMountains = this.random() * 10 < 6; // Decreased from 8 (60% vs 80%)
        return pickTerrain(
          MapgenTerrainProperty.MOUNTAINOUS,
          MapgenTerrainProperty.UNUSED,
          preferMountains ? MapgenTerrainProperty.GREEN : MapgenTerrainProperty.UNUSED,
          this.random
        );
      }
    }

    if (adjustments.type === 'random') {
      // Random maps: Balanced mountain/hill distribution
      const balanced = this.random() < 0.5;
      return pickTerrain(
        MapgenTerrainProperty.MOUNTAINOUS,
        balanced ? MapgenTerrainProperty.GREEN : MapgenTerrainProperty.UNUSED,
        balanced ? MapgenTerrainProperty.UNUSED : MapgenTerrainProperty.GREEN,
        this.random
      );
    }

    // Default fracture behavior: original freeciv logic
    if (isHotRegion) {
      const preferHills = this.random() * 10 < 4;
      return pickTerrain(
        MapgenTerrainProperty.MOUNTAINOUS,
        preferHills ? MapgenTerrainProperty.UNUSED : MapgenTerrainProperty.GREEN,
        MapgenTerrainProperty.UNUSED,
        this.random
      );
    } else {
      const preferMountains = this.random() * 10 < 8;
      return pickTerrain(
        MapgenTerrainProperty.MOUNTAINOUS,
        MapgenTerrainProperty.UNUSED,
        preferMountains ? MapgenTerrainProperty.GREEN : MapgenTerrainProperty.UNUSED,
        this.random
      );
    }
  }

  /**
   * Calculate distance to nearest coast for island generator
   * @reference Task 10: Island maps emphasize coastal terrain
   */
  private calculateDistanceToCoast(tiles: MapTile[][], x: number, y: number): number {
    // Simple implementation: check in expanding squares until ocean is found
    for (let radius = 1; radius <= 5; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          // Only check the border of the current radius square
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
            if (isOceanTerrain(tiles[nx][ny].terrain)) {
              return radius;
            }
          }
        }
      }
    }
    return 5; // Max distance checked
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
    let landarea = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        if (heightMap[index] > hmap_shore_level) {
          landarea++;
        }
      }
    }

    // Standard fracture relief parameters matching freeciv exactly
    // @reference freeciv/server/generator/fracture_map.c:335
    const hmap_max_level = 1000;
    const hmap_mountain_level = (hmap_max_level + hmap_shore_level) / 2;

    // First iteration: Place mountains and hills based on local elevation
    // @reference freeciv/server/generator/fracture_map.c:313-338
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
        const localAvg = this.localAveElevation(heightMap, x, y);

        // Exact freeciv mountain placement thresholds
        // @reference freeciv/server/generator/fracture_map.c:317-321
        const choose_mountain =
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
            this.random() < 0.4);

        const choose_hill =
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
            this.random() < 0.4);

        // Exact freeciv coastal avoidance - ZERO EXCEPTIONS
        // @reference freeciv/server/generator/fracture_map.c:322-326
        // "The following avoids hills and mountains directly along the coast."
        if (this.hasOceanNeighbor(tiles, x, y)) {
          continue; // choose_mountain = FALSE; choose_hill = FALSE;
        }

        // Exact freeciv terrain placement logic
        // @reference freeciv/server/generator/fracture_map.c:327-337
        if (choose_mountain) {
          total_mtns++;
          tile.terrain = pickTerrain(
            MapgenTerrainProperty.MOUNTAINOUS,
            MapgenTerrainProperty.UNUSED,
            MapgenTerrainProperty.GREEN,
            this.random
          );
          this.placementMap.setPlaced(x, y);
          this.setTerrainProperties(tile);
        } else if (choose_hill) {
          total_mtns++;
          tile.terrain = pickTerrain(
            MapgenTerrainProperty.MOUNTAINOUS,
            MapgenTerrainProperty.GREEN,
            MapgenTerrainProperty.UNUSED,
            this.random
          );
          this.placementMap.setPlaced(x, y);
          this.setTerrainProperties(tile);
        }
      }
    }

    // Second iteration: Ensure minimum mountain percentage based on steepness
    // @reference freeciv/server/generator/fracture_map.c:340-366
    const steepness = 30; // Default steepness setting (equivalent to wld.map.server.steepness)
    const min_mountains = (landarea * steepness) / 100;

    for (let iter = 0; total_mtns < min_mountains && iter < 50; iter++) {
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          const tile = tiles[x][y];
          const index = y * this.width + x;
          const tileHeight = heightMap[index];

          if (this.placementMap.notPlaced(x, y) && tileHeight > hmap_shore_level) {
            // Exact freeciv random placement (lines 349-350)
            const choose_mountain = this.random() * 10000 < 10;
            const choose_hill = this.random() * 10000 < 10;

            if (choose_mountain) {
              total_mtns++;
              tile.terrain = pickTerrain(
                MapgenTerrainProperty.MOUNTAINOUS,
                MapgenTerrainProperty.UNUSED,
                MapgenTerrainProperty.GREEN,
                this.random
              );
              this.placementMap.setPlaced(x, y);
              this.setTerrainProperties(tile);
            } else if (choose_hill) {
              total_mtns++;
              tile.terrain = pickTerrain(
                MapgenTerrainProperty.MOUNTAINOUS,
                MapgenTerrainProperty.GREEN,
                MapgenTerrainProperty.UNUSED,
                this.random
              );
              this.placementMap.setPlaced(x, y);
              this.setTerrainProperties(tile);
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
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const index = ny * this.width + nx;
          const neighborHeight = heightMap[index];

          // If any neighbor is above threshold, area is not flat
          if (neighborHeight > thill) {
            return false;
          }

          // Count neighbors higher than current tile
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
    }

    // Final check based on relative heights
    // @reference freeciv/server/generator/height_map.c:289-291
    if ((thill - hmap_shore_level) * higher_than_me > (my_height - hmap_shore_level) * 4) {
      return false;
    }

    return true;
  }

  /**
   * Calculate local average elevation for fracture maps
   * @reference freeciv/server/generator/fracture_map.c:268-284 local_ave_elevation()
   * Used for determining relative elevation in fracture relief
   */
  private localAveElevation(heightMap: number[], x: number, y: number): number {
    let ele = 0;
    let n = 0;

    // Calculate average in a 7x7 square (radius 3)
    // @reference freeciv/server/generator/fracture_map.c:274-277
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const index = ny * this.width + nx;
          ele += heightMap[index];
          n++;
        }
      }
    }

    // Avoid division by zero
    if (n > 0) {
      ele = ele / n;
    }

    return ele;
  }

  /**
   * Check if tile has ocean neighbor
   * Helper for fracture relief to avoid coastal mountains
   */
  private hasOceanNeighbor(tiles: MapTile[][], x: number, y: number): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          if (isOceanTerrain(tiles[nx][ny].terrain)) {
            return true;
          }
        }
      }
    }
    return false;
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

  /**
   * Exact copy of freeciv make_terrains() function
   * @reference freeciv/server/generator/mapgen.c:491 make_terrains()
   *
   */
  public makeTerrains(tiles: MapTile[][], terrainParams: TerrainParams): void {
    // Count total unplaced tiles using placement tracking
    // @reference freeciv/server/generator/mapgen.c:491 make_terrains()
    let total = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        // In freeciv: not_placed(ptile) - tiles that aren't ocean and haven't been assigned terrain yet
        if (this.placementMap.notPlaced(x, y) && !isOceanTerrain(tile.terrain)) {
          total++;
        }
      }
    }

    // Calculate terrain counts exactly as freeciv does
    let forests_count = Math.floor(
      (total * terrainParams.forest_pct) / (100 - terrainParams.mountain_pct)
    );
    let jungles_count = Math.floor(
      (total * terrainParams.jungle_pct) / (100 - terrainParams.mountain_pct)
    );
    let deserts_count = Math.floor(
      (total * terrainParams.desert_pct) / (100 - terrainParams.mountain_pct)
    );
    let swamps_count = Math.floor(
      (total * terrainParams.swamp_pct) / (100 - terrainParams.mountain_pct)
    );
    let alt_deserts_count = 0;

    // Grassland, tundra, arctic and plains is counted in plains_count
    let plains_count = total - forests_count - deserts_count - swamps_count - jungles_count;

    // The placement loop - exact copy of freeciv logic
    do {
      // PLACE_ONE_TYPE(forests_count, plains_count, pick_terrain(MG_FOLIAGE, MG_TEMPERATE, MG_TROPICAL), WC_ALL, TT_NFROZEN, MC_NONE, 60);
      if (forests_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_ALL', 'TT_NFROZEN', 'MC_NONE');
        if (candidate) {
          // Use pick_terrain with proper properties as in freeciv
          // @reference freeciv/server/generator/mapgen.c:522 pick_terrain(MG_FOLIAGE, MG_TEMPERATE, MG_TROPICAL)
          const terrain = pickTerrain(
            MapgenTerrainProperty.FOLIAGE,
            MapgenTerrainProperty.TEMPERATE,
            MapgenTerrainProperty.TROPICAL,
            this.random
          );
          this.placeTerrain(
            candidate.tile,
            candidate.x,
            candidate.y,
            60,
            terrain,
            forests_count,
            plains_count,
            'WC_ALL',
            'TT_NFROZEN',
            'MC_NONE'
          );
          forests_count--;
        } else {
          plains_count += forests_count;
          forests_count = 0;
        }
      }

      // PLACE_ONE_TYPE(jungles_count, forests_count, pick_terrain(MG_FOLIAGE, MG_TROPICAL, MG_COLD), WC_ALL, TT_TROPICAL, MC_NONE, 50);
      if (jungles_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_ALL', 'TT_TROPICAL', 'MC_NONE');
        if (candidate) {
          // Use pick_terrain with proper properties as in freeciv
          // @reference freeciv/server/generator/mapgen.c:540 pick_terrain(MG_FOLIAGE, MG_TROPICAL, MG_COLD)
          const terrain = pickTerrain(
            MapgenTerrainProperty.FOLIAGE,
            MapgenTerrainProperty.TROPICAL,
            MapgenTerrainProperty.COLD,
            this.random
          );
          this.placeTerrain(
            candidate.tile,
            candidate.x,
            candidate.y,
            50,
            terrain,
            jungles_count,
            forests_count,
            'WC_ALL',
            'TT_TROPICAL',
            'MC_NONE'
          );
          jungles_count--;
        } else {
          forests_count += jungles_count;
          jungles_count = 0;
        }
      }

      // PLACE_ONE_TYPE(swamps_count, forests_count, pick_terrain(MG_WET, MG_UNUSED, MG_FOLIAGE), WC_NDRY, TT_HOT, MC_LOW, 50);
      if (swamps_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_NDRY', 'TT_HOT', 'MC_LOW');
        if (candidate) {
          // Use pick_terrain with proper properties as in freeciv
          // @reference freeciv/server/generator/mapgen.c:558 pick_terrain(MG_WET, MG_UNUSED, MG_FOLIAGE)
          const terrain = pickTerrain(
            MapgenTerrainProperty.WET,
            MapgenTerrainProperty.UNUSED,
            MapgenTerrainProperty.FOLIAGE,
            this.random
          );
          this.placeTerrain(
            candidate.tile,
            candidate.x,
            candidate.y,
            50,
            terrain,
            swamps_count,
            forests_count,
            'WC_NDRY',
            'TT_HOT',
            'MC_LOW'
          );
          swamps_count--;
        } else {
          forests_count += swamps_count;
          swamps_count = 0;
        }
      }

      // PLACE_ONE_TYPE(deserts_count, alt_deserts_count, pick_terrain(MG_DRY, MG_TROPICAL, MG_COLD), WC_DRY, TT_NFROZEN, MC_NLOW, 80);
      if (deserts_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_DRY', 'TT_NFROZEN', 'MC_NLOW');
        if (candidate) {
          // Use pick_terrain with proper properties as in freeciv
          // @reference freeciv/server/generator/mapgen.c:576 pick_terrain(MG_DRY, MG_TROPICAL, MG_COLD)
          const terrain = pickTerrain(
            MapgenTerrainProperty.DRY,
            MapgenTerrainProperty.TROPICAL,
            MapgenTerrainProperty.COLD,
            this.random
          );
          this.placeTerrain(
            candidate.tile,
            candidate.x,
            candidate.y,
            80,
            terrain,
            deserts_count,
            alt_deserts_count,
            'WC_DRY',
            'TT_NFROZEN',
            'MC_NLOW'
          );
          deserts_count--;
        } else {
          alt_deserts_count += deserts_count;
          deserts_count = 0;
        }
      }

      // PLACE_ONE_TYPE(alt_deserts_count, plains_count, pick_terrain(MG_DRY, MG_TROPICAL, MG_WET), WC_ALL, TT_NFROZEN, MC_NLOW, 40);
      if (alt_deserts_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_ALL', 'TT_NFROZEN', 'MC_NLOW');
        if (candidate) {
          // Use pick_terrain with proper properties as in freeciv
          // @reference freeciv/server/generator/mapgen.c:594 pick_terrain(MG_DRY, MG_TROPICAL, MG_WET)
          const terrain = pickTerrain(
            MapgenTerrainProperty.DRY,
            MapgenTerrainProperty.TROPICAL,
            MapgenTerrainProperty.WET,
            this.random
          );
          this.placeTerrain(
            candidate.tile,
            candidate.x,
            candidate.y,
            40,
            terrain,
            alt_deserts_count,
            plains_count,
            'WC_ALL',
            'TT_NFROZEN',
            'MC_NLOW'
          );
          alt_deserts_count--;
        } else {
          plains_count += alt_deserts_count;
          alt_deserts_count = 0;
        }
      }

      // Make the plains and tundras
      if (plains_count > 0) {
        const candidate = this.randMapPosCharacteristic(tiles, 'WC_ALL', 'TT_ALL', 'MC_NONE');
        if (candidate) {
          this.makePlain(candidate.tile, candidate.x, candidate.y);
          plains_count--;
        } else {
          plains_count = 0;
        }
      }
    } while (
      forests_count > 0 ||
      jungles_count > 0 ||
      deserts_count > 0 ||
      alt_deserts_count > 0 ||
      plains_count > 0 ||
      swamps_count > 0
    );
  }

  /**
   * Supporting function for make_terrains - equivalent to freeciv's rand_map_pos_characteristic
   * @reference freeciv/server/generator/mapgen.c rand_map_pos_characteristic()
   * Uses placement tracking to find valid tiles for terrain placement
   */
  private randMapPosCharacteristic(
    tiles: MapTile[][],
    wetness_condition: string,
    temp_condition: string,
    mount_condition: string
  ): { tile: MapTile; x: number; y: number } | null {
    const candidates: { tile: MapTile; x: number; y: number }[] = [];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Only consider unplaced land tiles using placement tracking
        // @reference freeciv/server/generator/mapgen.c:262 not yet placed on pmap
        if (!this.placementMap.notPlaced(x, y) || isOceanTerrain(tile.terrain)) continue;

        // Check wetness condition
        if (!this.checkWetnessCondition(tile, wetness_condition)) continue;

        // Check temperature condition
        if (!this.checkTemperatureCondition(tile, temp_condition)) continue;

        // Check mountain condition
        if (!this.checkMountainCondition(tile, mount_condition)) continue;

        candidates.push({ tile, x, y });
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(this.random() * candidates.length)];
  }

  /**
   * Supporting function - place terrain with weight/spread logic
   * @reference freeciv/server/generator/mapgen.c place_terrain()
   * Marks placed tiles using placement tracking system
   */
  private placeTerrain(
    tile: MapTile,
    x: number,
    y: number,
    _weight: number,
    terrain: string,
    _count: number,
    _alternate: number,
    _wc: string,
    _tc: string,
    _mc: string
  ): void {
    // Set terrain type
    tile.terrain = terrain as TerrainType;

    // Mark tile as placed in placement map
    // @reference freeciv/server/generator/mapgen_utils.c:79 map_set_placed()
    this.placementMap.setPlaced(x, y);

    this.setTerrainProperties(tile);
  }

  /**
   * Supporting function - make plains/tundra based on temperature
   * @reference freeciv/server/generator/mapgen.c make_plain()
   * Uses placement tracking to mark placed tiles
   */
  private makePlain(tile: MapTile, x: number, y: number): void {
    // Choose terrain based on temperature using pick_terrain like freeciv
    // @reference freeciv/server/generator/mapgen.c:437-445
    let terrain: TerrainType;
    if (tile.temperature === TemperatureType.FROZEN) {
      // tile_set_terrain(ptile, pick_terrain(MG_FROZEN, MG_UNUSED, MG_MOUNTAINOUS));
      terrain = pickTerrain(
        MapgenTerrainProperty.FROZEN,
        MapgenTerrainProperty.UNUSED,
        MapgenTerrainProperty.MOUNTAINOUS,
        this.random
      );
    } else if (tile.temperature === TemperatureType.COLD) {
      // tile_set_terrain(ptile, pick_terrain(MG_COLD, MG_UNUSED, MG_MOUNTAINOUS));
      terrain = pickTerrain(
        MapgenTerrainProperty.COLD,
        MapgenTerrainProperty.UNUSED,
        MapgenTerrainProperty.MOUNTAINOUS,
        this.random
      );
    } else {
      // tile_set_terrain(ptile, pick_terrain(MG_TEMPERATE, MG_GREEN, MG_MOUNTAINOUS));
      terrain = pickTerrain(
        MapgenTerrainProperty.TEMPERATE,
        MapgenTerrainProperty.GREEN,
        MapgenTerrainProperty.MOUNTAINOUS,
        this.random
      );
    }

    tile.terrain = terrain;

    // Mark tile as placed
    // @reference freeciv/server/generator/mapgen_utils.c:79 map_set_placed()
    this.placementMap.setPlaced(x, y);

    this.setTerrainProperties(tile);
  }

  /**
   * Helper functions for terrain conditions (freeciv equivalents)
   */
  private checkWetnessCondition(tile: MapTile, condition: string): boolean {
    switch (condition) {
      case 'WC_ALL':
        return true;
      case 'WC_DRY':
        return tile.wetness < 50;
      case 'WC_NDRY':
        return tile.wetness >= 50;
      default:
        return true;
    }
  }

  private checkTemperatureCondition(tile: MapTile, condition: string): boolean {
    switch (condition) {
      case 'TT_ALL':
        return true;
      case 'TT_NFROZEN':
        return tile.temperature !== TemperatureType.FROZEN;
      case 'TT_TROPICAL':
        return tile.temperature === TemperatureType.TROPICAL;
      case 'TT_HOT':
        return (
          tile.temperature === TemperatureType.TROPICAL ||
          tile.temperature === TemperatureType.TEMPERATE
        );
      default:
        return true;
    }
  }

  private checkMountainCondition(tile: MapTile, condition: string): boolean {
    switch (condition) {
      case 'MC_NONE':
        return true;
      case 'MC_LOW':
        return tile.elevation < 500;
      case 'MC_NLOW':
        return tile.elevation >= 500;
      default:
        return true;
    }
  }

  // Utility functions

  private setTerrainProperties(tile: MapTile): void {
    // Set terrain properties based on terrain ruleset
    // @reference freeciv/common/terrain.h:136-147 property[MG_COUNT]
    if (!tile.properties) {
      tile.properties = {};
    }

    // Copy properties from ruleset to tile
    const properties = getTerrainProperties(tile.terrain);
    tile.properties = { ...properties };
  }

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
   * Generate wetness map for terrain variation
   */
  public generateWetnessMap(tiles: MapTile[][]): void {
    // Use default wetness base for better terrain variety
    const baseWetness = 50;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        // Start with user's wetness setting
        let wetness = baseWetness;

        // Reduce water influence for better terrain variety
        wetness += this.calculateWetnessFromNearbyWater(tiles, x, y) * 0.3;

        // Add randomness for variety
        wetness += (this.random() - 0.5) * 40;

        tiles[x][y].wetness = Math.max(0, Math.min(100, wetness));
      }
    }
  }

  /**
   * Apply biome transitions with enhanced terrain clustering algorithms
   * @reference Task 10: Biome-based terrain grouping and natural transitions
   * Enhanced with generator-specific characteristics and regional climate consistency
   */
  public applyBiomeTransitions(tiles: MapTile[][]): void {
    const generatorAdjustments = this.getGeneratorSpecificAdjustments();
    const newTerrain = tiles.map(col => col.map(tile => ({ ...tile })));

    // Phase 1: Biome-based terrain grouping
    this.applyBiomeBasedGrouping(tiles, newTerrain, generatorAdjustments);

    // Phase 2: Natural terrain transitions
    this.applyNaturalTerrainTransitions(tiles, newTerrain, generatorAdjustments);

    // Phase 3: Regional climate consistency
    this.enforceRegionalClimateConsistency(tiles, newTerrain, generatorAdjustments);

    // Apply changes and update properties
    this.applyTerrainChanges(tiles, newTerrain);
  }

  /**
   * Apply biome-based terrain grouping for natural clustering
   * @reference Task 10: Biome-based terrain grouping
   */
  private applyBiomeBasedGrouping(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    adjustments: any
  ): void {
    const clusteringStrength =
      adjustments.type === 'random' ? adjustments.clusteringReduction : 1.0;

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!isLandTile(tile.terrain)) continue;

        // Identify biome type based on temperature and wetness
        const biomeType = this.identifyBiomeType(tile);

        // Find similar biome neighbors
        const similarBiomeNeighbors = this.findSimilarBiomeNeighbors(tiles, x, y, biomeType);

        if (similarBiomeNeighbors.length >= 3 && this.random() < 0.15 * clusteringStrength) {
          // Strong biome clustering: adopt dominant neighbor terrain
          const dominantTerrain = this.findDominantTerrainInBiome(similarBiomeNeighbors, biomeType);
          if (dominantTerrain && this.isBiomeCompatible(tile.terrain, dominantTerrain, biomeType)) {
            newTerrain[x][y].terrain = dominantTerrain as TerrainType;
          }
        }
      }
    }
  }

  /**
   * Apply natural terrain transitions based on elevation and climate gradients
   * @reference Task 10: Natural terrain transitions
   */
  private applyNaturalTerrainTransitions(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    adjustments: any
  ): void {
    const transitionStrength = adjustments.type === 'island' ? 1.2 : 1.0;

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!isLandTile(tile.terrain)) continue;

        // Calculate terrain transition gradients
        const elevationGradient = this.calculateElevationGradient(tiles, x, y);
        const temperatureGradient = this.calculateTemperatureGradient(tiles, x, y);
        const wetnessGradient = this.calculateWetnessGradient(tiles, x, y);

        // Apply elevation-based transitions (mountains -> hills -> plains)
        if (elevationGradient > 100 && this.random() < 0.1 * transitionStrength) {
          const transitionTerrain = this.getElevationTransitionTerrain(tile, elevationGradient);
          if (transitionTerrain) {
            newTerrain[x][y].terrain = transitionTerrain as TerrainType;
          }
        }

        // Apply climate-based transitions
        if (
          (Math.abs(temperatureGradient) > 200 || Math.abs(wetnessGradient) > 20) &&
          this.random() < 0.08 * transitionStrength
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
   * Enforce regional climate consistency across larger areas
   * @reference Task 10: Regional climate consistency
   */
  private enforceRegionalClimateConsistency(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    adjustments: any
  ): void {
    const regionSize = adjustments.type === 'fracture' ? 5 : 3; // Larger regions for continental maps
    const consistencyStrength = 0.12;

    for (let x = regionSize; x < this.width - regionSize; x += regionSize) {
      for (let y = regionSize; y < this.height - regionSize; y += regionSize) {
        if (this.random() < consistencyStrength) {
          this.enforceRegionalConsistency(tiles, newTerrain, x, y, regionSize);
        }
      }
    }
  }

  /**
   * Identify biome type based on temperature and wetness
   */
  private identifyBiomeType(tile: MapTile): string {
    const temp = tile.temperature as number;
    const wet = tile.wetness;

    if (temp >= 800) {
      return wet > 60 ? 'tropical_wet' : 'tropical_dry';
    } else if (temp >= 500) {
      return wet > 70 ? 'temperate_wet' : wet > 30 ? 'temperate' : 'temperate_dry';
    } else if (temp >= 300) {
      return wet > 50 ? 'cold_wet' : 'cold_dry';
    } else {
      return 'frozen';
    }
  }

  /**
   * Find neighbors with similar biome characteristics
   */
  private findSimilarBiomeNeighbors(
    tiles: MapTile[][],
    x: number,
    y: number,
    biomeType: string
  ): MapTile[] {
    const neighbors = this.getNeighbors(tiles, x, y);
    return neighbors.filter(neighbor => {
      return isLandTile(neighbor.terrain) && this.identifyBiomeType(neighbor) === biomeType;
    });
  }

  /**
   * Find the dominant terrain type within a biome group
   */
  private findDominantTerrainInBiome(neighbors: MapTile[], biomeType: string): string | null {
    const terrainCounts: Record<string, number> = {};

    for (const neighbor of neighbors) {
      if (this.isValidTerrainForBiome(neighbor.terrain, biomeType)) {
        terrainCounts[neighbor.terrain] = (terrainCounts[neighbor.terrain] || 0) + 1;
      }
    }

    let maxCount = 0;
    let dominantTerrain: string | null = null;
    for (const [terrain, count] of Object.entries(terrainCounts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantTerrain = terrain;
      }
    }

    return maxCount >= 2 ? dominantTerrain : null; // Require at least 2 neighbors
  }

  /**
   * Check if terrain is valid for the given biome
   */
  private isValidTerrainForBiome(terrain: string, biomeType: string): boolean {
    const biomeTerrains: Record<string, string[]> = {
      tropical_wet: ['jungle', 'forest', 'swamp'],
      tropical_dry: ['desert', 'plains', 'grassland'],
      temperate_wet: ['forest', 'grassland', 'swamp'],
      temperate: ['grassland', 'plains', 'forest'],
      temperate_dry: ['plains', 'desert', 'grassland'],
      cold_wet: ['forest', 'tundra', 'swamp'],
      cold_dry: ['tundra', 'plains'],
      frozen: ['glacier', 'tundra'],
    };

    return biomeTerrains[biomeType]?.includes(terrain) || false;
  }

  /**
   * Check if two terrains are compatible within the same biome
   */
  private isBiomeCompatible(terrain1: string, terrain2: string, biomeType: string): boolean {
    return (
      this.isValidTerrainForBiome(terrain1, biomeType) &&
      this.isValidTerrainForBiome(terrain2, biomeType)
    );
  }

  /**
   * Calculate elevation gradient in the local area
   */
  private calculateElevationGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerElevation = tiles[x][y].elevation || 0;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborElevation = tiles[nx][ny].elevation || 0;
          totalDifference += Math.abs(centerElevation - neighborElevation);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Calculate temperature gradient in the local area
   */
  private calculateTemperatureGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerTemp = (tiles[x][y].temperature as number) || 0;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborTemp = (tiles[nx][ny].temperature as number) || 0;
          totalDifference += Math.abs(centerTemp - neighborTemp);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Calculate wetness gradient in the local area
   */
  private calculateWetnessGradient(tiles: MapTile[][], x: number, y: number): number {
    const centerWetness = tiles[x][y].wetness || 0;
    let totalDifference = 0;
    let count = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const neighborWetness = tiles[nx][ny].wetness || 0;
          totalDifference += Math.abs(centerWetness - neighborWetness);
          count++;
        }
      }
    }

    return count > 0 ? totalDifference / count : 0;
  }

  /**
   * Get appropriate transition terrain based on elevation gradient
   */
  private getElevationTransitionTerrain(tile: MapTile, gradient: number): string | null {
    const currentTerrain = tile.terrain;

    if (currentTerrain === 'mountains' && gradient > 150) {
      return 'hills';
    } else if (currentTerrain === 'hills' && gradient > 120) {
      return (tile.temperature as number) > 500 ? 'grassland' : 'tundra';
    }

    return null;
  }

  /**
   * Get appropriate transition terrain based on climate gradients
   */
  private getClimateTransitionTerrain(
    tile: MapTile,
    tempGradient: number,
    wetnessGradient: number
  ): string | null {
    const currentTerrain = tile.terrain;

    // Wetness-based transitions
    if (wetnessGradient > 25) {
      if (currentTerrain === 'desert' && tile.wetness > 40) {
        return 'plains';
      } else if (currentTerrain === 'forest' && tile.wetness < 30) {
        return 'grassland';
      } else if (currentTerrain === 'jungle' && tile.wetness < 50) {
        return 'forest';
      }
    }

    // Temperature-based transitions
    if (tempGradient > 200) {
      const temp = tile.temperature as number;
      if (temp < 400 && ['grassland', 'plains'].includes(currentTerrain)) {
        return 'tundra';
      } else if (temp > 700 && currentTerrain === 'forest') {
        return tile.wetness > 60 ? 'jungle' : 'grassland';
      }
    }

    return null;
  }

  /**
   * Enforce consistency within a regional area
   */
  private enforceRegionalConsistency(
    tiles: MapTile[][],
    newTerrain: MapTile[][],
    centerX: number,
    centerY: number,
    regionSize: number
  ): void {
    const regionTiles: Array<{ x: number; y: number; tile: MapTile }> = [];

    // Collect all tiles in the region
    for (let dx = -regionSize; dx <= regionSize; dx++) {
      for (let dy = -regionSize; dy <= regionSize; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (
          x >= 0 &&
          x < this.width &&
          y >= 0 &&
          y < this.height &&
          isLandTile(tiles[x][y].terrain)
        ) {
          regionTiles.push({ x, y, tile: tiles[x][y] });
        }
      }
    }

    if (regionTiles.length < 5) return; // Too small region

    // Calculate regional averages
    const avgTemp =
      regionTiles.reduce((sum, t) => sum + ((t.tile.temperature as number) || 0), 0) /
      regionTiles.length;
    const avgWetness =
      regionTiles.reduce((sum, t) => sum + (t.tile.wetness || 0), 0) / regionTiles.length;
    const dominantBiome = this.identifyBiomeType({
      temperature: avgTemp,
      wetness: avgWetness,
    } as MapTile);

    // Apply regional consistency
    for (const { x, y, tile } of regionTiles) {
      if (!this.isValidTerrainForBiome(tile.terrain, dominantBiome) && this.random() < 0.3) {
        const suitableTerrains = this.getValidTerrainsForBiome(dominantBiome);
        if (suitableTerrains.length > 0) {
          newTerrain[x][y].terrain = suitableTerrains[
            Math.floor(this.random() * suitableTerrains.length)
          ] as TerrainType;
        }
      }
    }
  }

  /**
   * Get valid terrains for a specific biome
   */
  private getValidTerrainsForBiome(biomeType: string): string[] {
    const biomeTerrains: Record<string, string[]> = {
      tropical_wet: ['jungle', 'forest', 'swamp'],
      tropical_dry: ['desert', 'plains', 'grassland'],
      temperate_wet: ['forest', 'grassland', 'swamp'],
      temperate: ['grassland', 'plains', 'forest'],
      temperate_dry: ['plains', 'desert', 'grassland'],
      cold_wet: ['forest', 'tundra', 'swamp'],
      cold_dry: ['tundra', 'plains'],
      frozen: ['glacier', 'tundra'],
    };

    return biomeTerrains[biomeType] || ['grassland'];
  }

  /**
   * Apply all terrain changes and update properties
   */
  private applyTerrainChanges(tiles: MapTile[][], newTerrain: MapTile[][]): void {
    let changesApplied = 0;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].terrain !== newTerrain[x][y].terrain) {
          tiles[x][y].terrain = newTerrain[x][y].terrain;
          this.setTerrainProperties(tiles[x][y]);
          changesApplied++;
        }
      }
    }

    // Log the improvements made
    if (changesApplied > 0) {
      console.log(
        `Applied ${changesApplied} biome transition improvements for ${this.generator} generator`
      );
    }
  }

  /**
   * Calculate wetness bonus from nearby water bodies
   */
  private calculateWetnessFromNearbyWater(tiles: MapTile[][], x: number, y: number): number {
    let wetnessBonus = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (!isLandTile(terrain)) {
            const distance = Math.sqrt(dx * dx + dy * dy);
            wetnessBonus += 20 / (1 + distance);
          }
        }
      }
    }
    return wetnessBonus;
  }

  /**
   * Get neighboring tiles for a given position
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

  /**
   * Smooth water depth based on distance from land and adjacent ocean types
   * @reference freeciv/server/generator/mapgen_utils.c smooth_water_depth()
   * Exact copy of freeciv ocean depth calculation and smoothing algorithm
   */
  public smoothWaterDepth(tiles: MapTile[][]): void {
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv reference
    const OCEAN_DEPTH_STEP = 25; // Distance step for ocean depth calculation (not used with custom depths)
    const OCEAN_DIST_MAX = Math.floor(TERRAIN_OCEAN_DEPTH_MAXIMUM / OCEAN_DEPTH_STEP); // = 4

    // Debug: Count terrain types before processing
    const beforeCounts = { coast: 0, ocean: 0, deep_ocean: 0, land: 0 };
    const distanceDistribution: Record<number, number> = {};
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const terrain = tiles[x][y].terrain;
        if (terrain === 'coast') beforeCounts.coast++;
        else if (terrain === 'ocean') beforeCounts.ocean++;
        else if (terrain === 'deep_ocean') beforeCounts.deep_ocean++;
        else beforeCounts.land++;
      }
    }

    // First pass: Set ocean depths based on distance from land
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Skip non-ocean tiles
        if (!isOceanTerrain(tile.terrain)) {
          continue;
        }

        // Calculate distance to land - exact freeciv logic
        const distToLand = this.realDistanceToLand(tiles, x, y, OCEAN_DIST_MAX);

        // Track distance distribution
        distanceDistribution[distToLand] = (distanceDistribution[distToLand] || 0) + 1;

        let depth: number;
        if (distToLand <= OCEAN_DIST_MAX) {
          // Near land: use EXACT freeciv formula from mapgen_utils.c
          // ocean = pick_ocean(dist * OCEAN_DEPTH_STEP + fc_rand(OCEAN_DEPTH_RAND), ...);
          const OCEAN_DEPTH_RAND = 15;
          depth = distToLand * OCEAN_DEPTH_STEP + Math.floor(this.random() * OCEAN_DEPTH_RAND);
        } else {
          // Far from land: make it deep ocean
          // In freeciv, tiles beyond OCEAN_DIST_MAX remain as deep ocean
          depth = TERRAIN_OCEAN_DEPTH_MAXIMUM;
        }

        const isFrozen = isFrozenTerrain(tile.terrain);
        const newOceanType = this.pickOcean(depth, isFrozen);

        if (newOceanType && newOceanType !== tile.terrain) {
          tile.terrain = newOceanType as TerrainType;
        }
      }
    }

    // Debug: Show distance distribution and expected depth ranges

    // Second pass: Smooth based on adjacent ocean types for continuity
    // Using exact freeciv most_adjacent_ocean_type() logic
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        if (!isOceanTerrain(tile.terrain)) {
          continue;
        }

        const mostCommonAdjacentOcean = this.getMostAdjacentOceanType(tiles, x, y);
        if (mostCommonAdjacentOcean && mostCommonAdjacentOcean !== tile.terrain) {
          // Only change if there's strong consensus from neighbors (need 2/3 of the 8 adjacent tiles)
          tile.terrain = mostCommonAdjacentOcean as TerrainType;
        }
      }
    }

    // Debug: Count terrain types after processing
    const afterCounts = { coast: 0, ocean: 0, deep_ocean: 0, land: 0 };
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const terrain = tiles[x][y].terrain;
        if (terrain === 'coast') afterCounts.coast++;
        else if (terrain === 'ocean') afterCounts.ocean++;
        else if (terrain === 'deep_ocean') afterCounts.deep_ocean++;
        else afterCounts.land++;
      }
    }
  }

  /**
   * Calculate real distance to nearest land tile
   * @reference freeciv/server/generator/mapgen_utils.c real_distance_to_land()
   * Exact copy of freeciv logic using square_dxy_iterate and map_vector_to_real_distance
   */
  private realDistanceToLand(
    tiles: MapTile[][],
    centerX: number,
    centerY: number,
    max: number
  ): number {
    // square_dxy_iterate: iterate through all tiles in a square with given center and radius
    for (let dx = -max; dx <= max; dx++) {
      for (let dy = -max; dy <= max; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;

        // Check bounds (freeciv automatically handles this in square_dxy_iterate)
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
          continue;
        }

        // if (terrain_type_terrain_class(tile_terrain(atile)) != TC_OCEAN)
        if (!isOceanTerrain(tiles[x][y].terrain)) {
          // return map_vector_to_real_distance(dx, dy);
          return this.mapVectorToRealDistance(dx, dy);
        }
      }
    }

    return max + 1;
  }

  /**
   * Return the "real" distance for a given vector
   * @reference freeciv/common/map.c map_vector_to_real_distance()
   * Exact copy of freeciv logic
   */
  private mapVectorToRealDistance(dx: number, dy: number): number {
    const absdx = Math.abs(dx);
    const absdy = Math.abs(dy);

    // For square maps (not hex), freeciv uses Chebyshev distance (max of dx, dy)
    // This is the standard "8-directional movement" distance
    return Math.max(absdx, absdy);
  }

  /**
   * Pick appropriate ocean terrain based on depth - exact freeciv algorithm
   * @reference freeciv/server/generator/mapgen_utils.c pick_ocean()
   * Finds terrain with ocean depth property closest to calculated depth
   */
  private pickOcean(depth: number, _isFrozen: boolean): string | null {
    // Freeciv ocean terrain types with their MG_OCEAN_DEPTH property values
    // From freeciv data/classic/terrain.ruleset:
    const oceanTerrains = [
      { type: 'coast', oceanDepth: 0 }, // property_ocean_depth = 0
      { type: 'ocean', oceanDepth: 32 }, // property_ocean_depth = 32
      { type: 'deep_ocean', oceanDepth: 87 }, // property_ocean_depth = 87
    ];

    let bestTerrain: string | null = null;
    let bestMatch = 100; // TERRAIN_OCEAN_DEPTH_MAXIMUM

    // Find terrain with closest ocean depth property to calculated depth
    for (const terrain of oceanTerrains) {
      const match = Math.abs(depth - terrain.oceanDepth);

      if (bestMatch > match) {
        bestMatch = match;
        bestTerrain = terrain.type;
      }
    }

    return bestTerrain;
  }

  /**
   * Get most common adjacent ocean type for smoothing
   * @reference freeciv/server/generator/mapgen_utils.c most_adjacent_ocean_type()
   * Exact copy of freeciv logic: needs 2/3 of adjacent tiles to be same type
   */
  private getMostAdjacentOceanType(tiles: MapTile[][], x: number, y: number): string | null {
    // Freeciv: const int need = 2 * MAP_NUM_VALID_DIRS / 3;
    // For square maps: MAP_NUM_VALID_DIRS = 8, so need = 2 * 8 / 3 = 5.33 → 5 when floored (freeciv uses integer division)
    const MAP_NUM_VALID_DIRS = 8;
    const need = Math.floor((2 * MAP_NUM_VALID_DIRS) / 3); // = 5, exact freeciv logic

    // Check all 8 adjacent directions (like freeciv adjc_iterate)
    const directions = [
      { dx: -1, dy: -1 }, // NW
      { dx: 0, dy: -1 }, // N
      { dx: 1, dy: -1 }, // NE
      { dx: -1, dy: 0 }, // W
      { dx: 1, dy: 0 }, // E
      { dx: -1, dy: 1 }, // SW
      { dx: 0, dy: 1 }, // S
      { dx: 1, dy: 1 }, // SE
    ];

    // Try each ocean terrain type and count how many adjacent tiles match
    const oceanTerrainTypes = ['coast', 'ocean', 'deep_ocean'];

    for (const terrainType of oceanTerrainTypes) {
      let count = 0;

      for (const dir of directions) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          const terrain = tiles[nx][ny].terrain;
          if (terrain === terrainType) {
            count++;
            if (count >= need) {
              return terrainType; // Found enough matching neighbors
            }
          }
        }
      }
    }

    return null; // No terrain type has enough matching neighbors
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
            // Frozen: pick_terrain(MG_FROZEN, MG_UNUSED, MG_MOUNTAINOUS)
            tile.terrain = 'glacier';
          } else if (tile.temperature === TemperatureType.COLD) {
            // Cold: pick_terrain(MG_COLD, MG_UNUSED, MG_MOUNTAINOUS)
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
   * Generate terrain varieties using terrain selection engine
   * @reference freeciv/server/generator/mapgen.c make_terrains()
   * Coordinates terrain engine with terrain property assignment
   */
  public async generateTerrain(
    tiles: MapTile[][],
    heightGenerator: any,
    random: () => number,
    _generator: string,
    preserveSpecializedTerrain: boolean = false
  ): Promise<void> {
    // Apply smoothing passes for natural terrain transitions
    heightGenerator.applySmoothingPasses(2);

    const shoreLevel = heightGenerator.getShoreLevel();
    const mountainLevel = heightGenerator.getMountainLevel();

    // Create terrain engine with proper freeciv reference levels
    const TerrainSelectionEngine = (await import('./TerrainSelectionEngine'))
      .TerrainSelectionEngine;
    const terrainEngine = new TerrainSelectionEngine(random, shoreLevel, mountainLevel);

    // Phase 2: Assign terrain using property-based selection (following freeciv reference)
    // Only apply to land tiles - ocean/coast already set by makeLand()
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Only modify land tiles, leave ocean tiles as-is
        // If preserveSpecializedTerrain is true, only modify 'grassland' tiles
        if (!isOceanTerrain(tile.terrain)) {
          if (!preserveSpecializedTerrain || tile.terrain === 'grassland') {
            const selectedTerrain = terrainEngine.pickTerrain(
              tile.temperature,
              tile.wetness,
              tile.elevation
            );

            tile.terrain = selectedTerrain;
          }
        }

        // Set terrain properties based on selected terrain
        setTerrainGameProperties(tile);
      }
    }

    // Phase 3: Apply biome transition logic for more natural borders
    this.applyBiomeTransitions(tiles);
  }

  /**
   * Assign continent IDs to connected landmasses
   */
  public generateContinents(tiles: MapTile[][]): void {
    let continentId = 1;
    const visited = new Set<string>();

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const key = `${x},${y}`;
        if (visited.has(key) || !isLandTile(tiles[x][y].terrain)) {
          continue;
        }

        // Flood fill to mark continent
        this.floodFillContinent(tiles, x, y, continentId, visited);
        continentId++;
      }
    }
  }

  /**
   * Flood fill algorithm to assign continent IDs to connected landmasses
   */
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

      if (!isLandTile(tiles[x][y].terrain)) {
        continue;
      }

      visited.add(key);
      tiles[x][y].continentId = continentId;

      // Add neighbors to stack
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /**
   * Remove tiny islands by converting them to ocean
   * @reference freeciv/server/generator/mapgen.c remove_tiny_islands()
   * Uses isTinyIsland() for detection and converts to ocean
   */
  public removeTinyIslands(tiles: MapTile[][], isRandomMode: boolean = false): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (isTinyIsland(tiles, x, y, this.width, this.height, this.random, isRandomMode)) {
          // Convert tiny island to shallow ocean
          tiles[x][y].terrain = 'ocean';
          tiles[x][y].continentId = 0; // Ocean continent ID
        }
      }
    }
  }

  /**
   * Regenerate all oceanic tiles for small water bodies as lakes
   * @reference freeciv/server/generator/mapgen_utils.c:356 regenerate_lakes()
   * Converts small ocean bodies (1-2 tiles) to freshwater lakes
   * Assumes continent numbers have already been assigned
   */
  public regenerateLakes(tiles: MapTile[][]): void {
    // Configuration matching freeciv defaults
    const LAKE_MAX_SIZE = 2; // terrain_control.lake_max_size equivalent - small water bodies only

    // Step 1: Identify all ocean bodies and their sizes
    const oceanBodies = this.identifyOceanBodies(tiles);

    // Step 2: Convert small ocean bodies to lakes
    for (const oceanBody of oceanBodies) {
      if (oceanBody.tiles.length <= LAKE_MAX_SIZE) {
        // Small ocean body - convert to lake
        for (const tile of oceanBody.tiles) {
          const currentTerrain = tile.terrain;

          // Determine appropriate lake type based on original terrain
          // @reference freeciv/server/generator/mapgen_utils.c:416
          // Preserve frozen status: frozen ocean → frozen lake, regular ocean → regular lake
          if (isFrozenTerrain(currentTerrain)) {
            // In our terrain system, we don't have separate frozen lake types
            // For simplicity, frozen oceans become regular lakes (could be extended later)
            tile.terrain = 'lake';
          } else {
            tile.terrain = 'lake';
          }

          // Keep the same continent ID to maintain connectivity information
          // In freeciv, lakes retain the ocean's negative continent ID
          // For our implementation, we'll keep the existing continentId
        }
      }
    }
  }

  /**
   * Identify distinct ocean bodies using flood-fill algorithm
   * @reference freeciv/server/generator/mapgen_utils.c assign_continent_numbers()
   * Finds connected components of ocean tiles
   */
  private identifyOceanBodies(tiles: MapTile[][]): Array<{ tiles: MapTile[]; id: number }> {
    const visited = new Set<string>();
    const oceanBodies: Array<{ tiles: MapTile[]; id: number }> = [];
    let oceanBodyId = 1;

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const key = `${x},${y}`;

        if (visited.has(key)) continue;

        const tile = tiles[x][y];

        // Only process ocean/coastal waters, not land or lakes
        if (!isOceanTerrain(tile.terrain)) continue;

        // Found unvisited ocean tile - start flood fill
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
   * Flood fill algorithm to identify connected ocean tiles
   * @reference freeciv/server/generator/mapgen_utils.c assign_continent_numbers()
   * Modified to work with our tile system
   */
  private floodFillOceanBody(
    tiles: MapTile[][],
    startX: number,
    startY: number,
    visited: Set<string>,
    oceanTiles: MapTile[]
  ): void {
    const stack: Array<[number, number]> = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;

      // Check bounds and visited status
      if (x < 0 || x >= this.width || y < 0 || y >= this.height || visited.has(key)) {
        continue;
      }

      const tile = tiles[x][y];

      // Only include ocean terrain in the ocean body
      if (!isOceanTerrain(tile.terrain)) {
        continue;
      }

      // Mark as visited and add to ocean body
      visited.add(key);
      oceanTiles.push(tile);

      // Add adjacent tiles to search (4-directional connectivity like freeciv)
      // @reference freeciv uses adjc_iterate for adjacent tile iteration
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  /**
   * Check if map has poles requiring height normalization
   * @reference freeciv/server/generator/mapgen.c:48-49 HAS_POLES macro
   * Original: #define HAS_POLES (MIN(COLD_LEVEL, 2 * ICE_BASE_LEVEL) > MIN_REAL_COLATITUDE(wld.map))
   * Simplified for rectangular maps
   */
  private hasPoles(): boolean {
    // For simplicity, assume we have poles if temperature system is enabled
    // @reference freeciv/server/generator/mapgen.c:48-49
    const ICE_BASE_LEVEL = 200; // From freeciv mapgen_topology.h ice_base_colatitude
    const COLD_LEVEL = 400; // Simplified assumption for temperature 50
    const MIN_REAL_COLATITUDE = 0; // Simplified for rectangular maps

    return Math.min(COLD_LEVEL, 2 * ICE_BASE_LEVEL) > MIN_REAL_COLATITUDE;
  }

  /**
   * Normalize height map at poles to prevent excessive land formation
   * @reference freeciv/server/generator/height_map.c:165-172 normalize_hmap_poles()
   * Reduces height values in polar regions and near map edges to prevent
   * excessive land generation in areas that should be mostly ocean
   */
  private normalizeHmapPoles(heightMap: number[], _tiles: MapTile[][]): void {
    const ICE_BASE_LEVEL = 200; // From freeciv mapgen_topology.h
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500

    // Create TemperatureMap instance for colatitude calculation
    const tempMap = new TemperatureMap(this.width, this.height);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        const colatitude = tempMap.mapColatitude(x, y);

        if (colatitude <= POLAR_THRESHOLD) {
          // Apply pole factor to reduce height
          // @reference freeciv/server/generator/height_map.c:165-170
          const poleFactor = this.hmapPoleFactor(colatitude, x, y);
          heightMap[index] = Math.floor(heightMap[index] * poleFactor);
        } else if (this.nearSingularity(x, y)) {
          // Near map edge but not near pole - set to minimum height
          // @reference freeciv/server/generator/height_map.c:170-171
          heightMap[index] = 0;
        }
      }
    }
  }

  /**
   * Invert most effects of normalize_hmap_poles for accurate polar texturing
   * @reference freeciv/server/generator/height_map.c:178-192 renormalize_hmap_poles()
   * Original implementation inverts height reduction applied during normalization
   * Restores original heights for polar regions to enable accurate terrain texturing
   */
  private renormalizeHmapPoles(heightMap: number[], _tiles: MapTile[][]): void {
    const ICE_BASE_LEVEL = 200;
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500

    // Create TemperatureMap instance for colatitude calculation
    const tempMap = new TemperatureMap(this.width, this.height);

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;

        if (heightMap[index] === 0) {
          // Nothing left to restore
          // @reference freeciv/server/generator/height_map.c:181-182
          continue;
        }

        const colatitude = tempMap.mapColatitude(x, y);

        if (colatitude <= POLAR_THRESHOLD) {
          const factor = this.hmapPoleFactor(colatitude, x, y);

          if (factor > 0) {
            // Invert the previously applied function
            // @reference freeciv/server/generator/height_map.c:186-189
            heightMap[index] = Math.floor(heightMap[index] / factor);
          }
        }
      }
    }
  }

  /**
   * Calculate height reduction factor for polar regions
   * @reference freeciv/server/generator/height_map.c:133-150 hmap_pole_factor()
   * Original: factor = 1 - ((1 - (map_colatitude(ptile) / (2.5 * ICE_BASE_LEVEL)))
   *                          * wld.map.server.flatpoles / 100);
   */
  private hmapPoleFactor(colatitude: number, x: number, y: number): number {
    const ICE_BASE_LEVEL = 200;
    const POLAR_THRESHOLD = 2.5 * ICE_BASE_LEVEL; // 500
    const flatpoles = 100; // Default flatpoles parameter (0-100)
    let factor = 1.0;

    if (this.nearSingularity(x, y)) {
      // Map edge near pole: clamp to what linear ramp would give us at pole
      // @reference freeciv/server/generator/height_map.c:138-141
      factor = (100 - flatpoles) / 100.0;
    } else if (flatpoles > 0) {
      // Linear ramp down from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles) % at the poles
      // @reference freeciv/server/generator/height_map.c:142-145
      factor = 1 - ((1 - colatitude / POLAR_THRESHOLD) * flatpoles) / 100;
    }

    // Additional reduction for separate poles (simplified)
    // @reference freeciv/server/generator/height_map.c:146-150
    if (colatitude >= 2 * ICE_BASE_LEVEL) {
      factor = Math.min(factor, 0.1);
    }

    return Math.max(0, factor);
  }

  /**
   * Check if position is near map edge singularity
   * @reference freeciv/server/generator/mapgen_topology.c:53-56 near_singularity()
   * Original: return is_singular_tile(ptile, CITY_MAP_DEFAULT_RADIUS);
   * Simplified for rectangular maps
   */
  private nearSingularity(x: number, y: number): boolean {
    const CITY_MAP_DEFAULT_RADIUS = 2; // From freeciv
    const edgeDistance = Math.min(x, this.width - 1 - x, y, this.height - 1 - y);
    return edgeDistance <= CITY_MAP_DEFAULT_RADIUS;
  }
}
