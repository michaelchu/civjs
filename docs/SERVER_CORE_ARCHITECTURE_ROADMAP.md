# Server Core Architecture Roadmap

## Purpose

This document records the server-core architecture improvements identified in
the July 2026 review. It is a forward-looking maintenance roadmap, not a claim
that the current classic-game implementation is incomplete or unreliable.

The server is a capable, server-authoritative modular monolith. It has broad
test coverage and works well in its current single-process deployment model.
The work below reduces lifecycle and recovery risk, makes future changes less
coupled, and establishes explicit boundaries before further feature growth.

## Current deployment assumption

One Node.js process owns each live game's in-memory runtime. PostgreSQL is the
durable authority; Redis is a cache. Do not run multiple server instances that
can accept commands for the same game until the multi-instance milestones are
complete.

This assumption must be documented in deployment configuration and preserved
by any future autoscaling change.

## Guiding principles

- Preserve the authoritative server and normalized PostgreSQL model.
- Keep the application a modular monolith; this roadmap does not propose
  microservices.
- Make lifecycle transitions atomic, idempotent, and recoverable after a
  process crash.
- Construct a complete game runtime before publishing it to sockets or other
  callers.
- Replace callback bags and `any` casts at core boundaries with narrow typed
  interfaces.
- Prefer incremental extractions with behavior-preserving tests over broad
  rewrites.

## Findings and planned remedies

### 1. Recovery publishes incomplete runtimes

`GameInstanceRecoveryService` currently adds a recovered `GameInstance` to the
shared runtime map before city/unit hydration and research/visibility restore
finish. A concurrent reconnect can observe that partially initialized runtime
and receive an incomplete snapshot.

**Required change**

1. Add an in-flight recovery map keyed by game ID.
2. Make every recovery caller await the same promise for a given game.
3. Publish the runtime to `games` only after all hydration, visibility restore,
   callback wiring, and timer restoration succeed.
4. On failure, clean up timers/services created during the attempted recovery
   and remove the in-flight entry.

**Acceptance criteria**

- Two simultaneous reconnect/snapshot requests cause exactly one recovery.
- Neither caller can observe a runtime before cities, units, research, and
  visibility are loaded.
- A failed recovery leaves no live runtime or timer behind.

### 2. Game start is not atomically claimed

The current flow validates a `waiting` game and subsequently writes `starting`.
Two host retries can both pass the initial read before either writes the new
status.

**Required change**

1. Claim start with a conditional database update: only transition from
   `waiting` to `starting` when the row is still waiting.
2. Treat a zero-row update as "already starting or started" and return a
   deterministic, idempotent response.
3. Record a start attempt ID and start timestamp with the claim.
4. Ensure the same operation owns map generation, initialization, and final
   activation.

**Acceptance criteria**

- Concurrent start requests create one map, one initial unit set, and one turn
  record.
- Retrying the same request does not duplicate initialization.
- A non-owner cannot claim or resume another host's start attempt.

### 3. Crash during start can strand a game

The normal exception path rolls a failed start back to `waiting`, but an
abrupt process exit bypasses that code. Recovery currently accepts only active
and paused games, so a durable `starting` record can remain unavailable.

**Required change**

1. Add a startup reconciliation task for stale `starting` records.
2. Use the start attempt ID and durable initialization markers to choose one
   explicit outcome: resume safely, reset to a retryable lobby, or mark the
   game failed with operator-visible diagnostics.
3. Add a lease expiry so a dead process cannot hold the start transition
   indefinitely.
4. Extend the release/recovery runbook with this recovery path.

**Acceptance criteria**

- Simulated process termination at each start phase never leaves an
  indefinitely unusable game.
- Operators can identify the failed start attempt and selected recovery action.

### 4. Process-local runtime and locks limit scaling

`GameManager` is a singleton holding live games, player mappings, diplomacy
caches, and promise locks in memory. Existing database turn leases help with
turn processing, but recovery, lifecycle, and normal gameplay mutations remain
process-local.

**Required change now**

- Make the single-authoritative-process deployment model explicit in code,
  operations documentation, and hosting configuration.
- Avoid adding a second process-local lock for new critical operations; use a
  durable/atomic database claim where cross-process correctness matters.

**Future multi-instance milestone**

1. Route every game to one active owner (for example, a durable game lease).
2. Move command serialization from promise maps to durable locks or a
   single-owner command queue.
3. Use Socket.IO's supported multi-node adapter and shared session/room state.
4. Validate recovery, reconnect, command idempotency, and turn leases with two
   independently running server instances.

## Target server shape

The desired end state remains one deployable server application:

```text
Socket / HTTP handlers
        |
        v
Application command services
        |
        v
GameRuntime (one fully initialized runtime per live game)
        |
        +-- domain services: units, cities, turn, diplomacy, visibility
        +-- ports: persistence, broadcasting, rulesets, clock/randomness
        |
        v
PostgreSQL / Redis / Socket.IO adapters
```

`GameRuntimeFactory` should be the sole place that creates or hydrates a game
runtime. It must return a ready runtime, not one that requires later setter
calls before it is safe to use.

## Modularization milestones

### Milestone A: Typed runtime composition

Replace the broad constructor callback bags with focused ports such as:

- `GameRepository`
- `GameBroadcaster`
- `UnitActions`
- `CityActions`
- `DiplomacyGateway`
- `RulesetProvider`

`GameLifecycleManager` and `GameInstanceRecoveryService` should share the
same factory and dependency composition rather than duplicating manager
construction/wiring.

### Milestone B: Narrow application services

Keep managers focused on in-memory domain state and rules. Move command
orchestration, authorization, database transactions, and broadcast sequencing
into application services. Prioritize the largest change surfaces:

1. unit actions and combat;
2. city production/growth/capture;
3. game lifecycle and recovery;
4. diplomacy material transfers;
5. turn advancement.

No extraction is complete until the original class becomes smaller and has a
clearer dependency set; adding a thin forwarding service alone is not enough.

### Milestone C: Persistence ownership

Introduce repositories for game, player, city, unit, turn, and diplomacy
state. Establish transaction boundaries in application services for operations
that modify multiple aggregates. Managers should not independently issue
uncoordinated writes to the same records.

### Milestone D: Runtime validation

Validate persisted JSON and reconstructed runtime inputs at recovery
boundaries. Start with map data, game state, player AI state, visibility memory,
and action payloads. Remove unsafe casts as schemas are introduced.

## Cleanup tasks

- Remove the unused or misleading string-keyed service registry unless it
  becomes the actual lifecycle owner.
- Replace the temporary `mockBroadcastManager` with the typed broadcaster port.
- Remove obsolete commented-out legacy implementation blocks.
- Reduce complexity warnings by extracting decision tables and capability
  evaluators from `UnitManager`, `CityManager`, and lifecycle handlers.
- Keep a decreasing lint-warning budget; do not raise it to accommodate new
  complexity.
- Add structured lifecycle metrics: recovery duration/failure, stale-start
  reconciliation, duplicate-start rejection, command queue depth, and lease
  failures.

## Required test additions

- concurrent recovery from two socket reconnects;
- snapshot request while recovery is in progress;
- duplicate and concurrent game-start requests;
- process crash/restart at start lifecycle boundaries;
- recovery cleanup after a hydration failure;
- idempotent command retry tests for every new command boundary;
- two-process ownership/lease tests before enabling horizontal scale.

## Suggested implementation order

1. Atomic start claim and stale-start reconciliation.
2. Single-flight recovery and delayed runtime publication.
3. Typed `GameRuntimeFactory` shared by new-game and recovery flows.
4. Replace lifecycle callback bags with typed ports.
5. Introduce repositories and transaction-owning application services.
6. Evaluate multi-instance ownership only when a deployment need exists.

## Verification

Each milestone must retain the normal quality gate:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration:docker
npm run test:e2e
npm run build
```

Lifecycle work additionally requires targeted database integration tests that
exercise overlapping requests and restart/crash simulation. A green unit suite
alone is insufficient evidence for these concurrency boundaries.
