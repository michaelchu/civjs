# Max-Depth Violations Refactoring

## Overview

This document outlines the refactoring effort to address ESLint's `max-depth` rule violations throughout the CivJS codebase. The `max-depth` rule enforces a maximum nesting level of 4 for blocks, which improves code readability and maintainability.

## Current State

After the ESLint configuration cleanup, we have **135 warnings** remaining, with **39 max-depth violations** across 16 files. These violations represent deeply nested code that should be refactored into more readable, maintainable patterns.

## Goals

1. **Reduce nesting complexity**: Extract deeply nested logic into separate functions
2. **Improve readability**: Make code easier to understand and debug
3. **Enhance maintainability**: Reduce cognitive load for future developers
4. **Preserve functionality**: Ensure no behavioral changes during refactoring
5. **Maintain performance**: Keep refactoring performance-neutral

## Refactoring Strategies

### 1. Early Returns (Guard Clauses)
Replace deeply nested if-else chains with early returns:

```typescript
// Before (deeply nested)
if (condition1) {
  if (condition2) {
    if (condition3) {
      if (condition4) {
        // deep logic
      }
    }
  }
}

// After (guard clauses)
if (!condition1) return;
if (!condition2) return;
if (!condition3) return;
if (!condition4) return;
// logic at top level
```

### 2. Function Extraction
Extract nested loops and complex logic into separate methods:

```typescript
// Before
for (let x = 0; x < width; x++) {
  for (let y = 0; y < height; y++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (complex_condition) {
          // deep nested logic
        }
      }
    }
  }
}

// After
for (let x = 0; x < width; x++) {
  for (let y = 0; y < height; y++) {
    this.processNeighbors(x, y);
  }
}

private processNeighbors(x: number, y: number) {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      this.processNeighbor(x + dx, y + dy);
    }
  }
}
```

### 3. Array Methods and Functional Programming
Replace nested loops with array methods where appropriate:

```typescript
// Before (nested loops)
for (let i = 0; i < items.length; i++) {
  if (items[i].condition) {
    for (let j = 0; j < items[i].children.length; j++) {
      // process
    }
  }
}

// After (functional)
items
  .filter(item => item.condition)
  .forEach(item => item.children.forEach(child => this.process(child)));
```

### 4. Switch/Case to Strategy Pattern
Replace deeply nested conditionals with strategy patterns where applicable.

## Files to Refactor

### High Priority (Complex Game Logic)

1. **TerrainGenerator.ts** - 7 violations (lines 169, 170, 173, 175, 540, 773, 777)
   - Core map generation logic with nested terrain processing
   - Most critical for game functionality

2. **FractalHeightGenerator.ts** - 6 violations (lines 413, 434, 485, 488, 495, 501)
   - Height map generation with complex smoothing algorithms
   - Performance-critical code

3. **TerrainUtils.ts** - 5 violations (lines 280, 335, 338, 345, 351)
   - Utility functions used across terrain generation
   - Shared functionality impact

### Medium Priority (Service Layer)

4. **GameManager.ts** - 1 violation (line 902)
   - Core game state management
   - High impact but single violation

5. **UnitManager.ts** - 1 violation (line 750)
   - Unit management and processing
   - Gameplay impact

6. **GameBroadcastManager.ts** - 1 violation (line 148)
   - Network communication logic
   - Multiplayer functionality

### Lower Priority (Specific Features)

7. **BiomeProcessor.ts** - 4 violations (lines 420, 488, 498, 510)
8. **FairIslandsService.ts** - 1 violation (line 489)
9. **HeightBasedMapService.ts** - 1 violation (line 307)
10. **RiverGenerator.ts** - 2 violations (lines 372, 376)
11. **StartingPositionGenerator.ts** - 2 violations (lines 319, 321)
12. **ContinentProcessor.ts** - 1 violation (line 311)
13. **OceanProcessor.ts** - 2 violations (lines 70, 137)

### Network Layer

14. **ConnectionHandler.ts** - 1 violation (line 98)
15. **socket-handlers.ts** - 1 violation (line 458)

### Test Files

16. **Various test files** - 5 violations
    - Lower priority since they're test code

## Task List

### Phase 1: Core Terrain Generation (High Impact)
- [ ] **TerrainGenerator.ts** - Refactor deeply nested terrain processing loops
  - [ ] Line 169-175: Extract ocean depth calculation logic
  - [ ] Line 540: Simplify distance calculation
  - [ ] Line 773-777: Extract flat area detection logic
- [ ] **FractalHeightGenerator.ts** - Refactor smoothing algorithms  
  - [ ] Line 413: Extract smoothing pass logic
  - [ ] Line 434: Extract smoothing iteration
  - [ ] Line 485-501: Refactor int map smoothing
- [ ] **TerrainUtils.ts** - Extract utility functions
  - [ ] Line 280: Simplify filtering logic
  - [ ] Line 335-351: Refactor int map adjustment

### Phase 2: Game Management (Medium Impact)
- [ ] **GameManager.ts** - Line 902: Extract complex game state logic
- [ ] **UnitManager.ts** - Line 750: Simplify unit processing
- [ ] **GameBroadcastManager.ts** - Line 148: Extract broadcast logic

### Phase 3: Specialized Processors (Feature-Specific)
- [ ] **BiomeProcessor.ts** - Extract biome transition logic (4 violations)
- [ ] **FairIslandsService.ts** - Simplify island validation
- [ ] **HeightBasedMapService.ts** - Extract height map generation
- [ ] **RiverGenerator.ts** - Simplify river pathfinding
- [ ] **StartingPositionGenerator.ts** - Extract position validation
- [ ] **ContinentProcessor.ts** - Simplify continent detection
- [ ] **OceanProcessor.ts** - Extract ocean processing logic

### Phase 4: Network & Infrastructure
- [ ] **ConnectionHandler.ts** - Simplify connection logic
- [ ] **socket-handlers.ts** - Extract socket handling

### Phase 5: Test Code Cleanup
- [ ] Clean up test file violations (lower priority)

## Success Criteria

- [ ] Reduce max-depth violations from 39 to 0
- [ ] Maintain all existing functionality (verified by tests)
- [ ] No performance regression in critical paths
- [ ] Improved code readability scores
- [ ] No increase in other ESLint violations

## Testing Strategy

1. **Unit Tests**: Run existing test suites after each file refactor
2. **Integration Tests**: Verify game functionality works end-to-end
3. **Performance Tests**: Ensure no regression in map generation times
4. **Manual Testing**: Verify game creation and terrain generation still works

## Risk Mitigation

1. **Incremental Approach**: Refactor one file at a time
2. **Test Coverage**: Verify tests pass after each change
3. **Code Reviews**: Each refactor should be reviewed
4. **Rollback Plan**: Each commit should be atomic and revertible
5. **Performance Monitoring**: Track performance of critical paths

## Estimated Effort

- **Phase 1**: 2-3 days (most complex, high risk)
- **Phase 2**: 1-2 days (moderate complexity)
- **Phase 3**: 2-3 days (many files, moderate complexity each)
- **Phase 4**: 1 day (simpler network logic)
- **Phase 5**: 1 day (test cleanup)

**Total**: 7-10 days of development work

## Notes

- Some violations may be acceptable if refactoring would significantly harm readability
- Performance-critical code (terrain generation) should be carefully benchmarked
- Consider using ESLint disable comments for unavoidable cases with good justification
- Document any complex refactoring decisions for future maintainers

---

**Created**: 2025-09-04  
**Branch**: `fix/reduce-max-depth-violations`  
**Status**: Planning Phase  
