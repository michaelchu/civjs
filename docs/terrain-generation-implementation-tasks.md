# Terrain Generation Parity Implementation Tasks

Based on the [Terrain Generation Parity Audit](./terrain-generation-parity-audit.md), this document outlines actionable tasks to address identified gaps and achieve full parity with the freeciv reference implementation.

**Current Status**: 78% faithful coverage  
**Target**: 95%+ faithful coverage with full algorithmic parity

---

## CRITICAL PRIORITY (P0) - Immediate Implementation Required

### Task 1: Implement Pole Normalization System
**Priority**: P0 - Critical  
**Impact**: High - Fixes unrealistic polar geography  
**Effort**: 3-4 days  
**Files**: `apps/server/src/game/map/FractalHeightGenerator.ts`

**Subtasks**:
1. **Add pole factor calculation method**
   ```typescript
   // @ref: freeciv/server/generator/height_map.c:35-57
   private getPoleFactor(x: number, y: number): number
   ```
   - Implement colatitude-based pole flattening
   - Add ice base level calculations
   - Handle flat poles percentage parameter

2. **Implement normalize_hmap_poles() equivalent**
   ```typescript
   // @ref: freeciv/server/generator/height_map.c:65-75
   public normalizeHeightMapPoles(): void
   ```
   - Apply pole factors to reduce polar heights
   - Prevent excessive polar landmasses
   - Maintain realistic ice formation zones

3. **Add renormalize_hmap_poles() equivalent**
   ```typescript
   public renormalizeHeightMapPoles(): void
   ```
   - Restore original heights after terrain placement
   - Required for texture generation phase

4. **Integration into height generation flow**
   - Call `normalizeHeightMapPoles()` after initial height generation
   - Call `renormalizeHeightMapPoles()` before texture application
   - Update `generateHeightMap()` to include pole normalization step

**Acceptance Criteria**:
- [x] Polar regions show realistic ice/tundra distribution
- [x] No excessive landmasses near map edges
- [x] Height distribution matches freeciv polar characteristics
- [x] All existing tests pass with polar normalization enabled

---

### Task 2: Implement Placement Tracking System
**Priority**: P0 - Critical  
**Impact**: High - Prevents terrain placement conflicts  
**Effort**: 2-3 days  
**Files**: `apps/server/src/game/map/TerrainUtils.ts`, `apps/server/src/game/map/TerrainGenerator.ts`

**Subtasks**:
1. **Create PlacementMap class**
   ```typescript
   // @ref: freeciv/server/generator/mapgen_utils.c (placement functions)
   export class PlacementMap {
     private placedMap: boolean[][];
     
     public createPlacedMap(): void;
     public destroyPlacedMap(): void;
     public isPlaced(x: number, y: number): boolean;
     public setPlaced(x: number, y: number): void;
     public unsetPlaced(x: number, y: number): void;
   }
   ```

2. **Implement placement tracking functions**
   - `setAllOceanTilesPlaced()` - Mark ocean tiles as unavailable
   - `setPlacedNearPos(x, y, distance)` - Mark area around position
   - `notPlaced(x, y)` - Check if tile is available for placement

3. **Integrate into terrain generation**
   - Initialize placement map in `makeLand()`
   - Update `makeTerrains()` to respect placement status
   - Mark tiles as placed after terrain assignment
   - Clean up placement map after generation

4. **Update terrain placement logic**
   - Modify `randMapPosCharacteristic()` to check placement status
   - Ensure no overwrites of specialized terrain
   - Add placement validation to island generation

**Acceptance Criteria**:
- [ ] No terrain overwrites during generation
- [ ] Systematic terrain placement prevents conflicts
- [ ] Ocean tiles properly excluded from land terrain placement
- [ ] Island generation respects placement boundaries

---

### Task 3: Fix Terrain Characteristic System
**Priority**: P0 - Critical  
**Impact**: Medium-High - Improves terrain variety and placement accuracy  
**Effort**: 4-5 days  
**Files**: `apps/server/src/game/map/TerrainGenerator.ts`, `apps/server/src/game/map/TerrainUtils.ts`

**Subtasks**:
1. **Implement comprehensive terrain properties**
   ```typescript
   // @ref: freeciv terrain rulesets
   interface TerrainRuleset {
     properties: {
       MG_FOLIAGE: boolean;
       MG_TROPICAL: boolean;
       MG_COLD: boolean;
       MG_WET: boolean;
       MG_DRY: boolean;
       MG_MOUNTAINOUS: boolean;
       MG_OCEAN_DEPTH: number;
     };
     moveCost: number;
     defense: number;
     // ... other properties
   }
   ```

2. **Replace hardcoded terrain properties**
   - Create data-driven terrain configuration
   - Implement terrain property lookup system
   - Add support for complex terrain conditions

3. **Enhance characteristic checking**
   ```typescript
   // @ref: freeciv/server/generator/mapgen.c characteristic functions
   private checkTerrainCharacteristic(
     tile: MapTile, 
     target: MapgenTerrainProperty,
     prefer: MapgenTerrainProperty,
     avoid: MapgenTerrainProperty
   ): boolean
   ```

4. **Update terrain selection logic**
   - Implement weighted terrain selection
   - Add proper terrain property matching
   - Enhance `placeTerrain()` with spreading logic

**Acceptance Criteria**:
- [ ] Terrain placement uses property-based selection like freeciv
- [ ] No hardcoded terrain characteristics
- [ ] Configurable terrain rulesets
- [ ] Improved terrain variety and realism

---

## HIGH PRIORITY (P1) - Next Sprint Implementation

### Task 4: Implement Advanced Smoothing System
**Priority**: P1 - High  
**Impact**: Medium - Improves terrain naturalness  
**Effort**: 2-3 days  
**Files**: `apps/server/src/game/map/FractalHeightGenerator.ts`, `apps/server/src/game/map/TerrainUtils.ts`

**Subtasks**:
1. **Port smooth_int_map() with Gaussian filtering**
   ```typescript
   // @ref: freeciv/server/generator/mapgen_utils.c:306-355
   public smoothIntMap(
     intMap: number[], 
     width: number, 
     height: number,
     zeroesAtEdges: boolean = false
   ): void
   ```

2. **Implement histogram equalization**
   ```typescript
   // @ref: freeciv/server/generator/mapgen_utils.c adjust_int_map_filtered
   public adjustIntMapFiltered(
     intMap: number[],
     minValue: number,
     maxValue: number,
     filter?: (x: number, y: number) => boolean
   ): void
   ```

3. **Add edge handling options**
   - Support for zero-edge smoothing
   - Proper boundary condition handling
   - Configurable smoothing kernel weights

4. **Integration into generation pipeline**
   - Replace basic smoothing with Gaussian filter
   - Apply to height maps, wetness maps, temperature maps
   - Add smoothing passes configuration

**Acceptance Criteria**:
- [ ] Natural terrain transitions match freeciv quality
- [ ] Proper edge handling prevents artifacts
- [ ] Configurable smoothing intensity
- [ ] Performance acceptable for real-time generation

---

### Task 5: Implement Relief Generation System
**Priority**: P1 - High  
**Impact**: Medium - Better mountain/hill placement  
**Effort**: 3-4 days  
**Files**: `apps/server/src/game/map/TerrainGenerator.ts`

**Subtasks**:
1. **Implement make_relief() equivalent**
   ```typescript
   // @ref: freeciv/server/generator/mapgen.c:397-458
   private makeRelief(
     tiles: MapTile[][], 
     heightMap: number[], 
     shoreLevel: number,
     mountainPct: number
   ): void
   ```

2. **Add elevation-based terrain assignment**
   - Calculate mountain/hill thresholds from height distribution
   - Implement area_is_too_flat() equivalent for hill placement
   - Add local elevation averaging for smooth transitions

3. **Implement make_fracture_relief() for fracture maps**
   ```typescript
   // @ref: freeciv/server/generator/fracture_map.c make_fracture_relief
   private makeFractureRelief(
     tiles: MapTile[][],
     heightMap: number[],
     shoreLevel: number
   ): void
   ```

4. **Enhanced mountain placement logic**
   - Distance-based mountain clustering
   - Elevation variance analysis
   - Realistic mountain range formation

**Acceptance Criteria**:
- [ ] Mountains and hills placed based on elevation analysis
- [ ] Natural mountain range formation
- [ ] Fracture maps have appropriate relief characteristics
- [ ] Terrain elevation distribution matches freeciv

---

### Task 6: Align Temperature Map Generation Timing
**Priority**: P1 - High  
**Impact**: Low-Medium - Consistency with freeciv sequence  
**Effort**: 1-2 days  
**Files**: `apps/server/src/game/MapManager.ts`

**Subtasks**:
1. **Move temperature map generation to standard timing**
   - Remove lazy generation (`ensureTemperatureMap()`)
   - Generate temperature map immediately after height generation
   - Match freeciv generation sequence exactly

2. **Update generation flow**
   ```typescript
   // Match freeciv sequence:
   // 1. Height generation
   // 2. Pole normalization  
   // 3. Temperature map creation ← Move here
   // 4. Terrain assignment
   // 5. Ocean processing
   ```

3. **Optimize memory usage**
   - Add option to deallocate temperature map after use
   - Implement memory-conscious generation for large maps
   - Maintain performance benefits where possible

**Acceptance Criteria**:
- [ ] Temperature map generated at same point as freeciv
- [ ] No performance regression
- [ ] Memory usage remains acceptable
- [ ] Generation sequence matches reference exactly

---

## MEDIUM PRIORITY (P2) - Future Enhancement

### Task 7: Enhance Island Terrain Selection System
**Priority**: P2 - Medium  
**Impact**: Medium - Better island terrain variety  
**Effort**: 3-4 days  
**Files**: `apps/server/src/game/map/IslandGenerator.ts`

**Subtasks**:
1. **Complete island_terrain system port**
   ```typescript
   // @ref: freeciv/server/generator/mapgen.c:2018-2066
   - Implement complete terrain selector arrays
   - Add proper weight-based selection
   - Port fill_island() terrain distribution logic
   ```

2. **Add bucket-based terrain distribution**
   - Implement terrain bucket state management
   - Add fractional terrain placement
   - Balance terrain types across islands

3. **Improve terrain variety algorithms**
   - Climate-based terrain selection
   - Elevation-aware terrain placement
   - Natural terrain clustering

**Acceptance Criteria**:
- [ ] Island terrain variety matches freeciv quality
- [ ] Proper climate-based terrain distribution
- [ ] Balanced terrain types across all islands

---

### Task 8: Add Comprehensive Validation System
**Priority**: P2 - Medium  
**Impact**: Low-Medium - Quality assurance  
**Effort**: 2-3 days  
**Files**: `apps/server/src/game/map/MapValidator.ts` (new)

**Subtasks**:
1. **Create map validation framework**
   ```typescript
   export class MapValidator {
     public validateTerrainDistribution(tiles: MapTile[][]): ValidationResult;
     public validateContinentSizes(tiles: MapTile[][]): ValidationResult;
     public validateStartingPositions(tiles: MapTile[][], startPos: Position[]): ValidationResult;
   }
   ```

2. **Implement validation checks**
   - Land/ocean percentage validation
   - Terrain type distribution analysis
   - Continent connectivity verification
   - Starting position quality assessment

3. **Add performance monitoring**
   - Generation timing metrics
   - Memory usage tracking
   - Comparison with freeciv benchmarks

**Acceptance Criteria**:
- [ ] Comprehensive map quality validation
- [ ] Performance metrics collection
- [ ] Automated quality regression detection

---

### Task 9: Implement Fair Islands Validation Enhancement
**Priority**: P2 - Medium  
**Impact**: Low - Better fair generation success rate  
**Effort**: 2-3 days  
**Files**: `apps/server/src/game/MapManager.ts`

**Subtasks**:
1. **Enhance fair islands pre-validation**
   ```typescript
   // @ref: freeciv/server/generator/mapgen.c:3389-3520
   private validateFairIslands(
     players: Map<string, PlayerState>,
     startPosMode: StartPosMode
   ): boolean
   ```

2. **Add post-generation quality checks**
   - Island size distribution analysis
   - Resource balance verification
   - Starting position distance validation

3. **Implement retry logic with adaptive parameters**
   - Progressive parameter adjustment on failure
   - Intelligent fallback selection
   - Success rate monitoring and reporting

**Acceptance Criteria**:
- [ ] Higher fair islands generation success rate
- [ ] Better parameter adaptation on failure
- [ ] Improved multiplayer balance

---

## LOW PRIORITY (P3) - Optional Enhancements

### Task 10: Add Generator-Specific Terrain Characteristics
**Priority**: P3 - Low  
**Impact**: Low - Enhanced realism per generator type  
**Effort**: 2-3 days  
**Files**: `apps/server/src/game/map/TerrainGenerator.ts`

**Subtasks**:
1. **Implement generator-specific relief**
   - Fracture maps: Enhanced continental relief
   - Island maps: Coastal terrain emphasis
   - Random maps: Balanced terrain distribution

2. **Add terrain clustering algorithms**
   - Biome-based terrain grouping
   - Natural terrain transitions
   - Regional climate consistency

**Acceptance Criteria**:
- [ ] Each generator type has unique terrain characteristics
- [ ] Natural terrain clustering and transitions
- [ ] Enhanced visual and gameplay variety

---

### Task 11: Performance Optimization
**Priority**: P3 - Low  
**Impact**: Low - Better generation performance  
**Effort**: 3-4 days  
**Files**: Multiple

**Subtasks**:
1. **Optimize critical algorithms**
   - Vectorize smoothing operations
   - Parallelize independent calculations
   - Cache expensive computations

2. **Add progressive generation**
   - Chunked generation for large maps
   - Progress reporting for UI
   - Cancellation support

3. **Memory optimization**
   - Streaming generation for memory-constrained environments
   - Temporary buffer reuse
   - Garbage collection optimization

**Acceptance Criteria**:
- [ ] Generation performance matches or exceeds freeciv
- [ ] Smooth generation experience for large maps
- [ ] Reduced memory footprint

---

### Task 12: Enhanced Documentation and Testing
**Priority**: P3 - Low  
**Impact**: Low - Developer experience and maintenance  
**Effort**: 2-3 days  
**Files**: Tests and documentation

**Subtasks**:
1. **Add comprehensive unit tests**
   - Algorithm correctness verification
   - Statistical distribution testing
   - Performance regression testing

2. **Create visual debugging tools**
   - Height map visualization
   - Temperature map overlay
   - Terrain distribution analysis

3. **Enhanced reference documentation**
   - Algorithm explanation with visual examples
   - Parameter tuning guidelines
   - Troubleshooting guide

**Acceptance Criteria**:
- [ ] >90% test coverage for terrain generation
- [ ] Visual debugging tools for development
- [ ] Comprehensive documentation

---

## Implementation Strategy

### Phase 1: Critical Foundation (Weeks 1-2)
- **Complete P0 tasks** (Tasks 1-3)
- Focus on core algorithm parity
- Establish solid foundation for future enhancements
- **Target**: 85% faithful coverage

### Phase 2: Quality Enhancement (Weeks 3-4)  
- **Complete P1 tasks** (Tasks 4-6)
- Improve terrain quality and naturalness
- Align generation sequence with freeciv
- **Target**: 90% faithful coverage

### Phase 3: Feature Enhancement (Weeks 5-6)
- **Complete selected P2 tasks** (Tasks 7-9)
- Focus on gameplay impact features
- Add validation and monitoring
- **Target**: 93% faithful coverage

### Phase 4: Polish and Optimization (Week 7)
- **Complete selected P3 tasks** (Tasks 10-12)
- Performance optimization
- Documentation and testing
- **Target**: 95%+ faithful coverage

---

## Success Metrics

### Quantitative Goals
- **Algorithmic Parity**: 95%+ faithful coverage
- **Performance**: Generation time ≤ 2x freeciv reference
- **Quality**: Pass 90% of freeciv validation checks
- **Reliability**: <5% generation failure rate

### Qualitative Goals
- **Visual Quality**: Terrain appears natural and varied
- **Gameplay Balance**: Fair starting positions and resource distribution  
- **Code Quality**: Well-documented, maintainable implementation
- **Developer Experience**: Clear debugging and configuration tools

---

## Risk Mitigation

### High Risk Areas
1. **Polar Geography**: Complex pole normalization may introduce edge cases
   - **Mitigation**: Extensive testing with various map sizes and settings
   
2. **Performance Impact**: Additional processing may slow generation
   - **Mitigation**: Profile and optimize critical paths, add generation settings

3. **Compatibility**: Changes may break existing game saves or tests
   - **Mitigation**: Feature flags, backward compatibility testing

### Dependencies
- Some tasks depend on completion of P0 foundation tasks
- Testing infrastructure may need enhancement
- Visual debugging tools require UI development resources

---

This implementation roadmap provides a systematic approach to achieving full parity with freeciv's terrain generation while maintaining code quality and performance. Priority should be given to P0 tasks as they address fundamental algorithmic gaps that significantly impact terrain quality and realism.