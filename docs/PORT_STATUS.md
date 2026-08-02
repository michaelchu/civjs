# CivJS Port Status

**Supported baseline:** Freeciv classic ruleset and freeciv-web-compatible 2D
client experience

**Default ruleset:** `civ2civ3`. New games use `civ2civ3` unless another
ruleset is explicitly selected. The completed evidence audit finds broad
feature coverage, but does not certify game-wide reference parity for any
ruleset.

**Status:** The supported feature surface is implemented. The evidence audit
classification is complete; its current proof status is recorded in
[`TEST_EVIDENCE_AUDIT.md`](TEST_EVIDENCE_AUDIT.md).

## Supported scope

CivJS supports a server-authoritative classic game with:

- game creation, nation assignment, joining, observing, reconnecting, and
  persistent recovery;
- simultaneous turns, host pause/timer controls, native AI participants, and
  conquest victory;
- classic map generation, terrain, resources, extras, visibility, borders,
  movement, transport, combat, huts, and worker activities;
- city founding, tile assignment, population, happiness, production, trade,
  upkeep, pollution, government, tax rates, and research;
- diplomacy, embassies, treaties, shared vision, and every covert action enabled
  by the classic ruleset;
- the complete enabled classic caravan, unit-management, worker, airlift,
  paradrop, nuclear, and combat-consequence surface;
- persistent human **Auto Worker** and native-AI worker management through one
  shared city-workable planner, reservation/safety model, and authoritative
  executor, including restart recovery and owner-visible assignment state;
- persisted maps, players, cities, units, research, diplomacy, turn audit data,
  timers, and end-game reports;
- a React/Canvas 2D client exposing the supported core play surface without
  developer-console commands.

The release target is the `civ2civ3` default configuration, with conquest
victory, standard 80×50 maps, and up to eight participants. Classic has
source-mapped data and mechanics cases, while civ2civ3 has broad runtime
coverage. Neither has a complete reference-parity certificate; the other
packaged profiles are available as data but do not yet carry the same
full-support claim.
Reference-compatible civilization scoring and score-at-turn-cap ranking are
implemented for the supported baseline and tracked as resolved in `GP-035` in
[`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md).

## Ruleset and action authority

Converted classic JSON drives technologies, governments, buildings, units,
terrain, effects, extras, action enablers, and presentation styles. Zod schemas
and cross-file validation reject malformed or unresolved ruleset data.
Requirement evaluation is range- and negation-aware and fails closed when
required runtime context is unavailable.

The executable action inventory accounts for all 82 classic enablers and 64
distinct action names. Each is implemented, resolved by the engine, or recorded
as inapplicable to CivJS’s fixed-lobby model. No classic enabler remains
scheduled.

## Client and protocol

Client and server share the protocol-v1 packet contract. Correlated request
flows use unique request IDs, management inputs are runtime-validated, and
snapshot readiness is acknowledged only after recovery and ordered state
delivery. The client retains explicit reconnect intent and performs a complete
rejoin or observer resync after transport recovery.

Zustand is the authoritative browser game model. Canvas rendering, fog, camera
bounds, terrain adjacency, hover lookup, and ocean padding consume the same map
snapshot. See [`CLIENT_ARCHITECTURE.md`](CLIENT_ARCHITECTURE.md) for the current
boundaries and invariants.

## Intentional exclusions

These are scope decisions, not untracked porting gaps:

- full gameplay parity for additional Freeciv rulesets beyond the validated
  classic baseline;
- literal line-for-line parity with the C server;
- generic non-classic covert outcomes that the classic ruleset does not enable,
  including plague, suitcase-nuke, and direct gold/map theft;
- mid-game civil-war player creation, because CivJS retains a fixed lobby
  participant set.

New scope must be explicitly agreed and added here before being described as a
porting requirement.

The native port implements broad Freeciv classic/default-AI feature coverage
for the supported game surface. It is not certified as complete
reference-parity behavior: the AI uses simplified TypeScript planners in
several areas, and the evidence audit records the precise rule cases that are
source-mapped. Subsystem mappings remain in
[`AI_PORTING_INVENTORY.md`](AI_PORTING_INVENTORY.md). The native port includes
science-victory strategy, national spaceship-part state, launch planning, and
response to rival ships.

## Completeness and follow-up

The supported game surface is implemented, but the evidence needed for a
complete reference-parity certificate remains incomplete. Several breadth and
parity improvements remain:

- packaged audio/music and localization;
- richer city and empire reports, saved worklists, and advanced batch
  production/report workflows;
- a decision on event-stream replay beyond checkpoint and archive inspection;
- client help, reports/history, accessibility, animation, and presentation
  polish;
- animation and presentation implementation details are tracked in
  [`ANIMATION_PORTING_GAPS.md`](ANIMATION_PORTING_GAPS.md);
- the concrete behavioral issues tracked in [`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md).

These are follow-up items. They do not remove the need for source-mapped and
differential parity evidence described in
[`TEST_EVIDENCE_AUDIT.md`](TEST_EVIDENCE_AUDIT.md).

## Verification

The maintained evidence includes:

- client and server unit suites;
- real Socket.IO game-flow and PostgreSQL restart/recovery integration suites;
- deterministic 20-turn economy/game-flow coverage;
- the executable classic-action inventory;
- ruleset validation and mutation tests;
- desktop/mobile Chromium creation and renderer parity tests;
- an 80×50, eight-participant generation check and 100-turn audit soak.

Use [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md) for detailed ruleset,
transport, action, and evidence mappings.

## Maintenance rule

Update this document only when supported player-visible scope or an intentional
exclusion changes. Technical contract changes belong in the inventory or
architecture document; implementation history remains in Git.
