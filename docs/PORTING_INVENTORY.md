# CivJS Porting Inventory

**Audit baseline:** Milestone 8 commit `9ea9d1e2` (2026-07-26).
**Purpose:** the evidence record for Milestone 0 in [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md). It distinguishes implemented transport/data from unported or unverified upstream behavior.

## Classic ruleset inventory

| CivJS JSON data    | Freeciv classic source                           | Status                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildings.json`   | `data/classic/buildings.ruleset`                 | Loaded and cross-validated; playable-loop costs, upkeep, production gates, defense, happiness, output, veteran/healing, and food retention have parity evidence.                                           |
| `cities.json`      | `data/classic/cities.ruleset`                    | Present.                                                                                                                                                                                                   |
| `effects.json`     | `data/classic/effects.ruleset`                   | Loaded, schema-constrained, cross-validated, and evaluated for the Milestone 1 playable loop.                                                                                                              |
| `game.json`        | `data/classic/game.ruleset`                      | Loaded; initial buildings, food/granary/city-center values, and classic bribe/incite cost parameters drive runtime behavior.                                                                               |
| `governments.json` | `data/classic/governments.ruleset`               | Loaded and cross-validated; playable-loop corruption, happiness, martial law, and support effects are active.                                                                                              |
| `nations.json`     | `data/classic/nations.ruleset`                   | Present.                                                                                                                                                                                                   |
| `techs.json`       | `data/classic/techs.ruleset`                     | Present; the research manager now uses the full loaded catalogue for costs, prerequisites, and flags.                                                                                                      |
| `terrain.json`     | `data/classic/terrain.ruleset`                   | Loaded; movement costs, base yields, and effect terrain context drive playable-loop calculations.                                                                                                          |
| `units.json`       | `data/classic/units.ruleset`                     | Loaded and cross-validated; values, classes/flags, movement, vision, upkeep, and combat contexts drive runtime behavior.                                                                                   |
| extras             | `data/classic/terrain.ruleset`                   | No standalone CivJS extras data file; terrain-derived extras and worker integration remain partial. Milestone 9 closes this data-authority gap.                                                            |
| requirements       | requirement clauses in the classic ruleset files | Effect requirement evaluation covers the requirement kinds currently present in `effects.json` and fails closed for unsupported or context-free clauses. Milestone 9 covers partial action/entity loading. |
| —                  | `data/classic/actions.ruleset`                   | No equivalent JSON file; exposed actions are manually audited against classic enablers. Milestone 9 loads the definitions and Milestone 11 closes enabled action gaps.                                     |
| —                  | `data/classic/styles.ruleset`                    | No equivalent JSON data file identified. Milestone 9 adds validated data and Milestone 12 verifies client consumption and rendering.                                                                       |

The loader parses every `classic/*.json` file with `JSON.parse`, then validates it with Zod. Therefore comments are not valid in these data files. `RulesetLoader.effects.test.ts` loads every supported classic JSON ruleset and covers an effects pair ported from `effects.ruleset:262–278`. The classic effects file previously contained JavaScript comments and could not load; technologies also use `null` to represent an absent `root_req`.

### Milestone 2 representative parity matrix

| Representative rule                                                                 | Loaded authority                   | Automated evidence                                                                                                    |
| ----------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Warriors values and Land class                                                      | `units.json`                       | `RulesetUnitsService.test.ts`, `RulesetMutation.test.ts`                                                              |
| Granary, Library, and Temple                                                        | `buildings.json`, `effects.json`   | `RulesetBuildingsService.test.ts`, `CityGrowth.test.ts`, `CityHappiness.effects.test.ts`, `CityRulesetValues.test.ts` |
| Alphabet → Pottery representative early research catalogue (both root technologies) | `techs.json`                       | `ResearchManager.test.ts`, `RulesetMutation.test.ts`                                                                  |
| Terrain movement and yields                                                         | `terrain.json`                     | `MovementConstants.test.ts`, `CityRulesetValues.test.ts`, `RulesetMutation.test.ts`                                   |
| Government corruption and Courthouse reduction                                      | `governments.json`, `effects.json` | `CityCorruption.effects.test.ts`                                                                                      |
| Fortification and City Walls defense                                                | `units.json`, `effects.json`       | `UnitManager.test.ts`                                                                                                 |
| Unit and terrain/extra vision                                                       | `units.json`, `effects.json`       | `VisibilityManager.test.ts`                                                                                           |
| Granary growth/starvation retention                                                 | `effects.json`, `game.json`        | `CityGrowth.test.ts`                                                                                                  |

`RulesetMutation.test.ts` copies `classic/` into a temporary base directory and
injects a fresh `RulesetLoader` into each affected boundary. Mutating an effect,
unit, building, technology, terrain, or game parameter changes the
corresponding result without modifying the process-wide singleton.

Effects without a verified authoritative consumer remain inert. The incite
action flow now consumes the classic cost parameters; requirement/effect
modifiers beyond the currently represented classic runtime context remain
fail-closed.

## Packet inventory

### Contract catalogue

The rows below inventory every currently registered CivJS gameplay transport. A
`named` row is a Socket.IO event; an `envelope` row is sent through the
`packet` event. “No direct equivalent” means CivJS-specific transport, not
unreviewed compatibility.

| Transport                                                                        | Direction                         | CivJS handler                                          | Client consumer                                                  | Upstream reference                                                                    | Automated evidence                                                                              |
| -------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SERVER_JOIN_REQ` / `SERVER_JOIN_REPLY` (envelope)                               | client ↔ server                  | `ConnectionHandler.ts`                                 | `GameClient.authenticatePlayer`                                  | `PACKET_SERVER_JOIN_REQ` / `PACKET_SERVER_JOIN_REPLY` in `packets.def`; `packhand.js` | `ConnectionHandler.test.ts`; `SocketGameFlow.integration.test.ts`                               |
| `GAME_CREATE` / `GAME_CREATE_REPLY` (envelope)                                   | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient.createGame`                                          | no direct one-packet equivalent; lobby flow is adapted from freeciv-web `game.js`     | `GameManagementHandler.test.ts`; `SocketGameFlow.integration.test.ts`                           |
| `join_game` (named)                                                              | client → server                   | `GameManagementHandler.ts`                             | `GameClient.joinGame`                                            | freeciv-web `game.js` lobby/join flow                                                 | `GameManagementHandler.nation-selection.test.ts`; `SocketGameFlow.integration.test.ts`          |
| `GAME_LIST` (envelope), `get_game_list` (named)                                  | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient.getGameList`                                         | freeciv-web `game.js`                                                                 | `GameManagementHandler.test.ts`                                                                 |
| `observe_game`, `delete_game` (named)                                            | client → server                   | `GameManagementHandler.ts`                             | `GameClient.observeGame`, `GameClient.deleteGame`                | no direct equivalent; CivJS lobby API                                                 | `GameManagementHandler.test.ts`                                                                 |
| `MAP_VIEW_REQ` / `MAP_VIEW_REPLY` (envelope)                                     | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.requestMapData`                                      | `PACKET_MAP_INFO`, `PACKET_TILE_INFO`; freeciv-web `packhand.js`                      | `SocketGameFlow.integration.test.ts`                                                            |
| `get_map_data`, `get_visible_tiles` (named)                                      | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.getMapData`, `GameClient.getVisibleTiles`            | freeciv-web map request flow                                                          | `SocketGameFlow.integration.test.ts`                                                            |
| `TILE_VISIBILITY_REQ` / `TILE_VISIBILITY_REPLY` (envelope)                       | client ↔ server                  | `MapVisibilityHandler.ts`                              | no current `GameClient` caller                                   | `PACKET_TILE_INFO`                                                                    | `MapVisibilityHandler` unit coverage pending feature use                                        |
| `UNIT_MOVE`, `UNIT_ATTACK`, `UNIT_FORTIFY`, `UNIT_CREATE` and replies (envelope) | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.moveUnit`, `attackUnit`, `fortifyUnit`, `createUnit` | `PACKET_UNIT_*` in `packets.def`; freeciv-web `unit.js`                               | `UnitActionHandler.test.ts`, `UnitMovement.integration.test.ts`                                 |
| `unit_action`, `path_request` / `path_response` (named)                          | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.executeUnitAction`, `PathfindingService`             | freeciv-web `unit.js`                                                                 | `UnitActionHandler.test.ts`, `ActionSystem.integration.test.ts`                                 |
| `CITY_FOUND` / reply, `CITY_PRODUCTION_CHANGE` / reply (envelope)                | client ↔ server                  | `CityManagementHandler.ts`                             | `GameClient.foundCity`; production envelope unused               | `PACKET_CITY_CHANGE` in `packets.def`; freeciv-web `city.js`                          | `CityProductionHandler.test.ts`, `CityManager.integration.test.ts`                              |
| `city:getAvailableProductions`, `city:changeProduction` and replies (named)      | client ↔ server                  | `CityManagementHandler.ts`, `CityProductionHandler.ts` | `GameClient.getAvailableProductions`, `changeProduction`         | freeciv-web `city.js`                                                                 | `CityProductionHandler.test.ts`, `GameClient.production.test.ts`                                |
| `city:configureGovernor`, `city:optimizeCitizens`, `city:buyProduction` (named)  | client ↔ server                  | `CityManagementHandler.ts`                             | `GameClient` city-management methods                             | freeciv-web `city.js`                                                                 | `CityManagementHandler.production.test.ts`; `GameClient.management.test.ts`                     |
| `RESEARCH_SET`, goal/list/progress and replies (envelope)                        | client ↔ server                  | `ResearchHandler.ts`                                   | `GameClient.setResearch`                                         | `PACKET_PLAYER_RESEARCH`; freeciv-web `research.js`                                   | `ResearchManager.test.ts`, `GameFlow.integration.test.ts`                                       |
| `government:getState`, `government:startRevolution` (named)                      | client ↔ server                  | `GovernmentHandler.ts`                                 | `GameClient.getGovernmentState`, `startRevolution`               | freeciv-web `government.js`; Freeciv `government.c`                                   | `GovernmentHandler.test.ts`; `GameClient.management.test.ts`; `TurnManager.test.ts`             |
| `economy:getTaxRates`, `economy:setTaxRates` (named)                             | client ↔ server                  | `EconomicHandler.ts`                                   | `GameClient.getTaxRates`, `setTaxRates`                          | freeciv-web `rates.js`                                                                | `EconomicHandler.test.ts`; `GameClient.management.test.ts`                                      |
| `END_TURN` / `TURN_END_REPLY`, `TURN_START`, `NEW_YEAR` (envelope)               | client ↔ server                  | `TurnManagementHandler.ts`                             | `GameClient.endTurn`, packet reducer                             | `PACKET_TURN_DONE`, `PACKET_BEGIN_TURN`, `PACKET_NEW_YEAR`                            | `TurnManager.test.ts`, `GameFlow.integration.test.ts`, `SocketGameFlow.integration.test.ts`     |
| `CHAT_MSG_REQ` / `CHAT_MSG` (envelope)                                           | client ↔ server                  | `ChatCommunicationHandler.ts`                          | `GameClient` packet reducer and notification feed                | `PACKET_CHAT_MSG_REQ`, `PACKET_CHAT_MSG`                                              | `GameClient.state-packets.test.ts`                                                              |
| border update/info events (envelope and named)                                   | server → client / client → server | `GameManagementHandler.ts`, `MapVisibilityHandler.ts`  | `GameClient` packet reducer                                      | `PACKET_BORDER_*`; freeciv-web map handlers                                           | `GameBroadcastManager.test.ts`; `GameClient.state-packets.test.ts`                              |
| diplomacy list/proposal/response/cancel/war/update (envelope)                    | client ↔ server                  | `DiplomacyHandler.ts`                                  | `GameClient`, `NationsPanel`                                     | Freeciv `diplhand.c`; freeciv-web `diplomacy.js`                                      | `DiplomacyManager.test.ts`; `GameClient.management.test.ts`; `GameClient.state-packets.test.ts` |
| host controls (named)                                                            | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient`, `GameOptionsPanel`                                 | CivJS multiplayer policy adapter                                                      | `GameManagementHandler.test.ts`; authorization in `GameManager`                                 |

The enum declarations in `apps/server/src/types/packet.ts` and
`apps/client/src/types/packets.ts` contain additional legacy or future packet
names. They are intentionally not counted as implemented transport until a
handler, client consumer, and test exist.

### Confirmed protocol risks

1. The server and client have separate `PacketType` enums. They already disagree on numeric values, including `GAME_INFO` (server `19`, client `16`), `PLAYER_INFO` (server `14`, client `13`), and the nation-selection sequence.
2. Neither current enum is a complete direct mapping of `packets.def`; for example, upstream defines `PACKET_GAME_INFO = 16`, `PACKET_MAP_INFO = 17`, and `PACKET_PLAYER_INFO = 51`.
3. Gameplay traffic uses both the structured `packet` envelope and named Socket.IO events. Examples of named-event flows are `join_game`, `get_map_data`, `unit_action`, `path_request`, and `city:changeProduction`.
4. Some structured packet types are declared but are not the path used by the client. City production is the clearest example: the client uses `city:changeProduction`, while the server also declares `CITY_PRODUCTION_CHANGE` and its reply.

Milestone 10 addresses all four protocol risks through a shared, versioned
contract and family-by-family compatibility migration.

### Active named-event inventory

The following named events bypass or supplement the `packet` envelope and must be accounted for before a family is migrated.

| Family                | Client → server                                                                          | Server → client                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Game lobby            | `join_game`, `observe_game`, `get_game_list`, `delete_game`, host pause/timer controls   | `game_created`, `game_started`, `game_deleted`, `game-control-changed`                                          |
| Map and borders       | `get_map_data`, `get_visible_tiles`, `border_info_request`, `request_full_border_update` | `map_data`, `border_change_notification`                                                                        |
| Units and pathfinding | `unit_action`, `path_request`                                                            | `path_response`, `unit_destroyed`, `unit_update`                                                                |
| Cities                | production, governor, optimization, and rush-buy events                                  | `city:availableProductions`, `city:productionChanged`, `city:updated`, `cities_updated`, `production:completed` |
| Government/economy    | government state/revolution and tax-rate events                                          | Socket acknowledgement payloads                                                                                 |
| Connection            | Socket.IO lifecycle and `packet`                                                         | `packet`, Socket.IO lifecycle                                                                                   |
| Diplomacy             | structured diplomacy packets                                                             | player-scoped diplomacy snapshots                                                                               |

The server’s structured packet registrations are in the connection, game-management, map-visibility, city-management, research, turn-management, unit-action, and chat handlers. Government and economic management currently use named events. Any migration must preserve the existing request validation and callback/error behavior for that family.

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

## Original prioritized slices

1. **Generic requirements and effects:** establish a validated representation
   for classic requirements and evaluate it in the player, city, unit, tile,
   technology, government, and action contexts used by the playable loop.
2. **Ruleset-driven values:** replace duplicated unit, building, technology,
   and effect constants with loaded classic ruleset data, backed by fixture
   parity tests.
3. **Classic actions ruleset:** continued as Milestones 9 and 11, which load
   `actions.ruleset` and close enabled action gaps.
4. **Client-browser smoke test:** continued as Milestone 12 with a defined
   browser-level compatibility suite.

## Action-system inventory

The executable action surface covers fortify, sentry, wait/skip, goto, found
city, road/railroad/irrigation/mine work, pillage, cleanup, terrain
transformation, disband, ruleset transport load/unload, and trade routes.
The client exposes only capability-appropriate core actions and routes target
selection through the map. Diplomats and spies additionally expose embassy,
investigation, technology theft, city-improvement sabotage, unit bribery,
incitement, poisoning, and unit sabotage through authoritative target flows.
Generic non-classic covert outcomes, bombardment, paradrop, airlift, and
automation actions remain outside the advertised playable catalogue.

Milestone 11 covers bombardment, paradrop, airlift, and applicable automation
when the loaded classic enablers permit them. Non-classic covert outcomes
remain intentionally excluded.

The local ruleset has no `actions.json`; Freeciv’s action definitions remain in
`reference/freeciv/data/classic/actions.ruleset`. Supported action exposure is
therefore maintained as an explicit audited mapping. Milestone 8 completed the
remaining classic covert outcomes through the existing `unit_action` contract;
generic non-classic covert outcomes stay unadvertised.

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
