# Freeciv References - Phase 4: Fractal Height Generation

## Overview

This document provides comprehensive references for all functions and algorithms ported from freeciv during Phase 4 implementation of the terrain generation system. Each ported function includes the original freeciv source location, algorithm description, and implementation notes.

## Phase 4: Fractal Height Generation System

### Core Reference Files

**Primary Sources:**
- `reference/freeciv/server/generator/height_map.c` - Main height generation algorithms
- `reference/freeciv/server/generator/fracture_map.c` - Landmass and fracture generation
- `reference/freeciv/server/generator/mapgen_topology.h` - Constants and mathematical formulas

---

## Ported Functions and Classes

### 1. FractalHeightGenerator Class
**Location**: `apps/server/src/game/MapManager.ts:227-595`  
**Reference**: Combination of multiple freeciv height generation systems

#### 1.1 Diamond-Square Algorithm (`diamondSquareRecursive`)

**Freeciv Reference**: `reference/freeciv/server/generator/height_map.c:120-182`  
**Original Function**: `gen5rec(int step, int xl, int yt, int xr, int yb)`

```typescript
// Ported from: height_map.c:120-182
private diamondSquareRecursive(step: number, xl: number, yt: number, xr: number, yb: number): void
```

**Algorithm Description:**
- Recursive fractal terrain generation using diamond-square method
- Divides rectangular regions into quadrants recursively
- Sets midpoints of sides and center with averaged values plus random variation
- Handles map wrapping for seamless world boundaries
- Reduces step size by factor of 2/3 for each recursive call

**Key Ported Elements:**
- Corner value extraction with wrapping: `val[0][0] = hmap(native_pos_to_tile(&(wld.map), xl, yt))`
- Midpoint calculation: `(val[0][0] + val[1][0]) / 2 + (int)fc_rand(step) - step / 2`
- Recursive subdivision: `gen5rec(2 * step / 3, xl, yt, (xr + xl) / 2, (yb + yt) / 2)`

#### 1.2 Pole Flattening System (`getPoleFactor`, `normalizeHeightMapPoles`)

**Freeciv Reference**: `reference/freeciv/server/generator/height_map.c:35-75`  
**Original Functions**: `hmap_pole_factor()`, `normalize_hmap_poles()`

```typescript
// Ported from: height_map.c:35-57
private getPoleFactor(x: number, y: number): number

// Ported from: height_map.c:65-75  
private normalizeHeightMapPoles(): void
```

**Algorithm Description:**
- Applies realistic world geometry by flattening polar regions
- Uses colatitude calculations to determine distance from equator
- Linear ramp from 100% at 2.5*ICE_BASE_LEVEL to (100-flatpoles)% at poles
- Special handling for map edges and polar separation bands

**Key Ported Formulas:**
```typescript
// Original: factor = 1 - ((1 - (map_colatitude(ptile) / (2.5 * ICE_BASE_LEVEL))) * wld.map.server.flatpoles / 100)
factor = 1 - ((1 - colatitude / (2.5 * ICE_BASE_LEVEL)) * this.flatpoles) / 100;

// Original: hmap(ptile) *= hmap_pole_factor(ptile)
this.setHeight(x, y, currentHeight * poleFactor);
```

#### 1.3 Fracture Map Generation (`generateFractureMap`, `createCircularLandmass`)

**Freeciv Reference**: `reference/freeciv/server/generator/fracture_map.c:55-150`  
**Original Function**: `make_fracture_map()`

```typescript
// Ported from: fracture_map.c:55-150
public generateFractureMap(): void

// Ported from: fracture_map.c circle generation concept
private createCircularLandmass(centerX: number, centerY: number, radius: number, elevation: number): void
```

**Algorithm Description:**
- Creates strategic landmass points for realistic continent shapes
- Places border points for ocean generation at map edges
- Generates random interior points for landmass centers
- Uses circular regions with falloff for smooth landmass boundaries

**Key Ported Elements:**
```typescript
// Original: num_landmass = 20 + 15 * get_sqsize()
const numLandmass = Math.floor(20 + 15 * (mapSize / 50));

// Original border placement: fracture_points[nn].x = x; fracture_points[nn].y = 3;
for (let x = 3; x < this.width; x += borderSpacing) {
  fracturePoints.push({ x, y: 3 });
}
```

#### 1.4 Height Map Smoothing (`applySmoothingPasses`)

**Freeciv Reference**: Concept from `reference/freeciv/server/generator/height_map.c` smoothing operations  
**Original Approach**: Multiple smoothing passes in freeciv terrain generation

```typescript
// Inspired by freeciv smoothing algorithms
public applySmoothingPasses(passes: number = 2): void
```

**Algorithm Description:**
- Applies multiple passes of neighbor averaging for smooth transitions
- 9-point kernel averaging (center + 8 neighbors)
- Preserves map boundaries while smoothing interior regions

#### 1.5 Colatitude Calculation (`getColatitude`)

**Freeciv Reference**: `reference/freeciv/server/generator/mapgen_topology.h` and `temperature_map.c`  
**Original Function**: `map_colatitude(ptile)` concept

```typescript
// Ported from freeciv colatitude calculation concept
private getColatitude(_x: number, y: number): number
```

**Algorithm Description:**
- Calculates distance from equator for latitude-based effects
- Used in pole flattening and climate calculations
- Normalizes latitude factor to MAX_COLATITUDE scale

---

## Constants and Parameters

### Height Map Constants

**Freeciv Reference**: `reference/freeciv/server/generator/height_map.h` and related files

```typescript
// Ported from freeciv height_map.h constants
const HMAP_MAX_LEVEL = 1000;        // Original: hmap_max_level
const HMAP_SHORE_LEVEL = 250;       // Original: hmap_shore_level  
const DEFAULT_STEEPNESS = 30;       // Original: wld.map.server.steepness
const DEFAULT_FLATPOLES = 100;      // Original: wld.map.server.flatpoles
```

### Climate Integration Constants

**Freeciv Reference**: `reference/freeciv/server/generator/mapgen_topology.h`

```typescript
// Already implemented in Phase 3, used in Phase 4
const MAX_COLATITUDE = 1000;        // Original: MAP_MAX_LATITUDE
const ICE_BASE_LEVEL = 200;         // Original: ice_base_colatitude
```

---

## Algorithm Integration Points

### 1. Main Generation Pipeline

**Location**: `apps/server/src/game/MapManager.ts:1142-1163`  
**Integration**: Replaces simple elevation generation with sophisticated fractal system

```typescript
// Phase 4: Generate sophisticated height map using fractal algorithms
const heightGenerator = new FractalHeightGenerator(this.width, this.height, random);
heightGenerator.generateHeightMap();
heightGenerator.applySmoothingPasses(2);
```

### 2. Climate System Integration

**Integration Point**: Height maps feed into existing Phase 3 climate system  
**Reference**: Maintains compatibility with `TemperatureMap.createTemperatureMap()`

```typescript
// Phase 3: Create height map for temperature calculations
const heightMap = new Array(this.width * this.height);
for (let x = 0; x < this.width; x++) {
  for (let y = 0; y < this.height; y++) {
    heightMap[y * this.width + x] = tiles[x][y].elevation;
  }
}
this.temperatureMap.createTemperatureMap(tiles, heightMap, true);
```

---

## Mathematical Formulas Ported

### 1. Mountain Level Calculation

**Freeciv Reference**: `reference/freeciv/server/generator/fracture_map.c:64-66`

```typescript
// Original: hmap_mountain_level = (((hmap_max_level - hmap_shore_level) * (100 - wld.map.server.steepness)) / 100 + hmap_shore_level)
this.mountainLevel = Math.floor(
  ((HMAP_MAX_LEVEL - this.shoreLevel) * (100 - this.steepness)) / 100 + this.shoreLevel
);
```

### 2. Landmass Count Calculation

**Freeciv Reference**: `reference/freeciv/server/generator/fracture_map.c:69`

```typescript
// Original: num_landmass = 20 + 15 * get_sqsize()
const numLandmass = Math.floor(20 + 15 * (mapSize / 50));
```

### 3. Random Variation in Diamond-Square

**Freeciv Reference**: `reference/freeciv/server/generator/height_map.c:162-173`

```typescript
// Original: (int)fc_rand(step) - step / 2
const randomVariation = (this.random() * step) - step / 2;
```

---

## Testing and Validation

### Comprehensive Test Coverage

**Location**: `apps/server/tests/game/MapManager.test.ts:593-864`  
**Test Cases**: 10 new tests specifically for Phase 4 fractal generation

1. **Sophisticated Height Generation** - Validates fractal algorithm variety
2. **Pole Flattening** - Tests realistic world geometry
3. **Landmass Shape Generation** - Validates fracture map system
4. **Diamond-Square Distribution** - Tests height distribution realism
5. **Smoothing Effectiveness** - Validates terrain transition smoothness
6. **Ocean Boundary Creation** - Tests edge ocean generation
7. **Elevation-Terrain Consistency** - Validates terrain type relationships
8. **Reproducible Generation** - Tests seed-based consistency
9. **Multi-Size Support** - Validates algorithm scaling
10. **Integration Validation** - Tests climate system compatibility

---

## Performance Considerations

### Algorithm Complexity

**Diamond-Square**: O(n log n) where n is map size  
**Fracture Map**: O(k * r²) where k is landmass count, r is radius  
**Smoothing**: O(n * passes) where n is map size  

### Memory Usage

- **Height Map**: width × height × 4 bytes (32-bit integers)
- **Temporary Arrays**: Minimal additional memory for smoothing passes
- **Landmass Points**: Approximately 50-200 points for typical map sizes

---

## Future Integration Points

### Phase 5 Preparation

The fractal height generation system provides foundation for:

1. **Island Generation** - Height thresholds for water/land classification
2. **Terrain Distribution** - Elevation-based terrain type assignment
3. **Starting Positions** - Height-based suitability analysis
4. **Continent Quality** - Landmass size and shape evaluation

### Extensibility

The `FractalHeightGenerator` class is designed for future enhancement:

- **Parameter Configurability** - Easy adjustment of steepness, flatpoles, etc.
- **Algorithm Variants** - Support for different fractal generation methods
- **Climate Integration** - Enhanced elevation-temperature relationships
- **Multiplayer Balancing** - Fair landmass distribution algorithms

---

## References Summary

| Component | Freeciv Source | Lines | Implementation |
|-----------|---------------|-------|----------------|
| Diamond-Square | `height_map.c:120-182` | 62 | `diamondSquareRecursive()` |
| Pole Flattening | `height_map.c:35-75` | 40 | `getPoleFactor()`, `normalizeHeightMapPoles()` |
| Fracture Maps | `fracture_map.c:55-150` | 95 | `generateFractureMap()` |
| Height Smoothing | Various smoothing concepts | - | `applySmoothingPasses()` |
| Constants | `height_map.h`, `mapgen_topology.h` | - | All height/terrain constants |

**Total Reference Coverage**: ~200+ lines of freeciv algorithms successfully ported  
**Implementation Size**: 595+ lines of TypeScript with comprehensive error handling and type safety

This documentation ensures full traceability of all ported algorithms back to their freeciv origins, maintaining compatibility with the reference implementation while adapting to modern TypeScript patterns.