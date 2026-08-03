# CivJS C2C3 Implementation Inventory

This inventory describes the only supported runtime ruleset: Freeciv
`civ2civ3`. The source of truth is
`reference/freeciv/data/civ2civ3/`; generated files under
`apps/server/src/shared/data/rulesets/civ2civ3/` are the runtime projection.

## Ruleset boundary

`RulesetLoader` accepts C2C3 only. Game creation, recovery, API contracts,
scenario loading, client routes, and test fixtures use the same boundary. A
non-C2C3 saved game is rejected rather than translated.

The generated C2C3 catalogue currently contains:

| Data         | Source-derived inventory                                                     |
| ------------ | ---------------------------------------------------------------------------- |
| Terrain      | 14 terrain definitions                                                       |
| Units        | 57 units                                                                     |
| Buildings    | 73 buildings and wonders                                                     |
| Technologies | 87 technologies                                                              |
| Governments  | 9 governments                                                                |
| Nations      | 572 nations                                                                  |
| Extras       | 38 extras, including 5 bases and 4 roads                                     |
| Actions      | 89 enabled action enablers                                                   |
| Effects      | C2C3 effects and requirements evaluated by the authoritative effects manager |

`Civ2Civ3ContentCatalogues.test.ts`, loader validation, mutation tests, and
the converter check guard this projection. Runtime behavior must read the
loaded catalogue rather than duplicate a value in a compatibility constant.

## Gameplay and protocol surface

The authoritative server owns city, unit, map, research, diplomacy, economy,
AI, turn, and end-game state. The client consumes the protocol-v1 snapshot and
incremental packet contracts through Socket.IO.

Representative evidence is organized by subsystem:

- Cities and economy: output pipeline, growth, corruption, specialists,
  happiness, trade routes, support, and production lifecycle tests.
- Units and map: unit manager, movement, combat, visibility, terrain,
  pathfinding, borders, and action-system tests.
- Diplomacy and victory: diplomacy, action handlers, end-game, culture, and
  spaceship tests.
- AI: the default-AI mapping in [AI Porting Inventory](AI_PORTING_INVENTORY.md).
- Persistent flows: integration suites for game flow, recovery, and sockets.

## Parity evidence

A passing functional test proves a CivJS contract, not reference parity by
itself. Parity cases carry a precise Freeciv source path, line range, and
observable assertion. The evidence audit and differential oracle requirements
are defined in [Test Evidence Audit](TEST_EVIDENCE_AUDIT.md) and
[C2C3 Parity Baseline](CIV2CIV3_PARITY_BASELINE.md).

The current strict C2C3 evidence certificate covers all 62 enabled actions,
12 gameplay surfaces, 3 active ruleset script hooks, and 97 raw effect types.
Its exact interpretation and remaining semantic limitations are recorded in
[C2C3 Parity Audit](CIV2CIV3_PARITY_AUDIT.md); do not infer a whole-game
reference-parity claim from those coverage counts alone.

Update this inventory whenever the C2C3 data projection, supported action
surface, protocol contract, or evidence boundary changes.
