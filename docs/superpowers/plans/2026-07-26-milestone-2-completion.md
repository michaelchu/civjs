# Milestone 2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make classic ruleset data authoritative for every Milestone 1
playable-loop rule and satisfy Milestone 2's validation and mutation-test exit
criterion.

**Architecture:** Keep `RulesetLoader` as the parser and add cross-file
integrity validation. Share one `EffectsManager` across authoritative game
services, pass complete contexts, and replace duplicate constants with loaded
values. Keep effects that require later-milestone systems explicitly inert.

**Tech Stack:** TypeScript 5.9, Zod 4, Jest 30, Node.js, existing CivJS
ruleset services.

## Global Constraints

- Port only behavior traceable to `reference/freeciv/`; cite source paths and
  line ranges in code or tests.
- Do not activate effects whose required gameplay system belongs to Milestones
  3–6.
- Missing requirement context fails closed.
- Each slice ends with focused tests, production type checking, and a commit.
- Do not replace runtime player state or engine algorithms with ruleset data.

---

### Task 1: Ruleset integrity and supported-type validation

**Files:**

- Modify: `apps/server/src/shared/data/rulesets/schemas.ts`
- Modify: `apps/server/src/shared/data/rulesets/RulesetLoader.ts`
- Create: `apps/server/tests/shared/data/rulesets/RulesetLoader.validation.test.ts`

**Interfaces:**

- Produces: `RulesetLoader.validateRuleset(rulesetName?: string): void`
- Removes: unused `RulesetLoader.evaluateRequirements(...)`

- [ ] Add an effect-type schema containing runtime-supported and explicitly
      inert shipped effect types; reject unknown types.
- [ ] Constrain government requirement types to the evaluator-supported set.
- [ ] Implement cross-file validation for unit, building, effect, and
      government references using normalized rule names.
- [ ] Add one malformed-schema case for each of terrain, units, buildings,
      technologies, governments, game, effects, nations, and cities.
- [ ] Add broken-reference tests for unit techs, building prerequisites, and
      effect entity requirements.
- [ ] Run `npx jest tests/shared/data/rulesets/RulesetLoader.validation.test.ts
    tests/shared/data/rulesets/RulesetLoader.effects.test.ts`.
- [ ] Run `npm run type-check` and commit
      `feat: validate classic ruleset integrity`.

### Task 2: Complete classic playable-loop effect data

**Files:**

- Modify: `apps/server/src/shared/data/rulesets/classic/effects.json`
- Modify: `apps/server/tests/shared/data/rulesets/RulesetLoader.effects.test.ts`
- Modify: `apps/server/tests/game/managers/EffectsManager.requirements.test.ts`

**Interfaces:**

- Consumes: `EffectType`, `EffectContext`
- Produces: loaded `Upkeep_Pct`, `Unhappy_Factor`,
  `Revolution_Unhappiness`, `Make_Content_Mil`, and senate effects used by
  existing government APIs.

- [ ] Port the exact classic effects used by authoritative government,
      happiness, and support code from `reference/freeciv/data/classic/effects.ruleset`.
- [ ] Restore `OutputType=Trade` requirements on corruption effects.
- [ ] Add live-ruleset assertions for each new effect and negative context
      assertions proving scope restrictions.
- [ ] Run focused loader/requirements tests and `npm run type-check`.
- [ ] Commit `feat: load classic government effects`.

### Task 3: Make unit class and terrain movement data authoritative

**Files:**

- Modify: `apps/server/src/shared/data/rulesets/classic/units.json`
- Modify: `apps/server/src/shared/data/rulesets/schemas.ts`
- Modify: `apps/server/src/game/services/RulesetUnitsService.ts`
- Modify: `apps/server/src/game/constants/MovementConstants.ts`
- Modify: `apps/server/tests/game/MovementConstants.test.ts`
- Create: `apps/server/tests/game/services/RulesetUnitsService.test.ts`

**Interfaces:**

- `UnitType.rulesetUnitClassFlags: string[]` comes from JSON.
- `getTerrainMovementCost(terrain, unitTypeId?)` reads `terrain.json.moveCost`
  and scales by `SINGLE_MOVE`.

- [ ] Add classic unit-class definitions/flags to `units.json` and schema,
      then delete `CLASSIC_UNIT_CLASS_FLAGS`.
- [ ] Map movement class from loaded unit class instead of
      `UNIT_MOVEMENT_TYPES`.
- [ ] Replace `TERRAIN_MOVEMENT_COSTS` with loaded terrain costs.
- [ ] Add parity tests for representative land/sea/air units and terrain
      movement; include a loader-injection mutation proving changed move cost
      changes the result.
- [ ] Run movement, unit, pathfinding, and action tests plus type checking.
- [ ] Commit `refactor: drive movement from classic rulesets`.

### Task 4: Share city effect context and unify corruption

**Files:**

- Modify: `apps/server/src/game/managers/CityManager.ts`
- Modify: `apps/server/src/game/services/CityCalculationService.ts`
- Modify: `apps/server/src/game/services/CityHappinessService.ts`
- Modify: `apps/server/src/game/services/CityTurnProcessingService.ts`
- Create: `apps/server/tests/game/services/CityCorruption.effects.test.ts`

**Interfaces:**

- City services accept the game-owned `EffectsManager`.
- `CityCalculationService.calculateCityOutputs(...)` receives player cities
  and complete player context.
- `EffectsManager.calculateCityCorruption(...)` is the only corruption path.

- [ ] Inject the existing game `EffectsManager` into all city services.
- [ ] Pass government, technologies, player buildings, city coordinates, and
      player cities into output calculations.
- [ ] Use only cities with active `Gov_Center` effects to determine distance.
- [ ] Remove `GOVERNMENT_CORRUPTION_MODIFIERS`, nearest-any-city logic, the
      hardcoded despotism refresh, and double corruption application.
- [ ] Fix zero-coordinate handling in government-center distance.
- [ ] Add tests for palace distance zero, distant Republic corruption,
      courthouse reduction, and changed loaded effect value changing trade.
- [ ] Run city calculation/manager tests and type checking.
- [ ] Commit `feat: apply ruleset corruption once`.

### Task 5: Drive happiness and specialists from effects

**Files:**

- Modify: `apps/server/src/game/services/CityHappinessService.ts`
- Modify: `apps/server/src/game/services/CityCalculationService.ts`
- Modify: `apps/server/src/game/managers/CityManager.ts`
- Create: `apps/server/tests/game/services/CityHappiness.effects.test.ts`
- Create: `apps/server/tests/game/services/CitySpecialists.effects.test.ts`

**Interfaces:**

- `calculateDetailedHappiness` uses `calculateMartialLaw` and
  `City_Unhappy_Size`.
- Specialist contexts use classic names `elvis`, `scientist`, and `taxman`.

- [ ] Replace population-based martial-law math with
      `Martial_Law_By_Unit`/`Martial_Law_Max`.
- [ ] Replace the hardcoded size threshold with `City_Unhappy_Size`.
- [ ] Replace scientist/taxman/entertainer amounts with
      `Specialist_Output`.
- [ ] Deduplicate specialist metadata into one focused module or loaded city
      ruleset definition; retain unsupported CivJS specialists as inert.
- [ ] Add government, tech-gated contentment, martial-law cap, specialist
      output, and mutation tests.
- [ ] Run city happiness/output tests and type checking.
- [ ] Commit `feat: apply classic happiness and specialist effects`.

### Task 6: Remove remaining low-risk duplicate values

**Files:**

- Modify: `apps/server/src/game/services/CityDataService.ts`
- Modify: `apps/server/src/game/systems/Economic/constants/EconomicConstants.ts`
- Modify: `apps/server/src/game/services/CityTileManagementService.ts`
- Modify: `apps/server/src/game/managers/ResearchManager.ts`
- Modify: relevant focused test files

**Interfaces:**

- Building names/upkeep come from `RulesetBuildingsService`.
- Citizen food cost and base tile yields come from `game.json`/`terrain.json`.
- `LEGACY_TECHNOLOGIES` is removed.

- [ ] Replace building display-name and upkeep tables with loaded building
      definitions; delete unused duplicate economic constants.
- [ ] Replace `population * 2` food cost with `civstyle.food_cost`.
- [ ] Replace base terrain yield switches with loaded terrain values while
      preserving runtime resource/improvement modifiers.
- [ ] Delete `LEGACY_TECHNOLOGIES`.
- [ ] Add parity tests for upkeep, food cost, yields, and the ruleset-backed
      research catalogue.
- [ ] Run focused tests and type checking.
- [ ] Commit `refactor: remove classic ruleset duplicates`.

### Task 7: Mutation evidence and Milestone 2 completion

**Files:**

- Create: `apps/server/tests/shared/data/rulesets/RulesetMutation.test.ts`
- Modify: `docs/PORTING_INVENTORY.md`
- Modify: `docs/PORTING_PLAYBOOK.md`
- Modify: `docs/PORT_STATUS.md`

**Interfaces:**

- Isolated `RulesetLoader(baseDir)` fixtures must be injectable into affected
  services without changing global singleton state.

- [ ] Add isolated mutation tests proving changed effect, unit, building,
      technology, terrain, and game parameter data changes the corresponding
      authoritative calculation.
- [ ] Add a representative parity matrix covering Warriors, Granary/Library/
      Temple, Alphabet→Pottery, terrain movement/yields, government corruption,
      fortify/walls, vision, and granary retention.
- [ ] Document later-milestone inert effects and the exact M2 evidence files.
- [ ] Run `npm run format:check`, `npm run lint`, `npm run typecheck`,
      `npm run test:unit`, and `npm run test:integration` when the configured
      test database is available.
- [ ] Fix regressions within M2 scope; record any external integration blocker.
- [ ] Commit `docs: mark ruleset fidelity milestone complete`.

## Self-review

- Every M2 checklist item maps to at least one task.
- Full upstream effect import and later mechanics are explicitly excluded.
- Each implementation task has its own test and commit boundary.
- No placeholder APIs or undefined neighboring interfaces are required.
