# CivJS Core Components Audit

High-level completeness review against the vendored Freeciv reference. This
document describes the supported classic release; it is not a line-by-line
parity report. Concrete gameplay defects are tracked in
[`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md).

## Status summary

| Component                  | Status                             | Notes                                                                                                                                                |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rulesets and content       | Partial                            | Classic rules/data and Amplio2 graphics are supported. Audio and localization remain. Alternate rulesets are out of scope.                           |
| World and map              | Implemented                        | Topology, generation, terrain, extras, borders, visibility, movement, and pathfinding are authoritative.                                             |
| Turns and lifecycle        | Implemented                        | Turn phases, calendar, readiness, pause/recovery, outcomes, and end-game reports are supported. Replay re-execution remains incomplete.              |
| Cities and population      | Partial                            | Core city simulation is implemented. Richer reports, reusable worklist templates, and advanced multi-city workflows remain.                          |
| Units and military         | Implemented                        | Classic unit lifecycle, combat, orders, transport, special actions, air, nuclear, and worker systems are represented. See gameplay gaps for defects. |
| Research and governments   | Implemented                        | Classic technologies, Future Tech, governments, revolution, rates, corruption, and effects are supported.                                            |
| Diplomacy                  | Implemented                        | Contact, treaties, material exchange, shared vision, incidents, and client workflow are supported.                                                   |
| AI and automation          | Implemented for classic/default AI | Native AI lifecycle, planning, military, diplomacy, automation, and advisor surfaces are present.                                                    |
| Networking and multiplayer | Implemented                        | Socket protocol, sessions, lobby, observers, reconnect, host controls, and chat infrastructure are present.                                          |
| Persistence and recovery   | Partial                            | PostgreSQL recovery and CivJS-native archives are supported. Event-stream replay is incomplete; Freeciv save compatibility is out of scope.          |
| Client and presentation    | Partial                            | Core map and management UI are present. Help, reports/history, accessibility, animation, audio, and polish need follow-up.                           |
| Scripting and modding      | Intentional exclusion              | JSON rulesets and server services are the supported extension boundary. Lua, scenario scripting, and general mod APIs are out of scope.              |
| Tools and operations       | Partial by design                  | Conversion, Docker, integration, diagnostics, and release tooling are supported. Full editors and mod installers are out of scope.                   |

## Supported classic baseline

The supported baseline includes:

- classic ruleset data, requirements, effects, actions, governments,
  technologies, units, buildings, nations, terrain, extras, and styles;
- procedural maps, topology-aware movement, visibility, borders, cities,
  population, economy, production, research, combat, workers, diplomacy,
  transport, airlift, paradrop, nuclear actions, and covert actions;
- native classic/default AI, simultaneous turns, pause/recovery, PostgreSQL
  persistence, Socket.IO multiplayer, and a React/Canvas client;
- conquest, science/space, cultural, world-peace, concession/elimination,
  maximum-turn, and score/report outcome handling where enabled by the current
  game configuration.

The classic catalogue and ruleset are generated and validated from the checked-in
reference data. Amplio2 is the accepted visual baseline. Additional tilesets
are optional and not a current release requirement.

## Remaining implementation work

- Add packaged audio/music playback and localization support.
- Complete richer city/empire reports, saved worklists, and advanced batch
  production/report workflows.
- Decide whether replay needs event-stream re-execution beyond checkpoint and
  archive inspection.
- Finish the client breadth review: help, reports/history, accessibility,
  animation, and presentation polish.
- Resolve the concrete behavioral issues listed in
  [`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md), including movement feedback, random
  events/barbarians, rally points, chat delivery, combat restrictions, worker
  rules, production validation, and missing effect behaviors.

## Intentional scope exclusions

- Non-classic/alternate rulesets and their asset/style variants.
- Freeciv savegame compatibility and importing CivJS archives as live games.
- Lua scripting, scenario scripting, general-purpose modding APIs, and mod
  discovery/install workflows.
- Full map/ruleset editors and general-purpose mod-authoring tooling.
- Scenario gameplay; the existing scenario assets and provider boundary are
  retained only for possible future work.

## Source anchors

- Reference: `reference/freeciv/common`, `server`, `ai`, `client`, `data`,
  `utility`, `tools`, and `doc`.
- CivJS: `apps/server`, `apps/client`, `tests`, `tools`, and converted ruleset
  data.
- Related docs: [`PORT_STATUS.md`](PORT_STATUS.md),
  [`PORTING_INVENTORY.md`](PORTING_INVENTORY.md), and
  [`GAMEPLAY_GAPS.md`](GAMEPLAY_GAPS.md).
