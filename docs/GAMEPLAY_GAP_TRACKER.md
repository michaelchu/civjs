# Classic Gameplay Gap Tracker

This document tracks gameplay behavior that exists in the Freeciv classic
reference but was missing or inert in CivJS. An item is complete only when its
runtime path and regression coverage are both present.

Reference baseline: `reference/freeciv/data/classic` and
`reference/freeciv/server`.

## Early-game economy and tile output

- [x] Automatically apply a road to eligible city-center tiles.
- [x] Apply road trade, river trade, and railroad shield bonuses to worked tiles.
- [x] Generate classic resources on their valid terrain, including ocean resources.
- [x] Read resource output modifiers from the converted ruleset instead of hardcoding them.
- [x] Use classic opening tax/science/luxury allocation and enforce government rate caps.
- [x] Assert food, shields, trade, science, gold, luxury, culture, and research in the
      20-turn game-flow test.

## City population and happiness

- [x] Preserve natural worker assignments so ordinary cities accumulate food and grow.
- [x] Enforce the size-8 Aqueduct and size-12 Sewer System growth gates.
- [x] Implement celebration detection and Republic/Democracy rapture growth.
- [x] Feed luxury output into citizen happiness.
- [x] Apply civil-disorder production restrictions before resources are accumulated.
- [x] Prevent two cities from working the same map tile.

## Government and ruleset effects

- [x] Apply Despotism/Anarchy tile-output penalties.
- [x] Apply Republic/Democracy trade bonuses and celebration tile bonuses.
- [x] Support ruleset-driven city size, tile-output, trade-route, pollution, and research
      effect families used by the classic ruleset.
- [x] Replace inert building/wonder entries with their classic effects, including Harbor,
      Offshore Platform, Aqueduct, Sewer System, Darwin's Voyage, and Great Library.

## Trade, research, pollution, and upkeep

- [x] Use the classic base of two trade routes, adding routes from Magnetism and
      The Corporation.
- [x] Apply the classic research-target switching penalty.
- [x] Apply population/production pollution rules and pollution-reducing buildings.
- [x] Resolve an unaffordable treasury by selling buildings or disbanding supported units.
- [x] Resolve shield-upkeep deficits by disbanding unsupported units.

## Verification

- [x] Focused unit tests cover each rule above.
- [x] The deterministic 20-turn integration test snapshots every turn and verifies food,
      shields, trade allocation, science, treasury, luxury, culture, and research transitions.
- [x] Server unit, integration, typecheck, formatting, lint, and build validation pass.

## Validation record

- Server unit tests: 75 suites, 879 tests passed.
- Server integration tests: 13 suites, 154 tests passed.
- Type-check, Prettier, lint, and production build passed.
