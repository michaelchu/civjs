# CivJS Port Status

**Verified against:** `6860b9dc` (2025-09-14)  
**Verification method:** source-tree audit; this document does not claim runtime or gameplay-test coverage.

## Purpose

This is the single status document for the Freeciv port. It records only claims that can be traced to the current codebase. For implementation details, use the subsystem documentation beside the code and the reference repositories under `reference/`.

## Implemented foundations

- React/TypeScript client and Node.js/TypeScript Socket.IO server.
- Ruleset loading: `apps/server/src/shared/data/rulesets/RulesetLoader.ts`.
- Map generation and map management: `apps/server/src/game/map/` and `apps/server/src/game/managers/MapManager.ts`.
- City, unit, research, and government managers: `apps/server/src/game/managers/`.
- Structured turn processing, including a culture phase: `apps/server/src/game/managers/TurnManager.ts` and `apps/server/src/game/services/TurnPhaseService.ts`.
- Culture, borders, and visibility: `CultureManager.ts`, `BorderManager.ts`, and `VisibilityManager.ts` in `apps/server/src/game/managers/`.
- Citizen assignment optimization: `apps/server/src/game/systems/CitizenManagement/`, with corresponding server tests.

## Partial or incomplete areas

These are confirmed by explicit TODOs, placeholders, or unintegrated paths; they are not a complete feature roadmap.

- AI turn processing is deferred (`TurnPhaseService.ts`).
- Diplomacy, city-management, and game-options areas have client placeholders (`apps/client/src/components/GameUI/GameLayout.tsx`).
- Smooth unit movement animation is not implemented (`apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts`).
- Several terrain, road, worker-action, and map-integration rules remain incomplete in `ActionSystem.ts` and `UnitManager.ts`.
- Some economic and trade-route integration remains incomplete despite the presence of `CityTradeRouteService.ts`; verify end-to-end behavior before treating it as port-complete.

## Porting workflow

1. Locate the corresponding behavior in `reference/freeciv/` or, for client behavior, `reference/freeciv-web/`.
2. Record the source file and line range in the implementation or its test.
3. Port the behavior with tests where practical.
4. Update this file only when the status changes, including the commit/date and the source/test evidence.

## Detailed documentation

- Continuation plan: [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md).
- Culture implementation: `docs/CULTURE_SYSTEM_IMPLEMENTATION.md`.
- Citizen-management design and usage: `apps/server/src/game/systems/CitizenManagement/README.md`.

Historical plans and gap analyses were removed because their paths, file sizes, and completion claims no longer represented the repository.
