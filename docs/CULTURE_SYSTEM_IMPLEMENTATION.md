# CivJS Culture System Implementation

## Overview

This document describes the complete implementation of the culture system in CivJS, a faithful port of the Freeciv culture mechanics to our modern TypeScript architecture.

## Reference Sources

The implementation is directly ported from the following Freeciv source files:
- `/reference/freeciv/common/culture.c` - Core culture calculations
- `/reference/freeciv/common/culture.h` - Function signatures
- `/reference/freeciv/gen_headers/enums/effects_enums.def` - Effect type definitions (lines 123-126, 167)
- `/reference/freeciv/common/requirements.c` - Culture requirement handling (VUT_MINCULTURE)
- `/reference/freeciv-web/javascript/fc_types.js` - Constant definitions (VUT_MINCULTURE = 29)

## Core Culture Mechanics

### 1. Culture Formula (from freeciv culture.c:29-34)

**City Culture Calculation:**
```typescript
// city_culture() port
culture = city.history + performance * (100 + culture_pct) / 100
```

**City History Gain per Turn:**
```typescript  
// city_history_gain() port  
gain = history_effect * (100 + culture_pct) / 100 + city.history * interest_rate / 1000
```

**Player Total Culture:**
```typescript
// player_culture() port
total = player.history + national_performance * (100 + culture_pct) / 100 + sum(city_cultures)
```

**National History Gain per Turn:**
```typescript
// nation_history_gain() port
gain = national_history * (100 + culture_pct) / 100 + player.history * interest_rate / 1000
```

### 2. Effect Types (from effects_enums.def)

- **EFT_PERFORMANCE (123)** - Immediate city culture boost
- **EFT_HISTORY (124)** - City culture generation per turn
- **EFT_NATION_PERFORMANCE (125)** - National culture boost
- **EFT_NATION_HISTORY (126)** - National culture generation per turn
- **EFT_CULTURE_PCT (167)** - Percentage modifier for all culture effects

## Implementation Architecture

### 1. Database Schema Updates

**Cities Table (`cities.ts`):**
```sql
-- Removed: culturePerTurn (dynamically calculated)
-- Added:
history INTEGER DEFAULT 0 NOT NULL  -- Accumulated culture history
```

**Players Table (`players.ts`):**
```sql
-- Removed: culture (dynamically calculated) 
-- Added:
history INTEGER DEFAULT 0 NOT NULL  -- National history accumulation
```

**Games Table (`games.ts`):**
```sql
-- Added:
historyInterestPml INTEGER DEFAULT 0 NOT NULL  -- Per mille interest rate for compound growth
```

### 2. TypeScript Interface Updates

**Client Types (`apps/client/src/types/index.ts`):**
```typescript
export interface City {
  // ... existing fields
  history: number; // Accumulated culture history
}

export interface Player {
  // ... existing fields  
  history: number; // National history accumulation
}
```

### 3. Core Managers

#### CultureManager (`apps/server/src/game/managers/CultureManager.ts`)

**Key Methods:**
- `calculateCityCulture(city, playerTechs)` - Direct port of freeciv city_culture()
- `calculateCityHistoryGain(city, game, playerTechs)` - Direct port of freeciv city_history_gain()  
- `calculatePlayerCulture(player, gameId)` - Direct port of freeciv player_culture()
- `calculateNationHistoryGain(player, game)` - Direct port of freeciv nation_history_gain()
- `processCultureGain(gameId)` - Process culture for all cities and players per turn

**Integration Points:**
- Uses EffectsManager for culture effect calculations
- Updates database with history gains each turn
- Provides culture information for UI and requirements

#### RequirementsManager (`apps/server/src/game/managers/RequirementsManager.ts`)

**Key Features:**
- Implements VUT_MINCULTURE requirement type (value 29 from freeciv)
- Supports REQ_RANGE_CITY, REQ_RANGE_PLAYER, REQ_RANGE_TRADEROUTE ranges
- Evaluates culture requirements for buildings and units
- Provides human-readable failure reasons

**Example Culture Requirements:**
```typescript
const cultureRequirements: CultureRequirement[] = [
  {
    type: VulnerabilityType.VUT_MINCULTURE,
    value: 100, // Minimum culture required
    range: RequirementRange.REQ_RANGE_CITY,
    present: true
  }
];
```

#### EffectsManager Updates

**Added Effect Types:**
```typescript
export enum EffectType {
  // Culture system effects
  PERFORMANCE = 'Performance',           // EFT_PERFORMANCE (123)
  HISTORY = 'History',                   // EFT_HISTORY (124) 
  NATION_PERFORMANCE = 'National_Performance', // EFT_NATION_PERFORMANCE (125)
  NATION_HISTORY = 'National_History',   // EFT_NATION_HISTORY (126)
  CULTURE_PCT = 'Culture_Pct',          // EFT_CULTURE_PCT (167)
  
  // Border effects related to culture
  BORDER_VISION = 'Border_Vision',       // EFT_BORDER_VISION (136)
  BORDER_STRENGTH_PCT = 'Border_Strength_Pct', // EFT_BORDER_STRENGTH_PCT (154)
}
```

### 4. Turn Processing Integration

#### TurnPhaseService Updates

**New Phase Added:**
```typescript
PHASE_CULTURE_PROCESSING = 'culture_processing' // Phase 5, after city production
```

**Processing Order:**
1. PHASE_BEGIN_TURN
2. PHASE_PLAYER_ACTIONS  
3. PHASE_UNIT_ACTIVITIES
4. PHASE_CITY_PRODUCTION
5. **PHASE_CULTURE_PROCESSING** ← New phase
6. PHASE_RESEARCH
7. PHASE_AI_ACTIONS
8. PHASE_RANDOM_EVENTS
9. PHASE_BORDER_CALCULATION
10. PHASE_END_TURN
11. PHASE_SAVE_ADVANCE

**Implementation:**
```typescript
private async executeCultureProcessingPhase(
  context: PhaseContext, 
  result: PhaseResult
): Promise<void> {
  if (!this.cultureManager) {
    logger.warn('CultureManager not configured, skipping culture processing phase');
    return;
  }

  await this.cultureManager.processCultureGain(context.gameId);
}
```

#### TurnManager Updates

**Constructor Changes:**
```typescript
constructor(
  // ... existing parameters
  cultureManager: CultureManager,  // New dependency
  // ... rest
) {
  // ... existing initialization
  this.cultureManager = cultureManager;
  
  this.turnPhaseService = new TurnPhaseService(
    gameId,
    this.turnProcessingService,
    this.turnCoordinationService, 
    this.turnPacketService,
    this.gameEventService,
    undefined, // randomEventsManager
    this.cultureManager  // Pass culture manager
  );
}
```

## Usage Examples

### 1. Building with Culture Requirements

```typescript
const requirementsManager = new RequirementsManager(cultureManager);

// Check if cathedral can be built (requires 100 city culture)
const context: EffectContext = {
  cityId: "city-123",
  playerId: "player-456",
  cityBuildings: new Set(["temple", "library"]),
  playerTechs: new Set(["mysticism", "ceremonial_burial"])
};

const requirements: CultureRequirement[] = [
  {
    type: VulnerabilityType.VUT_MINCULTURE,
    value: 100,
    range: RequirementRange.REQ_RANGE_CITY,
    present: true
  }
];

const canBuild = await requirementsManager.evaluateRequirements(requirements, context);
if (!canBuild.satisfied) {
  console.log(`Cannot build: ${canBuild.reason}`); // "requires minimum 100 culture"
}
```

### 2. Getting Culture Information

```typescript
// Get city culture info
const cityCulture = await cultureManager.getCityCultureInfo("city-123");
console.log(`City culture: ${cityCulture.culture}, history: ${cityCulture.history}`);

// Get player culture info  
const playerCulture = await cultureManager.getPlayerCultureInfo("player-456", "game-789");
console.log(`Total culture: ${playerCulture.totalCulture}`);
console.log(`National: ${playerCulture.nationalHistory}, Cities: ${playerCulture.cityCulture}`);
```

### 3. Turn Processing

Culture processing happens automatically during each turn:

```typescript
// During turn processing, culture is automatically calculated:
// 1. City production phase processes cities
// 2. Culture processing phase runs cultureManager.processCultureGain()
// 3. All cities gain history based on EFT_HISTORY effects
// 4. All players gain national history based on EFT_NATION_HISTORY effects  
// 5. Compound interest applied to existing history
```

## Building Effects Integration

### Example Building Effects (for rulesets)

```json
{
  "library": {
    "effects": [
      {
        "type": "History",
        "value": 2,
        "reqs": [{"type": "Building", "name": "library", "present": true}]
      }
    ]
  },
  "university": {  
    "effects": [
      {
        "type": "History", 
        "value": 3,
        "reqs": [{"type": "Building", "name": "university", "present": true}]
      }
    ]
  },
  "temple": {
    "effects": [
      {
        "type": "Performance",
        "value": 1, 
        "reqs": [{"type": "Building", "name": "temple", "present": true}]
      }
    ]
  }
}
```

## Testing Strategy

### Unit Tests Required

1. **CultureManager Tests:**
   - Test culture calculation formulas match freeciv exactly
   - Test compound interest mechanics
   - Test integration with effects system
   - Test database updates during processCultureGain()

2. **RequirementsManager Tests:**
   - Test VUT_MINCULTURE requirement evaluation
   - Test different requirement ranges (CITY, PLAYER, TRADEROUTE)
   - Test requirement failure reasons

3. **Turn Processing Tests:**
   - Test culture phase execution in correct order
   - Test culture gains applied per turn
   - Test error handling in culture processing

4. **Integration Tests:**
   - Test full turn processing with culture
   - Test building construction with culture requirements  
   - Test culture effects from buildings

### Manual Testing Scenarios

1. **Basic Culture Growth:**
   - Start new game, observe culture accumulation over turns
   - Build culture-generating buildings, verify increased growth
   - Check compound interest effects over time

2. **Culture Requirements:**
   - Try building advanced buildings without enough culture
   - Build up culture and retry successfully
   - Test different requirement ranges

3. **Performance:**
   - Test culture processing with large numbers of cities
   - Verify turn processing times remain acceptable

## Migration and Deployment

### Database Migration

The database schema changes require migration:

```sql
-- Add history columns
ALTER TABLE cities ADD COLUMN history INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE players ADD COLUMN history INTEGER DEFAULT 0 NOT NULL; 
ALTER TABLE games ADD COLUMN history_interest_pml INTEGER DEFAULT 0 NOT NULL;

-- Remove old culture columns (if they exist)
ALTER TABLE cities DROP COLUMN IF EXISTS culture_per_turn;
ALTER TABLE players DROP COLUMN IF EXISTS culture;
```

### Backward Compatibility

- Existing games will have history = 0 initially
- Culture will start accumulating from the next turn
- No breaking changes to existing API endpoints
- UI components need updates to display culture information

## Future Enhancements

### Phase 1 (Implemented)
- ✅ Core culture calculations
- ✅ History accumulation per turn
- ✅ Culture requirements for buildings
- ✅ Effects system integration

### Phase 2 (Future)
- 🔄 Border influence from culture
- 🔄 Culture victory conditions  
- 🔄 UI components for culture display
- 🔄 Cultural conversion mechanics

### Phase 3 (Advanced)
- 🔄 Great Works and culture bonuses
- 🔄 Cultural policies and multipliers
- 🔄 Tourism and cultural influence
- 🔄 Cultural borders and tile flipping

## Conclusion

The culture system implementation provides a solid foundation that faithfully ports the Freeciv culture mechanics while integrating cleanly with CivJS's modern TypeScript architecture. The system is designed to be extensible for future cultural features while maintaining compatibility with the existing game systems.

All core culture calculations match the original Freeciv formulas exactly, ensuring gameplay consistency with the reference implementation. The modular architecture allows for easy testing, debugging, and future enhancements.