# Gameplay simulation test plan

This document defines the acceptance coverage that belongs in the headless
simulator. Simulation tests are not a second unit-test suite. They should prove
behavior that emerges only when authoritative gameplay systems and AI planners
interact across multiple turns.

The overall test strategy has three layers:

1. **Mechanics regressions** use unit and focused integration tests for exact
   rules, validation failures, formulas, and atomic state transitions.
2. **Simulator contract tests** verify execution, determinism, replay,
   diagnostics, recovery, and telemetry behavior.
3. **Gameplay simulations** run AI-controlled civilizations for long enough to
   observe progression, adaptation, coordination, and victory pursuit.

Do not add a simulation fixture merely to repeat a manager test. A scenario is
justified when the behavior depends on several turns, several authoritative
subsystems, AI feedback from prior outcomes, or a population of seeds.

## Pass criteria

Every simulator-contract and gameplay-simulation case must satisfy these common
criteria:

- the simulator exits with the expected result;
- `diagnostics.invariants.passed` is `true` with no violations;
- `diagnostics.expectations.passed` is `true` when the fixture has an `expect`
  block;
- the final `snapshot.eventTelemetry` has zero dropped events, persistence
  failures, pending events, and pending movement summaries; and
- a fixed seed is reproducible when the case is marked deterministic.

Gameplay simulations must also assert meaningful progress or adaptation. A run
that merely survives to `maxTurns` is a smoke result, not evidence that the AI
or gameplay loop is working well.

Prefer assertions about observable outcomes over exact internal choices. Do
not require a particular action on an exact turn unless the timing itself is
the reference behavior under test. Use broad turn windows, state deltas,
ordered milestones, and bounded no-progress intervals so harmless planner
changes do not make scenarios brittle.

## Running and inspecting a case

Run a single fixture against an isolated database:

```sh
npm run --silent simulation:run -- \
  --config ../../docs/simulation-scenarios/<fixture>.json \
  --output ../artifacts/uat/<fixture> \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist
```

Inspect its result, expectations, invariants, and telemetry:

```sh
jq '{result, expectations: .diagnostics.expectations,
     invariants: .diagnostics.invariants,
     telemetry: (.replay.turns[-1].snapshot.eventTelemetry // null)}' \
  ../artifacts/uat/<fixture>/run.json
```

Run the checked-in suite with:

```sh
npm run --silent simulation:run:scenarios -- \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist \
  --output apps/artifacts/simulation-scenarios \
  --continue-on-error
```

`maxTurns` is an absolute turn cap. If setup starts at turn 12, a `maxTurns`
value of 20 permits turns 12 through 20; it does not request 20 additional
turns.

## What belongs in mechanics tests

The following behaviors should normally be tested with unit or focused
manager-integration tests. A gameplay simulation may encounter them, and the
always-on invariants must detect corrupt results, but each rule does not need a
dedicated simulation fixture:

- starting-position distance and map topology;
- city-founding validation and atomic settler consumption;
- combat formulas, movement cost, killstack behavior, and protected stacks;
- city growth, starvation, production completion, and worklist advancement;
- worker activity legality, duration, map extras, and tile-yield formulas;
- transport loading, unloading, reciprocity, destruction, and cargo rescue;
- trade-route eligibility, value, capacity, reciprocity, and cancellation;
- city-capture ownership reconciliation;
- diplomacy proposal clauses, acceptance, rejection, expiry, and rollback;
- government-change legality, revolution duration, and economic formulas;
- victory-condition evaluation, precedence, ties, and standings; and
- event retry, fault injection, and isolated persistence failure handling.

Add or strengthen a mechanics regression whenever a simulation discovers an
exact rule defect. Keep the simulation only when it continues to exercise a
valuable multi-turn behavior after that regression exists.

## Simulator contract suite

These tests validate the simulation surface rather than strategic quality.

### SIM-001 — Turn lifecycle, replay, and fixed-seed determinism

- **Priority:** P0.
- **Baseline:** `earth-small-bootstrap.json`.
- **Verify:** Sequential authoritative turns, phase ordering, turn/year
  progression, stable identities, checkpoint creation, state hashes, and a
  clean final telemetry queue.
- **Pass:** The run reaches its expected end reason, all checkpoints pass
  invariants, and a repeated fixed-seed run produces equivalent ordered state
  hashes and diagnostics.

### SIM-002 — Expectation and invariant failure reporting

- **Priority:** P0.
- **Verify:** A deliberately unmet expectation and deliberately corrupted
  checkpoint both fail the run with distinct, actionable diagnostics.
- **Pass:** The runner never reports a clean result, identifies the affected
  turn and assertion, and preserves the last valid checkpoint.
- **Placement:** Prefer service/integration tests; a checked-in negative fixture
  is optional and should not run in the ordinary green scenario suite.

### SIM-003 — Recovery equivalence

- **Priority:** P0.
- **Setup:** Run a fixed-seed game continuously and repeat it with a restart at
  one or more completed-turn boundaries.
- **Verify:** AI state, accepted plans, random state, identity allocation,
  authoritative state hashes, and subsequent outcomes remain equivalent.
- **Pass:** Recovery creates no duplicate turn or event, and the resumed run
  converges with the uninterrupted control run.

### SIM-004 — Telemetry and replay pressure

- **Priority:** P1.
- **Setup:** Run an active four-or-more-player game for 500 and 1,000 turns.
- **Verify:** Event persistence remains batched, movement is summarized,
  checkpoints remain readable, and artifact growth stays within an established
  baseline.
- **Pass:** No crash, timeout, invariant violation, telemetry loss, or
  permanently pending work occurs.

## Multi-turn gameplay simulation suite

These are the primary gameplay UATs. Each scenario should begin from a natural
or lightly constrained state. Seed only what is required to reach the phase of
the game under study; do not preconstruct the intended outcome.

### GAME-001 — Early expansion and economic progress

- **Priority:** P0.
- **Length:** 50–100 turns across a small seed matrix.
- **Setup:** At least three AI civilizations with ordinary starting units and
  no prebuilt expansion outcome.
- **Observe:** City founding, legal placement, population growth, tile
  improvement, production changes, research, treasury, and exploration.
- **Pass:** Every surviving civilization demonstrates progress in more than one
  domain; settlers do not remain indefinitely idle when legal sites exist;
  cities do not remain indefinitely without production; technology or research
  progress increases; and no civilization enters an unexplained no-progress
  interval beyond the configured bound.
- **Do not assert:** An exact city site, production item, technology, or turn.

### GAME-002 — Sustained land war and replanning

- **Priority:** P0.
- **Length:** 40–100 turns after meaningful contact.
- **Setup:** Rival civilizations with reachable borders and enough economy to
  produce military units. A seeded hostile relation is acceptable; preplacing
  a guaranteed one-hit combat is not.
- **Observe:** Threat assessment, military production, target selection,
  movement toward objectives, defender choice, repeated combat, replacement of
  losses, city defense, and capture or abandonment of infeasible plans.
- **Pass:** The AI converts strategic intent into gameplay effects, does not
  repeatedly issue impossible orders, clears stale tasks after losses or map
  changes, and produces a coherent terminal outcome such as capture, successful
  defense, negotiated de-escalation, or explicit replanning.

### GAME-003 — Overseas expansion and ferry coordination

- **Priority:** P1.
- **Length:** 75–150 turns.
- **Setup:** An AI civilization with attractive reachable land separated by
  water and no initially available land path.
- **Observe:** Site selection, demand for transport capacity, ferry production,
  rendezvous, embarkation, sea movement, disembarkation, and follow-through by
  a settler or military force.
- **Pass:** The AI completes an overseas objective or records and acts on a
  valid reason to abandon it; cargo and ferry assignments do not remain stale;
  and no units become permanently stranded because cooperating planners lose
  shared state.

### GAME-004 — Economic and government adaptation

- **Priority:** P1.
- **Length:** 75–150 turns with at least one material pressure change.
- **Setup:** Allow normal development, then introduce or naturally reach upkeep,
  happiness, war, research, or treasury pressure.
- **Observe:** Economic-rate changes, government choice, revolution, production
  priorities, upkeep, research pace, and recovery after the pressure changes.
- **Pass:** The AI responds in the expected direction, preserves legal rates,
  avoids persistent insolvency or disorder when a feasible response exists,
  and does not oscillate repeatedly between equivalent policies.

### GAME-005 — Diplomacy evolves with game state

- **Priority:** P1.
- **Length:** 100–200 turns across multiple seeds.
- **Setup:** Three or more initially uncontacted or neutral civilizations. Seed
  personality, but avoid seeding a countdown that guarantees the result except
  in a focused planner regression.
- **Observe:** Contact, threat and power changes, proposals, acceptance or
  rejection, alliances, war declarations, peace attempts, incidents, and
  visibility changes.
- **Pass:** Diplomatic actions are attributable to prior game state, bilateral
  state remains consistent, and the AI changes posture when the strategic
  situation materially changes. The suite should tolerate different legal
  outcomes across seeds while rejecting inactivity and contradictory behavior.

### GAME-006 — Late-game victory pursuit

- **Priority:** P1.
- **Length:** 200–500 turns or a mid-game scenario with prerequisites still to
  be earned.
- **Setup:** Select one or more victory conditions without pre-setting their
  final trigger.
- **Observe:** Research goals, prerequisite infrastructure, wonders or
  spaceship components, military elimination, alliances, culture, launch
  timing, and end-game evaluation.
- **Pass:** At least one AI makes measurable progress toward an enabled victory,
  changes intermediate plans as prerequisites complete, and the reported winner
  and standings agree with the authoritative final state.

### GAME-007 — Recovery from disrupted plans

- **Priority:** P1.
- **Length:** 50–100 turns.
- **Setup:** Begin an authentic worker, settler, defense, attack, trade, or ferry
  plan, then invalidate it through an authoritative game event such as unit
  loss, city capture, diplomacy change, blocked terrain, or target removal.
- **Observe:** Task invalidation, reassignment, replacement production, and
  renewed progress.
- **Pass:** Invalid tasks are cleared within a bounded number of turns, affected
  units receive legal new work or become intentionally idle, and the
  civilization resumes progress without restart-only repair.

### GAME-008 — Seed-matrix endurance and stagnation detection

- **Priority:** P1.
- **Length:** 200, 500, and 1,000-turn presets with at least four AIs.
- **Observe:** Progress per era, living-player count, city/population/technology
  trends, production diversity, combat and diplomacy activity, victory progress,
  idle-unit/task age, and no-progress windows.
- **Pass:** No seed violates invariants or telemetry guarantees; repeated seeds
  are deterministic; runs do not deadlock; and strategically different seeds
  are allowed to reach different legal outcomes without collapsing into the
  same accidental behavior.

## Required expectation support

The current final-state and event-count expectations are sufficient for smoke
fixtures but not for the gameplay suite above. Extend them incrementally with:

- checkpoint assertions scoped to a turn or turn window;
- initial-to-final and checkpoint-to-checkpoint state deltas;
- ordered milestones, such as `transport_requested` before embarkation and
  disembarkation;
- maximum no-progress or idle-task durations;
- AI decision-trace matching by player, planner/category, target, result, and
  turn window;
- sustained predicates that must hold for a configured number of turns;
- aggregate and per-player metrics for cities, population, technologies,
  treasury, production, units, idle tasks, and victory progress; and
- seed-matrix summaries with thresholds expressed as counts or proportions,
  rather than requiring identical outcomes from different seeds.

Keep expectation semantics observational. They should evaluate authoritative
snapshots, durable events, and recorded AI decisions without reaching into live
manager internals.

## Existing fixtures and disposition

| Fixture                            | Current value                                   | Long-term disposition                                                        |
| ---------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `earth-small-bootstrap.json`       | Lifecycle and replay smoke                      | Keep under SIM-001                                                           |
| `earth-small-city-founding.json`   | Confirms default AI can eventually found a city | Fold into GAME-001 once expansion expectations exist                         |
| `earth-small-combat.json`          | Combat/event smoke                              | Keep temporarily as telemetry smoke; exact combat belongs in mechanics tests |
| `earth-small-war.json`             | Seeded-war multi-turn diagnostic                | Evolve into GAME-002                                                         |
| `earth-small-war-declaration.json` | Forced diplomacy decision path                  | Keep as a focused AI planner regression; add an unforced GAME-005 scenario   |
| `earth-small-research.json`        | Multi-turn research/production/growth smoke     | Evolve into GAME-001 or GAME-004 with progress deltas                        |
| `earth-small-trade-luxury.json`    | Exact trade/economy calculation                 | Treat as a mechanics/integration regression, not strategic UAT               |
| `earth-small-victory.json`         | End-condition smoke                             | Keep as simulator smoke; add GAME-006 for actual victory pursuit             |

## Implementation order

1. Document and enforce the boundary between mechanics, simulator-contract,
   and gameplay-simulation tests.
2. Add turn-window, state-delta, ordered-milestone, and no-progress expectation
   primitives.
3. Convert the existing founding and research fixtures into GAME-001 early
   expansion coverage.
4. Evolve the seeded-war diagnostic into GAME-002, including replanning and
   stale-task assertions.
5. Add GAME-003 and GAME-007 to exercise coordination between AI planners.
6. Add economic, diplomacy, and victory-pursuit scenarios.
7. Add the seed-matrix runner and endurance summaries last, after individual
   scenarios have trustworthy observability.

## Execution record

For each simulation or matrix run, record:

```text
Case ID:
Fixture / commit:
Seed(s):
Ruleset:
Turns completed:
Observed end reason:
Winner(s):
Progress milestones:
Longest no-progress interval:
Expectation result:
Invariant result:
Telemetry counters:
Unexpected warnings/errors:
Result: PASS / FAIL / BLOCKED
Evidence: path to run.json and relevant query output
```

The reference-gap workflow in
[`REFERENCE_GAP_WORKFLOW.md`](./REFERENCE_GAP_WORKFLOW.md) explains how to
classify a discovered defect, add the narrow regression at the correct layer,
and retain a simulation only when it continues to exercise valuable multi-turn
behavior.
