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

| Component family               | What the original game contains                                                                                                                                         | CivJS evidence                                                                                                                                                                                                                                                                                                                                              | Rubric status                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Rulesets & content             | Buildings, cities, effects, game settings, governments, nations, technologies, terrain, units, extras, actions, requirements, styles, graphics, sound/music, scenarios. | Complete classic rules/data catalogues, Amplio2 baseline, and classic map-scenario library; no alternate playable rulesets, audio asset/playback system, or localization catalogue.                                                                                                                                                                         | Partial — alternate rulesets, audio, localization, and scripted scenario state remain |
| World & map simulation         | Map topology, terrain, oceans, rivers, resources, extras, borders, visibility/fog, map generation, starting positions, climate/biomes, pathfinding.                     | Shared topology-aware map model, all classic generator modes, map scenarios, extras-driven borders, persistent fog memory, and authoritative movement-aware A* pathfinding.                                                                                                                                                                                 | Implemented                                                                           |
| Turn & game lifecycle          | Turn phases, calendar/year, player readiness, simultaneous turn coordination, game start/pause/end, victory evaluation, replay/event history.                           | Authoritative queued turn processing, Freeciv-parity starting treasury and automatic initial research, persisted phase/event chronology and versioned replay checkpoints, recoverable deadlines, ruleset calendar, pause/resume, concession, and complete outcome/report flow.                                                                              | Implemented                                                                           |
| Cities & population            | Founding, ownership/capture, city map, worked tiles, specialists, food/growth/starvation, production queues, buildings/wonders, happiness, corruption, trade, governor. | City lifecycle, population, economy, production, administration, and server-authoritative batch actions are implemented. The remaining gap is advanced empire-management parity: richer report views, reusable worklist templates, multi-city production editing, and advanced batch/report workflows are not yet complete.                                 | Partial — city simulation implemented; advanced empire-management workflows remain    |
| Units & military               | Unit types/classes, movement, combat, veteran levels, healing, support/upkeep, transports, bases, bombardment, visibility, orders, diplomacy actions.                   | Core classic unit lifecycle, fueled-aircraft persistence/refueling/loss, movement, transport, best-defender combat, healing, veterancy, upkeep, Fortress defense, worker cleanup and construction, patrol, special/covert action resolution, visibility, airlift, paradrop, and nuclear consequences are server-authoritative and covered by focused tests. | Implemented                                                                           |
| Research & governments         | Technology graph, prerequisites, research progress, goals, government types, revolution, taxation, corruption, martial law, effects.                                    | All 87 classic technologies are server-authoritative and exposed in the playable tree, with full prerequisite/goal progression, first-discovery bonus research, persistent Future Tech, all six governments, ruleset unlocks, default revolution timing, taxation, corruption, martial law, and government effects.                                         | Implemented                                                                           |
| Diplomacy & international play | Players/nations, treaties, embassies, proposals, alliances, ceasefires, war, diplomacy state, reputation/attitude.                                                      | Persistent first contact and directional intelligence, complete two-sided treaty clauses, timed state transitions and cancellation, team/alliance rules, war-gated hostile actions, shared vision, incidents/reputation, authenticated protocol handling, events, and the full nations/treaty UI are server-authoritative and covered by focused tests.     | Implemented                                                                           |
| AI & automation                | AI player lifecycle, city planning, production, research, diplomacy, military tactics, worker automation, exploration, advisors.                                        | `CivJSAIAdapter` and limited worker/explore automation; no broad AI subsystem equivalent found.                                                                                                                                                                                                                                                             | Gap candidate                                                                         |
| Networking & multiplayer       | Connection/session protocol, packets, request validation, broadcasts, lobby, observers, chat, synchronization, host controls, capability/version negotiation.           | Socket handlers, packet contract, `GameClient`/`GameTransport`, lobby and chat.                                                                                                                                                                                                                                                                             | Implemented                                                                           |
| Persistence & recovery         | Save/load, savegame formats, database/state persistence, replay, server restart, migration/versioning, game recovery.                                                   | Drizzle schema/migrations, `GameInstanceRecoveryService`, client savegame artifacts, integration coverage.                                                                                                                                                                                                                                                  | Partial                                                                               |
| Client/UI & presentation       | Map GUI, city/dialog screens, unit actions, diplomacy, research, government, economy, reports, notifications, help, menus, input, tilesets.                             | React client, Canvas2D, GameUI, research and management panels, keyboard controller.                                                                                                                                                                                                                                                                        | Partial                                                                               |
| Scripting & extensibility      | Lua/script core, server callbacks, ruleset scripting, modding APIs, scenario scripting, event hooks.                                                                    | Reference Lua exists; no comparable CivJS scripting runtime surfaced in the current source inventory.                                                                                                                                                                                                                                                       | Gap candidate                                                                         |
| Tools & operations             | Server/client executables, command line, map editor, ruleset editor, mod installer, format converters, diagnostics, logging, profiling, packaging.                      | Conversion tools, Docker, integration runner, docs/release runbook; no full editor/tool suite equivalent.                                                                                                                                                                                                                                                   | Partial                                                                               |

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

- **Map model — Implemented:** `MapTopology` is the shared authority for square, wrapped, and non-wrapped adjacency and distance. Map access, continents/oceans, borders, visibility, generation, rivers, starts, movement, and pathfinding consume that model. Terrain, resources, rivers, roads, railroads, improvements, transformations, ownership, and ruleset-defined territory-claiming extras are represented and persisted.
- **Map generation — Implemented:** Random, fractal, fracture, island, and fair-island generators run through topology-aware height, climate, polar, biome, ocean, river, resource, hut, continent, start-position, retry, and validation passes. UI landmass, steepness, wetness, temperature, river, resource, hut, pole, tiny-island, topology, wrapping, and start-position settings reach generation and recovery. Fair maps stamp equivalent per-player-group island templates rather than retrying ordinary island maps. All five Freeciv start-position modes and their reference fallback order are supported. Generation is seeded and covered by deterministic behavioral parity contracts for supported square maps. Ten packaged map-only Freeciv scenarios load through the same map model.
- **Visibility — Implemented:** Per-player visible/explored state, immutable last-observed tile memory, shared vision, unit/city vision, topology-aware radius calculations, main/stealth/subsurface vision layers, fog-filtered map/city/border snapshots, and database recovery are present. Fogged tiles no longer reveal current terrain, extras, resources, ownership, or cities.
- **Movement and spatial actions — Implemented:** A* and accessible-tile searches use shared topology and the authoritative unit movement policy, including ruleset terrain and connected road/rail costs, zero-cost railroad edges, unit-class restrictions, occupancy, zones of control, hostile cities/units, transport embarkation endpoints, and real movement-per-turn values. Goto consumes the pathfinder's authoritative per-step costs, while accessible-tile search revisits a tile when a cheaper route preserves more movement. City working radii, founding distance, trade/corruption distance, diplomat adjacency, nuclear effects, retirement checks, worker terrain/extras, airlift, paradrop, and action targeting use the same topology authority.

The World & map simulation family is `Implemented` at this rubric’s high-level
granularity. This status is supported by deterministic generator contracts,
topology, border-extra, visibility persistence/layering, fair-map symmetry, map
option propagation, and movement-policy tests, plus the complete 956-test
server unit suite and 154-test database-backed integration suite; it
does not assert byte-for-byte identity with Freeciv’s C PRNG or save every
possible ruleset-specific edge case from future parity testing. Scripted
scenario state remains tracked under Rulesets/content, Scripting, and
Persistence rather than as a map-simulation gap.

### Turn, lifecycle, and outcomes

- **Turn engine — Implemented:** Turn start/end, strict phase boundaries, the shared priority/dependency action queue, serialized simultaneous readiness, automatic deadlines, host/disconnect pause and resume, and reconnect/restart recovery are authoritative. New games receive the reference default treasury, begin with an available research target, and preserve generated bulbs if a target ever becomes unset. Turn IDs bind phase and event records to the exact turn, and a phase containing subsystem errors cannot be committed as successful.
- **Calendar and progression — Implemented:** Ruleset calendar years/fragments, skip-year-zero behavior, effects-driven timeline pacing, research, economics, unit/city activity, culture, disasters, borders, revolutions, and score/history chronology advance through the ordered turn pipeline.
- **Game outcomes — Implemented:** Conquest, team/allied, cultural, world-peace, spaceship/science arrival, scenario-designated, concession/elimination, and maximum-turn score outcomes persist winners and detailed category standings in the end-game report. The server broadcasts both protocol and compatibility end-game messages.
- **Event and replay model — Implemented:** Every processed phase and structured event is durably associated with its turn. Versioned end-of-turn checkpoints contain calendar, city, unit, and research state; `GameReplayService` combines checkpoints with ordered actions, phases, and events for deterministic reconstruction and post-game inspection.

The Turn & game lifecycle family is `Implemented` at this rubric's high-level
granularity. This status is supported by timer recovery, duplicate/concurrent
end-turn, phase failure, calendar, outcome, replay-version, and database-backed
turn chronology coverage. New-game integration coverage asserts the reference
50-gold treasury, an automatically selected research target, and persisted
initial state. The 20-turn socket flow verifies city gold and science output,
cumulative treasury and bulbs, authoritative per-turn deltas sent to the UI,
and preservation of treasury and research across recovery. The completion
checkpoint passes 105 client unit tests, 967 server unit tests, and 154
database-backed integration tests. This does not claim identical Freeciv
server-command policy, score formula weighting, or client replay UI; those are
lower-level parity and presentation concerns rather than missing lifecycle
authority.

### Cities, population, and economy

- **City lifecycle — Implemented for the supported baseline:** Founding, naming and rename, ownership, capture and capture-time razing, capital/special-building state, fog-filtered visibility, and owner-requested disband are authoritative. Disband rejects the player's final city, cities containing wonders, and cities with supported units that must first be rehomed.
- **City production — Implemented:** Units, buildings, and wonders use ruleset prerequisites and obsolescence checks, authoritative shield stock, production-change penalties, rush-buy, completion, and population costs. Persistent worklists can be added to, removed from, reordered, and automatically advance after completion while preserving excess shields.
- **Population and citizens — Implemented:** Food boxes, growth, starvation, granary retention, citizen moods, specialists, and worked tiles are calculated and persisted. Owners can move workers to specialist jobs, move specialists back to specific workable tiles, change specialist jobs, run one-shot optimization, or configure the governor. City population display uses Freeciv's `size * (size + 1) * 5` thousand-citizen curve.
- **City effects and administration — Implemented for classic:** Buildings/wonders, happiness/disorder, corruption/waste, pollution/disasters, trade routes and settlement bonuses, output calculation, unit support/upkeep, healing, and defense are server-authoritative. City packets now report actual present and supported unit IDs; improvement sales credit the authoritative treasury and wonders cannot be sold.
- **Empire management — Partial:** The client exposes the city list, production/growth/economy overview, individual management, and bulk citizen optimization alongside economy/rates, research, and government screens. The server-authoritative batch production, worklist, governor, citizen optimization, buying, and selling paths are implemented. Remaining parity gaps are concentrated in the empire-management presentation/workflow layer: Freeciv's richer city-report columns and saved report views, saved/reusable worklist templates, multi-city production editing with staged review/commit, and equivalent advanced batch/report controls (including bulk filtering, sorting, and cross-city summaries) are not yet implemented. These are lower-priority UI/workflow gaps rather than missing city simulation authority.

**Focused evidence:** `CityProductionLifecycle.test.ts` covers worklist advancement, excess-shield retention, rush-buy stock, population-cost units, and final-citizen protection. `CityRulesetValues.test.ts` covers the Freeciv population curve plus present/supported units. `CityManagementHandler.production.test.ts` and `GameClient.management.test.ts` cover authenticated worklist, citizen, rename, sale, disband, and transport paths.

### Units, combat, and special actions

- **Unit lifecycle — Implemented for classic:** Creation, home city, upkeep, movement points, transport, loading/unloading, disbanding, upgrade, veteran status, healing, fuel, refueling, fuel-loss destruction, and deletion are authoritative and persisted. Existing pre-migration aircraft recover with their ruleset fuel maximum.
- **Combat resolution — Implemented for classic:** Attack/defense, terrain, city and Fortress modifiers, fortification, veteran effects, bombardment, defeat, stack death, capture, combat feedback, and authoritative selection of the strongest eligible defender in a hostile stack are implemented.
- **Unit orders — Implemented for classic:** Wait, sentry, fortify, goto, patrol, explore, auto-worker, pollution/fallout cleanup, terrain transformation, extra construction, and pillage execute through persisted orders. Patrol is exposed through mouse and keyboard target selection.
- **Specialist and covert actions — Implemented for classic:** Embassy, investigation, technology theft, sabotage, bribery, incitement, and poisoning have authoritative validation and outcomes. Action-specific success, interception, diplomat consumption, and spy escape are resolved separately, with veteran diplomatic units affecting the contest.
- **Military infrastructure — Implemented for classic:** Roads/railroads, bases, airports, zones of control, support/upkeep, airlift, paradrop, and trade/transport units are represented. Airbases refuel fueled aircraft, Fortresses apply their ruleset defense and regeneration benefits, and both protect against stack death.

**Focused evidence:** `UnitManager.test.ts` covers fuel/refueling/loss, fallout removal, Fortress defense, patrol targeting, stacked-defender resolution, combat, transport, healing, and covert probability/escape resolution. `GameManager.espionage.test.ts`, `UnitMovement.integration.test.ts`, `UnitSupportManager.calculateCityUnitSupport.test.ts`, `UnitContextMenu.specialActions.test.tsx`, and `ClassicActionInventory.test.ts` cover the surrounding server, client, and inventory contracts.

### Research and governments

- **Technology catalogue and age progression — Implemented:** The server loads all 87 classic technologies from the generated ruleset catalogue and sends that complete catalogue to the client research tree. The graph is fully reachable from the seven root technologies through the modern/end-game branches; players begin with the ruleset's empty initial-tech list rather than a CivJS-only free Alphabet.
- **Research lifecycle and goals — Implemented:** Research selection, prerequisite validation, bulbs and overflow, target-switch penalties, persistence/recovery, deterministic automatic selection, Great Library/Darwin effects, and long-term goals are authoritative. Goals select the next available prerequisite along the requested path instead of waiting until the final technology is directly researchable.
- **Bonus and post-tree research — Implemented:** The `Bonus_Tech` flag is awarded only to the first discoverer and follows classic `free_tech_method = Goal` behavior. After all classic advances, repeatable, numbered Future Tech research remains available with the classic Civ I/II cost progression and persisted completion count.
- **Governments and revolution — Implemented:** All six classic governments load from ruleset data. Monarchy, Republic, Communism, and Democracy unlock from their technology requirements; Anarchy and Despotism provide the baseline states. Revolution uses the default random one-to-five-turn Freeciv timing, persists its target across recovery, and refreshes city effects on completion.
- **Government economy and city effects — Implemented:** Authoritative tax/science/luxury rates, output bonuses and penalties, corruption/waste and government centers, martial law, unit support/upkeep, war unhappiness, ruler titles, and ruleset requirements are evaluated through the economic, city, and effects pipelines.

**Focused evidence:** `ResearchManager.test.ts` verifies the 87-technology catalogue, complete graph traversal, goal-path selection, first-discovery Philosophy handling, persistence behavior, and transition into repeatable Future Tech. `GovernmentManager.test.ts`, `GovernmentHandler.test.ts`, `TurnManager.test.ts`, `CityCorruption.effects.test.ts`, `CityHappiness.effects.test.ts`, `EconomicHandler.test.ts`, and `GameClient.research.test.ts` cover government availability/revolution, effects, rates, and the complete client research-tree contract.

### Diplomacy and international play

- **Contact and diplomatic intelligence — Implemented:** Unknown nations remain anonymized and unavailable for negotiation until adjacent units, city entry, or an embassy establishes contact. Contact memory expires unless renewed by interaction or embassy access, while permanent team relations are initialized as known and cannot be attacked or renegotiated.
- **Treaties and material exchange — Implemented:** Authenticated players can build, propose, accept, reject, and cancel multi-clause, two-sided agreements. Supported clauses cover ceasefire, peace, alliance, embassy, directional shared vision, technologies, gold, world maps, sea maps, and cities. Clause ownership, state transitions, treasury, technology, and city ownership are revalidated on acceptance.
- **State machine and pact rules — Implemented:** War, ceasefire, armistice, peace, alliance, and team relations have authoritative transitions. Ceasefires and armistices advance or expire during turn processing; alliance cancellation falls back through armistice; illegal military units are removed from foreign territory when peace completes. Senate restrictions, justified cancellation incidents, alliance-triangle validation, barbarian/no-diplomacy effects, proposal idempotency, and per-pair serialization are enforced.
- **International consequences — Implemented:** Only nations at war are hostile for attacks, bombardment, nuclear strikes, city capture, zones of control, pathfinding occupancy, and AI target selection. Alliance and team members can share space and vision. Covert incidents affect directional reputation and attitude, create a temporary reason to cancel, and feed player-visible diplomacy events and refreshed snapshots.
- **Persistence and consistency — Implemented:** Directional relations, proposals, timers, intelligence, reputation, and vision grants persist in the existing diplomacy state. Accepted material exchanges use player-scoped concurrency locks and transactional gold updates; city, technology, map, and gold changes roll back if any later transfer or relation persistence step fails.
- **Client workflow — Implemented:** The Nations panel exposes known diplomatic state, treaty timers, attitude/reputation, incoming proposal details, two-sided clause construction, valid state actions, pact cancellation, and directional vision cancellation without leaking unknown nation identity.

**Focused evidence:** `DiplomacyManager.test.ts` covers first contact, identity protection, proposal idempotency and serialization, directional and repeated clauses, material exchange, rollback, timed transitions, teams, senate restrictions, alliance cancellation, and incidents. `DiplomacyHostilityPolicy.test.ts`, `UnitManager.test.ts`, `CivJSAIAdapter.test.ts`, `GameManager.espionage.test.ts`, `DiplomacyHandler.test.ts`, `NationsPanel.test.tsx`, and `GameClient.management.test.ts` cover war-only hostility, allied movement, capture and strategic-attack gating, AI targeting, covert consequences, authenticated packets, and the complete client workflow.

### Players and AI

- **Player/nation model:** Nation identity, team, diplomacy state, capital, score, research, treasury, government, tax rates, and eliminated/observer state.
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
- **Client feature breadth:** Audit help, reports, history, city/empire management, accessibility, animation, sound/music, and polish against the original client surface.
- **Tooling/operations:** Decide which reference utilities/editors/mod-install workflows have CivJS equivalents or need explicit out-of-scope labels.

## Source anchors

- Reference implementation: `reference/freeciv/common`, `server`, `ai`, `client`, `data`, `utility`, `tools`, and `doc`.
- CivJS inventory: `docs/PORTING_INVENTORY.md`, `docs/PORT_STATUS.md`, `docs/CLIENT_ARCHITECTURE.md`, and `docs/PORTING_PLAYBOOK.md`.
- CivJS implementation areas: `apps/server/src/game`, `apps/client/src`, `tests`, `tools`, and converted ruleset data.
- This is a high-level architecture/component inventory. It intentionally does not claim line-by-line parity, exhaustive feature behavior, or completion of every row.
