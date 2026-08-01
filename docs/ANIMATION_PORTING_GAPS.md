# CivJS Animation and Presentation Porting Gaps

Implementation handoff for bringing the reference client’s player-visible map
animations into the active React/Canvas client. This document is organized as
independent work items so another AI can implement and verify the gaps one at a
time.

## Status and scope

**Status:** Audit completed; unit identity/activity indicators, combat presentation, virtual combat snapshots, camera recentering, transient markers, and reduced-motion handling are implemented in the active path. Remaining parity limitations are called out below.

**Target:** The active apps/client/src React/Canvas 2D client, using the existing
Amplio2 sprite provider and server-authoritative game state.

**Reference baselines:**

- reference/freeciv-web/javascript: browser client behavior and player-visible
  2D canvas behavior.
- reference/freeciv/client: native client animation model and timing semantics.

This is a presentation task. Animation must never become authoritative game
state, delay server resolution, or change combat, movement, visibility, or
destruction outcomes.

## Executive summary

The reference code contains these player-visible animations:

1. Smooth unit movement between map tiles.
2. Combat swords and explosion frame sequences.
3. Combat-time virtual units whose health bars decrease during battle.
4. Nuclear explosion animation.
5. Map recentering slide.
6. Animated territory-border line dashes and transient tile markers.
7. A continuously refreshed canvas loop that advances transient effects.

The active client already contains:

- smooth unit movement using a 180 ms cubic-eased translation;
- atlas-backed animated unit-selection frames with a procedural fallback;
- nation shields with ruleset-to-atlas graphic resolution and a neutral fallback;
- reference-positioned activity/status overlays such as sentry, fortify, goto,
  cargo, patrol, irrigation, mine, pillage, pollution, and fallout;
- HP, optional movement-point, veteran, and stack overlays;
- requestAnimationFrame continuation for movement and transient effects, plus a
  single 10 fps selection-pulse scheduler in MapCanvas.

The active client still has these parity limitations:

- movement transitions are renderer-detected rather than packet-queued, even
  though consecutive moves are now queued locally;
- the animation scheduler is renderer-owned rather than a reusable controller;
- non-combat destruction has no separate presentation timeline;
- the nuclear event path now carries server-authorized affected tiles, but
  legacy center-only events remain supported as a compatibility fallback;
- border animation is supported behind an option, but the active default keeps
  it disabled as in the current client configuration;
- the action-decision icon is renderer-ready, but the active server does not
  yet populate the reference `action_decision_want` state;
- a separate non-combat destruction timeline is still not ported.

The legacy JavaScript under apps/client/public/js/2dcanvas contains copied
reference combat frame tables and some animation logic, but
apps/client/index.html loads only /src/main.tsx. The active implementation is
therefore the TypeScript renderer, not the legacy tilespec.js runtime.

## Implemented in the current pass

The following changes are already in the working tree and should be treated as
the baseline for the next implementation pass:

- `NationPresentationService` resolves ruleset nation ids to atlas graphics;
  for example, `roman` becomes `rome`, so the client requests
  `f.shield.rome` instead of the nonexistent `f.shield.roman`.
- Player live packets and snapshot packets carry the optional
  `nationGraphic`. UnitRenderer uses it for own and foreign units, tries normal
  and large shield assets, follows the movement offset, and draws a neutral
  fallback when no asset exists.
- UnitRenderer accepts object-shaped server activities and maps the active
  worker/automation values to the copied Amplio2 activity sprites, including
  ruleset activity-target graphics such as farmland, oil mine, fortress,
  airbase, buoy, irrigation, and mine variants.
- UnitRenderer now uses the reference activity offset (`+55, -25`), draws
  connect/cargo/action-decision cues when the corresponding state exists, and
  adds atlas HP, movement-point, veteran, stack-ring, and stack-count overlays.
- The ruleset presentation endpoint now carries the reference per-unit UO
  placement offsets, including main-unit, shield, veteran, and stack variants;
  UnitRenderer applies those offsets from the tile origin before the movement
  translation.
- Unit selection prefers `unit.select0..3` atlas frames and uses the single
  MapCanvas atlas-cadence scheduler for that animation; custom-diamond
  rendering remains the fallback for incomplete tilesets.
- `PresentationEffectRenderer` renders elapsed-time swords/explosion and
  nuclear/marker tile effects, with fallback bursts and MapRenderer frame
  continuation. Nuclear events can render each server-authorized affected
  tile. Effects are visibility-scoped by the server and deduplicated by server
  event ID; the direct attack reply is correlated separately with its matching
  broadcast.
- Combat events now carry pre-destruction combatant snapshots and final HP;
  the Canvas creates temporary visual units and interpolates their health until
  the effect completes.
- The authoritative UnitManager now emits combat presentation events for every
  combat caller, including AI and turn-processing attacks; the direct service
  path retains a fallback for isolated managers/tests.
- Programmatic recentering now uses a 700 ms cubic-eased viewport slide,
  commits the latest rendered viewport before a drag takes over, and creates a
  timed reference-style marker for empty focus tiles.
- The existing reduced-motion preference now short-circuits unit movement,
  camera slides, border motion, selection pulsing, and transient-effect
  continuation while preserving a final visual frame.
- BorderRenderer exposes an optional moving-border animation state to the
  MapRenderer scheduler without forcing a permanent render loop.

These are intentionally simplified presentation effects. Combat virtual units,
health interpolation, programmatic camera slides, transient markers, and the
reduced-motion policy are now present; the remaining limitations below identify
where the implementation still differs from the reference.

## Reference behavior and evidence

### Unit movement

The web reference detects a unit packet whose tile changed in
reference/freeciv-web/javascript/unit.js:936, stores source and destination
tiles, and computes a pixel offset in get_unit_anim_offset at line 987. The
offset is consumed while building the unit sprite array in
reference/freeciv-web/javascript/2dcanvas/tilespec.js:821. The canvas refresh
loop advances this animation through repeated redraws in
reference/freeciv-web/javascript/2dcanvas/mapview_common.js:688.

This is a translation animation. The reference does not use a separate walking
sprite sheet for each unit type in this path.

The native client has the same conceptual behavior in
reference/freeciv/client/mapview_common.c:246, with movement duration controlled
by smooth_move_unit_msec in reference/freeciv/client/options.c:2240.

### Combat

The web reference receives combat results and starts a transient animation on
the affected tile. When a unit is destroyed, it selects either a swords
sequence or explosion sequence in
reference/freeciv-web/javascript/packhand.js:1665. The frame counter is
decremented and the corresponding sprite is drawn in
reference/freeciv-web/javascript/2dcanvas/tilespec.js:485.

Amplio2 already defines these frames in the reference atlas:

- explode.unit_0 through explode.unit_4;
- swords.unit_0 through swords.unit_7;
- explode.nuke.

The current copied table is still available in
apps/client/public/js/2dcanvas/tileset_spec_amplio2.js:281, and the active
PresentationEffectRenderer requests those frames through TilesetProvider.

The native reference is more explicit. It has separate movement, battle,
explosion, and nuke animation types in
reference/freeciv/client/mapview_common.c:128, progresses battle health using
virtual units in battle_animation at line 288, and progresses explosion frames
in explosion_animation at line 348.

Important parity boundary: the reference combat presentation is not a full
per-unit attack-lunge or per-unit walking animation. The minimum compatible
experience is a tile-level swords/explosion effect plus interpolated combat
health and correct removal timing.

### Other map animations

The web reference has a continuously refreshed map canvas and uses it to
advance transient effects. It also has:

- map recentering slide state and a 700 ms slide in
  reference/freeciv-web/javascript/2dcanvas/mapview_common.js:27;
- sliding-frame rendering in mapview_common.js:706;
- map slide initialization in
  reference/freeciv-web/javascript/2dcanvas/mapview.js:1041;
- transient tile markers and explosion counters in mapview_common.js:118;
- animated border line dash progression in mapview.js:733.

These were audited separately after unit movement and combat; the active
implementation now covers the programmatic marker path and option-gated border
continuation.

## Current active-client behavior

| Area                     | Current implementation                                                                                                                                                                                                                                                 | Classification                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Unit movement            | UnitRenderer detects coordinate changes, queues consecutive source/destination segments, skips transported transitions, and interpolates each segment for 180 ms using cubic ease-out.                                                                                 | Implemented, simplified                 |
| Unit nation shield       | UnitRenderer now prefers the server-provided `nationGraphic` (`roman` -> `rome`), checks normal/large shield assets, attaches the shield to the movement offset, and draws a neutral fallback with a development diagnostic when the asset is missing.                 | Implemented, with fallback              |
| Movement redraw          | MapRenderer requests another frame while movement animations are active.                                                                                                                                                                                               | Implemented                             |
| Unit selection           | UnitRenderer prefers animated `unit.select0..3` atlas frames and falls back to a procedural pulsing diamond.                                                                                                                                                           | Implemented, fallback                   |
| Activity icons           | UnitRenderer normalizes object-shaped activities, uses the reference `+55,-25` offset, and supports worker, patrol, cargo, naval, hidden, automation, connect, and action-decision keys when state is supplied.                                                        | Implemented, data-dependent             |
| Unit-specific UO offsets | Ruleset presentation data supplies the reference per-unit adjustments for the main unit, shield, veteran, and stack overlays; the renderer applies them from the tile origin.                                                                                          | Implemented                             |
| Unit HP/movement         | Atlas HP overlays use ruleset `maxHp`; movement-point overlays are available through `showUnitMovePoints` and remain disabled by default like the reference option.                                                                                                    | Implemented                             |
| Veteran/stack cues       | `unit.vet_*`, `unit.stk_shld_l`, and `unit.stack1..9` are drawn for stationary units.                                                                                                                                                                                  | Implemented                             |
| Combat result            | Server emits a visibility-scoped `combat_occurred` event; GameClient stores a short-lived presentation effect and also supports the direct attack reply path.                                                                                                          | Implemented, simplified                 |
| Combat observers         | GameBroadcastManager sends the event to combat participants and players whose visibility contains the combat tile; non-participants receive only combatant snapshots on tiles they can see. UnitManager emits it for player, AI, and turn-processing combat.           | Implemented, needs integration coverage |
| Combat frames            | PresentationEffectRenderer requests `swords.unit_*` or `explode.unit_*` by elapsed time, with a fallback burst when an asset is unavailable.                                                                                                                           | Implemented, simplified                 |
| Combat health/death      | Combat events include pre-destruction snapshots; PresentationEffectRenderer overlays temporary units and interpolates HP until the effect completes.                                                                                                                   | Implemented, simplified                 |
| Nuclear effect           | UnitManager emits a visibility-scoped `nuclear_explosion` event with affected tiles; observers who see any blast tile receive only their visible subset and no hidden center coordinate. The client draws `explode.nuke` or a fallback burst once per authorized tile. | Implemented, simplified                 |
| Camera slide             | Programmatic `center-map-on-tile` uses a 700 ms cubic-eased viewport slide; manual mouse/touch input commits the latest rendered origin before taking over, and reduced motion snaps to the target.                                                                    | Implemented, simplified                 |
| Borders/markers          | Empty-tile recentering creates an expiring `grid.usermark`; optional moving-border phase keeps the render loop alive only when enabled.                                                                                                                                | Implemented, option-gated               |
| Reduced motion           | Canvas reads the saved preference and disables movement/pulse continuation, camera slides, border animation, and transient continuation while rendering one final frame.                                                                                               | Implemented, simplified                 |

## Implementation principles

1. Keep authoritative updates immediate. Animate a visual copy while Zustand
   contains the latest server state.
2. Treat animations as ephemeral, keyed by a unique event or animation ID. Do
   not persist them in savegames, snapshots, or unit records.
3. Use map coordinates as the source of truth and convert through the existing
   BaseRenderer.mapToScreen path. Do not duplicate isometric coordinate math.
4. Effects must be safe when their unit is absent from the store, outside the
   viewport, hidden by fog, or destroyed before the effect completes.
5. A late or duplicated notification must not create a permanent ghost. Use an
   event ID or deterministic deduplication key.
6. Combat effects should be drawn above the affected tile’s unit layer and
   below persistent UI panels.
7. Animation completion must be time-based. Do not advance one frame merely
   because a redraw happened.
8. Prefer the existing sprite provider. Add normalized animation lookup to the
   provider only if direct tag lookup cannot support the effect cleanly.
9. Use one scheduler and one reduced-motion policy for all Canvas effects.

## Gap-by-gap implementation plan

### ANIM-001 — Shared Canvas animation runtime

**Priority:** P0  
**Status:** Partial; MapRenderer owns the active-frame continuation, but a shared controller is still missing

Movement currently owns a small animation map in
apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts. Combat, nuclear
effects, map slides, and transient markers need consistent scheduling,
cancellation, viewport handling, and reduced-motion behavior.

Introduce a small client-only animation model. It may be a dedicated
AnimationController or a renderer-owned controller if that keeps the boundary
simpler. Do not put animation instances in the authoritative Zustand snapshot.

The controller should support:

- start(animation);
- cancel(id) and cancelForUnit(unitId);
- progress based on current time;
- hasActiveAnimations();
- clear() during map/session teardown;
- reduced-motion mode.

Likely files:

- apps/client/src/components/Canvas2D/MapRenderer.ts;
- apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts;
- a new utility under apps/client/src/components/Canvas2D/animations/;
- gameStore only if a user preference must be read.

Acceptance criteria:

- One requestAnimationFrame loop continues while any Canvas animation is active.
- The loop stops when the last animation completes.
- cleanup cancels the loop and releases transient state.
- Zero-duration and reduced-motion effects complete without an infinite loop.
- Existing movement behavior remains unchanged while the facility is introduced.

Tests should cover progress at start, midpoint, completion, cancellation,
repeated start, and cleanup.

### ANIM-002 — Unit movement parity and robustness

**Priority:** P1  
**Status:** Implemented in the active renderer with a renderer-owned queue;
packet-level transition capture remains a follow-up

The current renderer notices a changed coordinate when the new state is
rendered, queues consecutive transitions, and translates each destination
sprite back toward its source for 180 ms. It also skips transitions for
transport loading/unloading and follows the active movement offset for the
selection outline. This differs from the web reference, which records the
transition when the packet arrives and owns the animation list closer to the
packet-handling boundary.

Preserve the current visible behavior first, then close these gaps:

- capture the previous position before replacing the unit in the store;
- support consecutive server updates without overwriting an active path
  incorrectly; **done in the renderer-owned queue**;
- do not animate initial snapshots, reconnect snapshots, teleports, transport
  loading/unloading, or visibility reappearance unless explicitly desired;
- cancel or reconcile movement when a unit is destroyed;
- keep shield, activity icon, stack marker, health bar, and annotation attached to
  the same interpolated position; **done for the active overlay stack**;
- make duration a named presentation setting rather than an unexplained
  constant.

Reference evidence:

- reference/freeciv-web/javascript/unit.js:936;
- reference/freeciv-web/javascript/unit.js:987;
- apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:20;
- apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:214.

Acceptance criteria:

- Normal one-tile movement travels source-center to destination-center and
  settles exactly on the destination.
- A full snapshot does not animate every unit into view.
- Two rapid movement updates do not leave a unit behind or create a ghost.
- All unit overlays follow the interpolated position.
- Unit destruction cancels its movement animation.
- Existing movement and live-state tests remain green.

### ANIM-003 — Combat presentation event

**Priority:** P0  
**Status:** Implemented through the authoritative UnitManager callback for player, AI, and turn-processing attacks; visibility, rich snapshots, duplicate delivery, and focused server/client coverage are present

The server already calculates and returns a CombatResult. The active path now
also emits a visibility-scoped `combat_occurred` Socket.IO event, while the
client keeps authoritative unit updates separate from a short-lived Canvas
effect. The event carries pre-destruction visual snapshots, final HP,
damage/destruction flags, participant IDs, and the selected swords or
explosion style.

Existing authoritative data:

- CombatResult contains attacker/defender IDs, damage, and destruction flags in
  apps/server/src/game/managers/UnitManager.ts:140.
- UNIT_ATTACK_REPLY returns that result through
  apps/server/src/types/packet.ts:657.
- Surviving unit updates are broadcast in
  apps/server/src/game/services/UnitManagementService.ts:162.
- Destruction is broadcast separately in
  apps/server/src/game/orchestrators/GameBroadcastManager.ts:206.

The current implementation uses `combat_occurred` and should be extended only
if virtual combatants or richer observer-side health interpolation are added.
Keep it as presentation data, not a replacement for UNIT_INFO.

Recommended payload fields for the next increment:

- eventId and emittedAt;
- attacker and defender visual snapshots: id, playerId, unitTypeId, x, y,
  hpBefore, and optional facing;
- attackerDamage and defenderDamage;
- attackerDestroyed and defenderDestroyed;
- combatStyle: swords or explosion;
- gameId if required by the transport.

The server should emit the event to players who can see either combat tile and
to the combat participants. It must use pre-destruction snapshots for units
that die. Do not expose hidden enemy information to players who could not see
the combat.

The requester may start the animation from the attack reply, but must
deduplicate against the broadcast event using eventId. Prefer one common
broadcast path so observers and the attacker see the same event.

The callback is installed by GameLifecycleManager when the authoritative
UnitManager is created. UnitManagementService keeps a guarded fallback for
isolated managers that do not install the callback, preventing duplicate
events in the live game.

Likely files:

- shared packet schemas and packet contract;
- UnitManager.attackUnit and its combat presentation callback;
- UnitManagementService.broadcastCombatResult fallback;
- GameBroadcastManager visibility routing;
- GameClient notification handling;
- the client animation controller.

Acceptance criteria:

- Attacker, defender, observer, and reconnecting clients receive only permitted
  combat presentations.
- A combat event contains enough pre-destruction data to render a dead unit.
- Duplicate attack reply plus broadcast does not play two effects.
- Missing or stale units do not prevent the effect from rendering.
- Authoritative combat and normal unit updates remain unchanged.

Tests should include server visibility, packet schema, client normalization, and
a two-client integration case where one client observes combat without being the
attacker.

### PRES-001 — Unit nation-shield consistency

**Priority:** P1  
**Status:** Implemented for the active unit renderer; packet-order and missing-asset fallbacks are covered

The small flag/shield beside a unit is a nation marker. It is separate from the
unit activity icons and should not appear only for selected units, own units, or
particular unit types.

Reference behavior:

- `reference/freeciv-web/javascript/2dcanvas/tilespec.js:821-875` calls
  `get_unit_nation_flag_sprite(punit, unit_offset)` while building every unit's
  sprite list.
- `reference/freeciv-web/javascript/2dcanvas/tilespec.js:1231-1249` resolves
  the unit owner through `players[punit.owner]`, then resolves that player's
  nation and returns the shield sprite with the movement offset attached.
- The reference chooses `f.shield.<graphic_str>` at normal scale and
  `f.shld_lg.<graphic_str>` for its browser-zoom path.

The confirmed root cause was a data-boundary mismatch: the server/player state
uses the ruleset nation id `roman`, while the Amplio2 atlas uses the flag
graphic suffix `rome` (`f.shield.rome`). Building `f.shield.roman` therefore
silently failed. This explains why the badge appeared for some nations but not
others.

Active behavior before the fix:

- `apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:254-259`
  obtains the nation from `state.players[unit.playerId]?.nation` and skips the
  shield when that lookup is undefined.
- `apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:296-304`
  constructs `f.shield.<nation>` using fixed offsets.
- `apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:131-151`
  draws a sprite only when the provider returns it; the non-required shield has
  no warning or fallback when its key is absent.
- `apps/client/src/services/GameClient.ts:354-384` populates player nations
  from `PLAYER_INFO`, while `apps/client/src/services/GameClient.ts:428-493`
  can populate unit state from `UNIT_INFO`. These are independent packets, so
  a unit can be renderable briefly before its owner metadata is available.
- The server does send both fields: unit owner at
  `apps/server/src/game/orchestrators/GameBroadcastManager.ts:881-884` and
  player nation at `apps/server/src/game/orchestrators/GameBroadcastManager.ts:425-429`.

This made the intermittent symptom a confirmed presentation gap. The other
runtime trigger was that server activities are object-shaped (`{ type:
"irrigating", ... }`) while the renderer previously handled only strings.
The remaining packet-order case is handled by rerendering from the normalized
player state; a unit may use the fallback/omit the shield until owner metadata
arrives, but it is not permanently cached unbadged.

1. `UNIT_INFO` is processed before the matching `PLAYER_INFO` and the unit is
   rendered during that interval.
2. A reconnect, observer transition, or partial snapshot leaves a visible unit
   whose `playerId` has no entry in `state.players`.
3. The nation value is a ruleset nation ID without a matching
   `f.shield.<nation>` atlas entry.
4. A moving unit's shield uses fixed offsets instead of the same interpolated
   offset as the unit sprite, so it can look detached or disappear at an edge.

Implemented behavior:

- `NationPresentationService.resolveNationGraphic()` converts ruleset nation ids
  to atlas suffixes on the server and is included in both live player packets
  and snapshot player data.
- UnitRenderer checks `nationGraphic` first, falls back to the nation id for
  legacy clients/saves, and tries normal and large shield tags.
- Render the shield for own and foreign visible units whenever the owner and
  nation are known.
- Handle packet ordering deterministically. A unit should either wait for its
  owner metadata, use a safe neutral/unknown marker, or be re-rendered as soon
  as `PLAYER_INFO` arrives; it must not remain permanently unbadged because the
  packets arrived in the other order.
- Validate the generated tag with the existing sprite provider. If no nation
  shield asset exists, log a development diagnostic once per key and draw an
  intentional neutral marker rather than silently dropping the identity cue.
- Attach shield position to the same `animOffset` used by the unit during
  movement. Preserve the reference's normal/zoom asset selection if the active
  renderer supports multiple display scales.
- Do not reveal a nation marker for a unit that the server has not authorized
  the client to see. Visibility remains server-authoritative.

Likely implementation files:

- `apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts`;
- `apps/client/src/services/GameClient.ts` or a small player-presentation
  resolver;
- `apps/server/src/game/services/NationPresentationService.ts`;
- `apps/client/src/components/Canvas2D/tilesets/Amplio2TilesetProvider.ts`;
- `apps/client/src/components/Canvas2D/__tests__/MapRenderer.live-state.test.ts`;
- a focused `UnitRenderer` or `GameClient` test for packet ordering and missing
  metadata.

Acceptance criteria:

- Every visible unit with a known owner and valid nation asset shows exactly one
  matching shield, regardless of owner, selection, stack membership, or unit
  type.
- The shield stays attached to the unit during smooth movement and settles at
  the same destination.
- `UNIT_INFO` before `PLAYER_INFO` does not create a permanent missing shield.
- Reconnects, observer mode, full snapshots, owner changes, and foreign units
  all resolve the correct nation.
- Missing or invalid nation assets produce an intentional fallback and a
  diagnostic, without suppressing the unit sprite or breaking the map render.
- No nation data is exposed for units hidden by server visibility rules.

Tests should cover:

- own and foreign units with different nations;
- unit rendered before and after its `PLAYER_INFO` packet;
- full snapshot and reconnect ordering;
- a missing player entry and an unknown nation tag;
- a moving unit, including the shield's draw coordinates at start, midpoint,
  and destination;
- stacked units and selected units to ensure the shield is not accidentally
  coupled to annotations or stack indicators.

### PRES-002 — Unit activity and status indicator stack

**Priority:** P1  
**Status:** Implemented for the available authoritative fields, including
reference per-unit placement offsets; the server-side action-decision protocol
is not part of the current action-dialog model

The flag/shield is only one member of the reference unit overlay stack. The
reference builds the stack in `reference/freeciv-web/javascript/2dcanvas/tilespec.js:821-934`.
The active renderer must preserve the same layering and must attach every
overlay to the interpolated unit origin:

| Overlay         | Reference key/position                                                         | Active behavior                                                                           |
| --------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Activity        | `unit_activity_offset_x=55`, `unit_activity_offset_y=25`, therefore `(55,-25)` | Normalized activity values use this offset.                                               |
| Connect         | `unit.connect`, approximately `(-6,-6)` relative to unit origin                | Drawn for worker connection activities only when the normalized order queue is non-empty. |
| Cargo           | `unit.cargo` at the activity position                                          | Drawn for transported idle/sentry units.                                                  |
| Action decision | `unit.action_decision_want` at the activity position                           | Drawn from server state when supplied, or while the active client action menu is open.    |
| HP              | `unit.hp_0..100` in 5% increments at `(0,-31)`                                 | Drawn for stationary units using `maxHp`; generic bar is a fallback.                      |
| Movement points | Same HP atlas at `(0,-31)`                                                     | Opt-in through `RenderState.showUnitMovePoints`, matching the reference default `false`.  |
| Veteran         | `unit.vet_1..9` at `(35,-35)`                                                  | Drawn for veteran units.                                                                  |
| Stack           | `unit.stk_shld_l` plus `unit.stack1..9` at `(0,-31)`                           | Drawn for stationary stacks.                                                              |

Supported activity aliases include road/rail, sentry/fortify, patrol and
delayed goto, exploration/automation, irrigation/mine/plant/transform,
pillage/pollution/fallout, fishing/convert/hidden/deepdive, and base-specific
outpost/fortress/airbase values. Missing atlas keys are skipped without
blocking the main unit sprite.

Remaining implementation work for a future AI:

1. Add authoritative `action_decision_want` and target-tile fields to the
   unit model only if the server adopts Freeciv's asynchronous action-dialog
   protocol. The renderer must not infer this state from
   `capabilities.unitActions`; that list describes what a unit can do, not
   whether the server is asking for a decision now. The current client draws
   the equivalent cue while its action menu is open.
2. If a future ruleset adds an activity target whose `activity_gfx` fields are
   absent from its extras definition, add those fields to the ruleset data and
   verify the atlas key; no renderer alias should be needed for a correctly
   described extra.

Acceptance criteria:

- A moving unit carries its shield, activity, connect, veteran, and any other
  visible overlay at the same interpolated position as the base sprite.
- A stationary damaged unit shows the correct 5%-rounded HP atlas frame; a
  ruleset without an HP sprite still receives the generic fallback bar.
- A stationary stack shows both the reference stack ring and count cue without
  showing stale stack graphics while the unit is moving.
- Veteran levels above the atlas range clamp to level 9 instead of requesting a
  missing sprite.
- Activity object payloads and legacy string payloads render identically.
- No action-decision icon appears merely because a unit has available actions.

Tests should cover activity offset coordinates, object/string normalization,
cargo, veteran levels, HP rounding/max HP, optional movement points, stack
overlays, selection atlas fallback, and movement attachment of every overlay.

### ANIM-004 — Unit combat swords and explosion frames

**Priority:** P1  
**Status:** Implemented as an elapsed-time tile effect with reference sprite selection; virtual combatants are covered by ANIM-005

The web reference chooses swords.unit_* for pre-gunpowder-style combat and
explode.unit_* otherwise. It uses five explosion frames and eight swords frames.

`PresentationEffectRenderer` is the active equivalent Canvas layer. It:

1. accepts a CombatPresentationEvent;
2. resolves attacker and defender tile positions;
3. selects swords versus explosion from explicit event data or a deterministic
   client-side unit-class rule;
4. chooses a frame from elapsed time, not redraw count;
5. draws the frame at the reference-compatible tile offset;
6. removes the effect after the final frame;
7. requests another Canvas frame while active.

Use a frame table rather than hard-coding tags throughout the renderer. A frame
needs a sprite tag, start time, end time, and optional x/y offset.

Do not infer combat visibility from client state after the event; the server must
make that decision.

Acceptance criteria:

- Visible conventional combat produces a five-frame explosion effect.
- Visible pre-gunpowder combat produces swords when selected by the reference
  rule.
- Effects appear on the correct attacker/defender tiles.
- Effects render above units and below persistent UI panels.
- Effects complete when frames are throttled and never remain stuck.
- Missing sprite tags fail gracefully without breaking map rendering.

Tests should verify frame selection at known elapsed times, offsets, completion,
missing sprites, and both effect styles.

### ANIM-005 — Combat-time virtual units and health interpolation

**Priority:** P1  
**Status:** Implemented in simplified form for visible combat events

The native reference creates virtual winner/loser units and decreases health
during ANIM_BATTLE in reference/freeciv/client/mapview_common.c:288. It then
draws an explosion effect after the battle sequence.

When a combat event arrives, retain a visual snapshot of both combatants. During
the effect timeline:

- draw the pre-combat unit sprite if the authoritative unit has already been
  updated or removed;
- interpolate the loser’s health from hpBefore to zero or its final value;
- interpolate the winner’s health from hpBefore to its final value;
- keep the real store authoritative for panels and game logic;
- stop drawing the virtual copy at the end of the combat sequence;
- let normal state delivery settle the map after the effect.

A simple timeline is implemented:

- combat duration: virtual combatants and interpolated health bars;
- effect duration: swords or explosion frame;
- completion: discard visual snapshots.

Avoid rendering two copies of a surviving unit after the effect ends.

Acceptance criteria:

- A unit that dies remains visible long enough for the death effect.
- A surviving unit’s visual health approaches final authoritative health.
- A removed unit does not disappear before its effect completes.
- The final frame contains no duplicate or stale health bar.
- Hidden combatants are never reconstructed from unauthorized data.

Tests should cover attacker death, defender death, both surviving, legal
multiple-destruction cases, and a unit update arriving before animation end.

### ANIM-006 — Destruction sequencing and cancellation

**Priority:** P1  
**Status:** Partial; combat destruction is retained through the presentation effect, while non-combat destruction still settles immediately

GameClient immediately removes a unit after unit_destroyed in
apps/client/src/services/GameClient.ts:237. That is correct for authoritative
state but leaves no visual snapshot for a death animation.

For combat, the server now sends the last known presentation data before the
authoritative unit update/removal. The store may still remove it immediately;
only the Canvas presentation layer owns the short-lived copy. Non-combat
destruction remains immediate until a product decision calls for a separate
effect.

Handle explicitly:

- combat death;
- settler consumption when founding a city;
- disband or other non-combat destruction;
- destruction while the unit is moving;
- destruction outside the viewport;
- destruction after reconnect or a full snapshot.

Only combat destruction should receive swords/explosion treatment. Other unit
removal may use no effect or a separate short marker.

Acceptance criteria:

- Combat death animates once and then disappears.
- Non-combat destruction does not show a combat effect accidentally.
- Destroyed selected units clear selection without leaving a selected visual copy.
- Repeated destruction notifications are harmless.
- Teardown clears all visual copies.

### ANIM-007 — Nuclear explosion presentation

**Priority:** P2  
**Status:** Implemented as a visibility-scoped multi-tile effect; legacy
center-only payloads remain supported

The native client has an explicit ANIM_NUKE path, and the Amplio2 atlas contains
explode.nuke. CivJS supports the gameplay path and now has a simplified visual
map effect carrying per-affected-tile presentation data.

The active implementation carries the visible detonation tile and a
server-authorized `tiles` list in `nuclear_explosion`, renders `explode.nuke`
centered over every authorized tile, advances it by elapsed time, and finishes
independently of authoritative city/unit updates. If an older event omits the
list, the client safely falls back to the center tile.

Visibility must be resolved server-side. A client must not derive the entire
blast radius from hidden state.

Acceptance criteria:

- A player who sees any affected blast tile receives the effect for the visible
  subset, even when the center itself is hidden.
- Players without detonation visibility do not see the effect.
- City, unit, terrain, and population updates remain immediate.
- The effect completes and cleans up if the map changes during playback.

Tests should cover provider lookup, centering, visibility, completion, the
multi-tile draw count, and a nuclear-action integration path.

### ANIM-008 — Map recenter slide

**Priority:** P2  
**Status:** Implemented for programmatic recentering; wrapping/polar-edge parity remains a follow-up verification item

The web client initializes a 700 ms map slide in
reference/freeciv-web/javascript/2dcanvas/mapview.js:1041 and renders it in
mapview_common.js:710.

The active UX animates programmatic recentering (focus, reports, and unit
jumps), while manual camera drag cancels the slide:

- capture current viewport origin;
- compute target origin using existing wrapping and bounds logic;
- interpolate the viewport origin;
- render the normal map at each frame;
- commit the latest rendered origin before a user drag takes over;
- cancel the slide when a new recenter request supersedes it.

Do not implement this by translating an already-rendered canvas if that would
break fog, wrapping, or overdraw margins. Re-render through the existing
viewport path.

Acceptance criteria:

- Focus changes smoothly reach the target tile.
- Manual drag cancels or takes over deterministically.
- Wrapped maps choose the reference-compatible visual path.
- Bounds and fog do not reveal stale pixels.

### ANIM-009 — Animated borders and transient tile markers

**Priority:** P3  
**Status:** Implemented in the active path, with moving borders option-gated and disabled by default

The web renderer advances animated border dash offsets in
reference/freeciv-web/javascript/2dcanvas/mapview.js:733. It also uses a
short-lived marker/explosion counter for clicked or recentered tiles in
mapview_common.js:118.

The active path now provides the equivalent effect:

- BorderRenderer keeps its phase outside authoritative map state and exposes
  `hasActiveAnimation()` to MapRenderer.
- MapRenderer continues rendering only while moving borders are enabled; the
  normal default remains static borders.
- Empty-tile `center-map-on-tile` events add a 900 ms `grid.usermark` effect.
- The marker is drawn before fog and expires through the normal effect loop.

This work should not block unit combat animation.

Acceptance criteria:

- Border phase advances while the relevant border is visible.
- No permanent full-map render loop exists when no animated border is present.
- A tile marker expires automatically and is cancelled on teardown.

### ANIM-010 — Reduced motion, timing, and performance policy

**Priority:** P1  
**Status:** Implemented for current Canvas paths; native-style timing configurability and a dedicated shared controller remain follow-up work

Canvas reads the saved `reducedMotion` preference through MapCanvas and passes
it to every RenderState. The preference is also refreshed when the settings
change event fires.

When reduced motion is enabled, the current Canvas policy:

- disable map recenter slide;
- render unit movement as a short snap or short interpolation;
- replace combat frame sequences with one low-motion marker or final frame;
- disable border dash animation and nonessential pulsing;
- preserve final health and destruction information.

Keep timing configurable in one location so tests can use deterministic
durations.

Acceptance criteria:

- Reduced-motion users do not receive continuous Canvas animation.
- Final state remains understandable without animation.
- Background tabs and throttled frames do not leave effects stuck.
- Multiple simultaneous effects keep the render loop bounded.

Tests should cover every animation kind, reduced-motion mode, and completion
under throttled frame intervals.

## Recommended implementation order

1. ANIM-001: finish a reusable shared scheduler and lifecycle abstraction.
2. ANIM-002: move transition capture closer to packet handling if packet-level
   timing parity becomes necessary; the active renderer queue is complete for
   current behavior.
3. PRES-001: make nation shields deterministic and movement-attached. **Done.**
4. ANIM-003: combat presentation event and visibility routing. **Done for direct attacks.**
5. ANIM-004: swords/explosion frame renderer. **Done.**
6. ANIM-005: virtual combatants and health interpolation. **Done in simplified form.**
7. ANIM-006: add an intentional non-combat destruction policy. **Combat portion done.**
8. ANIM-010: reduced-motion and timing controls. **Done for current Canvas paths.**
9. ANIM-007: add broader integration coverage if product parity requires it;
   per-affected-tile presentation is implemented.
10. ANIM-008: map recenter slide. **Done for programmatic focus.**
11. ANIM-009: borders and transient markers. **Done, with moving borders option-gated.**

Each step should be a small reviewable change with focused tests. Do not bundle
camera polish with the first combat protocol change.

## Suggested module boundaries

A reasonable decomposition is:

- Canvas2D/animations/AnimationController.ts for lifecycle, time, and reduced
  motion;
- Canvas2D/animations/AnimationTypes.ts for ephemeral event/effect types;
- Canvas2D/animations/CombatAnimation.ts for combat timelines and frame
  selection;
- Canvas2D/renderers/UnitRenderer.ts for authoritative units and movement;
- Canvas2D/renderers/CombatEffectRenderer.ts for combat effects;
- Canvas2D/MapRenderer.ts for layer order and scheduler integration.

The exact filenames are flexible. The important boundaries are:

- packet normalization happens in GameClient;
- authoritative units remain in Zustand;
- ephemeral animation instances remain in the Canvas presentation layer;
- sprite lookup remains behind TilesetProvider;
- map layer ordering remains centralized in MapRenderer.

## Verification matrix

| Scenario                          | Expected result                                             |
| --------------------------------- | ----------------------------------------------------------- |
| Initial map snapshot              | Units appear immediately; no movement animation             |
| Visible unit identity             | Own and foreign units show their matching nation shield     |
| One normal unit move              | Unit translates source to destination and settles exactly   |
| Two rapid moves                   | No jump, ghost, or stale overlay                            |
| Visible combat, defender survives | Effect plays; defender health converges                     |
| Visible combat, defender dies     | Defender copy remains through death effect, then disappears |
| Visible combat, attacker dies     | Attacker copy remains through death effect, then disappears |
| Observer sees combat              | Observer receives the permitted effect                      |
| Player cannot see combat          | No effect or hidden snapshot is revealed                    |
| Unit destroyed outside combat     | Unit disappears without combat effect                       |
| Nuclear detonation                | Effect appears only where authorized                        |
| Recenter/focus                    | Viewport reaches target without stale fog pixels            |
| Reduced motion                    | Effects snap/shorten and final information remains visible  |
| Reconnect/full snapshot           | No replay of old movements or stale effects                 |
| Cleanup/unmount                   | No animation loop or visual ghost remains                   |

## Handoff checklist for each implementation PR

Before marking an item complete, record:

- exact files changed;
- reference functions used as evidence;
- authoritative event or state that starts the presentation;
- duration and frame timing;
- visibility and fog behavior;
- cancellation and teardown behavior;
- focused unit tests;
- browser or integration evidence;
- whether the item is implemented, simplified, or deferred.

Do not mark an item complete based only on sprite-table presence. It is complete
only when the active React/Canvas path displays it and the relevant state,
visibility, timing, and cleanup tests pass.

## Non-goals

Unless product scope is expanded later, this gap list does not require:

- per-unit walking-cycle sprite sheets;
- 3D skeletal unit animation;
- changes to authoritative server combat timing;
- persistence of animation state across reloads or reconnects;
- audio or music synchronization;
- replacing the Canvas renderer with a game engine.
