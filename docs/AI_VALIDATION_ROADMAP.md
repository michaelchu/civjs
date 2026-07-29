# AI Validation Roadmap

This document records follow-up work needed to move from confidence that the AI
is correctly integrated to confidence that it can reliably play complete,
sensible, and competitive games.

## Current confidence

The authoritative AI integration suite provides:

- High confidence that covered AI decisions use real game managers, persist
  correctly, survive recovery, and do not replay completed or interrupted turn
  actions.
- High confidence in representative paths for expansion, ferry transport,
  combat, special units, production, research, government, treasury,
  diplomacy, wonders, and the space race.
- Moderate confidence in whole-game behavior. The current seeded soak coverage
  is intentionally small and does not explore enough maps, starting positions,
  diplomatic histories, or long-game state combinations.
- Limited evidence of strategic strength. A legal, coherent action is not
  necessarily a strong action.

The current suite should therefore be treated as strong evidence of functional
correctness and manager integration, not proof that the AI consistently plays
well.

## Implemented validation foundation

The first implementation steps are now in place:

- `GameConfig.mapSeed` is persisted and used during map creation, making a
  configured generated world replayable instead of relying on mocked global
  randomness.
- The integration soak uses named deterministic seeds and emits a compact
  failure artifact containing the seed, turn, player/task summaries,
  violations, and reproduction command.
- Authoritative integration scenarios now cover an AI producing a terrain
  improver, completing a requested road, and selecting, completing, and
  persisting an economic city improvement.
- `npm run test:ai-validation:matrix` runs the focused suite through a
  25-seed, bounded terminal-state matrix using Docker PostgreSQL. Its cases
  vary map dimensions, terrain generation settings, player count, difficulty,
  and configured victory condition; each still has a deterministic max-turn
  cap so a failed terminal condition cannot hang the job.
- Selected matrix seeds inject early-, middle-, and late-game process recovery.
  The runner checks authoritative AI state and world invariants after every
  turn and after each recovery.
- Matrix failures write ignored but durable JSON diagnostics under
  `apps/server/test-results/ai-validation/`, including configuration, current
  phase and turn, map/entity snapshot, AI planning state, failure diagnosis,
  and a focused Docker reproduction command.
- AI state retains a bounded, restart-safe decision trace for recent subsystem
  attempts (turn, phase label, input city/unit/task footprint, action count,
  ranked city-production/research candidate scores, authoritative selected
  city production/research, post-action economic delta, and error/rejection
  reason). The trace is included in the matrix artifact through the saved AI
  state.
- A normalized terminal replay fingerprint compares map features, city/unit
  state, behavioral metrics, and decision outcomes while excluding generated
  database IDs. The focused suite runs the same seeded terminal game twice and
  asserts identical authoritative outcomes.
- Per-turn behavioral metrics have a committed, deliberately conservative
  baseline for minimum samples, AI activity, and prolonged idle detection.
- Failure artifacts now contain both the failure-time snapshot and the last
  known-good normalized snapshot from before the failing turn.
- Empire-worker scenarios execute through authoritative managers: the AI
  produces a worker, reserves work, builds roads, clears pollution, builds
  mines, irrigation, railroads only after the road and technology prerequisites
  are present, and terrain transformations. An active road order survives
  server recovery and finishes exactly once afterward.
- City scenarios cover a feasible anti-starvation allocation, persisted citizen
  outputs, legal Currency-unlocked marketplace selection while excluding an
  existing Barracks, and threatened-city defensive production/rushing. The
  economic building and emergency defense both survive recovery.
- A deterministic two-city lifecycle scenario now composes city growth,
  Currency unlock, multiple full AI turns with continuous invariants, city
  capture, and process recovery. It verifies that the surviving city, captured
  city ownership, and researched technology all recover authoritatively.
- The worker planner has an explicit overlapping two-city request case that
  confirms a shared tile is reserved by at most one worker. A paired benchmark
  now runs two authoritative same-seed terminal games with easy/hard difficulty
  assignments swapped between starting positions and records normalized totals.
- The larger `npm run test:ai-validation:100` matrix runs weekly and on manual
  dispatch in `.github/workflows/ai-validation.yml`, outside normal pull-
  request feedback. The job uploads any validation diagnostics as an artifact.
- The initial 25-configuration terminal matrix has been executed successfully
  in five deterministic Docker shards (seeds 01–25). Each configuration reached
  its configured terminal turn without an invariant violation; seeds 01, 13,
  and 25 exercised early, middle, and late recovery respectively.
- The scheduled 100-configuration terminal matrix has also completed against
  disposable Docker PostgreSQL without emitting a failure artifact. This is the
  initial empirical baseline; it remains intentionally conservative until
  longer-game metrics and comparative matches are collected.
- The focused Docker suite executes a legal airbase-to-undefended-city
  paratrooper capture through the authoritative action path. The fixture
  constrains its launch tile to neutral or friendly ownership, matching the
  server's paradrop-source legality rule.

This is intentionally a foundation rather than completion of the milestone:
longer-game behavioral baselines, statistically meaningful comparative
strength thresholds, and frozen-opponent regression results remain required
work.

## Next validation milestone: deterministic simulation matrix

Build a headless simulation harness that runs complete AI games across a
repeatable matrix of at least 25 seeds initially, expanding toward 100 seeds
once runtime and failure diagnostics are practical.

Vary:

- Map seed, size, landmass, temperature, wetness, resources, and huts.
- Two-player and multiplayer games.
- AI difficulty and trait combinations.
- Victory conditions, including conquest, science, and turn limits.
- Symmetric AI-versus-AI games and mixed difficulty games.
- Save/recovery injection at selected early-, middle-, and late-game turns.

Every failed seed must be directly reproducible from its recorded configuration.

## Required invariants

Each simulation should continuously assert:

- Turn processing completes within a bounded time.
- No player, city, unit, or AI planning state becomes invalid.
- No authoritative action is duplicated after retry or recovery.
- Units do not retain impossible transport, ownership, target, or location
  relationships.
- Research, production, government, treasury, diplomacy, and spaceship state
  remains recoverable.
- The game reaches a valid victory, elimination, or configured turn limit.
- An AI with legal actions does not remain stalled for an unexplained extended
  period.
- Replaying a deterministic seed from the same initial state produces the same
  authoritative outcome.

## Behavioral health metrics

Record per-player time series rather than relying only on pass/fail:

- Cities founded, lost, and captured.
- Population, production, trade, science, gold, and technology progression.
- Units produced, lost, idle, transported, and assigned persistent tasks.
- Research and production idle turns.
- Treasury insolvency and recovery duration.
- War declarations, treaty outcomes, diplomatic incidents, and wars with no
  meaningful contact.
- Wonder and spaceship progress.
- Action failures grouped by reason.
- Turn duration and time spent in each AI subsystem.

Initial health thresholds should detect obvious regressions without prescribing
one preferred strategy. Thresholds can be tightened after collecting a stable
baseline.

## Empire-management validation and reference parity

Full-game survival is not enough to show that the AI can manage an empire. Add
scenario tests that exercise the complete loop from strategic need, through city
production and worker orders, to authoritative state changes. These tests must
cover at least:

- **Worker creation:** when a city has valuable unimproved workable terrain and
  no sufficient worker coverage, the AI should be able to select a worker unit,
  complete it, and assign it a useful task. It should not keep producing
  workers when existing workers already cover the empire or when food, defense,
  or emergency production has higher priority.
- **Terrain improvements:** workers should select and complete beneficial
  irrigation, mines, roads/railroads, terrain transformations, and pollution or
  fallout cleanup. Tests should verify travel, safety, task reservation,
  prerequisite ordering, completion, and the resulting city output—not merely
  that an improvement action was emitted.
- **City improvements:** cities should choose legal, productive buildings and
  avoid already-built, obsolete, impossible, or strategically inappropriate
  improvements. Include ordinary buildings, wonders, prerequisites, upkeep,
  production changes, and recovery from a city becoming threatened or
  economically distressed.
- **Intelligent city management:** each city should allocate citizens without
  avoidable disorder or starvation, preserve required surpluses, use
  specialists when appropriate, and change focus as happiness, danger,
  production, food, and research conditions change. A multi-city fixture should
  also verify that the AI coordinates shared workers and does not assign two
  workers to the same request unnecessarily.
- **Empire lifecycle:** run the above behaviors through founding a second city,
  growth, war pressure, capture or loss of a city, technology unlocks, and
  save/recovery boundaries. Assert that production queues, citizen assignments,
  worker tasks, and city requests remain valid and are not replayed.

Each scenario should record a normalized decision trace containing the input
state, candidate choices and scores, selected action, authoritative result, and
post-action economic deltas. Assert both functional outcomes and bounded
quality properties, such as positive expected tile yield, no duplicate task
reservation, no persistent city disorder, and no unexplained production or
research idle turns. Keep quality thresholds tolerant of equivalent strategies;
the goal is to catch obviously irrational empire management, not to require one
exact move sequence.

For every scenario, perform a reference-parity review against the corresponding
Freeciv behavior before accepting the test. The current reference anchors are:

| Behavior                                   | Reference implementation                                                                                                                                                                     | Required parity check                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker-unit demand and domestic production | `reference/freeciv/ai/default/daidomestic.c` (`domestic_advisor_choose_build`, worker want calculation around lines 488–532)                                                                 | Confirm worker demand reflects terrain-improvement needs, food/upkeep cost, and expansion context.                                                |
| Worker task evaluation and safe execution  | `reference/freeciv/server/advisors/autoworkers.c` (`worker_evaluate_improvements`, `worker_evaluate_city_requests`) and `reference/freeciv/ai/default/daisettler.c` (`dai_auto_settler_run`) | Compare legal action candidates, city requests, travel/ETA competition, safety, prerequisites, and improvement benefit.                           |
| City-building choices                      | `reference/freeciv/server/advisors/advbuilding.c` (`building_advisor`, `building_advisor_choose`) and `reference/freeciv/ai/default/daidomestic.c`                                           | Confirm impossible, unproductive, duplicate, and non-wonder-city wonder choices are excluded, while valid productive buildings remain candidates. |
| Citizen allocation                         | `reference/freeciv/common/aicore/cm.c` (`cm_query_result`, internal `apply_solution`) and `reference/freeciv/ai/default/daicity.c` (`dai_manage_cities`)                                     | Confirm the allocation maximizes the configured city objective subject to food, happiness, specialist, and worker constraints.                    |

Parity does not require identical scores or data structures. It does require
that the TypeScript AI makes the same legality and prerequisite decisions, uses
the same authoritative game effects, and does not omit a reference behavior
without a documented intentional difference. Store the reference file and
symbol reviewed with each scenario so future ruleset or AI changes do not turn
the parity requirement into an uncheckable assertion.

The minimum acceptance suite should include one focused test per behavior, one
multi-city coordination test, one long-running empire fixture, and recovery
variants for the worker and city-management tests. A test that only checks
`AIWorkerPlanner` output or a city production want is not sufficient; at least
one test in each area must execute the resulting action through `CityManager`
or `UnitManager` and verify persisted state.

## Strategic-strength evaluation

After simulation stability is established, add comparative evaluation:

1. Run paired games with swapped starting positions to reduce map bias.
2. Compare difficulty levels and require stronger levels to outperform weaker
   levels over a statistically meaningful match set.
3. Maintain benchmark opponents or frozen AI revisions to detect strategic
   regressions.
4. Track win rate alongside economic, scientific, expansion, military, and
   survival indicators.
5. Investigate large performance changes by replaying the exact seed and
   configuration.

Do not use a single match or raw win rate as the only quality signal.

## Failure artifacts

For every failed or timed-out simulation, preserve:

- Seed and complete game configuration.
- Build or commit identifier.
- Failure turn and active phase.
- Save snapshot immediately before failure, when available.
- AI planning state for affected players.
- Recent authoritative actions and rejected action reasons.
- A concise invariant or timeout diagnosis.

The harness should print a one-command reproduction instruction.

## Proposed delivery sequence

1. Add a deterministic headless full-game runner for one configuration.
2. Add continuous invariants and structured failure artifacts.
3. Add the 25-seed smoke matrix to a scheduled or opt-in test job.
4. Inject save/recovery boundaries into selected seeds.
5. Establish behavioral baselines and regression thresholds.
6. Expand to 100 seeds outside the normal pull-request critical path.
7. Add paired strategic-strength benchmarks and frozen-opponent comparisons.

## Completion criteria

This milestone is complete when:

- At least 25 deterministic configurations run to a valid terminal condition
  without invariant violations.
- Selected games recover at multiple injected turns without duplicated actions
  or divergent authoritative state.
- Failures produce durable, single-command reproduction artifacts.
- Behavioral metrics are stored and compared against an agreed baseline.
- A larger scheduled matrix can run without affecting normal pull-request
  feedback time.
