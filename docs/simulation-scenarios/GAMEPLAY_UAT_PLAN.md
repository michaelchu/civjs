# Gameplay UAT plan for the headless simulator

This document defines the gameplay acceptance tests we should run against the
headless simulator. It is intended to answer two questions for each case:

1. Does the authoritative game state remain legal and internally consistent?
2. Did the intended gameplay action occur and produce the expected result?

The simulator's automatic invariants answer the first question. Scenario
`expect` rules, replay events, final snapshots, and AI decision records answer
the second.

## UAT pass criteria

A test passes only when all of the following are true:

- the simulator exits successfully;
- `diagnostics.invariants.passed` is `true` and has no violations;
- `diagnostics.expectations.passed` is `true` when the fixture has an
  `expect` block;
- the final `snapshot.eventTelemetry` has zero dropped events, persistence
  failures, pending events, and pending movement summaries; and
- the result is deterministic for a fixed seed when the case is marked
  deterministic.

An event proves that an operation was emitted after the authoritative manager
accepted it. It does not, by itself, prove that the final state is correct;
pair event assertions with a final-state assertion whenever possible.

## Running and inspecting a case

Run a single fixture against an isolated database:

```sh
npm run --silent simulation:run -- \
  --config ../../docs/simulation-scenarios/<fixture>.json \
  --output ../artifacts/uat/<fixture> \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist
```

Inspect the result, expectations, invariants, and telemetry:

```sh
jq '{result, expectations: .diagnostics.expectations,
     invariants: .diagnostics.invariants,
     telemetry: (.replay.turns[-1].snapshot.eventTelemetry // null)}' \
  ../artifacts/uat/<fixture>/run.json
```

Run the checked-in fixture suite with:

```sh
npm run --silent simulation:run:scenarios -- \
  --database-url postgresql://civjs:civjs_secret@127.0.0.1:5432/civjs_test \
  --no-persist \
  --output apps/artifacts/simulation-scenarios \
  --continue-on-error
```

`maxTurns` is an absolute turn cap. If a setup starts at turn 12, a
`maxTurns` value of 20 permits turns 12 through 20; it is not a request for 20
additional turns.

## Priority and execution status

- **P0**: release-blocking correctness or state-corruption risk.
- **P1**: important gameplay behavior that should be covered before calling a
  subsystem reliable.
- **P2**: quality, balance, or long-run regression coverage.

“Ready” means the current simulator can express the setup and assertion with
existing configuration and replay data. “Fixture needed” means the simulator
supports the underlying state or event, but we should add a focused fixture.
“Driver needed” means a deterministic action/proposal API is needed before the
case can be automated reliably.

## P0: release-blocking gameplay cases

### UAT-001 — Deterministic turn lifecycle and replay integrity

- **Status:** Ready; `earth-small-bootstrap.json`.
- **Setup:** Run the bootstrap fixture at its configured initial turn for its
  full cap.
- **Verify:** Every completed turn has the expected phase sequence, turn/year
  progression, stable player identities, and a state hash.
- **Pass:** The run reaches `max_turns`; all invariants pass; no event telemetry
  is lost; repeating the same fixture produces identical `result.stateHashes`.
- **Reference:** `reference/freeciv/server/srv_main.c` turn processing and the
  phase-order notes in `docs/simulation-scenarios/README.md`.

### UAT-002 — Starting positions do not create unfairly close civilizations

- **Status:** Fixture needed; map-aware expectation recommended.
- **Setup:** Run the default starting-unit path across a seed set, for example
  31001–31010. Capture the first replay checkpoint before meaningful movement.
- **Verify:** Each civilization's initial settler/city-start location is on a
  legal tile and meets the configured minimum separation from every other
  civilization's starting location. Check both map distance and actual
  movement topology, including wraparound maps.
- **Pass:** No two players start inside the minimum separation; no starting
  unit overlaps an illegal terrain, city, or another player's unit; the same
  seed reproduces the same positions.
- **Current gap:** The simulator exposes coordinates and invariants, but does
  not yet have a first-class `minStartingDistance` expectation. Until that is
  added, inspect the first snapshot with `jq` and record the measured distances.
- **Reference:** `reference/freeciv/server/srv_main.c:2664-2819`.

### UAT-003 — City founding is legal and produces a persistent city

- **Status:** Ready for basic coverage; `earth-small-city-founding.json`.
- **Setup:** Use default settlers for the baseline; add a focused custom setup
  with a settler on a known legal tile for deterministic coverage.
- **Verify:** A settler can found a city only on a legal tile; the settler is
  consumed or otherwise handled correctly; the city has the expected owner,
  coordinates, size, name, and references.
- **Pass:** At least one `city_founded` event occurs, the final player city
  count increases, no duplicate city coordinates exist, and all city/unit
  invariants pass.
- **Negative cases:** Founding on ocean, an occupied city tile, an illegal
  terrain, or too close to an existing city must be rejected without creating
  a partial city or losing the settler.
- **Reference:** `reference/freeciv/server/citytools.c:639-690` and the city
  sanity checks in `reference/freeciv/server/sanitycheck.c`.

### UAT-004 — Combat resolves atomically and records casualties

- **Status:** Ready for direct combat; `earth-small-combat.json`.
- **Setup:** Place hostile units on adjacent tiles, including a low-health
  defender to make the result deterministic.
- **Verify:** Combat consumes the correct movement, applies damage, removes a
  defeated unit, preserves a surviving unit's legal health, and records the
  combat result.
- **Pass:** `combat_occurred` and `unit_killed` are present; the final unit
  snapshot agrees with the event; no unit has invalid health, movement, owner,
  or transport references.
- **Reference:** `reference/freeciv/server/unittools.c:283-322,1215-1280` and
  `reference/freeciv/server/unithand.c:4535-4555,4992-5357`.

### UAT-005 — Diplomacy state is symmetric and war declarations are real

- **Status:** Ready; `earth-small-war-declaration.json`.
- **Setup:** Start two AI players in peace with high war desire and a zero war
  countdown.
- **Verify:** The AI decision produces a declaration rather than merely a
  seeded relation. Verify the declaration direction, final bilateral state,
  proposal/rejection behavior, and the legality of subsequent movement.
- **Pass:** A `war_declared` event is observed from the expected player, the
  final relation is `war` in both directions, and no diplomacy invariant fails.
- **Reference:** `reference/freeciv/server/diplhand.c:147-330` and
  `reference/freeciv/server/srv_main.c:1385-1388`.

### UAT-006 — Research rates produce legal, attributable progress

- **Status:** Ready; `earth-small-research.json`.
- **Setup:** Give one player a high science rate and near-complete research;
  give the other a lower rate and a different research target.
- **Verify:** Research phases complete, targets remain valid, bulbs progress,
  the expected technology completes, and production/growth continue while
  research runs.
- **Pass:** Research phase events occur for every completed turn; the expected
  `tech_researched` event occurs with `source: "research"`; the fast player
  completes the required technology; no research invariant fails.
- **Reference:** `reference/freeciv/server/techtools.c:650-726`.

## P1: core gameplay acceptance cases

### UAT-007 — City growth and population accounting

- **Status:** Ready for baseline; focused fixture recommended.
- **Setup:** Give a city enough food to grow within a small turn window, then
  repeat with starvation or population-loss conditions.
- **Verify:** Growth changes city size exactly once, carries food correctly,
  and does not create negative population or invalid city references.
- **Pass:** `city_growth` includes the expected `oldSize` and `newSize`; the
  final city population matches the event; starvation/casualty cases never
  produce size below one.
- **Reference:** `reference/freeciv/server/cityturn.c:2784-3062`.

### UAT-008 — Production completes the requested item exactly once

- **Status:** Fixture needed.
- **Setup:** Create focused cities with enough production stock for a unit, a
  building, a wonder, and a spaceship part.
- **Verify:** The requested item completes, the city receives the resulting
  state, the production queue advances, and the telemetry classification is
  correct.
- **Pass:** Each item produces one `city_production_complete`; buildings and
  wonders also produce `city_building_built`; spaceship parts do not produce a
  false building event; units produce `unit_created`.
- **Reference:** `reference/freeciv/server/cityturn.c:2784-3062` and
  `reference/freeciv/common/spaceship.h` and
  `reference/freeciv/server/spacerace.h`.

### UAT-009 — Unit movement, movement points, and aggregation

- **Status:** Ready for telemetry; fixture needed for edge cases.
- **Setup:** Move one unit multiple tiles, move several units for the same
  player, and include a transport/cargo stack.
- **Verify:** Movement respects terrain cost, zones of control, transport
  rules, and remaining movement. Replay telemetry aggregates movement rather
  than writing one durable event per step.
- **Pass:** The final positions and movement points are legal; a
  `unit_movement_summary` contains the expected unit count, move count, origin,
  and final destination; raw `unit_moved` events are absent; telemetry counters
  remain zero.
- **Reference:** `reference/freeciv/server/unithand.c:4535-4555` and
  `reference/freeciv/common/unit.h:264-271`.

### UAT-009a — Terrain improvements, road effects, and resource accounting

- **Status:** Road/resource calculation coverage is ready; the deterministic
  trade/luxury fixture is `earth-small-trade-luxury.json`. Worker activity
  persistence still needs a longer map-edit driver.
- **Setup:** Put a worker on legal tiles containing representative terrain and
  resources. Build a road, upgrade it to a railroad, build irrigation and a
  mine on separate tiles, then test fortress, airbase, transformation,
  pillage, and pollution cleanup where the ruleset permits them. Have a city
  work the improved resource tile before and after each completion.
- **Verify:** Worker activities use the ruleset duration, complete exactly
  once, update the authoritative map extra/road flags, persist through a map
  snapshot/reload, and recalculate the city's worked-tile outputs.
- **Expected accounting:** Irrigation changes food according to the terrain
  rules; a mine changes shields; a road applies the ruleset road-trade bonus to
  a worked tile; a railroad retains the road trade effect and applies the
  railroad shield effect; mutually exclusive improvements replace one another
  correctly; pillage removes the selected infrastructure. For example, in
  `civ2civ3`, a worked tundra tile with Furs has 3 resource trade and a road
  adds one fixed trade, for 4 total; it must not multiply the resource yield.
- **Important semantic check:** In the current Civ2/Freeciv model, a road does
  not create a separate city-to-luxury-resource network. A map resource such
  as Gold, Gems, Wine, or Spice contributes its configured food/shield/trade
  yield when the city works that tile, whether or not the tile is roaded. The
  tile must be inside the city's workable radius and actually worked. “Luxury”
  in the economy is a conversion of trade via the player's luxury rate or
  specialist output, not a road-connected resource inventory.
- **Trade-route distinction:** City trade routes are established by a trader
  between two city IDs and are valued by distance, city size, relation, and
  ruleset settings. The current `CityTradeRouteService` does not require a
  continuous road path, and roads do not automatically create a trade route.
- **Pass:** Map extras and flags are correct after reload; worked-tile outputs
  change by the expected ruleset deltas; resource yields are counted once; no
  roaded tile outside the city radius leaks into city output; and
  `earth-small-trade-luxury.json` confirms that an explicit route produces a
  reciprocal route/event and converts route trade into city luxury at a 100%
  luxury rate. The fixture locks player 1's economic rates so the AI treasury
  controller cannot change the UAT precondition.
- **Reference:** `reference/freeciv/common/terrain.c:660-727`,
  `reference/freeciv/common/traderoutes.c:280-357`, and the worker activity
  paths in `reference/freeciv/server/unittools.c`.

### UAT-010 — Collateral combat and protected stacks

- **Status:** Fixture needed; telemetry support is ready.
- **Setup:** Create an unprotected field stack with a primary defender and at
  least one collateral unit. Repeat in a city, fortress, and airbase.
- **Verify:** Field-stack rules destroy collateral units when the reference
  rules require it; protected stacks preserve collateral units; combat result,
  final units, and kill events agree.
- **Pass:** Every destroyed collateral unit has a `unit_killed` event with
  `role: "collateral"`; protected-stack cases have no collateral kill; no
  orphaned unit or transport references remain.
- **Reference:** `reference/freeciv/server/unittools.c:283-322` and the
  ruleset protection effects used by `reference/freeciv/server/unithand.c`.

### UAT-011 — Transport, cargo, embark, and disembark

- **Status:** Fixture needed.
- **Setup:** Place a transport and legal cargo near a coast; exercise loading,
  movement at sea, unloading, and destruction of a transport with cargo.
- **Verify:** Cargo ownership and `transportedBy`/`cargoUnits` references stay
  reciprocal; cargo cannot move or disembark illegally; destroyed transports
  apply the reference cargo outcome.
- **Pass:** Every checkpoint passes transport reciprocity invariants and the
  final cargo state matches the action result.
- **Reference:** `reference/freeciv/server/unithand.c` transport action paths
  and `reference/freeciv/common/unit.h:264-271`.

### UAT-012 — Trade route establishment, value, and reciprocity

- **Status:** Ready for the deterministic happy path with
  `earth-small-trade-luxury.json`; negative and ownership-change variants are
  still fixture work.
- **Setup:** The fixture places two eligible cities and a caravan with valid
  home-city data directly in the partner city. Repeat with duplicate routes,
  full route capacity, invalid ownership, and a city capture.
- **Verify:** A valid route is established once, both city records reference
  the same route, value/goods are assigned, and invalid or duplicate routes
  are rejected without partial state.
- **Pass:** A `trade_route_established` event has the expected source city,
  partner city, value, turn, and goods; the city expectation confirms one
  reciprocal route, positive trade, and positive luxury conversion; route
  reciprocity remains valid after every turn and after city ownership changes.
- **Reference:** `reference/freeciv/common/traderoutes.c:280-357` and
  `reference/freeciv/server/unithand.c:6059-6415`.

### UAT-013 — City capture and ownership transfer

- **Status:** Fixture needed.
- **Setup:** Put a hostile attacker adjacent to a city with one defender;
  repeat with multiple defenders, buildings, population, trade routes, and a
  capital.
- **Verify:** The city changes owner only after the final legal defender is
  defeated; city ownership, borders, units, buildings, trade routes, and
  population follow the reference rules.
- **Pass:** The final snapshot has one owner, no stale foreign ownership
  references, correct `unit_killed`/combat telemetry, and valid trade-route
  reciprocity.
- **Reference:** `reference/freeciv/server/citytools.c` city transfer paths,
  `reference/freeciv/server/citizenshand.c:386-405`, and
  `reference/freeciv/server/sanitycheck.c`.

### UAT-014 — Diplomacy proposal acceptance and rejection

- **Status:** Driver needed for deterministic coverage.
- **Setup:** Start players with contact and test one treaty at a time:
  ceasefire, peace/armistice, alliance, embassy, shared vision, map, gold,
  technology, and city transfer. Repeat with unmet requirements.
- **Verify:** A proposal has the expected lifecycle (`proposal`, `accepted`,
  `rejected`, or `cancelled`), accepted clauses apply atomically, and rejected
  clauses change no gameplay state.
- **Pass:** Final bilateral relation, embassy/vision flags, player gold,
  technology, city owner, and replay events all agree. A failed clause leaves
  the treaty and both players unchanged.
- **Current gap:** `scenarioSetup.diplomacy` seeds relations but does not
  author a pending treaty. Add a deterministic diplomacy action script or
  scenario command before making this a release gate.
- **Reference:** `reference/freeciv/server/diplhand.c:314-436,450-668`.

### UAT-015 — Diplomacy expiry and alliance visibility

- **Status:** Fixture/driver needed.
- **Setup:** Seed ceasefire and armistice relations with short durations;
  separately seed an alliance and shared vision.
- **Verify:** Timers decrement once per turn, ceasefire/armistice transitions
  occur at the correct boundary, war becomes legal only after expiry, and
  alliance/shared visibility is granted and revoked together.
- **Pass:** Expected `ceasefire_expired` or `armistice_completed` event occurs;
  both relation records agree; visibility does not leak after breakup.
- **Reference:** `reference/freeciv/server/diplhand.c:564-668` and
  `reference/freeciv/server/srv_main.c:1018-1089`.

### UAT-016 — Government change, revolution, and economic rates

- **Status:** Fixture needed; output telemetry should be expanded.
- **Setup:** Seed a government change, revolution duration, tax/luxury/science
  rates, treasury, unit upkeep, and cities with different specialists.
- **Verify:** Revolution lasts the configured number of turns, the government
  changes once, rates sum to the legal total, upkeep and corruption are
  applied, and research/gold/luxury outputs change in the expected direction.
- **Pass:** No negative treasury or invalid rate state; research and city
  outputs match reference-derived expectations within the configured ruleset.
- **Current gap:** The simulator exposes final research and city state but does
  not yet provide all per-turn economic transition assertions. Use replay
  snapshots for now and promote recurring failures into explicit telemetry.

## P1: diplomacy trading and victory cases

### UAT-017 — Technology, gold, city, map, and vision trading

- **Status:** Driver needed; reference capability confirmed.
- **Setup:** Use a diplomacy driver to create one treaty clause at a time. Give
  the giver sufficient gold/technology and make the recipient eligible.
- **Verify:** Gold transfer applies the configured diplomatic cost, technology
  transfer marks the recipient's technology as known, city transfer changes
  ownership, and map/vision clauses update visibility.
- **Pass:** Each accepted clause is reflected in final state and exactly one
  successful diplomacy event; invalid clauses are rejected without mutation.
- **Reference:** `reference/freeciv/server/diplhand.c:181-300,460-558`.

### UAT-018 — Victory-condition matrix

- **Status:** Scenario victory is ready; other conditions need focused fixtures.
- **Cases:**

  - scenario victory: `earth-small-victory.json`;
  - conquest: last opposing civilization defeated;
  - allied victory: all surviving civilizations are allied;
  - world peace: uninterrupted peace lasts the configured number of turns;
  - culture: one player reaches the threshold and required lead;
  - science/spaceship: an eligible spaceship arrives;
  - turn limit: no earlier condition wins before `max_turns`.

- **Pass:** `endReason`, winner list, `isWinner`, standings, and victory
  telemetry identify the correct winner(s); no extra turn runs after the game
  ends.
- **Reference:** `reference/freeciv/server/srv_main.c:369-670` and
  `reference/freeciv/server/srv_main.c:3906-3949`.

### UAT-019 — Victory precedence and simultaneous winners

- **Status:** Fixture needed.
- **Setup:** Construct states where scenario victory, conquest, allied/world
  peace, culture, spaceship arrival, and turn limit become true on the same
  turn or adjacent turns.
- **Verify:** The simulator follows the reference check order, reports all
  valid winners where the rules allow ties, and does not overwrite a winner
  with a lower-priority condition.
- **Pass:** The reported `endReason` and winner IDs match the reference order;
  the final checkpoint is stable and no events are emitted after completion.

## P2: resilience, determinism, and quality

### UAT-020 — Long-run stability and telemetry pressure

- **Status:** Ready as a harness; long-run fixture needed.
- **Setup:** Run 100, 500, and 1,000 turns with at least four players, active
  movement, production, research, diplomacy, and combat.
- **Verify:** Runtime remains bounded, event persistence remains batched,
  movement summaries prevent unbounded event growth, and checkpoints remain
  readable.
- **Pass:** No timeout, process crash, invariant violation, or telemetry loss;
  `droppedEvents`, `persistenceFailures`, `pendingEvents`, and
  `pendingMovementSummaries` remain zero at the final checkpoint.

### UAT-021 — Seed matrix and replay reproducibility

- **Status:** Ready; matrix runner should be extended with a comparison mode.
- **Setup:** Run each deterministic fixture across at least ten seeds and run
  each seed twice.
- **Verify:** The same seed produces identical state hashes and expected event
  types. Different seeds may produce different strategic outcomes, but must
  preserve legality and invariant success.
- **Pass:** No seed-specific invariant failures; repeated runs have identical
  hashes; any changed outcome is explained by the seed rather than an unstable
  source of randomness.

### UAT-022 — Failure visibility and retry behavior

- **Status:** Ready at service level; simulator fault injection recommended.
- **Setup:** Inject a database failure, event-handler failure, and event queue
  pressure during a run.
- **Verify:** Failed events are retried up to the configured limit, losses are
  reported, and the simulator does not claim a clean run when telemetry was
  dropped.
- **Pass:** The run either recovers with zero final telemetry counters or fails
  with an actionable diagnostic identifying the failure type and affected
  turn/event.

## Recommended implementation order

1. Add UAT-002's map-distance expectation because starting placement affects
   every later gameplay test.
2. Add focused production, collateral, transport, trade-route, and city
   capture fixtures.
3. Add a deterministic diplomacy action driver for treaty acceptance,
   rejection, expiry, and clause trading.
4. Add victory-condition fixtures and an explicit precedence test.
5. Add a long-run seed matrix and fault-injection mode to the scenario runner.

## UAT execution record

For each run, record:

```text
Case ID:
Fixture / commit:
Seed(s):
Ruleset:
Turns completed:
Observed end reason:
Winner(s):
Expectation result:
Invariant result:
Telemetry counters:
Unexpected warnings/errors:
Result: PASS / FAIL / BLOCKED
Evidence: path to run.json and relevant jq output
```

The reference-gap workflow in
[`REFERENCE_GAP_WORKFLOW.md`](./REFERENCE_GAP_WORKFLOW.md) describes how to
turn a failed UAT case into a minimal parity fixture, a focused regression
test, and a documented implementation decision.
