/**
 * Phase 4: Fractal Height Generation System
 * Advanced height map generation using diamond-square algorithm and fracture maps
 * @reference freeciv/server/generator/height_map.c and fracture_map.c
 */

// Height map constants from freeciv reference
const HMAP_MAX_LEVEL = 1000; // Maximum height value (freeciv: hmap_max_level)
// Shore level is now calculated dynamically based on land percentage
const DEFAULT_STEEPNESS = 30; // Terrain steepness parameter 0-100 (freeciv: wld.map.server.steepness)
const DEFAULT_FLATPOLES = 100; // Pole flattening parameter 0-100 (freeciv: wld.map.server.flatpoles)

/**
 * Climate constants ported from freeciv reference
 * @reference freeciv/server/generator/temperature_map.h and mapgen_topology.h
 */
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude (freeciv: MAP_MAX_LATITUDE)
const ICE_BASE_LEVEL = 200; // Base level for polar ice formation (freeciv: ice_base_colatitude)

// Constants for height generation

/**
 * Advanced height map generator using fractal algorithms
 * Ported from freeciv's height_map.c and fracture_map.c
 */
export class FractalHeightGenerator {
  private width: number;
  private height: number;
  private heightMap: number[];
  private random: () => number;
  private generator: string;
  private shoreLevel: number;
  private mountainLevel: number;
  private readonly steepness: number; // Used for mountain level calculation
  private flatpoles: number;

  constructor(
    width: number,
    height: number,
    random: () => number,
    steepness: number = DEFAULT_STEEPNESS,
    flatpoles: number = DEFAULT_FLATPOLES,
    generator: string = 'random'
  ) {
    this.width = width;
    this.height = height;
    this.heightMap = new Array(width * height).fill(0);
    this.random = random;
    this.generator = generator;
    this.steepness = steepness;
    this.flatpoles = flatpoles;

    // Calculate shore level based on land percentage (like freeciv make_land())
    const landPercent = 30; // MAP_DEFAULT_LANDMASS from freeciv reference
    this.shoreLevel = Math.floor((HMAP_MAX_LEVEL * (100 - landPercent)) / 100);

    // Calculate mountain level based on steepness parameter
    // Higher steepness = more mountains (lower mountain threshold)
    this.mountainLevel = Math.floor(
      ((HMAP_MAX_LEVEL - this.shoreLevel) * (100 - this.steepness)) / 100 + this.shoreLevel
    );
  }

  /**
   * Get height value at coordinates with bounds checking
   */
  private getHeight(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return 0;
    }
    return this.heightMap[y * this.width + x];
  }

  /**
   * Set height value at coordinates with bounds checking
   */
  private setHeight(x: number, y: number, value: number): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.heightMap[y * this.width + x] = Math.max(0, Math.min(HMAP_MAX_LEVEL, value));
    }
  }

  /**
   * Factor by which to lower height map near poles in normalize_hmap_poles()
   * @reference freeciv/server/generator/height_map.c:35-57
   */
  private getPoleFactor(x: number, y: number): number {
    const colatitude = this.getColatitude(x, y);
    let factor = 1.0;

    if (this.isNearMapEdge(x, y)) {
      // Map edge near pole: clamp to what linear ramp would give us at pole
      // (maybe greater than 0)
      factor = (100 - this.flatpoles) / 100.0;
    } else if (this.flatpoles > 0) {
      // Linear ramp down from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles) %
      // at the poles
      factor = 1 - ((1 - colatitude / (2.5 * ICE_BASE_LEVEL)) * this.flatpoles) / 100;
    }

    // A band of low height to try to separate the pole (this function is
    // only assumed to be called <= 2.5*ICE_BASE_LEVEL)
    if (colatitude >= 2 * ICE_BASE_LEVEL) {
      factor = Math.min(factor, 0.1);
    }

    return factor;
  }

  /**
   * Calculate colatitude (distance from equator) for climate effects
   */
  private getColatitude(_x: number, y: number): number {
    const latitudeFactor = Math.abs(y - this.height / 2) / (this.height / 2);
    return latitudeFactor * MAX_COLATITUDE;
  }

  /**
   * Check if coordinates are near map edge
   */
  private isNearMapEdge(x: number, y: number): boolean {
    const edgeDistance = 3;
    return (
      x < edgeDistance ||
      y < edgeDistance ||
      x >= this.width - edgeDistance ||
      y >= this.height - edgeDistance
    );
  }

  /**
   * Diamond-Square algorithm implementation
   * @reference freeciv/server/generator/height_map.c:120-182
   */
  private diamondSquareRecursive(
    step: number,
    xl: number,
    yt: number,
    xr: number,
    yb: number
  ): void {
    // Base case: rectangle too small
    if (yb - yt <= 0 || xr - xl <= 0 || (yb - yt === 1 && xr - xl === 1)) {
      return;
    }

    // Handle map wrapping for edge coordinates
    const x1wrap = xr >= this.width ? 0 : xr;
    const y1wrap = yb >= this.height ? 0 : yb;

    // Get corner values
    const val = [
      [this.getHeight(xl, yt), this.getHeight(xl, y1wrap)],
      [this.getHeight(x1wrap, yt), this.getHeight(x1wrap, y1wrap)],
    ];

    // Calculate midpoint coordinates
    const midX = Math.floor((xl + xr) / 2);
    const midY = Math.floor((yt + yb) / 2);

    // Set midpoints of sides with random variation
    this.setMidpoint(midX, yt, (val[0][0] + val[1][0]) / 2, step);
    this.setMidpoint(midX, y1wrap, (val[0][1] + val[1][1]) / 2, step);
    this.setMidpoint(xl, midY, (val[0][0] + val[0][1]) / 2, step);
    this.setMidpoint(x1wrap, midY, (val[1][0] + val[1][1]) / 2, step);

    // Set center point with random variation
    const centerValue = (val[0][0] + val[0][1] + val[1][0] + val[1][1]) / 4;
    this.setMidpoint(midX, midY, centerValue, step);

    // Recursively process four quadrants with reduced step size
    const newStep = Math.floor((2 * step) / 3);
    this.diamondSquareRecursive(newStep, xl, yt, midX, midY);
    this.diamondSquareRecursive(newStep, xl, midY, midX, yb);
    this.diamondSquareRecursive(newStep, midX, yt, xr, midY);
    this.diamondSquareRecursive(newStep, midX, midY, xr, yb);
  }

  /**
   * Set midpoint value with pole flattening and random variation
   */
  private setMidpoint(x: number, y: number, baseValue: number, step: number): void {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return;
    }

    const colatitude = this.getColatitude(x, y);
    const randomVariation = this.random() * step - step / 2;
    let value = baseValue + randomVariation;

    // Apply pole flattening for realistic world geometry
    if (colatitude <= ICE_BASE_LEVEL / 2) {
      value = (value * (100 - this.flatpoles)) / 100;
    } else if (this.isNearMapEdge(x, y) || this.getHeight(x, y) !== 0) {
      // Don't overwrite existing values or map edges
      return;
    }

    this.setHeight(x, y, value);
  }

  /**
   * Generate initial random height map (similar to MAPGEN_RANDOM approach)
   * @reference freeciv/server/generator/height_map.c make_random_hmap()
   */
  public generateRandomHeightMap(): void {
    // Test with minimal smoothing to preserve more height variation
    const smooth = 1; // Start with minimal smoothing

    // CRITICAL: Initialize each tile with a DIFFERENT random value (like freeciv INITIALIZE_ARRAY)
    // The freeciv macro evaluates fc_rand(1000 * smooth) for EACH array element
    for (let i = 0; i < this.heightMap.length; i++) {
      this.heightMap[i] = Math.floor(this.random() * (1000 * smooth));
    }

    // Apply multiple smoothing passes to create natural terrain variation
    this.applySmoothingPasses(smooth);

    // Adjust to proper height range (like freeciv adjust_int_map)
    this.normalizeHeightMap();

    // Adaptively set shore level to achieve target land percentage
    this.adjustShoreLevel();

    // Shore level has been adjusted to achieve target land percentage
  }

  /**
   * Generate fractal height map using proper grid-based approach
   * @reference freeciv/server/generator/height_map.c make_pseudofractal1_hmap()
   */
  public generatePseudoFractalHeightMap(): void {
    // CRITICAL: Initialize to ZEROS first (like freeciv does)
    this.heightMap.fill(0);

    // Create grid of seed points for fractal generation
    const xdiv = 5;
    const ydiv = 5;

    // Set initial seed points in a grid pattern
    for (let x = 0; x < xdiv + 1; x++) {
      for (let y = 0; y < ydiv + 1; y++) {
        const px = Math.floor((x * this.width) / xdiv);
        const py = Math.floor((y * this.height) / ydiv);

        // Create varied elevations for seed points (use step-based range like freeciv)
        const step = this.width + this.height;
        let seedHeight = Math.floor(this.random() * (2 * step)) - step;

        // Avoid edges (reduce land near map edges)
        if (this.isNearMapEdge(px, py)) {
          const landPercent = 30;
          const avoidedge = ((100 - landPercent) * step) / 100 + Math.floor(step / 3);
          seedHeight -= avoidedge;
        }

        this.setHeight(px, py, seedHeight);
      }
    }

    // Apply fractal subdivision to each grid cell
    const step = this.width + this.height; // Use freeciv step calculation
    for (let x = 0; x < xdiv; x++) {
      for (let y = 0; y < ydiv; y++) {
        const x1 = Math.floor((x * this.width) / xdiv);
        const y1 = Math.floor((y * this.height) / ydiv);
        const x2 = Math.floor(((x + 1) * this.width) / xdiv);
        const y2 = Math.floor(((y + 1) * this.height) / ydiv);

        this.diamondSquareRecursive(step, x1, y1, x2, y2);
      }
    }
  }

  /**
   * Generate height map using different algorithms based on generator type
   * Following freeciv reference implementation choices
   */
  public generateHeightMap(): void {
    // Choose generation algorithm based on generator type
    switch (this.generator) {
      case 'random':
        // MAPGEN_RANDOM approach: fully random heights with smoothing
        this.generateRandomHeightMap();
        break;
      case 'fractal':
        // MAPGEN_FRACTAL approach: pseudofractal with grid-based seeds
        this.generatePseudoFractalHeightMap();
        break;
      case 'island':
      case 'fair':
        // For now, use fractal as fallback - these would need island-specific logic
        this.generatePseudoFractalHeightMap();
        break;
      default:
        // Default to random (freeciv default)
        this.generateRandomHeightMap();
        break;
    }

    // Apply pole normalization (must come after height generation)
    this.normalizeHeightMapPoles();

    // Add final random variation for natural detail
    for (let i = 0; i < this.heightMap.length; i++) {
      const fuzz = Math.floor(this.random() * 8) - 4;
      this.heightMap[i] = Math.max(0, Math.min(HMAP_MAX_LEVEL, this.heightMap[i] + fuzz));
    }

    // Normalize to final height range
    this.normalizeHeightMap();
  }

  /**
   * Lower the land near the map edges and (optionally) the polar region to
   * avoid too much land there.
   * See also renormalize_hmap_poles()
   * @reference freeciv/server/generator/height_map.c:65-75
   */
  public normalizeHeightMapPoles(): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const colatitude = this.getColatitude(x, y);

        if (colatitude <= 2.5 * ICE_BASE_LEVEL) {
          const currentHeight = this.getHeight(x, y);
          const poleFactor = this.getPoleFactor(x, y);
          this.setHeight(x, y, currentHeight * poleFactor);
        } else if (this.isNearMapEdge(x, y)) {
          // Near map edge but not near pole.
          this.setHeight(x, y, 0);
        }
      }
    }
  }

  /**
   * Invert (most of) the effects of normalize_hmap_poles() so that we have
   * accurate heights for texturing the poles.
   * @reference freeciv/server/generator/height_map.c:81-95
   */
  public renormalizeHeightMapPoles(): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const currentHeight = this.getHeight(x, y);

        if (currentHeight === 0) {
          // Nothing left to restore.
          continue;
        }

        const colatitude = this.getColatitude(x, y);
        if (colatitude <= 2.5 * ICE_BASE_LEVEL) {
          const poleFactor = this.getPoleFactor(x, y);

          if (poleFactor > 0) {
            // Invert the previously applied function
            this.setHeight(x, y, currentHeight / poleFactor);
          }
        }
      }
    }
  }

  /**
   * Normalize height map to proper elevation range (0-255 for tile.elevation)
   */
  private normalizeHeightMap(): void {
    // Find current min/max heights
    let minHeight = HMAP_MAX_LEVEL;
    let maxHeight = 0;

    for (const height of this.heightMap) {
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
    }

    // Normalize to 0-255 range
    const range = maxHeight - minHeight;
    if (range > 0) {
      for (let i = 0; i < this.heightMap.length; i++) {
        this.heightMap[i] = Math.floor(((this.heightMap[i] - minHeight) / range) * 255);
      }
    }
  }

  /**
   * Apply Gaussian smoothing passes like freeciv smooth_int_map
   * @reference freeciv/server/generator/mapgen_utils.c smooth_int_map()
   */
  public applySmoothingPasses(passes: number = 2): void {
    // Gaussian weights from freeciv: center=0.37, adjacent=0.19, edge=0.13
    const weights = [0.13, 0.19, 0.37, 0.19, 0.13];

    for (let pass = 0; pass < passes; pass++) {
      // Horizontal pass
      const tempMap = [...this.heightMap];
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          let weightedSum = 0;
          let totalWeight = 0;

          for (let i = -2; i <= 2; i++) {
            const nx = x + i;
            if (nx >= 0 && nx < this.width) {
              weightedSum += this.getHeight(nx, y) * weights[i + 2];
              totalWeight += weights[i + 2];
            }
          }

          if (totalWeight > 0) {
            tempMap[y * this.width + x] = Math.floor(weightedSum / totalWeight);
          }
        }
      }

      // Vertical pass
      this.heightMap = [...tempMap];
      for (let x = 0; x < this.width; x++) {
        for (let y = 0; y < this.height; y++) {
          let weightedSum = 0;
          let totalWeight = 0;

          for (let i = -2; i <= 2; i++) {
            const ny = y + i;
            if (ny >= 0 && ny < this.height) {
              weightedSum += tempMap[ny * this.width + x] * weights[i + 2];
              totalWeight += weights[i + 2];
            }
          }

          if (totalWeight > 0) {
            this.heightMap[y * this.width + x] = Math.floor(weightedSum / totalWeight);
          }
        }
      }
    }
  }

  /**
   * Get the generated height map
   */
  public getHeightMap(): number[] {
    return [...this.heightMap];
  }

  /**
   * Adaptively adjust shore level to achieve target land percentage
   * This compensates for the range compression caused by smoothing
   */
  private adjustShoreLevel(): void {
    const targetLandPercent = 30; // MAP_DEFAULT_LANDMASS
    const sortedHeights = [...this.heightMap].sort((a, b) => b - a); // Sort descending

    // Find the height that gives us the closest to 30% land
    const targetLandTiles = Math.floor((this.heightMap.length * targetLandPercent) / 100);

    if (targetLandTiles > 0 && targetLandTiles < sortedHeights.length) {
      // Set shore level so that the top targetLandPercent of tiles become land
      const newShoreHeightNormalized = sortedHeights[targetLandTiles - 1];

      // Convert back to HMAP_MAX_LEVEL scale
      this.shoreLevel = Math.floor((newShoreHeightNormalized / 255) * HMAP_MAX_LEVEL);
    }
  }

  /**
   * Get shore level threshold for water/land classification
   */
  public getShoreLevel(): number {
    return Math.floor((this.shoreLevel / HMAP_MAX_LEVEL) * 255);
  }

  /**
   * Get mountain level threshold for elevation-based terrain
   */
  public getMountainLevel(): number {
    return Math.floor((this.mountainLevel / HMAP_MAX_LEVEL) * 255);
  }
}
