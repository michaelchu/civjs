# Culture-Based Border Expansion Analysis

## Investigation Summary

This document analyzes the current state of our border system versus the Freeciv reference implementation for culture-based border expansion, and provides a roadmap for implementing missing features.

## Current State vs Reference Implementation

### ✅ What We Have

**Basic Border System** (`apps/server/src/game/managers/BorderManager.ts`)
- Border expansion based on city size: `(city_size + 2) * border_strength_pct`
- Border radius based on city size: `border_city_radius_sq + city_size * border_size_effect`
- Tile ownership determined by border strength competition
- Real-time border updates and network synchronization

**Basic Building System**
- Building definitions in `apps/server/src/shared/data/rulesets/classic/buildings.json`
- Building construction via `CityBuildingService`
- Effects framework via `EffectsManager`
- Database schema with `culturePerTurn` field

**Existing Buildings with Potential Culture Effects:**
- Temple (currently: happiness +2)
- Library (currently: science +50%)
- Palace (currently: defense +100%, happiness +1)

### ❌ What We're Missing

**Culture System Implementation**
- No culture accumulation/history tracking
- No culture effects in EffectsManager (`EFT_HISTORY`, `EFT_PERFORMANCE`, `EFT_CULTURE_PCT`)
- No cultural bonuses from buildings
- No culture calculation in cities

**Culture-Border Integration**
- Borders expand only by population size, not cultural influence
- No `EFT_BORDER_STRENGTH_PCT` cultural bonuses
- No culture-based border strength calculations

## Reference Implementation Analysis

### Freeciv Culture System (`reference/freeciv/common/culture.c:29-71`)

**Culture Calculation:**
```c
int city_culture(const struct city *pcity) {
  return pcity->history 
    + get_city_bonus(pcity, EFT_PERFORMANCE) 
    * (100 + get_city_bonus(pcity, EFT_CULTURE_PCT)) / 100;
}
```

**Culture Growth:**
```c
int city_history_gain(const struct city *pcity) {
  return get_city_bonus(pcity, EFT_HISTORY)
    * (100 + get_city_bonus(pcity, EFT_CULTURE_PCT)) / 100
    + pcity->history * game.info.history_interest_pml / 1000;
}
```

### Border System (`reference/freeciv/common/borders.c:69-96`)

**Border Strength with Culture:**
```c
int tile_border_source_strength(struct tile *ptile) {
  if (pcity) {
    strength = (city_size_get(pcity) + 2)
      * (100 + get_city_bonus(pcity, EFT_BORDER_STRENGTH_PCT)) / 100;
  }
  return strength;
}
```

**Key Effects:**
- `EFT_PERFORMANCE`: Culture per turn production
- `EFT_HISTORY`: Accumulated culture points per turn
- `EFT_CULTURE_PCT`: Percentage bonus to culture production
- `EFT_BORDER_STRENGTH_PCT`: Cultural bonus to border strength

## Implementation Task List

### Phase 1: Culture Effects Framework

#### Task 1.1: Add Culture Effect Types
- **File:** `apps/server/src/game/managers/EffectsManager.ts`
- **Action:** Add missing culture effect types
```typescript
export enum EffectType {
  // ... existing effects
  
  // Culture and border effects
  HISTORY = 'History',
  PERFORMANCE = 'Performance', 
  CULTURE_PCT = 'Culture_Pct',
  BORDER_STRENGTH_PCT = 'Border_Strength_Pct',
}
```

#### Task 1.2: Update Building Effects
- **File:** `apps/server/src/shared/data/rulesets/classic/buildings.json`
- **Action:** Add culture effects to cultural buildings
```json
{
  "temple": {
    "effects": {
      "happinessBonus": 2,
      "cultureBonus": 1,
      "historyBonus": 1
    }
  },
  "library": {
    "effects": {
      "scienceBonus": 50,
      "cultureBonus": 2,
      "culturePctBonus": 25
    }
  }
}
```

#### Task 1.3: Add Culture Building Types
- **File:** `apps/server/src/shared/data/rulesets/classic/buildings.json`
- **Action:** Add new cultural buildings
```json
{
  "monument": {
    "id": "monument",
    "name": "Monument", 
    "cost": 30,
    "upkeep": 1,
    "effects": {
      "cultureBonus": 1,
      "borderStrengthPctBonus": 25
    }
  },
  "cathedral": {
    "id": "cathedral", 
    "name": "Cathedral",
    "cost": 160,
    "upkeep": 3,
    "effects": {
      "happinessBonus": 3,
      "cultureBonus": 4,
      "culturePctBonus": 50
    }
  }
}
```

### Phase 2: Culture Calculation System

#### Task 2.1: Add Culture Accumulation to Cities
- **File:** `apps/server/src/database/schema/cities.ts`
- **Action:** Add culture history tracking
```typescript
export const cities = pgTable('cities', {
  // ... existing fields
  
  // Culture tracking
  cultureHistory: integer('culture_history').default(0).notNull(),
  culturePerTurn: integer('culture_per_turn').default(0).notNull(),
});
```

#### Task 2.2: Implement Culture Manager
- **File:** `apps/server/src/game/managers/CultureManager.ts` (NEW)
- **Action:** Create dedicated culture calculation system
```typescript
export class CultureManager {
  calculateCityCurrentCulture(city: CityState): number;
  calculateCityHistoryGain(city: CityState): number;
  applyCultureGrowth(cityId: string): void;
  getCultureEffects(city: CityState): CultureEffects;
}
```

#### Task 2.3: Integrate Culture with City Manager
- **File:** `apps/server/src/game/managers/CityManager.ts`
- **Action:** Add culture calculations to city updates
```typescript
// Add to city turn processing
const cultureGain = this.cultureManager.calculateCityHistoryGain(city);
city.cultureHistory += cultureGain;
city.culturePerTurn = this.cultureManager.calculateCityCurrentCulture(city);
```

### Phase 3: Culture-Border Integration

#### Task 3.1: Update Border Strength Calculation
- **File:** `apps/server/src/game/managers/BorderManager.ts`
- **Action:** Integrate culture effects into border strength
```typescript
getBorderSourceStrength(source: BorderSource): number {
  if (source.type === 'city') {
    const citySize = this.getCitySize(source.x, source.y);
    const cultureBonus = this.getCultureBorderBonus(source.x, source.y);
    
    // Base: (city_size + 2) * (100 + culture_border_strength_pct) / 100
    strength = ((citySize + 2) * (100 + cultureBonus)) / 100;
  }
  return strength;
}
```

#### Task 3.2: Add Culture Border Bonus Calculation
- **File:** `apps/server/src/game/managers/BorderManager.ts`
- **Action:** Add method to get cultural border bonuses
```typescript
private getCultureBorderBonus(x: number, y: number): number {
  const city = this.cityManager.getCityAt(x, y);
  if (!city) return 0;
  
  return this.effectsManager.calculateEffect(
    EffectType.BORDER_STRENGTH_PCT,
    { cityId: city.id }
  ).value;
}
```

### Phase 4: Game Configuration

#### Task 4.1: Add Culture Game Settings
- **File:** `apps/server/src/game/constants/BorderConstants.ts`
- **Action:** Add culture-related constants
```typescript
// Culture settings from freeciv
export const CULTURE_HISTORY_INTEREST_PML = 0; // Per-mille interest rate
export const DEFAULT_CULTURE_HISTORY_GAIN = 1;
export const DEFAULT_CULTURE_PERFORMANCE = 0;
```

#### Task 4.2: Add Culture to Game State
- **File:** `apps/server/src/types/packet.ts`
- **Action:** Add culture fields to city packets
```typescript
interface CityInfo {
  // ... existing fields
  cultureHistory: number;
  culturePerTurn: number;
  cultureBorderBonus: number;
}
```

### Phase 5: Client-Side Integration

#### Task 5.1: Update City UI with Culture
- **File:** `apps/client/src/components/GameUI/CityInfoOverlay.tsx`
- **Action:** Display culture information
```typescript
<div className="culture-info">
  <span>Culture: {city.cultureHistory}</span>
  <span>Culture/Turn: +{city.culturePerTurn}</span>
</div>
```

#### Task 5.2: Update Border Rendering
- **File:** `apps/client/src/components/Canvas2D/renderers/BorderRenderer.ts`
- **Action:** Visual indicators for culture-influenced borders
```typescript
// Add visual differentiation for culturally-strong borders
private getPlayerColors(playerId: string): BorderColors {
  const cultureStrength = this.getCultureStrength(playerId);
  // Adjust border opacity/thickness based on culture
}
```

## Testing Strategy

### Unit Tests Required
1. **CultureManager Tests**
   - Culture calculation accuracy
   - History accumulation over turns
   - Building effects integration

2. **BorderManager Culture Tests**
   - Culture bonus calculations
   - Border strength with culture effects
   - Border expansion from cultural buildings

3. **Integration Tests**
   - End-to-end culture accumulation
   - Border changes from cultural buildings
   - Multi-city culture competition

### Reference Validation
- Compare calculations with Freeciv reference implementation
- Validate border expansion rates match expected patterns
- Test edge cases (no culture buildings, maximum culture, etc.)

## Implementation Priority

1. **HIGH:** Phase 1 & 2 (Culture Effects & Calculation) - Core functionality
2. **MEDIUM:** Phase 3 (Border Integration) - Main feature
3. **LOW:** Phase 4 & 5 (UI & Polish) - User experience

## Estimated Effort

- **Phase 1-2:** 2-3 days (core culture system)
- **Phase 3:** 1-2 days (border integration) 
- **Phase 4-5:** 1-2 days (configuration & UI)
- **Testing:** 1 day
- **Total:** ~1 week of development

## Notes

- Implementation should maintain backward compatibility with existing border system
- Culture system can be implemented incrementally (start with basic accumulation, add complexity)
- Consider adding culture victory condition in future phases
- Monitor performance impact of additional calculations per turn