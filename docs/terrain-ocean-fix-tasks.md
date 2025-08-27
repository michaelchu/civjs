# Terrain Generation Ocean Fix Tasks

**Date:** 2025-08-27  
**Reference:** terrain-generation-audit.md  
**Test Results:** 50% maps unplayable (8/16 tests failed)

## Critical Issues Summary

Based on the terrain-ocean-audit test results, we have two completely broken map generation modes that produce unplayable ocean-dominated maps:

- **Random Mode:** Generates 1-5% land (expected ~30%)
- **Fractal Mode:** Generates 0% land (expected ~30%)

## Task Breakdown

### 1. Random Mode Ocean Fix 🚨 CRITICAL

**Issue:** Random mode generates 95-99% ocean instead of expected 70% ocean/30% land ratio.

**Debugging Tasks:**
- [ ] **Debug Random Height Generation:** Examine `generateRandomHeightMap()` in MapManager.ts - trace flow against reference `server/generator/height_map.c:make_random_hmap()` to verify height distribution ranges and confirm compliance with original algorithm
- [ ] **Audit makeLand() for Random:** Trace through makeLand() execution path for random mode - compare against reference `server/generator/mapgen.c:make_land()` checking if land elevation thresholds match freeciv implementation
- [ ] **Verify Ocean/Land Threshold:** Check if `OCEAN_DEPTH` constant and land elevation cutoffs match reference values from `server/generator/mapgen.h` and `common/map.h` - trace threshold application logic for compliance
- [ ] **Test Height Map Statistics:** Add debug logging to output min/max/avg heights before and after makeLand() for random mode - compare statistics against reference implementation expected ranges
- [ ] **Compare with Reference:** Find corresponding random generation in freeciv C code (`server/generator/mapgen.c:mapgenerator2()`) and trace execution flow step-by-step to identify algorithm deviations from reference

**Fix Implementation:**
- [ ] **Adjust Height Ranges:** Fix height generation ranges to ensure sufficient land tiles above sea level
- [ ] **Fix Land Percentage Logic:** Ensure landpercent parameter (30%) is properly applied in random generation
- [ ] **Validate Terrain Assignment:** Verify ocean vs land terrain assignment logic in random mode

**Validation:**
- [ ] **Run Ocean Tests:** Verify random mode produces 25-35% land on both small (40×25) and standard (80×50) maps
- [ ] **Test Multiple Seeds:** Ensure fix works consistently across seeds 1-10
- [ ] **Performance Check:** Ensure generation time remains reasonable (<200ms for small maps)

### 2. Fractal Mode Ocean Fix 🚨 CRITICAL

**Issue:** Fractal mode generates 100% ocean (0% land).

**Debugging Tasks:**
- [ ] **Debug Fractal Height Generation:** Examine fractal noise generation - trace against reference `server/generator/height_map.c:make_fractal_hmap()` to check if height ranges match freeciv implementation and confirm noise algorithm compliance
- [ ] **Audit Fractal Land Creation:** Trace through fractal-specific land generation logic - compare against reference `server/generator/mapgen.c:mapgenerator4()` execution flow to verify elevation assignment matches original
- [ ] **Check Fractal Parameters:** Verify fractal noise parameters (frequency, amplitude, octaves) match reference values from `server/generator/height_map.c` - trace parameter usage through noise generation for compliance
- [ ] **Validate Height Normalization:** Check if fractal heights are being normalized correctly before terrain assignment - compare normalization logic against reference `normalize_hmap_poles()` and `adjust_hmap_landmass()` functions
- [ ] **Compare Implementation:** Reference freeciv fractal generator in `server/generator/mapgen.c` and trace complete execution flow from `mapgenerator4()` through height generation to identify algorithm deviations and confirm step-by-step compliance

**Fix Implementation:**
- [ ] **Fix Fractal Height Ranges:** Ensure fractal noise generates appropriate elevation distribution
- [ ] **Correct Land Threshold:** Fix the land/ocean cutoff logic specific to fractal generation
- [ ] **Implement Proper Scaling:** Ensure fractal heights are scaled to create land masses instead of all-ocean

**Validation:**
- [ ] **Run Ocean Tests:** Verify fractal mode produces 25-35% land on both map sizes
- [ ] **Test Terrain Variation:** Ensure fractal generates varied terrain types, not just ocean
- [ ] **Seed Consistency:** Validate deterministic behavior across multiple seeds

### 3. Diagnostic and Testing Tasks

**Enhanced Debugging:**
- [ ] **Add Height Map Visualization:** Create debug output to visualize height maps before terrain assignment
- [ ] **Log Generation Statistics:** Add comprehensive logging for land/ocean ratios during generation
- [ ] **Create Debug Mode:** Add environment variable to enable detailed terrain generation logging
- [ ] **Height Distribution Analysis:** Output height histograms for each generation mode

**Test Infrastructure:**
- [ ] **Extend Ocean Tests:** Add more seeds and map sizes to ocean audit tests
- [ ] **Add Regression Tests:** Create specific tests for Random and Fractal land percentage targets
- [ ] **Performance Benchmarks:** Add timing tests to catch performance regressions
- [ ] **Reference Comparison:** Create tests that compare output statistics with expected freeciv ranges - trace reference generation flow in `server/generator/mapgen.c` to establish baseline compliance metrics

**Code Quality:**
- [ ] **Refactor Common Logic:** Extract shared height/terrain logic to reduce duplication - ensure refactored code maintains compliance with reference implementation flow
- [ ] **Add Type Safety:** Ensure height generation functions have proper TypeScript types
- [ ] **Documentation:** Add inline documentation for height generation algorithms - reference corresponding freeciv C functions and document compliance status with original implementation
- [ ] **Error Handling:** Add validation for invalid height maps or generation failures

## Implementation Priority

### Phase 1: Emergency Fixes (Days 1-2)
1. **Random Mode Debug & Fix** - Most critical as it affects default map generation
2. **Fractal Mode Debug & Fix** - Complete failure needs immediate attention
3. **Basic Validation** - Ensure fixes produce playable maps

### Phase 2: Validation & Testing (Days 3-4)
1. **Comprehensive Testing** - Run full test suite with multiple seeds/sizes
2. **Performance Verification** - Ensure fixes don't impact generation speed
3. **Reference Comparison** - Validate against freeciv expected values and trace execution flow compliance

### Phase 3: Polish & Documentation (Day 5)
1. **Code Cleanup** - Refactor and document height generation logic
2. **Enhanced Testing** - Add regression tests and benchmarks
3. **Documentation Updates** - Update terrain-generation-audit.md with fix results

## Expected Outcomes

**Success Criteria:**
- Random mode generates 25-35% land consistently
- Fractal mode generates 25-35% land consistently  
- Ocean audit tests pass with <10% unplayable map rate
- Generation performance remains acceptable
- All modes maintain deterministic behavior

**Files to Modify:**
- `apps/server/src/game/MapManager.ts` - Core terrain generation logic
- `apps/server/src/game/map/TerrainGenerator.ts` - Height and terrain assignment
- `apps/server/tests/e2e/terrain-ocean-audit.test.ts` - Enhanced test coverage
- `docs/terrain-generation-audit.md` - Updated with fix results

## Reference Materials

**Freeciv Source Files to Review (for flow tracing):**
- `server/generator/mapgen.c` - Core map generation (`mapgenerator2()` for Random, `mapgenerator4()` for Fractal)
- `server/generator/height_map.c` - Height map generation (`make_random_hmap()`, `make_fractal_hmap()`, normalization functions)
- `server/generator/mapgen.h` - Constants and thresholds (`OCEAN_DEPTH`, landmass parameters)
- `common/map.h` - Map structure and elevation definitions
- `utility/rand.c` - Random number generation (for deterministic compliance)
- `server/generator/utilities.c` - Helper functions for land/ocean assignment

**Key Constants to Verify (trace usage in reference):**
- `OCEAN_DEPTH` - Ocean elevation threshold (trace usage in `server/generator/mapgen.c`)
- `landpercent` - Target land percentage (30%) (trace application in `adjust_hmap_landmass()`)
- Fractal noise parameters (frequency, amplitude, octaves) (trace from `make_fractal_hmap()` implementation)
- Height normalization ranges (trace from `normalize_hmap_poles()` and related functions)
- Random height generation bounds (trace from `make_random_hmap()` min/max calculations)

---

**Note:** This document should be updated as fixes are implemented and tested. Each completed task should be checked off and any discovered issues should be added to the appropriate sections.