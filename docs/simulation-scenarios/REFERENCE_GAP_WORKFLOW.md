# Reference-gap workflow

The simulator is most useful as a small, deterministic test harness around
one gameplay question. Use a custom scenario setup to put the game into the
state needed for that question, then combine automatic invariants with
explicit expectations.

## Investigation loop

1. Choose the reference subsystem and write down the behavior to verify. Start
   with the relevant Freeciv server code under `reference/freeciv/server/` and
   record its path and line range in the scenario or test documentation.
2. Classify the expected behavior:
   - State legality: an always-on simulator invariant should detect it.
   - A transition or event: add a scenario expectation, such as a war
     declaration or a city founding event.
   - AI decision parity: seed only the minimum state needed to reach the
     decision, then compare replay events and diagnostics across runs.
   - Strategic quality or balance: use a scenario matrix and inspect trends;
     this cannot be proven by a structural invariant alone.
3. Create or extend a JSON scenario under
   `docs/simulation-scenarios/`. Use `scenarioSetup` for custom players,
   cities, units, diplomacy, research, and AI memory. Keep the seed and
   `maxTurns` explicit.
4. Add `expect` rules for the observable result. Prefer an event expectation
   when the question is about an action, and a final-state expectation when
   it is about the resulting state.
5. Run the scenario and inspect `run.json`, especially replay checkpoints,
   `diagnostics.invariants`, `diagnostics.expectations`, diplomacy events,
   state hashes, and AI decision records.
6. Repeat with a small seed matrix. A single deterministic run proves that a
   setup is reproducible; several seeds help distinguish a code defect from
   an overly specific fixture.
7. Turn a confirmed gap into a focused regression test and document whether
   the fix follows the reference behavior or intentionally differs.

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

Scenario expectations extend this with gameplay assertions. Existing examples
cover war declarations, diplomacy state, research setup, city founding, and
victory. The same pattern can be used for peace treaties, alliances, trade,
unit transport, combat outcomes, production, growth, technology completion,
and endgame conditions as those replay events or state fields are exposed.

## What still needs targeted coverage

Structural invariants do not establish that the AI made the best decision or
that every reference rule is implemented. Add targeted scenarios for:

- action legality and turn transitions that are not represented by a stored
  state invariant;
- combat resolution and survival, including terrain and transport edge cases;
- production, food, trade, happiness, corruption, and research-rate changes;
- diplomacy proposals, acceptance/rejection, treaty expiry, and trade;
- city placement, borders, movement, and visibility interactions; and
- victory precedence and simultaneous endgame conditions.

For each gap, prefer a minimal fixture with one clear expected outcome. Keep a
broader multi-turn scenario as a smoke or regression suite after the focused
case is reliable.
