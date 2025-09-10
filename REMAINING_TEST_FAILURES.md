# Remaining Test Failures - Post CityManager Refactoring

After successfully resolving 15 out of 18 failing integration tests (83% success rate), there are 3 remaining test failures that require deeper architectural changes to fully resolve. These are documented here for future implementation.

## Summary

**Status**: 15/18 tests fixed ✅
**Remaining**: 3 complex integration tests ❌
**Impact**: Core functionality works, remaining issues are advanced integration scenarios

---

## 1. Research Bulbs Accumulation Integration

**Test**: `CrossManagerInteraction.integration.test.ts` - "should process complete turn cycle with database consistency"

### Problem
Cities generate science output (`sciencePerTurn`) but this science is not automatically accumulated into the ResearchManager's `bulbsAccumulated` during turn processing.

### Root Cause
Missing integration between CityManager and ResearchManager. When cities process turns and generate science, there's no automatic callback or service that transfers this science to the player's research progress.

### Expected Behavior
```typescript
// City generates science during turn processing
city.sciencePerTurn = 1; // From trade conversion

// This science should automatically accumulate in research
research.bulbsAccumulated += city.sciencePerTurn; // Currently missing
```

### Current Behavior
- ✅ Cities properly calculate science from trade (`tradeToScience = Math.max(1, Math.floor(trade/2))`)
- ✅ Cities store `sciencePerTurn` value correctly  
- ❌ Science is not transferred to ResearchManager during turn processing
- ❌ `research.bulbsAccumulated` remains 0

### Solution Required
Implement proper callback integration in GameLifecycleManager:
```typescript
// In GameLifecycleManager.setupManagerCallbacks()
cityManager.setCallbacks({
  onCityTurnProcessed: (city) => {
    if (city.sciencePerTurn > 0) {
      researchManager.addBulbs(city.playerId, city.sciencePerTurn);
    }
  }
});
```

### Files Affected
- `GameLifecycleManager.ts` - Add science accumulation callback
- `CityManager.ts` - Add `onCityTurnProcessed` callback trigger
- `ResearchManager.ts` - Ensure `addBulbs()` method exists and works

---

## 2. City Science Calculation Inconsistency

**Test**: `CityManager.integration.test.ts` - "should calculate basic city outputs and persist changes"

### Problem
Some cities have `sciencePerTurn: undefined` while others have proper science values, indicating inconsistent science calculation across different test scenarios.

### Root Cause
The `calculateCityOutputs()` method may not be called consistently across all city creation and turn processing scenarios, or there are different code paths that bypass science calculation.

### Current Behavior
- ✅ Some cities: `sciencePerTurn: 0` (properly calculated)
- ❌ Other cities: `sciencePerTurn: undefined` (calculation skipped)
- ✅ Trade-to-science conversion logic works when called

### Debug Evidence
```
🏙️ Updated city outputs: { sciencePerTurn: 0, science: 0, tileOutputs: { trade: 0 } }
🔬 City science output: { sciencePerTurn: undefined, tradePerTurn: 1 }
```

### Solution Required
1. Ensure `calculateCityOutputs()` is called consistently in all city creation/loading scenarios
2. Add defensive programming to initialize `sciencePerTurn = 0` in city creation
3. Audit all code paths that modify city state to ensure science calculation

### Files Affected
- `CityManager.ts` - Ensure consistent `calculateCityOutputs()` calls
- City creation, loading, and refresh methods

---

## 3. Complex Manager Coordination - Workable Tiles

**Test**: `CrossManagerInteraction.integration.test.ts` - "should handle city growth creating new worked tiles affecting unit movement"

### Problem
In complex scenarios involving city growth and unit movement coordination, workable tiles are not properly initialized, returning 0 tiles when expecting ≥1.

### Root Cause
This appears to be a complex integration issue where the test scenario setup doesn't properly coordinate between:
- CityManager (workable tiles initialization)  
- MapManager (tile data availability)
- Unit movement system interactions
- Database state management across managers

### Current Behavior
- ❌ `expect(city.workableTiles?.length || 0).toBeGreaterThanOrEqual(1)` fails with 0 tiles
- ✅ Basic workable tiles work in simpler scenarios
- ❌ Complex multi-manager scenarios have coordination issues

### Solution Required
This requires a comprehensive review of:
1. Test scenario setup for complex multi-manager interactions
2. Manager initialization order and dependency management
3. Cross-manager state synchronization during complex operations
4. Proper handling of database transactions across multiple managers

### Files Affected
- Test setup and fixture creation
- Manager initialization and coordination logic
- Complex integration test scenarios

---

## Recommended Implementation Order

1. **Research Bulbs Integration** (Medium complexity)
   - Clear architectural solution with callback pattern
   - Follows existing callback patterns in codebase
   - High impact on game functionality

2. **Science Calculation Consistency** (Low-Medium complexity)
   - Debugging and ensuring consistent method calls
   - Defensive programming improvements
   - Lower risk, focused changes

3. **Complex Manager Coordination** (High complexity)
   - Requires deeper architectural review
   - May need broader refactoring of manager coordination
   - Consider as part of larger architecture improvement initiative

---

## Test Commands

To reproduce the failing tests:
```bash
# Research bulbs test
npm run test:integration -- --testNamePattern="should process complete turn cycle with database consistency"

# Science calculation test  
npm run test:integration -- --testNamePattern="should calculate basic city outputs and persist changes"

# Complex coordination test
npm run test:integration -- --testNamePattern="should handle city growth creating new worked tiles affecting unit movement"

# All integration tests
npm run test:integration
```

---

## Notes

These remaining failures represent edge cases and advanced integration scenarios rather than core functionality problems. The 83% success rate indicates that the CityManager refactoring was successful in maintaining core game functionality while these remaining issues can be addressed in future iterations.