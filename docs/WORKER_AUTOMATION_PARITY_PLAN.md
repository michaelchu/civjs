# Worker Automation Parity Plan

## Objective

Bring CivJS worker-unit automation to core functional parity with the
supported Freeciv reference behavior, then close the remaining worker
decision-model and lifecycle differences.

The work is split into two phases:

1. **Phase 1 — Core functionality and architecture:** provide a usable,
   persistent Auto Worker mode for human players and a shared authoritative
   infrastructure-planning and execution path for human and AI workers.
2. **Phase 2 — Reference parity:** port the remaining Freeciv worker scoring,
   dependency, safety, reassignment, and lifecycle behavior; validate it with
   differential fixtures; and document intentional deviations.

This plan targets behavioral parity, not a line-for-line rewrite of the C
server. The server remains authoritative for planning legality, movement,
activity progress, persistence, and visible state.

## Scope boundary

This document covers worker and engineer **units** that improve terrain. It
does not cover citizens assigned to city tiles, specialists, the citizen
governor, or AI citizen-allocation timing. Those systems use related city
valuation data but have separate reference lifecycles in `citymap.c`, `cm.c`,
and `cityturn.c` and should be audited in a separate plan.

AI settler city-founding policy also remains distinct. Shared worker
infrastructure components may be reused by the AI settler controller, but this
plan does not merge city-founding policy into human Auto Worker behavior.

## Reference scope

The implementation and parity audit should use these reference paths:

| Reference                                         | Responsibility                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reference/freeciv/server/advisors/autoworkers.c` | Human and AI autoworker orchestration, city requests, city-workable improvement search, safety checks, reservations, scoring, and worker execution |
| `reference/freeciv/server/advisors/infracache.c`  | Cached city-tile infrastructure values and action dependencies                                                                                     |
| `reference/freeciv/ai/default/daisettler.c`       | AI worker continuation and AI-only settler infrastructure-versus-city-founding decisions                                                           |
| `reference/freeciv/common/unit.c`                 | Worker eligibility for the autoworker server-side agent                                                                                            |
| `reference/freeciv/server/unithand.c`             | Server-side agent activation and validation                                                                                                        |
| `reference/freeciv/server/srv_main.c`             | End-of-turn invocation of autoworkers and AI activities                                                                                            |

Freeciv initializes reservation state for every map tile, but
`worker_evaluate_improvements()` evaluates tiles within each owned city's
workable radius. “Whole-map state” must not be confused with “whole-map
improvement candidates.”

Current CivJS entry points and related code include:

- `apps/server/src/game/ai/AIWorkerPlanner.ts`
- `apps/server/src/game/ai/AIUnitController.ts`
- `apps/server/src/game/ai/AIPlayerController.ts`
- `apps/server/src/game/managers/UnitManager.ts`
- `apps/server/src/game/services/TurnPhaseService.ts`
- `apps/server/src/database/schema/units.ts`
- `apps/client/src/components/GameUI/UnitContextMenu.tsx`
- `apps/client/src/services/KeyboardController.ts`

## Implementation status

Phases 1 and 2 are implemented for the supported C2C3 worker-unit scope.
The original gaps that motivated this plan are now closed:

- The client presents the existing `AUTO_SETTLER` protocol action as
  **Auto Worker**, and only improvement-capable units receive it.
- Human and AI workers use the same city-workable planner, reservation model,
  legality checks, safety checks, path inputs, and authoritative executor.
- `automationMode` and `automationTask` are persisted independently from the
  current activity. Legacy `autoSettler`, `[activity, autoSettler]`, and
  `settler` mode records recover as canonical `worker` automation without
  turning unrelated automated movement into exploration.
- Explicit human orders take precedence. Assignment-owned GOTO and activity
  orders are recognized separately so automation can continue its own work.
- AI assignment cleanup now preserves valid untransported worker tasks and
  removes stale, captured, invalid, or inapplicable tasks.
- Worker automation runs after normal activity progress and AI decisions.
  Work started in that pass does not receive an extra progress tick.
- Source-derived fixtures cover city requests, city-workable bounds, scoring,
  dependencies, safety, reservations, displacement, lifecycle invalidation,
  persistence, visible state, and AI settler infrastructure comparison.

The implementation keeps one shared architecture with thin policy adapters:
human Auto Worker restricts planning to worker-reachable land destinations,
while AI policy may compare city founding and request ferry transport.

## Phase 1 — Core functionality and architecture

### Phase 1 outcome

At the end of Phase 1:

- A human can select a worker, enable **Auto Worker**, and see it travel to,
  perform, complete, and replan infrastructure work within owned cities'
  workable areas.
- Automation works when the map is fully explored.
- Human and AI workers share infrastructure candidate generation, legality,
  reservation, pathing, and authoritative execution components.
- Existing manual orders take precedence over automation.
- Automation mode, assignment, and in-progress work survive turn processing
  and reload without relying on `currentOrder` inference.
- AI worker infrastructure behavior retains AI-specific policy while using
  the shared core.

### 1. Establish the shared worker architecture

Create a worker automation service or equivalent shared modules with explicit
boundaries:

- a side-effect-free infrastructure candidate and scoring planner;
- a task/reservation coordinator;
- an authoritative executor that mutates units only through `UnitManager`;
- AI policy hooks for traits, settler roles, and transport demand.

The shared core owns:

- worker eligibility and explicit-order precedence;
- city worker-request prioritization;
- legal city-workable candidate discovery;
- improvement scoring and dependency checks;
- hostile-tile and occupancy checks;
- destination reservation;
- reachable path evaluation;
- assignment continuation, completion, invalidation, and replanning.

Human and AI workers should share legality and execution mechanics, but they
do not need identical top-level policy. In particular, AI settler
city-founding decisions remain in the AI controller.

### 2. Define the persistent automation model

Do not infer automation mode from the current activity order. Add explicit
persisted worker automation state to the unit model:

```ts
type UnitAutomationMode = 'explore' | 'worker';

interface WorkerAutomationTask {
  action: ActionType;
  targetX: number;
  targetY: number;
  assignedTurn: number;
  requestCityId?: string;
}
```

The database representation should add nullable `automationMode` and
`automationTask` fields. `isAutomated` may remain temporarily for compatibility
but must not be the source of truth once the migration is complete.

Migration and recovery rules:

1. `autoExplore` restores `automationMode = 'explore'`.
2. `autoSettler` restores `automationMode = 'worker'`.
3. An activity followed by `autoSettler`, such as
   `[road, autoSettler]`, restores worker mode while preserving the activity.
4. Legacy automated movement or rally orders without an automation marker do
   not become explorers.
5. Missing or invalid task data clears only the task and triggers replanning;
   it does not silently change automation mode.
6. Unit capture, destruction, ownership transfer, and explicit cancellation
   clear incompatible automation state transactionally.

The runtime model should use `worker` as the canonical name. Existing
`settler` and `autoSettler` values remain accepted at recovery and order
boundaries until their compatibility removal condition is met.

### 3. Reuse and complete city-workable planning

Extract the reusable portions of `AIWorkerPlanner.ts` into the shared worker
planner. Candidate discovery should include:

- explicit city worker-task requests;
- every legal tile within each owned city's workable radius;
- currently worked and useful unworked tiles;
- roads, railroads, irrigation, mines, cleanup, and supported terrain changes;
- visibility and ownership facts available to the controlling player;
- dependency-aware actions such as irrigation sources and railroad
  prerequisites.

The planner must reserve one destination per worker. Phase 1 may keep one
worker per destination for planning simplicity; compatible multi-worker
cooperation and displacement parity are completed in Phase 2.

Candidate generation must avoid an unbounded worker-by-map scan. Add a
performance fixture with multiple cities and workers to ensure planning scales
with city-workable candidates rather than total map area.

### 4. Expose human Auto Worker without duplicating the wire action

Retain `ActionType.AUTO_SETTLER` as the stable protocol and compatibility
identifier during Phase 1. Change the player-facing label to **Auto Worker**
and route the existing action into the shared worker automation service.

Expose it through:

- `UnitContextMenu` as **Auto Worker**;
- `KeyboardController` using the existing worker automation shortcut;
- server-side action availability for improvement-capable units.

Do not add a second `AUTO_WORKER` action unless a later protocol change has a
specific compatibility requirement. Unsupported units must not see the
action.

Automation remains cancellable through the existing cancel-orders path.
Manual movement, activities, combat, and other explicit orders clear or pause
worker automation according to one documented rule; the planner never
overwrites explicit player orders.

### 5. Add the authoritative human executor

Run the shared worker executor for human units whose canonical automation mode
is `worker`, subject to the reference safety and order checks.

The executor should:

1. resume an existing valid assignment;
2. otherwise select the best reachable city request or city-workable
   improvement;
3. move toward the target using authoritative pathfinding;
4. start the legal worker activity when it reaches the tile with movement
   available;
5. continue the multi-turn activity through `UnitManager`;
6. clear the assignment when work completes or becomes invalid;
7. replan on the next eligible end-of-turn pass.

Human Auto Worker considers destinations reachable by the worker's own
movement. Cross-continent ferry demand is not a Phase 1 human parity
requirement.

Persist automation mode, task, orders, and activity progress together and
broadcast resulting unit-state changes to the client.

### 6. Align AI worker execution

Update `AIUnitController.automateWorkers()` to consume the shared
infrastructure planner, reservation coordinator, and executor. It must:

- skip units with explicit existing orders;
- preserve valid persistent assignments;
- correct the inverted worker-task cleanup condition;
- remove assignments for destroyed, captured, transported, or invalid units;
- share candidate legality, reservation, and safety rules with human
  automation;
- avoid starting duplicate activities;
- replan after completion or target invalidation.

Existing AI ferry-demand behavior may remain in the AI policy layer, but it is
not shared with human Auto Worker and must not be cited as generic human
autoworker parity. AI-specific valuation modifiers, settler founding choices,
and traits also remain at the AI layer.

### 7. Preserve and verify reference timing

Freeciv invokes `auto_workers_player()` during end-of-turn activities. CivJS
should add an explicit autoworker step after normal unit activities and AI
decisions, or use an equivalent end-of-turn hook with documented ordering.

Phase 1 must preserve these observable rules:

- existing activity progress is processed once per turn;
- automation can select, move, or start work when the worker has movement;
- starting an activity during the end-of-turn automation pass does not also
  grant an extra activity-progress tick;
- the activity progresses during the next normal unit-activity pass;
- replanning occurs only after completion or invalidation.

Do not move worker automation earlier solely to remove an apparent one-turn
delay. Any timing change requires a deterministic comparison with the
reference.

### 8. Phase 1 tests and acceptance criteria

Add or update tests for:

- human Auto Worker action availability and UI selection;
- keyboard activation and cancellation;
- a fully explored map with a useful city-workable improvement;
- selection of a remote but reachable city-radius tile;
- city task requests taking priority;
- manual orders taking precedence;
- multi-turn activity completion and replanning;
- explicit worker-mode and task persistence;
- reload while `[activity, autoSettler]` is queued;
- legacy automation migration without false explorer recovery;
- AI use of the shared infrastructure core;
- valid AI task continuation and invalidation;
- end-of-turn selection and next-pass activity progress;
- bounded planning cost across multiple cities and workers.

Phase 1 is complete when a human worker can be automated end-to-end in a
normal game and human and AI worker infrastructure paths use the shared
legality, reservation, and execution architecture.

When Phase 1 begins, update the worker-infrastructure row in
`AI_PORTING_INVENTORY.md` from **Implemented** to **Partial** and list both the
existing evidence and the open parity work. Restore **Implemented** only after
the supported parity scope and evidence are complete.

## Phase 2 — Remaining reference parity

### Phase 2 outcome

At the end of Phase 2, all material branches in the reference worker-unit
paths are either implemented and covered or explicitly recorded as
intentional CivJS deviations.

### 1. Complete the worker decision model

Port and validate the remaining behavior from `autoworkers.c`, `infracache.c`,
and the worker portions of `daisettler.c`, including:

- infrastructure-cache inputs and dependency-aware road valuation;
- pollution/fallout urgency and environmental-pressure weighting;
- reference `want` scoring and travel/work amortization;
- worked-versus-unworked tile preference;
- worker displacement and recursive reassignment;
- cooperation rules for compatible workers where supported;
- worker continuation and invalidation after map, city, diplomacy, or combat
  changes;
- visibility, map-handicap, and omniscience behavior;
- ruleset-specific action legality and activity timing;
- AI settler infrastructure-versus-city-founding decisions without exposing
  those decisions to human Auto Worker.

### 2. Complete lifecycle and server-side agent parity

Validate automation through:

- save/load and server restart;
- unit capture, ownership transfer, transport, and unit death;
- city capture and destruction invalidating city requests or candidates;
- diplomacy and war changes affecting ownership and safety;
- map changes and newly completed infrastructure;
- control transfer between human and AI players;
- explicit cancellation and replacement by manual orders;
- sentry, goto, and non-idle activity transitions handled by the reference
  server-side agent.

### 3. Audit AI-only transport behavior

Audit existing AI ferry demand against the worker and settler reference paths.
Keep these distinctions explicit:

- generic human autoworkers select work reachable by their own movement;
- AI settlers may evaluate ferries while choosing overseas city sites;
- AI worker ferry extensions must be tested and documented if CivJS retains
  behavior beyond the reference autoworker path.

### 4. Differential fixtures and parity evidence

Create deterministic scenarios that compare the reference behavior and CivJS
for:

- selected worker target and action;
- path, movement availability, and estimated completion turn;
- reservation and displacement outcome;
- activity order and progress timing;
- city request priority;
- safety and ownership rejection;
- invalidation and recovery behavior.

Tests compare observable behavior rather than internal C or TypeScript
implementation details. Any intentionally retained difference must be listed
in this document or the relevant porting inventory with a reason.

### 5. Phase 2 acceptance criteria

Phase 2 is complete when:

- the parity matrix has no unreviewed worker-unit branches;
- human and AI worker infrastructure share authoritative legality,
  reservation, and execution components;
- AI-only policy differences are explicit and covered;
- deterministic reference fixtures pass for the supported C2C3 scope;
- persistence, lifecycle, ordering, and recovery cases are covered;
- `AI_PORTING_INVENTORY.md`, `PORT_STATUS.md`, and `GAMEPLAY_GAPS.md` reflect
  the final supported behavior and intentional deviations.

## Final parity matrix

| Reference branch                          | CivJS behavior                                                                                                                                                                                                                      | Status and evidence                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Server-side agent eligibility             | The server advertises and accepts Auto Worker only for improvement-capable units; human and AI control enter the same worker core.                                                                                                  | Implemented: `UnitManager.test.ts`, `UnitContextMenu.specialActions.test.tsx`, `KeyboardController.test.ts`                       |
| Existing orders and activity continuation | Explicit player orders win. Assignment-owned movement/activity continues; an unsafe active assignment is cancelled while safe work continues.                                                                                       | Implemented: `WorkerAutomationService.test.ts`, `UnitManager.test.ts`                                                             |
| City requests                             | Reachable legal city requests are evaluated before ordinary improvements and consumed when work starts.                                                                                                                             | Implemented: `AIWorkerPlanner.test.ts`, `AIOrchestrator.test.ts`                                                                  |
| Candidate boundary                        | Planning scans useful tiles in owned cities' workable sets, not every map tile for every worker.                                                                                                                                    | Implemented: bounded-call fixture in `AIWorkerPlanner.test.ts`                                                                    |
| Ruleset actions and dependencies          | Road, railroad, irrigation, mine, cleanup, cultivate, plant, and transform candidates use authoritative action legality. Railroad requests build their road dependency first; C2C3 irrigation has no legacy water-source heuristic. | Implemented: `AIWorkerPlanner.test.ts`, `UnitManager.test.ts`, `AIManagerBoundaries.integration.test.ts`                          |
| Yield and improvement valuation           | CivJS uses the reference food/shield/trade weights, worked-versus-unworked preference, travel/work discount shape, resulting-tile value, road-network value, and cleanup pressure.                                                  | Implemented for C2C3 observable choices: source-derived fixtures in `AIWorkerPlanner.test.ts`                                     |
| Safety and ownership                      | Non-owned candidates are rejected; visible hostile movement threat rejects work unless a friendly combat guard occupies the tile. AI visibility follows its existing difficulty handicap.                                           | Implemented: `WorkerAutomationService.test.ts`, `AIWorkerPlanner.test.ts`                                                         |
| Reservation and displacement              | A batch reservation coordinator gives each worker and destination at most one assignment. Lower-ETA workers displace farther reservations and displaced workers can receive the next ranked destination in the same batch.          | Implemented equivalent outcome: `AIWorkerPlanner.test.ts`                                                                         |
| Activity cooperation                      | Automatic planning avoids assigning two workers to one occupied destination. Workers manually placed on one compatible activity share authoritative work progress, including Engineer double rate.                                  | Implemented: `UnitManager.test.ts`; tracked as resolved by GP-029                                                                 |
| Human execution                           | Auto Worker selects reachable work, moves through authoritative GOTO, starts work, persists progress, completes it, and replans. Fully explored maps do not disable it.                                                             | Implemented: `WorkerAutomationService.test.ts`; database-backed recovery scenario in `AIManagerBoundaries.integration.test.ts`    |
| AI execution                              | AI workers consume the same plan and executor while retaining AI task storage and strategic policy.                                                                                                                                 | Implemented: `AIOrchestrator.test.ts`                                                                                             |
| Settler infrastructure comparison         | An AI city-founding-capable worker compares the best infrastructure want with the best city-site want unless already committed to a settle task. Human Auto Worker never receives city-founding policy.                             | Implemented: `AIOrchestrator.test.ts` (“uses the shared worker plan when infrastructure outranks a new city site”)                |
| End-turn timing                           | Existing activities progress once before worker selection; a newly started activity begins progressing in the next normal activity pass.                                                                                            | Implemented: `TurnPhaseService.recovery.test.ts` and worker activity tests                                                        |
| Persistence and recovery                  | Canonical mode/task, legacy markers, queued activity, and assignment survive restart. Invalid task payloads are discarded without changing worker mode.                                                                             | Implemented: `UnitManager.test.ts`, migration `0026_add_unit_automation_state.sql`, and `AIManagerBoundaries.integration.test.ts` |
| Lifecycle invalidation                    | Cancellation, capture/bribe, ownership/control transfer, transport, city removal, target invalidation, diplomacy threat, and completed infrastructure clear or replan incompatible work.                                            | Implemented: `UnitManager.test.ts`, `WorkerAutomationService.test.ts`, AI orchestrator fixtures                                   |
| Owner-visible state                       | Automation mode and target are broadcast to the owner and retained by the client, but task coordinates are not disclosed to enemy viewers.                                                                                          | Implemented: `GameBroadcastManager.test.ts`, `GameClient.state-packets.test.ts`                                                   |

No material worker-unit branch in the plan remains unreviewed. The following
implementation choices are intentional and do not create a second worker
architecture:

1. `AUTO_SETTLER` and `autoSettler` remain protocol/save compatibility names;
   player-facing text and the canonical runtime mode use **Auto Worker** and
   `worker`.
2. Human Auto Worker only selects destinations reachable by the worker's own
   movement. Cross-continent human ferry automation is outside the supported
   reference scope.
3. CivJS retains its AI worker ferry-demand extension as an AI policy hook.
   It is tested and is not presented as generic autoworker behavior.
4. CivJS computes city-workable values on demand instead of maintaining the C
   `infracache` data structure. It also resolves displacement as a deterministic
   batch assignment instead of recursively mutating units. Fixtures compare
   the observable target/action/reservation result.
5. Persisted manual sentry, patrol, rally, and unrelated GOTO orders pause Auto
   Worker rather than being silently replaced. This deliberately strengthens
   the plan's explicit-player-order precedence rule.
6. CivJS's ruleset services remain authoritative for exact activity duration,
   action enablers, terrain output, and extras. The worker planner ports the
   reference decision model onto those services rather than duplicating a
   second C-shaped rules engine.

## Verification gate

Run focused tests after each phase, followed by the normal project gate from
the porting playbook:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

## Non-goals

- Citizen tile assignment, specialist management, or citizen-governor parity.
- A literal port of every Freeciv AI utility or server data structure.
- Silent client-side worker actions that bypass server legality.
- A new automation mode that overwrites explicit player orders.
- Cross-continent human worker automation unless adopted as a documented
  CivJS extension.
- Claiming parity based only on planner unit tests without end-to-end turn,
  persistence, and visible-client coverage.
