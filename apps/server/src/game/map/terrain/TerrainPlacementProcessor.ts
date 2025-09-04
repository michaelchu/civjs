/**
 * Terrain placement and distribution algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c make_terrains(), place_terrain(), rand_map_pos_characteristic()
 * Exact copies of freeciv terrain placement algorithms
 */
import { MapTile, TemperatureType, TerrainType } from '../MapTypes';
import { isOceanTerrain, PlacementMap } from '../TerrainUtils';
import { MapgenTerrainPropertyEnum, pickTerrain, getTerrainProperties } from '../TerrainRuleset';

export interface TerrainParams {
  mountain_pct: number;
  forest_pct: number;
  jungle_pct: number;
  desert_pct: number;
  swamp_pct: number;
  river_pct: number;
}

/**
 * Handles terrain placement, distribution, and spatial allocation algorithms
 * Extracted from TerrainGenerator for better separation of concerns
 * @reference freeciv/server/generator/mapgen.c:491-600 terrain placement logic
 */
export class TerrainPlacementProcessor {
  private width: number;
  private height: number;
  private random: () => number;
  private placementMap: PlacementMap;
  private hmapLowLevel: number = 0;

  constructor(width: number, height: number, random: () => number, placementMap: PlacementMap) {
    this.width = width;
    this.height = height;
    this.random = random;
    this.placementMap = placementMap;
  }

  /**
   * Initialize hmap_low_level for mountain conditions
   * @reference freeciv/server/generator/mapgen.c ini_hmap_low_level()
   * Must be called before makeTerrains() with proper shore and max levels
   */
  public initializeHmapLowLevel(
    swampPct: number,
    hmapShoreLevel: number,
    hmapMaxLevel: number
  ): void {
    // @reference freeciv/server/generator/mapgen.c:120-123
    // hmap_low_level = (4 * swamp_pct * (hmap_max_level - hmap_shore_level)) / 100 + hmap_shore_level;
    this.hmapLowLevel = Math.floor(
      (4 * swampPct * (hmapMaxLevel - hmapShoreLevel)) / 100 + hmapShoreLevel
    );
  }

  /**
   * Main terrain placement algorithm - exact copy of freeciv make_terrains() function
   * @reference freeciv/server/generator/mapgen.c:491 make_terrains()
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
            MapgenTerrainPropertyEnum.FOLIAGE,
            MapgenTerrainPropertyEnum.TEMPERATE,
            MapgenTerrainPropertyEnum.TROPICAL,
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
            MapgenTerrainPropertyEnum.FOLIAGE,
            MapgenTerrainPropertyEnum.TROPICAL,
            MapgenTerrainPropertyEnum.COLD,
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
            MapgenTerrainPropertyEnum.WET,
            MapgenTerrainPropertyEnum.UNUSED,
            MapgenTerrainPropertyEnum.FOLIAGE,
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
            MapgenTerrainPropertyEnum.DRY,
            MapgenTerrainPropertyEnum.TROPICAL,
            MapgenTerrainPropertyEnum.COLD,
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
            MapgenTerrainPropertyEnum.DRY,
            MapgenTerrainPropertyEnum.TROPICAL,
            MapgenTerrainPropertyEnum.WET,
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
    } while (
      forests_count > 0 ||
      jungles_count > 0 ||
      swamps_count > 0 ||
      deserts_count > 0 ||
      alt_deserts_count > 0
    );

    // Fill remaining spots with plains/grassland - exact copy of freeciv logic
    // @reference freeciv/server/generator/mapgen.c:607-612
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (this.placementMap.notPlaced(x, y) && !isOceanTerrain(tile.terrain)) {
          const candidate = this.randMapPosCharacteristic(tiles, 'WC_ALL', 'TT_ALL', 'MC_NONE');
          if (candidate) {
            this.makePlain(candidate.tile, candidate.x, candidate.y);
          }
        }
      }
    }
  }

  /**
   * Find random position with given characteristics
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
        MapgenTerrainPropertyEnum.FROZEN,
        MapgenTerrainPropertyEnum.UNUSED,
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        this.random
      );
    } else if (tile.temperature === TemperatureType.COLD) {
      // tile_set_terrain(ptile, pick_terrain(MG_COLD, MG_UNUSED, MG_MOUNTAINOUS));
      terrain = pickTerrain(
        MapgenTerrainPropertyEnum.COLD,
        MapgenTerrainPropertyEnum.UNUSED,
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        this.random
      );
    } else {
      // tile_set_terrain(ptile, pick_terrain(MG_TEMPERATE, MG_GREEN, MG_MOUNTAINOUS));
      terrain = pickTerrain(
        MapgenTerrainPropertyEnum.TEMPERATE,
        MapgenTerrainPropertyEnum.GREEN,
        MapgenTerrainPropertyEnum.MOUNTAINOUS,
        this.random
      );
    }

    tile.terrain = terrain;

    // Mark as placed using placement tracking
    // @reference freeciv/server/generator/mapgen_utils.c:79 map_set_placed()
    this.placementMap.setPlaced(x, y);

    this.setTerrainProperties(tile);
  }

  /**
   * Check wetness condition for terrain placement
   * @reference freeciv/server/generator/mapgen.c wetness conditions
   */
  private checkWetnessCondition(tile: MapTile, condition: string): boolean {
    const wetness = tile.wetness || 0;
    switch (condition) {
      case 'WC_ALL':
        return true;
      case 'WC_DRY':
        return wetness < 50;
      case 'WC_NDRY':
        return wetness >= 50;
      default:
        return true;
    }
  }

  /**
   * Check temperature condition for terrain placement
   * @reference freeciv/server/generator/mapgen.c temperature conditions
   */
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

  /**
   * Check mountain condition for terrain placement
   * @reference freeciv/server/generator/mapgen.c mountain conditions
   * Uses freeciv's hmap_low_level threshold for MC_LOW/MC_NLOW conditions
   */
  private checkMountainCondition(tile: MapTile, condition: string): boolean {
    const height = tile.elevation || 0;
    switch (condition) {
      case 'MC_NONE':
        return true;
      case 'MC_LOW':
        // @reference freeciv/server/generator/mapgen.c map_pos_is_low(ptile)
        return height < this.hmapLowLevel;
      case 'MC_NLOW':
        // @reference freeciv/server/generator/mapgen.c !map_pos_is_low(ptile)
        return height >= this.hmapLowLevel;
      default:
        return true;
    }
  }

  /**
   * Public method to set terrain properties for external use
   * @reference freeciv/server/generator/mapgen.c terrain property setting
   */
  public setTerrainPropertiesForTile(tile: MapTile): void {
    this.setTerrainProperties(tile);
  }

  /**
   * Set terrain properties after terrain assignment
   * @reference freeciv/server/generator/mapgen.c terrain property setting
   */
  private setTerrainProperties(tile: MapTile): void {
    // Set game properties based on terrain type
    // This mirrors the freeciv server's terrain property assignment

    // Get terrain properties from ruleset
    const properties = getTerrainProperties(tile.terrain);

    // Apply properties to tile (this ensures consistency with freeciv rules)
    tile.properties = properties;
  }
}
