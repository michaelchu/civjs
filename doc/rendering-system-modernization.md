# Rendering System Modernization Plan

## Overview

The current rendering system heavily relies on freeciv-web legacy patterns with extensive use of window globals, dynamic script loading, and C-style rendering algorithms. This document outlines a comprehensive plan to modernize the rendering architecture while maintaining compatibility with existing game mechanics and sprites.

## Current State Analysis

### Legacy Dependencies Identified

#### 1. Window Global Dependencies
- **MapRenderer.ts**: Accesses `tile_types_setup`, `ts_tiles`, `cellgroup_map`, `tileset` via `(window as any)`
- **TilesetLoader.ts**: Reads tileset configuration from window globals:
  - `tileset_tile_width`, `tileset_tile_height`
  - `tileset_name`, `tileset_image_count`
  - `is_isometric`

#### 2. External JavaScript File Dependencies
- `apps/server/public/js/2dcanvas/tileset_config_amplio2.js` - Sets tileset dimensions and configuration as globals
- `apps/server/public/js/2dcanvas/tileset_spec_amplio2.js` - Defines sprite coordinates as globals  
- `apps/server/public/js/2dcanvas/tilespec.js` - Contains rendering constants and algorithms
- All loaded via dynamic script injection in `TilesetLoader`

#### 3. Hardcoded Legacy Patterns
- Magic numbers scattered throughout: `[48, 0, 48, 0]`, `[0, 24, 24, 0]` for dither offsets
- Direct translations from freeciv-web C-style code patterns
- Complex terrain blending logic mixed with rendering responsibilities
- Inconsistent constant definitions across files

### Files Affected
- `/apps/client/index.html` - ✅ **RESOLVED**: Removed global constants script
- `/apps/client/src/components/Canvas2D/MapRenderer.ts` - ✅ **PARTIALLY RESOLVED**: Constants now imported
- `/apps/client/src/components/Canvas2D/TilesetLoader.ts` - ❌ **NEEDS WORK**: Still uses window globals
- `/apps/client/src/constants/tileset.ts` - ✅ **CREATED**: Modern constants module

## Modernization Plan

### Phase 1: Complete Constants & Configuration System ✅ **STARTED**

#### 1.1 Expand Constants Module ✅ **PARTIAL**
- ✅ Created `/apps/client/src/constants/tileset.ts` with basic MATCH_* and CELL_* constants
- ❌ **TODO**: Add all rendering constants from `tilespec.js`:
  - Layer definitions (`LAYER_TERRAIN1`, `LAYER_CITY1`, etc.)
  - Direction constants (`DIR4_TO_DIR8`, `NUM_CORNER_DIRS`)
  - Rendering pipeline constants

```typescript
// Proposed expansion of constants/tileset.ts
export const RENDERING_CONSTANTS = {
  // Existing MATCH_* and CELL_* constants...
  
  // Layer definitions
  LAYER_TERRAIN1: 0,
  LAYER_TERRAIN2: 1,
  LAYER_TERRAIN3: 2,
  LAYER_ROADS: 3,
  LAYER_SPECIAL1: 4,
  LAYER_CITY1: 5,
  // ... all layers
  
  // Direction constants
  DIR4_TO_DIR8: [0, 2, 4, 6],
  NUM_CORNER_DIRS: 4,
  
  // Rendering dimensions
  DITHER_OFFSET_X: [48, 0, 48, 0],
  DITHER_OFFSET_Y: [0, 24, 24, 0]
} as const;
```

#### 1.2 Create Tileset Configuration System ❌ **TODO**
Create `/apps/client/src/config/tileset.ts`:

```typescript
interface TilesetConfig {
  tileWidth: number;
  tileHeight: number;
  name: string;
  imageCount: number;
  isIsometric: boolean;
}

interface SpriteSpec {
  [spriteTag: string]: {
    x: number;
    y: number;
    width: number;
    height: number;
    sheetIndex: number;
  };
}

interface TerrainConfig {
  [terrainKey: string]: {
    matchStyle: MatchStyle;
    spriteType: CellType;
    mineTag: string;
    matchIndices: number[];
    dither: boolean;
  };
}
```

### Phase 2: Modern Asset Loading System ❌ **TODO**

#### 2.1 Replace Dynamic Script Loading
Convert JavaScript configuration files to JSON:

**Target**: `/apps/client/src/assets/tilesets/amplio2/`
- `config.json` (from `tileset_config_amplio2.js`)
- `sprites.json` (from `tileset_spec_amplio2.js`)  
- `terrain.json` (terrain definitions from configuration)

#### 2.2 Implement Fetch-Based Loading
Replace `TilesetLoader.ts` script injection with:

```typescript
class ModernTilesetLoader {
  async loadTileset(tilesetName: string): Promise<TilesetData> {
    const [config, sprites, terrain] = await Promise.all([
      fetch(`/assets/tilesets/${tilesetName}/config.json`).then(r => r.json()),
      fetch(`/assets/tilesets/${tilesetName}/sprites.json`).then(r => r.json()),
      fetch(`/assets/tilesets/${tilesetName}/terrain.json`).then(r => r.json())
    ]);
    
    return this.validateAndProcessTilesetData({ config, sprites, terrain });
  }
}
```

### Phase 3: Clean MapRenderer Architecture ❌ **TODO**

#### 3.1 Eliminate Window Globals
Update `MapRenderer.ts` constructor to receive tileset data:

```typescript
class MapRenderer {
  constructor(
    private canvas: HTMLCanvasElement,
    private tilesetData: TilesetData,  // Injected, not from window
    private spriteLoader: SpriteLoader
  ) {}
  
  // Remove all (window as any) references
  private getTerrainSprites(/* params */): SpriteDefinition[] {
    const { terrainConfig } = this.tilesetData; // Not from window
    // ... clean implementation
  }
}
```

#### 3.2 Extract Rendering Algorithms
Separate concerns into dedicated classes:

```typescript
// terrain/TerrainBlender.ts
class TerrainBlender {
  calculateBlendSprites(terrain: TerrainData, neighbors: TerrainData[]): SpriteDefinition[];
}

// sprites/SpriteSelector.ts  
class SpriteSelector {
  selectSprite(criteria: SelectionCriteria): string;
}

// rendering/RenderingPipeline.ts
class RenderingPipeline {
  renderTile(tile: TileData, viewport: Viewport): void;
}
```

### Phase 4: Type Safety & Testing ❌ **TODO**

#### 4.1 Replace Any Types
Convert all `any` types to proper interfaces:

```typescript
interface TerrainData {
  id: number;
  name: string;
  graphicStr: string;
  movement: number;
}

interface TileData {
  terrain: TerrainData;
  extras: ExtraData[];
  position: { x: number; y: number };
}
```

#### 4.2 Add Validation & Error Handling
- Runtime validation of tileset configuration
- Graceful fallbacks for missing sprites
- Comprehensive error messages for development

#### 4.3 Make System Testable
- Remove all global dependencies
- Create mockable interfaces for testing
- Add unit tests for rendering algorithms

## Implementation Priority

### High Priority (Phase 1)
1. ✅ **COMPLETED**: Remove HTML global constants  
2. ✅ **COMPLETED**: Create basic constants module
3. ❌ **IN PROGRESS**: Expand constants module with all rendering constants
4. ❌ **NEXT**: Create tileset configuration interfaces

### Medium Priority (Phase 2)  
5. Convert JavaScript configs to JSON
6. Implement modern asset loading
7. Update TilesetLoader to use fetch()

### Lower Priority (Phase 3 & 4)
8. Refactor MapRenderer constructor
9. Extract rendering algorithms  
10. Add comprehensive testing
11. Performance optimization

## Expected Benefits

### Immediate Benefits (After Phase 1)
- ✅ **ACHIEVED**: Eliminated 6 window global constants from HTML
- ✅ **ACHIEVED**: Type safety for tileset constants
- ✅ **ACHIEVED**: Removed global scope pollution

### Phase 2 Benefits
- No more dynamic script loading security concerns
- Proper asset bundling and optimization
- Better error handling and validation
- Easier debugging and development

### Phase 3-4 Benefits  
- Fully testable rendering system
- Modular, maintainable architecture
- Performance improvements through optimization
- Support for multiple tilesets and themes
- Easier addition of new rendering features

## Compatibility Notes

- All changes maintain backward compatibility with existing sprites
- Game mechanics remain unchanged
- Rendering output identical to current system
- No changes required to server-side code
- Existing saved games continue to work

## Migration Strategy

1. **Incremental Migration**: Each phase can be implemented independently
2. **Feature Flags**: New system can run parallel to old system during transition
3. **Validation**: Extensive testing ensures pixel-perfect rendering compatibility
4. **Rollback Plan**: Each change can be reverted independently if issues arise

This modernization will transform the rendering system from a legacy freeciv-web port to a clean, modern TypeScript architecture while maintaining full compatibility with existing game assets and mechanics.