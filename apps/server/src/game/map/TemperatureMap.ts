import { MapTile, TemperatureType } from './MapTypes';

/**
 * Climate constants ported from freeciv reference
 * @reference freeciv/server/generator/temperature_map.h and mapgen_topology.h
 */
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude (freeciv: MAP_MAX_LATITUDE)
const ICE_BASE_LEVEL = 200; // Base level for polar ice formation (freeciv: ice_base_colatitude)
const DEFAULT_TEMPERATURE = 50; // Default temperature parameter 0-100 (freeciv: wld.map.server.temperature)

/**
 * Calculate cold temperature threshold based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.h:50-51
 * Original: #define COLD_LEVEL (MAX(0, MAX_COLATITUDE * (60*7 - wld.map.server.temperature * 6 ) / 700))
 */
function getColdLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.max(0, (MAX_COLATITUDE * (60 * 7 - temperature * 6)) / 700);
}

/**
 * Calculate tropical temperature threshold based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.h:52-54
 * Original: #define TROPICAL_LEVEL (MIN(MAX_COLATITUDE * 9 /10, MAX_COLATITUDE * (143*7 - wld.map.server.temperature * 10) / 700))
 */
function getTropicalLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  return Math.min((MAX_COLATITUDE * 9) / 10, (MAX_COLATITUDE * (143 * 7 - temperature * 10)) / 700);
}

/**
 * Enhanced TemperatureMap class - Sophisticated climate generation system
 * @reference freeciv/server/generator/temperature_map.c
 * Ported from freeciv's temperature map generation algorithms including:
 * - create_tmap() function (lines 119-179)
 * - Temperature distribution adjustment logic
 * - Climate-aware terrain placement
 */
export class TemperatureMap {
  private temperatureMap: number[];
  private width: number;
  private height: number;
  private temperatureParam: number;

  constructor(width: number, height: number, temperatureParam: number = DEFAULT_TEMPERATURE) {
    this.width = width;
    this.height = height;
    this.temperatureParam = temperatureParam;
    this.temperatureMap = new Array(width * height);
  }

  /**
   * Calculate colatitude for a tile (0 = equator, MAX_COLATITUDE = pole)
   * @reference freeciv/server/generator/mapgen_topology.c:map_colatitude()
   * Simplified latitude calculation for rectangular maps
   */
  private mapColatitude(_x: number, y: number): number {
    const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);
    return Math.floor(latitudeFactor * MAX_COLATITUDE);
  }

  /**
   * Count ocean tiles around a position (simplified version of count_terrain_class_near_tile)
   * @reference freeciv/common/terrain.c:637-660 count_terrain_class_near_tile()
   * Used for ocean proximity temperature moderation effects
   */
  private countOceanNearTile(tiles: MapTile[][], x: number, y: number): number {
    let oceanCount = 0;
    const radius = 2;
    let totalCount = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const nx = x + dx;
        const ny = y + dy;

        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          totalCount++;
          const tile = tiles[nx][ny];
          if (
            tile.terrain === 'ocean' ||
            tile.terrain === 'coast' ||
            tile.terrain === 'deep_ocean' ||
            tile.terrain === 'lake'
          ) {
            oceanCount++;
          }
        }
      }
    }

    return totalCount > 0 ? Math.floor((oceanCount * 100) / totalCount) : 0;
  }

  /**
   * Create sophisticated temperature map based on freeciv's create_tmap function
   * @reference freeciv/server/generator/temperature_map.c:119-179 create_tmap()
   * Implements:
   * - Latitude-based base temperature (line 131)
   * - Elevation cooling effects (lines 137-138)
   * - Ocean proximity temperature moderation (lines 139-144)
   * - Temperature distribution adjustment (lines 150-157)
   * - Discrete temperature type conversion (lines 160-172)
   */
  public createTemperatureMap(tiles: MapTile[][], heightMap: number[], real: boolean = true): void {
    const maxHeight = Math.max(...heightMap);
    const shoreLevel = maxHeight * 0.3; // Approximate shore level

    // Initialize base temperature from colatitude
    for (let i = 0; i < this.width * this.height; i++) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const baseTemp = this.mapColatitude(x, y);

      if (!real) {
        this.temperatureMap[i] = baseTemp;
      } else {
        // High land can be 30% cooler
        const heightFactor =
          (-0.3 * Math.max(0, heightMap[i] - shoreLevel)) / (maxHeight - shoreLevel);

        // Near ocean temperature can be 15% more "temperate"
        const oceanCount = this.countOceanNearTile(tiles, x, y);
        const temperateFactor =
          (0.15 *
            (this.temperatureParam / 100 - baseTemp / MAX_COLATITUDE) *
            2 *
            Math.min(50, oceanCount)) /
          100;

        this.temperatureMap[i] = Math.floor(
          baseTemp * (1.0 + temperateFactor) * (1.0 + heightFactor)
        );
      }
    }

    // Adjust to get evenly distributed frequencies (simplified adjust_int_map)
    this.adjustTemperatureDistribution();

    // Convert to discrete temperature types
    this.convertToTemperatureTypes();
  }

  /**
   * Adjust temperature distribution for better balance
   * @reference freeciv/server/generator/temperature_map.c:154-157
   * Original: adjust_int_map(temperature_map, MIN_REAL_COLATITUDE, MAX_REAL_COLATITUDE)
   * Simplified implementation for even temperature distribution
   */
  private adjustTemperatureDistribution(): void {
    const minTemp = Math.min(...this.temperatureMap);
    const maxTemp = Math.max(...this.temperatureMap);

    if (maxTemp <= minTemp) return;

    const range = maxTemp - minTemp;
    const targetMin = MAX_COLATITUDE * 0.1;
    const targetMax = MAX_COLATITUDE * 0.9;
    const targetRange = targetMax - targetMin;

    for (let i = 0; i < this.temperatureMap.length; i++) {
      const normalized = (this.temperatureMap[i] - minTemp) / range;
      this.temperatureMap[i] = Math.floor(targetMin + normalized * targetRange);
    }
  }

  /**
   * Convert continuous temperatures to discrete types (TT_FROZEN, TT_COLD, etc.)
   * @reference freeciv/server/generator/temperature_map.c:160-172
   * Original temperature type assignment logic with TROPICAL_LEVEL, COLD_LEVEL thresholds
   */
  private convertToTemperatureTypes(): void {
    const coldLevel = getColdLevel(this.temperatureParam);
    const tropicalLevel = getTropicalLevel(this.temperatureParam);

    for (let i = 0; i < this.temperatureMap.length; i++) {
      const temp = this.temperatureMap[i];

      if (temp >= tropicalLevel) {
        this.temperatureMap[i] = TemperatureType.TROPICAL;
      } else if (temp >= coldLevel) {
        this.temperatureMap[i] = TemperatureType.TEMPERATE;
      } else if (temp >= 2 * ICE_BASE_LEVEL) {
        this.temperatureMap[i] = TemperatureType.COLD;
      } else {
        this.temperatureMap[i] = TemperatureType.FROZEN;
      }
    }
  }

  // Get temperature type for a tile
  public getTemperature(x: number, y: number): TemperatureType {
    const index = y * this.width + x;
    if (index < 0 || index >= this.temperatureMap.length) {
      return TemperatureType.TEMPERATE;
    }
    return this.temperatureMap[index];
  }

  /**
   * Check if tile has specific temperature type (like tmap_is function)
   * @reference freeciv/server/generator/temperature_map.c:85-88 tmap_is()
   * Original: return BOOL_VAL(tmap(ptile) & (tt))
   */
  public hasTemperatureType(x: number, y: number, tempType: TemperatureType): boolean {
    const tileTemp = this.getTemperature(x, y);
    return (tileTemp & tempType) !== 0;
  }

  /**
   * Check if any neighbor has specific temperature type
   * @reference freeciv/server/generator/temperature_map.c:93-102 is_temperature_type_near()
   * Original: adjc_iterate checking for temperature type in adjacent tiles
   */
  public hasTemperatureTypeNear(x: number, y: number, tempType: TemperatureType): boolean {
    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const neighbor of neighbors) {
      if (
        neighbor.x >= 0 &&
        neighbor.x < this.width &&
        neighbor.y >= 0 &&
        neighbor.y < this.height
      ) {
        if (this.hasTemperatureType(neighbor.x, neighbor.y, tempType)) {
          return true;
        }
      }
    }
    return false;
  }
}
