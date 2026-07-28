# CivJS Port Status

**Supported baseline:** Freeciv classic ruleset and freeciv-web-compatible 2D
client experience

**Status:** Milestones 0–15 and the post-port parity audit are complete for the
agreed baseline

## Supported scope

CivJS supports a server-authoritative classic game with:

- game creation, nation assignment, joining, observing, reconnecting, and
  persistent recovery;
- simultaneous turns, host pause/timer controls, bounded AI participants, and
  conquest victory;
- classic map generation, terrain, resources, extras, visibility, borders,
  movement, transport, combat, huts, and worker activities;
- city founding, tile assignment, population, happiness, production, trade,
  upkeep, pollution, government, tax rates, and research;
- diplomacy, embassies, treaties, shared vision, and every covert action enabled
  by the classic ruleset;
- the complete enabled classic caravan, unit-management, worker, airlift,
  paradrop, nuclear, and combat-consequence surface;
- persisted maps, players, cities, units, research, diplomacy, turn audit data,
  timers, and end-game reports;
- a React/Canvas 2D client exposing the supported core play surface without
  developer-console commands.

The release target is the classic ruleset, conquest victory, standard 80×50
maps, and up to eight participants.

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

- additional Freeciv rulesets and metaserver/deployment compatibility;
- literal line-for-line parity with the C server;
- generic non-classic covert outcomes that the classic ruleset does not enable,
  including plague, suitcase-nuke, and direct gold/map theft;
- mid-game civil-war player creation, because CivJS retains a fixed lobby
  participant set.

New scope must be explicitly agreed and added here before being described as a
porting requirement.

Full Freeciv classic/default-AI behavioral parity is required scope. The
temporary `CIVJS_AI_CONTRACT` describes only the currently landed compatibility
slice; it is not a product boundary or an accepted replacement for the
subsystems tracked in [`AI_PORTING_INVENTORY.md`](AI_PORTING_INVENTORY.md).

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
transport, action, and evidence mappings. Use
[`RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) for release gates and recovery
procedures.

## Maintenance rule

Update this document only when supported player-visible scope or an intentional
exclusion changes. Technical contract changes belong in the inventory or
architecture document; implementation history remains in Git.
