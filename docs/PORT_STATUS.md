# CivJS Port Status

**Verified against:** Milestone 2 working tree (2026-07-26)
**Verification method:** source-tree audit plus passing client/unit tests and the
production type check/build. Database-backed integration remains separately
dependent on the configured PostgreSQL test service.

**External verification blocker (2026-07-26):** `npm run test:integration` was
attempted, but all 13 suites stopped in shared setup because neither
`TEST_DATABASE_URL` nor a local PostgreSQL test database was available. No
Milestone 2 integration assertion executed and failed.

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

## Milestone 0 — complete

Milestone 0's reliable-porting baseline is complete:

- `PORT_STATUS.md` is the single high-level status source.
- [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md) records the classic ruleset
  data coverage, every active transport contract, its upstream reference, and
  its available automated evidence.
- `apps/server/tests/integration/GameFlow.integration.test.ts` verifies the
  authoritative manager/database flow, including restart recovery.
- `apps/server/tests/integration/SocketGameFlow.integration.test.ts` verifies
  the client transport boundary: Socket.IO connection/authentication, game
  creation, join/nation selection, map delivery, 20 turn completions, and
  rejoin.
- `.github/pull_request_template.md` requires source citations and packet and
  ruleset impact assessments for new porting changes.

This baseline makes incomplete data and transport explicit; it does not imply
that the partially ported mechanics below are complete.

## Milestone 1 — complete

The core two-player classic loop is now covered from the client transport
boundary through persistent server state:

- Nation selection, game start, map delivery, movement, combat, city founding,
  production selection, research selection, and 20 completed turns are
  exercised in `apps/server/tests/integration/SocketGameFlow.integration.test.ts`.
- The same test clears in-memory games to simulate a server restart, recovers
  state from PostgreSQL, reconnects the host, completes another two-player
  turn, and verifies the recovered city remains present at turn 22.
- Map packets, units, cities, and borders are scoped to the receiving player's
  owned or visible state during normal play and recovery.

This meets the Milestone 1 exit criterion: a two-player classic game can be
created, played for 20 turns, reconnected, and continued with deterministic
server state. Visual fog-of-war rendering, worker improvements, wonders, AI,
and deeper economic fidelity remain later-milestone work.

## Milestone 2 — complete

Classic ruleset data is authoritative for the Milestone 1 playable loop:

- Zod and cross-file validation cover all shipped classic JSON domains,
  supported effect types, and entity references.
- Government, technology, building, unit, tile, specialist, and nation-group
  requirements are evaluated with explicit context and fail closed when
  required context is absent.
- Loaded data drives unit classes, terrain movement/yields, building
  names/upkeep, research, food consumption, city corruption and happiness,
  specialists, fortification/defense, vision, and granary retention.
- `apps/server/tests/shared/data/rulesets/RulesetMutation.test.ts` uses isolated
  copied fixtures to prove that effect, unit, building, technology, terrain,
  and game-data mutations change authoritative results.

Effects requiring later systems remain deliberately inert: capture population
protection and incite-cost rules await their Milestone 3/4 action flows, and
visible-wall effects await Milestone 5 rendering support. This completion claim
is limited to the Milestone 1 playable loop; it does not imply that later city,
worker, action, client, AI, diplomacy, or metagame milestones are complete.

## Milestone 3 — in progress

The production lifecycle is the first completed Milestone 3 slice. Normal turn
production, rush buying, completion, client progress, and persistence use one
shield stock. Completion retains overflow, and classic unit/building rush
premiums are covered by `CityProductionLifecycle.test.ts`.

The remaining Milestone 3 scope includes full city output/economy fixtures,
trade routes, governor/citizen automation, worker improvements, pollution, and
terrain transformations.

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
- Milestone 0 evidence backlog: [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md).
- Culture implementation: `docs/CULTURE_SYSTEM_IMPLEMENTATION.md`.
- Citizen-management design and usage: `apps/server/src/game/systems/CitizenManagement/README.md`.

Historical plans and gap analyses were removed because their paths, file sizes, and completion claims no longer represented the repository.
