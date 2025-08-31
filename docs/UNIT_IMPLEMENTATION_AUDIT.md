# Unit Implementation Audit Report

## Overview

This document provides a comprehensive audit of the current unit implementation in CivJS compared to the reference implementations from freeciv and freeciv-web. The audit identifies gaps, missing features, and areas requiring improvement to achieve full compatibility with civilization game mechanics.

## Executive Summary

### Current State
- **Basic unit system**: ✅ Implemented with core CRUD operations
- **Unit types**: ⚠️ Limited set (6 types vs. extensive freeciv catalog)
- **Sprite rendering**: ❌ Placeholder/simplified rendering without actual unit sprites
- **Movement system**: ⚠️ Simplified without terrain-based costs
- **Combat system**: ⚠️ Basic implementation lacking combat bonuses and modifiers
- **Unit creation at game start**: ❌ Missing initial settler/warrior placement
- **Terrain movement costs**: ❌ Not implemented
- **Production bonuses**: ❌ Not implemented

## Detailed Analysis

### 1. Unit Types and Definitions

#### Current Implementation (`apps/server/src/game/UnitManager.ts:52-127`)
```typescript
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: { id: 'warrior', cost: 40, movement: 2, combat: 20, ... },
  settler: { id: 'settler', cost: 80, movement: 2, combat: 0, ... },
  scout: { id: 'scout', cost: 25, movement: 3, combat: 10, ... },
  worker: { id: 'worker', cost: 50, movement: 2, combat: 0, ... },
  archer: { id: 'archer', cost: 50, movement: 2, combat: 15, ... },
  spearman: { id: 'spearman', cost: 45, movement: 2, combat: 25, ... }
}
```

#### Reference Implementation (freeciv-web)
- **Extensive unit catalog**: freeciv-web includes 100+ unit types
- **Unit classes**: Land, Naval, Air, Missile units with specific properties
- **Tech requirements**: Units locked behind technology research
- **Unit flags**: Special abilities (can_found_city, can_improve_terrain, etc.)

#### Gaps Identified
1. **Missing unit types**: No naval units, air units, or advanced military units
2. **No unit classes**: Missing categorization system
3. **Simplified properties**: Missing attack/defense strength differentiation
4. **No special abilities**: Units lack flags for special actions
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

#### Current Implementation (`apps/server/src/game/UnitManager.ts:218-219`)
```typescript
const movementCost = Math.ceil(distance); // Simplified - would consider terrain
```

#### Reference Implementation (freeciv terrain.ruleset)
```
terrain_control = {
  movement_fragments = 3  ; Move Fragments: 1 movement = 3 fragments
}
```

Different terrains have different movement costs:
- Plains: 1 movement point
- Hills/Forest: 2 movement points  
- Mountains: 3 movement points
- Rivers: reduce movement cost
- Roads: reduce movement cost

#### Gaps Identified
1. **No terrain-based movement costs**: All terrain treated equally
2. **No fractional movement**: Using simplified integer movement
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

2. **Add Terrain Movement Costs**
   - Implement movement fragments system (1 move = 3 fragments)
   - Add terrain-specific movement costs
   - Reference: `apps/server/src/game/map/TerrainUtils.ts:223-251`

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
- **Database Schema**: `/root/repo/apps/server/src/database/schema/units.ts`
- **Terrain Utils**: `/root/repo/apps/server/src/game/map/TerrainUtils.ts`
- **Game Manager**: `/root/repo/apps/server/src/game/GameManager.ts`

### Client Implementation
- **Map Renderer**: `/root/repo/apps/client/src/components/Canvas2D/MapRenderer.ts`
- **Type Definitions**: `/root/repo/apps/client/src/types/index.ts`

### Reference Implementations
- **freeciv-web Unit Logic**: `/root/repo/reference/freeciv-web/.../unit.js`
- **freeciv-web Unit Types**: `/root/repo/reference/freeciv-web/.../unittype.js`
- **freeciv-web Sprite System**: `/root/repo/reference/freeciv-web/.../tilespec.js`

## Next Steps

1. **Implement starting units system** (Critical for playability)
2. **Add terrain movement costs** (Essential for strategic depth)
3. **Replace placeholder unit rendering** (Important for visual clarity)
4. **Expand unit catalog** (Necessary for gameplay variety)
5. **Implement combat bonuses** (Required for balanced gameplay)

This audit provides a roadmap for bringing the unit system to feature parity with the reference implementations, ensuring authentic Civilization gameplay mechanics.