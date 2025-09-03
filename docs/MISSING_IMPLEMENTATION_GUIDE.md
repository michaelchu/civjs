# Missing Implementation Guide for Integration Tests

This document outlines the missing methods, properties, and functionality identified from integration test failures. These need to be implemented to achieve full integration test coverage and proper system functionality.

## Overview

The integration tests were written based on expected behavior from the freeciv reference implementation. Many methods and properties are tested but not yet implemented in the CivJS codebase. This guide provides a structured roadmap for implementing the missing functionality.

## Critical Missing Functionality

### 1. GovernmentManager (`src/game/GovernmentManager.ts`)

**Status**: Most core functionality is missing

#### Missing Methods:
- `applyGovernmentEffects(playerId: string, governmentType: string): Promise<void>`
  - Should apply government effects to player stats (happiness, corruption, military support)
  - Needs integration with EffectsManager
  
- `calculateGovernmentMaintenance(playerId: string): Promise<number>`
  - Calculate gold cost for maintaining current government
  - Should consider number of cities and units

- `getUnitGovernmentEffects(playerId: string, unitId: string): GovernmentEffect[]`
  - Return government-specific effects on individual units
  - Effects include support costs, morale bonuses, etc.

- `getCityHappinessEffects(playerId: string, cityId: string): HappinessEffect[]`
  - Calculate government impact on city happiness
  - Consider government type, city size, military units

- `canChangeGovernment(playerId: string, newGovernmentType: string): boolean`
  - Check if player meets requirements for government change
  - Consider technology requirements, anarchy periods

- `initiateGovernmentChange(playerId: string, newGovernmentType: string): Promise<void>`
  - Handle government transitions including anarchy periods
  - Update player state and notify other systems

#### Expected Integration:
- Should work with `EffectsManager` for applying government bonuses/penalties
- Needs database persistence for government changes
- Should trigger updates to CityManager and UnitManager when effects change

### 2. PolicyManager (`src/game/PolicyManager.ts`)

**Status**: Major API mismatches between tests and implementation

#### API Fixes Required:
Current test expectations vs actual implementation:

```typescript
// Tests expect:
getAvailablePolicies(playerId: string): Policy[]
getPlayerPolicies(playerId: string): Policy[] 
adoptPolicy(playerId: string, policyId: string): Promise<boolean>

// But actual implementation has:
getAvailablePolicies(playerId: string): Map<string, any>
getPlayerPolicies(playerId: string): Map<string, any>
// adoptPolicy method missing entirely
```

#### Missing Methods:
- `adoptPolicy(playerId: string, policyId: string): Promise<boolean>`
  - Allow player to adopt a policy if requirements are met
  - Update database and trigger effects

- `canAdoptPolicy(playerId: string, policyId: string): boolean`
  - Check prerequisites (culture points, existing policies, government type)

- `getPolicyEffects(playerId: string, policyId: string): PolicyEffect[]`
  - Return specific effects of a policy on player

#### Implementation Notes:
- Tests expect arrays of Policy objects, not Maps
- Need to implement Policy interface with `id`, `name`, `description`, `effects` properties
- Should integrate with government system (some policies require specific governments)

### 3. UnitSupportManager (`src/game/UnitSupportManager.ts`)

**Status**: Constructor and most methods are missing

#### Constructor Issues:
```typescript
// Tests expect:
new UnitSupportManager(effectsManager: EffectsManager)

// But actual constructor expects:
// Different signature entirely
```

#### Missing Methods:
- `calculatePlayerUnitSupport(playerId: string): Promise<UnitSupportCalculation>`
  - Calculate total unit support costs for a player
  - Consider government effects, city support, unit types

- `calculateUnitUpkeep(unitId: string): UnitUpkeepCost`
  - Calculate specific upkeep cost for individual unit
  - Return gold, food, and shield costs

- `getUnitSupportInfo(playerId: string): UnitSupportInfo`
  - Return detailed breakdown of unit support across all cities
  - Include supported units per city, costs, etc.

#### Expected Data Structures:
```typescript
interface UnitSupportCalculation {
  totalGoldCost: number;
  totalFoodCost: number;
  totalShieldCost: number;
  unitsByCity: Map<string, UnitSupportInfo>;
}

interface UnitUpkeepCost {
  gold: number;
  food: number;
  shields: number;
}
```

### 4. MapManager (`src/game/MapManager.ts`)

**Status**: Several utility methods missing

#### Missing Methods:
- `getNeighbors(x: number, y: number): Tile[]`
  - Return array of adjacent tiles to given coordinates
  - Handle map edge cases properly

- `isValidPosition(x: number, y: number): boolean`
  - Check if coordinates are within map boundaries

- `updateTileProperty(x: number, y: number, property: string, value: any): void`
  - Update specific property of a tile (terrain, resource, etc.)
  - Trigger necessary updates to visibility, pathfinding, etc.

#### Data Structure Issues:
Tests expect `getMapData().tiles` to return a flat array, but current implementation returns 2D array. Need to either:
1. Add a `getFlatTiles()` method, or  
2. Modify `getMapData()` to include both flat and 2D representations

### 5. ActionSystem (`src/game/ActionSystem.ts`)

**Status**: Unit data structure mismatches

#### Missing Unit Properties:
Units in tests are expected to have:
```typescript
interface Unit {
  // ... existing properties
  fortified?: boolean;          // MISSING
  orders?: UnitOrder[];         // MISSING  
  // ... other properties
}

interface UnitOrder {
  type: 'goto' | 'build' | 'fortify' | 'sleep';
  targetX?: number;
  targetY?: number;
  // ... other order properties
}
```

#### Integration Issues:
- ActionSystem tests expect `gameManager.moveUnit()` to return success boolean
- Need proper integration with UnitManager for order processing
- Database persistence for unit states and orders

### 6. NetworkHandlers (`src/network/socket-handlers.ts`)

**Status**: Socket.IO setup incomplete for some packet types

#### Missing Packet Handlers:
- `policy_adopt_request` - Handle policy adoption requests
- `government_change_request` - Handle government change requests  
- `unit_support_info_request` - Return unit support information

#### Integration Requirements:
- Handlers need proper error handling and validation
- Should integrate with authentication/authorization
- Need to emit updates to other players when relevant

## Database Schema Requirements

Several database tables may need additional columns:

### Players Table:
```sql
-- Add government-related columns
ALTER TABLE players ADD COLUMN current_government VARCHAR(50) DEFAULT 'despotism';
ALTER TABLE players ADD COLUMN government_changed_turn INTEGER;
ALTER TABLE players ADD COLUMN in_anarchy BOOLEAN DEFAULT FALSE;
```

### Units Table:
```sql  
-- Add missing unit state columns
ALTER TABLE units ADD COLUMN fortified BOOLEAN DEFAULT FALSE;
ALTER TABLE units ADD COLUMN orders_data JSON; -- Store unit orders
```

### New Tables Needed:
```sql
-- Player Policies
CREATE TABLE player_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  policy_id VARCHAR(50) NOT NULL,
  adopted_turn INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Government Changes (history)
CREATE TABLE government_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID REFERENCES players(id) ON DELETE CASCADE,
  from_government VARCHAR(50),
  to_government VARCHAR(50) NOT NULL,
  change_turn INTEGER NOT NULL,
  anarchy_turns INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Implementation Priority

### High Priority (Core Functionality):
1. **GovernmentManager** - Essential for game balance and player progression
2. **UnitSupportManager** - Critical for economic gameplay  
3. **PolicyManager API fixes** - Many tests depend on policy system

### Medium Priority (Gameplay Features):
4. **MapManager utility methods** - Needed for AI and advanced gameplay
5. **ActionSystem unit properties** - Enhances unit management

### Low Priority (Network Features):
6. **NetworkHandlers** - Multiplayer functionality, can be mocked for now

## Testing Strategy

After implementing missing functionality:

1. **Unit Tests First**: Create unit tests for each new method
2. **Integration Tests**: Run existing integration tests to verify fixes
3. **Database Tests**: Ensure all database operations work correctly
4. **End-to-End**: Test full game scenarios with new functionality

## Reference Implementation

For understanding expected behavior, consult:
- `/reference/freeciv/` - Original Freeciv C codebase for game mechanics
- `/reference/freeciv-web/` - Web client implementation for UI patterns
- Game ruleset files in `/src/shared/data/rulesets/classic/` for data structures

## Notes for Implementation

1. **Follow Existing Patterns**: Use existing code style and architecture patterns
2. **Database First**: Ensure database schema changes are made before implementing business logic
3. **Error Handling**: Add proper error handling and validation for all new methods
4. **TypeScript Types**: Create proper TypeScript interfaces for all new data structures
5. **Documentation**: Add JSDoc comments for all new public methods

This guide provides a comprehensive roadmap for implementing the missing functionality required by the integration tests. Each section can be tackled independently, allowing for incremental progress toward full test coverage.