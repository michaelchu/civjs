# Tech-Based City Style Evolution Implementation Plan

## Overview

This document outlines the implementation plan for tech-based city style evolution, where cities automatically upgrade their visual appearance as players research advanced technologies. This feature will complete the authentic Freeciv city style system by implementing the tech requirements already defined in our city rulesets.

## Current State

### ✅ What We Have
- **Ruleset Infrastructure**: City styles with `techreq` and `replaced_by` fields
- **Server Research System**: `ResearchManager` with tech tree logic and player research tracking
- **Client Type Definitions**: Interfaces for `Player`, `Technology`, and `ResearchState`
- **Base Architecture**: City rendering system that can be extended

### ❌ What's Missing
- **Complete Technology Tree**: Missing advanced era technologies (Industrial → Space Age)
- **Client-Server Research Sync**: Player tech states not available on client
- **Render Pipeline Integration**: City renderer lacks access to player research data

## Implementation Plan

### Phase 1: Complete the Technology Tree (Server-Side)

**Goal**: Extend `ResearchManager.ts` with complete Freeciv technology tree

**Tasks**:
1. **Add Missing Technologies** to `TECHNOLOGIES` constant:
   ```typescript
   // Industrial Era (1400-1800 AD)
   railroad: { cost: 600, requirements: ['steam_engine', 'metallurgy'] }
   electricity: { cost: 800, requirements: ['metallurgy', 'magnetism'] }
   steel: { cost: 900, requirements: ['electricity', 'industrialization'] }
   
   // Modern Era (1800-1900 AD)  
   automobile: { cost: 1200, requirements: ['combustion', 'steel'] }
   flight: { cost: 1400, requirements: ['combustion', 'physics'] }
   radio: { cost: 1600, requirements: ['electricity', 'physics'] }
   
   // Contemporary Era (1900-1950 AD)
   rocketry: { cost: 1800, requirements: ['flight', 'advanced_flight'] }
   computers: { cost: 2000, requirements: ['radio', 'miniaturization'] }
   nuclear_fission: { cost: 2200, requirements: ['atomic_theory', 'physics'] }
   
   // Future Era (1950+ AD)
   laser: { cost: 2400, requirements: ['computers', 'nuclear_fission'] }
   superconductors: { cost: 2800, requirements: ['laser', 'plastics'] }
   fusion_power: { cost: 3200, requirements: ['superconductors', 'nuclear_fusion'] }
   ```

2. **Add Prerequisite Technologies**: Fill in the dependency chain
   - Steam Engine, Metallurgy, Magnetism, Physics, etc.
   - Reference: `freeciv/data/classic/techs.ruleset`

3. **Update Tech Costs**: Balance research costs for proper game progression
   - Follow Freeciv's exponential cost scaling
   - Test with typical game length (200-300 turns)

4. **Add Tech Flags**: Special technology behaviors
   - `bonus_tech` for Philosophy-like techs
   - `bridge` for transportation improvements
   - City style unlocking flags

**Estimated Effort**: 2-3 days
**Files Modified**: 
- `apps/server/src/game/managers/ResearchManager.ts`
- `apps/server/tests/game/ResearchManager.test.ts`

### Phase 2: Client-Server Research Synchronization

**Goal**: Make player research states available on the client for rendering decisions

**Tasks**:
1. **Extend Player Packets**: Add research data to player state sync
   ```typescript
   // In network packet definitions
   interface PlayerStatePacket {
     // ... existing fields ...
     researchedTechs: string[];
     currentTech?: string;
     researchProgress: number;
   }
   ```

2. **Update GameClient**: Handle research state updates
   ```typescript
   // In GameClient.ts
   private handlePlayerResearchUpdate(data: PlayerStatePacket) {
     const player = this.gameStore.players[data.playerId];
     if (player) {
       player.researchedTechs = new Set(data.researchedTechs);
       player.currentTech = data.currentTech;
     }
   }
   ```

3. **Modify Game State Store**: Include research in client state
   ```typescript
   // In gameStore.ts
   interface PlayerState {
     // ... existing fields ...
     researchedTechs: Set<string>;
     currentTech?: string;
     researchProgress: number;
   }
   ```

4. **Update Server Broadcast Logic**: Send research updates when techs are discovered
   ```typescript
   // In ResearchManager.ts
   private async broadcastTechDiscovery(playerId: string, techId: string) {
     // Notify all clients of the tech discovery
     // Update city styles for affected cities
   }
   ```

**Estimated Effort**: 3-4 days
**Files Modified**:
- `apps/client/src/services/GameClient.ts`
- `apps/client/src/store/gameStore.ts`
- `apps/server/src/network/handlers/*.ts`
- `apps/server/src/game/managers/ResearchManager.ts`

### Phase 3: City Style Evolution Logic

**Goal**: Implement the actual city style upgrade logic in the renderer

**Tasks**:
1. **Update RenderState Interface**: Include player research data
   ```typescript
   // In BaseRenderer.ts
   export interface RenderState {
     // ... existing fields ...
     players: Record<string, {
       id: string;
       name: string;
       nation: string;
       researchedTechs: Set<string>;
     }>;
   }
   ```

2. **Implement Style Evolution Algorithm**:
   ```typescript
   // In CityRenderer.ts
   private getCityStyleWithTechEvolution(city: City): string {
     const player = this.renderState.players[city.playerId];
     if (!player) return this.getFallbackStyle(city);
     
     // Find the most advanced style the player can use
     const availableStyles = this.getStyleEvolutionChain(city)
       .filter(style => this.playerHasTechFor(player, style))
       .sort((a, b) => this.getStyleTechLevel(b) - this.getStyleTechLevel(a));
       
     return availableStyles[0]?.graphic || this.getFallbackStyle(city);
   }
   
   private getStyleEvolutionChain(city: City): CityStyle[] {
     // Follow the replaced_by chain to get evolution path
     // e.g., european -> industrial -> electricage -> modern -> postmodern
   }
   
   private playerHasTechFor(player: PlayerState, style: CityStyle): boolean {
     return !style.techreq || player.researchedTechs.has(style.techreq);
   }
   ```

3. **Add Style Priority System**: Handle multiple valid styles
   ```typescript
   private getStyleTechLevel(style: CityStyle): number {
     const techLevels = {
       'european': 0, 'classical': 0, 'tropical': 0, // Ancient
       'industrial': 100,    // Railroad
       'electricage': 200,   // Automobile  
       'modern': 300,        // Rocketry
       'postmodern': 400     // Laser
     };
     return techLevels[style.name.toLowerCase()] || 0;
   }
   ```

4. **Add Nation-Specific Base Styles**: Preserve cultural diversity
   ```typescript
   private getBaseStyleForNation(nation: string): string {
     const nationStyles = {
       'americans': 'european',
       'romans': 'classical', 
       'babylonians': 'babylonian',
       'chinese': 'asian',
       // ... etc
     };
     return nationStyles[nation.toLowerCase()] || 'european';
   }
   ```

**Estimated Effort**: 2-3 days
**Files Modified**:
- `apps/client/src/components/Canvas2D/renderers/CityRenderer.ts`
- `apps/client/src/components/Canvas2D/renderers/BaseRenderer.ts`

### Phase 4: Integration and Testing

**Goal**: Ensure the complete system works end-to-end with proper fallbacks

**Tasks**:
1. **Add Comprehensive Tests**:
   ```typescript
   // Unit tests for style evolution logic
   describe('CityStyleEvolution', () => {
     test('should upgrade from european to industrial with railroad', () => {
       // Test tech-based upgrades
     });
     
     test('should fall back gracefully if tech data missing', () => {
       // Test error handling
     });
   });
   ```

2. **Performance Optimization**:
   - Cache style evolution chains
   - Minimize tech lookups during rendering
   - Only recalculate when player research changes

3. **Add Debug Visualization**: Show current city style and available upgrades
   ```typescript
   private renderCityStyleDebugInfo(city: City, screenPos: Position) {
     if (DEBUG_MODE) {
       const currentStyle = this.getCurrentStyle(city);
       const nextUpgrade = this.getNextStyleUpgrade(city);
       // Render debug overlay
     }
   }
   ```

4. **Documentation**: Update code comments and add usage examples

**Estimated Effort**: 2-3 days
**Files Modified**: 
- Test files across client and server
- Debug and development tools

### Phase 5: Ruleset Integration Enhancement

**Goal**: Make the system fully configurable via rulesets

**Tasks**:
1. **Add Tech-Style Mapping to Rulesets**:
   ```json
   // In cities.json
   {
     "style_evolution": {
       "base_styles": ["european", "classical", "tropical", "asian"],
       "tech_upgrades": {
         "railroad": ["industrial"],
         "automobile": ["electricage"], 
         "rocketry": ["modern"],
         "laser": ["postmodern"]
       }
     }
   }
   ```

2. **Add Nation-Style Mapping**:
   ```json
   // Link nations to their preferred city styles
   {
     "nation_styles": {
       "americans": "european",
       "romans": "classical",
       "babylonians": "babylonian"
     }
   }
   ```

3. **Add Style Transition Rules**: Control when and how styles change
   ```json
   {
     "transition_rules": {
       "min_city_size": 4,     // Only cities size 4+ get modern styles
       "require_all_techs": false, // OR vs AND for multiple tech reqs
       "preserve_base_culture": true // Keep cultural base (asian->asian_modern)
     }
   }
   ```

**Estimated Effort**: 1-2 days
**Files Modified**:
- Ruleset JSON files
- Ruleset loading and validation logic

## Total Estimated Effort

**12-15 development days** (2.5-3 weeks)

## Success Criteria

### ✅ Functional Requirements
- [ ] Cities automatically upgrade visual style when player researches required tech
- [ ] Style evolution follows Freeciv's authentic progression paths
- [ ] Nation-specific base styles are preserved throughout evolution
- [ ] System gracefully handles missing tech data or invalid states
- [ ] Performance impact is minimal (< 5ms per frame for city rendering)

### ✅ Technical Requirements  
- [ ] Complete technology tree from Ancient to Space Age
- [ ] Real-time client-server synchronization of research states
- [ ] Configurable via JSON rulesets
- [ ] Comprehensive unit and integration test coverage
- [ ] Backward compatibility with existing city rendering

### ✅ User Experience Requirements
- [ ] Visual city upgrades feel rewarding and noticeable
- [ ] Cultural diversity is maintained (Asian cities stay Asian-themed)
- [ ] Smooth transitions without jarring style changes
- [ ] Debug tools available for development and testing

## Dependencies and Risks

### Dependencies
- **Sprite Assets**: All city style sprites must be available in tileset
- **Game Balance**: Tech costs must be balanced for reasonable progression
- **Network Stability**: Research state sync must be reliable

### Risks and Mitigations
- **Performance Risk**: Style calculations on every render
  - *Mitigation*: Cache computed styles, only recalculate on research changes
- **Complexity Risk**: Many edge cases and combinations
  - *Mitigation*: Comprehensive test suite, gradual rollout
- **Asset Risk**: Missing sprites for advanced city styles  
  - *Mitigation*: Fallback system, placeholder graphics

## Future Enhancements

### Phase 6+ (Post-MVP)
- **Animated Transitions**: Smooth visual transitions between city styles
- **Mixed Architecture**: Cities with multiple building styles within same city
- **Wonder Styles**: Special city styles for cities with specific wonders
- **Climate Adaptation**: City styles adapt to terrain and climate
- **Cultural Victory**: City style diversity affects cultural influence

## References

- **Freeciv Rulesets**: `/reference/freeciv/data/classic/`
  - `cities.ruleset` - City style definitions
  - `techs.ruleset` - Complete technology tree
  - `styles.ruleset` - Visual style specifications

- **Implementation References**: 
  - `apps/server/src/game/managers/ResearchManager.ts` - Current tech system
  - `apps/client/src/components/Canvas2D/renderers/CityRenderer.ts` - Current city rendering
  - `apps/server/src/shared/data/rulesets/classic/cities.json` - City style ruleset

---

**Created**: 2025-09-05  
**Status**: Planning  
**Priority**: Medium  
**Assigned**: TBD