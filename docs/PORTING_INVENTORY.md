# CivJS Porting Inventory

Technical evidence for the supported classic release. Use
[`PORT_STATUS.md`](PORT_STATUS.md) for player-visible scope and follow-up work,
and [`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md) for known behavioral defects.

## Ruleset and data coverage

Classic JSON data is generated from the checked-in Freeciv secfiles, loaded by
`RulesetLoader`, and validated with Zod and cross-file checks.

| Data                      | Classic coverage                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Buildings and wonders     | 68 definitions; costs, upkeep, production, effects, happiness, defense, healing, and requirements are consumed.                       |
| Cities and specialists    | City parameters plus all 3 classic specialists.                                                                                       |
| Effects and game settings | Classic effects, economy, research, combat, borders, culture, calendar, visibility, disasters, trade, treaties, and victory settings. |
| Governments               | All 6 classic governments, including corruption, happiness, martial law, and support effects.                                         |
| Nations                   | 571 nations, 2 nation sets, 11 nation groups, leaders, cities, flags, traits, conflicts, and initial items.                           |
| Technologies              | All 87 technologies with prerequisites, costs, flags, goals, and Future Tech.                                                         |
| Terrain and extras        | 14 terrains, 20 resources, 34 extras, 3 bases, and 3 roads, with movement, yields, transformations, and worker timing.                |
| Units                     | 52 units and 6 classes with requirements, roles, flags, movement, vision, upkeep, combat, veteran, and graphics data.                 |
| Actions and requirements  | 82 action enablers and shared range/negation-aware requirement evaluation.                                                            |
| Styles                    | 6 nation styles, 10 city styles, and 11 music styles.                                                                                 |

`ClassicGameRuleInventory`, `ClassicActionInventory`, and the catalogue tests
guard the converted inventory. `RulesetMutation.test.ts` verifies that runtime
behavior responds to changes in loaded ruleset data rather than a process-wide
singleton.

## Protocol coverage

The canonical `PacketType` contract covers active structured transport. Named
Socket.IO events remain as compatibility or lifecycle adapters.

| Family               | Representative traffic                                                             | Main handlers/consumers                                       |
| -------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Connection and lobby | join, create, list, observe, delete                                                | `ConnectionHandler`, `GameManagementHandler`, `GameClient`    |
| Map and visibility   | map snapshots, visible tiles, borders                                              | `MapVisibilityHandler`, map snapshot reducers                 |
| Units                | move, attack, fortify, create, actions, paths                                      | `UnitActionHandler`, `GameClient`, pathfinding service        |
| Cities               | founding, production, worklists, governor, citizens, buying, rename, sale, disband | `CityManagementHandler`, `CityProductionHandler`, city panels |
| Research and economy | research, goals, government, revolution, tax rates                                 | `ResearchHandler`, `GovernmentHandler`, `EconomicHandler`     |
| Turns                | end turn, start turn, new year                                                     | `TurnManagementHandler`, turn reducers                        |
| Chat                 | send and receive messages                                                          | `ChatCommunicationHandler`, notification/chat UI              |
| Diplomacy            | proposals, responses, cancellation, war, updates                                   | `DiplomacyHandler`, `NationsPanel`                            |
| Host controls        | pause, timers, game controls                                                       | `GameManagementHandler`, `GameOptionsPanel`                   |

Every active transport should have a direction, handler, client consumer,
validation, reply/error behavior, upstream mapping where applicable, and test
coverage. Legacy or future enum values are not counted as implemented until
those pieces exist.

### Protocol migration rule

Do not renumber deployed packet IDs in place. Add new structured flows beside
named compatibility events, migrate the client, retain the adapter during the
compatibility period, and negotiate a new protocol version before changing
numeric IDs.

## Action coverage

The classic action inventory covers fortify, sentry, wait, goto, founding and
joining cities, roads, railroads, irrigation, mines, cultivate, plant,
fortress, airbase, pillage, cleanup, transformation, disbanding, home-city
changes, upgrades, transport, trade, marketplace sales, Wonder help, airlift,
paradrop, exploration, worker automation, bombardment, and supported diplomat
and spy actions.

`ClassicActionInventory.test.ts` accounts for all 82 enablers and 64 distinct
classic action names. Actions that the classic ruleset does not enable remain
unadvertised; fixed-lobby civil war is recorded as inapplicable.

## Scoring and end-game coverage

| Area                           | Freeciv target                                                                                                                                                        | Current status                                                                                                                                                 | Completion evidence                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Victory evaluation and reports | Conquest/team, science arrival, culture, world peace, allied/scenario outcomes, durable final standings                                                               | Implemented for the supported CivJS condition set; reports persist and broadcast the winner, reason, turn, year, category breakdown, and standings             | `EndGameService.test.ts`, spaceship/culture/diplomacy fixtures, game-flow integration                                                                        |
| Civilization score             | `server/score.c`: citizens, adjusted/future technologies, great wonders, arrived spaceship, cumulative units built/killed, and culture with reference integer scaling | Implemented for the current supported state. CivJS calculates the referenced categories with integer truncation and uses persisted lifecycle/spaceship inputs. | `PlayerScoreService.test.ts` source-maps category weights, future technologies, and spaceship score; handler and end-game tests cover snapshots and reports. |
| End-turn/hard-cap ranking      | `rank_users(true)`: sum scores for living, non-surrendered members of each team                                                                                       | Implemented for the supported turn-limit condition; CivJS aggregates living members by team.                                                                   | `EndGameService.test.ts` source-maps team aggregation; standings and tie fixtures exercise the authoritative result.                                         |
| Live score transport           | Current authoritative civilization total in player/score reporting                                                                                                    | Implemented; live player information uses the same score service as standings.                                                                                 | `GameManagementHandler.test.ts`, `GameBroadcastManager.test.ts`, and score/replay fixtures.                                                                  |

Scoring is one of the source-mapped rule slices in
[`TEST_EVIDENCE_AUDIT.md`](TEST_EVIDENCE_AUDIT.md). It does not by itself
certify game-wide reference parity.

## Integration evidence

`GameFlow.integration.test.ts` covers the authoritative manager/database path.
`SocketGameFlow.integration.test.ts` covers two real Socket.IO clients,
creation, joining, map delivery, movement, combat, city founding, production,
research, 20 turns, restart recovery, reconnect, and a continued turn.

Both use an isolated PostgreSQL database. The disposable integration runner and
CI use PostgreSQL 16 and execute the complete integration suite.

## Maintenance

Update this document when a ruleset, transport family, action contract, or
verification boundary changes. Update `PORT_STATUS.md` only after a
player-visible capability is verified end to end.
