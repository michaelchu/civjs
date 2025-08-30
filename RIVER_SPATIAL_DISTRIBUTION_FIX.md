# River Spatial Distribution Fix

## Issue Identified

Rivers were being generated with a strong bias toward the left side of the map, with the right side rarely getting any rivers. This was reported after confirming that the river rendering pipeline was working correctly.

## Root Cause Analysis

The bias was in the `findRiverStartPosition()` method in `RiverGenerator.ts`. The algorithm used nested loops that scanned from left to right (x=0 to width) with early termination:

```typescript
// PROBLEMATIC CODE (biased toward left side)
for (let x = 0; x < this.width; x++) {           // Left to right scan
  for (let y = 0; y < this.height; y++) {
    // ... find candidates ...
    if (candidates.length >= 20) break;          // Early exit
  }
  if (candidates.length >= 20) break;            // Early exit
}
```

**Problem**: Once 20 candidates were found (usually in the leftmost areas), the algorithm stopped searching, never reaching the right side of the map.

## Solution Applied

Replaced the biased sequential search with **Fisher-Yates shuffle randomization** to eliminate spatial bias:

```typescript
// FIXED CODE (unbiased search order)
// Create randomized tile positions to eliminate spatial bias
const allPositions: { x: number; y: number }[] = [];
for (let x = 0; x < this.width; x++) {
  for (let y = 0; y < this.height; y++) {
    allPositions.push({ x, y });
  }
}

// Fisher-Yates shuffle to randomize search order
for (let i = allPositions.length - 1; i > 0; i--) {
  const j = Math.floor(this.random() * (i + 1));
  [allPositions[i], allPositions[j]] = [allPositions[j], allPositions[i]];
}

// Search in randomized order (eliminates spatial bias)
for (const pos of allPositions) {
  const tile = tiles[pos.x][pos.y];
  // ... candidate evaluation ...
}
```

## Technical Details

### Algorithm Changes

1. **Position Collection**: Gather all possible tile positions into an array
2. **Fisher-Yates Shuffle**: Randomize the search order using proper shuffling algorithm
3. **Unbiased Search**: Iterate through randomized positions instead of sequential x,y loops

### Benefits

- **Even Distribution**: Rivers can now start anywhere on the map with equal probability
- **Maintains Quality**: Still prioritizes high elevation and mountainous areas
- **Performance**: Minimal impact - shuffling is O(n) and done once per generation
- **Deterministic**: Uses the same seeded random generator, so results are reproducible

## Expected Results

After applying this fix:

- **Right side rivers**: The right side of the map should now receive rivers
- **Balanced distribution**: Rivers should appear across the full map width
- **Natural variation**: Some maps may still have more rivers in certain areas due to terrain, but not due to algorithmic bias
- **Better gameplay**: More realistic river networks that span continents

## Validation

The fix can be validated by:

1. **Visual inspection**: Generate multiple maps and observe river distribution
2. **Statistical analysis**: Count rivers in left/center/right thirds of map
3. **Seed testing**: Use same seeds before/after fix to compare distribution

### Expected Distribution

With "normal" or "many" rivers settings:
- Each third of the map should have some rivers (>0%)
- No single third should dominate (>70% of all rivers)
- Right side should have at least 15-20% of rivers

## Files Modified

- `/root/repo/apps/server/src/game/map/RiverGenerator.ts`: Fixed `findRiverStartPosition()` method

## Compatibility

This fix:
- ✅ Maintains existing river generation quality
- ✅ Uses the same seeded random generator for reproducibility  
- ✅ Preserves terrain-based river placement logic
- ✅ No breaking changes to API or data structures

---

*This fix addresses the spatial bias issue while maintaining the quality and deterministic nature of river generation.*