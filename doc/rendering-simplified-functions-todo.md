# Rendering System: Simplified Functions To-Do

**Date:** 2025-08-24  
**Status:** Phase 1 Complete - Core Rendering Functional  
**Next Phase:** Expand Simplified Functions  

## Overview

During the Phase 1 port of the freeciv-web rendering system to TypeScript, several complex functions were implemented as simplified versions to prioritize getting the core rendering engine functional. This document outlines what was simplified and needs full implementation in future phases.

## ✅ Fully Ported Functions (27 functions)

### Core Rendering Engine
- **`fill_sprite_array()`** - Main rendering orchestration (all 13 layers) ✅ **COMPLETE**
- **`tileset_has_tag()`** - Sprite availability checking ✅ **COMPLETE**

### Terrain Rendering (3 functions)
- **`tile_terrain()`** - Returns terrain type ✅ **COMPLETE**
- **`tile_terrain_near()`** - Neighboring terrain analysis ✅ **COMPLETE**  
- **`fill_terrain_sprite_layer()`** - Multi-layer terrain with dithering ✅ **COMPLETE**

### Tile Content (3 functions)
- **`tile_has_extra()`** - Extra/improvement detection ✅ **COMPLETE**
- **`get_tile_river_sprite()`** - River graphics with neighbor detection ✅ **COMPLETE**
- **`get_tile_specials_sprite()`** - Resource sprite selection ✅ **COMPLETE**

### Path/Road Rendering (2 functions)  
- **`fill_path_sprite_array()`** - Roads/rails/maglev with connections ✅ **COMPLETE**
- **`fill_irrigation_sprite_array()`** - Irrigation and farmland ✅ **COMPLETE**

### Unit Rendering (3 functions)
- **`fill_unit_sprite_array()`** - Complete unit rendering pipeline ✅ **COMPLETE**
- **`unit_is_in_focus()`** - Selection state detection ✅ **COMPLETE**
- **`get_select_sprite()`** - Animated selection highlighting ✅ **COMPLETE**

### Fog of War (1 function)
- **`fill_fog_sprite_array()`** - Corner-based fog rendering ✅ **COMPLETE**

### City Rendering (3 functions)
- **`get_city_sprite()`** - City size/wall graphics ✅ **COMPLETE**
- **`city_tile()`** - City location lookup ✅ **COMPLETE**  
- **`map_distance_vector()`** - Distance calculation ✅ **COMPLETE**

### Tileset Tag Resolution (8 functions)
- **`tileset_ruleset_entity_tag_str_or_alt()`** - Generic tag resolution ✅ **COMPLETE**
- **`tileset_extra_graphic_tag()`** - Extra graphics ✅ **COMPLETE**
- **`tileset_unit_type_graphic_tag()`** - Unit type graphics ✅ **COMPLETE**
- **`tileset_unit_graphic_tag()`** - Unit instance graphics ✅ **COMPLETE**
- **`tileset_building_graphic_tag()`** - Building graphics ✅ **COMPLETE**
- **`tileset_tech_graphic_tag()`** - Technology graphics ✅ **COMPLETE**
- **`tileset_extra_id_graphic_tag()`** - Extra by ID ✅ **COMPLETE**
- **`dir_get_tileset_name()`** - Direction naming ✅ **COMPLETE**

## 🟡 Simplified Functions Needing Full Implementation

### 1. Layer Rendering Functions (3 functions)

#### `fill_layer1_sprite_array()` - **PRIORITY: MEDIUM**
**Current Implementation:** Basic fortress rendering only
```typescript
// Simplified - only handles fortresses
if (tile_has_extra(ptile, EXTRA_FORTRESS)) {
  result_sprites.push({
    key: 'base.fortress_bg', 
    offset_y: -normal_tile_height / 2,
  });
}
```

**Needs Full Implementation:**
- **Mine graphics** - Resource extraction visualizations  
- **Road intersections** - Complex road/rail junctions
- **Irrigation connections** - Connected irrigation systems
- **Base combinations** - Multiple bases on same tile
- **Activity overlays** - Worker activity animations
- **Resource indicators** - Special resource markers

**Original Complexity:** ~80 lines with complex base interaction logic

**Impact:** Missing visual details for tile improvements, but core gameplay unaffected

---

#### `fill_layer2_sprite_array()` - **PRIORITY: MEDIUM**  
**Current Implementation:** Basic airbase/ruins only
```typescript
// Simplified - only handles basic bases
if (tile_has_extra(ptile, EXTRA_AIRBASE)) {
  result_sprites.push({
    key: 'base.airbase_mg',
    offset_y: -normal_tile_height / 2,
  });
}
```

**Needs Full Implementation:**
- **Buoy graphics** - Ocean navigation markers
- **Flag overlays** - Base ownership flags  
- **Pollution effects** - Environmental damage visualization
- **Fallout rendering** - Nuclear aftermath graphics
- **Advanced base types** - Modern military installations
- **Stacking logic** - Multiple improvements per tile

**Original Complexity:** ~90 lines with pollution/fallout/buoy logic

**Impact:** Missing environmental effects and advanced base visualizations

---

#### `fill_layer3_sprite_array()` - **PRIORITY: MEDIUM**
**Current Implementation:** Basic fortress foreground only  
```typescript
// Simplified - only fortress foreground  
if (tile_has_extra(ptile, EXTRA_FORTRESS)) {
  result_sprites.push({
    key: 'base.fortress_fg',
    offset_y: -normal_tile_height / 2,
  });
}
```

**Needs Full Implementation:**
- **Foreground base elements** - Walls, towers, antenna
- **Unit activity overlays** - Construction/mining animations
- **Veteran indicators** - Experience level markers
- **Action decision markers** - Player choice indicators  
- **Status effect overlays** - Temporary condition graphics
- **Stacked unit indicators** - Multiple unit visualization

**Original Complexity:** ~75 lines with foreground element layering

**Impact:** Missing foreground visual details and unit status indicators

### 2. Border/Political Functions (1 function)

#### `get_border_line_sprites()` - **PRIORITY: LOW**
**Current Implementation:** Empty array (no borders shown)
```typescript
// Simplified - no borders rendered
return [];
```

**Needs Full Implementation:**
- **National boundary detection** - Territory ownership analysis
- **Border line generation** - Geometric boundary calculation  
- **Diplomatic status colors** - War/peace/alliance indicators
- **Cultural boundaries** - Influence zone visualization
- **Border crossing animations** - Unit movement effects
- **Treaty zone markers** - Special agreement areas

**Original Complexity:** ~120 lines with complex political boundary algorithms

**Impact:** No national borders visible (visual only - no gameplay impact)

### 3. Advanced Path Functions (1 function)

#### `fill_goto_line_sprite_array()` - **PRIORITY: LOW**
**Current Implementation:** Basic directional paths only
```typescript  
// Simplified - basic direction only
if (ptile.goto_dir != null) {
  result_sprites.push({
    key: 'goto.path_' + dir_get_tileset_name(ptile.goto_dir),
    offset_x: 0, offset_y: 0,
  });
}
```

**Needs Full Implementation:**
- **Multi-waypoint paths** - Complex route visualization
- **Turn-by-turn navigation** - Step-by-step path display
- **Alternative route display** - Multiple path options
- **Movement cost indicators** - Time/resource requirements  
- **Terrain difficulty markers** - Movement penalty visualization
- **Unit-specific pathing** - Different paths for different unit types

**Original Complexity:** ~65 lines with pathfinding integration

**Impact:** Simplified movement visualization (basic paths work, advanced features missing)

## 📋 Implementation Roadmap

### Phase 2: Core Improvements (Estimated: 2-3 days)
1. **Expand layer functions** - Add missing base types and improvements
2. **Implement pollution/fallout** - Environmental damage visualization
3. **Add resource indicators** - Special resource markers

### Phase 3: Visual Polish (Estimated: 1-2 days)  
1. **Implement border rendering** - National boundary visualization
2. **Advanced goto paths** - Multi-waypoint route display
3. **Activity animations** - Worker/construction overlays

### Phase 4: Advanced Features (Estimated: 1 day)
1. **Stacking indicators** - Multiple unit visualization
2. **Status effect overlays** - Temporary condition graphics
3. **Diplomatic indicators** - Alliance/war markers

## 📁 Reference Files

### Original JavaScript Implementations
- **`/root/repo/apps/client/src/rendering/tilespec.js`** - Lines 1710-1850 (layer functions)
- **`/root/repo/apps/server/public/js/2dcanvas/tilespec.js`** - Full reference implementation  

### Current TypeScript Implementation  
- **`/root/repo/apps/client/src/rendering/tilespec.ts`** - All simplified functions marked with "TODO"

### Constants and Configuration
- **`/root/repo/apps/client/src/rendering/constants.ts`** - Rendering layer definitions
- **`/root/repo/apps/client/src/rendering/types.ts`** - TypeScript interfaces

## 🔧 Technical Notes

### Dependencies for Full Implementation
1. **Game state integration** - Need access to tile improvement data
2. **Political system data** - Territory ownership and diplomatic status  
3. **Activity system** - Worker actions and construction states
4. **Pathfinding integration** - Movement calculation system

### Performance Considerations
- Layer functions are called frequently during rendering
- Border detection requires neighbor analysis (expensive)
- Path visualization needs efficient caching

### Testing Strategy  
1. **Visual regression tests** - Compare screenshots before/after changes
2. **Performance benchmarks** - Ensure no rendering slowdowns
3. **Game state integration** - Test with real game data

## 🎯 Success Criteria

### Phase 2 Complete When:
- ✅ All base types render correctly (fortress, airbase, buoy, etc.)
- ✅ Pollution and fallout effects display properly  
- ✅ Resource indicators show on appropriate tiles
- ✅ Multiple improvements stack correctly on tiles

### Phase 3 Complete When:
- ✅ National borders display with correct colors
- ✅ Complex goto paths render with waypoints
- ✅ Worker activity animations play correctly

### Final Success:
- ✅ Visual parity with original freeciv-web client  
- ✅ No performance regression from original
- ✅ All rendering layers display correctly
- ✅ TypeScript compilation with no errors
- ✅ ESLint compliance maintained

---

*This document will be updated as functions are implemented. Mark completed items with ✅ and update the status accordingly.*