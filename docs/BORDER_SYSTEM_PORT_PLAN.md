# Border System Port Plan

## Research Summary

Based on investigation of the reference code and current codebase, this document outlines the comprehensive plan for porting the borders system from freeciv-web to the modern CivJS TypeScript architecture.

### Key Findings from Reference Code

#### Freeciv-web Implementation (reference/freeciv-web/javascript/2dcanvas/)

**Border Rendering (`mapview.js:705-820`)**
- `mapview_put_border_line()` function handles border line rendering
- Supports animated/dashed border styles with configurable colors
- Uses cardinal directions (N/E/S/W) for border edges
- Animation system with `border_anim` counter for moving borders
- Multiple border styles: primary, secondary, tertiary colors
- Line width and dash pattern configuration

**Border Detection (`tilespec.js`)**
- `get_border_line_sprites()` - Creates border sprites for tile edges
  - Checks adjacent tiles in cardinal directions
  - Compares tile ownership between current and neighboring tiles
  - Returns sprite data with nation colors for rendering
- `get_frontier_flag_sprites()` - Places nation flags on frontier borders
  - Complex logic tree for flag placement on border corners
  - Collapses orthogonal borders into shared corners
  - Uses nation graphic strings and positioning offsets

#### Original Freeciv C Implementation (reference/freeciv/common/)

**Core Border Logic (`borders.h/borders.c`)**
- `is_border_source(struct tile *ptile)` - Cities and territory-claiming extras are border sources
- `tile_border_source_radius_sq(struct tile *ptile)` - Calculates border radius:
  - Base radius from game settings (`game.info.border_city_radius_sq`)
  - Additional radius based on city size (`city_size * game.info.border_size_effect`)
  - Limited by `CITY_MAP_MAX_RADIUS_SQ` constant
- `tile_border_source_strength(struct tile *ptile)` - Border strength calculation:
  - Cities: `(city_size + 2) * (100 + border_strength_pct) / 100`
  - Extras/Forts: `(100 + border_strength_pct) / 100`
- `tile_border_strength(struct tile *ptile, struct tile *source)` - Distance-based strength:
  - Formula: `full_strength² / sq_distance`
  - Returns `FC_INFINITY` for source tile itself

### Current CivJS Status

The codebase currently has **no border system implementation**. Analysis found:

**Existing Related Code:**
- Basic tile ownership concepts in `CityManager.ts` (capture/transfer methods)
- City workable tile radius calculation in `CityTileManagementService.ts`
- No territorial control mechanics
- No border calculation logic
- No border rendering in client Canvas2D system

**Missing Components:**
- Border source detection
- Territory claiming mechanics
- Border strength calculations
- Client-server border synchronization
- Border visualization system

## Implementation Plan

### Phase 1: Core Border Logic (Server-Side)

#### 1.1 Create BorderManager

Create `apps/server/src/game/managers/BorderManager.ts`:

```typescript
export interface BorderSource {
  x: number;
  y: number;
  strength: number;
  radius: number;
  playerId: number;
  type: 'city' | 'fort' | 'extra';
}

export interface TileOwnership {
  x: number;
  y: number;
  playerId: number | null;
  strength: number;
  claimedBy: BorderSource | null;
}

export class BorderManager {
  // Core border calculation
  calculateTileOwnership(x: number, y: number): TileOwnership
  isBorderSource(x: number, y: number): boolean
  getBorderSourceRadius(source: BorderSource): number
  getBorderSourceStrength(source: BorderSource): number
  
  // Border updates
  updateBordersAroundTile(x: number, y: number, radius?: number): void
  recalculateBordersForPlayer(playerId: number): void
  
  // Border queries
  getTileOwner(x: number, y: number): number | null
  getBorderingSources(x: number, y: number): BorderSource[]
  isOnBorder(x: number, y: number): boolean
}
```

#### 1.2 Add Border-related Game Constants

Add to `apps/server/src/game/constants/GameConstants.ts`:

```typescript
// Border system constants (from freeciv)
export const BORDERS_DISABLED = 0;
export const BORDERS_ENABLED = 1;

export const BORDER_DEFAULT_CITY_RADIUS_SQ = 5; // radius 2
export const BORDER_DEFAULT_SIZE_EFFECT = 1;
export const BORDER_DEFAULT_STRENGTH_PCT = 100;

export const CITY_MAP_MAX_RADIUS = 3;
export const CITY_MAP_MAX_RADIUS_SQ = 10; // 3² + 1
```

#### 1.3 Integrate with Existing Managers

**CityManager Integration:**
- Cities become primary border sources on founding
- Border updates on city growth/capture
- Border strength affected by city buildings

**MapManager Integration:**
- Add tile ownership tracking to map state
- Efficient border lookup data structures
- Integration with existing tile data

**GameService Integration:**
- Border recalculation on city events
- Player notifications for border changes
- Save/load border state

### Phase 2: Network Protocol & Synchronization

#### 2.1 Border Update Packets

Add to `apps/shared/types/packets/`:

```typescript
export interface BorderUpdatePacket {
  type: 'border_update';
  tiles: Array<{
    x: number;
    y: number;
    owner: number | null;
    strength: number;
  }>;
  updateType: 'full_update' | 'incremental' | 'player_specific';
  affectedPlayers?: number[];
}

export interface BorderSourcePacket {
  type: 'border_source_update';
  sources: BorderSource[];
  removed: Array<{x: number, y: number}>;
}
```

#### 2.2 Client-Server Synchronization

**Server Responsibilities:**
- Send full border state on game join
- Send incremental updates on border changes
- Validate border-related actions

**Client Responsibilities:**
- Maintain local border state cache
- Request border updates when needed
- Handle border state in rendering system

### Phase 3: Client Rendering (Canvas2D)

#### 3.1 Border Line Rendering

Port from `reference/freeciv-web/javascript/2dcanvas/mapview.js:705-820`:

Create `apps/client/src/components/Canvas2D/renderers/BorderRenderer.ts`:

```typescript
export class BorderRenderer {
  private borderAnimFrame = 0;
  private readonly BORDER_ANIM_DELAY = 750;

  renderBorderLine(
    ctx: CanvasRenderingContext2D,
    direction: Direction,
    colors: BorderColors,
    canvasX: number,
    canvasY: number
  ): void

  renderTerritoryFill(
    ctx: CanvasRenderingContext2D,
    color: string,
    canvasX: number,
    canvasY: number
  ): void

  getBorderSprites(tile: MapTile): BorderSprite[]
}
```

**Border Rendering Features:**
- Animated/dashed border lines
- Nation color integration
- Multiple border styles (primary/secondary/tertiary)
- Configurable line width and patterns

#### 3.2 Border Sprite System

Port from `reference/freeciv-web/javascript/2dcanvas/tilespec.js`:

```typescript
export interface BorderSprite {
  key: string;
  direction: Direction;
  color: string;
  color2: string;
  color3: string;
}

// Port get_border_line_sprites() logic
export function getBorderLineSprites(tile: MapTile, neighbors: MapTile[]): BorderSprite[]

// Port get_frontier_flag_sprites() logic  
export function getFrontierFlagSprites(tile: MapTile): FlagSprite[]
```

#### 3.3 Integration with MapRenderer

Modify `apps/client/src/components/Canvas2D/MapRenderer.ts`:

- Add border rendering layer between terrain and units
- Integrate BorderRenderer with existing tile rendering
- Handle border animation updates
- Support border display toggles

#### 3.4 Optional: Territory Fill & Flags

**Territory Fill:**
- Semi-transparent nation colors over tiles
- Configurable opacity and blend modes
- Performance optimization for large maps

**Nation Flags:**
- Flag sprites on frontier borders
- Complex corner logic from freeciv-web
- Nation graphic integration

### Phase 4: Game Rules Integration

#### 4.1 City Border Mechanics

**Automatic Border Expansion:**
- Border growth on city population increase
- Technology effects on border range
- Building effects on border strength

**Border Conflicts:**
- Strength-based border resolution
- Cultural pressure mechanics
- Border flipping conditions

#### 4.2 Territory Claiming by Extras

**Fort/Base Border Sources:**
- Military bases as secondary border sources
- Configurable radius and strength
- Integration with extras system

**Special Terrain:**
- Rivers, mountains affecting borders
- Natural boundary preferences
- Terrain-based border bonuses

#### 4.3 Unit Movement & Borders

**Border Crossing:**
- Diplomatic state checks
- Right of passage agreements
- Border violation consequences

**Military Considerations:**
- ZOC (Zone of Control) interactions
- Border defense bonuses
- Siege mechanics

### Phase 5: Advanced Features

#### 5.1 Cultural Borders

**Culture Points:**
- City culture accumulation
- Culture spread mechanics
- Cultural victory conditions

**Culture vs Military:**
- Peaceful border expansion
- Cultural assimilation
- Resistance mechanics

#### 5.2 Dynamic Borders

**Real-time Updates:**
- Smooth border transitions
- Animation of border changes
- Visual feedback for players

**Performance Optimization:**
- Efficient border calculation algorithms
- Caching strategies
- Incremental updates

## Implementation Priority

### High Priority (Core Functionality)
1. **BorderManager core logic** (Phase 1.1) - Essential for gameplay
2. **Basic border line rendering** (Phase 3.1-3.2) - Visual feedback
3. **City integration** (Phase 1.3) - Cities as primary border sources
4. **Network synchronization** (Phase 2) - Multiplayer support

### Medium Priority (Enhanced Features)  
5. **Territory fill rendering** (Phase 3.3) - Improved visualization
6. **Fort/extra border sources** (Phase 4.2) - Complete border system
7. **Border crossing mechanics** (Phase 4.3) - Gameplay rules

### Low Priority (Advanced Features)
8. **Nation flags on borders** (Phase 3.3) - Visual polish
9. **Cultural borders** (Phase 5.1) - Advanced gameplay
10. **Dynamic border animations** (Phase 5.2) - Enhanced UX

## Technical Considerations

### Performance
- Use spatial indexing for border calculations
- Cache border state to minimize recalculation
- Optimize rendering for large maps
- Implement dirty region tracking

### Compatibility
- Maintain compatibility with existing save games
- Support both enabled/disabled border modes
- Backward compatibility with non-border gameplay

### Testing
- Unit tests for border calculation algorithms
- Integration tests for client-server sync
- Performance tests for large maps
- Visual regression tests for rendering

## Files to Create/Modify

### New Files
- `apps/server/src/game/managers/BorderManager.ts`
- `apps/shared/types/BorderTypes.ts`
- `apps/shared/types/packets/BorderPackets.ts`
- `apps/client/src/components/Canvas2D/renderers/BorderRenderer.ts`
- `docs/BORDER_SYSTEM_API.md`

### Existing Files to Modify
- `apps/server/src/game/managers/CityManager.ts` - Integrate border updates
- `apps/server/src/game/managers/MapManager.ts` - Add tile ownership tracking
- `apps/server/src/game/GameService.ts` - Border system orchestration
- `apps/client/src/components/Canvas2D/MapRenderer.ts` - Integrate border rendering
- `apps/shared/types/MapTypes.ts` - Add border-related tile data

### Configuration Files
- `apps/server/src/game/constants/GameConstants.ts` - Border game settings
- `apps/client/src/config/RenderingConfig.ts` - Border display options

## Conclusion

This plan ensures a faithful port of the freeciv-web border system while leveraging the modern TypeScript architecture of CivJS. The phased approach allows for incremental implementation and testing, with core functionality prioritized for immediate gameplay impact.

The implementation will provide:
- Accurate border calculations matching original Freeciv mechanics
- Visual border rendering with animation support
- Robust client-server synchronization
- Extensible architecture for future enhancements
- Performance optimizations for large-scale games

Reference implementations from both freeciv-web JavaScript and original Freeciv C code ensure authenticity and completeness of the border system port.