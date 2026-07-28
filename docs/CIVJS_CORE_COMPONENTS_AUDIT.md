# CivJS Core Components Audit

High-level completeness rubric against the checked-in Freeciv reference implementation.

## Purpose

This document provides a component inventory for gap review. It does not perform detailed behavioral parity testing; it identifies the original game's major components and flags only high-level areas that appear incomplete, intentionally adapted, or not yet evidenced in the CivJS repository.

## Scope and status language

- **Reference baseline:** the vendored `reference/freeciv` tree, including `common/`, `server/`, `ai/`, `client/`, `data/`, `utility/`, `tools/`, and documentation.
- **CivJS evidence:** the current `apps/server`, `apps/client`, tests, docs, and converted classic ruleset data.
- **Implemented:** the component is visibly represented in the current codebase; this is not a claim of full Freeciv parity.
- **Partial:** a recognizable slice exists, but the original component family is broader or some runtime paths remain unresolved.
- **Gap candidate:** no obvious CivJS counterpart was found at this high level, or the area appears intentionally omitted from the current port scope.
- **Not assessed:** the component needs a focused follow-up audit; this is not proof of absence.

## Executive component map

| Component family               | What the original game contains                                                                                                                                         | CivJS evidence                                                                                                                                                                      | Rubric status                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Rulesets & content             | Buildings, cities, effects, game settings, governments, nations, technologies, terrain, units, extras, actions, requirements, styles, graphics, sound/music, scenarios. | Complete classic rules/data catalogues, Amplio2 baseline, and classic map-scenario library; no alternate playable rulesets, audio asset/playback system, or localization catalogue. | Partial — alternate rulesets, audio, localization, and scripted scenario state remain |
| World & map simulation         | Map topology, terrain, oceans, rivers, resources, extras, borders, visibility/fog, map generation, starting positions, climate/biomes, pathfinding.                     | Shared topology-aware map model, all classic generator modes, map scenarios, extras-driven borders, persistent fog memory, and authoritative movement-aware A* pathfinding.         | Implemented                                                                           |
| Turn & game lifecycle          | Turn phases, calendar/year, player readiness, simultaneous turn coordination, game start/pause/end, victory evaluation, replay/event history.                           | `TurnManager`, `TurnPhaseService`, `TurnProcessingService`, `CalendarService`, `EndGameService`, recovery flow.                                                                     | Partial                                                                               |
| Cities & population            | Founding, ownership/capture, city map, worked tiles, specialists, food/growth/starvation, production queues, buildings/wonders, happiness, corruption, trade, governor. | `CityManager` and city services, `CitizenManagement`, Economic system, city UI.                                                                                                     | Partial                                                                               |
| Units & military               | Unit types/classes, movement, combat, veteran levels, healing, support/upkeep, transports, bases, bombardment, visibility, orders, diplomacy actions.                   | `UnitManager`, `UnitManagementService`, `ActionSystem`, `UnitRenderer`, action coverage inventory.                                                                                  | Partial                                                                               |
| Research & governments         | Technology graph, prerequisites, research progress, goals, government types, revolution, taxation, corruption, martial law, effects.                                    | `ResearchManager`, `GovernmentManager`, `EconomicManager`, effects/requirements.                                                                                                    | Implemented                                                                           |
| Diplomacy & international play | Players/nations, treaties, embassies, proposals, alliances, ceasefires, war, diplomacy state, reputation/attitude.                                                      | `DiplomacyManager`, `DiplomacyHandler`, `NationsPanel`.                                                                                                                             | Partial                                                                               |
| AI & automation                | AI player lifecycle, city planning, production, research, diplomacy, military tactics, worker automation, exploration, advisors.                                        | `CivJSAIAdapter` and limited worker/explore automation; no broad AI subsystem equivalent found.                                                                                     | Gap candidate                                                                         |
| Networking & multiplayer       | Connection/session protocol, packets, request validation, broadcasts, lobby, observers, chat, synchronization, host controls, capability/version negotiation.           | Socket handlers, packet contract, `GameClient`/`GameTransport`, lobby and chat.                                                                                                     | Implemented                                                                           |
| Persistence & recovery         | Save/load, savegame formats, database/state persistence, replay, server restart, migration/versioning, game recovery.                                                   | Drizzle schema/migrations, `GameInstanceRecoveryService`, client savegame artifacts, integration coverage.                                                                          | Partial                                                                               |
| Client/UI & presentation       | Map GUI, city/dialog screens, unit actions, diplomacy, research, government, economy, reports, notifications, help, menus, input, tilesets.                             | React client, Canvas2D, GameUI, research and management panels, keyboard controller.                                                                                                | Partial                                                                               |
| Scripting & extensibility      | Lua/script core, server callbacks, ruleset scripting, modding APIs, scenario scripting, event hooks.                                                                    | Reference Lua exists; no comparable CivJS scripting runtime surfaced in the current source inventory.                                                                               | Gap candidate                                                                         |
| Tools & operations             | Server/client executables, command line, map editor, ruleset editor, mod installer, format converters, diagnostics, logging, profiling, packaging.                      | Conversion tools, Docker, integration runner, docs/release runbook; no full editor/tool suite equivalent.                                                                           | Partial                                                                               |

## Detailed high-level rubric

### Rulesets, data, and content authority

- **Ruleset loading and validation — Implemented for classic:** Parse, validate, and expose ruleset sections at runtime; preserve requirements, effects, flags, defaults, and cross-references.
- **Game constants and options — Implemented for classic:** Difficulty, pacing, map settings, victory conditions, diplomacy rules, costs, starting state, calendar, and server options.
- **Content catalogues — Implemented for classic:** Nations, governments, technologies, units, buildings, wonders, terrain, resources, extras, actions, specialists, and styles.
- **Visual presentation — Implemented for the accepted baseline:** Amplio2 supplies the built-in terrain, city, unit, extra, and flag graphics. The initial tileset-provider boundary preserves future format extensibility; additional tilesets are not required for current parity scope.
- **Audio and localization — Remaining:** Classic sound/music identifiers and music styles are preserved as data, but CivJS has no packaged soundset/musicset assets or complete playback integration. It also has no Freeciv-equivalent translation catalogues/runtime. Ruleset help text is preserved, while full help-browser coverage is tracked under Client/UI.
- **Scenarios and alternate rulesets — Partial:** CivJS packages ten classic Freeciv map scenarios and loads their metadata, topology, wrapping, terrain, resources, extras, rivers, and nation-compatible starts. Pre-created player/city/unit state and Lua scenario scripts remain lifecycle/scripting work, and no playable non-classic ruleset package is included.

#### Game constants and options — Implemented for classic

The complete top-level `classic/game.ruleset` structure is reproducibly converted into `classic/game.json`, schema-validated, and guarded by `ClassicGameRuleInventory`. Runtime consumers now cover every behavior selected by that file: initial state, city/economy and research rules, upkeep, combat and veterancy, airlift/paradrop policy, nuclear damage, borders, culture, calendar effects, visibility, disasters, all classic trade relationships and settlement bonuses, goods, treaty transfers, and cultural/world-peace victories.

Sections that classic deliberately disables or leaves empty remain inert, including illness, game-loss effects, named teams, locked server settings, and migration (the reference server defaults its separate migration setting to disabled). Generic alternatives not selected by classic—such as embassy-only small-wonder visibility, scaled combat veterancy, or nonzero nuclear-defender survival—belong to alternate-ruleset/server-setting breadth rather than gaps in classic `game.ruleset` execution.

**Parity evidence:** `ClassicGameRuleInventory` accounts for every converted top-level section with no remaining `partial` dispositions. The completion checkpoint passes client/server typechecks, 95 client tests, 918 server tests, lint, and production builds.

#### Content catalogues — Implemented for classic

The classic catalogue is reproducibly generated from the checked-in Freeciv secfiles, including recursive nation includes and multiline/translatable values. It contains all 571 nations, 6 governments, 87 technologies, 52 units, 68 buildings and wonders, 14 terrains, 20 resources, 34 extras, 82 action enablers, 3 specialists, 6 nation styles, 10 city styles, and 11 music styles. CivJS-only catalogue entries formerly mixed into the classic data have been removed.

The generated records preserve source requirements, flags, roles, classes, help text, graphics, raw source fields, and normalized runtime identifiers. `ClassicContentCatalogues.test.ts` guards the inventory counts, canonical identities, representative exact values, and absence of former extensions. The internal map-generation label `coast` remains a compatibility alias to classic Ocean and is not an extra catalogue terrain.

This closes the classic rules/data catalogue. Together with the accepted
Amplio2 visual baseline, the remaining reasons for the overall
`Rulesets & content` status being `Partial` are:

- pre-created scenario game state and scenario scripting;
- playable alternate rulesets beyond classic;
- packaged soundsets/musicsets and complete audio playback; and
- translation catalogues and localization runtime support.

Additional tilesets are intentionally optional rather than a current parity
gap. The provider architecture for future tilesets is documented in
[`TILESET_ARCHITECTURE.md`](TILESET_ARCHITECTURE.md).

### World, map, and spatial simulation

- **Map model — Implemented:** `MapTopology` is the shared authority for square, hexagonal, isometric, wrapped, and non-wrapped adjacency and distance. Map access, continents/oceans, borders, visibility, generation, rivers, starts, movement, and pathfinding consume that model. Terrain, resources, rivers, roads, railroads, improvements, transformations, ownership, and ruleset-defined territory-claiming extras are represented and persisted.
- **Map generation — Implemented:** Random, fractal, fracture, island, and fair-island generators run through topology-aware height, climate, polar, biome, ocean, river, resource, continent, start-position, retry, and validation passes. All five Freeciv start-position modes are supported. Generation is seeded and covered by deterministic behavioral parity contracts, including wrapped hex/isometric topology. Ten packaged map-only Freeciv scenarios load through the same map model.
- **Visibility — Implemented:** Per-player visible/explored state, shared vision, unit/city vision, topology-aware radius calculations, fog-filtered snapshots, and persistence are present. Actual per-tile observation timestamps are retained across fogging and recovery.
- **Movement and spatial actions — Implemented:** A* and accessible-tile searches use shared topology and the authoritative unit movement policy, including ruleset terrain and road/rail costs, unit-class restrictions, occupancy, zones of control, hostile cities/units, transport embarkation endpoints, and real movement-per-turn values. Goto, worker terrain/extras, airlift, paradrop, and action targeting use the same spatial state.

The World & map simulation family is `Implemented` at this rubric’s high-level
granularity. This status is supported by deterministic generator contracts,
topology, border-extra, visibility persistence, and movement-policy tests; it
does not assert byte-for-byte identity with Freeciv’s C PRNG or save every
possible ruleset-specific edge case from future parity testing. Scripted
scenario state remains tracked under Rulesets/content, Scripting, and
Persistence rather than as a map-simulation gap.

### Turn, lifecycle, and outcomes

- **Turn engine:** Turn start/end, phase boundaries, action ordering, simultaneous play coordination, deadlines, pause/resume, and reconnect semantics.
- **Calendar and progression:** Year/turn calculation, era pacing, research timeline, anarchy/revolution timing, and score/history chronology.
- **Game outcomes:** Conquest, spaceship/space race, diplomatic and other victory modes, defeat/elimination, end-game report, ranking, and hall of fame.
- **Event and replay model:** Authoritative event log, notifications, replay recording/playback, deterministic reconstruction, and post-game inspection.

### Cities, population, and economy

- **City lifecycle:** Founding, naming, ownership, capture, razing/disbanding, capital/special city state, and city visibility.
- **City production:** Queues, units/buildings/wonders, shields, buy/rush, conversion, progress, obsolescence, prerequisites, and production change.
- **Population and citizens:** Food box, growth/starvation, granary behavior, specialists, worked tiles, citizen moods, luxury/tax/science allocation, and governor optimization.
- **City effects and administration:** Buildings/wonders, happiness, corruption/waste, pollution/disasters, trade routes, output calculation, support, healing, and city defense.
- **Empire management:** City list, production overview, economy/rates, research overview, government, reports, and bulk management.

### Units, combat, and special actions

- **Unit lifecycle:** Creation, home city, upkeep, movement points, transport, loading/unloading, disbanding, upgrade, veteran status, healing, and deletion.
- **Combat resolution:** Attack/defense, terrain and city modifiers, fortification, veteran effects, bombardment, retreat/defeat, capture, and combat feedback.
- **Unit orders:** Wait, sentry, fortify, goto, patrol/explore, auto-worker, clean-up, transform terrain, build extras, pillage, and air/sea orders.
- **Specialist and covert actions:** Diplomat/spy actions, bribery, incitement, investigation, sabotage, poisoning, technology theft, embassy, and target validation.
- **Military infrastructure:** Bases, roads/railroads, airbases, airports, zones of control, supply/support, airlift, paradrop, and trade/transport units.

### Players, diplomacy, and AI

- **Player/nation model:** Nation identity, team, diplomacy state, capital, score, research, treasury, government, tax rates, and eliminated/observer state.
- **Diplomatic relations:** Embassy, treaties, ceasefire, peace, alliance, proposals, cancellation, shared vision, reputation, and diplomatic messaging.
- **AI players:** AI creation, personality/difficulty, city/economic planning, research, diplomacy, military movement/combat, tactical evaluation, and lifecycle.
- **Automation and advisors:** Worker automation, explore, city governor, tax/research advice, military advice, and player-facing recommendations.

### Client, UI, and user-facing systems

- **Core map client:** Map rendering, tilesets, city/unit/extra/border/fog layers, selection, hover, movement paths, animation, and live state updates.
- **Management screens:** Cities, production, research, government, economy/rates, nations/diplomacy, game options, reports, end-game, and history/score.
- **Interaction and feedback:** Action menus, target selection, confirmations, errors, notifications, chat, keyboard controls, accessibility/focus, and responsive layout.
- **Help and discoverability:** Ruleset help, unit/building/technology details, tooltips, keyboard shortcuts, onboarding, and contextual explanations.

### Server, protocol, persistence, and operations

- **Authoritative server:** Game instances, managers/services, validation, state ownership, broadcasts, event sequencing, and concurrency boundaries.
- **Protocol:** Packet definitions, serialization, request/reply correlation, errors, subscriptions, capability negotiation, versioning, and compatibility adapters.
- **Lobby and sessions:** Authentication/join, game creation, nation selection, observer flow, reconnect, host controls, game list, and chat.
- **Persistence:** Savegames, database state, schema migrations, restart recovery, transactional updates, backups, and compatibility between versions.
- **Testing and observability:** Unit/integration/e2e tests, deterministic fixtures, parity tests, logging, diagnostics, metrics, profiling, and release/runbook coverage.

### Scripting, modding, and tools

- **Scripting runtime:** Lua VM/script core, callbacks, hooks, access to game state, sandboxing, and script errors.
- **Modding surface:** Ruleset authoring, data validation, asset packaging, scenario scripting, custom actions/effects, and mod discovery/install.
- **Developer tools:** Map editor, ruleset editor, map converters, mod installer, command-line tools, packet/debug tools, and administrative controls.

## High-level gap candidates to resolve

- **AI breadth:** Determine whether CivJS is expected to support autonomous AI players, and if so define the AI lifecycle, decision systems, difficulty model, and tactical/economic coverage.
- **Scripting/modding:** Decide whether the reference Lua/script-core surface is in scope, intentionally replaced by JSON/services, or deferred. Record the decision explicitly.
- **Victory and end-game breadth:** Verify all original victory modes, defeat/elimination, score/history, and post-game reporting—not just the currently exercised game end path.
- **Persistence parity:** Verify full save/load and replay semantics, not only database restart recovery and client savegame artifacts.
- **Alternate rulesets/scenarios:** Confirm the intended scope beyond classic data, including scenarios, non-classic rulesets, and asset/style variants.
- **Client feature breadth:** Audit help, reports, history, diplomacy detail, city/empire management, accessibility, animation, sound/music, and polish against the original client surface.
- **Tooling/operations:** Decide which reference utilities/editors/mod-install workflows have CivJS equivalents or need explicit out-of-scope labels.

## Source anchors

- Reference implementation: `reference/freeciv/common`, `server`, `ai`, `client`, `data`, `utility`, `tools`, and `doc`.
- CivJS inventory: `docs/PORTING_INVENTORY.md`, `docs/PORT_STATUS.md`, `docs/CLIENT_ARCHITECTURE.md`, and `docs/PORTING_PLAYBOOK.md`.
- CivJS implementation areas: `apps/server/src/game`, `apps/client/src`, `tests`, `tools`, and converted ruleset data.
- This is a high-level architecture/component inventory. It intentionally does not claim line-by-line parity, exhaustive feature behavior, or completion of every row.
