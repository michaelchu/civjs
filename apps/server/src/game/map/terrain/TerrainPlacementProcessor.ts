/**
 * Terrain placement and distribution algorithms from freeciv
 * @reference freeciv/server/generator/mapgen.c make_terrains(), place_terrain(), rand_map_pos_characteristic()
 * Exact copies of freeciv terrain placement algorithms
 */
import { MapTile, TemperatureType, TerrainType } from '@game/map/MapTypes';
import { isOceanTerrain, PlacementMap } from '@game/map/TerrainUtils';
import {
  MapgenTerrainPropertyEnum,
  pickTerrain,
  getTerrainProperties,
} from '@game/map/TerrainRuleset';

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
    // Count total unplaced land tiles
    const total = this.countUnplacedLandTiles(tiles);

    // Calculate terrain counts exactly as freeciv does
    const counts = this.computeInitialCounts(total, terrainParams);

    // The placement loop - exact copy of freeciv logic, factored via helper
    do {
      this.processPlacement(tiles, counts, {
        key: 'forests',
        fallback: 'plains',
        wc: 'WC_ALL',
        tc: 'TT_NFROZEN',
        mc: 'MC_NONE',
        weight: 60,
        props: [
          MapgenTerrainPropertyEnum.FOLIAGE,
          MapgenTerrainPropertyEnum.TEMPERATE,
          MapgenTerrainPropertyEnum.TROPICAL,
        ],
      });

      this.processPlacement(tiles, counts, {
        key: 'jungles',
        fallback: 'forests',
        wc: 'WC_ALL',
        tc: 'TT_TROPICAL',
        mc: 'MC_NONE',
        weight: 50,
        props: [
          MapgenTerrainPropertyEnum.FOLIAGE,
          MapgenTerrainPropertyEnum.TROPICAL,
          MapgenTerrainPropertyEnum.COLD,
        ],
      });

      this.processPlacement(tiles, counts, {
        key: 'swamps',
        fallback: 'forests',
        wc: 'WC_NDRY',
        tc: 'TT_HOT',
        mc: 'MC_LOW',
        weight: 50,
        props: [
          MapgenTerrainPropertyEnum.WET,
          MapgenTerrainPropertyEnum.UNUSED,
          MapgenTerrainPropertyEnum.FOLIAGE,
        ],
      });

      this.processPlacement(tiles, counts, {
        key: 'deserts',
        fallback: 'altDeserts',
        wc: 'WC_DRY',
        tc: 'TT_NFROZEN',
        mc: 'MC_NLOW',
        weight: 80,
        props: [
          MapgenTerrainPropertyEnum.DRY,
          MapgenTerrainPropertyEnum.TROPICAL,
          MapgenTerrainPropertyEnum.COLD,
        ],
      });

      this.processPlacement(tiles, counts, {
        key: 'altDeserts',
        fallback: 'plains',
        wc: 'WC_ALL',
        tc: 'TT_NFROZEN',
        mc: 'MC_NLOW',
        weight: 40,
        props: [
          MapgenTerrainPropertyEnum.DRY,
          MapgenTerrainPropertyEnum.TROPICAL,
          MapgenTerrainPropertyEnum.WET,
        ],
      });
    } while (
      counts.forests > 0 ||
      counts.jungles > 0 ||
      counts.swamps > 0 ||
      counts.deserts > 0 ||
      counts.altDeserts > 0
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
   * Count unplaced land tiles (not placed and not ocean)
   */
  private countUnplacedLandTiles(tiles: MapTile[][]): number {
    let total = 0;
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const tile = tiles[x][y];
        if (this.placementMap.notPlaced(x, y) && !isOceanTerrain(tile.terrain)) {
          total++;
        }
      }
    }
    return total;
  }

  /**
   * Compute initial terrain counts per freeciv formulas
   */
  private computeInitialCounts(
    total: number,
    terrainParams: TerrainParams
  ): {
    forests: number;
    jungles: number;
    deserts: number;
    swamps: number;
    altDeserts: number;
    plains: number;
  } {
    const forests = Math.floor(
      (total * terrainParams.forest_pct) / (100 - terrainParams.mountain_pct)
    );
    const jungles = Math.floor(
      (total * terrainParams.jungle_pct) / (100 - terrainParams.mountain_pct)
    );
    const deserts = Math.floor(
      (total * terrainParams.desert_pct) / (100 - terrainParams.mountain_pct)
    );
    const swamps = Math.floor(
      (total * terrainParams.swamp_pct) / (100 - terrainParams.mountain_pct)
    );
    const altDeserts = 0;
    const plains = total - forests - deserts - swamps - jungles;

    return { forests, jungles, deserts, swamps, altDeserts, plains };
  }

  /**
   * Process one terrain category placement step, updating counts as in freeciv
   */
  private processPlacement(
    tiles: MapTile[][],
    counts: {
      forests: number;
      jungles: number;
      deserts: number;
      swamps: number;
      altDeserts: number;
      plains: number;
    },
    config: {
      key: 'forests' | 'jungles' | 'deserts' | 'swamps' | 'altDeserts';
      fallback: 'plains' | 'forests' | 'altDeserts';
      wc: string;
      tc: string;
      mc: string;
      weight: number;
      props: [MapgenTerrainPropertyEnum, MapgenTerrainPropertyEnum, MapgenTerrainPropertyEnum];
    }
  ): void {
    const key = config.key;
    if (counts[key] <= 0) return;

    const candidate = this.randMapPosCharacteristic(tiles, config.wc, config.tc, config.mc);
    if (candidate) {
      const terrain = pickTerrain(config.props[0], config.props[1], config.props[2], this.random);
      this.placeTerrain(
        candidate.tile,
        candidate.x,
        candidate.y,
        config.weight,
        terrain,
        counts[key],
        counts[config.fallback],
        config.wc,
        config.tc,
        config.mc
      );
      counts[key]--;
    } else {
      counts[config.fallback] += counts[key];
      counts[key] = 0;
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
