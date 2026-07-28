# Client Architecture

## Scope

This document describes the supported React client boundary for creating,
joining, observing, resuming, and rendering a game. Freeciv remains the
behavioral reference for game rules and the 2D presentation, while CivJS uses
TypeScript, Socket.IO, Zustand, and React-native lifecycle patterns.

## Responsibilities

- `GameTransport` owns Socket.IO connection establishment, reconnection
  signals, visibility pings, and transport cleanup.
- `GameSessionCoordinator` owns explicit session phases and the player or
  observer resume target. Operation tokens prevent acknowledgements from
  cancelled or superseded joins from making a stale session ready.
- `GameClient` orchestrates authentication, game-management requests, packet
  dispatch, and domain service calls. It does not own rendered React state.
- `MapSnapshotAssembler` stages chunked tile packets and publishes a new map
  only after the final batch.
- Pure wire reducers, such as `MapTileReducer`, translate validated transport
  data into client-domain objects.
- `gameStore` is the authoritative client model for maps, players, units,
  cities, research, selection, and UI state.
- `MapRenderer` and its specialized renderers consume typed store snapshots.
  They do not read map dimensions or tiles from browser globals.

## Session lifecycle

The normal player flow is:

```text
idle → connecting → authenticating → joining → syncing → ready
```

A transport interruption retains the active session target and transitions to
`reconnecting`. Socket.IO Manager reconnection triggers authentication and a
complete player rejoin or observer resync. A failed active operation transitions
to `error`; an explicit disconnect cancels it and returns to `idle`.

Readiness has a strict meaning: the server has recovered the game if necessary,
sent map, player, unit, city, border, and turn state in order, and only then
acknowledged the join or observer request. Recovery or snapshot-delivery
failure must reject the join.

## Transport contracts

- Correlated packet request flows carry a unique `requestId`.
- The server preserves that request context across concurrent asynchronous
  handlers and echoes it on the matching reply.
- Runtime schemas validate game creation, join, observe, and deletion inputs at
  the server trust boundary.
- Game creation state comes from `GAME_CREATE_REPLY`; there is no second
  compatibility event mutating the same state.
- Existing named Socket.IO events remain catalogued in
  [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md). New gameplay request/reply
  families should prefer typed, correlated packet envelopes.

## Rendering and React

Zustand is the only source of map dimensions and tiles. Terrain adjacency, fog,
hover lookup, camera bounds, and ocean padding all consume the same immutable
map snapshot, preventing mixed-size reload artifacts.

React components use selector-based Zustand subscriptions. The canvas drawing
path subscribes imperatively to its relevant slices so packet bursts can be
throttled by the renderer without requiring unrelated React reconciliation.
Each frame computes a viewport-cropped tile set with an overdraw margin, then
renders that set layer-first in Freeciv painter order. Static terrain, roads,
borders, specials, cities, units, fog, and paths must not be interleaved
tile-first.

Public city presentation is server-resolved. City packets carry the selected
style, wall state, and public overlays so foreign cities render correctly
without disclosing another player's research. Renderers consume the supplied
snapshot and do not reach back into the Zustand store while drawing.

Tileset sprite tables may still be loaded by the legacy-compatible asset
loader through browser globals; those tables are presentation assets, not game
state. `MapRenderer` receives them through the provider boundary described in
[`TILESET_ARCHITECTURE.md`](TILESET_ARCHITECTURE.md).

## Change rules

1. Validate new network inputs with a shared runtime schema.
2. Correlate request/reply traffic; do not match concurrent work by packet type
   alone.
3. Keep transport lifecycle, session intent, wire conversion, and store mutation
   in separate testable boundaries.
4. Commit complete snapshots rather than exposing partially assembled batches.
5. Do not introduce `window.map`, `window.tiles`, or a second client game-state
   cache.
6. Use narrow React selectors and imperative subscriptions for non-React
   rendering work.
7. Add recovery, ordering, cancellation, and render regression coverage when a
   lifecycle boundary changes.
8. Preserve global painter order and viewport culling when adding a map layer.
9. Resolve presentation that depends on hidden game state on the server.

## Primary verification

- `GameClient.session.test.ts`
- `GameSessionCoordinator.test.ts`
- `GameTransport.test.ts`
- `MapSnapshotAssembler.test.ts`
- `GameClient.state-packets.test.ts`
- `MapRenderer.live-state.test.ts`
- `TerrainRenderer.fog-edge.test.ts`
- `CityRenderer.presentation.test.ts`
- `CityPresentationService.test.ts`
- `gameStore.rendering.test.tsx`
- `GameManagementHandler.test.ts`
- `PacketHandler.ordering.test.ts`
