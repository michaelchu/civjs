# Reference-gap workflow

The simulator is most useful for gameplay questions that emerge across several
turns or from interactions between authoritative systems and AI planners. It is
not a replacement for focused unit and manager-integration tests. Use a custom
scenario setup to establish only the preconditions the multi-turn behavior
needs, then combine automatic invariants with explicit progress, adaptation,
and outcome expectations.

## Investigation loop

1. Choose the reference subsystem and write down the behavior to verify. Start
   with the relevant Freeciv server code under `reference/freeciv/server/` and
   record its path and line range in the scenario or test documentation.
2. Classify the expected behavior and choose the narrowest appropriate layer:
   - State legality: an always-on simulator invariant should detect it.
   - An exact formula, validation rule, or atomic transition: add a unit or
     focused manager-integration test.
   - A simulator lifecycle, replay, recovery, or telemetry behavior: add a
     simulator-contract test.
   - AI planning, cross-system coordination, adaptation, or progress over time:
     add a multi-turn gameplay scenario.
   - Strategic quality or balance: use a scenario matrix and compare trends;
     this cannot be proven by one deterministic fixture or a structural
     invariant alone.
3. For a simulation-worthy behavior, create or extend a JSON scenario under
   `docs/simulation-scenarios/`. Use `scenarioSetup` for custom players,
   cities, units, diplomacy, research, and AI memory. Keep the seed and
   `maxTurns` explicit. Seed only what is necessary to reach the behavior; do
   not preconstruct the intended result.
4. Add `expect` rules for observable progress and outcomes. Prefer broad turn
   windows, state deltas, ordered milestones, bounded no-progress intervals,
   and recorded AI decisions. Avoid exact turns and exact internal choices
   unless they are the reference behavior being tested.
5. Run the scenario and inspect `run.json`, especially replay checkpoints,
   `diagnostics.invariants`, `diagnostics.expectations`, diplomacy events,
   state hashes, and AI decision records.
6. Repeat with a small seed matrix. A single deterministic run proves that a
   setup is reproducible; several seeds help distinguish a code defect from
   an overly specific fixture.
7. Turn the exact defect into a focused regression test and document whether
   the fix follows the reference behavior or intentionally differs. Retain the
   original simulation only when it still validates useful multi-turn behavior
   after the narrow regression exists.

Example command:

```sh
npm run --silent simulation:run -- \
  --config ../../docs/simulation-scenarios/earth-small-war-declaration.json \
  --output ../artifacts/war-declaration \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist
```

The command exits non-zero for configuration, turn, timeout, output,
expectation, or invariant failures. In particular, exit code `7` means the
run reached a completed checkpoint but violated a reference-informed
invariant. Exit code `6` means the run completed but did not satisfy the
scenario's intended gameplay outcome.

## What the simulator can find now

Automatic checks run after every completed turn, mirroring the cadence of
Freeciv's `real_sanity_check` in
`reference/freeciv/server/sanitycheck.c:663-687`. They can expose corrupted or
incomplete state in:

- map dimensions and coordinate bounds;
- player identity, diplomatic relations, and dead-player ownership;
- city ownership, size, coordinates, trade-route reciprocity, and city
  references;
- unit ownership, health, movement, home-city references, and transport
  reciprocity;
- diplomatic state symmetry and treaty-duration consistency; and
- research bookkeeping and invalid technology targets.

Scenario expectations extend this with multi-turn gameplay assertions. Existing
examples cover war declarations, diplomacy state, research setup, city founding,
and victory, but most are currently smoke fixtures. Evolve them toward progress
over turn windows, ordered strategic milestones, adaptation after changing
state, and outcomes that require coordination between planners and authoritative
systems.

## What still needs targeted coverage

Structural invariants do not establish that the AI made useful progress, adapted
to prior outcomes, or coordinated several plans. Add gameplay scenarios for:

- early expansion, tile improvement, production, and research progress;
- sustained military campaigns, defense, loss replacement, and replanning;
- ferry production, rendezvous, embarkation, and overseas follow-through;
- economic and government adaptation under changing pressure;
- diplomacy that evolves with contact, relative power, incidents, and war;
- prerequisite planning and progress toward enabled victory conditions;
- recovery from invalidated worker, settler, military, trade, and ferry plans;
  and
- long-run stagnation, deadlock, and seed-dependent strategic quality.

Use minimal fixtures for focused mechanics regressions. For gameplay
simulations, preserve enough natural setup and turn history for the AI to
observe results and change subsequent decisions.
