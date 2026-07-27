# CivJS Port Status

**Verified against:** Milestone 10 working tree (2026-07-26)
**Verification method:** source-tree audit, 860 passing unit tests (55 client,
805 server), and passing formatting, lint, production type checks, and
production builds. Database-backed integration remains separately dependent on
the configured PostgreSQL test service.

**External verification blocker (2026-07-26):** `npm run test:integration` was
attempted, but all 13 suites stopped in shared setup because neither
`TEST_DATABASE_URL` nor a local PostgreSQL test database was available. No
database-backed integration assertion ran, so none failed.

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

At the Milestone 2 boundary, effects requiring later action and rendering
systems remained deliberately inert. The later milestone sections below record
their current player-facing status; this completion claim remains limited to
the Milestone 1 playable loop.

## Milestone 3 — complete

Normal turn production, rush buying, completion, client progress, and
persistence use one shield stock. Completion retains overflow, and classic
unit/building rush premiums are covered by `CityProductionLifecycle.test.ts`.
Tile output is now gross until the city calculation applies food support;
player tax rates use Freeciv's largest-remainder distribution; specialist
output receives building bonuses; city trade, gold, luxury, science, pollution,
and food surplus persist; recovered games restore treasury and rates; and turn
economics charges ruleset building upkeep without double-counting research.
`CityOutputPipeline.test.ts`, `TradeDistribution.test.ts`, and
`TurnProcessingService.research.test.ts` cover these paths.

Trade routes now use classic distance, size, international, and
intercontinental factors; create reciprocal capacity-limited routes through
the caravan action; contribute to city output; and survive recovery. Governor
configuration and citizen parameters persist, and enabled governors execute in
the city-turn pipeline. Home-city unit support deducts ruleset food, shield,
and gold upkeep.

Ruleset terrain data drives multi-turn road, railroad, irrigation, mining,
pillage, cleanup, and transformation activities. Completion mutates and
persists the authoritative map, worked-tile output is recalculated from that
map, and pollution can be placed and cleaned. The client exposes these
activities for all classic worker-capable units. Evidence includes
`CityTradeRouteService.test.ts`, `CityManager.test.ts`,
`CityOutputPipeline.test.ts`, `CityRulesetValues.test.ts`, and
`UnitManager.test.ts`.

## Milestone 4 — complete

Classic movement now uses equal orthogonal/diagonal fragment costs, terrain
class legality, the minimum-move rule, road and railroad integration, and
ruleset unit flags such as `IgTer`, `IgZOC`, `HasNoZOC`, and class ZOC.
Friendly units can stack; hostile ZOC blocks applicable land movement; and
goto orders execute through the same authoritative single-step movement path.

Ruleset cargo classes and capacities drive loading, unloading, embarkation,
transport movement, persistence, and destruction. Combat resolves classic
attack-versus-defense rounds using hit points, firepower, veteran status,
terrain defense, fortification, city effects, and protected-versus-vulnerable
stack death. Eligible military units
capture undefended enemy cities through the authoritative ownership path,
including classic one-population loss, improvement razing by genus, size-one
city destruction, and reciprocal trade-route cleanup or recalculation.
Fortify eligibility likewise comes from unit-class and unit-type flags.

The generic action catalogue now exposes only actions with an authoritative
execution route. Move and attack remain dedicated packet flows; unported
diplomacy and sabotage actions are not advertised as playable. Load/unload,
skip, disband, founding, goto, trade, fortify/sentry/wait, and worker actions
all route through server validation and result handling. This action-surface
invariant is covered by `ActionSystem.goto.test.ts`. Incremental unit packets
use the same canonical shape as initial state and are visibility-scoped; the
client applies them and presents authoritative success or validation feedback.

Map packets visibility-scope roads, railroads, irrigation, mines, pollution,
city ownership, and claimers. The client stores and renders those extras using
the bundled Freeciv sprites. `GameBroadcastManager.test.ts` verifies that
visible recipients receive the dynamic state while explored-but-hidden
recipients do not. `MapManager.test.ts` pins a named seeded topology fixture,
including terrain distribution, landmass count, and edge terrain.

## Milestone 5 — complete

The playable Milestones 1–4 surface is now available through client controls.
The Cities screen exposes production, output, happiness, supported units,
governor configuration, manual citizen optimization, and rush buying. The
Options screen exposes persisted tax/luxury/science allocation. Research
selection, goals, lists, and progress use authoritative request/reply packets
instead of local-only state.

The Government screen loads classic ruleset definitions and availability from
the live game. Revolution requests are validated against researched
technologies, persisted, restored after restart, advanced during turn
processing, and refresh affected city effects. Unit menus use server-supplied
capabilities for founding, fortifying, worker activities, pillage, and trade;
trade routes have map targeting and all actions show server feedback.
Unsupported production-queue controls are hidden rather than acting as no-ops.

Map play includes selection/focus, keyboard movement, pan/drag and touch
controls, goto previews, cancelable target modes, visible notifications,
terrain/city/unit/border/fog/extra rendering, and short interpolated unit
movement. City and nation style data is loaded from the server ruleset API
rather than duplicated in the client. Client packet/state tests cover map,
tile, border, player, city,
unit, turn, research, management, and notification state paths. Diplomacy and
foreign-nation intelligence remain explicitly deferred to Milestone 6.

Evidence also includes `MovementConstants.test.ts`, `UnitManager.test.ts`,
`PathfindingManager.test.ts`, the server and client unit suites, both
production type checks, and both production builds.

## Milestone 6 — complete

Diplomacy is persisted as bilateral authoritative state. Contact, war,
ceasefire, peace, alliance, meetings, idempotent proposals, accept/reject and
cancel flows, embassies, and shared vision are exposed through structured
packets and the Nations screen. Shared vision expands live and explored map
visibility through `VisibilityManager`; declarations of war revoke it.
Diplomat and spy capabilities advertise only implemented operations:
establishing an embassy, investigating a city, stealing an available
technology, and sabotaging an eligible city improvement. Those operations use
the same city, research, unit-removal, visibility, and packet paths as human
gameplay.

CivJS intentionally uses the documented `CivJSAIAdapter` instead of embedding
a partial copy of Freeciv's tightly coupled default AI. AI participants select
legal research and production through the authoritative managers and respond
to non-alliance diplomatic proposals during the normal AI phase.

Turns are simultaneous: all living humans must finish, while AI participants
act during turn processing. A disconnected human retains their turn until the
authoritative timeout. End-turn writes are serialized and persisted, duplicate
turn-processing requests coalesce, and ordered packet sequences reject stale
or duplicate requests. Timers pause when every human disconnects and resume on
reconnect; paused games are recoverable after a server reload. Spectators have
an explicit read-only connection role, including protection for both packet
and named-event mutations. Host controls can pause/resume a game and change
the persisted turn timeout.

Evidence includes `DiplomacyManager.test.ts`, `CivJSAIAdapter.test.ts`,
`VisibilityManager.test.ts`, `GameManager.turns.test.ts`,
`TurnManager.test.ts`, `PacketHandler.ordering.test.ts`,
`SocketCoordinator.test.ts`, `UnitActionHandler.test.ts`, and the client
management/state packet suites.

## Milestone 7 — complete

Complete games now finish through an authoritative conquest check at the
audited turn boundary. The server calculates deterministic category scores,
persists player scores and a versioned final report, marks the game ended, and
broadcasts the structured end-game packet. The client enters a read-only,
keyboard-focusable final standings flow. Existing players can reopen a
finished game and receive the persisted report without reconstructing it.

Each completed turn now closes its `game_turns` audit row with queued actions,
events, phase statistics, timing, and a versioned snapshot marker before the
next turn begins. Existing normalized game, player, city, unit, research,
government, visibility, diplomacy, map, timer, and ruleset state remains the
single source of truth during recovery. Migration `0007_add_game_end_report.sql`
adds nullable end-state fields without invalidating existing saves.

Release quality includes aligned client/server packet identifiers, reduced
motion support, labelled tab controls, persisted mute/volume settings, an
optional victory cue, dependency-aware readiness, process metrics, a 100-turn
audit soak test, and the deployment/monitoring/recovery procedures in
[`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md). The release-supported target is the
classic ruleset, conquest victory, 80×50 maps, and up to eight participants.

Evidence includes `EndGameService.test.ts`, `TurnManager.test.ts`,
`GameClient.state-packets.test.ts`, the recovery and integration suites, both
production builds, and [`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md).

## Milestone 8 — complete

The remaining covert outcomes enabled by the classic ruleset are now playable.
Diplomats can bribe a lone eligible foreign unit and incite a non-capital,
non-Democracy city; spies additionally poison size-two-or-larger enemy cities
and sabotage lone enemy units while at war. The same server-supplied
capabilities feed the unit menu and the existing cancelable map-target flow.

The server validates movement, adjacency, ownership, stack/city-center,
`Unbribable`, diplomatic-state, government, capital, and population
requirements. Classic ruleset data supplies bribe/incite base values and
factors. Successful actions persist treasury changes, population loss, halved
unit health, ownership transfers, cleared production, and nearby
home-supported unit defections. Non-spy diplomats are consumed; surviving
spies expend their remaining movement.

Freeciv's generic plague, suitcase-nuke, gold-theft, and map-theft outcomes
remain unadvertised because the classic ruleset does not enable them.
Evidence includes `GameManager.espionage.test.ts`, `UnitActionHandler.test.ts`,
`UnitManager.test.ts`, `CityManager.test.ts`, and
`UnitContextMenu.espionage.test.tsx`.

## Milestone 9 — complete

Classic actions, extras, and styles are now complete, source-attributed,
validated ruleset domains. A reproducible converter retains all 82 action
enablers, 34 extras, 20 resources, 6 nation styles, 10 city styles, and 11
music styles from the upstream secfiles. Cross-file validation rejects
unresolved entity references in addition to malformed definitions.

The shared ruleset requirement evaluator covers every requirement kind present
in those domains, selects context by Freeciv range, applies negation, and fails
closed when context is absent. Loaded action enablers determine diplomat and
spy capability advertisement; loaded city styles feed the existing ruleset
API; loaded extra and terrain settings determine railroad and pollution-cleanup
activity times. Mutation fixtures prove these behaviors change through data
without TypeScript constant edits.

Remaining classic action outcomes belong to Milestone 11, while complete
style/music rendering and browser evidence belong to Milestone 12.

## Milestone 10 — complete

Client and server now consume one canonical protocol-v1 identifier and
transport catalogue. Outgoing packet envelopes carry the version, unsupported
versions fail explicitly, and contract tests prevent numeric drift while
preserving the deployed CivJS IDs.

Every active packet and named Socket.IO event is classified with its direction
and endpoint evidence. Named lifecycle, notification, and version-1
compatibility paths remain visible rather than being mistaken for unimplemented
packets. City production has moved to its structured, correlated request/reply
path; the legacy named handler remains a compatibility adapter. The previously
unused tile-visibility request now has a client caller and explicit validated,
authorized success/error replies.

Evidence includes `PacketContract.test.ts`,
`PacketHandler.ordering.test.ts`, `MapVisibilityHandler.test.ts`,
`CityManagementHandler.production.test.ts`,
`GameClient.protocol.test.ts`, and `GameClient.production.test.ts`.

## Partial or incomplete areas

These are confirmed by the post-Milestone 8 audit and are now scheduled in
[`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md):

- Bombardment, paradrop, airlift, and applicable automation are not yet in the
  advertised classic action surface (Milestone 11).
- Style/rendering parity and the playable flow lack browser-level automated
  evidence (Milestone 12).
- Freeciv's full default AI is not ported, and the database-backed integration
  evidence still depends on an externally configured PostgreSQL service
  (Milestone 13).

Non-classic generic covert outcomes (plague, suitcase-nuke, and direct
gold/map theft) remain intentionally unadvertised and are not roadmap gaps
because the classic ruleset does not enable them.

## Porting workflow

1. Locate the corresponding behavior in `reference/freeciv/` or, for client behavior, `reference/freeciv-web/`.
2. Record the source file and line range in the implementation or its test.
3. Port the behavior with tests where practical.
4. Update this file only when the status changes, including the commit/date and the source/test evidence.

## Detailed documentation

- Continuation plan: [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md).
- Milestone 0 evidence backlog: [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md).
- Citizen-management design and usage: `apps/server/src/game/systems/CitizenManagement/README.md`.

Historical plans and gap analyses were removed because their paths, file sizes, and completion claims no longer represented the repository.
