/**
 * Phase 4: Fractal Height Generation System
 * Advanced height map generation using diamond-square algorithm and fracture maps
 * @reference freeciv/server/generator/height_map.c and fracture_map.c
 */

// Height map constants from freeciv reference
const HMAP_MAX_LEVEL = 1000; // Maximum height value (freeciv: hmap_max_level)
const HMAP_SHORE_LEVEL = 250; // Sea level threshold (freeciv: hmap_shore_level)
const DEFAULT_STEEPNESS = 30; // Terrain steepness parameter 0-100 (freeciv: wld.map.server.steepness)
const DEFAULT_FLATPOLES = 100; // Pole flattening parameter 0-100 (freeciv: wld.map.server.flatpoles)

/**
 * Climate constants ported from freeciv reference
 * @reference freeciv/server/generator/temperature_map.h and mapgen_topology.h
 */
const MAX_COLATITUDE = 1000; // Normalized maximum colatitude (freeciv: MAP_MAX_LATITUDE)
const ICE_BASE_LEVEL = 200; // Base level for polar ice formation (freeciv: ice_base_colatitude)

// Landmass and fracture generation parameters
interface LandmassPoint {
  x: number;
  y: number;
}

/**
 * Advanced height map generator using fractal algorithms
 * Ported from freeciv's height_map.c and fracture_map.c
 */
export class FractalHeightGenerator {
  private width: number;
  private height: number;
  private heightMap: number[];
  private random: () => number;
  private shoreLevel: number = HMAP_SHORE_LEVEL;
  private mountainLevel: number;
  private readonly steepness: number; // Used for mountain level calculation
  private flatpoles: number;

  constructor(
    width: number,
    height: number,
    random: () => number,
    steepness: number = DEFAULT_STEEPNESS,
    flatpoles: number = DEFAULT_FLATPOLES
  ) {
    this.width = width;
    this.height = height;
    this.heightMap = new Array(width * height).fill(0);
    this.random = random;
    this.steepness = steepness;
    this.flatpoles = flatpoles;

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
   * Calculate pole flattening factor for realistic world geometry
   * @reference freeciv/server/generator/height_map.c:35-57
   */
  private getPoleFactor(x: number, y: number): number {
    const colatitude = this.getColatitude(x, y);
    let factor = 1.0;

    if (this.isNearMapEdge(x, y)) {
      // Map edge near pole: clamp to flat poles percentage
      factor = (100 - this.flatpoles) / 100.0;
    } else if (this.flatpoles > 0) {
      // Linear ramp down from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles)% at poles
      factor = 1 - ((1 - colatitude / (2.5 * ICE_BASE_LEVEL)) * this.flatpoles) / 100;
    }

    if (colatitude >= 2 * ICE_BASE_LEVEL) {
      // Band of low height to separate poles
      factor = Math.min(factor, 0.1);
    }

    return Math.max(0, factor);
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
   * Generate fracture map with landmass points
   * Ported from freeciv's make_fracture_map() function
   * @reference freeciv/server/generator/fracture_map.c:55-150
   * @reference Original algorithm creates strategic landmass points with border ocean generation
   */
  public generateFractureMap(): void {
    // Calculate number of landmasses based on map size
    const mapSize = Math.sqrt(this.width * this.height);
    const numLandmass = Math.floor(20 + 15 * (mapSize / 50));

    const fracturePoints: LandmassPoint[] = [];

    // Place landmass points along map borders for ocean creation
    const borderSpacing = 5;

    // Top and bottom borders
    for (let x = 3; x < this.width; x += borderSpacing) {
      fracturePoints.push({ x, y: 3 });
      fracturePoints.push({ x, y: this.height - 4 });
    }

    // Left and right borders
    for (let y = 3; y < this.height; y += borderSpacing) {
      fracturePoints.push({ x: 3, y });
      fracturePoints.push({ x: this.width - 4, y });
    }

    // Add random interior landmass points
    const borderPoints = fracturePoints.length;
    for (let i = 0; i < numLandmass; i++) {
      fracturePoints.push({
        x: Math.floor(this.random() * (this.width - 6)) + 3,
        y: Math.floor(this.random() * (this.height - 6)) + 3,
      });
    }

    // Create landmass regions around fracture points
    for (let i = 0; i < fracturePoints.length; i++) {
      const point = fracturePoints[i];
      const isBorderPoint = i < borderPoints;

      // Border points create ocean (low elevation), interior points create land
      const baseElevation = isBorderPoint ? 0 : Math.floor(this.random() * HMAP_MAX_LEVEL);
      const radius = Math.floor(8 + this.random() * 12);

      this.createCircularLandmass(point.x, point.y, radius, baseElevation);
    }
  }

  /**
   * Create circular landmass region using Bresenham circle algorithm
   */
  private createCircularLandmass(
    centerX: number,
    centerY: number,
    radius: number,
    elevation: number
  ): void {
    // Fill circular area with specified elevation
    for (let x = centerX - radius; x <= centerX + radius; x++) {
      for (let y = centerY - radius; y <= centerY + radius; y++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

        if (distance <= radius) {
          // Smooth falloff from center to edge
          const falloff = 1 - distance / radius;
          const adjustedElevation = Math.floor(elevation * falloff * falloff);

          if (this.getHeight(x, y) < adjustedElevation) {
            this.setHeight(x, y, adjustedElevation);
          }
        }
      }
    }
  }

  /**
   * Generate sophisticated height map using diamond-square and fracture algorithms
   */
  public generateHeightMap(): void {
    // Step 1: Initialize with fracture map for landmass shapes
    this.generateFractureMap();

    // Step 2: Apply diamond-square algorithm for fractal detail
    const initialStep = Math.floor(HMAP_MAX_LEVEL / 4);
    const divisions = 4; // Number of initial blocks

    // Set up initial corner values for diamond-square
    for (let x = 0; x < divisions; x++) {
      for (let y = 0; y < divisions; y++) {
        const blockX = Math.floor((x * this.width) / divisions);
        const blockY = Math.floor((y * this.height) / divisions);
        const cornerValue = Math.floor(this.random() * HMAP_MAX_LEVEL);

        this.setHeight(blockX, blockY, cornerValue);
      }
    }

    // Apply diamond-square recursively on each block
    for (let x = 0; x < divisions; x++) {
      for (let y = 0; y < divisions; y++) {
        const xl = Math.floor((x * this.width) / divisions);
        const yt = Math.floor((y * this.height) / divisions);
        const xr = Math.floor(((x + 1) * this.width) / divisions);
        const yb = Math.floor(((y + 1) * this.height) / divisions);

        this.diamondSquareRecursive(initialStep, xl, yt, xr, yb);
      }
    }

    // Step 3: Apply pole flattening for realistic world geometry
    this.normalizeHeightMapPoles();

    // Step 4: Add final random variation
    for (let i = 0; i < this.heightMap.length; i++) {
      const fuzz = Math.floor(this.random() * 8) - 4;
      this.heightMap[i] = Math.max(0, Math.min(HMAP_MAX_LEVEL, 8 * this.heightMap[i] + fuzz));
    }

    // Step 5: Normalize to final height range
    this.normalizeHeightMap();
  }

  /**
   * Apply pole flattening for realistic world geometry
   * @reference freeciv/server/generator/height_map.c:65-75
   */
  private normalizeHeightMapPoles(): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        const colatitude = this.getColatitude(x, y);

        if (colatitude <= 2.5 * ICE_BASE_LEVEL) {
          const poleFactor = this.getPoleFactor(x, y);
          const currentHeight = this.getHeight(x, y);
          this.setHeight(x, y, currentHeight * poleFactor);
        } else if (this.isNearMapEdge(x, y)) {
          // Near map edge but not near pole - set to ocean
          this.setHeight(x, y, 0);
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
   * Apply smoothing passes to height map
   */
  public applySmoothingPasses(passes: number = 2): void {
    for (let pass = 0; pass < passes; pass++) {
      const newHeightMap = [...this.heightMap];

      for (let x = 1; x < this.width - 1; x++) {
        for (let y = 1; y < this.height - 1; y++) {
          const neighbors = [
            this.getHeight(x - 1, y - 1),
            this.getHeight(x, y - 1),
            this.getHeight(x + 1, y - 1),
            this.getHeight(x - 1, y),
            this.getHeight(x, y),
            this.getHeight(x + 1, y),
            this.getHeight(x - 1, y + 1),
            this.getHeight(x, y + 1),
            this.getHeight(x + 1, y + 1),
          ];

          const avgHeight = neighbors.reduce((sum, h) => sum + h, 0) / neighbors.length;
          newHeightMap[y * this.width + x] = Math.floor(avgHeight);
        }
      }

      this.heightMap = newHeightMap;
    }
  }

  /**
   * Get the generated height map
   */
  public getHeightMap(): number[] {
    return [...this.heightMap];
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
