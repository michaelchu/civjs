# Tundra Tile Placement Audit Report

## Executive Summary

This audit examines the tundra tile placement logic in our CivJS implementation compared to the reference Freeciv codebase. Several critical discrepancies were found that explain why tundra tiles appear in climatically inappropriate locations such as near the equator.

## Key Findings

### 1. Temperature Zone Assignment Issues

**Reference Implementation (Freeciv):**
- Uses sophisticated colatitude-based temperature calculation
- Temperature zones based on distance from equator with proper climate gradients
- COLD_LEVEL = `MAX_COLATITUDE * (60*7 - temperature_param * 6) / 700`
- Clear temperature type assignment: TT_FROZEN, TT_COLD, TT_TEMPERATE, TT_TROPICAL

**Current Implementation Issues:**
```typescript
// apps/server/src/game/map/TerrainGenerator.ts:1744-1754
if (tempValue >= MAX_COLATITUDE * 0.8) {
  tile.temperature = TemperatureType.FROZEN;
} else if (tempValue >= MAX_COLATITUDE * 0.5) {
  tile.temperature = TemperatureType.COLD;
} else if (tempValue <= MAX_COLATITUDE * 0.25) {
  tile.temperature = TemperatureType.TROPICAL;
} else {
  tile.temperature = TemperatureType.TEMPERATE;
}
```

**Problem:** Hardcoded thresholds (0.8, 0.5, 0.25) do not match Freeciv's dynamic calculation based on `getColdLevel()` and `getTropicalLevel()` functions.

### 2. Random Temperature Assignment Bug

**Critical Issue Found:**
```typescript
// apps/server/src/game/map/TerrainGenerator.ts:1756-1766
if (this.random() < 0.05) {
  const temps = [
    TemperatureType.FROZEN,
    TemperatureType.COLD,
    TemperatureType.TEMPERATE,
    TemperatureType.TROPICAL,
  ];
  tile.temperature = temps[Math.floor(this.random() * temps.length)];
}
```

**Root Cause:** This random temperature assignment (5% chance) can assign COLD temperature to tiles near the equator, causing tundra to appear in tropical regions.

### 3. Tundra Placement Logic Compliance

**Reference Implementation (Freeciv):**
```c
// reference/freeciv/server/generator/mapgen.c make_plain()
if (tmap_is(ptile, TT_FROZEN)) {
  tile_set_terrain(ptile, pick_terrain(MG_FROZEN, MG_UNUSED, MG_MOUNTAINOUS));
} else if (tmap_is(ptile, TT_COLD)) {
  tile_set_terrain(ptile, pick_terrain(MG_COLD, MG_UNUSED, MG_MOUNTAINOUS));
} else {
  tile_set_terrain(ptile, pick_terrain(MG_TEMPERATE, MG_GREEN, MG_MOUNTAINOUS));
}
```

Where `pick_terrain(MG_COLD, ...)` selects terrain with `property_cold = 50`, which is **tundra**.

**Current Implementation:**
```typescript
// apps/server/src/game/map/TerrainGenerator.ts:1785-1787
} else if (tile.temperature === TemperatureType.COLD) {
  tile.terrain = this.random() < 0.7 ? 'tundra' : 'plains';
```

**Assessment:** The tundra placement logic itself is correct, but it operates on incorrect temperature assignments.

### 4. Temperature Map Implementation Analysis

**Our TemperatureMap class** (`apps/server/src/game/map/TemperatureMap.ts`) is well-implemented:
- Correctly ports Freeciv's `create_tmap()` function
- Proper `getColdLevel()` and `getTropicalLevel()` calculations
- Accurate colatitude-based temperature distribution

**However**, the TerrainGenerator is not consistently using this sophisticated temperature mapping.

## Specific Issues Identified

### Issue 1: Incorrect Temperature Thresholds
**File:** `apps/server/src/game/map/TerrainGenerator.ts:1744-1754`
**Problem:** Hardcoded temperature thresholds don't match Freeciv's climate calculations
**Impact:** Wrong climate zones, especially affecting cold/temperate boundaries

### Issue 2: Random Temperature Override
**File:** `apps/server/src/game/map/TerrainGenerator.ts:1756-1766`
**Problem:** Random temperature assignment can place cold climates anywhere
**Impact:** **Direct cause of tundra appearing near equator**

### Issue 3: Inconsistent Temperature Map Usage
**Problem:** TerrainGenerator sometimes uses simplified temperature assignment instead of the sophisticated TemperatureMap class
**Impact:** Climate zones don't reflect proper geographic patterns

## Compliance Analysis

| Aspect | Reference Freeciv | Current Implementation | Compliance |
|--------|------------------|----------------------|------------|
| Temperature calculation | Dynamic based on colatitude and params | Hardcoded thresholds | ❌ |
| Climate zones | 4 zones with proper formulas | 4 zones with fixed ratios | ❌ |
| Tundra placement | `tmap_is(ptile, TT_COLD)` | `temperature === TemperatureType.COLD` | ✅ |
| Random climate override | None | 5% random assignment | ❌ |
| TemperatureMap usage | Core system | Available but underutilized | ⚠️ |

## Recommendations

### Priority 1: Fix Random Temperature Assignment
Remove the random temperature override that can assign COLD temperatures to equatorial tiles.

### Priority 2: Use Proper Temperature Thresholds  
Replace hardcoded thresholds with Freeciv's dynamic calculations using `getColdLevel()` and `getTropicalLevel()`.

### Priority 3: Ensure TemperatureMap Integration
Verify that the sophisticated TemperatureMap class is being used consistently across all terrain generation phases.

### Priority 4: Add Climate Validation
Implement validation to ensure tundra only appears in climatically appropriate latitudes (high colatitude values).

## Technical Impact

The identified issues explain the reported problem of tundra appearing near the equator:
1. Random temperature assignment can mark equatorial tiles as COLD
2. COLD temperature triggers tundra placement logic
3. Result: Tundra tiles in tropical latitudes

## Reference Code Locations

**Freeciv Reference:**
- `reference/freeciv/server/generator/mapgen.c:make_plain()` - Tundra placement logic
- `reference/freeciv/server/generator/temperature_map.c:create_tmap()` - Temperature calculation
- `reference/freeciv/data/classic/terrain.ruleset:[terrain_tundra]` - Tundra properties

**Current Implementation:**
- `apps/server/src/game/map/TerrainGenerator.ts:1756-1766` - Random temperature bug
- `apps/server/src/game/map/TemperatureMap.ts` - Correct temperature implementation
- `apps/server/src/game/map/TerrainSelectionEngine.ts:63-65` - Tundra properties

## Conclusion

The tundra placement logic is fundamentally correct, but temperature zone assignment has critical flaws. The random temperature override is the primary cause of tundra appearing in inappropriate locations. Fixing these climate calculation issues will restore proper geographic distribution of terrain types.