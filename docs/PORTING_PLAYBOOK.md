# CivJS Porting Playbook

**Status:** Milestones 0–11 complete; Milestones 12–15 define the remaining
classic-port closure work identified by the post-Milestone 8 audit
**Baseline:** [`PORT_STATUS.md`](PORT_STATUS.md)  
**Goal:** a playable, testable TypeScript port of the Freeciv classic ruleset with a freeciv-web-compatible 2D client experience.

## What “full port” means

The objective is behavioral compatibility for the agreed ruleset and client flow, not a literal line-for-line rewrite of Freeciv’s C server or every upstream deployment feature. A feature is port-complete only when:

1. Its server rule behavior is traced to `reference/freeciv/`.
2. Its client interaction, rendering, and packets are traced to `reference/freeciv-web/` where applicable.
3. It has automated coverage for the important rules and packet/state transitions.
4. It works in a real client-server game flow.
5. The implementation records the source file and line range it ports.

Unagreed scope—additional rulesets, metaserver support, or upstream AI implementations—must be recorded as an explicit decision before it is called part of the full port.

## Non-negotiable workflow

For every feature:

1. Create a short feature brief in the issue or PR: player behavior, server rules, client behavior, packets, persistence, and acceptance cases.
2. Locate the reference behavior before writing TypeScript. Typical sources are:
   - Rules and shared mechanics: `reference/freeciv/common/`.
   - Server authority and turn handling: `reference/freeciv/server/`.
   - Packet definitions: `reference/freeciv/common/networking/packets.def` and `reference/freeciv-web/javascript/packets.js`.
   - Client state and interaction: `reference/freeciv-web/javascript/packhand.js`, `city.js`, `unit.js`, and `map.js`.
   - 2D rendering and controls: `reference/freeciv-web/javascript/2dcanvas/`.
3. Port the smallest vertical slice: data/rules → authoritative server action → packet → client state → visible UI.
4. Add unit tests for calculations and integration tests for the server action and packets.
5. Exercise the feature manually in a local game and record the result in the PR.
6. Update `PORT_STATUS.md` only after the change is merged and verified.

Do not fill gaps with invented game rules. When a reference cannot be reused, document why and obtain approval before choosing a CivJS-specific behavior.

## Delivery order

Each milestone is complete only when its acceptance criteria are met. Work items within a milestone should be delivered as small vertical slices, not one large subsystem rewrite.

### Milestone 0 — Establish a reliable porting baseline — complete (2026-07-25)

**Outcome:** contributors can tell what is implemented, partial, and unverified.

- Maintain `PORT_STATUS.md` as the single status source.
- Create a packet inventory: Freeciv/freeciv-web packet name, CivJS server handler, shared type, client consumer, and test.
- Create a ruleset inventory for classic data: units, buildings, technologies, governments, terrain, extras, effects, and requirements.
- Add a repeatable local-game smoke test covering connection, game creation, join, map load, one turn, and reload.

**Exit criteria:** every new port PR has source citations and a packet/ruleset impact assessment.

**Completion evidence:** [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md)
contains the current classic-data and transport catalogues;
`GameFlow.integration.test.ts` and `SocketGameFlow.integration.test.ts` cover
the manager/database and real Socket.IO flows respectively; and
`.github/pull_request_template.md` makes source and impact evidence a required
review item for new porting changes.

### Milestone 1 — Core playable loop — complete (2026-07-26)

**Outcome:** a player can start a game and play several turns without manual database repair.

- Verify nation selection, game start, map delivery, and initial unit/city setup.
- Complete authoritative unit movement, combat, founding, production selection, research selection, and turn completion.
- Verify turn phases, visibility updates, borders, culture, and reconnect/load behavior together.
- Close placeholder or stubbed branches that affect this loop before adding new mechanics.

**Primary references:** `server/gamehand.c`, `server/unittools.c`, `server/cityturn.c`, `common/unit.c`, `common/city.c`, and freeciv-web `game.js`, `unit.js`, and `city.js`.

**Exit criteria:** a two-player classic game can be created, played for 20 turns, reconnected, and continued with deterministic server state.

**Completion evidence:**
`apps/server/tests/integration/SocketGameFlow.integration.test.ts` exercises
the two-player flow through Socket.IO: nation selection, map delivery,
movement, combat, city founding, production, research, 20 turn completions,
server-memory recovery from PostgreSQL, reconnect, and one further completed
turn with the recovered city intact. Player-specific map, unit, city, and
border broadcasts are also covered by the server and client test suites.

### Milestone 2 — Ruleset and effects fidelity — complete (2026-07-26)

**Outcome:** classic ruleset data drives gameplay instead of TypeScript-specific approximations.

**Completed work:** ruleset effects now evaluate classic requirement kinds from
live gameplay context and fail closed when context or evaluators are missing.
The runtime loads classic technology, building, unit, terrain, economy, city,
vision, and combat data; production, happiness, visibility, and fortification
use that shared data for new and recovered games. Validation and mutation tests
cover malformed definitions, cross-domain data changes, and singleton safety.
Unported capture/incite and visible-wall effects remain inactive until their
action-flow and client-rendering support exists.

**Primary references:** `reference/freeciv/data/classic/`, `common/effects.*`, `common/requirements.*`, and `common/unittype.*`.

**Exit criteria:** representative ruleset changes alter the game through data loading and tests catch invalid or unsupported definitions.

**Completion evidence:** `RulesetLoader.validation.test.ts`,
`RulesetLoader.effects.test.ts`, `RulesetMutation.test.ts`,
`MovementConstants.test.ts`, `RulesetUnitsService.test.ts`,
`CityCorruption.effects.test.ts`, `CityHappiness.effects.test.ts`,
`CitySpecialists.effects.test.ts`, `CityRulesetValues.test.ts`,
`CityInitialBuildings.test.ts`, `UnitManager.test.ts`, and
`VisibilityManager.test.ts`.

### Milestone 3 — City, economy, and worker mechanics — complete (2026-07-26)

**Outcome:** cities behave as the strategic and economic center of the game.

**Progress (2026-07-26):** production turns, rush buying, client progress, and
database persistence now share `productionStock` as their authoritative shield
store. Building and unit completion subtract only the completed target's cost
and retain overflow for the next target, matching Freeciv's city-turn behavior.
Rush costs use the classic improvement and unit formulas, including the
zero-stock premium. `CityProductionLifecycle.test.ts` covers normal completion,
carryover, rush pricing, and the buy-to-turn-processing handoff.
City output accounting also uses a single authoritative path: center minimums
apply only to the center tile, food support is deducted after gross output,
specialists receive output bonuses, corruption is deducted once, and player
tax rates use Freeciv's largest-remainder distribution. Economic recovery
restores persisted treasury/rates, building upkeep is charged during the turn,
and calculated city resources persist across reloads. Trade routes, governor
automation, citizen parameters, and home-city unit support are integrated into
that turn/recovery path. Ruleset-duration worker activities persist their
progress, mutate the authoritative map on completion, and immediately affect
worked-tile output. Pollution placement and cleanup use that same map state.

**Completion evidence:** `CityProductionLifecycle.test.ts`,
`CityOutputPipeline.test.ts`, `CityTradeRouteService.test.ts`,
`CityRulesetValues.test.ts`, `CityManager.test.ts`, `UnitManager.test.ts`,
`TradeDistribution.test.ts`, and `TurnProcessingService.research.test.ts`.

- Complete tile yields, worked tiles, specialists, happiness, food, shields, trade, waste, and upkeep.
- Complete production carryover, buying, building/unit completion, and city growth/starvation.
- Integrate trade routes, governors, and citizen automation end-to-end; do not count service classes alone as completion.
- Port worker activities, roads, irrigation, mines, pollution, and terrain transformations with map updates.

**Primary references:** `server/cityturn.c`, `server/citytools.c`, `common/city.*`, `common/aicore/citymap.*`, and freeciv-web `city.js`.

**Exit criteria:** city outputs and production results are reproducible from fixtures, displayed in the client, and persist across reloads.

### Milestone 4 — Map, units, and action completeness — complete (2026-07-26)

**Outcome:** map rules and unit actions match the selected ruleset’s playable mechanics.

- Complete terrain constraints, movement costs, transport, stacking, zones of control, and unit support.
- Port action legality and outcomes for diplomacy, founding, combat, capture, sabotage, and special actions in priority order.
- Complete extras/improvements and their visibility, ownership, and rendering behavior.
- Compare map generation and topology invariants against seeded reference cases.

**Primary references:** `server/maphand.c`, `server/unithand.c`, `server/unittools.c`, `common/map.*`, `common/unit.*`, and freeciv-web `map.js`/`unit.js`.

**Exit criteria:** every exposed action has server-side validation, an error/result packet, client feedback, and rule tests.

**Completion evidence:** classic movement fragments, native terrain, minimum
movement, roads/railroads, stacking, ZOC, ruleset transports, capture, and
fortification are exercised by `MovementConstants.test.ts`,
`PathfindingManager.test.ts`, `UnitManager.test.ts`, and
`CityCaptureService.test.ts`. Combat uses classic attack-versus-defense rounds,
terrain defense, hit points, firepower, and field killstack behavior; capture
applies classic population, building-genus, and trade-route consequences. The generic action
surface has an automated executor/delegation invariant in
`ActionSystem.goto.test.ts`; dedicated movement/combat packets remain outside
that generic catalogue, and unsupported diplomacy/sabotage actions are not
exposed. `GameBroadcastManager.test.ts` covers canonical visibility-scoped unit
updates, extras, and ownership; `GameClient.actions.test.ts` covers packet
application and authoritative action feedback; the client renders the
corresponding classic sprites; and `MapManager.test.ts` pins the topology
summary of a named seed.

### Milestone 5 — Client parity for core play — complete (2026-07-26)

**Outcome:** no core server feature requires a developer tool or missing UI to use.

- Complete city, research, government, unit, and game-option screens needed for the playable loop.
- Port map controls, selection/focus, goto previews, notifications, dialogs, and status information.
- Render terrain, cities, units, borders, fog, extras, and animations with asset/ruleset compatibility.
- Maintain a client packet/state test suite for every supported server packet.

**Primary references:** freeciv-web `packhand.js`, `packets.js`, `2dcanvas/mapview.js`, `2dcanvas/mapctrl.js`, `city.js`, `government.js`, and `diplomacy.js`.

**Exit criteria:** a player can discover and use all Milestones 1–4 features from the client without console commands.

**Completion evidence:** `GameClient.state-packets.test.ts`,
`GameClient.management.test.ts`, `GameClient.actions.test.ts`,
`UnitContextMenu.test.tsx`, both production type checks, and both production
builds.

### Milestone 6 — Diplomacy, AI, and multiplayer robustness — complete (2026-07-26)

**Outcome:** games remain valid with multiple humans and non-human participants.

- Port diplomatic states, meetings, treaties, embassies, shared vision, and related actions/UI.
- Decide whether to port Freeciv AI behavior or introduce a documented CivJS AI adapter; implement the decision behind the same authoritative action APIs as humans.
- Add simultaneous-turn/timeout policy, reconnection rules, spectator behavior, and host controls.
- Test packet ordering, duplicate requests, disconnects, reloads, and race conditions.

**Exit criteria:** a multi-player game handles normal disconnect/reconnect and turn-timeout scenarios without corrupting state.

**Completion evidence:** `DiplomacyManager.test.ts`,
`CivJSAIAdapter.test.ts`, `GameManager.turns.test.ts`,
`PacketHandler.ordering.test.ts`, `SocketCoordinator.test.ts`, and
`UnitActionHandler.test.ts`.

### Milestone 7 — End game, saves, and release quality — complete (2026-07-26)

**Outcome:** complete games can finish, be resumed, and be diagnosed.

- Port victory conditions, scoring, game reports, and end-game client flow.
- Verify save/load compatibility for every persisted rule entity; provide migrations and recovery tests.
- Add replay/audit data only after the live game state is reliable.
- Complete accessibility, settings, sound, and visual polish after functional parity is stable.
- Run performance and soak tests on maps and player counts chosen for the release target.

**Exit criteria:** a full game can be played to a supported victory condition, saved/reloaded repeatedly, and deployed with monitoring and recovery procedures.

### Milestone 8 — Classic espionage action completion — complete (2026-07-26)

**Outcome:** every remaining covert action enabled by the classic ruleset is
discoverable and resolved by the authoritative game state.

- Add poison city, bribe unit, sabotage unit, and incite city to the
  server-advertised diplomat/spy capabilities and client map-target flow.
- Enforce classic adjacency, movement, actor, target, diplomatic-state,
  Democracy, capital, city-size, city-center, stack, and `Unbribable`
  requirements on the server.
- Drive bribe and incite prices from classic ruleset parameters and persist
  treasury, unit ownership/health, city population/ownership, production, and
  nearby supported-unit defections.
- Keep plague, suitcase-nuke, gold-theft, and map-theft actions unadvertised:
  they exist in Freeciv's generic action catalogue but have no classic action
  enablers.

**Primary references:** `server/diplomats.c`, `server/cityturn.c`,
`common/unit.c`, classic `actions.ruleset`/`game.ruleset`, and freeciv-web
`action_dialog.js`.

**Exit criteria:** a player can select every classic covert action from a
diplomat or spy, receive authoritative validation/feedback, and recover its
persisted city, unit, and treasury result.

**Completion evidence:** `GameManager.espionage.test.ts`,
`UnitActionHandler.test.ts`, `UnitManager.test.ts`, `CityManager.test.ts`, and
`UnitContextMenu.espionage.test.tsx`.

### Milestone 9 — Ruleset authority and requirement completeness — complete (2026-07-26)

**Outcome:** the complete classic ruleset surface used by CivJS is represented
as validated data instead of being maintained through manual mappings or
TypeScript assumptions.

- Add validated representations for classic extras, action enablers, and
  styles, with cross-file reference checks and source provenance.
- Extend requirement loading and evaluation to action and entity requirements,
  including range, negation, and context behavior used by the classic data.
- Audit every classic effect and requirement against an authoritative runtime
  consumer; keep unsupported contexts fail-closed and identify them in fixture
  evidence rather than silently ignoring them.
- Replace the manually maintained action-enabler mapping and terrain-derived
  extras assumptions with loaded ruleset authority.
- Add mutation and rejection fixtures proving that extras, action enablers,
  styles, requirements, and their referenced entities affect the appropriate
  server or client behavior.

**Primary references:** `data/classic/actions.ruleset`,
`data/classic/terrain.ruleset`, `data/classic/styles.ruleset`,
`common/requirements.*`, `common/effects.*`, and `common/actions.*`.

**Exit criteria:** every classic ruleset domain is parsed and schema-validated;
every loaded requirement/effect used by the supported game has a tested
consumer; and changing an extra, action enabler, or style fixture changes
observable behavior without a TypeScript constant edit.

**Completion evidence:** `tools/convert-classic-rulesets.mjs` reproducibly
converts the upstream secfiles into source-attributed JSON containing all 82
classic action enablers, 34 extras, 20 resources, 6 nation styles, 10 city
styles, and 11 music styles. `RulesetLoader` schema-validates those catalogues
and rejects unresolved action, extra, and style references.
`RulesetRequirementEvaluator` handles every universal requirement kind present
in the converted data with range-aware, negation-aware, fail-closed behavior.
Loaded enablers now determine diplomat/spy capability advertisement, loaded
styles feed the city-style API, and loaded extra/terrain settings determine
railroad construction and pollution cleanup time. Evidence includes
`RulesetLoader.validation.test.ts`, `RulesetMutation.test.ts`,
`RulesetRequirementEvaluator.test.ts`, `UnitManager.test.ts`, and
`GameBroadcastManager.test.ts`.

### Milestone 10 — Canonical protocol and transport convergence

**Outcome:** client and server share one versioned gameplay contract, and each
supported operation has one canonical transport path.

- Create a shared packet-contract module covering identifier, direction,
  schema, handler, consumer, protocol version, and upstream mapping.
- Reconcile the separate client/server `PacketType` enums and prevent numeric
  drift with a contract test; do not renumber deployed traffic without a
  compatibility version.
- Migrate named Socket.IO families to structured request/reply packets one
  vertical slice at a time, retaining thin compatibility adapters only for a
  documented transition window.
- Resolve duplicate or unused paths such as city production and the caller-less
  tile-visibility request; remove dead declarations after consumers migrate.
- Test malformed input, authorization, authoritative mutation, reply/error
  behavior, packet ordering, and client state application for every migrated
  family.

**Primary references:** `common/networking/packets.def`, freeciv-web
`packets.js` and `packhand.js`, the shared CivJS packet types, and the active
named-event inventory in [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md).

**Exit criteria:** no shared packet name has different client/server IDs; every
active gameplay transport appears once in the canonical contract; and named
events that remain are explicitly classified as Socket.IO lifecycle or
versioned compatibility adapters.

**Completion evidence:** `packetContract.ts` is the single protocol-v1 source
for client and server identifiers and records each active envelope and named
event. Packet envelopes carry a version, reject unsupported versions, and are
protected against identifier drift by `PacketContract.test.ts`. City
production now uses its authoritative structured request/reply path while the
named event remains a documented compatibility adapter. Tile visibility now
has a matching client caller plus validation, authorization, success, and
error coverage in `MapVisibilityHandler.test.ts` and
`GameClient.protocol.test.ts`.

### Milestone 11 — Remaining classic unit actions and automation

**Outcome:** the previously identified bombardment, paradrop, airlift, and
automation families are discoverable and use authoritative legality, result,
visibility, and persistence paths; the full enabler inventory no longer hides
unimplemented outcomes.

- Re-audit `actions.ruleset` enablers against the executable action catalogue
  after Milestone 9 replaces the manual mapping.
- Implement the currently unadvertised classic-capable families: bombardment,
  paradrop, airlift, and applicable unit or worker automation.
- Drive actor, target, range, terrain, technology, building, movement, and
  diplomatic legality from loaded requirements rather than UI assumptions.
- Add client controls and target flows, scoped result packets, recovery
  coverage, AI-accessible commands, and reference-scenario tests for each
  enabled action.
- Continue to exclude plague, suitcase-nuke, and direct gold/map theft unless a
  selected ruleset actually enables them.

**Primary references:** classic `actions.ruleset`, `server/unithand.c`,
`server/unittools.c`, `server/actiontools.c`, `common/actions.*`, and
freeciv-web `unit.js` and `action_dialog.js`.

**Exit criteria:** an automated inventory test accounts for every classic
action enabler as implemented, engine-resolved, scheduled, or inapplicable,
and every Milestone 11 action is usable from the client with authoritative
feedback and reload-safe state.

**Completion evidence:** `ClassicActionInventory.test.ts` accounts for all 82
enablers and 64 distinct upstream action names. Ruleset capabilities advertise
paradrop, airlift, and applicable explore/settler automation; classic
bombardment remains hidden because no classic unit defines `bombard_rate`,
while the generic result is available to a capable ruleset. `UnitManager.test.ts`
covers range, source, contested landing, persisted airport usage, non-lethal
bombardment, automated orders, and recovery. `UnitActionHandler.test.ts` proves
affected units use visibility-scoped updates, and
`UnitContextMenu.specialActions.test.tsx` covers the client controls.

### Milestone 12 — Client style fidelity and browser-level parity

**Outcome:** loaded classic style data and the supported gameplay surface are
verified in a real browser rather than only through reducers and component
tests.

- Consume the Milestone 9 style catalogue for nation, city, unit, terrain, and
  extra presentation; remove remaining duplicated style assumptions.
- Audit the 2D renderer and interaction flows against freeciv-web for all
  supported terrain, extras, ownership, visibility, selection, target modes,
  dialogs, notifications, and responsive controls.
- Add browser automation for game creation, two-player join, map load,
  movement, combat, city founding and management, research, government,
  diplomacy, worker actions, espionage, reconnect, and end-game review.
- Add deterministic screenshots or semantic assertions for fog, borders,
  extras, cities, units, action availability, and reduced-motion behavior.
- Make the browser suite repeatable locally and in CI with documented fixture
  setup and failure artifacts.

**Primary references:** `data/classic/styles.ruleset` and freeciv-web
`2dcanvas/`, `map.js`, `unit.js`, `city.js`, `government.js`, and
`diplomacy.js`.

**Exit criteria:** every supported player-visible feature has a browser-level
happy path and validation/error path, and representative classic style changes
are visible without a client code change.

### Milestone 13 — AI depth and release-verification closure

**Outcome:** the remaining intentional AI deviation is bounded by explicit
compatibility scenarios, and all release evidence runs in an automated,
reproducible environment.

- Define the supported AI behavior target: either deepen `CivJSAIAdapter`
  against selected upstream default-AI decisions or record a narrower
  CivJS-specific contract with explicit non-parity cases.
- Add deterministic scenarios for expansion, economy, research, production,
  worker use, combat, diplomacy, action use, recovery, and game completion.
- Provision an isolated PostgreSQL service for local and CI integration tests;
  run all database-backed suites rather than treating missing
  `TEST_DATABASE_URL` as verification.
- Exercise restart recovery and the Milestone 12 browser flow together, then
  repeat the supported full-game soak at the release map/player limits.
- Refresh the inventories and `PORT_STATUS.md` from the resulting evidence,
  removing resolved risks and recording any approved compatibility deviations.

**Primary references:** Freeciv `ai/default/`, the documented
`CivJSAIAdapter`, the integration suites, and
[`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md).

**Exit criteria:** the chosen AI contract passes deterministic reference
scenarios; every unit, integration, browser, recovery, and soak suite runs in
CI; and no release claim depends on an unavailable external test service.

### Milestone 14 — Enabled city, caravan, worker, and unit-management actions

**Outcome:** the enabled classic outcomes exposed by the Milestone 11 inventory
for caravans, cities, workers, and unit management are authoritative and
player-usable.

- Implement marketplace and help-wonder caravan outcomes.
- Implement join-city, home-city reassignment, upgrades, and shield-recovery
  disbanding.
- Implement cultivate, plant, fortress, and airbase construction from loaded
  terrain and extra requirements.
- Add capability discovery, client target flows, persistence, AI commands, and
  reference scenarios for each family.

**Exit criteria:** every Milestone 14 entry in `CLASSIC_ACTION_COVERAGE` moves
from `scheduled` to `implemented` or an evidence-backed `inapplicable` state.

### Milestone 15 — Enabled combat consequences, huts, and extras

**Outcome:** remaining classic action consequences are no longer approximated
by ordinary movement or combat.

- Implement regular nuclear explosion, city/stack damage, fallout, and actor
  consumption; this is distinct from the intentionally excluded spy
  suitcase-nuke outcome.
- Implement collect-ransom and suicide-attack consequences.
- Implement hut entry/frighten results and extras conquest.
- Implement the classic civil-war consequence or document an approved
  compatibility deviation.

**Exit criteria:** the executable inventory has no `scheduled` classic
enablers, with deterministic result, visibility, recovery, and client evidence
for each added family.

## Testing strategy

| Layer         | Required evidence                                                              |
| ------------- | ------------------------------------------------------------------------------ |
| Rules         | Fixture tests for values, requirements, and effects.                           |
| Server        | Unit tests for calculations; integration tests for action → state → packets.   |
| Client        | Reducer/store and component tests for packet-driven state and player controls. |
| End-to-end    | Local two-player smoke test for each milestone.                                |
| Compatibility | A reference scenario or fixture with expected observable outcomes.             |

Run `npm run format:check`, `npm run lint`, `npm run test:unit`, and `npm run typecheck` before committing. If an existing repository failure blocks a check, record the exact failure in the PR rather than hiding it.

## Operating cadence

- Keep one milestone in progress; do not start a later milestone unless it unblocks the current one.
- Limit each PR to one player-visible behavior or one tightly coupled ruleset slice.
- Review the status document after each merged feature and perform a broader parity audit at each milestone exit.
- Maintain a decision log in issues for intentional deviations from Freeciv or freeciv-web.

## Scope after Milestone 15

Milestones 9–15 close the confirmed classic/freeciv-web gaps in the current
inventory. They do not expand the target to every generic Freeciv feature.
Plague, suitcase-nuke, and direct gold/map theft remain out of scope because
the classic ruleset has no enablers for them.

After Milestone 15, adding another Freeciv ruleset or claiming broader
default-AI parity requires a new explicit scope decision, inventory, and
compatibility baseline.
