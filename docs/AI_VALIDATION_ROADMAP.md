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
