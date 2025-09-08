# Border System Implementation

This document describes the implementation of the territorial borders system ported from the reference Freeciv implementation.

## Overview

The border system allows civilizations to claim and control territory around their cities and bases, providing gameplay mechanics for territorial control, unit movement restrictions, and diplomatic interactions.

## Architecture

### Core Components

#### 1. BorderService (`apps/server/src/game/services/BorderService.ts`)
**Ported from:** `reference/freeciv/common/borders.c` and `reference/freeciv/server/maphand.c`

Core service that handles border calculations and territory claiming logic:
- **Border radius calculation** - Determines how far borders extend from sources
- **Border strength calculation** - Calculates territorial influence with distance falloff  
- **Territory claiming** - Assigns tile ownership based on border conflicts
- **Circular area calculation** - Efficiently finds tiles within border radius

Key methods:
- `calculateBorderSourceRadiusSquared()` - City/base border radius
- `calculateBorderSourceStrength()` - Territorial influence strength
- `claimBorders()` - Claim territory for a border source
- `calculateAllBorders()` - Recalculate all map borders

#### 2. BorderManager (`apps/server/src/game/managers/BorderManager.ts`)  
**Ported from:** `reference/freeciv/server/maphand.c` integration logic

Game-level manager that integrates borders with city and unit systems:
- **City integration** - Handle border changes on city founding/growth/destruction
- **Unit movement validation** - Check border crossing permissions
- **Configuration management** - Handle border settings and game rules
- **Territory queries** - Provide border information for AI and UI

#### 3. BorderRenderer (`apps/client/src/components/Canvas2D/renderers/BorderRenderer.ts`)
**Ported from:** `reference/freeciv-web` border visualization

Client-side renderer for displaying territorial borders:
- **Border line drawing** - Draw borders between different territories
- **Territory highlighting** - Optional territory overlay visualization
- **Player color integration** - Color-coded borders by nation
- **Performance optimization** - Efficient rendering for large maps

#### 4. Database Schema (`apps/server/src/database/schema/tiles.ts`)
**Based on:** Freeciv map tile ownership concepts

Persistent storage for tile ownership:
- **Tile ownership** - Track which player owns each tile
- **Border sources** - Track which city/base claims each tile  
- **Border strength** - Store calculated border strength for conflict resolution
- **Performance indexes** - Optimized queries for territory operations

## Configuration

### Server Configuration
Border behavior is controlled by `BorderConfiguration`:

```typescript
interface BorderConfiguration {
  borderMode: BorderMode; // DISABLED, ENABLED, SEE_INSIDE, EXPAND
  borderCityRadiusSquared: number; // Base city border radius (default: 17)
  borderSizeEffect: number; // City size effect on borders (default: 1)
  borderVision: boolean; // Whether borders provide vision
  borderStrengthPct: number; // Base border strength bonus
  happyBorders: boolean; // Whether border crossings affect happiness
}
```

**Reference values** (from `reference/freeciv/server/settings.c`):
- `borderCityRadiusSquared: 17` - Approximately 4-tile radius
- `borderSizeEffect: 1` - Each city size adds 1 to border radius
- Maximum city contribution capped at `CITY_MAP_MAX_RADIUS_SQ = 26`

### Client Configuration  
Border display is controlled by `GameOptions`:

```typescript
interface GameOptions {
  drawBorders: boolean; // Show/hide borders (default: true)
  borderWidth: number; // Border line thickness (default: 2)
  borderAlpha: number; // Border transparency (default: 0.8)
  borderStyle: 'solid' | 'dashed'; // Border line style
}
```

## Border Calculation Algorithm

### 1. Radius Calculation
**Ported from:** `reference/freeciv/common/borders.c:tile_border_source_radius_sq()`

```typescript
radius_squared = base_radius + min(city_size, MAX_RADIUS) * size_effect
```

For cities:
- Base radius: `borderCityRadiusSquared` (default 17)
- City size effect: `city_size * borderSizeEffect` (capped at 26)
- Total radius: `17 + min(city_size, 26) * 1`

### 2. Strength Calculation  
**Ported from:** `reference/freeciv/common/borders.c:tile_border_source_strength()`

```typescript
strength = (city_size + 2) * (100 + strength_bonus) / 100
```

### 3. Distance Falloff
**Ported from:** `reference/freeciv/common/borders.c:tile_border_strength()`

```typescript  
tile_strength = full_strength * full_strength / squared_distance
```

### 4. Territory Resolution
When multiple cities claim the same tile, the city with highest `tile_strength` wins.

## Integration Points

### City Management Integration
**File:** `apps/server/src/game/orchestrators/GameLifecycleManager.ts`

BorderManager is integrated into the game lifecycle:
- **City founding** - `borderManager.onCityFounded()` claims initial territory  
- **City growth** - `borderManager.onCityGrown()` expands borders
- **City destruction** - `borderManager.onCityDestroyed()` clears claimed territory

### Unit Movement Integration  
**File:** `apps/server/src/game/managers/BorderManager.ts`

Border checks are integrated into movement validation:
```typescript
const result = borderManager.canUnitEnterTile(playerId, x, y, tiles, unitFlags);
if (!result.canEnter) {
  // Movement blocked by foreign territory
}
```

### Rendering Integration
**File:** `apps/client/src/components/Canvas2D/MapRenderer.ts`

Border rendering is integrated into the map rendering pipeline:
1. Terrain rendered first
2. **Borders rendered** (after terrain, before units)  
3. Units and cities rendered on top

## Database Schema

### Tiles Table
```sql
CREATE TABLE tiles (
  id UUID PRIMARY KEY,
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  terrain VARCHAR(50) NOT NULL,
  resource VARCHAR(50),
  elevation INTEGER,
  river_mask INTEGER DEFAULT 0,
  -- Border system properties
  owner UUID REFERENCES players(id) ON DELETE SET NULL,
  claimer UUID, -- cityId or baseId that claims this tile  
  border_strength REAL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX tiles_game_coordinates_idx ON tiles(game_id, x, y);
CREATE INDEX tiles_game_owner_idx ON tiles(game_id, owner);
CREATE INDEX tiles_game_claimer_idx ON tiles(game_id, claimer);
```

## Testing

### Unit Tests
**File:** `apps/server/src/game/services/__tests__/BorderService.test.ts`

Comprehensive tests verify compliance with reference implementation:
- ✅ Border radius calculations match Freeciv defaults
- ✅ Border strength calculations with distance falloff  
- ✅ Territory conflict resolution based on strength
- ✅ Map boundary handling
- ✅ Border mode configuration (disabled, enabled, etc.)

### Reference Implementation Compliance

| Feature | Reference File | Implementation | Status |
|---------|---------------|----------------|---------|
| Border radius calculation | `borders.c:tile_border_source_radius_sq()` | `BorderService.calculateBorderSourceRadiusSquared()` | ✅ |
| Border strength | `borders.c:tile_border_source_strength()` | `BorderService.calculateBorderSourceStrength()` | ✅ |
| Distance falloff | `borders.c:tile_border_strength()` | `BorderService.calculateBorderStrengthAtTile()` | ✅ |
| Territory claiming | `maphand.c:map_claim_border()` | `BorderService.claimBorders()` | ✅ |
| Border clearing | `maphand.c:map_clear_border()` | `BorderService.clearBorders()` | ✅ |
| Full recalculation | `maphand.c:map_calculate_borders()` | `BorderService.calculateAllBorders()` | ✅ |

## Performance Considerations

### Server Performance
- **Lazy calculation** - Borders only recalculated when cities change
- **Circular iteration** - Efficient algorithm for finding tiles in radius
- **Database indexes** - Optimized queries for territory lookups
- **Conflict caching** - Border strength stored to avoid recalculation

### Client Performance  
- **Viewport culling** - Only render borders for visible tiles
- **Canvas optimization** - Efficient line drawing with proper alpha blending
- **Options integration** - Toggle border display to improve performance

## Future Enhancements

### Planned Features
1. **Base/Extra claiming** - Territory claiming by military bases and improvements
2. **Border vision** - Optional vision provided by controlled territory
3. **Happy borders** - Diplomatic happiness effects for border crossings
4. **Cultural borders** - Territory expansion based on cultural influence
5. **Border agreements** - Diplomatic treaties affecting border rules

### Reference Implementation Gaps
1. **Terrain claiming extras** - Support for bases that claim territory
2. **Border vision effects** - Integration with visibility system
3. **Diplomatic border rules** - Alliance/treaty border permissions
4. **Cultural influence** - Alternative to pure city-size based borders

## Migration and Database Updates

When deploying this system to existing games:

1. **Schema migration** - Add tiles table and border columns
2. **Data population** - Calculate initial borders for existing cities
3. **Cache warming** - Pre-calculate border strengths for performance
4. **Gradual rollout** - Feature flag for border system activation

## Troubleshooting

### Common Issues

**Borders not displaying:**
- Check `drawBorders` option in client settings
- Verify tile `owner` field is populated from server
- Check border renderer integration in MapRenderer

**Performance issues:**
- Enable viewport culling in BorderRenderer
- Check database indexes on tiles table
- Consider reducing border calculation frequency

**Territory conflicts:**
- Verify border strength calculations match reference values
- Check city size limits (max 26 for border calculation)
- Ensure proper distance-based falloff

## References

- **Freeciv borders.c**: `/reference/freeciv/common/borders.c`
- **Freeciv maphand.c**: `/reference/freeciv/server/maphand.c`
- **Freeciv-web options**: `/reference/freeciv-web/javascript/options.js`
- **Freeciv settings**: `/reference/freeciv/server/settings.c`