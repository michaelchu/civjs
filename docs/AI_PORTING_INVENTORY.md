# Freeciv AI Porting Inventory

Behavioral parity target for the supported classic ruleset.

## Scope

The vendored Freeciv classic/default AI is the required baseline. The target is
behavioral compatibility through CivJS's authoritative managers, not a
line-for-line C translation. `CivJSAIAdapter` is transitional and must shrink
to orchestration as the subsystem ports below land.

Reference code is split between `reference/freeciv/ai/default`,
`reference/freeciv/ai/{difficulty,handicaps,aitraits}.c`,
`reference/freeciv/common/aicore`, and `reference/freeciv/server/advisors`.

Status language:

- **Implemented:** the authoritative runtime path and focused parity evidence
  exist.
- **Partial:** some behavior exists but the referenced decision model is not
  represented.
- **Missing:** no equivalent decision subsystem is wired into AI turns.

## Lifecycle and state

| Freeciv subsystem                                      | CivJS target                                                                              | Current status                                                                                                                                                                               | Completion evidence                                                           |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `classicai.c`, `daiplayer.c`, `daidata.c`, `daihand.c` | AI module/orchestrator, phase begin/end, per-player strategic cache, restart-safe state   | Partial — creation, turn invocation, recovery, game-end gating, versioned strategic state, relationship memory, assignments, and want caches exist; complete event callbacks do not          | New-game, restart-mid-phase, control-transfer, and multi-AI integration tests |
| `difficulty.c`, `handicaps.c`, `aitraits.c`            | Persisted difficulty, skill effects, fuzzy decisions, expansion/science/aggression traits | Partial — all release profiles, reference parameters/handicap sets, and four persisted traits exist; seeded fuzziness and every handicap consumer remain                                     | Per-level behavioral contracts and deterministic seeded tests                 |
| `aiiface.c`, `common/ai.h` callbacks                   | City/unit/player lifecycle and observed-state invalidation hooks                          | Partial — unit destruction and city destruction/capture immediately invalidate persisted tasks and city wants; creation, movement, control-transfer, and diplomacy incident callbacks remain | Callback ordering, control-transfer, and broader cache-invalidation tests     |

## Economy, cities, and technology

| Freeciv subsystem                                                                   | CivJS target                                                                                                | Current status                                                                                                                                                                                     | Completion evidence                                                       |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `daicity.c`, `daidomestic.c`, `daieffects.c`, advisor `advbuilding.c`/`advchoice.c` | Shared `want` model for units, buildings, wonders, defense, growth, happiness, economy, and delayed benefit | Partial — every legal ruleset unit/building receives an amortized domestic, expansion, defense, support, or military want; complete effect and wonder coordination remains                         | Exact scenario rankings and mutation tests proving ruleset-driven choices |
| `daitech.c`                                                                         | Technology wants aggregated from governments, units, buildings, effects, threats, and goals                 | Partial — unit, building, government, city-count, and military-pressure wants replace cheapest-only selection; recursive goal and obsolescence wants remain                                        | Classic tree scenario rankings and goal persistence                       |
| `daidata.c:dai_gov_value`, `daitools.c:dai_government_change`                       | Government evaluation and revolution timing                                                                 | Partial — legal upgrades and authoritative revolutions are selected; full output/effect valuation remains                                                                                          | Government-value fixtures and authoritative revolution integration        |
| `daihand.c` rates/spending                                                          | Tax/science/luxury adjustment, gold reserve, emergency rush-buy and building sales                          | Partial — deficit/unrest-aware rates use the authoritative economy manager; reserves, rush-buy, and sales remain                                                                                   | Deficit, celebration, war, research, and rush-buy fixtures                |
| city-management advisors                                                            | Citizen allocation, specialists, worklists, and governor use                                                | Partial — every AI city invokes the authoritative Freeciv-style citizen optimizer with starvation, happiness, growth, production, gold, science, and trait-sensitive constraints; worklists remain | Starvation, happiness, production, specialist, and worklist fixtures      |

## Expansion, infrastructure, and exploration

| Freeciv subsystem                                           | CivJS target                                                                                              | Current status                                                                                                                                                                       | Completion evidence                                                |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `daisettler.c`                                              | City-site desirability, travel-time amortization, overlap/threat checks, settler reservation and founding | Partial — legal sites are ranked by terrain yield, resources, spacing, danger, traits, and travel amortization, then pursued with persistent goto; multi-settler reservations remain | Deterministic map site-ranking and multi-settler reservation tests |
| advisor `autoworkers.c`, `infracache.c`                     | Per-tile improvement wants, dependency ordering, danger checks, worker reservation                        | Partial — generic persistent automation exists without AI prioritization                                                                                                             | Terrain/output improvement ranking and contention tests            |
| advisor `autoexplorer.c`, `daiunit.c:dai_switch_to_explore` | Information-value exploration and safe path selection                                                     | Partial — nearest reachable unexplored behavior                                                                                                                                      | Fog/information-gain and danger-aware exploration fixtures         |

## Military and special units

| Freeciv subsystem                          | CivJS target                                                                                                                    | Current status                                                                                                                                                                                                                                                        | Completion evidence                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `daimilitary.c`, `daiunit.c`, `daitools.c` | City danger, quadratic defense, combat odds/profit, target selection, travel amortization, attack/move/fortify and city capture | Partial — expected shield profit, strategic target value, travel amortization, ruleset unit selection, and authoritative multi-turn pursuit exist; full danger, retreat, stack, and capture planning remains                                                          | Defense requisition, odds, pursuit, capture, retreat, and stack-value fixtures |
| `daiguard.c`                               | Persistent guard/charge assignment for cities and vulnerable units                                                              | Partial — city danger uses quadratic defense, urgent threats receive persistent nearest-guard assignments, invalid charges are dismissed, stationed defenders fortify, and guards are withheld from offense; vulnerable-unit escorts remain                           | Assignment, invalidation, escort, and replacement tests                        |
| `daihunter.c`                              | Hunter role selection and high-value mobile target pursuit                                                                      | Partial — ruleset hunter roles qualify, visible hostile stacks receive cost/threat juiciness and travel scoring, and persistent targets are pursued through authoritative combat; missiles, intercept vectors, and production wants remain                            | Missile, intercept, production-want, and pursuit integration tests             |
| `daiferry.c`                               | Ferry demand, boat/passenger rendezvous, embarkation, beachhead and amphibious movement                                         | Partial — compatible naval transports are capacity/distance matched to persistent settle, attack, guard, and diplomat missions; pairs rendezvous, load, deliver, and unload through authoritative APIs; multi-passenger pooling and invasion beachhead scoring remain | Cross-ocean expansion, pooling, and invasion integration scenarios             |
| `daiair.c`                                 | Fuel-aware basing, strike evaluation, bombing, air defense, and refueling                                                       | Partial — aircraft reserve fuel for the nearest friendly city, return when necessary, and otherwise rank visible in-range stacks by shield/threat profit before authoritative bombard or attack; carrier bases, interception, and full refueling remain               | Carrier, interception, fuel, base, and target-value fixtures                   |
| `daiparadrop.c`                            | Safe and valuable paradrop target selection                                                                                     | Partial — ruleset-range paratroopers rank and jump into undefended hostile cities by size and improvements; allied reinforcement and tactical landing tiles remain                                                                                                    | Capture, reinforcement, threat, terrain, and range fixtures                    |
| `daidiplomat.c`, `daiactions.c`            | Diplomat defense/offense, espionage action and target selection                                                                 | Missing — action resolution exists                                                                                                                                                                                                                                    | Embassy, sabotage, incite, bribe, and survival-value fixtures                  |

## Diplomacy and advisors

| Freeciv subsystem | CivJS target                                                                                                                          | Current status                                                                                                                                                                                             | Completion evidence                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `daidiplomacy.c`  | Persistent love/war desire, threat and reputation evaluation, treaty valuation, proactive proposals, incidents and ceasefire strategy | Partial — persisted love, war desire, cooldowns, incoming clause valuation, and proactive cease-fire/peace/alliance proposals exist; complete threat, incident, reputation, and material valuation remains | Proactive and reactive multi-turn diplomacy scenarios |
| server advisors   | Shared tax, research, city, building, worker, exploration, and military recommendations for AI and human clients                      | Partial — automation/governor services exist; recommendations are incomplete                                                                                                                               | Advisor API tests plus player-visible client coverage |

## Required cross-cutting properties

- Decisions use loaded ruleset values and the same authoritative action paths as
  human players.
- AI knows only player-visible state subject to its configured difficulty
  handicaps; omniscience must be explicit and reference-backed.
- Tie-breaking and fuzziness are seedable so tests and replay remain
  deterministic.
- Long-running planning state, assignments, and diplomatic attitudes survive
  restart without duplicating actions.
- Expensive searches are bounded and cached with lifecycle invalidation.
- Each row moves to **Implemented** only with focused parity fixtures and at
  least one real-manager integration path; mocked adapter coverage alone is
  insufficient.
