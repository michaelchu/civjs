# CivJS Porting Inventory

**Audit baseline:** `3f4618b4` plus the Milestone 0 working tree
**Purpose:** the evidence backlog for Milestone 0 in [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md). This is an inventory, not a completion claim.

## Classic ruleset inventory

| CivJS JSON data    | Freeciv classic source             | Status                                                                                               |
| ------------------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `buildings.json`   | `data/classic/buildings.ruleset`   | Present; behavior coverage must be verified per effect.                                              |
| `cities.json`      | `data/classic/cities.ruleset`      | Present.                                                                                             |
| `effects.json`     | `data/classic/effects.ruleset`     | Present; JSON parseability is covered by `RulesetLoader.effects.test.ts`.                            |
| `game.json`        | `data/classic/game.ruleset`        | Present.                                                                                             |
| `governments.json` | `data/classic/governments.ruleset` | Present.                                                                                             |
| `nations.json`     | `data/classic/nations.ruleset`     | Present.                                                                                             |
| `techs.json`       | `data/classic/techs.ruleset`       | Present.                                                                                             |
| `terrain.json`     | `data/classic/terrain.ruleset`     | Present.                                                                                             |
| `units.json`       | `data/classic/units.ruleset`       | Present.                                                                                             |
| —                  | `data/classic/actions.ruleset`     | No equivalent JSON data file identified; action coverage requires an explicit audit.                 |
| —                  | `data/classic/styles.ruleset`      | No equivalent JSON data file identified; client style/rendering coverage requires an explicit audit. |

The loader parses every `classic/*.json` file with `JSON.parse`, then validates it with Zod. Therefore comments are not valid in these data files. `RulesetLoader.effects.test.ts` loads every supported classic JSON ruleset and covers an effects pair ported from `effects.ruleset:262–278`. The classic effects file previously contained JavaScript comments and could not load; technologies also use `null` to represent an absent `root_req`.

## Packet inventory

### Current implementations

| Concern                           | CivJS location                                                               | Freeciv / freeciv-web reference                               |
| --------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Server packet enum and validation | `apps/server/src/types/packet.ts`                                            | `reference/freeciv/common/networking/packets.def`             |
| Server envelope dispatch          | `apps/server/src/network/PacketHandler.ts`                                   | `packets.def` handler directions                              |
| Client packet enum and reducers   | `apps/client/src/types/packets.ts`, `apps/client/src/services/GameClient.ts` | `reference/freeciv-web/javascript/packets.js`, `packhand.js`  |
| City production protocol          | `CityManagementHandler.ts`, `CityProductionHandler.ts`                       | `packets.def:825–849`, `freeciv-web/javascript/city.js`       |
| Turn protocol                     | `TurnManagementHandler.ts`, `TurnPacketService.ts`                           | `packets.def:1339+`, `freeciv-web/javascript/packhand_gen.js` |

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

## Prioritized next slices

1. **Packet contract foundation:** inventory all active packet-envelope registrations and named events, then choose one family for migration.
2. **City production:** make its declared structured packet path authoritative and test it against Freeciv `PACKET_CITY_CHANGE` semantics before removing the named-event path.
3. **Classic actions ruleset:** inventory `actions.ruleset` against `ActionSystem` and identify the first missing ruleset-driven action.
4. **Local smoke test:** automate create → join → nation select → start → map → unit action → end turn → reconnect.

## Action-system inventory

`ActionSystem` declares a broader action enum than it currently validates and executes. The current executable path covers fortify, sentry, wait, goto, found city, road/railroad/irrigation/mine work, pillage, terrain transformation, disband, and patrol. Several of those worker actions still have explicit map-integration TODOs. Diplomacy, espionage, transport, bombardment, paradrop, airlift, trade, and automation actions are declared but do not have a complete `ActionSystem` execution path.

The local ruleset has no `actions.json`; Freeciv’s action definitions remain in `reference/freeciv/data/classic/actions.ruleset`. The first action-focused port slice should therefore establish a data representation and choose one supported action whose rule legality, packet, state update, and client feedback can be verified end-to-end.

## Smoke-test status

`tests/integration/GameFlow.integration.test.ts` is the Milestone 0 server smoke test. It now covers a two-player game’s creation, nation assignment, start, map/visibility access, city founding, unit creation, research selection, turn advancement, and rejoin of an active player. It requires `TEST_DATABASE_URL` to point to an isolated PostgreSQL database.

## Update rule

Update this document when a family’s contract changes or an inventory row is resolved. Update `PORT_STATUS.md` only after a player-visible capability is verified end-to-end.
