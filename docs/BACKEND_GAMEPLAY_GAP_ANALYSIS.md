# Backend Gameplay Gap Analysis

**Audit date:** 2026-08-11
**Reference revision:** Freeciv `main` at
`eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc` (`3.3.90.14-dev`)
**Scope:** CivJS's authoritative server gameplay logic compared with
`reference/freeciv/common/`, `reference/freeciv/server/`,
`reference/freeciv/ai/`, and the supported
`reference/freeciv/data/civ2civ3/` ruleset.

This audit intentionally excludes React/Canvas behavior and the
`reference/freeciv-web` client. It also does not treat the mechanical C2C3
evidence certificate as semantic equivalence; the certificate currently shows
62/62 actions, 12/12 gameplay surfaces, 3/3 active script hooks, and 98/98 raw
effect types with declared handlers.

## Method

The comparison used the pinned submodule revision, current generated C2C3
catalogues, the existing gameplay-gap and parity inventories, source-level
flag/effect searches, and the following checks:

```sh
npm run audit:civ2civ3-parity
npm run certify:civ2civ3-parity
node tools/convert-rulesets.mjs civ2civ3 --check --diff
```

The audit distinguishes confirmed missing server rules from known intentional
or scope-dependent differences. A feature-level test is not considered proof
of parity unless its observable behavior is tied to the current reference.

## Findings

| ID     | Backend surface                                                                                                                                       | Current status                                            | Reference evidence                                                                                                                                                                                                              | CivJS evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BG-001 | `RandomMovement` units start with normal movement and random movement is scheduled after player and AI actions.                                       | Resolved in this change; C2C3 backend coverage added      | `common/unit.c:1718-1727` initializes random-movement units with zero movement; `server/unittools.c:5110-5180` spends movement at the beginning of a new phase; `common/movement.c:688-690` rejects player-controlled movement. | `UnitManager.getUnitCreationValues()`, `UnitManager.moveUnit()`, `UnitManager.executeRandomMovement()`, `RandomEventsManager.processRandomUnitMovements()`, and `TurnPhaseService.executeBeginTurnPhase()` now preserve the source ordering and movement gate. The C2C3 Storm has no attack strength, so the C2C3 implementation closes its legal random-move path; generalized random-unit attacks remain outside the supported C2C3 surface. |
| BG-002 | `Flagless` units do not make contact and can be attacked regardless of diplomatic pacts; foreign flagless units remain non-allied for tile occupancy. | Resolved in this change; C2C3 backend coverage added      | `common/unit.c:382-392,1358-1375`; `server/plrhand.c:2371-2385`; `server/unithand.c:1231-1255,5033-5046`; `data/civ2civ3/units.ruleset:2899-2901`.                                                                              | `UnitManager.establishAdjacentContacts()`, combat hostility selection, destination/path occupancy, paradrop hostility, bombard/nuclear target checks, and `GameManager` city tile occupancy now apply Flagless semantics. C2C3 `Storm` carries `Flagless`.                                                                                                                                                                                     |
| BG-003 | Exact Freeciv default-AI decision parity is incomplete.                                                                                               | Partial; intentionally not claimed complete               | `reference/freeciv/ai/default/` contains substantially larger decision and scoring routines than the focused CivJS planners.                                                                                                    | `docs/AI_PORTING_INVENTORY.md` records the implemented planner surfaces but explicitly does not certify exact default-AI parity. Closing this requires subsystem-by-subsystem behavioral fixtures, not a safe mechanical rewrite.                                                                                                                                                                                                              |
| BG-004 | `Provoking` changes auto-attack target preference when the `autoattack` server setting is enabled.                                                    | Deferred; setting is outside the default active C2C3 path | `data/civ2civ3/units.ruleset:413-416` defines the flag as conditional on the auto-attack setting.                                                                                                                               | `docs/GAMEPLAY_GAPS.md` already records automatic attacks as scope-dependent; current new games do not enable that path.                                                                                                                                                                                                                                                                                                                       |

## Implementation and verification record

BG-001 and BG-002 are implemented and covered by focused backend regressions:

- `UnitManager.test.ts`: `allows a Flagless attacker to engage an allied foreign unit`, `treats a foreign Flagless unit as non-allied for stack entry and contact`, and `moves RandomMovement units to a legal adjacent tile during random events` (including zero initial movement and direct-move rejection).
- `RandomEventsManager.test.ts`: `processes random-movement units during begin-turn setup` and the blocked-destination case.
- `TurnPhaseService.recovery.test.ts`: `runs random movement after restoration and before player actions`.
- `GameManager.test.ts`: `counts a foreign Flagless unit as a city-tile occupier without hostility`.

The city-occupancy callback is updated in `GameManager.configureMultiplayerInstance` and
delegates to the tested `doesUnitOccupyCityTile` rule.
The older numbered entries in
[Gameplay Gaps](GAMEPLAY_GAPS.md) remain historical regression records and
should not be read as a complete audit of this upstream revision.
