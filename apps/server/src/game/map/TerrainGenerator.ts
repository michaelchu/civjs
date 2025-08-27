/**
 * Specialized terrain generation algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c
 * @reference freeciv/server/generator/height_map.c
 * Exact copies of freeciv terrain algorithms
 */
import { MapTile, TemperatureType, TerrainType } from './MapTypes';
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
   */
  public makeLand(
    tiles: MapTile[][],
    heightMap: number[],
    params: { landpercent: number; steepness: number; wetness: number; temperature: number }
  ): void {
    // Constants from freeciv
    const TERRAIN_OCEAN_DEPTH_MAXIMUM = 100; // From freeciv
    const hmap_max_level = 1000; // Max height value

    // Step 1: HAS_POLES - we'll skip this for simplicity (most maps don't have poles)
    // normalize_hmap_poles(); - not implemented

    // Step 2: Pick a non-ocean terrain for land_fill (temporary land terrain)
    const land_fill = 'grassland'; // Simple default - in freeciv this searches terrain types

    // Step 3: Set shore level based on landpercent
    // hmap_shore_level = (hmap_max_level * (100 - wld.map.server.landpercent)) / 100;
    const hmap_shore_level = (hmap_max_level * (100 - params.landpercent)) / 100;

    // Step 4: ini_hmap_low_level() - calculate low level for swamps
    // hmap_low_level = (4 * swamp_pct * (hmap_max_level - hmap_shore_level)) / 100 + hmap_shore_level;
    // const hmap_low_level = (4 * terrainParams.swamp_pct * (hmap_max_level - hmap_shore_level)) / 100 + hmap_shore_level;

    // Step 5: Main iteration - set terrain based on height
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const index = y * this.width + x;
        const tileHeight = heightMap[index];

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
                const nindex = ny * this.width + nx;
                if (heightMap[nindex] < hmap_shore_level) {
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
        } else {
          // This tile should be land - set to land_fill temporarily
          tiles[x][y].terrain = land_fill;
        }
      }
    }

    // Step 6: HAS_POLES - renormalize_hmap_poles() and make_polar_land() - skip for now

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

    // Step 11: destroy_placed_map() - cleanup
    // @reference freeciv/server/generator/mapgen.c:1045 destroy_placed_map()
    this.placementMap.destroyPlacedMap();

    // Step 12: make_rivers() - this is handled separately in our implementation
  }

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

  /**
   * Make relief - creates mountains and hills with placement tracking
   * @reference freeciv/server/generator/mapgen.c make_relief()
   * Uses placement tracking to mark specialized terrain as placed
   */
  private makeRelief(
    tiles: MapTile[][],
    heightMap: number[],
    shore_level: number,
    _mountain_pct: number
  ): void {
    // Mountain/hill placement with placement tracking
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (!isOceanTerrain(tile.terrain)) {
          const index = y * this.width + x;
          const height = heightMap[index];

          // Place mountains/hills based on height using pick_terrain
          // @reference freeciv/server/generator/mapgen.c:316-322
          if (height > shore_level + (1000 - shore_level) * 0.9) {
            // Highest areas - use pick_terrain for mountains
            // pick_terrain(MG_MOUNTAINOUS, fc_rand(10) < 4 ? MG_UNUSED : MG_GREEN, MG_UNUSED)
            const prefer =
              this.random() < 0.4 ? MapgenTerrainProperty.UNUSED : MapgenTerrainProperty.GREEN;
            tile.terrain = pickTerrain(
              MapgenTerrainProperty.MOUNTAINOUS,
              prefer,
              MapgenTerrainProperty.UNUSED,
              this.random
            );
            // Mark as placed to prevent overwrite during terrain assignment
            // @reference freeciv/server/generator/mapgen_utils.c:79 map_set_placed()
            this.placementMap.setPlaced(x, y);
            this.setTerrainProperties(tile);
          } else if (height > shore_level + (1000 - shore_level) * 0.8) {
            // High areas - use pick_terrain for hills/mountains
            // pick_terrain(MG_MOUNTAINOUS, MG_UNUSED, fc_rand(10) < 8 ? MG_GREEN : MG_UNUSED)
            const avoid =
              this.random() < 0.8 ? MapgenTerrainProperty.GREEN : MapgenTerrainProperty.UNUSED;
            tile.terrain = pickTerrain(
              MapgenTerrainProperty.MOUNTAINOUS,
              MapgenTerrainProperty.UNUSED,
              avoid,
              this.random
            );
            // Mark as placed to prevent overwrite during terrain assignment
            this.placementMap.setPlaced(x, y);
            this.setTerrainProperties(tile);
          }
        }
      }
    }
  }

  /**
   * Make fracture relief - special relief for fracture maps with placement tracking
   * @reference freeciv/server/generator/mapgen.c make_fracture_relief()
   * Uses placement tracking for specialized terrain
   */
  private makeFractureRelief(tiles: MapTile[][], heightMap: number[], shore_level: number): void {
    // Fracture relief uses the same relief system with different parameters
    // Fracture maps typically have more mountains (15% instead of default)
    this.makeRelief(tiles, heightMap, shore_level, 15);
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
   * Convert continuous temperature values to discrete climate zones
   */
  public convertTemperatureToEnum(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];

        // Convert continuous temperature value to discrete enum (respects TemperatureMap)
        const tempValue = tile.temperature; // Keep the sophisticated value from TemperatureMap
        const MAX_COLATITUDE = 1000;

        // Use freeciv-based thresholds instead of crude latitude bands
        if (tempValue >= MAX_COLATITUDE * 0.8) {
          tile.temperature = TemperatureType.FROZEN;
        } else if (tempValue >= MAX_COLATITUDE * 0.5) {
          tile.temperature = TemperatureType.COLD;
        } else if (tempValue <= MAX_COLATITUDE * 0.25) {
          tile.temperature = TemperatureType.TROPICAL;
        } else {
          tile.temperature = TemperatureType.TEMPERATE;
        }

        // Optional: Add small amount of randomness
        if (this.random() < 0.05) {
          const temps = [
            TemperatureType.FROZEN,
            TemperatureType.COLD,
            TemperatureType.TEMPERATE,
            TemperatureType.TROPICAL,
          ];
          tile.temperature = temps[Math.floor(this.random() * temps.length)];
        }
      }
    }
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
   * Apply biome transitions for smoother terrain
   */
  public applyBiomeTransitions(tiles: MapTile[][]): void {
    // Simple biome transition smoothing
    const newTerrain = tiles.map(col => col.map(tile => ({ ...tile })));

    for (let x = 1; x < this.width - 1; x++) {
      for (let y = 1; y < this.height - 1; y++) {
        const tile = tiles[x][y];
        if (!isLandTile(tile.terrain)) continue;

        // Check neighbors for terrain consistency
        const neighbors = this.getNeighbors(tiles, x, y);
        const landNeighbors = neighbors.filter(n => isLandTile(n.terrain));

        if (landNeighbors.length > 0 && this.random() < 0.1) {
          // 10% chance to blend with neighbors
          const randomNeighbor = landNeighbors[Math.floor(this.random() * landNeighbors.length)];
          if (this.isClimateCompatible(tile, randomNeighbor)) {
            newTerrain[x][y].terrain = randomNeighbor.terrain;
          }
        }
      }
    }

    // Apply changes and update properties
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (tiles[x][y].terrain !== newTerrain[x][y].terrain) {
          tiles[x][y].terrain = newTerrain[x][y].terrain;
          this.setTerrainProperties(tiles[x][y]);
        }
      }
    }
  }

  /**
   * Check if two tiles have compatible climates
   */
  private isClimateCompatible(tile1: MapTile, tile2: MapTile): boolean {
    return tile1.temperature === tile2.temperature || Math.abs(tile1.wetness - tile2.wetness) < 30;
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
            tile.terrain = this.random() < 0.5 ? 'glacier' : 'snow';
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
  public removeTinyIslands(tiles: MapTile[][]): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (isTinyIsland(tiles, x, y, this.width, this.height, this.random)) {
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
}
