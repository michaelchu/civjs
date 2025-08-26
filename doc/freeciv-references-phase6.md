# Freeciv References - Phase 6: Enhanced River System

This document provides comprehensive references for all functions ported from freeciv for Phase 6 of the terrain generation system.

## Overview

Phase 6 implements sophisticated river generation algorithms directly ported from freeciv's `server/generator/mapgen.c`. The implementation includes a complete river test function pipeline, advanced pathfinding, and climate-aware river placement.

## Core Data Structures

### RiverMapState Interface
**Source**: `freeciv/server/generator/mapgen.c:115-118`

```typescript
interface RiverMapState {
  blocked: Set<number>; // Tiles marked as blocked for river placement  
  ok: Set<number>;      // Tiles marked as valid river tiles
}
```

**Original freeciv implementation**:
```c
struct river_map {
  struct dbv blocked;
  struct dbv ok;
};
```

### RiverTestFunction Interface
**Source**: `freeciv/server/generator/mapgen.c:684-687`

```typescript
interface RiverTestFunction {
  func: (riverMap: RiverMapState, x: number, y: number, tiles: MapTile[][]) => number;
  fatal: boolean; // If true, non-zero result aborts river generation
}
```

**Original freeciv implementation**:
```c
struct test_func {
  int (*func)(struct river_map *privermap, struct tile *ptile, struct extra_type *priver);
  bool fatal;
};
```

## River Test Functions

All river test functions are direct ports from freeciv's sophisticated river evaluation system.

### 1. riverTestBlocked()
**Source**: `freeciv/server/generator/mapgen.c:557-573`
**Purpose**: Tests if a tile is blocked for river placement
**Fatal**: Yes (blocks river if returns > 0)

**Original freeciv implementation**:
```c
static int river_test_blocked(struct river_map *privermap,
                              struct tile *ptile,
                              struct extra_type *priver)
{
  if (dbv_isset(&privermap->blocked, tile_index(ptile))) {
    return 1;
  }
  // Any un-blocked?
  cardinal_adjc_iterate(&(wld.map), ptile, ptile1) {
    if (!dbv_isset(&privermap->blocked, tile_index(ptile1))) {
      return 0;
    }
  } cardinal_adjc_iterate_end;
  return 1; // None non-blocked |- all blocked
}
```

### 2. riverTestRiverGrid()
**Source**: `freeciv/server/generator/mapgen.c:578-584`
**Purpose**: Prevents rivers from creating too dense a grid
**Fatal**: Yes (prevents river overcrowding)

**Original freeciv implementation**:
```c
static int river_test_rivergrid(struct river_map *privermap,
                                struct tile *ptile,
                                struct extra_type *priver)
{
  return (count_river_type_tile_card(&(wld.map), ptile, priver, FALSE) > 1)
    ? 1 : 0;
}
```

### 3. riverTestHighlands()
**Source**: `freeciv/server/generator/mapgen.c:589-594`
**Purpose**: Rivers prefer mountainous terrain for natural flow
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_highlands(struct river_map *privermap,
                                struct tile *ptile,
                                struct extra_type *priver)
{
  return tile_terrain(ptile)->property[MG_MOUNTAINOUS];
}
```

### 4. riverTestAdjacentOcean()
**Source**: `freeciv/server/generator/mapgen.c:599-605`
**Purpose**: Rivers avoid ocean tiles
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_adjacent_ocean(struct river_map *privermap,
                                     struct tile *ptile,
                                     struct extra_type *priver)
{
  return 100 - count_terrain_class_near_tile(&(wld.map), ptile,
                                             TRUE, TRUE, TC_OCEAN);
}
```

### 5. riverTestAdjacentRiver()
**Source**: `freeciv/server/generator/mapgen.c:610-615`
**Purpose**: Rivers avoid areas with many existing rivers
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_adjacent_river(struct river_map *privermap,
                                     struct tile *ptile,
                                     struct extra_type *priver)
{
  return 100 - count_river_type_tile_card(&(wld.map), ptile, priver, TRUE);
}
```

### 6. riverTestAdjacentHighlands()
**Source**: `freeciv/server/generator/mapgen.c:620-630`
**Purpose**: Rivers prefer areas with mountainous terrain nearby
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_adjacent_highlands(struct river_map *privermap,
                                         struct tile *ptile,
                                         struct extra_type *priver)
{
  int sum = 0;
  adjc_iterate(&(wld.map), ptile, ptile2) {
    sum += tile_terrain(ptile2)->property[MG_MOUNTAINOUS];
  } adjc_iterate_end;
  return sum;
}
```

### 7. riverTestSwamp()
**Source**: `freeciv/server/generator/mapgen.c:636-641`
**Purpose**: Rivers avoid wet/swampy terrain
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_swamp(struct river_map *privermap,
                            struct tile *ptile,
                            struct extra_type *priver)
{
  return FC_INFINITY - tile_terrain(ptile)->property[MG_WET];
}
```

### 8. riverTestAdjacentSwamp()
**Source**: `freeciv/server/generator/mapgen.c:646-656`
**Purpose**: Rivers avoid areas surrounded by wet terrain
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_adjacent_swamp(struct river_map *privermap,
                                     struct tile *ptile,
                                     struct extra_type *priver)
{
  int sum = 0;
  adjc_iterate(&(wld.map), ptile, ptile2) {
    sum += tile_terrain(ptile2)->property[MG_WET];
  } adjc_iterate_end;
  return FC_INFINITY - sum;
}
```

### 9. riverTestHeightMap()
**Source**: `freeciv/server/generator/mapgen.c:662-667`
**Purpose**: Rivers flow from high elevation to low elevation
**Fatal**: No (scoring function)

**Original freeciv implementation**:
```c
static int river_test_height_map(struct river_map *privermap,
                                 struct tile *ptile,
                                 struct extra_type *priver)
{
  return hmap(ptile);
}
```

## Core River Generation Functions

### riverBlockMark()
**Source**: `freeciv/server/generator/mapgen.c:672-682`
**Purpose**: Marks tile and adjacent tiles as blocked for river placement

**Original freeciv implementation**:
```c
static void river_blockmark(struct river_map *privermap,
                            struct tile *ptile)
{
  log_debug("Blockmarking (%d, %d) and adjacent tiles.", TILE_XY(ptile));
  dbv_set(&privermap->blocked, tile_index(ptile));
  cardinal_adjc_iterate(&(wld.map), ptile, ptile1) {
    dbv_set(&privermap->blocked, tile_index(ptile1));
  } cardinal_adjc_iterate_end;
}
```

### makeRiver()
**Source**: `freeciv/server/generator/mapgen.c:792-906`
**Purpose**: Core river generation algorithm using test function pipeline

**Algorithm**:
1. Mark current tile as river in riverMap.ok
2. Check termination conditions (ocean, existing river, polar region)
3. Evaluate all cardinal directions using test function pipeline
4. Filter out directions that fail fatal tests
5. Choose best scoring direction (lowest score wins)
6. Block current position and move to selected direction
7. Repeat until river terminates

### generateAdvancedRivers()
**Source**: `freeciv/server/generator/mapgen.c:906-1150`
**Purpose**: Main river network generation with density control

**Algorithm**:
1. Calculate desired river coverage based on map size and wetness
2. Attempt to generate specified number of rivers
3. For each river attempt:
   - Find suitable highland starting position
   - Validate starting position (no nearby rivers/ocean)
   - Generate river using makeRiver()
   - Apply river to map tiles with terrain conversion
   - Update river masks for visual representation

## Island River Integration

### fillIslandRiversAdvanced()
**Source**: `freeciv/server/generator/mapgen.c:1731-1823`
**Purpose**: Enhanced river placement for island-based map generation

### isRiverMouthSuitable()
**Source**: `freeciv/server/generator/mapgen.c:1731-1750`
**Purpose**: Tests river mouth placement near ocean

**Original freeciv implementation**:
```c
static bool island_river_mouth_suitability(const struct tile *ptile,
                                           const struct extra_type *priver)
{
  // Complex ocean/river adjacency analysis
  return (num_card_ocean == 1 && pct_adj_ocean <= 35
          && num_adj_river == 0);
}
```

### isIslandRiverSuitable()
**Source**: `freeciv/server/generator/mapgen.c:1752-1771`
**Purpose**: Tests inland river placement on islands

**Original freeciv implementation**:
```c
static bool island_river_suitability(const struct tile *ptile,
                                     const struct extra_type *priver)
{
  // Complex river/ocean density analysis with randomization
  return (num_card_river == 1 && num_card_ocean == 0
          && pct_adj_river < 50
          && (pct_adj_river + pct_adj_ocean * 2) < fc_rand(25) + 25);
}
```

## Test Function Pipeline

The river test functions array directly mirrors freeciv's implementation:

**Source**: `freeciv/server/generator/mapgen.c:690-700`

**Original freeciv implementation**:
```c
#define NUM_TEST_FUNCTIONS 9
static struct test_func test_funcs[NUM_TEST_FUNCTIONS] = {
  {river_test_blocked,            TRUE},
  {river_test_rivergrid,          TRUE},
  {river_test_highlands,          FALSE},
  {river_test_adjacent_ocean,     FALSE},
  {river_test_adjacent_river,     FALSE},
  {river_test_adjacent_highlands, FALSE},
  {river_test_swamp,              FALSE},
  {river_test_adjacent_swamp,     FALSE},
  {river_test_height_map,         FALSE}
};
```

## Implementation Notes

### Differences from Freeciv
1. **Set-based tracking**: Uses JavaScript Set instead of freeciv's bit vectors for blocked/ok tiles
2. **TypeScript types**: Full type safety with interfaces and enums
3. **Async functions**: River generation is async to prevent blocking
4. **Climate integration**: Enhanced integration with existing Phase 1-5 systems
5. **Helper functions**: Additional helper methods to reduce complexity

### Maintained Compatibility
1. **Algorithm logic**: Exact same test function logic and scoring
2. **Test pipeline**: Same 9-function evaluation system with fatal/non-fatal handling
3. **River termination**: Same conditions (ocean, existing river, polar regions)
4. **Density control**: Same river coverage calculations
5. **Island integration**: Same suitability tests for island river placement

## Validation

All functions have been validated against the original freeciv implementation to ensure:
- Identical algorithm logic
- Compatible scoring systems  
- Proper integration with existing terrain generation phases
- TypeScript compilation and type safety
- ESLint compliance and code quality standards

The Phase 6 implementation provides a complete, production-ready river generation system that matches freeciv's sophisticated and battle-tested algorithms while maintaining modern TypeScript development standards.