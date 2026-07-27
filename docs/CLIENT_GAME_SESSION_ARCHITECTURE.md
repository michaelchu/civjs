# Client Game Session Architecture

**Status:** Remediation in progress  
**Started:** 2026-07-27

## Goal

Make game creation, loading, packet handling, reconnection, and canvas rendering
use explicit TypeScript contracts and React-safe lifecycle boundaries. Reference
Freeciv behavior remains authoritative for game rules, but browser state and
transport orchestration should follow native TypeScript and React patterns.

## Remediation tracker

| ID    | Priority | Work item                                                                                            | Status   | Verification                                       |
| ----- | -------- | ---------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------- |
| GS-01 | High     | Do not report a player rejoin as successful when snapshot recovery or delivery fails.                | Complete | Server handler recovery-failure regression test    |
| GS-02 | High     | Implement observer snapshot loading before reporting the observer session ready.                     | Complete | Observer snapshot content and ordering test        |
| GS-03 | High     | Apply runtime schemas to game creation, joining, and Socket.IO management events.                    | Complete | Registered-schema and malformed-event tests        |
| GS-04 | Medium   | Correlate every packet request/reply with a unique request ID.                                       | Complete | Concurrent server context and client request tests |
| GS-05 | Medium   | Replace mixed packets, callbacks, and compatibility events with one typed transport boundary.        | Complete | Authoritative creation-reply tests                 |
| GS-06 | Medium   | Model the session lifecycle explicitly, including reconnect, resync, cancellation, and failure.      | Complete | Session state-machine tests                        |
| GS-07 | Medium   | Make the Zustand game model the sole map source and remove `window.map`/`window.tiles` dependencies. | Complete | Renderer and recovery tests                        |
| GS-08 | Medium   | Split the monolithic client into transport, session, snapshot, and domain reducer responsibilities.  | Pending  | Unit tests for each boundary                       |
| GS-09 | Low      | Replace whole-store React subscriptions with narrow selectors and imperative renderer subscriptions. | Pending  | Render-count and canvas regression tests           |

## Target architecture

1. A shared protocol package owns packet identifiers, runtime schemas, inferred
   payload types, request IDs, and snapshot metadata.
2. A transport service owns the Socket.IO connection and exposes typed events
   and correlated requests without mutating React state.
3. A session coordinator owns the state machine:
   `idle → connecting → authenticating → joining → syncing → ready`, with
   explicit `reconnecting` and `error` transitions.
4. Snapshot assembly stages map, units, cities, borders, and player data under a
   snapshot ID, then commits one authoritative state replacement.
5. Pure domain reducers convert validated wire payloads into the client model.
6. Zustand is the sole authoritative client game state. Canvas rendering reads
   typed store data rather than compatibility globals.
7. React owns component lifecycle and presentation only; network ordering is
   never inferred from component mount timing.

## Implementation rules

- Each tracker item is delivered in an isolated commit.
- The tracker is updated in the same commit as its implementation.
- New compatibility code must have an explicit removal condition.
- Runtime validation is required at every network trust boundary.
- Readiness means the complete required snapshot is committed, not merely that
  a join acknowledgement was received.
- Each completed item must include focused regression tests plus the relevant
  package type-check and lint checks.

## Progress log

- 2026-07-27: GS-01 completed. Active-game joins now propagate snapshot
  recovery failures instead of acknowledging an unusable session.
- 2026-07-27: GS-02 completed. Player and observer joins now share the same
  snapshot pipeline, with observer readiness acknowledged only after delivery.
- 2026-07-27: GS-03 completed. Game creation and joining now apply bounded
  runtime schemas, and management callbacks reject malformed identifiers.
- 2026-07-27: GS-04 completed. Packet RPC calls now carry unique request IDs,
  and the server automatically echoes the correct ID through concurrent work.
- 2026-07-27: GS-05 completed. Game creation state now comes exclusively from
  `GAME_CREATE_REPLY`; the duplicate `game_created` mutation path was removed.
- 2026-07-27: GS-06 completed. A typed session coordinator now retains player
  or observer intent, rejects stale acknowledgements, and performs a complete
  resync from Socket.IO Manager reconnect events.
- 2026-07-27: GS-07 completed. Map packets, camera bounds, terrain adjacency,
  fog, hover detection, and ocean padding now share the atomic Zustand map
  snapshot; the unused global-state renderer copy was removed.
- 2026-07-27: Recorded the architecture review and remediation sequence.
