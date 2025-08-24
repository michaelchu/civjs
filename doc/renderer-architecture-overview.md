# CivJS Renderer Architecture Overview

## High-Level Architecture

The CivJS renderer uses a **2D Canvas-based isometric tile rendering system** directly ported from freeciv-web. It consists of three main layers:

1. **Backend Map Generation** (`MapManager.ts:57`)
2. **Network Data Transfer** (Socket.IO packets)  
3. **Frontend Canvas Rendering** (`MapRenderer.ts:18`)

## Backend Map Data Structure

### Map Generation (`MapManager.ts`)
The server generates rich map data using:

```typescript
interface MapTile {
  x: number, y: number
  terrain: TerrainType  // 'ocean', 'grassland', 'plains', etc.
  resource?: ResourceType
  elevation: number     // 0-255 height values
  riverMask: number     // Bitfield for river directions (N,E,S,W)
  continentId: number
  isExplored: boolean, isVisible: boolean
  improvements: string[]
  unitIds: string[], cityId?: string
}
```

**Key Backend Features:**
- **Terrain Generation**: Uses seeded random + elevation-based rules (`MapManager.ts:132`)
- **Multi-layer Generation**: Terrain → Continents → Rivers → Resources → Starting positions
- **Perlin Noise-like**: Simple elevation-based terrain assignment with smoothing passes

### Data Packet Format (`packet.ts:143`)
Map data is sent via Socket.IO packets:

```typescript
// Initial map setup
PacketType.MAP_INFO (17) → { xsize, ysize, wrap_id }

// Individual tile updates  
PacketType.TILE_INFO (15) → { 
  x, y, terrain, tile: index,
  known: visibility_level,
  seen: exploration_level,
  resource?, elevation?
}

// Batch tile updates (performance optimization)
'tile-info-batch' → { tiles: TileInfo[], endIndex, total }
```

## Network Data Flow

### Server → Client Pipeline
1. **Map Generation**: `MapManager.generateMap()` creates full map data
2. **Visibility Processing**: `VisibilityManager` determines what each player can see  
3. **Packet Transmission**: 
   - `MAP_VIEW_REQ` → `MAP_VIEW_REPLY` for initial map (`socket-handlers.ts:767`)
   - Individual `tile-info` packets for updates (`GameClient.ts:99`)
   - Batch `tile-info-batch` packets for performance (`GameClient.ts:145`)

### Client Reception (`GameClient.ts`)
```typescript
// Freeciv-web compatibility - stores data in global variables
this.socket.on('map-info', data => {
  window.map = data;  // Map metadata  
  window.tiles = new Array(data.xsize * data.ysize); // Tile array
});

this.socket.on('tile-info', data => {
  window.tiles[data.tile] = Object.assign(tiles[data.tile], data);
});
```

**Data Format**: Client maintains two data structures:
- **Global arrays**: `window.map`, `window.tiles` (freeciv-web compatibility)
- **React store**: `GameState.map.tiles` (modern state management)

## Frontend Rendering System

### Core Renderer (`MapRenderer.ts:18`)

The renderer implements **isometric tile-based rendering** with these key components:

#### 1. **Tileset System** (`TilesetLoader.ts`)
- Loads sprite sheets from server  
- Manages sprite mapping and caching
- Supports freeciv-web tileset format

#### 2. **Coordinate Systems**
```typescript
// Map coordinates (tile-based) ↔ Screen coordinates (pixel-based)
mapToScreen(mapX, mapY, viewport) // MapRenderer.ts:702
canvasToMap(canvasX, canvasY, viewport) // MapRenderer.ts:710

// Isometric projection using diamond tiles
mapToGuiVector(mapDx, mapDy) // MapRenderer.ts:667
```

#### 3. **Multi-layer Terrain Rendering** (`MapRenderer.ts:170`)

**Critical**: The renderer uses **freeciv-web's exact terrain sprite logic**:

```typescript
// 3-layer terrain rendering (layers 0, 1, 2)
for (let layer = 0; layer <= 2; layer++) {
  const sprites = fillTerrainSpriteArraySimple(layer, tile);
  // Render each sprite with offset positioning
}
```

**Sprite Naming Convention**:
- `CELL_WHOLE`: `t.l{layer}.{terrain}_{directional_suffix}`
- `CELL_CORNER`: Complex corner-based blending for seamless terrain transitions

#### 4. **Terrain Blending Algorithm** (`MapRenderer.ts:235`)
Direct port of freeciv-web's terrain blending:
- **MATCH_NONE**: Simple terrain sprites
- **MATCH_SAME**: Directional sprites based on neighbor matching
- **CELL_CORNER**: Advanced corner blending for smooth terrain transitions

### Rendering Pipeline

1. **Viewport Culling**: `getVisibleTilesFromGlobal()` (`MapRenderer.ts:833`)
2. **Terrain Layers**: 3-pass rendering for terrain base, details, overlays
3. **Unit/City Overlays**: Simple colored shapes on top of terrain  
4. **Interactive Elements**: Mouse panning with freeciv-web coordinate mapping

### Performance Optimizations

- **Tile Map Caching**: O(1) neighbor lookups via `Map<string, Tile>` (`MapRenderer.ts:500`)
- **Batch Tile Updates**: Process multiple tiles per network packet
- **Viewport Culling**: Only render visible tiles
- **Canvas Optimizations**: Disabled image smoothing for pixel-perfect sprites

## Compatibility with Freeciv-Web

The renderer maintains **full compatibility** with freeciv-web:

- **Global Variables**: Uses `window.map`, `window.tiles`, `window.tileset`
- **Sprite Format**: Compatible with freeciv-web tileset files  
- **Coordinate System**: Identical isometric projection math
- **Terrain Logic**: Direct port of `fill_terrain_sprite_array()`

This allows seamless integration with existing freeciv-web assets and ensures visual consistency with the original game.