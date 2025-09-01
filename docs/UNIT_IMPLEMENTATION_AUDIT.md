# Unit Implementation Audit Report

## Overview

This document provides a comprehensive audit of the current unit implementation in CivJS compared to the reference implementations from freeciv and freeciv-web. The audit identifies gaps, missing features, and areas requiring improvement to achieve full compatibility with civilization game mechanics.

## Executive Summary

### Current State
- **Basic unit system**: ✅ Implemented with core CRUD operations
- **Unit types**: ⚠️ Limited set (6 types vs. extensive freeciv catalog)
- **Sprite rendering**: ❌ Placeholder/simplified rendering without actual unit sprites
- **Movement system**: ✅ Implemented with terrain-based movement costs and fragments
- **Combat system**: ⚠️ Basic implementation lacking combat bonuses and modifiers
- **Unit creation at game start**: ❌ Missing initial settler/warrior placement
- **Terrain movement costs**: ✅ Implemented with proper fragment system
- **Production bonuses**: ❌ Not implemented
- **Client unit rendering**: ✅ UNIT_INFO packet handler added for proper unit reception
- **Code organization**: ✅ Constants extracted to dedicated files for better maintainability

## Detailed Analysis

### 1. Unit Types and Definitions

#### Current Implementation (`apps/server/src/game/constants/UnitConstants.ts`)
```typescript
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: { id: 'warrior', name: 'Warrior', cost: 40, movement: 6, combat: 20, unitClass: 'military', ... },
  settler: { id: 'settler', name: 'Settler', cost: 80, movement: 6, combat: 0, canFoundCity: true, unitClass: 'civilian', ... },
  scout: { id: 'scout', name: 'Scout', cost: 25, movement: 9, combat: 10, sight: 3, unitClass: 'military', ... },
  worker: { id: 'worker', name: 'Worker', cost: 50, movement: 6, combat: 0, canBuildImprovements: true, unitClass: 'civilian', ... },
  archer: { id: 'archer', name: 'Archer', cost: 50, movement: 6, combat: 15, range: 2, requiredTech: 'archery', unitClass: 'military', ... },
  spearman: { id: 'spearman', name: 'Spearman', cost: 45, movement: 6, combat: 25, requiredTech: 'bronzeWorking', unitClass: 'military', ... }
}
```

#### Reference Implementation (freeciv-web)
- **Extensive unit catalog**: freeciv-web includes 100+ unit types
- **Unit classes**: Land, Naval, Air, Missile units with specific properties
- **Tech requirements**: Units locked behind technology research
- **Unit flags**: Special abilities (can_found_city, can_improve_terrain, etc.)

#### Gaps Identified
1. **Missing unit types**: No naval units, air units, or advanced military units
2. **Basic unit classes**: ✅ Implemented (military, civilian, naval, air) but limited usage
3. **Simplified properties**: Missing attack/defense strength differentiation
4. **Basic special abilities**: ✅ Partially implemented (canFoundCity, canBuildImprovements, requiredTech)
5. **No obsolescence system**: Units don't become obsolete with technology

### 2. Sprite Rendering and Visual Representation

#### Current Implementation (`apps/client/src/components/Canvas2D/MapRenderer.ts:759-781`)
```typescript
private renderUnit(unit: Unit, viewport: MapViewport) {
  // Simplified rendering: colored circles with unit type letter
  this.ctx.fillStyle = this.getPlayerColor(unit.playerId);
  this.ctx.beginPath();
  this.ctx.arc(/* ... */);
  this.ctx.fill();
  
  this.ctx.fillText(unit.type.charAt(0).toUpperCase(), /* ... */);
}
```

#### Reference Implementation (freeciv-web)
```javascript
function fill_unit_sprite_array(punit, stacked, backdrop) {
  var result = [ 
    get_unit_nation_flag_sprite(punit),
    {"key": tileset_unit_graphic_tag(punit), "offset_x": unit_offset['x'], ...}
  ];
  // Includes nation flags, activity indicators, health bars, etc.
}
```

#### Gaps Identified
1. **No actual sprites**: Using placeholder circles instead of unit graphics
2. **Missing flag rendering**: No nation flags on units
3. **No activity indicators**: No visual indication of unit status (fortified, etc.)
4. **No health visualization**: No health bars or damage indicators
5. **No animation support**: Units don't animate during movement
6. **No stacking indicators**: Multiple units on same tile not properly shown

### 3. Unit Creation and Starting Positions

#### Current Implementation
- **Manual creation only**: Units created via `unitManager.createUnit()` calls
- **No automatic starting units**: Players don't receive initial settler + warrior
- **No starting position logic**: Units can be placed anywhere on the map

#### Reference Implementation (freeciv)
```c
// players typically start with one settler and one military unit
create_start_unit(pplayer, start_unit_type);
create_start_unit(pplayer, UTYF_CITYFOUNDATION);
```

#### Gaps Identified
1. **Missing starting unit logic**: No automatic creation of initial units
2. **No starting position validation**: Starting positions not validated for resources/terrain
3. **No unit distribution**: All players could start with same units regardless of nation

### 4. Movement and Terrain Interaction

#### Current Implementation 
**Movement Constants** (`apps/server/src/game/constants/MovementConstants.ts`):
```typescript
export const SINGLE_MOVE = 3; // 1 movement point = 3 movement fragments
export const TERRAIN_MOVEMENT_COSTS: Record<string, number> = {
  plains: SINGLE_MOVE,     // 1 movement point
  hills: SINGLE_MOVE * 2,  // 2 movement points
  mountains: SINGLE_MOVE * 3, // 3 movement points
  // ... full terrain catalog implemented
};
```

**Movement Calculation** (`apps/server/src/game/UnitManager.ts`):
```typescript
const movementCost = this.calculateTerrainMovementCost(unit, unit.x, unit.y, newX, newY);
// Uses getTerrainMovementCost() from MovementConstants
```

#### Reference Implementation (freeciv terrain.ruleset)
```
terrain_control = {
  movement_fragments = 3  ; Move Fragments: 1 movement = 3 fragments
}
```

#### Gaps Identified
1. **✅ Terrain-based movement costs**: Implemented with proper fragment system
2. **✅ Fractional movement**: Using movement fragments system correctly
3. **No road/railroad bonuses**: Infrastructure doesn't affect movement
4. **No river crossing penalties**: Rivers don't slow movement
5. **No ZOC (Zone of Control)**: Enemy units don't restrict movement

### 5. Combat System

#### Current Implementation (`apps/server/src/game/UnitManager.ts:284-340`)
```typescript
// Simplified combat calculation
const attackerStrength = this.calculateCombatStrength(attacker, attackerType);
const defenderStrength = this.calculateCombatStrength(defender, defenderType);
const damageToDefender = Math.floor((attackerStrength / (attackerStrength + defenderStrength)) * 30 + Math.random() * 20);
```

#### Reference Implementation (freeciv combat)
- **Attack vs Defense**: Separate attack and defense values
- **Terrain bonuses**: Defenders get bonuses on hills, forests, cities
- **Unit type bonuses**: Spearmen vs cavalry, archers vs infantry
- **Veteran levels**: Experience affects combat strength
- **Firepower**: Different damage amounts based on unit types

#### Gaps Identified
1. **Oversimplified formula**: Real combat uses complex firepower and HP systems
2. **No terrain combat bonuses**: Hills, forests don't provide defensive bonuses
3. **No unit type advantages**: No rock-paper-scissors combat bonuses
4. **No veteran system impact**: Experience doesn't meaningfully affect combat
5. **No ranged combat mechanics**: All combat treated as melee

### 6. Database Schema vs Game Logic Mismatch

#### Database Schema (`apps/server/src/database/schema/units.ts`)
```typescript
export const units = pgTable('units', {
  attackStrength: integer('attack_strength').notNull(),
  defenseStrength: integer('defense_strength').notNull(),
  rangedStrength: integer('ranged_strength').default(0).notNull(),
  // ... many fields not used in game logic
});
```

#### Game Logic Usage
The UnitManager uses a simplified `Unit` interface that doesn't match the rich database schema.

#### Gaps Identified
1. **Schema mismatch**: Database supports features not implemented in game logic
2. **Unused fields**: Many database fields (cargo, promotions, orders) are unused
3. **Type inconsistency**: Database uses different types than game logic

## Priority Recommendations

### High Priority (Critical for Basic Gameplay)

1. **Implement Starting Units System**
   - Add automatic settler + warrior creation at game start
   - Implement starting position validation
   - Reference: `freeciv/server/plrhand.c:player_init()`

2. **✅ Add Terrain Movement Costs** _(COMPLETED)_
   - ✅ Implemented movement fragments system (1 move = 3 fragments)
   - ✅ Added terrain-specific movement costs via MovementConstants.ts
   - ✅ Proper integration with UnitManager movement calculation

3. **Basic Unit Sprite Rendering**
   - Replace circles with actual unit sprites from tileset
   - Implement sprite loading and caching system
   - Reference: `reference/freeciv-web/.../tilespec.js:fill_unit_sprite_array()`

### Medium Priority (Enhanced Gameplay)

4. **Expand Unit Type Catalog**
   - Add naval units (Trireme, Galley, etc.)
   - Add mounted units (Horsemen, Knights, etc.)
   - Add siege units (Catapult, Cannon, etc.)
   - Reference: `reference/freeciv/data/classic/units.ruleset`

5. **Implement Combat Bonuses**
   - Add terrain defensive bonuses (+50% for hills, +25% for forest)
   - Add unit type vs unit type bonuses
   - Reference: `freeciv/common/combat.c`

6. **Add Activity System**
   - Implement unit orders (fortify, sentry, goto)
   - Add visual indicators for unit activities
   - Reference: `reference/freeciv-web/.../unit.js:ORDER_*`

### Low Priority (Polish and Advanced Features)

7. **Unit Animation System**
   - Implement smooth movement animations
   - Add combat animations
   - Reference: `reference/freeciv-web/.../unit.js:update_unit_anim_list()`

8. **Advanced Unit Features**
   - Implement unit transportation (ships carrying land units)
   - Add unit promotions and experience system
   - Add automated unit control (auto-explore, auto-work)

## Implementation Examples

### 1. Starting Units Creation
```typescript
// In GameManager.ts after player initialization
for (const player of players.values()) {
  const startingPos = mapData.startingPositions.find(pos => pos.playerId === player.id);
  if (startingPos) {
    // Create settler
    await unitManager.createUnit(player.id, 'settler', startingPos.x, startingPos.y);
    // Create warrior
    await unitManager.createUnit(player.id, 'warrior', startingPos.x, startingPos.y);
  }
}
```

### 2. Terrain Movement Costs
```typescript
// Add to UnitManager.ts
private getTerrainMovementCost(terrain: string): number {
  const costs = {
    plains: 1, grassland: 1, desert: 1, tundra: 1,
    hills: 2, forest: 2, jungle: 2, swamp: 2,
    mountains: 3
  };
  return costs[terrain] || 1;
}

private calculateMovementCost(fromX: number, fromY: number, toX: number, toY: number): number {
  // Get destination tile terrain
  const terrainCost = this.getTerrainMovementCost(destinationTerrain);
  return terrainCost; // In movement fragments
}
```

### 3. Basic Combat Bonuses
```typescript
// Add to UnitManager.ts
private getTerrainDefenseBonus(terrain: string): number {
  const bonuses = {
    hills: 1.5,      // +50% defense
    mountains: 2.0,  // +100% defense
    forest: 1.25,    // +25% defense
    jungle: 1.25     // +25% defense
  };
  return bonuses[terrain] || 1.0;
}
```

## File References

### Server Implementation
- **Unit Manager**: `/root/repo/apps/server/src/game/UnitManager.ts`
- **✅ Unit Constants**: `/root/repo/apps/server/src/game/constants/UnitConstants.ts` _(NEW)_
- **✅ Movement Constants**: `/root/repo/apps/server/src/game/constants/MovementConstants.ts` _(NEW)_
- **Database Schema**: `/root/repo/apps/server/src/database/schema/units.ts`
- **Terrain Utils**: `/root/repo/apps/server/src/game/map/TerrainUtils.ts`
- **Game Manager**: `/root/repo/apps/server/src/game/GameManager.ts`

### Client Implementation
- **Map Renderer**: `/root/repo/apps/client/src/components/Canvas2D/MapRenderer.ts`
- **✅ Game Client**: `/root/repo/apps/client/src/services/GameClient.ts` _(UNIT_INFO handler added)_
- **Type Definitions**: `/root/repo/apps/client/src/types/index.ts`

### Reference Implementations
- **freeciv-web Unit Logic**: `/root/repo/reference/freeciv-web/.../unit.js`
- **freeciv-web Unit Types**: `/root/repo/reference/freeciv-web/.../unittype.js`
- **freeciv-web Sprite System**: `/root/repo/reference/freeciv-web/.../tilespec.js`

## Recent Improvements (September 2025)

### ✅ Completed
1. **Code Organization Refactoring**
   - Extracted unit constants to `/root/repo/apps/server/src/game/constants/UnitConstants.ts`
   - Extracted movement constants to `/root/repo/apps/server/src/game/constants/MovementConstants.ts`
   - Updated all imports across the codebase
   - Reduced code duplication and improved maintainability

2. **Terrain Movement System**
   - Implemented proper movement fragments system (SINGLE_MOVE = 3)
   - Added comprehensive terrain movement costs for all terrain types
   - Integrated terrain-based movement calculation in UnitManager
   - Added getTerrainMovementCost() utility function

3. **Client Unit Reception**
   - Added UNIT_INFO packet handler to GameClient.ts
   - Ensures proper unit data reception from server
   - Enables correct unit rendering on client side

4. **Enhanced Unit Definitions**
   - Added unit classes (military, civilian, naval, air)
   - Added special abilities (canFoundCity, canBuildImprovements)
   - Added technology requirements (requiredTech)
   - Implemented proper movement values using fragments

## Next Steps

1. **Implement starting units system** (Critical for playability)
2. **✅ Add terrain movement costs** _(COMPLETED)_
3. **Replace placeholder unit rendering** (Important for visual clarity)
4. **Expand unit catalog** (Necessary for gameplay variety)
5. **Implement combat bonuses** (Required for balanced gameplay)

This audit provides a roadmap for bringing the unit system to feature parity with the reference implementations, ensuring authentic Civilization gameplay mechanics.