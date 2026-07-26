# CivJS Porting Inventory

**Audit baseline:** `2a01dcca` (2026-07-25); Milestone 1 evidence updated
2026-07-26.
**Purpose:** the evidence record for Milestone 0 in [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md). It distinguishes implemented transport/data from unported or unverified upstream behavior.

## Classic ruleset inventory

| CivJS JSON data    | Freeciv classic source                           | Status                                                                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `buildings.json`   | `data/classic/buildings.ruleset`                 | Present; behavior coverage must be verified per effect.                                                       |
| `cities.json`      | `data/classic/cities.ruleset`                    | Present.                                                                                                      |
| `effects.json`     | `data/classic/effects.ruleset`                   | Present; JSON parseability is covered by `RulesetLoader.effects.test.ts`.                                     |
| `game.json`        | `data/classic/game.ruleset`                      | Present.                                                                                                      |
| `governments.json` | `data/classic/governments.ruleset`               | Present.                                                                                                      |
| `nations.json`     | `data/classic/nations.ruleset`                   | Present.                                                                                                      |
| `techs.json`       | `data/classic/techs.ruleset`                     | Present; the research manager now uses the full loaded catalogue for costs, prerequisites, and flags.          |
| `terrain.json`     | `data/classic/terrain.ruleset`                   | Present.                                                                                                      |
| `units.json`       | `data/classic/units.ruleset`                     | Present.                                                                                                      |
| extras             | `data/classic/terrain.ruleset`                   | No standalone CivJS extras data file; terrain-derived extras and worker integration remain partial.           |
| requirements       | requirement clauses in the classic ruleset files | Effect requirement evaluation covers the requirement kinds currently present in `effects.json` and fails closed for unsupported or context-free clauses. Action and entity requirement loading remains partial. |
| —                  | `data/classic/actions.ruleset`                   | No equivalent JSON data file identified; action coverage requires an explicit audit.                          |
| —                  | `data/classic/styles.ruleset`                    | No equivalent JSON data file identified; client style/rendering coverage requires an explicit audit.          |

The loader parses every `classic/*.json` file with `JSON.parse`, then validates it with Zod. Therefore comments are not valid in these data files. `RulesetLoader.effects.test.ts` loads every supported classic JSON ruleset and covers an effects pair ported from `effects.ruleset:262–278`. The classic effects file previously contained JavaScript comments and could not load; technologies also use `null` to represent an absent `root_req`.

## Packet inventory

### Contract catalogue

The rows below inventory every currently registered CivJS gameplay transport. A
`named` row is a Socket.IO event; an `envelope` row is sent through the
`packet` event. “No direct equivalent” means CivJS-specific transport, not
unreviewed compatibility.

| Transport                                                                        | Direction                         | CivJS handler                                          | Client consumer                                                  | Upstream reference                                                                    | Automated evidence                                                                          |
| -------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `SERVER_JOIN_REQ` / `SERVER_JOIN_REPLY` (envelope)                               | client ↔ server                  | `ConnectionHandler.ts`                                 | `GameClient.authenticatePlayer`                                  | `PACKET_SERVER_JOIN_REQ` / `PACKET_SERVER_JOIN_REPLY` in `packets.def`; `packhand.js` | `ConnectionHandler.test.ts`; `SocketGameFlow.integration.test.ts`                           |
| `GAME_CREATE` / `GAME_CREATE_REPLY` (envelope)                                   | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient.createGame`                                          | no direct one-packet equivalent; lobby flow is adapted from freeciv-web `game.js`     | `GameManagementHandler.test.ts`; `SocketGameFlow.integration.test.ts`                       |
| `join_game` (named)                                                              | client → server                   | `GameManagementHandler.ts`                             | `GameClient.joinGame`                                            | freeciv-web `game.js` lobby/join flow                                                 | `GameManagementHandler.nation-selection.test.ts`; `SocketGameFlow.integration.test.ts`      |
| `GAME_LIST` (envelope), `get_game_list` (named)                                  | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient.getGameList`                                         | freeciv-web `game.js`                                                                 | `GameManagementHandler.test.ts`                                                             |
| `observe_game`, `delete_game` (named)                                            | client → server                   | `GameManagementHandler.ts`                             | `GameClient.observeGame`, `GameClient.deleteGame`                | no direct equivalent; CivJS lobby API                                                 | `GameManagementHandler.test.ts`                                                             |
| `MAP_VIEW_REQ` / `MAP_VIEW_REPLY` (envelope)                                     | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.requestMapData`                                      | `PACKET_MAP_INFO`, `PACKET_TILE_INFO`; freeciv-web `packhand.js`                      | `SocketGameFlow.integration.test.ts`                                                        |
| `get_map_data`, `get_visible_tiles` (named)                                      | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.getMapData`, `GameClient.getVisibleTiles`            | freeciv-web map request flow                                                          | `SocketGameFlow.integration.test.ts`                                                        |
| `TILE_VISIBILITY_REQ` / `TILE_VISIBILITY_REPLY` (envelope)                       | client ↔ server                  | `MapVisibilityHandler.ts`                              | no current `GameClient` caller                                   | `PACKET_TILE_INFO`                                                                    | `MapVisibilityHandler` unit coverage pending feature use                                    |
| `UNIT_MOVE`, `UNIT_ATTACK`, `UNIT_FORTIFY`, `UNIT_CREATE` and replies (envelope) | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.moveUnit`, `attackUnit`, `fortifyUnit`, `createUnit` | `PACKET_UNIT_*` in `packets.def`; freeciv-web `unit.js`                               | `UnitActionHandler.test.ts`, `UnitMovement.integration.test.ts`                             |
| `unit_action`, `path_request` / `path_response` (named)                          | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.executeUnitAction`, `PathfindingService`             | freeciv-web `unit.js`                                                                 | `UnitActionHandler.test.ts`, `ActionSystem.integration.test.ts`                             |
| `CITY_FOUND` / reply, `CITY_PRODUCTION_CHANGE` / reply (envelope)                | client ↔ server                  | `CityManagementHandler.ts`                             | `GameClient.foundCity`; production envelope unused               | `PACKET_CITY_CHANGE` in `packets.def`; freeciv-web `city.js`                          | `CityProductionHandler.test.ts`, `CityManager.integration.test.ts`                          |
| `city:getAvailableProductions`, `city:changeProduction` and replies (named)      | client ↔ server                  | `CityManagementHandler.ts`, `CityProductionHandler.ts` | `GameClient.getAvailableProductions`, `changeProduction`         | freeciv-web `city.js`                                                                 | `CityProductionHandler.test.ts`, `GameClient.production.test.ts`                            |
| `RESEARCH_SET`, goal/list/progress and replies (envelope)                        | client ↔ server                  | `ResearchHandler.ts`                                   | `GameClient.setResearch`                                         | `PACKET_PLAYER_RESEARCH`; freeciv-web `research.js`                                   | `ResearchManager.test.ts`, `GameFlow.integration.test.ts`                                   |
| `END_TURN` / `TURN_END_REPLY`, `TURN_START`, `NEW_YEAR` (envelope)               | client ↔ server                  | `TurnManagementHandler.ts`                             | `GameClient.endTurn`, packet reducer                             | `PACKET_TURN_DONE`, `PACKET_BEGIN_TURN`, `PACKET_NEW_YEAR`                            | `TurnManager.test.ts`, `GameFlow.integration.test.ts`, `SocketGameFlow.integration.test.ts` |
| `CHAT_MSG_REQ` / `CHAT_MSG` (envelope)                                           | client ↔ server                  | `ChatCommunicationHandler.ts`                          | `GameClient` packet reducer                                      | `PACKET_CHAT_MSG_REQ`, `PACKET_CHAT_MSG`                                              | handler unit coverage pending client feature work                                           |
| border update/info events (envelope and named)                                   | server → client / client → server | `GameManagementHandler.ts`, `MapVisibilityHandler.ts`  | `GameClient` packet reducer                                      | `PACKET_BORDER_*`; freeciv-web map handlers                                           | `BorderManager` unit/integration tests; socket transport coverage pending                   |

The enum declarations in `apps/server/src/types/packet.ts` and
`apps/client/src/types/packets.ts` contain additional legacy or future packet
names. They are intentionally not counted as implemented transport until a
handler, client consumer, and test exist.

### Confirmed protocol risks

1. The server and client have separate `PacketType` enums. They already disagree on numeric values, including `GAME_INFO` (server `19`, client `16`), `PLAYER_INFO` (server `14`, client `13`), and the nation-selection sequence.
2. Neither current enum is a complete direct mapping of `packets.def`; for example, upstream defines `PACKET_GAME_INFO = 16`, `PACKET_MAP_INFO = 17`, and `PACKET_PLAYER_INFO = 51`.
3. Gameplay traffic uses both the structured `packet` envelope and named Socket.IO events. Examples of named-event flows are `join_game`, `get_map_data`, `unit_action`, `path_request`, and `city:changeProduction`.
4. Some structured packet types are declared but are not the path used by the client. City production is the clearest example: the client uses `city:changeProduction`, while the server also declares `CITY_PRODUCTION_CHANGE` and its reply.

### Active named-event inventory

The following named events bypass or supplement the `packet` envelope and must be accounted for before a family is migrated.

| Family                | Client → server                                                                          | Server → client                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Game lobby            | `join_game`, `observe_game`, `get_game_list`, `delete_game`                              | `game_created`, `game_started`, `game_deleted`                                                                  |
| Map and borders       | `get_map_data`, `get_visible_tiles`, `border_info_request`, `request_full_border_update` | `map_data`, `border_change_notification`                                                                        |
| Units and pathfinding | `unit_action`, `path_request`                                                            | `path_response`, `unit_destroyed`, `unit_update`                                                                |
| Cities                | `city:getAvailableProductions`, `city:changeProduction`                                  | `city:availableProductions`, `city:productionChanged`, `city:updated`, `cities_updated`, `production:completed` |
| Connection            | Socket.IO lifecycle and `packet`                                                         | `packet`, Socket.IO lifecycle                                                                                   |

The server’s structured packet registrations are in the connection, game-management, map-visibility, city-management, research, turn-management, unit-action, and chat handlers. Any migration must preserve the existing request validation and callback/error behavior for that family.

### Packet migration plan

Do not renumber existing packets in place. Migrate one feature family at a time with a compatibility period.

1. Create a canonical CivJS packet-contract module that names the transport event, direction, schema, numeric ID (where applicable), client consumer, and server handler.
2. For a feature family, add the structured request/reply flow while retaining the named event as a thin compatibility adapter.
3. Add tests for request validation, authoritative state update, reply/error packet, and client state handling.
4. Migrate the client to the structured path, remove the compatibility adapter only after the packet inventory marks it unused, and update the Freeciv mapping.
5. Use a protocol-version field before adopting upstream numeric IDs broadly; packet numbers alone are not sufficient evidence of semantic compatibility.

## Transport smoke-test coverage

`tests/integration/SocketGameFlow.integration.test.ts` starts a real in-process
Socket.IO server and two Socket.IO clients. It verifies connection,
authentication, game creation, join/nation selection, map delivery, movement,
combat, city founding, production, research, and 20 complete turns. It then
clears in-memory games to simulate a server restart, recovers persistent state
from the isolated `TEST_DATABASE_URL` database, reconnects the host, and
completes another two-player turn with the recovered city present. It is part
of `npm run test:integration`.

## Prioritized next slices

1. **Generic requirements and effects:** establish a validated representation
   for classic requirements and evaluate it in the player, city, unit, tile,
   technology, government, and action contexts used by the playable loop.
2. **Ruleset-driven values:** replace duplicated unit, building, technology,
   and effect constants with loaded classic ruleset data, backed by fixture
   parity tests.
3. **Classic actions ruleset:** inventory `actions.ruleset` against
   `ActionSystem` and identify the first missing ruleset-driven action.
4. **Client-browser smoke test:** add an automated browser layer over the
   Socket.IO smoke path once a browser test runner is selected.

## Action-system inventory

`ActionSystem` declares a broader action enum than it currently validates and executes. The current executable path covers fortify, sentry, wait, goto, found city, road/railroad/irrigation/mine work, pillage, terrain transformation, disband, and patrol. Several of those worker actions still have explicit map-integration TODOs. Diplomacy, espionage, transport, bombardment, paradrop, airlift, trade, and automation actions are declared but do not have a complete `ActionSystem` execution path.

The local ruleset has no `actions.json`; Freeciv’s action definitions remain in `reference/freeciv/data/classic/actions.ruleset`. The first action-focused port slice should therefore establish a data representation and choose one supported action whose rule legality, packet, state update, and client feedback can be verified end-to-end.

## Smoke-test status

`tests/integration/GameFlow.integration.test.ts` verifies the authoritative
manager/database path, including two-player creation, nation assignment,
start, map/visibility access, city founding, unit creation, research, turn
advancement, and rejoin. `SocketGameFlow.integration.test.ts` verifies the
same baseline through the network transport, including restart recovery and a
continued turn. Both require `TEST_DATABASE_URL` to point to an isolated
PostgreSQL database.

## Update rule

Update this document when a family’s contract changes or an inventory row is resolved. Update `PORT_STATUS.md` only after a player-visible capability is verified end-to-end.
