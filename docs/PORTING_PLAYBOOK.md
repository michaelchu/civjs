# CivJS Porting Playbook

## Definition of port-complete

CivJS targets a native port with functional parity for the agreed Freeciv
classic scope, not a compatibility layer, literal rewrite of the C server, or
every upstream deployment feature. A feature is port-complete when:

1. Server behavior is traced to `reference/freeciv/`.
2. Client interaction, rendering, and packets are traced to
   `reference/freeciv-web/` where applicable.
3. The authoritative server path, transport/state transition, persistence
   impact, and visible client result are implemented.
4. Important rule, error, recovery, and ordering behavior has automated
   coverage.
5. The relevant status or inventory document reflects the supported result.

Do not invent game rules to close a gap. If the selected reference behavior
cannot be ported, document the intentional deviation before implementing it.

## Workflow

For each feature or correction:

1. Write a short brief covering player behavior, server authority, client
   behavior, packets, persistence, and acceptance cases.
2. Locate the reference implementation:
   - rules and shared mechanics: `reference/freeciv/common/`;
   - server authority and turn handling: `reference/freeciv/server/`;
   - packets: `reference/freeciv/common/networking/packets.def` and
     freeciv-web packet handling;
   - client interaction: freeciv-web `game.js`, `packhand.js`, `city.js`,
     `unit.js`, and `map.js`;
   - 2D rendering and controls: `reference/freeciv-web/javascript/2dcanvas/`.
3. Port the smallest vertical slice:
   data/rules → server action → packet → client state → visible UI.
4. Add focused unit tests and proportional integration/browser coverage.
5. Exercise player-visible behavior locally when automation cannot establish
   the result.
6. Commit one coherent change and update only the living document affected by
   it.

## Architecture rules

- The server remains authoritative for game rules and persisted state.
- Loaded ruleset data replaces duplicated classic constants.
- Missing requirement context fails closed.
- Existing packet numbers are never renumbered in place; incompatible changes
  require a negotiated protocol version.
- Packet requests use correlated replies and runtime validation at trust
  boundaries.
- Client transport, session intent, wire conversion, Zustand state, and React
  presentation remain separate responsibilities.
- A compatibility adapter must be catalogued with a removal condition.
- Unsupported behavior stays undiscoverable rather than appearing as a no-op.

## Required verification

Run the checks proportional to the change. The normal full gate is:

```sh
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration:docker
npm run test:e2e
npm run build
```

Database integration tests must use an isolated `TEST_DATABASE_URL`.
Browser failures retain traces, screenshots, and video under the configured
Playwright artifact directories.

## Documentation ownership

- [`PORT_STATUS.md`](PORT_STATUS.md): supported player-visible scope and
  intentional exclusions.
- [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md): ruleset, packet, action, and
  evidence catalogue.
- [`CLIENT_ARCHITECTURE.md`](CLIENT_ARCHITECTURE.md): browser session,
  transport, state, and rendering boundaries.

Completed plans, checklists, and milestone narratives belong in Git history,
not the active documentation set.
