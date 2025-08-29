import { MapTile, TemperatureType } from './MapTypes';

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
 * MODIFIED: Made much more restrictive to create minimal tundra only at map tips
 */
function getColdLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  // Responsive to temperature parameter: lower temp setting = more cold zones
  // At temp 0 (coldest): significant cold zones, at temp 100 (hottest): minimal cold zones
  const originalColdLevel = Math.max(0, (MAX_COLATITUDE * (60 * 7 - temperature * 6)) / 700);

  // Scale reduction: Allow meaningful tundra blocks with smooth transitions
  // Temperature 30 should have moderate cold zones that blend well with temperate areas
  const reductionFactor = 0.85 + (temperature / 100) * 0.15; // 0.85x reduction at temp=0, 1.0x at temp=100
  return Math.max(100, originalColdLevel * reductionFactor); // Moderate minimum for natural cold zones
}

/**
 * Calculate ice base level dynamically based on temperature parameter
 * @reference freeciv/server/generator/mapgen_topology.c:243-245
 * Original: ice_base_colatitude = (MAX(0, 100 * COLD_LEVEL / 3 - 2 * MAX_COLATITUDE) + 2 * MAX_COLATITUDE * sqsize) / (100 * sqsize)
 * Simplified version for web play (assuming sqsize = 40 typical for medium maps)
 * MODIFIED: Made even more restrictive for minimal tundra generation
 */
function getIceBaseLevel(temperature: number = DEFAULT_TEMPERATURE): number {
  const coldLevel = getColdLevel(temperature);
  // Make ice zones extremely small - only the absolute tips
  return Math.max(0, coldLevel / 10); // Ice zones are 1/10 the size of cold zones
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
  public mapColatitude(x: number, y: number): number {
    // Simple linear latitude calculation - equator at center, poles at edges
    const centerY = this.height / 2;
    const distanceFromEquator = Math.abs(y - centerY);
    const maxDistance = this.height / 2;

    // Linear progression from equator (0) to poles (MAX_COLATITUDE)
    let latitudeFactor = distanceFromEquator / maxDistance;

    // Add minimal longitudinal variation to prevent perfect stripes
    const longitudinalVariation = Math.sin((x / this.width) * Math.PI * 6) * 0.05;
    latitudeFactor += longitudinalVariation * (1 - latitudeFactor);

    // Clamp to valid range
    latitudeFactor = Math.max(0, Math.min(1, latitudeFactor));

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

    // Initialize base temperature from colatitude (inverted: higher colatitude = colder)
    for (let i = 0; i < this.width * this.height; i++) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      const colatitude = this.mapColatitude(x, y);
      const baseTemp = MAX_COLATITUDE - colatitude; // Invert: equator=hot, poles=cold

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
