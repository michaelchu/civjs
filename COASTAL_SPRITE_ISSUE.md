# Coastal Sprite Blending Issue

## Problem Description
The game currently shows sharp, rectangular transitions between ocean/water tiles and land tiles instead of smooth coastal blending. This creates jagged edges rather than natural-looking shorelines.

## Expected Behavior
- Smooth transitions between ocean, coast, and land tiles
- Coast tiles should use cellgroup sprites that blend seamlessly
- Multi-layer terrain rendering should create natural shoreline appearance
- Should match freeciv-web's coastal rendering behavior

## Root Cause Analysis
The issue lies in the CELL_CORNER sprite rendering system for terrain blending. The original freeciv-web uses a complex algorithm to:
1. Analyze neighboring terrain types for each tile corner
2. Generate appropriate cellgroup sprite keys based on neighbor matches
3. Render multiple layers (0, 1, 2) with different sprite types
4. Use MATCH_FULL algorithm for smooth blending

## Key Components Involved

### 1. Terrain Configuration
- `tileset_config_amplio2.js` defines terrain match styles and indices
- `l0.coast`: MATCH_FULL with match_index [0,1,2] (floor, coast, land)
- `l0.floor`: MATCH_FULL with match_index [1,0,2] (coast, floor, land)

### 2. Sprite Naming Convention
- Base sprites: `t.l0.cellgroup_d_d_d_d` (no corner suffix in ocean.spec)
- Generated keys: `t.l0.cellgroup_l_l_l_d.0` (with corner index)
- Cellgroup mapping: `cellgroup_map["coast.123"] = "t.l0.cellgroup_s_l_d_s"`

### 3. Multi-Layer Rendering
- Layer 0: Base terrain with complex MATCH_FULL blending
- Layer 1: Additional coastal details with MATCH_PAIR
- Layer 2: Special features and irrigation

## Attempted Fixes

### Fix 1: Remove Debug Logging
- **Problem**: Performance-impacting console logs
- **Solution**: Removed all debug logging from MapRenderer
- **Result**: ✅ Fixed performance, but coastal issue persisted

### Fix 2: Sprite Name Correction
- **Problem**: Appending corner indices `.0`, `.1`, `.2`, `.3` to sprite names
- **Solution**: Tried removing corner index, then restored it
- **Result**: ❌ Broke ocean rendering completely, then restored but issue persisted

### Fix 3: Terrain Object Structure
- **Problem**: Synthetic terrain objects with only `graphic_str`
- **Solution**: Created full terrain objects with `id`, `name`, `graphic_str`
- **Result**: ✅ Fixed glitchy rendering, but coastal blending still not working

### Fix 4: CELL_CORNER Match Logic
- **Problem**: Using `ts_tiles` match_type instead of `tile_types_setup` match_index
- **Solution**: Copied exact logic from reference tilespec.js lines 579, 591-593
- **Result**: ❌ Still no coastal blending

### Fix 5: Terrain Match Indices
- **Problem**: Terrain IDs didn't align with tileset match_index expectations
- **Solution**: Set ocean=0, coast=1, land=2 to match tileset configuration
- **Result**: ❌ Issue persists

## Current Implementation Status

### Working Components
- ✅ Multi-layer terrain rendering (layers 0, 1, 2)
- ✅ CELL_CORNER algorithm implementation
- ✅ Proper terrain object structure
- ✅ Neighbor tile lookup optimization
- ✅ Basic terrain sprite rendering

### Not Working
- ❌ Coastal sprite blending - still showing sharp edges
- ❌ Cellgroup sprite generation/rendering
- ❌ MATCH_FULL algorithm producing visible results

## Key Code Locations

### MapRenderer.ts
- `renderTerrainLayers()`: Multi-layer rendering loop
- `fillTerrainSpriteArraySimple()`: Main terrain sprite logic
- `CELL_CORNER` case: Complex neighbor-based sprite selection
- `MATCH_FULL` case: Coastal blending algorithm
- `getNeighboringTerrains()`: 8-directional neighbor lookup

### TilesetLoader.ts
- `cacheSprites()`: Sprite extraction and caching
- `getSprite()`: Sprite lookup for rendering
- `exposeTilesetGlobals()`: Makes terrain config available

## Next Steps for Investigation

1. **Verify Sprite Availability**: Check if generated cellgroup sprite keys actually exist in tileset
2. **Debug Match Indices**: Log actual vs expected match indices for coastal tiles
3. **Inspect Original Logic**: Compare our MATCH_FULL implementation line-by-line with reference
4. **Check Layer Rendering**: Ensure all layers are rendering and not overriding each other
5. **Validate Cellgroup Mapping**: Confirm cellgroup_map is working correctly

## Reference Files
- `reference/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js` (lines 566-650)
- `reference/freeciv-web/src/main/webapp/javascript/2dcanvas/tileset_config_amplio2.js`
- `reference/freeciv/data/amplio2/ocean.spec`

## Test Case
Focus on tiles at ocean-to-land boundaries, particularly coordinates where ocean, coast, and grassland tiles meet. The transitions should show smooth blending rather than sharp rectangular edges.