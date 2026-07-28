import { MapTile, TemperatureType } from './MapTypes';
import { MapTopology, type MapTopologyOptions } from './MapTopology';

/**
 * Climate constants ported from freeciv reference
 * @reference freeciv/server/generator/temperature_map.h and mapgen_topology.h
 */
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude (freeciv: MAP_MAX_LATITUDE)
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
 * Calculate ice base level dynamically based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.c:243-245
 * Original: ice_base_colatitude = (MAX(0, 100 * COLD_LEVEL / 3 - 2 * MAX_COLATITUDE) + 2 * MAX_COLATITUDE * sqsize) / (100 * sqsize)
 */
function getIceBaseLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  const coldLevel = getColdLevel(temperature);
  // Use the classic default map scale. Generator topology initialization
  // adjusts this further when map-size options are exposed independently.
  const squareSize = 5;
  return (
    (Math.max(0, (100 * coldLevel) / 3 - MAX_COLATITUDE) + MAX_COLATITUDE * squareSize) /
    (100 * squareSize)
  );
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
  private topology: MapTopology;

  constructor(
    width: number,
    height: number,
    temperatureParam: number = DEFAULT_TEMPERATURE,
    topologyOptions: MapTopologyOptions = {}
  ) {
    this.width = width;
    this.height = height;
    this.temperatureParam = temperatureParam;
    this.temperatureMap = new Array(width * height);
    this.topology = new MapTopology(width, height, topologyOptions);
  }

  /**
   * Calculate colatitude for a tile (0 = pole, MAX_COLATITUDE = equator)
   * @reference freeciv/server/generator/mapgen_topology.c:map_colatitude()
   */
  public mapColatitude(_x: number, y: number): number {
    // Linear interpolation between Freeciv's default +1000/-1000 latitude
    // limits, followed by colatitude conversion.
    const centerY = this.height / 2;
    const distanceFromEquator = Math.abs(y - centerY);
    const maxDistance = this.height / 2;
    const latitudeFactor = Math.max(0, Math.min(1, distanceFromEquator / maxDistance));
    return Math.floor((1 - latitudeFactor) * MAX_COLATITUDE);
  }

  /**
   * Count ocean tiles around a position.
   * @reference freeciv/common/terrain.c:637-660 count_terrain_class_near_tile()
   * Used for ocean proximity temperature moderation effects
   */
  private countOceanNearTile(tiles: MapTile[][], x: number, y: number): number {
    let oceanCount = 0;
    const positions = this.topology.getPositionsWithinRadius(x, y, 2);
    for (const position of positions) {
      const tile = tiles[position.x][position.y];
      if (
        tile.terrain === 'ocean' ||
        tile.terrain === 'coast' ||
        tile.terrain === 'deep_ocean' ||
        tile.terrain === 'lake'
      ) {
        oceanCount++;
      }
    }

    return positions.length > 0 ? Math.floor((oceanCount * 100) / positions.length) : 0;
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
  public createTemperatureMap(
    tiles: MapTile[][],
    heightMap: number[],
    real: boolean = true,
    shoreLevel: number = Math.max(...heightMap) * 0.7
  ): void {
    const maxHeight = Math.max(...heightMap);

    // Initialize base temperature from colatitude (inverted: higher colatitude = colder)
    for (let i = 0; i < this.width * this.height; i++) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const colatitude = this.mapColatitude(x, y);
      const baseTemp = colatitude;

      if (!real) {
        this.temperatureMap[i] = baseTemp;
      } else {
        // High land can be 30% cooler
        const heightFactor =
          (-0.3 * Math.max(0, heightMap[i] - shoreLevel)) / Math.max(1, maxHeight - shoreLevel);

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

    // Rank-normalize values like Freeciv's adjust_int_map().
    this.adjustTemperatureDistribution();

    // Convert to discrete temperature types
    this.convertToTemperatureTypes();
  }

  /**
   * Adjust temperature distribution for better balance
   * @reference freeciv/server/generator/temperature_map.c:154-157
   * Original: adjust_int_map(temperature_map, MIN_REAL_COLATITUDE, MAX_REAL_COLATITUDE)
   */
  private adjustTemperatureDistribution(): void {
    const targetMin = 0;
    const targetMax = MAX_COLATITUDE;
    const targetRange = targetMax - targetMin;
    const frequencies = new Map<number, number>();
    for (const value of this.temperatureMap) {
      frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    }
    let count = 0;
    const ranked = new Map<number, number>();
    for (const [value, frequency] of [...frequencies].sort((left, right) => left[0] - right[0])) {
      count += frequency;
      ranked.set(value, Math.floor(targetMin + (count * targetRange) / this.temperatureMap.length));
    }
    this.temperatureMap = this.temperatureMap.map(value => ranked.get(value)!);
  }

  /**
   * Convert continuous temperatures to discrete types (TT_FROZEN, TT_COLD, etc.)
   * @reference freeciv/server/generator/temperature_map.c:160-172
   * Original temperature type assignment logic with TROPICAL_LEVEL, COLD_LEVEL thresholds
   */
  private convertToTemperatureTypes(): void {
    const coldLevel = getColdLevel(this.temperatureParam);
    const tropicalLevel = getTropicalLevel(this.temperatureParam);
    const iceBaseLevel = getIceBaseLevel(this.temperatureParam);

    for (let i = 0; i < this.temperatureMap.length; i++) {
      const temp = this.temperatureMap[i];

      // Use freeciv's exact threshold logic from temperature_map.c:163-171
      // Higher temperature values = warmer climate
      if (temp >= tropicalLevel) {
        this.temperatureMap[i] = TemperatureType.TROPICAL;
      } else if (temp >= coldLevel) {
        this.temperatureMap[i] = TemperatureType.TEMPERATE;
      } else if (temp >= 2 * iceBaseLevel) {
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
    for (const neighbor of this.topology.getNeighbors(x, y)) {
      if (this.hasTemperatureType(neighbor.x, neighbor.y, tempType)) {
        return true;
      }
    }
    return false;
  }
}
