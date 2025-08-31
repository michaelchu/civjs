# Code Organization Analysis & Refactoring Recommendations

## Current State Assessment

### ✅ **What's Working Well**
- **Clear separation by domain**: Game logic in `/game/`, rendering in `/components/Canvas2D/`
- **Established patterns**: Manager classes, database schemas, types separation
- **Consistent naming**: Good file and function naming conventions
- **Reference documentation**: Comprehensive source citations

### ❌ **Code Organization Issues Identified**

#### 1. **Movement System Constants Scattered**
**Problem**: Movement constants are defined in `UnitManager.ts` but should be shared
```typescript
// Currently in UnitManager.ts
export const SINGLE_MOVE = 3; // Used across multiple files
export const MAX_MOVE_FRAGS = 65000;
```

#### 2. **Unit Type Definitions Bloat UnitManager**
**Problem**: 70+ lines of unit definitions make UnitManager hard to read
```typescript
// Currently in UnitManager.ts - makes file 580+ lines
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: { ... }, // 15 lines each
  settler: { ... },
  // ... 6 unit types
};
```

#### 3. **Terrain Movement Logic Duplication**
**Problem**: Terrain properties exist in both files with different purposes
- `TerrainUtils.ts:223-251`: Has terrain properties but empty implementation
- `UnitManager.ts:492-518`: Has actual movement costs

#### 4. **Unit Sprite Logic Mixed with Rendering**
**Problem**: Sprite mapping logic is embedded in MapRenderer
```typescript
// Currently in MapRenderer.ts
private getUnitTypeGraphicTag(unitType: string): string {
  const unitSpriteMap: Record<string, string> = { ... }; // Should be separate
}
```

#### 5. **Unit Packet Formatting in Wrong Place**
**Problem**: Unit packet formatting is in GameManager instead of reusable utility
```typescript
// Currently in GameManager.ts
private formatUnitForClient(unit: any, unitManager: any): any { ... }
```

## 🏗️ **Recommended File Structure**

### **Create New Files for Better Organization**

```
apps/server/src/
├── game/
│   ├── constants/
│   │   ├── MovementConstants.ts          # NEW: Movement fragments constants
│   │   └── UnitConstants.ts              # NEW: Unit type definitions
│   ├── units/
│   │   ├── UnitManager.ts                # REFACTORED: Slimmed down
│   │   ├── UnitMovement.ts               # NEW: Movement calculation logic
│   │   └── UnitPackets.ts                # NEW: Unit packet formatting
│   └── map/
│       └── TerrainMovement.ts            # NEW: Terrain movement utilities

apps/client/src/
├── components/Canvas2D/
│   ├── rendering/
│   │   ├── UnitRenderer.ts               # NEW: Pure unit rendering
│   │   └── UnitSprites.ts                # NEW: Sprite mapping logic
│   └── MapRenderer.ts                    # REFACTORED: Slimmed down
```

### **Refactoring Benefits**

| Current Issue | Solution | Benefits |
|---------------|----------|-----------|
| Scattered constants | `MovementConstants.ts` | Single source of truth, easy imports |
| Bloated UnitManager | `UnitConstants.ts` | Cleaner manager, easier unit addition |
| Duplicate terrain logic | `TerrainMovement.ts` | DRY principles, consistent logic |
| Mixed rendering concerns | `UnitRenderer.ts` + `UnitSprites.ts` | Separation of concerns |
| Misplaced packet logic | `UnitPackets.ts` | Reusable, testable utilities |

## 📋 **Detailed Refactoring Plan**

### **Phase 1: Create Constants Files**

#### **1.1 Create `MovementConstants.ts`**
```typescript
// apps/server/src/game/constants/MovementConstants.ts
/**
 * Movement system constants
 * @reference freeciv/server/ruleset/ruleload.c terrain_control
 */
export const SINGLE_MOVE = 3; // 1 movement point = 3 movement fragments
export const MAX_MOVE_FRAGS = 65000; // Maximum movement fragments

/**
 * Terrain movement costs in movement fragments
 * @reference freeciv/data/classic/terrain.ruleset
 */
export const TERRAIN_MOVEMENT_COSTS: Record<string, number> = {
  // Flat terrain: 1 movement point = 3 fragments
  ocean: SINGLE_MOVE,
  coast: SINGLE_MOVE,
  deep_ocean: SINGLE_MOVE,
  lake: SINGLE_MOVE,
  plains: SINGLE_MOVE,
  grassland: SINGLE_MOVE,
  desert: SINGLE_MOVE,
  tundra: SINGLE_MOVE,

  // Rough terrain: 2 movement points = 6 fragments
  hills: SINGLE_MOVE * 2,
  forest: SINGLE_MOVE * 2,
  jungle: SINGLE_MOVE * 2,
  swamp: SINGLE_MOVE * 2,

  // Impassable terrain: 3 movement points = 9 fragments
  mountains: SINGLE_MOVE * 3,
};

export function getTerrainMovementCost(terrain: string): number {
  return TERRAIN_MOVEMENT_COSTS[terrain] || SINGLE_MOVE;
}
```

#### **1.2 Create `UnitConstants.ts`**
```typescript
// apps/server/src/game/constants/UnitConstants.ts
import { SINGLE_MOVE } from './MovementConstants';
import { UnitType } from '../../types/common';

/**
 * Unit type definitions
 * @reference freeciv/data/classic/units.ruleset
 */
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    cost: 40,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 20,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
  },
  // ... other unit types
};

export function getUnitType(unitTypeId: string): UnitType | undefined {
  return UNIT_TYPES[unitTypeId];
}
```

### **Phase 2: Create Specialized Utilities**

#### **2.1 Create `UnitMovement.ts`**
```typescript
// apps/server/src/game/units/UnitMovement.ts
import { getTerrainMovementCost } from '../constants/MovementConstants';
import { Unit } from '../../types/common';

/**
 * Unit movement calculation utilities
 * @reference freeciv/common/movement.c
 */
export class UnitMovement {
  constructor(private mapManager: any) {}

  /**
   * Calculate movement cost between two positions in movement fragments
   * @reference freeciv/common/movement.c map_move_cost_unit()
   */
  calculateMovementCost(unit: Unit, fromX: number, fromY: number, toX: number, toY: number): number {
    const distance = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
    
    if (distance > 1) {
      const destinationTerrain = this.getTerrainAt(toX, toY);
      return getTerrainMovementCost(destinationTerrain) * distance;
    }

    const destinationTerrain = this.getTerrainAt(toX, toY);
    return getTerrainMovementCost(destinationTerrain);
  }

  private getTerrainAt(x: number, y: number): string {
    try {
      const tile = this.mapManager?.getTile(x, y);
      return tile?.terrain || 'plains';
    } catch (error) {
      return 'plains';
    }
  }
}
```

#### **2.2 Create `UnitPackets.ts`**
```typescript
// apps/server/src/game/units/UnitPackets.ts
import { getUnitType } from '../constants/UnitConstants';

/**
 * Unit packet formatting utilities
 * @reference freeciv-web unit packet format
 */
export class UnitPackets {
  /**
   * Format unit for client communication
   * @reference freeciv-web unit packet format
   */
  static formatUnitForClient(unit: any): any {
    const unitType = getUnitType(unit.unitTypeId);
    
    return {
      id: unit.id,
      owner: unit.playerId,
      type: unitType?.id || unit.unitTypeId,
      tile: unit.x + unit.y * 100, // Convert to tile index (simplified)
      x: unit.x,
      y: unit.y,
      hp: unit.health,
      movesleft: unit.movementLeft, // Already in fragments
      veteran: unit.veteranLevel,
      transported: false,
      paradropped: false,
      connecting: false,
      occupied: false,
      done_moving: unit.movementLeft === 0,
      battlegroup: -1,
      has_orders: false,
      homecity: 0, // No home city initially
      fuel: 0,
      goto_tile: -1,
      activity: 0, // ACTIVITY_IDLE
      activity_count: 0,
      activity_target: null,
      focus: false,
    };
  }
}
```

### **Phase 3: Client-Side Organization**

#### **3.1 Create `UnitSprites.ts`**
```typescript
// apps/client/src/components/Canvas2D/rendering/UnitSprites.ts
/**
 * Unit sprite mapping and management
 * @reference freeciv-web tileset naming conventions
 */
export class UnitSprites {
  /**
   * Get unit type graphic tag
   * @reference freeciv-web: tileset_unit_graphic_tag()
   */
  static getUnitTypeGraphicTag(unitType: string): string {
    const unitSpriteMap: Record<string, string> = {
      warrior: 'u.warriors:0',
      settler: 'u.settlers:0', 
      scout: 'u.explorers:0',
      worker: 'u.workers:0',
      archer: 'u.archers:0',
      spearman: 'u.phalanx:0'
    };

    return unitSpriteMap[unitType] || `u.${unitType}:0`;
  }

  /**
   * Fill unit sprite array based on freeciv-web implementation
   * @reference freeciv-web/.../tilespec.js:fill_unit_sprite_array()
   */
  static fillUnitSpriteArray(unit: Unit): Array<{ key: string; offset_x?: number; offset_y?: number }> {
    const sprites: Array<{ key: string; offset_x?: number; offset_y?: number }> = [];

    // Get main unit graphic
    const unitGraphic = UnitSprites.getUnitTypeGraphicTag(unit.type);
    sprites.push({
      key: unitGraphic,
      offset_x: 0,
      offset_y: 0
    });

    // TODO: Add nation flag and activity sprites

    return sprites;
  }
}
```

## 🎯 **Implementation Priority**

### **High Priority (Should Implement)**
1. **Movement Constants** - Single source of truth for movement system
2. **Unit Constants** - Clean up UnitManager bloat

### **Medium Priority (Nice to Have)**  
3. **Unit Movement Utilities** - Better separation of movement logic
4. **Unit Packets** - Reusable packet formatting

### **Low Priority (Future Enhancement)**
5. **Client Sprite Organization** - Already working, not urgent

## 💡 **Alternative: Minimal Refactoring Approach**

If full refactoring is too much, here's a minimal approach:

### **Option A: Extract Constants Only**
```typescript
// Create only these two files:
apps/server/src/game/constants/
├── MovementConstants.ts    # Movement fragments & terrain costs
└── UnitTypes.ts           # Unit type definitions

// Update imports in existing files
```

### **Option B: Current Structure is Acceptable**
- The current structure works functionally
- Code is well-documented with references
- No breaking changes needed
- Focus on new features instead of refactoring

## 🔍 **Recommendation**

**For this project stage: Option A (Minimal Refactoring)**

**Reasons**:
1. **Current code works well** - No functional issues
2. **Time investment** - Major refactoring takes significant time  
3. **Risk vs reward** - Low risk of bugs vs moderate time investment
4. **Feature focus** - Better to implement medium-priority features

**Immediate Action**: Extract movement constants only
**Future Action**: Consider full refactoring when adding many more unit types

---

**Conclusion**: While the current organization could be improved, it's not critical for functionality. The code is well-documented, tested, and working. Focus on new features rather than extensive refactoring at this time.