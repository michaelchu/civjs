# Complete Freeciv-Web Rendering Port Plan

## Executive Summary

After thorough analysis, we've discovered that **our current rendering implementation is only ~10% complete**. We've been downloading configuration data but missing the core rendering algorithms. This document outlines a complete 100% port plan with minimal modernization.

## 🔍 Critical Discovery: The Missing Logic

### **What We Currently Have (Data Only)**
- ✅ **Configuration data** - `tileset_config_amplio2.js` (58+ parameters)
- ✅ **Sprite coordinates** - `tileset_spec_amplio2.js` (37,000+ tokens)
- ✅ **Sprite images** - PNG files served from server
- ✅ **1 partial function** - `fillTerrainSpriteArray` in `MapRenderer.ts`

### **What We're Missing (90% of the Logic)**
- ❌ **Core rendering pipeline** - `fill_sprite_array()` with 13-layer system
- ❌ **59 rendering functions** - From `tilespec.js` (1,694 lines)
- ❌ **Canvas management** - From `mapview.js` (515 lines)
- ❌ **Sprite loading system** - Complete caching and management
- ❌ **Entity rendering** - Units, cities, buildings, effects, UI

### **The Data vs Logic Problem**
```
Current Situation:
✅ Data: "Warriors sprite is at coordinates [96,200,64,48] on sheet 1"
✅ Data: "Unit flags should be offset by 25,16 pixels"  
❌ Logic: "Here's HOW to determine which sprites to show for a given tile"
❌ Logic: "Here's the 13-layer rendering pipeline algorithm"
❌ Logic: "Here's how to render units with health bars, flags, activities"
```

**Result**: We have the ingredient list but not the recipe.

## 📋 Architecture Understanding

### **Correct Client-Server Split**
```
SERVER SIDE                    NETWORK                    CLIENT SIDE
===========                    =======                    ===========

Game Logic:                    Socket.IO                  Rendering System:
- MapManager.ts      ←------→  Game Data   ←---------→    - tilespec.ts (MISSING)
- CityManager.ts               Packets                    - mapview.ts (MISSING)
- UnitManager.ts                                         - tileset-config.ts ✅
- TurnManager.ts                                         - tileset-spec.ts ✅

Static Asset Serving:          HTTP                       Visual Output:
- PNG sprite sheets  ←------→  Static      ←---------→    - Canvas 2D rendering
- Individual sprites            Files                     - Game visuals
```

### **File Locations After Port**
```
MOVE FROM SERVER TO CLIENT:
apps/server/public/js/2dcanvas/  →  apps/client/src/rendering/

FILES TO MOVE:
├── tilespec.js (1,694 lines)   →  ├── tilespec.ts       ✅ Core algorithms
├── mapview.js (515 lines)      →  ├── mapview.ts        ✅ Canvas management
├── tileset_config_amplio2.js   →  ├── tileset-config.ts ✅ Parameters  
└── tileset_spec_amplio2.js     →  └── tileset-spec.ts   ✅ Sprite coords

KEEP ON SERVER (Static Assets):
apps/server/public/
├── tilesets/*.png              ✅ Sprite sheet images
└── sprites/*.png               ✅ Individual sprites
```

## 🎯 Complete Port Plan (18-25 weeks)

### **Phase 1: Foundation Setup** (1-2 weeks)

#### **1.1: Project Structure**
Create complete rendering module structure:
```
apps/client/src/rendering/
├── index.ts              # Main rendering exports
├── tilespec.ts           # Core rendering algorithms (59 functions)
├── mapview.ts            # Canvas management & sprite loading  
├── tileset-config.ts     # Configuration parameters (58+ settings)
├── tileset-spec.ts       # Sprite coordinate definitions
├── constants.ts          # All rendering constants (expanded)
└── types.ts              # TypeScript interfaces for all data
```

#### **1.2: Basic Infrastructure**
- Set up TypeScript compilation for rendering module
- Create base interfaces for all data structures
- Set up testing framework for visual regression testing

### **Phase 2: Core Rendering Pipeline** (6-8 weeks)

#### **2.1: Main Pipeline Functions**
Port the core rendering system from `tilespec.js`:

**Priority 1: Layer System**
```typescript
// Port from tilespec.js:282
function fill_sprite_array(layer: LayerType, ptile: Tile, pedge: Edge, 
                          pcorner: Corner, punit: Unit, pcity: City, citymode: boolean): SpriteDefinition[]

// Port all 13 layer handlers:
// LAYER_TERRAIN1, LAYER_TERRAIN2, LAYER_TERRAIN3, LAYER_ROADS, 
// LAYER_SPECIAL1, LAYER_CITY1, LAYER_SPECIAL2, LAYER_UNIT,
// LAYER_FOG, LAYER_SPECIAL3, LAYER_TILELABEL, LAYER_CITYBAR, LAYER_GOTO
```

**Priority 2: Terrain Algorithms**
```typescript  
// Port from tilespec.js:501-512
function fill_terrain_sprite_layer(layer_num: number, ptile: Tile, pterrain: Terrain, tterrain_near: Terrain[]): SpriteDefinition[]
function fill_terrain_sprite_array(l: number, ptile: Tile, pterrain: Terrain, tterrain_near: Terrain[]): SpriteDefinition[]

// Complete all terrain matching algorithms:
// MATCH_NONE, MATCH_SAME, MATCH_PAIR, MATCH_FULL
// CELL_WHOLE, CELL_CORNER (81-sprite corner system)
```

#### **2.2: Sprite Selection System**
Port sprite resolution and fallback system:

```typescript
// Port from tilespec.js:102-196
function tileset_has_tag(tagname: string): boolean
function tileset_ruleset_entity_tag_str_or_alt(entity: Entity, kind_name: string): string | null
function tileset_unit_type_graphic_tag(utype: UnitType): string
function tileset_building_graphic_tag(pimprovement: Building): string
function tileset_extra_graphic_tag(extra: Extra): string
// + 10 more specialized sprite selection functions
```

### **Phase 3: Entity Rendering Systems** (4-6 weeks)

#### **3.1: Unit Rendering**
```typescript
// Port from tilespec.js:674+
function fill_unit_sprite_array(punit: Unit, stacked: boolean, backdrop: boolean): SpriteDefinition[]
function get_unit_nation_flag_sprite(punit: Unit): SpriteDefinition
function get_unit_hp_sprite(punit: Unit): SpriteDefinition  
function get_unit_veteran_sprite(punit: Unit): SpriteDefinition
function get_unit_activity_sprite(punit: Unit): SpriteDefinition
```

#### **3.2: City Rendering**
```typescript
// Port from tilespec.js:1095+
function get_city_sprite(pcity: City): SpriteDefinition
function get_city_flag_sprite(pcity: City): SpriteDefinition
function get_city_occupied_sprite(pcity: City): SpriteDefinition
function get_city_info_text(pcity: City): SpriteDefinition
function get_city_food_output_sprite(num: number): SpriteDefinition
function get_city_shields_output_sprite(num: number): SpriteDefinition
function get_city_trade_output_sprite(num: number): SpriteDefinition
```

#### **3.3: Buildings & Extras**
```typescript
// Port various building and improvement rendering functions
function fill_layer1_sprite_array(ptile: Tile, pcity: City): SpriteDefinition[]
function fill_layer2_sprite_array(ptile: Tile, pcity: City): SpriteDefinition[]
function fill_layer3_sprite_array(ptile: Tile, pcity: City): SpriteDefinition[]
function get_tile_specials_sprite(ptile: Tile): SpriteDefinition
function get_tile_river_sprite(ptile: Tile): SpriteDefinition
```

### **Phase 4: UI & Effects Systems** (3-4 weeks)

#### **4.1: Fog of War & Visibility**
```typescript
// Port from tilespec.js:1126+
function fill_fog_sprite_array(ptile: Tile, pedge: Edge, pcorner: Corner): SpriteDefinition[]
// Handle all fog combinations: f/k/u visibility states
// 81 different fog sprite combinations
```

#### **4.2: UI Elements**
```typescript
// Port UI rendering functions
function get_select_sprite(): SpriteDefinition
function get_tile_label_text(ptile: Tile): SpriteDefinition
function fill_goto_line_sprite_array(ptile: Tile): SpriteDefinition[]
function get_border_line_sprites(ptile: Tile): SpriteDefinition[]
```

#### **4.3: Animations & Effects**
```typescript
// Port animation and effect systems
function handle_explosion_animations(ptile: Tile): SpriteDefinition[]
function get_unit_image_sprite(punit: Unit): SpriteDefinition
// Animation state management and timers
```

### **Phase 5: Canvas Management System** (2-3 weeks)

#### **5.1: Sprite Loading & Caching**
Port from `mapview.js`:
```typescript
// Port from mapview.js:130-216
function init_sprites(): Promise<void>
function init_cache_sprites(): void  
function preload_check(): boolean
// Sprite sheet loading and caching system
```

#### **5.2: Canvas Utilities**
```typescript
// Port canvas drawing utilities from mapview.js:238+
function mapview_put_tile(pcanvas: HTMLCanvasElement, tag: string, canvas_x: number, canvas_y: number): void
function canvas_put_rectangle(canvas_context: CanvasRenderingContext2D, pcolor: string, canvas_x: number, canvas_y: number, width: number, height: number): void
function mapview_put_city_bar(pcanvas: HTMLCanvasElement, city: City, canvas_x: number, canvas_y: number): void
function mapview_put_tile_label(pcanvas: HTMLCanvasElement, tile: Tile, canvas_x: number, canvas_y: number): void
```

### **Phase 6: Configuration & Data Systems** (2-3 weeks)

#### **6.1: Complete Tileset Configuration**
Convert and expand tileset configuration:
```typescript
interface CompleteTilesetConfig {
  // Basic dimensions  
  tileWidth: number;
  tileHeight: number;
  name: string;
  imageCount: number;
  
  // Unit rendering (58+ total parameters)
  unitOffset: Point2D;
  unitFlagOffset: Point2D;
  unitActivityOffset: Point2D;
  
  // City rendering
  cityFlagOffset: Point2D;
  citySizeOffset: Point2D;
  cityBarOffset: Point2D;
  
  // Rendering styles
  isIsometric: boolean;
  fogStyle: number;        // 0-4 different fog algorithms
  darknessStyle: number;   // 0-4 darkness algorithms  
  roadStyle: number;       // Road rendering approach
  isMountainous: boolean;  // Terrain blending behavior
  
  // UI positioning
  tileLabelOffset: Point2D;
  smallTileSize: Size2D;
}
```

#### **6.2: Complete Sprite Definitions**
Convert sprite coordinate system:
```typescript
interface SpriteDefinitions {
  [spriteTag: string]: SpriteCoordinate;
}

interface SpriteCoordinate {
  x: number;
  y: number; 
  width: number;
  height: number;
  sheetIndex: number;
}

// Convert 37,000+ token sprite definition file to structured TypeScript
```

#### **6.3: Terrain Configuration System**
```typescript
interface TerrainRenderingConfig {
  [terrainLayerKey: string]: {
    matchStyle: MatchStyle;      // NONE, SAME, PAIR, FULL
    spriteType: CellType;        // WHOLE, CORNER
    mineTag: string | null;      // Mining improvement sprite
    matchIndices: number[];      // Sprite indices for blending
    dither: boolean;             // Random dithering enabled
  };
}
```

### **Phase 7: Integration & Testing** (2-3 weeks)

#### **7.1: MapRenderer Integration**
Update `MapRenderer.ts` to use complete rendering system:
```typescript
class MapRenderer {
  private renderingEngine: CompleteRenderingEngine;
  
  constructor(ctx: CanvasRenderingContext2D) {
    this.renderingEngine = new CompleteRenderingEngine({
      tilesetConfig: TILESET_CONFIG,
      spriteDefinitions: SPRITE_DEFINITIONS,
      terrainConfig: TERRAIN_CONFIG
    });
  }
  
  render(gameState: GameState): void {
    // Use complete 13-layer pipeline
    for (const layer of ALL_LAYERS) {
      const sprites = this.renderingEngine.fillSpriteArray(layer, ...);
      this.renderSprites(sprites);
    }
  }
}
```

#### **7.2: Visual Validation & Testing**
- **Pixel-perfect comparison** with original freeciv-web
- **All entity types** rendering correctly (terrain, units, cities, buildings, UI)
- **All 13 rendering layers** working
- **Animation systems** functional
- **Performance equivalent** to original system

## 🔧 Minimal Modernization Principles

### **✅ Allowed Modernizations**
1. **ES6 modules** instead of script injection
2. **TypeScript conversion** with exact functional compatibility  
3. **Structured data** instead of global variables
4. **Proper imports** instead of HTML globals

### **❌ No Major Changes**
1. **Algorithm preservation** - Port functions exactly as-is
2. **Performance maintenance** - Keep original caching and optimization patterns
3. **Visual compatibility** - Pixel-perfect rendering match
4. **Data structure compatibility** - Maintain sprite and config formats

### **Modernization Examples**
```typescript
// Instead of: Global variable pollution
var tileset_tile_width = 96;
window.MATCH_NONE = 0;

// Use: Proper module exports  
export const TILESET_CONFIG = { tileWidth: 96, ... };
export const MATCH_NONE = 0;

// Instead of: Script injection  
$.ajax("/js/tilespec.js", {dataType: "script"});

// Use: ES6 imports
import { fill_sprite_array } from './rendering/tilespec';
```

## 🎯 Success Criteria

### **Functional Requirements**
- ✅ **100% feature parity** with freeciv-web rendering
- ✅ **All 59 functions** from tilespec.js ported and working
- ✅ **All 25+ functions** from mapview.js ported and working  
- ✅ **13-layer rendering pipeline** fully operational
- ✅ **All entity types** rendering (terrain, units, cities, buildings, UI, effects)
- ✅ **Complete animation systems** functional

### **Technical Requirements**
- ✅ **Zero window globals** - All converted to proper ES6 modules  
- ✅ **Full TypeScript types** - Complete type safety throughout
- ✅ **Pixel-perfect rendering** - Identical visual output to original
- ✅ **Performance parity** - No regression in rendering performance
- ✅ **Memory efficiency** - Maintain original sprite caching patterns

### **Development Requirements**
- ✅ **Clean architecture** - Modular, testable, maintainable code
- ✅ **Comprehensive testing** - Visual regression tests for all scenarios
- ✅ **Documentation** - Complete API documentation for rendering system
- ✅ **Error handling** - Graceful handling of missing sprites, invalid data

## ⏱️ Timeline Summary

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1**: Foundation Setup | 1-2 weeks | Project structure, basic infrastructure |
| **Phase 2**: Core Pipeline | 6-8 weeks | Main rendering algorithms, 13-layer system |
| **Phase 3**: Entity Rendering | 4-6 weeks | Units, cities, buildings, extras |
| **Phase 4**: UI & Effects | 3-4 weeks | Fog, animations, selections, labels |
| **Phase 5**: Canvas Management | 2-3 weeks | Sprite loading, caching, utilities |
| **Phase 6**: Configuration | 2-3 weeks | Complete config and data systems |
| **Phase 7**: Integration | 2-3 weeks | Testing, validation, performance |

**Total: 20-29 weeks** for complete 100% functional port

## 🚀 Getting Started

### **Week 1 Action Items**
1. **Create rendering module structure** in `apps/client/src/rendering/`
2. **Set up TypeScript compilation** for new rendering system
3. **Begin porting core constants** from `tilespec.js` 
4. **Create base interfaces** for all data structures
5. **Set up visual regression testing** framework

This plan will deliver a complete, fully functional freeciv-web rendering system in modern TypeScript while maintaining 100% compatibility with the original game's visual presentation and performance characteristics.