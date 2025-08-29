# CivJS Functional Compliance Remediation Task List

**Based on**: Functional Compliance Audit Report (August 29, 2025)  
**Overall Goal**: Increase functional compliance from 50% to 95%+  
**Priority**: Address critical user-facing issues first, then systematic improvements  

---

## 🚨 CRITICAL PRIORITY TASKS

### **TASK 1: Fix River Parameter Flow** 
**Status**: 🔴 Critical  
**Estimated Time**: 4-6 hours  
**Files Modified**: 2  
**User Impact**: Direct fix for "no rivers appearing" issue  

#### **Subtask 1.1: Update RiverGenerator API**
**File**: `/apps/server/src/game/map/RiverGenerator.ts`
**Changes**:
```typescript
// Current (broken)
public async generateAdvancedRivers(tiles: MapTile[][]): Promise<void> {
  const targetRivers = Math.floor(landTiles * 0.15); // Hardcoded 15%
}

// Target (compliant)
public async generateAdvancedRivers(
  tiles: MapTile[][], 
  riverPct: number,
  terrainParams: TerrainParameters
): Promise<void> {
  const targetRivers = Math.floor(landTiles * riverPct); // Use calculated %
}
```

**Acceptance Criteria**:
- [ ] `generateAdvancedRivers()` accepts `riverPct` parameter
- [ ] Remove hardcoded `0.15` constant
- [ ] Use calculated river percentage (typically 3-11%)
- [ ] Update constructor if needed for additional parameters

#### **Subtask 1.2: Update TerrainGenerator Integration**  
**File**: `/apps/server/src/game/map/TerrainGenerator.ts`
**Changes**:
```typescript
// Current makeRivers() call
await this.riverGenerator.generateAdvancedRivers(tiles);

// Target makeRivers() call  
const terrainParams = this.adjustTerrainParam(landpercent, steepness, wetness, temperature);
await this.riverGenerator.generateAdvancedRivers(tiles, terrainParams.river_pct, terrainParams);
```

**Acceptance Criteria**:
- [ ] Pass calculated `river_pct` to river generation
- [ ] Ensure `adjustTerrainParam()` results are used
- [ ] Update all `makeRivers()` call sites
- [ ] Add parameter validation

#### **Testing Requirements**:
- [ ] Generate maps with wetness=20 → expect ~5% rivers
- [ ] Generate maps with wetness=80 → expect ~10% rivers  
- [ ] Verify no hardcoded 15% river coverage
- [ ] Log actual vs expected river percentages

---

### **TASK 2: Add River Rendering Support**
**Status**: 🔴 Critical  
**Estimated Time**: 6-8 hours  
**Files Modified**: 2  
**User Impact**: Makes generated rivers visible to players  

#### **Subtask 2.1: Add riverMask Rendering**
**File**: `/apps/client/src/components/Canvas2D/MapRenderer.ts`
**Changes**:
```typescript
// Add after terrain layers in renderTerrainLayers()
private renderTerrainLayers(tile: Tile, screenPos: { x: number; y: number }) {
  // ... existing terrain rendering ...
  
  // NEW: Render river overlay
  if (tile.riverMask && tile.riverMask > 0) {
    this.renderRiverOverlay(tile, screenPos);
  }
}

// NEW: River overlay rendering function
private renderRiverOverlay(tile: Tile, screenPos: { x: number; y: number }) {
  const riverSprites = this.getRiverSprites(tile.riverMask);
  riverSprites.forEach(sprite => {
    if (sprite.image) {
      this.ctx.drawImage(sprite.image, 
        screenPos.x + sprite.offsetX, 
        screenPos.y + sprite.offsetY);
    }
  });
}
```

**Acceptance Criteria**:
- [ ] Check for `tile.riverMask` property in rendering pipeline
- [ ] Render river sprites as overlay after terrain, before units
- [ ] Support directional river segments based on mask bits
- [ ] Handle river sprite loading failures gracefully

#### **Subtask 2.2: Add River Sprite Support**
**File**: `/apps/client/src/components/Canvas2D/TilesetLoader.ts`
**Changes**:
- [ ] Ensure river sprites are loaded from tileset
- [ ] Add river sprite validation during tileset loading
- [ ] Map river directions to appropriate sprite keys
- [ ] Add fallback river visualization if sprites missing

#### **Subtask 2.3: Update Tile Type Definitions**
**File**: `/apps/client/src/types/index.ts`
**Changes**:
```typescript
export interface Tile {
  // ... existing properties ...
  riverMask?: number; // Ensure riverMask is properly typed
}
```

**Acceptance Criteria**:
- [ ] `riverMask` property properly typed and exported
- [ ] Client-server communication includes river data
- [ ] TypeScript compilation succeeds

#### **Testing Requirements**:
- [ ] Rivers appear visually in game client
- [ ] River directions match server-generated riverMask values
- [ ] Rivers render correctly with different terrain types
- [ ] No performance degradation from river rendering

---

### **TASK 3: Implement Freeciv River Algorithm**
**Status**: 🔴 Critical  
**Estimated Time**: 8-12 hours  
**Files Modified**: 1  
**User Impact**: Realistic river networks instead of random placement  

#### **Subtask 3.1: Replace Random Placement Algorithm**
**File**: `/apps/server/src/game/map/RiverGenerator.ts`
**Reference**: `freeciv/server/generator/mapgen.c:906-1050 make_rivers()`

**Changes**:
```typescript
// Current (broken)
while (riversPlaced < targetRivers && attempts > 0) {
  const x = Math.floor(this.random() * this.width);
  const y = Math.floor(this.random() * this.height);
  // Random placement...
}

// Target (freeciv-compliant)
public async generateAdvancedRivers(tiles: MapTile[][], riverPct: number): Promise<void> {
  const desirableRiverLength = riverPct * (this.width * this.height) * landpercent / 5325;
  let currentRiverLength = 0;
  let iterationCounter = 0;

  while (currentRiverLength < desirableRiverLength && iterationCounter < RIVERS_MAXTRIES) {
    const springTile = this.findRiverSpring(tiles); // Highland preference
    if (springTile) {
      const riverLength = await this.makeRiver(springTile, tiles, riverMap);
      currentRiverLength += riverLength;
    }
    iterationCounter++;
  }
}
```

**Key Algorithm Components**:
1. **River Springs**: Find suitable highland/mountain starting points
2. **River Flow**: Generate rivers that flow downhill toward ocean/lakes
3. **River Networks**: Connect rivers into realistic drainage systems
4. **Length Calculation**: Use freeciv's formula: `river_pct * map_tiles * landpercent / 5325`

**Acceptance Criteria**:
- [ ] Rivers start from highlands/mountains (not random locations)
- [ ] Rivers flow downhill toward ocean or existing water bodies
- [ ] Rivers can connect to form networks
- [ ] River density matches calculated `river_pct`
- [ ] Rivers avoid starting in inappropriate locations (ocean, existing rivers)

#### **Subtask 3.2: Add River Spring Selection**
**Implementation**:
```typescript
private findRiverSpring(tiles: MapTile[][]): {x: number, y: number} | null {
  // Prefer high elevation, mountainous terrain
  // Avoid frozen, dry terrain (unless late in iteration)
  // Don't start near existing rivers
  // Follow freeciv criteria from mapgen.c:949-990
}
```

#### **Subtask 3.3: Add River Network Building**
**Implementation**:
```typescript
private async makeRiver(startTile: {x: number, y: number}, tiles: MapTile[][], riverMap: RiverMapState): Promise<number> {
  // Generate river path from spring to ocean/lake
  // Use directional flow based on height map
  // Set appropriate riverMask bits for connections
  // Return length of river created
}
```

#### **Testing Requirements**:
- [ ] Rivers start from appropriate highland locations
- [ ] Rivers flow realistically toward water bodies
- [ ] River networks form connected drainage systems
- [ ] No rivers in inappropriate locations (ocean, frozen terrain early iterations)
- [ ] River density matches expected percentage

---

## 🟡 HIGH PRIORITY TASKS

### **TASK 4: Enhance Map Validation System**
**Status**: 🟡 High Priority  
**Estimated Time**: 4-6 hours  
**Files Modified**: 1  
**User Impact**: Catch functional failures before they reach users  

#### **Subtask 4.1: Add River Validation**
**File**: `/apps/server/src/game/map/MapValidator.ts`
**Changes**:
```typescript
// Add to validateMap() method
const riverResult = this.validateRiverDistribution(tiles, expectedRiverPct);
issues.push(...riverResult.issues);

// NEW: River validation method
private validateRiverDistribution(tiles: MapTile[][], expectedRiverPct: number): ValidationResult {
  const riverTiles = tiles.flat().filter(tile => tile.riverMask && tile.riverMask > 0);
  const landTiles = tiles.flat().filter(tile => this.isLandTile(tile.terrain));
  const actualRiverPct = (riverTiles.length / landTiles.length) * 100;
  
  const issues: ValidationIssue[] = [];
  
  if (Math.abs(actualRiverPct - expectedRiverPct) > 2) {
    issues.push({
      severity: 'warning',
      category: 'terrain',
      message: `River percentage (${actualRiverPct.toFixed(1)}%) differs from expected (${expectedRiverPct.toFixed(1)}%)`,
    });
  }
  
  if (riverTiles.length === 0) {
    issues.push({
      severity: 'error', 
      category: 'terrain',
      message: 'No rivers found on map - river generation may have failed',
    });
  }
  
  return { passed: issues.length === 0, score: 100 - issues.length * 15, issues, metrics: this.calculateMetrics(tiles) };
}
```

**Acceptance Criteria**:
- [ ] Validate river presence (error if no rivers found)
- [ ] Validate river density matches expected percentage (± 2%)
- [ ] Validate river connectivity (rivers form networks)
- [ ] Add river metrics to validation output

#### **Subtask 4.2: Add Parameter Compliance Validation**
**Implementation**:
```typescript
private validateParameterCompliance(tiles: MapTile[][], terrainParams: TerrainParameters): ValidationResult {
  // Verify that calculated terrain parameters are reflected in final map
  // Check forest_pct, desert_pct, river_pct, etc. match actual distribution
  // Flag cases where hardcoded overrides may be active
}
```

#### **Testing Requirements**:
- [ ] Maps with no rivers fail validation
- [ ] Maps with incorrect river density show warnings
- [ ] Parameter compliance validation catches hardcoded overrides

---

### **TASK 5: Improve Sprite System Reliability**
**Status**: 🟡 High Priority  
**Estimated Time**: 3-4 hours  
**Files Modified**: 2  
**User Impact**: Reduce solid color fallbacks, improve visual quality  

#### **Subtask 5.1: Add Sprite Loading Validation**
**File**: `/apps/client/src/components/Canvas2D/TilesetLoader.ts`
**Changes**:
```typescript
private async validateSpritecoverage(): Promise<void> {
  const requiredSprites = this.getRequiredSpriteList();
  const missingSprites: string[] = [];
  
  requiredSprites.forEach(spriteKey => {
    if (!this.sprites[spriteKey]) {
      missingSprites.push(spriteKey);
    }
  });
  
  if (missingSprites.length > 0) {
    console.warn(`Missing sprites: ${missingSprites.join(', ')}`);
    // Attempt to load fallback sprites or generate procedural alternatives
  }
}
```

**Acceptance Criteria**:
- [ ] Validate all required sprites loaded during tileset initialization
- [ ] Log missing sprites for debugging
- [ ] Attempt fallback sprite loading where possible
- [ ] Prevent silent fallback to solid colors

#### **Subtask 5.2: Improve Fallback Sprite System**
**File**: `/apps/client/src/components/Canvas2D/MapRenderer.ts`
**Changes**:
```typescript
// Instead of solid color fallback
if (!sprite) {
  // Try alternative sprite keys
  const fallbackKeys = this.generateFallbackSpriteKeys(spriteInfo.key);
  for (const fallbackKey of fallbackKeys) {
    const fallbackSprite = this.tilesetLoader.getSprite(fallbackKey);
    if (fallbackSprite) {
      sprite = fallbackSprite;
      break;
    }
  }
  
  // Only use solid color as last resort
  if (!sprite) {
    this.renderSolidColorFallback(tile, screenPos);
  }
}
```

#### **Testing Requirements**:
- [ ] Fewer instances of solid color terrain tiles
- [ ] Better fallback sprite selection
- [ ] Clear logging of sprite loading issues

---

## 🔵 MEDIUM PRIORITY TASKS

### **TASK 6: Add Integration Testing Framework**
**Status**: 🔵 Medium Priority  
**Estimated Time**: 6-8 hours  
**Files Created**: 3-4 test files  
**User Impact**: Prevent future functional compliance regressions  

#### **Subtask 6.1: Add Parameter Flow Testing**
**File**: `/apps/server/src/tests/integration/parameter-flow.test.ts`
**Implementation**:
```typescript
describe('Parameter Flow Integration', () => {
  test('river percentage flows from calculation to generation', async () => {
    const mapManager = new MapManager(100, 100);
    const wetness = 80; // Should produce ~10% rivers
    
    const mapData = await mapManager.generateMapRandom(new Map([['player1', mockPlayer]]));
    
    const riverTiles = mapData.tiles.flat().filter(tile => tile.riverMask > 0);
    const landTiles = mapData.tiles.flat().filter(tile => isLandTile(tile.terrain));
    const actualRiverPct = (riverTiles.length / landTiles.length) * 100;
    
    expect(actualRiverPct).toBeCloseTo(10, 1); // Within 1% of expected
    expect(riverTiles.length).toBeGreaterThan(0); // Rivers exist
  });
});
```

#### **Subtask 6.2: Add End-to-End Feature Testing**
**File**: `/apps/client/src/tests/integration/river-rendering.test.ts`
**Implementation**:
```typescript
describe('River End-to-End', () => {
  test('server-generated rivers appear in client', async () => {
    // Generate map server-side
    // Simulate client receiving map data
    // Verify rivers are rendered correctly
  });
});
```

#### **Testing Requirements**:
- [ ] Parameter flow tests for all terrain parameters
- [ ] End-to-end river generation and rendering tests
- [ ] Validation system tests
- [ ] Performance regression tests

---

### **TASK 7: Add Comprehensive Logging and Debugging**
**Status**: 🔵 Medium Priority  
**Estimated Time**: 2-3 hours  
**Files Modified**: Multiple  
**User Impact**: Better debugging of functional issues  

#### **Subtask 7.1: Add Parameter Flow Logging**
**Changes Across Files**:
```typescript
// TerrainGenerator.ts
private adjustTerrainParam(...) {
  const params = { river_pct, forest_pct, /* ... */ };
  logger.debug('Calculated terrain parameters', params);
  return params;
}

// RiverGenerator.ts  
public async generateAdvancedRivers(tiles: MapTile[][], riverPct: number) {
  logger.info(`Starting river generation with ${riverPct}% target density`);
  // ... generation logic ...
  logger.info(`River generation completed: ${riversPlaced} rivers (${actualPct}% density)`);
}
```

#### **Subtask 7.2: Add Sprite Loading Debugging**
**File**: `/apps/client/src/components/Canvas2D/MapRenderer.ts`
**Changes**:
```typescript
private renderTerrainLayers(tile: Tile, screenPos: { x: number; y: number }) {
  if (!window.spritesLogged) {
    console.log('Sprite rendering debug info:', {
      totalSpritesLoaded: Object.keys(this.tilesetLoader.sprites).length,
      terrainType: tile.terrain,
      riverMask: tile.riverMask,
    });
    window.spritesLogged = true;
  }
}
```

#### **Testing Requirements**:
- [ ] Parameter values logged at calculation and usage points
- [ ] River generation statistics logged
- [ ] Sprite loading issues clearly reported
- [ ] Debug information helpful for troubleshooting

---

## 🟢 LOW PRIORITY TASKS

### **TASK 8: Performance Optimization**
**Status**: 🟢 Low Priority  
**Estimated Time**: 4-6 hours  
**Files Modified**: Multiple  
**User Impact**: Better performance with complex river networks  

#### **Subtask 8.1: Optimize River Generation Performance**
**File**: `/apps/server/src/game/map/RiverGenerator.ts`
- [ ] Cache height map lookups for river flow calculation
- [ ] Optimize river connectivity checks
- [ ] Batch river mask updates

#### **Subtask 8.2: Optimize River Rendering Performance**  
**File**: `/apps/client/src/components/Canvas2D/MapRenderer.ts`
- [ ] Cache river sprites to avoid repeated lookups
- [ ] Only render rivers in visible viewport
- [ ] Batch river sprite rendering operations

---

### **TASK 9: Enhanced Error Handling**
**Status**: 🟢 Low Priority  
**Estimated Time**: 3-4 hours  
**Files Modified**: Multiple  
**User Impact**: Better error messages and graceful degradation  

#### **Subtask 9.1: Add Parameter Validation**
**Implementation**:
```typescript
// Add to all parameter-receiving functions
private validateParameters(riverPct: number, terrainParams: TerrainParameters): void {
  if (riverPct < 0 || riverPct > 20) {
    throw new Error(`Invalid river percentage: ${riverPct}. Expected 0-20.`);
  }
  // Additional validation...
}
```

#### **Subtask 9.2: Add Graceful Degradation**
- [ ] Fallback algorithms when primary generation fails
- [ ] Alternative sprite loading strategies
- [ ] User-friendly error messages

---

## Implementation Schedule

### **Phase 1: Critical Fixes (Week 1)**
- **Day 1-2**: Task 1 - Fix River Parameter Flow
- **Day 3-4**: Task 2 - Add River Rendering Support  
- **Day 5-7**: Task 3 - Implement Freeciv River Algorithm

### **Phase 2: Quality Improvements (Week 2)**  
- **Day 1-2**: Task 4 - Enhance Map Validation
- **Day 3-4**: Task 5 - Improve Sprite System Reliability
- **Day 5-7**: Task 6 - Add Integration Testing Framework

### **Phase 3: Polish and Optimization (Week 3)**
- **Day 1-3**: Task 7 - Add Comprehensive Logging
- **Day 4-5**: Task 8 - Performance Optimization
- **Day 6-7**: Task 9 - Enhanced Error Handling

---

## Success Metrics

### **Functional Compliance Targets**
- **Overall Compliance**: 50% → 95%
- **River System**: 0% → 95%
- **Sprite Rendering**: 60% → 90%
- **Map Validation**: 30% → 95%

### **User-Facing Improvements**
- [ ] Rivers appear in random maps
- [ ] River density matches wetness settings
- [ ] Rivers look realistic (flow from highlands to water)
- [ ] No more solid color terrain fallbacks
- [ ] Map validation catches functional issues

### **Technical Quality Metrics**
- [ ] No hardcoded parameter overrides
- [ ] All calculated parameters used correctly
- [ ] End-to-end feature integration working
- [ ] Comprehensive test coverage for parameter flow
- [ ] Clear logging and debugging capabilities

---

## Risk Assessment

### **High Risk Items**
1. **River Algorithm Complexity**: Freeciv river generation is sophisticated - may require multiple iterations
2. **Client-Server Integration**: River data must flow correctly across network boundary
3. **Performance Impact**: Complex river networks may affect rendering performance

### **Mitigation Strategies**
1. **Incremental Implementation**: Start with basic river flow, add complexity gradually
2. **Extensive Testing**: Add integration tests for each component
3. **Performance Monitoring**: Track rendering performance with river networks
4. **Rollback Plan**: Keep existing (broken) system as fallback during development

---

## Dependencies

### **External Dependencies**
- None - all work within existing codebase

### **Internal Dependencies**  
1. **Task 1 → Task 2**: River parameter flow must work before rendering
2. **Task 2 → Task 3**: Basic rendering needed to test advanced algorithm
3. **Task 1,2,3 → Task 4**: Core functionality needed before validation enhancement

### **Resource Requirements**
- **Developer Time**: ~30-40 hours total
- **Testing Time**: ~10-15 hours  
- **Code Review**: ~5-8 hours
- **Documentation**: ~3-5 hours

---

## Notes

### **Key Implementation Principles**
1. **Preserve Existing Architecture**: Work within current system design
2. **Maintain Backwards Compatibility**: Don't break existing functionality  
3. **Follow Freeciv Reference**: Stay compliant with original implementation
4. **Add Comprehensive Testing**: Prevent future functional regressions
5. **Document All Changes**: Maintain clear audit trail

### **Quality Gates**
Each task must pass:
- [ ] Code review by team member
- [ ] Unit tests passing
- [ ] Integration tests passing  
- [ ] No performance regression
- [ ] Documentation updated

**Task List Generated**: August 29, 2025  
**Estimated Completion**: 3 weeks with dedicated developer  
**Next Review**: After Phase 1 completion