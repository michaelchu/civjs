# World Shapes & Tiles Implementation Audit

**Date:** 2025-01-27  
**Scope:** Audit of world topology and tile system implementation  
**Focus:** Isometric tiles with world shape support (flat, cylindrical, torus)

## Executive Summary

This audit evaluates the current implementation of world shapes and tile systems in CivJS. The analysis reveals that **world shapes and tiles are NOT currently first-class parameters** in the system. The implementation is hardcoded for flat, isometric square tiles with limited topology awareness.

**Key Finding:** The system needs a configurable world shape parameter to support flat, cylindrical (E-W wrap), and torus (E-W + N-S wrap) topologies while maintaining the existing isometric tile rendering.

## Current Implementation Analysis

### 1. World Shape Configuration - **MISSING**

**Status:** ❌ Not implemented as first-class parameter

**Current State:**
- Hardcoded `wrap_id: 0` in `apps/server/src/network/socket-handlers.ts`
- No world shape configuration in MapManager constructor
- Missing topology negotiation between client and server

**Evidence:**
```typescript
// apps/server/src/network/socket-handlers.ts:14
wrap_id: 0,  // Always flat world - hardcoded
```

### 2. Tile System Implementation - **PARTIAL**

**Status:** ✅ Isometric tiles well-implemented, but lacks configurability

**Current State:**
- Fixed isometric square tile rendering
- Hardcoded `is_isometric: 1` in TilesetLoader
- No support for dynamic tile type selection
- Excellent isometric coordinate transformation system

**Evidence:**
```typescript
// apps/client/src/components/Canvas2D/TilesetLoader.ts:58
is_isometric: (window as any).is_isometric || 1,  // Hardcoded
```

### 3. Coordinate System & Wrapping - **PARTIAL**

**Status:** ✅ Basic wrapping logic exists, ❌ not topology-aware

**Current State:**
- WRAP_X/WRAP_Y constants defined in MapRenderer
- Wrapping detection and normalization implemented
- Missing integration with world shape configuration
- No cylindrical vs torus distinction

**Evidence:**
```typescript
// apps/client/src/components/Canvas2D/MapRenderer.ts:1096-1097
private static readonly WRAP_X = 1;
private static readonly WRAP_Y = 2;
```

### 4. Map Generation Integration - **MISSING**

**Status:** ❌ No topology awareness in generators

**Current State:**
- Map generators don't receive world shape parameters
- Height map generation assumes flat topology
- Island generators lack wrapping awareness
- No boundary handling for wrapped worlds

## Freeciv Reference Analysis

### Topology System in Freeciv

Freeciv implements a comprehensive topology system with these flags:

```c
// freeciv/common/fc_types.h:454-474
enum topo_flag {
  TF_ISO,        // Isometric view
  TF_HEX,        // Hexagonal tiles  
  TF_OLD_WRAPX,  // Legacy X wrapping
  TF_OLD_WRAPY   // Legacy Y wrapping
};

enum wrap_flag {
  WRAP_X,  // East-West wrapping (cylindrical)
  WRAP_Y   // North-South wrapping (enables torus)
};
```

**World Shape Matrix:**
- **Flat:** `wrap_id = 0` (no wrapping)
- **Cylindrical:** `wrap_id = WRAP_X` (E-W wrapping only)
- **Torus:** `wrap_id = WRAP_X | WRAP_Y` (E-W + N-S wrapping)

## Recommendations

### Priority 1: World Shape as First-Class Parameter

**Implementation:**
```typescript
interface WorldShapeConfig {
  shape: 'flat' | 'cylindrical' | 'torus';
  wrap_x: boolean;  // East-West wrapping
  wrap_y: boolean;  // North-South wrapping
}

// MapManager constructor update
constructor(
  width: number,
  height: number,
  worldShape: WorldShapeConfig,
  seed?: string,
  // ... other params
)
```

**Benefits:**
- Makes world topology configurable
- Enables multiplayer compatibility with different world types
- Supports varied gameplay experiences

### Priority 2: Map Generation Integration

**Changes Required:**
1. Pass world shape to all generators:
   - `FractalHeightGenerator`
   - `IslandGenerator` 
   - `TerrainGenerator`
   - `RiverGenerator`

2. Update generators to handle wrapping:
   - Height map edge handling for wrapped worlds
   - Island placement across wrap boundaries
   - River generation considering topology

**Example:**
```typescript
// Update FractalHeightGenerator constructor
constructor(
  width: number,
  height: number,
  random: () => number,
  worldShape: WorldShapeConfig,  // NEW
  steepness: number = DEFAULT_STEEPNESS,
  // ... other params
)
```

### Priority 3: Enhanced Network Protocol

**Changes Required:**
1. Replace hardcoded `wrap_id: 0` with configurable value
2. Add world shape negotiation during game setup
3. Validate world shape compatibility between client/server

**Example:**
```typescript
// socket-handlers.ts update
const mapInfo = {
  xsize: mapData.width,
  ysize: mapData.height,
  wrap_id: calculateWrapId(worldShape), // Dynamic
  topology_id: TF_ISO, // Isometric only for now
};
```

### Priority 4: Coordinate System Enhancement

**Changes Required:**
1. Make wrapping behavior topology-aware
2. Update boundary detection for different world shapes
3. Enhance map viewport constraints for wrapped worlds

## Implementation Scope (Isometric Focus)

Since we're focusing on isometric tiles only, the implementation scope is:

**In Scope:**
- ✅ World shape configuration (flat, cylindrical, torus)
- ✅ Isometric tile rendering (existing system)
- ✅ Topology-aware coordinate wrapping
- ✅ Map generation integration

**Out of Scope:**
- ❌ Hexagonal tile support
- ❌ Square (non-isometric) tile support
- ❌ Dynamic tile type switching
- ❌ Multiple tileset support

## Files Requiring Changes

### Server-Side
1. `apps/server/src/game/MapManager.ts` - Add WorldShapeConfig parameter
2. `apps/server/src/game/map/FractalHeightGenerator.ts` - Topology-aware generation
3. `apps/server/src/game/map/IslandGenerator.ts` - Wrapping-aware placement
4. `apps/server/src/network/socket-handlers.ts` - Dynamic wrap_id configuration

### Client-Side
5. `apps/client/src/components/Canvas2D/MapRenderer.ts` - Enhanced wrapping logic
6. `apps/client/src/services/GameClient.ts` - World shape negotiation
7. `apps/client/src/types/index.ts` - WorldShapeConfig interface

### Shared
8. New: `apps/shared/src/types/WorldShape.ts` - Common type definitions

## Impact Assessment

**Complexity:** Medium - Focused scope reduces implementation complexity  
**Breaking Changes:** Yes - Network protocol and constructor signatures  
**Testing Required:** Extensive - All three world shapes need validation  
**Performance Impact:** Minimal - Mostly configuration-driven changes

## Conclusion

The current implementation lacks world shape as a first-class parameter. The recommended changes will enable configurable world topologies (flat, cylindrical, torus) while maintaining the existing, well-implemented isometric tile system. This provides essential gameplay variety without the complexity of supporting multiple tile shapes.

**Next Steps:**
1. Implement WorldShapeConfig interface
2. Update MapManager to accept world shape parameter
3. Integrate world shape into map generation pipeline
4. Enhance network protocol for topology negotiation