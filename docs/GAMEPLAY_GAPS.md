# Gameplay Gaps

Working log of gameplay behaviors that appear incomplete, confusing, or
different from the selected Freeciv reference behavior. This is intentionally a
discovery document: entries should be verified against the reference and then
promoted into implementation work or marked as an intentional CivJS design
choice.

The selected baseline is Freeciv's `civ2civ3` ruleset, which is also CivJS's
default for new games. Ruleset-specific claims must be checked against
`reference/freeciv/data/civ2civ3` and the converted
`apps/server/src/shared/data/rulesets/civ2civ3` data. Core engine behavior may
still cite Freeciv's common/server implementation, and inherited scripted
behavior may cite `reference/freeciv/data/default/default.lua`.

## How to add an entry

Record the player-visible symptom first, then capture the smallest reproducible
scenario. Link the relevant CivJS and reference implementation paths, and add a
regression test when the behavior is resolved.

Suggested status values:

- **Observed** — reproducible behavior, not yet triaged.
- **Confirmed gap** — reference comparison shows a missing or incorrect rule.
- **Planned** — implementation approach is agreed.
- **Resolved** — implementation and regression coverage are complete.
- **Intentional** — difference is documented and accepted as a CivJS choice.

## Open gaps

### GP-001 — Foreign border and city movement reports a generic path error

- **Status:** Confirmed gap
- **Area:** Movement, borders, diplomacy, pathfinding, client feedback
- **Observed behavior:** Selecting a unit's goto action toward a foreign city or
  foreign occupied tile can result in `No valid path found`. The player is not
  told whether the problem is terrain, a peaceful border, a foreign city, or an
  enemy unit. A military Go To aimed directly at a foreign city is now allowed
  to preview the route and returns a declare-war warning at execution time;
  foreign-unit and broader border cases remain unresolved.
- **Current implementation:** `UnitManager.getPathStepCost()` allows a
  city-capable military unit to use a foreign city as the final path tile, and
  `executeAuthoritativeGoto()` rejects a peaceful foreign-city entry with a
  specific declare-war message. Foreign cities/units remain blocked for other
  path contexts, and `MapCanvas` still turns failed path responses into the
  generic warning.
- **Reference behavior:** Freeciv distinguishes peaceful-border movement from
  foreign-city attacks. Military units attempting to enter peaceful foreign
  territory receive `Cannot invade unless you break peace with %s first.`;
  attempts to attack a foreign city without war receive `Cannot attack unless
you declare war first.` Civilian/border-entry units may enter permitted
  peaceful territory. Movement onto or adjacent to foreign cities/units can
  establish first contact.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/client/src/components/Canvas2D/MapCanvas.tsx`
  - `apps/server/src/game/managers/PathfindingManager.ts`
- **Freeciv references:**
  - `reference/freeciv/common/player.c` (`player_can_invade_tile`)
  - `reference/freeciv/common/movement.c` (`MR_PEACE`, `MR_NO_WAR`)
  - `reference/freeciv/server/unithand.c` (movement error notifications)
  - `reference/freeciv/server/plrhand.c` (`maybe_make_contact`)
- **Expected outcome:** Preserve path preview blocking where movement is
  illegal, but return a reason-specific result. The direct military foreign-city
  case should remain previewable and report that war must be declared before
  retrying the move. Distinguish the remaining peaceful military border entry,
  foreign-unit occupancy, and ordinary terrain/path failures. Apply the
  reference's civilian, allied, war, and border-entry rules.
- **Regression coverage:** Add server path/movement tests and a browser test
  asserting the player-visible message for peaceful territory and foreign-city
  attempts.

## Additional open gaps

### GP-002 — Barbarians never spawn during active games

- **Status:** Confirmed gap
- **Area:** Random events, barbarians, combat, map exploration
- **Observed behavior:** Games configured with barbarian activity never produce
  barbarian tribes or units during turn processing.
- **Reproduction:** Start a `civ2civ3` game with barbarians enabled and advance
  past the configured barbarian onset turn. No barbarian spawn is observed.
- **Current implementation:** `TurnManager` constructs `TurnPhaseService` with
  `randomEventsManager` set to `undefined`, so the random-events manager is not
  invoked. Independently, `BarbarianManager.attemptBarbarianSpawn()` hardcodes
  the spawn location to `null`, and `getOrCreateBarbarianPlayer()` always
  returns `null`.
- **Reference behavior:** Freeciv's random-events phase calls
  `summon_barbarians()`, which selects a valid wilderness location, creates or
  reuses a barbarian player, and creates barbarian units.
- **CivJS references:**
  - `apps/server/src/game/managers/TurnManager.ts`
  - `apps/server/src/game/services/TurnPhaseService.ts`
  - `apps/server/src/game/managers/RandomEventsManager.ts`
  - `apps/server/src/game/managers/BarbarianManager.ts`
- **Freeciv references:**
  - `reference/freeciv/server/srv_main.c` (`summon_barbarians`)
  - `reference/freeciv/server/barbarian.c`
- **Expected outcome:** Wire the random-events manager into active turn
  processing and implement valid spawn-location selection, barbarian-player
  creation/reuse, unit creation, diplomacy defaults, visibility updates, and
  player-visible notifications.
- **Regression coverage:** Add a turn-phase integration test that enables
  barbarians and verifies a successful spawn, persisted barbarian units, and
  hostile relations with regular players.

### GP-003 — City rally points cannot be set or applied

- **Status:** Confirmed gap
- **Area:** Cities, production, unit orders, client city management
- **Observed behavior:** The city interface has a rally-point data shape and
  display path, but every city response reports no rally point and newly
  produced units receive no rally orders.
- **Reproduction:** Attempt to configure or inspect a city's rally point. No
  server action exists to save orders, and the city payload always contains an
  undefined rally point.
- **Current implementation:** `CityDataService` hardcodes
  `rallyPoint: undefined`. There are no matching server handlers, city-manager
  methods, persistence fields, or production-completion hooks for rally-point
  orders.
- **Reference behavior:** Freeciv accepts city rally-point orders, sends them
  to the client, and copies the configured orders to newly created units.
  Non-persistent rally points are cleared after use; persistent rally points
  remain active until cancelled or the city changes ownership.
- **CivJS references:**
  - `apps/server/src/game/services/CityDataService.ts`
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/services/CityTurnProcessingService.ts`
  - `apps/client/src/components/GameUI/CityInfoOverlay.tsx`
- **Freeciv references:**
  - `reference/freeciv/server/cityhand.c` (`handle_city_rally_point`)
  - `reference/freeciv/server/cityturn.c` (rally orders on production)
  - `reference/freeciv/common/city.c` (`city_rally_point_receive`)
- **Expected outcome:** Add authoritative rally-order storage and validation,
  client controls, persistence, production-completion order assignment, and
  persistent/non-persistent lifecycle behavior.
- **Regression coverage:** Add server tests for setting, clearing, persisting,
  and applying rally points to produced units, plus a client test for the city
  control flow.

### GP-004 — Storm random movement is a no-op

- **Status:** Resolved
- **Area:** Random events, units
- **Observed behavior:** The `civ2civ3` Storm unit has `RandomMovement`, but
  random-event processing never moved it.
- **Reproduction:** Create a Storm in a `civ2civ3` game and advance turns. The
  Storm remains stationary unless another system moves it.
- **Current implementation:** `RandomEventsManager` now queries
  `UnitManager.getUnitsWithRandomMovement()` and executes a legal shuffled
  adjacent move for each eligible unit. `TurnManager` enables random movement
  processing for active games; movement persistence and lifecycle broadcasts
  use the normal authoritative movement path.
- **Reference behavior:** Freeciv processes random unit movement during the
  random-events phase. The `civ2civ3` Storm is explicitly flagged
  `RandomMovement`.
- **CivJS references:**
  - `apps/server/src/game/managers/TurnManager.ts`
  - `apps/server/src/game/managers/RandomEventsManager.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/server/srv_main.c` (`random_movements`)
  - `reference/freeciv/server/unittools.c`
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`RandomMovement`, Storm)
- **Expected outcome:** Wire the manager into turn processing and implement
  ruleset-driven random movement with legal destination selection, visibility,
  persistence, and player notifications.
- **Regression coverage:** Add a deterministic turn-phase test covering a
  `civ2civ3` Storm with legal and blocked destinations.

### GP-006 — Submarines can attack non-native tiles

- **Status:** Resolved
- **Area:** Combat, naval units, unit flags, terrain/native-tile rules
- **Observed behavior:** Combat validation checks attack strength, movement,
  range, and diplomatic hostility, but does not enforce the
  `Only_Native_Attack` restriction. Naval units can therefore attack targets on
  non-native tiles when the reference ruleset would reject the action.
- **Reproduction:** Use a `civ2civ3` Submarine and attempt to attack a unit on
  a non-native land tile.
- **Current implementation:** `UnitManager` validates the attacker's strength,
  movement points, and range but has no native-target check. The converted
  `civ2civ3` ruleset retains `Only_Native_Attack` on Submarines (and on
  non-attacking Caravels), but no authoritative combat path consumes it.
- **Reference behavior:** Freeciv rejects attack, wipe-unit, nuclear-unit, and
  ransom actions against non-native tiles unless the unit class permits
  non-native attacks and the unit does not have `Only_Native_Attack`.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/common/actions.c` (`can_attack_non_native` hard rules)
  - `reference/freeciv/common/movement.c` (`can_attack_non_native_hard_reqs`)
  - `reference/freeciv/data/civ2civ3/units.ruleset`
- **Expected outcome:** Apply native-tile and unit-class attack restrictions
  consistently to direct attacks, bombardment, nuclear unit attacks, suicide
  attacks, and ransom actions. Return a reason-specific failure to the client.
- **Regression coverage:** Add combat tests for Submarine attacks on native
  and non-native tiles, including a permitted non-native attack from a
  unit class with `AttackNonNative`.

### GP-007 — Transport destruction kills all cargo without evacuation

- **Status:** Resolved
- **Area:** Transport, cargo survival, unit loss, combat consequences
- **Observed behavior:** When a transport is destroyed, all cargo units are
  recursively destroyed immediately. Cargo is never given a chance to escape
  to another transport, a city, or a legal adjacent tile.
- **Reproduction:** Load multiple units into a transport, destroy the transport,
  and observe that every cargo unit is removed regardless of available rescue
  locations or unit priority flags.
- **Current implementation:** Transport loss now prioritizes `GameLoss` and
  `EvacuateFirst` cargo, then attempts compatible nearby transports, friendly
  cities, and legal adjacent tiles. Rescued cargo is detached and persisted;
  cargo without a legal destination is destroyed through the normal lifecycle
  notification path.
- **Reference behavior:** Freeciv first separates helpless and imperiled cargo,
  prioritizes `GameLoss` and `EvacuateFirst` units, attempts to rescue cargo,
  and only destroys units that cannot be saved.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/server/unittools.c` (`unit_lost_with_transport`)
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`EvacuateFirst`)
- **Expected outcome:** Implement transport-loss resolution with rescue
  candidates, priority ordering, legal-placement validation, cargo updates,
  and destruction notifications for units that cannot evacuate.
- **Regression coverage:** UnitManager tests cover legal-tile rescue, priority
  preservation of a `GameLoss` unit, and destruction when no legal evacuation
  location exists.

### GP-008 — Super Spies do not defend against diplomatic missions

- **Status:** Resolved
- **Area:** Espionage, diplomatic contests, city defense, unit flags
- **Observed behavior:** Diplomatic missions only consider defending units with
  the `Diplomat` flag. A `SuperSpy` without the `Diplomat` flag does not defend
  its city and does not receive the reference's guaranteed diplomatic-contest
  advantage.
- **Reproduction:** Place a Super Spy-type unit in a city and perform a
  diplomatic mission against that city. The mission-resolution path ignores
  the Super Spy unless it also has the `Diplomat` flag.
- **Current implementation:** `GameManager.executeDiplomatAction()` selects a
  defender by checking only `candidateType.flags?.includes('Diplomat')`. No
  Super Spy priority, guaranteed contest result, or non-diplomat city-defense
  behavior is applied.
- **Reference behavior:** Freeciv's `SuperSpy` flag always wins diplomatic
  contests except against another Super Spy, where the defender wins. It may
  also protect cities from diplomats when placed on a non-diplomat unit.
- **CivJS references:**
  - `apps/server/src/game/managers/GameManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`SuperSpy`)
  - `reference/freeciv/server/diplomats.c`
  - `reference/freeciv/common/combat.c`
- **Expected outcome:** Include Super Spy defenders in city diplomatic
  resolution, apply attacker/defender Super Spy precedence, preserve spy
  survival semantics, and report the correct mission outcome.
- **Regression coverage:** Add diplomatic-resolution tests for ordinary versus
  Super Spy attackers, Super Spy defenders, and Super Spy versus Super Spy
  contests.

### GP-009 — Damaged land and sea units retain full movement

- **Status:** Resolved
- **Area:** Unit movement, damage, turn processing, unit-class flags
- **Observed behavior:** Damaged units received their full base movement
  allowance at the start of every turn. Damage affected combat strength but did
  not slow movement.
- **Reproduction:** Damage a `civ2civ3` land or sea unit without destroying
  it, end the turn, and compare its restored movement points with an undamaged
  unit of the same type.
- **Current implementation:** `UnitManager.resetMovement()` passes current
  health into `getUnitMovementPoints()`. The selected ruleset's unit-class
  `DamageSlows` and `min_speed` values are applied before movement effects;
  unaffected classes retain their full movement.
- **Reference behavior:** Freeciv scales the base movement rate by current hit
  points for classes with `DamageSlows`, then enforces the class minimum speed
  and applies movement effects and veteran bonuses.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/services/RulesetUnitsService.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/common/movement.c` (`utype_move_rate`)
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`DamageSlows`)
- **Expected outcome:** Calculate restored movement from the unit's current
  health when its class has `DamageSlows`, including class minimum speed,
  veteran movement bonuses, and ruleset effects in the correct order.
- **Regression coverage:** Add movement-reset tests for full-health, damaged,
  critically damaged, and healing land/sea units, plus an unaffected class
  without `DamageSlows`.

### GP-010 — Attacks on cities do not cause civilian casualties

- **Status:** Resolved
- **Area:** Combat, cities, population, unit-class flags, ruleset effects
- **Observed behavior:** Attacking a unit in a city only damages or destroys
  combatants. The city's population is unchanged unless the city is captured,
  which follows a separate population-loss path.
- **Reproduction:** Successfully attack a defended city with a `civ2civ3`
  land unit without capturing the city and observe that its population does
  not decrease.
- **Current implementation:** Winning attacks and qualifying bombardment now
  evaluate the attacker's `KillCitizen` unit-class flag and the target city's
  `Unit_No_Lose_Pop` effects before applying one population loss through
  `CityManager`. The effect context includes city buildings and population,
  including the size-one protection requirement.
- **Reference behavior:** After a successful attack or bombard action, Freeciv
  reduces the target city's size by one when the attacker's class has
  `KillCitizen`, unless the server setting or `Unit_No_Lose_Pop` effect
  disables the casualty.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/server/unithand.c`
    (`unit_attack_civilian_casualties`)
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`KillCitizen`)
- **Expected outcome:** Apply ruleset-driven civilian casualties after
  qualifying attacks and bombardment, respect population-protection effects,
  handle size-one city destruction correctly, and broadcast the updated city
  or destruction result.
- **Regression coverage:** UnitManager tests cover a qualifying land attacker
  and `Unit_No_Lose_Pop` protection; bombardment uses the same casualty helper
  and remains covered by the existing bombardment action tests.

### GP-011 — Enemy troops do not block a city from working occupied tiles

- **Status:** Confirmed gap
- **Area:** Cities, citizen management, tile occupation, war, unit-class flags
- **Observed behavior:** A city can continue working and collecting output from
  a tile occupied by a hostile military unit.
- **Reproduction:** Assign a citizen to a non-center city tile, move an enemy
  land unit onto that tile during war, and process city output. The assignment
  remains usable and its output is retained.
- **Current implementation:** Workable tiles expose an `isBlocked` field and
  citizen allocation respects it, but production code initializes the field to
  `false` and no authoritative unit movement, diplomacy, or city-refresh path
  derives it from hostile occupants. The `DoesntOccupyTile` class flag is
  loaded but is not used for city tile availability.
- **Reference behavior:** Freeciv's city-work validation treats a tile as
  occupied when it contains a unit belonging to a player at war, except for
  unit classes with `DoesntOccupyTile`. The `civ2civ3` Missile, Air, Small
  Land, and Helicopter classes use that exception.
- **CivJS references:**
  - `apps/server/src/game/services/CityTileManagementService.ts`
  - `apps/server/src/game/systems/CitizenManagement/CitizenManagementService.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/services/RulesetUnitsService.ts`
- **Freeciv references:**
  - `reference/freeciv/common/unit.c` (`unit_occupies_tile`)
  - `reference/freeciv/common/city.c` (`city_can_work_tile`)
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`DoesntOccupyTile`)
- **Expected outcome:** Recompute workability when hostile units enter or leave
  a city radius and when diplomacy changes; unassign blocked workers, refresh
  city output, and exempt non-occupying unit classes.
- **Regression coverage:** Add city-output tests for hostile land occupation,
  allied and peaceful units, an enemy air or missile unit with
  `DoesntOccupyTile`, unit departure/destruction, and war-state changes.

### GP-012 — Losing a GameLoss unit does not eliminate its owner

- **Status:** Resolved
- **Area:** Unit loss, player elimination, scenarios, victory conditions
- **Observed behavior:** A unit carrying the `civ2civ3` `GameLoss` flag can be
  destroyed like an ordinary unit while its owner remains alive.
- **Reproduction:** Create a `civ2civ3` Leader for a player through a scenario or
  start-unit setup, destroy it in combat, and observe that the player remains
  active.
- **Current implementation:** Authoritative unit removal now recognizes
  `GameLoss` on unit-class or unit-type flags and invokes the game instance's
  elimination handler after persistence and lifecycle notification. The owner
  is marked not alive in memory and the database, then end-game evaluation runs.
  The selected `civ2civ3` ruleset has an empty `gameloss_style`, and CivJS has
  no editor-removal API, so there are no configured post-loss consequences or
  editor exemption to apply.
- **Reference behavior:** Freeciv marks the owner as dying whenever a
  `GameLoss` unit is removed outside the editor, then processes player death
  and the ruleset's optional civil-war, barbarian, or loot consequences. The
  `civ2civ3` Leader has this flag, although it is normally scenario/start-unit
  content rather than a buildable unit.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/services/EndGameService.ts`
  - `apps/server/src/game/managers/GameManager.ts`
  - `apps/server/src/game/ai/AIHunterPlanner.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/server/unittools.c` (`server_remove_unit`)
  - `reference/freeciv/server/srv_main.c` (dying-player processing)
  - `reference/freeciv/server/plrhand.c` (game-loss consequences)
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`GameLoss`)
- **Expected outcome:** Route all authoritative unit-removal reasons through
  `GameLoss` handling, eliminate the owner except for explicitly exempt editor
  removal, trigger end-game evaluation, and implement or deliberately scope
  the configured post-loss consequences.
- **Regression coverage:** UnitManager coverage exercises GameLoss cargo
  prioritization, direct removal, and destruction-handler dispatch; the fresh
  and recovered game wiring uses the same authoritative elimination callback.

### GP-013 — Every attack consumes all of the attacker's movement

- **Status:** Resolved
- **Area:** Combat, movement, ruleset effects
- **Observed behavior:** A surviving attacker always ends the action with zero
  movement, even when it began the turn with several movement points.
- **Reproduction:** Attack with a fast non-`OneAttack` unit after spending no
  movement. The unit cannot move or attack again after combat.
- **Current implementation:** `UnitManager.attackUnit()` unconditionally sets
  `attacker.movementLeft = 0`. The converted `civ2civ3` data retains
  `Action_Success_Actor_Move_Cost`, but the combat path does not evaluate it.
- **Reference behavior:** `civ2civ3` charges two moves (six fragments) for an
  ordinary attack. Units with `OneAttack` pay 65535 fragments and therefore
  lose all movement.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/managers/EffectsManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/effects.json`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/effects.ruleset`
    (`Action_Success_Actor_Move_Cost`)
  - `reference/freeciv/server/unithand.c`
- **Expected outcome:** Evaluate the action-success movement-cost effect and
  subtract that value rather than clearing all remaining movement.
- **Regression coverage:** Test attacks with fewer than, exactly, and more
  than six movement fragments remaining, including a `OneAttack` bomber or
  missile.

### GP-014 — Disbanding a unit into production recovers twice as many shields

- **Status:** Resolved
- **Area:** Units, city production, disbanding
- **Observed behavior:** `Disband Unit Recover` contributes the unit's full
  build cost to city production.
- **Reproduction:** Disband a 20-shield unit into a city's production and
  observe a 20-shield increase.
- **Current implementation:** `CityManager.recoverUnitShields()` is called
  with `unitType.cost`, and the success message reports that full value.
- **Reference behavior:** The `civ2civ3` ruleset applies
  `Unit_Shield_Value_Pct = -50` to `Disband Unit Recover`, yielding half the
  unit's shield value.
- **CivJS references:**
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/effects.ruleset`
    (`Unit_Shield_Value_Pct`)
  - `reference/freeciv/server/unithand.c` (`unit_shield_value`)
- **Expected outcome:** Derive recovered shields from the ruleset effect and
  use the same value for stock, persistence, and the player message.
- **Regression coverage:** Test even and odd unit costs and effect overrides.

### GP-015 — Help Wonder and production-recovery actions reject adjacent cities

- **Status:** Resolved
- **Area:** Unit actions, cities, action ranges
- **Observed behavior:** A caravan or disbanding unit must occupy the target
  city's center tile; selecting an adjacent city fails.
- **Current implementation:** `UnitManager.canPerformCityUnitAction()` requires
  exact equality between the unit and target coordinates.
- **Reference behavior:** `civ2civ3` configures both `Help Wonder` and
  `Disband Unit Recover` with a maximum range of one tile.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/actions.ruleset`
    (`help_wonder_max_range`, `disband_unit_recover_max_range`)
- **Expected outcome:** Validate these actions through their configured
  minimum and maximum ranges while still requiring an eligible target city.
- **Regression coverage:** Test same-tile, adjacent, and two-tiles-away
  targets on square and hex topologies.

### GP-016 — Marines cannot attack or conquer directly from transports

- **Status:** Resolved
- **Area:** Combat, transports, Marines, city capture
- **Observed behavior:** Every transported attacker is rejected before combat,
  including `civ2civ3` Marines.
- **Reproduction:** Load Marines on a transport beside a defended coastal city
  and attempt to attack from the transport.
- **Current implementation:** `UnitManager.attackUnit()` permits a transported
  attacker only when its unit type has the `Marines` flag. A surviving Marine
  that occupies the defeated defender's tile is detached from its transport;
  ordinary transported land units remain blocked.
- **Reference behavior:** `civ2civ3` has dedicated Marine attack and city-conquer
  enablers that permit a Marine to attack from a non-native transport tile.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/ai/AICityDangerPlanner.ts`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/actions.ruleset`
    (`enabler_attack_marines`, `enabler_conquer_city_marines`)
  - `reference/freeciv/common/movement.c`
- **Expected outcome:** Permit transport-origin attacks only when the action
  enabler and unit flags allow them, preserving ordinary cargo restrictions.
- **Regression coverage:** UnitManager tests cover Marine transport-origin
  victory/disembark and rejection of ordinary transported land attacks.

### GP-017 — Field units avoid war-unhappiness while stationed at home

- **Status:** Resolved
- **Area:** Happiness, military units, unit support
- **Observed behavior:** A military unit in its home city never contributes
  war unhappiness, even when its type has the `civ2civ3` `FieldUnit` flag.
- **Current implementation:** Support data now carries `isFieldUnit` from the
  ruleset unit flags, and `UnitSupportManager` applies military unhappiness
  when a military unit is away from home or has `FieldUnit`.
- **Reference behavior:** Freeciv applies aggressive-unit unhappiness when the
  unit is away from home _or_ has `FieldUnit`. `civ2civ3` Bombers, Stealth
  Bombers, and Nuclear units use that flag.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitSupportManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/units.json`
- **Freeciv references:**
  - `reference/freeciv/common/city.c` (`city_support`)
  - `reference/freeciv/common/unit.c` (`UTYF_FIELDUNIT`)
- **Expected outcome:** Carry ruleset flags into support accounting and apply
  government/effect-driven unhappiness to FieldUnits regardless of location.
- **Regression coverage:** UnitSupportManager tests cover home-stationed
  FieldUnits alongside the existing away-from-home and government-content
  cases.

### GP-018 — Ordinary escorts do not protect a Barbarian Leader from ransom

- **Status:** Resolved
- **Area:** Collect Ransom, barbarians, unit stacks
- **Observed behavior:** Collect Ransom destroys every barbarian unit on the
  target tile and pays ransom for every destroyed unit.
- **Reproduction:** Stack a Barbarian Leader with an ordinary barbarian
  warrior, collect ransom, and observe both units removed and both counted.
- **Current implementation:** `executeCollectRansom()` checks only that the
  target player is barbarian, then destroys the entire stack.
- **Reference behavior:** Every unit on the tile must have `ProvidesRansom`.
  Any ordinary escort protects the leader and makes the action illegal; in the
  `civ2civ3` ruleset only the Barbarian Leader provides ransom.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/tests/game/UnitManager.test.ts`
- **Freeciv references:**
  - `reference/freeciv/common/actres.c`
  - `reference/freeciv/data/civ2civ3/units.ruleset` (`ProvidesRansom`)
- **Expected outcome:** Validate the full stack, pay only for qualifying ransom
  units, and preserve protected leaders and escorts.
- **Regression coverage:** Test an unescorted leader, one escort, multiple
  leaders, and a non-barbarian target.

### GP-019 — Direct unit production selection bypasses build requirements

- **Status:** Confirmed gap
- **Area:** City production, technology, unit placement, ruleset requirements
- **Observed behavior:** A direct production request can select a unit that the
  city is not allowed to build.
- **Reproduction:** Select a late-game unit without its technology, a
  `NoBuild` unit, or a naval unit in an inland city through the authoritative
  production endpoint.
- **Current implementation:** `CityManager.setCityProduction()` verifies that
  a requested unit identifier exists but does not call `canCityQueueItem()`.
  Building selection and turn completion do use that stricter buildability
  check, so this bypass is specific to direct unit selection.
- **Reference behavior:** Freeciv evaluates the complete requirement vector,
  obsolescence, unit flags, uniqueness, build slots, and native terrain near
  the city before accepting or completing production.
- **CivJS references:**
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/services/CityTurnProcessingService.ts`
  - `apps/server/src/game/services/CityBuildingService.ts`
- **Freeciv references:**
  - `reference/freeciv/common/city.c` (`can_city_build_unit_*`,
    `can_city_build_improvement_*`)
- **Expected outcome:** Use one authoritative buildability evaluator for direct
  selection, worklists, AI choices, restoration, and completion.
- **Regression coverage:** Test technology, `NoBuild`, `BarbarianOnly`,
  obsolescence, `Unique`, and inland naval production through direct selection,
  queue selection, and turn completion.

### GP-020 — City names are neither player-unique nor ruleset-driven

- **Status:** Resolved
- **Area:** City founding, naming, nations
- **Observed behavior:** A player may found or rename multiple cities to the
  same name. The generic action path generates `New City (x,y)` rather than
  selecting the next nation city name.
- **Current implementation:** `CityManager.foundCity()` and `renameCity()` do
  not check existing city names; `ActionSystem.executeFoundCity()` constructs
  a coordinate-based name.
- **Reference behavior:** Freeciv defaults `allowed_city_names` to
  `PLAYER_UNIQUE` and selects suggested names from the player's nation list,
  with validation when a name is submitted.
- **CivJS references:**
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/systems/ActionSystem.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/nations.json`
- **Freeciv references:**
  - `reference/freeciv/common/game.h` (`GAME_DEFAULT_ALLOWED_CITY_NAMES`)
  - `reference/freeciv/server/cityhand.c`
  - `reference/freeciv/server/settings.c`
- **Expected outcome:** Enforce the configured uniqueness policy and integrate
  nation-name suggestions without preventing an allowed custom name.
- **Regression coverage:** Test founding and renaming collisions under each
  supported naming policy and exhaustion of a nation's name list.

### GP-021 — City transfer leaves supported and occupying units inconsistent

- **Status:** Confirmed gap
- **Area:** City capture, incitement, city gifts, unit ownership and support
- **Observed behavior:** Incitement transfers only former-owner units that are
  both supported by the city and within one tile. Supported units farther away
  keep a home-city ID that now points to an enemy city, while units physically
  inside the city but supported elsewhere remain behind.
- **Current implementation:** `GameManager` performs a narrow post-incitement
  filter. `CityCaptureService.transferCity()` changes city ownership and trade
  state but has no general unit-transfer/rehoming phase.
- **Reference behavior:** Freeciv transfers appropriate units in and near the
  city, rehomes supported units in other friendly cities, and removes units
  that cannot legally remain supported after transfer.
- **CivJS references:**
  - `apps/server/src/game/managers/GameManager.ts`
  - `apps/server/src/game/services/CityCaptureService.ts`
  - `apps/server/src/game/managers/CityManager.ts`
- **Freeciv references:**
  - `reference/freeciv/server/diplomats.c` (`diplomat_incite`)
  - `reference/freeciv/server/citytools.c` (`transfer_city_units`)
- **Expected outcome:** Centralize unit disposition for conquest, incitement,
  gifts, and scripted transfer, including cargo and home-city persistence.
- **Regression coverage:** Cover units in the city, nearby, far away, homeless,
  supported elsewhere, transported, and allied.

### GP-022 — Losing a capital neither relocates the Palace nor cancels its spaceship

- **Status:** Confirmed gap
- **Area:** Capital loss, wonders, spaceship, city destruction and capture
- **Observed behavior:** When a capital is captured or destroyed, the player
  can be left without a Palace while a launched or assembling spaceship
  remains unaffected.
- **Current implementation:** `CityManager` explicitly notes that
  `SaveSmallWonder`/`savepalace` are not modeled. No capital-loss path resets
  spaceship state.
- **Reference behavior:** The `civ2civ3` Palace is a `SaveSmallWonder`; with the
  default `savepalace` setting it is rebuilt for free in another city.
  Capital loss also destroys the player's started or launched spaceship.
- **CivJS references:**
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/services/CityCaptureService.ts`
  - `apps/server/src/game/services/EndGameService.ts`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/buildings.ruleset` (`SaveSmallWonder`)
  - `reference/freeciv/common/game.h` (`GAME_DEFAULT_SAVEPALACE`)
  - `reference/freeciv/server/citytools.c`
- **Expected outcome:** Add a single capital-loss hook that relocates saved
  small wonders and resets spaceship state before victory evaluation.
- **Regression coverage:** Test capture and destruction with one/no remaining
  city, savepalace enabled/disabled, and assembled/launched spaceships.

### GP-023 — City selling and rush-buy limits can be bypassed

- **Status:** Confirmed gap
- **Area:** City economy, building sales, rush production, turn state
- **Observed behavior:** A city can sell multiple improvements in one turn.
  After changing production, it can also rush-buy again, and a newly founded
  city can buy production immediately.
- **Current implementation:** City state has no `did_sell` or `did_buy` flag.
  `CityProductionService.canBuyProduction()` explicitly allows repeated buys
  and does not check the founding turn.
- **Reference behavior:** Freeciv allows one sale and one effective rush-buy
  per city per turn and forbids buying in a city founded that turn.
- **CivJS references:**
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/services/CityProductionService.ts`
- **Freeciv references:**
  - `reference/freeciv/server/cityhand.c`
    (`test_player_sell_building_now`, `really_handle_city_buy`)
- **Expected outcome:** Persist turn-scoped sale/buy markers, enforce them in
  every endpoint, and reset them in authoritative turn processing.
- **Regression coverage:** Test second sale, production changes after buying,
  newly founded cities, no-op buys, reloads, and next-turn reset.

### GP-024 — Fortified units lose fortification at every turn start

- **Status:** Resolved
- **Area:** Unit activities, defense, turn coordination
- **Observed behavior:** A fortified unit's defensive state is cleared when
  the next turn begins.
- **Current implementation:** `TurnCoordinationService.resetWaitingUnitsList()`
  sets `unit.fortified = false` for every fortified unit.
- **Reference behavior:** `ACTIVITY_FORTIFIED` persists indefinitely until an
  incompatible order, movement, transport change, or other explicit activity
  change cancels it.
- **CivJS references:**
  - `apps/server/src/game/services/TurnCoordinationService.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/common/unit.c`
  - `reference/freeciv/server/unittools.c`
- **Expected outcome:** Preserve fortified state across turns and clear it only
  through the same authoritative transitions that interrupt the activity.
- **Regression coverage:** Test turn rollover, movement, attack, transport,
  new orders, save/reload, and defensive bonus persistence.

### GP-025 — Sentry units never wake when an enemy is sighted

- **Status:** Confirmed gap
- **Area:** Unit orders, visibility, turn focus
- **Observed behavior:** Sentry sets `sentryUntil = enemy_sighted`, but no
  movement or visibility path consumes that condition, so the unit remains
  inactive and is not surfaced when enemies approach.
- **Current implementation:** The field is written by
  `UnitManager.processSentryOrder()` and read mainly for focus/AI filtering;
  only `turn_start` sentries are cleared.
- **Reference behavior:** Freeciv wakes sentried units when hostile units
  become visible nearby and interrupts orders when danger requires attention.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/services/TurnCoordinationService.ts`
  - `apps/server/src/game/managers/VisibilityManager.ts`
- **Freeciv references:**
  - `reference/freeciv/server/unittools.c` (sentry wake-up processing)
- **Expected outcome:** Evaluate sentry wake conditions after movement,
  visibility, diplomacy, and unit creation, then notify/focus the owner.
- **Regression coverage:** Test hostile, allied, hidden, transported, and
  out-of-range units plus save/reload.

### GP-026 — Espionage ignores repeat-theft state and target-selection rules

- **Status:** Confirmed gap
- **Area:** Diplomats, spies, technology theft, sabotage
- **Observed behavior:** Untargeted technology theft always picks the
  alphabetically first available technology; sabotage always removes the
  alphabetically first non-Palace building. Cities do not remember prior
  thefts, so repeat attempts never become harder or impossible.
- **Current implementation:** `GameManager` sorts candidate technologies and
  takes index zero; `CityManager.sabotageCityBuilding()` does the same for
  buildings. `CityState` has no theft counter.
- **Reference behavior:** Untargeted actions choose randomly from eligible
  targets, targeted Spy actions accept a selected technology/improvement, and
  each city's theft count increases later mission difficulty (ordinary
  Diplomats cannot steal from the same city again).
- **CivJS references:**
  - `apps/server/src/game/managers/GameManager.ts`
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/server/diplomats.c`
    (`diplomat_get_tech`, sabotage selection, `pcity->steal`)
- **Expected outcome:** Model targeted and untargeted action variants,
  eligibility and random selection, persisted theft history, mission
  difficulty, and player target-selection packets.
- **Regression coverage:** Test first/repeat theft by Diplomat and Spy,
  targeted/untargeted theft, production sabotage, indestructible buildings,
  and deterministic seeded random selection.

### GP-027 — Governments can be adopted without their required technology

- **Status:** Resolved
- **Area:** Governments, research, revolution
- **Observed behavior:** A player can initiate a revolution toward any loaded
  government regardless of researched technologies.
- **Current implementation:** `GovernmentManager.canChangeGovernment()` sees
  the ruleset requirements but deliberately returns `true` without checking
  the player's research or requirement effects.
- **Reference behavior:** Freeciv permits the change only when the government's
  requirements are satisfied, unless an `Any_Government` effect overrides
  them. Losing the enabling technology can also force a new government.
- **CivJS references:**
  - `apps/server/src/game/managers/GovernmentManager.ts`
  - `apps/server/src/game/managers/ResearchManager.ts`
- **Freeciv references:**
  - `reference/freeciv/common/government.c`
    (`can_change_to_government`)
  - `reference/freeciv/server/plrhand.c`
  - `reference/freeciv/server/techtools.c`
- **Expected outcome:** Evaluate government requirements against authoritative
  research/effects before revolution and after technology loss.
- **Regression coverage:** Test missing/present technology, wonder/effect
  overrides, revolution already in progress, and loss of an enabling tech.

### GP-028 — Worker actions bypass ruleset enablers and extra requirements

- **Status:** Planned
- **Area:** Unit context menu, workers, terrain alteration, technology, extras
- **Observed behavior:** Basic terrain checks are enforced, but actions such as
  railroad, oil-well mining, fortress, and airbase construction do not evaluate
  the full ruleset requirement vectors. The unit context menu also presents
  several worker actions solely because a unit has `canBuildImprovements`, even
  when the owning player lacks a required technology or the current tile cannot
  accept the resulting extra/activity.
- **Current implementation:** `ActionSystem` uses hand-written checks for
  movement, terrain times, adjacent irrigation sources, and a few unit flags.
  It has no research context and does not evaluate extra build requirements.
  `GameBroadcastManager` sends only coarse unit-type capabilities;
  `RulesetActionsService` deliberately considers static unit facts only; and
  `UnitContextMenu` hard-codes road, railroad, irrigation, mine, transform,
  and pollution-cleanup entries for every worker-capable unit. The client
  therefore cannot distinguish an action that the unit type may eventually do
  from one this unit may perform now.
- **Reference behavior:** Freeciv combines action enablers, `TerrainAlter`
  capabilities, extra requirements, technologies, unit flags, and tile state.
  For example, special oil mining and advanced extras have technology gates.
  Its unit-type action cache is only a coarse "may ever act" check; concrete
  action enablement is evaluated with the acting unit, player, and target
  context before the action is performed.
- **CivJS references:**
  - `apps/server/src/game/systems/ActionSystem.ts`
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/services/RulesetActionsService.ts`
  - `apps/server/src/game/orchestrators/GameBroadcastManager.ts`
  - `apps/client/src/components/GameUI/UnitContextMenu.tsx`
  - `apps/server/src/shared/data/rulesets/civ2civ3/extras.json`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/actions.ruleset`
  - `reference/freeciv/data/civ2civ3/terrain.ruleset`
  - `reference/freeciv/common/actions.c`
  - `reference/freeciv/common/unittype.c` (`utype_can_do_action`)
- **Expected outcome:** Route worker action availability and execution through
  the general ruleset requirement evaluator. Keep the server authoritative and
  use the same availability result to drive the context menu.

  Deferred implementation plan:

  1. Define a server-side action-availability service that accepts the acting
     unit plus authoritative owner research, unit state, current tile/extra
     state, and (where applicable) an explicit target. It should return the
     supported action IDs and a machine-readable reason for unavailable
     actions; it must evaluate action enablers and extra requirements through
     `RulesetRequirementEvaluator` rather than reproduce rules in the client.
  2. Make `ActionSystem` and `UnitManager` use that service as the final
     execution guard. Preserve dedicated behavior such as irrigation-source,
     movement, diplomatic, and target-selection checks by supplying them as
     facts or explicit post-requirement validators, not as a second unrelated
     availability model.
  3. Include a current-unit availability projection in the owner-only unit
     payload (or serve it through a dedicated owner-authorized query). Retain
     static unit-type capability data only for presentation that does not claim
     an action is currently executable.
  4. Replace `UnitContextMenu`'s hard-coded worker submenu and coarse action
     gates with the server projection. Hide unavailable self/current-tile
     actions; retain target-selection actions only when the unit can potentially
     perform them, then re-evaluate against the chosen target before execution.
  5. Refresh the projection after research completion, unit movement/activity,
     tile-extra/terrain changes, transport changes, and other state changes
     that can alter availability. Do not trust a stale client result at action
     execution time.

- **Regression coverage:** Add evaluator/service tests for each worker action
  before and after its technology, legal/illegal terrain, adjacency,
  duplicate/conflicting extras, unit flags, movement, and research-name
  normalization. Add execution tests proving unavailable actions are rejected
  even if requested directly. Add unit-packet tests for owner-only availability
  updates after research and tile changes, and client tests asserting that a
  worker's context menu hides unavailable entries while retaining eligible
  target-selection actions.

### GP-029 — Multiple workers cannot cooperate on the same activity

- **Status:** Confirmed gap
- **Area:** Worker activities, multi-unit coordination, activity progress
- **Observed behavior:** Each worker maintains an independent integer
  `turnsRemaining`; two workers building the same road or mine do not combine
  work and finish sooner.
- **Current implementation:** Activity progress is stored inside each unit's
  order and decremented independently. Completion simply adds the extra.
- **Reference behavior:** Freeciv stores accumulated activity work and sums the
  activity rates of compatible units on a tile, allowing workers to cooperate.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
- **Freeciv references:**
  - `reference/freeciv/common/unit.c` (`get_activity_rate`)
  - `reference/freeciv/server/unittools.c` (`activity_count`)
  - `reference/freeciv/common/clientutils.c`
- **Expected outcome:** Track shared compatible progress (or equivalent work
  points), account for unit/veteran rates, and resolve completion once.
- **Regression coverage:** Test one Worker, two Workers, Worker plus Engineer,
  a unit leaving mid-project, conflicting activities, and reload.

### GP-030 — Several goody-hut outcomes use different game consequences

- **Status:** Confirmed gap
- **Area:** Huts, barbarians, free cities, mercenaries
- **Observed behavior:** The barbarian hut roll destroys the exploring unit
  outright and spawns no horde. A failed free-city roll gives gold instead of
  nomad settlers, and mercenary selection filters by the explorer's unit class
  rather than using the `HutTech`/`Hut` role fallback sequence.
- **Current implementation:** `UnitManager.resolveHutReward()` implements a
  fourteen-way roll but substitutes these simplified consequences.
- **Reference behavior:** `civ2civ3` inherits Freeciv's default hut script,
  which unleashes barbarians unless protected by nearby-city/GameLoss/
  disabled-barbarian rules, creates a city or settlers based on terrain, and
  selects a legal role unit for mercenaries.
- **CivJS references:**
  - `apps/server/src/game/managers/UnitManager.ts`
  - `apps/server/src/game/managers/RandomEventsManager.ts`
- **Freeciv references:**
  - `reference/freeciv/data/default/default.lua`
  - `reference/freeciv/server/unittools.c` (`unit_enter_hut`)
- **Expected outcome:** Implement each scripted outcome and its eligibility,
  fallback, barbarian creation, visibility, and notification behavior.
- **Regression coverage:** Seed all fourteen rolls, including protected
  barbarian outcomes, poor city terrain, unavailable mercenaries, and GameLoss
  explorers.

### GP-031 — Eligible city captures never create partisans

- **Status:** Confirmed gap
- **Area:** City capture, partisans, governments, ruleset scripts
- **Observed behavior:** Capturing an eligible city never spawns partisan units
  for the losing player.
- **Current implementation:** No capture hook evaluates `Inspire_Partisans`;
  `EffectsManager` has no consumer even though the converted `civ2civ3` data
  retains the effect.
- **Reference behavior:** `civ2civ3` inherits the default partisan script,
  which evaluates local support, technologies, government, and
  `Inspire_Partisans`, then places a size-dependent number of Partisan-role
  units around the conquered city.
- **CivJS references:**
  - `apps/server/src/game/services/CityCaptureService.ts`
  - `apps/server/src/game/managers/EffectsManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/effects.json`
- **Freeciv references:**
  - `reference/freeciv/data/default/default.lua`
    (`_deflua_make_partisans_callback`)
  - `reference/freeciv/data/civ2civ3/effects.ruleset`
- **Expected outcome:** Evaluate the retained effect and execute the partisan
  behavior after conquest with legal placement and player notifications.
- **Regression coverage:** Test eligible governments/techs, original versus
  non-original owner, city sizes, no legal tiles, and non-conquest transfer.

### GP-032 — Pollution never accumulates into global warming

- **Status:** Confirmed gap
- **Area:** Pollution, climate, terrain transformation, global events
- **Observed behavior:** Pollution can appear and be cleaned, but leaving
  polluted tiles indefinitely never raises a warming risk or transforms world
  terrain.
- **Current implementation:** Runtime references to warming are limited to map
  generation terminology and ruleset help text; turn processing has no global
  warming or nuclear-winter state machine.
- **Reference behavior:** Freeciv accumulates warming/cooling pressure from
  pollution/fallout and periodically applies ruleset terrain transformations,
  with global notifications and persistent risk state.
- **CivJS references:**
  - `apps/server/src/game/services/TurnPhaseService.ts`
  - `apps/server/src/game/managers/CityManager.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/extras.json`
- **Freeciv references:**
  - `reference/freeciv/server/srv_main.c` (global warming and nuclear winter)
  - `reference/freeciv/server/maphand.c`
  - `reference/freeciv/data/civ2civ3/terrain.ruleset`
- **Expected outcome:** Add persistent global climate pressure, configured
  checks, terrain transformations, map/city refresh, and notifications.
- **Regression coverage:** Use deterministic thresholds to test accumulation,
  cleanup lag, warming, cooling, terrain eligibility, persistence, and
  disabled settings.

### GP-033 — Roads on desert and tundra tiles provide no trade

- **Status:** Resolved
- **Area:** Tile output, roads, terrain rules
- **Observed behavior:** A road adds one trade only when the terrain identifier
  is hard-coded as grassland or plains; `civ2civ3` desert and tundra roads
  receive no bonus.
- **Current implementation:** `CityTileManagementService.calculateCityOutputs()`
  checks `['grassland', 'plains']` instead of consuming the terrain's
  `road_trade_incr_pct`.
- **Reference behavior:** `civ2civ3` desert, grassland, plains, and tundra all
  configure a 100-percent road trade increment; the terrain ruleset determines
  the result.
- **CivJS references:**
  - `apps/server/src/game/services/CityTileManagementService.ts`
  - `apps/server/src/shared/data/rulesets/civ2civ3/terrain.json`
- **Freeciv references:**
  - `reference/freeciv/data/civ2civ3/terrain.ruleset`
  - `reference/freeciv/common/city.c` (`city_tile_output`)
- **Expected outcome:** Calculate road food, shield, and trade modifiers from
  terrain/extra data rather than terrain-name lists.
- **Regression coverage:** Test roads on every `civ2civ3` terrain and a mutated
  ruleset with non-default road output percentages.

### GP-035 — Civilization score and turn-cap ranking are not reference-compatible

- **Status:** Confirmed gap
- **Area:** Scoring, statistics, end-game ranking, persistence, replay
- **Observed behavior:** CivJS calculates a deterministic score, persists it
  during end-game evaluation, and uses it to select maximum-turn winners, but
  the formula is a CivJS approximation. Live `PLAYER_INFO` packets additionally
  report every player's score as zero.
- **Current implementation:** `EndGameService.buildStanding()` calculates
  `population * 10 + cities * 100 + current units * 20 + technologies * 50 +
history`. Maximum-turn resolution compares individual totals and awards
  every exact tie. `GameBroadcastManager.formatPlayerInfo()` hard-codes
  `score: 0`. Players do not persist the cumulative units-built,
  units-killed, and units-lost counters required by the reference, and the
  current spaceship state does not represent arrived-ship population or
  success rate.
- **Reference behavior:** `calc_civ_score()` derives score categories from
  authoritative player/city/research/unit/wonder/spaceship state.
  `get_civ_score()` totals citizens, twice the adjusted technology count, five
  points per great wonder, arrived-spaceship score, one point per ten units
  built, one point per three units killed, and one point per fifty culture.
  Future technologies contribute `floor(futureTechs * 5 / 2)` to the
  technology count before the two-times multiplier. Games interrupted by the
  configured end turn rank teams by the sum of living, non-surrendered member
  scores.
- **CivJS references:**
  - `apps/server/src/game/services/EndGameService.ts`
  - `apps/server/src/game/orchestrators/GameBroadcastManager.ts`
  - `apps/server/src/game/services/SpaceshipService.ts`
  - `apps/server/src/database/schema/players.ts`
  - `docs/AI_SIMULATION_MODE_IMPLEMENTATION_SPEC.md`
- **Freeciv references:**
  - `reference/freeciv/server/score.c` (`calc_civ_score`,
    `get_civ_score`, `get_spaceship_score`, `rank_users`)
  - `reference/freeciv/server/report.c` (score log and final score categories)
  - `reference/freeciv/common/player.h` (`player_score`)
- **Expected outcome:** Introduce one authoritative reference-parity score
  service shared by live standings, persistence, end-game evaluation, replay,
  diagnostics, and simulation hard-cap ranking. Persist cumulative unit
  lifecycle counters, count citizens/specialists and owned great wonders with
  reference semantics, port the missing spaceship scoring state, preserve
  integer truncation and future-tech weighting, aggregate hard-cap team scores,
  and broadcast the calculated total instead of zero. Additional report-only
  metrics may remain visible but must not alter the parity total.
- **Regression coverage:** Add fixtures for citizens and specialists, known and
  future technologies, great-wonder ownership/transfer, units built/killed/lost
  across recovery, culture scaling, incomplete/launched/arrived spaceships,
  individual and team hard-cap ranking, tie behavior, live packet/persisted
  score consistency, and replay/final-report consistency.

## Scope-dependent Freeciv behaviors to triage

These are potential gaps rather than confirmed `civ2civ3`-default regressions.
They should be promoted to numbered entries when CivJS commits to the
corresponding server setting or broader ruleset compatibility:

- **Automatic attacks:** Freeciv can autoattack after movement when the
  `autoattack` server setting is enabled; the Freeciv server default is
  disabled.
- **Configurable occupation chance:** Freeciv supports `occupychance` and
  action post-success rules; CivJS currently moves a surviving melee attacker
  into an emptied target automatically. This matches `civ2civ3`'s
  100-percent preset but not other configured values.
- **Spontaneous extras:** Freeciv can make extras appear or disappear during
  turn processing, but `civ2civ3` declares no `Appear`/`Disappear` extra and
  therefore does not exercise this behavior.
- **Alternate-ruleset combat actions:** `civ2civ3` exposes and CivJS
  implements bombard-capable units; additional non-native bombard and
  action-result combinations still need compatibility tests for other
  rulesets.
- **Generalized unit/building flags:** `BuildAnywhere`, `NoHome`, broader
  `Unique`, and ruleset-defined action movement costs need explicit
  compatibility tests beyond the selected `civ2civ3` data.
- **Post-GameLoss consequences:** Civil war, barbarian conversion, and loot
  styles are configurable consequences beyond the core elimination described
  in GP-012.
- **Optional city-name policies:** Team/global uniqueness and unrestricted
  naming should be supported if the corresponding Freeciv server setting is
  exposed.

Use this template for additional discoveries:

### GP-XXX — Short player-visible description

- **Status:** Observed
- **Area:**
- **Observed behavior:**
- **Reproduction:**
- **Current implementation:**
- **Reference behavior:**
- **CivJS references:**
- **Freeciv references:**
- **Expected outcome:**
- **Regression coverage:**
