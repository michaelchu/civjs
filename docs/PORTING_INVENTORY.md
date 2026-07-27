# CivJS Porting Inventory

**Audit baseline:** Milestone 10 working tree (2026-07-26).
**Purpose:** the evidence record for Milestone 0 in [`PORTING_PLAYBOOK.md`](PORTING_PLAYBOOK.md). It distinguishes implemented transport/data from unported or unverified upstream behavior.

## Classic ruleset inventory

| CivJS JSON data    | Freeciv classic source                           | Status                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildings.json`   | `data/classic/buildings.ruleset`                 | Loaded and cross-validated; playable-loop costs, upkeep, production gates, defense, happiness, output, veteran/healing, and food retention have parity evidence.                                                       |
| `cities.json`      | `data/classic/cities.ruleset`                    | Present.                                                                                                                                                                                                               |
| `effects.json`     | `data/classic/effects.ruleset`                   | Loaded, schema-constrained, cross-validated, and evaluated for the Milestone 1 playable loop.                                                                                                                          |
| `game.json`        | `data/classic/game.ruleset`                      | Loaded; initial buildings, food/granary/city-center values, and classic bribe/incite cost parameters drive runtime behavior.                                                                                           |
| `governments.json` | `data/classic/governments.ruleset`               | Loaded and cross-validated; playable-loop corruption, happiness, martial law, and support effects are active.                                                                                                          |
| `nations.json`     | `data/classic/nations.ruleset`                   | Present.                                                                                                                                                                                                               |
| `techs.json`       | `data/classic/techs.ruleset`                     | Present; the research manager now uses the full loaded catalogue for costs, prerequisites, and flags.                                                                                                                  |
| `terrain.json`     | `data/classic/terrain.ruleset`                   | Loaded; movement costs, base yields, and effect terrain context drive playable-loop calculations.                                                                                                                      |
| `units.json`       | `data/classic/units.ruleset`                     | Loaded and cross-validated; values, classes/flags, movement, vision, upkeep, and combat contexts drive runtime behavior.                                                                                               |
| `extras.json`      | `data/classic/terrain.ruleset`                   | Reproducibly converted and schema-validated: 34 extras, 20 resources, 3 bases, 3 roads, and terrain-specific removal settings. Loaded definitions drive worker timing; Milestones 11–12 complete action/rendering use. |
| requirements       | requirement clauses in the classic ruleset files | Effect requirements and all universal kinds present in the converted action, extra, and style data are schema-validated. The shared evaluator is range/negation aware and fails closed without context.                |
| `actions.json`     | `data/classic/actions.ruleset`                   | Reproducibly converted and schema-validated with all 82 enablers and action settings. Enablers drive current capability discovery; Milestone 11 implements remaining enabled action outcomes.                          |
| `styles.json`      | `data/classic/styles.ruleset`                    | Reproducibly converted and schema-validated with 6 nation, 10 city, and 11 music styles. City styles feed the existing API; Milestone 12 completes renderer and music consumption.                                     |

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
| `get_map_data`, `get_visible_tiles` (named compatibility)                        | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.getMapData`, `GameClient.getVisibleTiles`            | freeciv-web map request flow                                                          | `SocketGameFlow.integration.test.ts`                                                            |
| `TILE_VISIBILITY_REQ` / `TILE_VISIBILITY_REPLY` (envelope)                       | client ↔ server                  | `MapVisibilityHandler.ts`                              | `GameClient.getTileVisibility`                                   | `PACKET_TILE_INFO`                                                                    | `MapVisibilityHandler.test.ts`; `GameClient.protocol.test.ts`                                   |
| `UNIT_MOVE`, `UNIT_ATTACK`, `UNIT_FORTIFY`, `UNIT_CREATE` and replies (envelope) | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.moveUnit`, `attackUnit`, `fortifyUnit`, `createUnit` | `PACKET_UNIT_*` in `packets.def`; freeciv-web `unit.js`                               | `UnitActionHandler.test.ts`, `UnitMovement.integration.test.ts`                                 |
| `unit_action`, `path_request` / `path_response` (named)                          | client ↔ server                  | `UnitActionHandler.ts`                                 | `GameClient.executeUnitAction`, `PathfindingService`             | freeciv-web `unit.js`                                                                 | `UnitActionHandler.test.ts`, `ActionSystem.integration.test.ts`                                 |
| `CITY_FOUND` / reply, `CITY_PRODUCTION_CHANGE` / reply (envelope)                | client ↔ server                  | `CityManagementHandler.ts`                             | `GameClient.foundCity`, `GameClient.changeProduction`            | `PACKET_CITY_CHANGE` in `packets.def`; freeciv-web `city.js`                          | `CityProductionHandler.test.ts`, `GameClient.production.test.ts`                                |
| `city:getAvailableProductions`, `city:changeProduction` and replies (named)      | client ↔ server                  | `CityManagementHandler.ts`, `CityProductionHandler.ts` | availability caller; production compatibility adapter            | freeciv-web `city.js`                                                                 | `CityProductionHandler.test.ts`, `CityManagementHandler.production.test.ts`                     |
| `city:configureGovernor`, `city:optimizeCitizens`, `city:buyProduction` (named)  | client ↔ server                  | `CityManagementHandler.ts`                             | `GameClient` city-management methods                             | freeciv-web `city.js`                                                                 | `CityManagementHandler.production.test.ts`; `GameClient.management.test.ts`                     |
| `RESEARCH_SET`, goal/list/progress and replies (envelope)                        | client ↔ server                  | `ResearchHandler.ts`                                   | `GameClient.setResearch`                                         | `PACKET_PLAYER_RESEARCH`; freeciv-web `research.js`                                   | `ResearchManager.test.ts`, `GameFlow.integration.test.ts`                                       |
| `government:getState`, `government:startRevolution` (named)                      | client ↔ server                  | `GovernmentHandler.ts`                                 | `GameClient.getGovernmentState`, `startRevolution`               | freeciv-web `government.js`; Freeciv `government.c`                                   | `GovernmentHandler.test.ts`; `GameClient.management.test.ts`; `TurnManager.test.ts`             |
| `economy:getTaxRates`, `economy:setTaxRates` (named)                             | client ↔ server                  | `EconomicHandler.ts`                                   | `GameClient.getTaxRates`, `setTaxRates`                          | freeciv-web `rates.js`                                                                | `EconomicHandler.test.ts`; `GameClient.management.test.ts`                                      |
| `END_TURN` / `TURN_END_REPLY`, `TURN_START`, `NEW_YEAR` (envelope)               | client ↔ server                  | `TurnManagementHandler.ts`                             | `GameClient.endTurn`, packet reducer                             | `PACKET_TURN_DONE`, `PACKET_BEGIN_TURN`, `PACKET_NEW_YEAR`                            | `TurnManager.test.ts`, `GameFlow.integration.test.ts`, `SocketGameFlow.integration.test.ts`     |
| `CHAT_MSG_REQ` / `CHAT_MSG` (envelope)                                           | client ↔ server                  | `ChatCommunicationHandler.ts`                          | `GameClient` packet reducer and notification feed                | `PACKET_CHAT_MSG_REQ`, `PACKET_CHAT_MSG`                                              | `GameClient.state-packets.test.ts`                                                              |
| border update/info events (envelope and named)                                   | server → client / client → server | `GameManagementHandler.ts`, `MapVisibilityHandler.ts`  | `GameClient` packet reducer                                      | `PACKET_BORDER_*`; freeciv-web map handlers                                           | `GameBroadcastManager.test.ts`; `GameClient.state-packets.test.ts`                              |
| diplomacy list/proposal/response/cancel/war/update (envelope)                    | client ↔ server                  | `DiplomacyHandler.ts`                                  | `GameClient`, `NationsPanel`                                     | Freeciv `diplhand.c`; freeciv-web `diplomacy.js`                                      | `DiplomacyManager.test.ts`; `GameClient.management.test.ts`; `GameClient.state-packets.test.ts` |
| host controls (named)                                                            | client ↔ server                  | `GameManagementHandler.ts`                             | `GameClient`, `GameOptionsPanel`                                 | CivJS multiplayer policy adapter                                                      | `GameManagementHandler.test.ts`; authorization in `GameManager`                                 |

The canonical enum in
`apps/server/src/types/shared/packetContract.ts` also contains legacy or future
packet names. They are intentionally not counted as implemented transport
until a handler, client consumer, and test exist.

### Protocol convergence status

1. Client and server now import one `PacketType` enum, and a contract test pins
   unique deployed v1 identifiers. CivJS IDs intentionally remain distinct
   from upstream `packets.def` IDs until a negotiated protocol version changes.
2. Every active packet envelope records its direction, handler, consumer,
   schema where present, and upstream mapping where applicable.
3. Every remaining named event is classified in the same contract as
   lifecycle, notification, or version-1 compatibility traffic.
4. City production uses the structured packet path from the current client;
   the old named handler remains only for version-1 compatibility. The
   formerly caller-less tile-visibility packet now has a correlated client
   request and explicit success/error replies.

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

Do not renumber existing packets in place. Future migration should continue one
feature family at a time with a compatibility period.

1. Add any new active transport to the canonical contract.
2. For a named compatibility family, add the structured request/reply flow
   while retaining the named event as a thin compatibility adapter.
3. Add tests for request validation, authoritative state update, reply/error
   packet, and client state handling.
4. Migrate the client, then remove the adapter only after the inventory marks
   it unused.
5. Negotiate a new protocol version before changing deployed numeric IDs.

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

The local `actions.json` is generated from
`reference/freeciv/data/classic/actions.ruleset`; it is not a separately
maintained approximation. Milestone 9 uses its enablers for capability
discovery. Milestone 11 will connect the remaining enabled action families to
authoritative outcomes. Generic non-classic covert outcomes stay unadvertised.

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
