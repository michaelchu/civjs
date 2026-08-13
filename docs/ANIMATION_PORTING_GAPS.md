# CivJS Animation and Presentation Porting Gaps

Audit and implementation record for the reference clients' player-visible map
animations in the active React/Canvas client. Square ISO follows the pinned
freeciv-web 2D path; native ISO-hex follows Freeciv/Hexemplio where the browser
client is not an applicable oracle.

## Status and scope

**Status:** The covered square-isometric animation path now follows the pinned
browser's mutable paint counters, sprite composition, effect rules, and camera-entry
points. Native ISO-hex intentionally retains a separate elapsed-time
presentation path. Remaining evidence and protocol limitations are called out
below.

**Target:** The active `apps/client/src` React/Canvas 2D client, using the
generated topology-compatible Amplio2 and Hexemplio providers plus
server-authoritative game state.

**Reference baselines:**

- reference/freeciv-web/freeciv-web/src/main/webapp/javascript: browser client behavior and player-visible
  2D canvas behavior.
- reference/freeciv/client: native client animation model and timing semantics.

This is a presentation task. Animation must never become authoritative game
state, delay server resolution, or change combat, movement, visibility, or
destruction outcomes.

## Executive summary

The pinned browser's square-ISO path contains:

1. Unit movement through a mutable eight-step tuple, advanced whenever the
   tuple is sampled while composing body/activity, shield, and HP sprites.
2. Absolute six-Hz `unit.select0..3` selection frames.
3. Lethal-only combat explosions: five sprites, each retained for five paints
   of the affected logical tile.
4. A single `explode.nuke` sprite retained for 60 paints of the packet tile.
5. Direct overview/report centering plus a separate 700 ms, 100-step linear
   slide for right-click recentering.
6. A 10 ms map refresh gate (12 ms on small screens) that drives paint-based
   state; every visible wrapped copy is another paint of the same counter.

The active square client reproduces those rules. Its generated Amplio2 package
supplies the exact sprite rectangles and presentation offsets; the renderer
uses the browser layer order and global painter walk; and reduced motion paints
the first effect frame without scheduling continuation. Native ISO-hex keeps
the existing 180 ms cubic movement, optional swords/explosion presentation,
virtual combat snapshots, multi-tile nuke feedback, marker, and cubic camera
slide because those are not freeciv-web square behaviors.

The active client still has these parity limitations:

- movement transitions are renderer-detected rather than captured at packet
  application time, although consecutive transitions remain queued locally;
- the animation scheduler is renderer-owned rather than a reusable controller;
- non-combat destruction has no separate presentation timeline;
- native ISO-hex animation does not yet have an independent native-GUI pixel
  oracle;
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
  worker/automation values to packaged activity sprites, including
  ruleset activity-target graphics such as farmland, oil mine, fortress,
  airbase, buoy, irrigation, and mine variants.
- UnitRenderer now uses the reference activity offset (`+55, -25`), draws
  connect/cargo/action-decision cues when the corresponding state exists, and
  adds atlas HP, movement-point, veteran, stack-ring, and stack-count overlays.
- Each generated tileset manifest carries its own presentation offsets;
  UnitRenderer reads them through `TilesetProvider`, so square Amplio2 and
  native Hexemplio never share an invented server-side offset table.
- Unit selection prefers `unit.select0..3` atlas frames and uses the single
  MapCanvas atlas-cadence scheduler for that animation; custom-diamond
  rendering remains the fallback for incomplete tilesets.
- `PresentationEffectRenderer` selects behavior by provider. Square ISO draws
  lethal-only `explode.unit_0..4` for 25 logical-tile paints and one
  `explode.nuke` for 60 logical-tile paints at the browser offsets. Native ISO-hex retains elapsed-time
  swords/explosion, marker, virtual-combatant, and multi-tile nuke feedback.
  Effects are visibility-scoped by the server and deduplicated by event ID.
- Combat events carry pre-destruction snapshots and final HP. Those snapshots
  drive the native presentation only; square ISO applies authoritative unit
  state directly, as the pinned browser does.
- The authoritative UnitManager now emits combat presentation events for every
  combat caller, including AI and turn-processing attacks; the direct service
  path retains a fallback for isolated managers/tests.
- Square overview/report/minimap requests center directly. A square right click
  opens an owned visible unit menu or applies the browser's polar guard and
  700 ms linear recenter slide, with its distance/direct-snap rule. Native
  programmatic recentering retains its cubic slide and optional marker.
- The existing reduced-motion preference now short-circuits unit movement,
  camera slides, border motion, selection pulsing, and transient-effect
  continuation while preserving a final visual frame.
- BorderRenderer exposes an optional moving-border animation state to the
  MapRenderer scheduler without forcing a permanent render loop.

The strict render-only suite directly compares the covered square terrain,
entity, wrapped-seam, and first transient-effect frames to freeciv-web with
zero pixel difference. Animation counters and camera branches are additionally
locked by source-mapped unit and interaction tests.

## Reference behavior and evidence

### Unit movement

The web reference records source/destination tiles in `update_unit_anim_list()`
at `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:236-283`.
`get_unit_anim_offset()` at `unit.js:289-343` mutates the destination's
eight-step counter each time the offset is sampled. The 2D sprite composer
samples it independently for the unit body/activity stack, nation shield, and
HP overlay at
`reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:674-705,895-965`.
Consequently, painting one unit copy can consume three counter samples, and
visible wrapped copies repeat that sequence in the same redraw. This is a
paint-driven translation, not a duration-based walking cycle.

`handle_unit_info()` calls `update_unit_anim_list()` before replacing the unit
at `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:961-975`.
The 2D map's requestAnimationFrame loop is gated by
`MAPVIEW_REFRESH_INTERVAL` at
`reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:503-518`.

The native client has the same conceptual behavior in
reference/freeciv/client/mapview_common.c:246, with movement duration controlled
by smooth_move_unit_msec in reference/freeciv/client/options.c:2240.

### Combat

The pinned 2D browser does not render swords or virtual combatants. Its combat
packet handler starts an effect only for a destroyed, currently visible unit by
setting that tile's counter to 25 at
`reference/freeciv-web/freeciv-web/src/main/webapp/javascript/packhand.js:1001-1018`.
The `LAYER_UNIT` composer decrements that counter once every time the logical
tile is painted and selects `explode.unit_0..4`, retaining each sprite for five
tile paints, at
`reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:397-425`.
Authoritative surviving HP and destroyed-unit removal are applied directly.

The generated Amplio2 package contains those five explosion frames and
`explode.nuke`, with rectangles and offsets derived from the pinned reference
spec. Swords assets and elapsed-time combat presentation belong only to the
native ISO-hex branch.

The native reference is more explicit. It has separate movement, battle,
explosion, and nuke animation types in
reference/freeciv/client/mapview_common.c:128, progresses battle health using
virtual units in battle_animation at line 288, and progresses explosion frames
in explosion_animation at line 348.

Important parity boundary: native virtual-unit battle animation is not a
freeciv-web square-ISO behavior. Reconstructing a destroyed square combatant or
interpolating its health would reduce browser parity rather than improve it.

### Other map animations

The square browser has a 10 ms map-refresh threshold (12 ms on small screens),
an absolute six-Hz unit-selection frame, and redraw-driven explosions. Its
overview/report entry points center directly. Right-click is the one audited
path that calls `enable_mapview_slide()` before centering:

- polar-edge guard and right-click dispatch:
  `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapctrl.js:288-323`;
- 700 ms, 100-step slide setup and the viewport-distance direct-snap rule:
  `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:434-460`;
- integer linear frame progression:
  `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:525-559`.

The audited square 2D path has static dashed borders and no `grid.usermark`
recenter marker. Moving dashes and transient recenter markers remain native
ISO-hex presentation features.

## Current active-client behavior

| Area             | Square ISO / Amplio2                                                                                                                       | Native ISO-hex / Hexemplio                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Unit movement    | Renderer-detected queued transitions use the browser's eight-step mutable counter and three samples per painted copy.                      | 180 ms cubic interpolation.                                                       |
| Selection        | Absolute six-Hz `unit.select0..3`.                                                                                                         | Provider animation with procedural fallback.                                      |
| Unit composition | Browser sprite order, per-unit manifest offsets, direct HP/stack/veteran/activity rules.                                                   | Native provider rules and optional custom overlays.                               |
| Combat           | Lethal-only `explode.unit_0..4`; 25 tile paints, five paints per frame; no virtual units.                                                  | Elapsed-time swords/explosion plus virtual combat snapshots and HP interpolation. |
| Nuclear effect   | One `explode.nuke` at the packet anchor for 60 tile paints.                                                                                | Server-authorized visible affected tiles with elapsed-time presentation.          |
| Camera           | Direct overview/report/minimap centering; right-click unit-menu precedence, polar guard, and 700 ms linear slide when within one viewport. | Cubic programmatic slide and optional marker.                                     |
| Borders/markers  | Static dashed borders; no recenter marker.                                                                                                 | Optional moving-border phase and marker.                                          |
| Reduced motion   | Draws the first effect frame and suppresses continuation; camera snaps.                                                                    | Suppresses nonessential interpolation and continuation.                           |

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
7. Match the selected oracle's clock. Square browser movement and effects use
   mutable counters consumed by each painted copy; native presentation is elapsed-time based.
8. Prefer the existing sprite provider. Add normalized animation lookup to the
   provider only if direct tag lookup cannot support the effect cleanly.
9. Use one scheduler and one reduced-motion policy for all Canvas effects.

## Gap-by-gap implementation plan

### ANIM-001 — Shared Canvas animation runtime

**Priority:** P0  
**Status:** Partial; MapRenderer owns the active-frame continuation, but a shared controller is still missing

Movement owns a small animation map in `UnitRenderer`. MapRenderer already
combines movement, selection, effects, camera, and optional native-border
continuation into one requestAnimationFrame lifecycle. A reusable controller
would be architectural cleanup, not a square-parity blocker; square effects
must retain their per-tile paint counters if that refactor happens.

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
**Status:** Square browser behavior implemented; packet-boundary transition
capture remains an architectural follow-up. Native ISO-hex remains time based.

The renderer notices a changed coordinate when new state is rendered and
queues consecutive transitions. Square ISO initializes the browser's
eight-step destination tuple, consumes three samples while composing the
visible unit, leaves selection/stack/veteran at the authoritative tile origin,
and skips transport transitions. Native ISO-hex keeps its 180 ms cubic path.
The remaining structural difference is that freeciv-web records the transition
at packet replacement time rather than at the first render.

Preserve the current visible behavior first, then close these gaps:

- capture the previous position before replacing the unit in the store;
- support consecutive server updates without overwriting an active path
  incorrectly; **done in the renderer-owned queue**;
- do not animate initial snapshots, reconnect snapshots, teleports, transport
  loading/unloading, or visibility reappearance unless explicitly desired;
- cancel or reconcile movement when a unit is destroyed;
- preserve the browser's deliberately different samples: body/activity,
  shield, and HP advance; stack/veteran and selection remain static; **done**;
- keep native duration as a named topology-specific presentation setting.

Reference evidence:

- reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:936;
- reference/freeciv-web/freeciv-web/src/main/webapp/javascript/unit.js:987;
- apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:20;
- apps/client/src/components/Canvas2D/renderers/UnitRenderer.ts:214.

Acceptance criteria:

- A square one-tile movement emits the reference offset sequence for all three
  composition samples and settles exactly on the destination.
- A full snapshot does not animate every unit into view.
- Two rapid movement updates do not leave a unit behind or create a ghost.
- Square overlays follow or remain static exactly where the browser composer
  places them; native overlays remain attached to its interpolated unit.
- Unit destruction cancels its movement animation.
- Existing movement and live-state tests remain green.

### ANIM-003 — Combat presentation event

**Priority:** P0  
**Status:** Implemented through the authoritative UnitManager callback for player, AI, and turn-processing attacks; visibility, rich snapshots, duplicate delivery, and focused server/client coverage are present

The server already calculates and returns a CombatResult. The active path now
also emits a visibility-scoped `combat_occurred` Socket.IO event, while the
client keeps authoritative unit updates separate from a short-lived Canvas
effect. The event carries pre-destruction visual snapshots, final HP,
damage/destruction flags, participant IDs, and an optional native presentation
style. Square ISO ignores the style and derives lethal explosion state only.

Existing authoritative data:

- CombatResult contains attacker/defender IDs, damage, and destruction flags in
  apps/server/src/game/managers/UnitManager.ts:140.
- UNIT_ATTACK_REPLY returns that result through
  apps/server/src/types/packet.ts:657.
- Surviving unit updates are broadcast in
  apps/server/src/game/services/UnitManagementService.ts:162.
- Destruction is broadcast separately in
  apps/server/src/game/orchestrators/GameBroadcastManager.ts:206.

The current implementation uses `combat_occurred`. Rich combatant snapshots
feed the native ISO-hex presentation only; square ISO must not reconstruct
virtual combatants. Keep it as presentation data, not a replacement for
`UNIT_INFO`.

Current payload fields:

- eventId and emittedAt;
- attacker and defender visual snapshots: id, playerId, unitTypeId, x, y,
  hpBefore, and optional facing;
- attackerDamage and defenderDamage;
- attackerDestroyed and defenderDestroyed;
- optional native `combatStyle`: swords or explosion;
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

- `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:821-875` calls
  `get_unit_nation_flag_sprite(punit, unit_offset)` while building every unit's
  sprite list.
- `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:1231-1249` resolves
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
reference builds the stack in `reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/tilespec.js:821-934`.
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

### ANIM-004 — Combat effect frames

**Priority:** P1  
**Status:** Exact logical-tile paint-counter explosions for square ISO; elapsed-time
swords/explosions are retained only for native ISO-hex

The pinned 2D web reference starts only a lethal five-frame explosion. It has
no swords branch in `handle_unit_combat_info()` or the 2D unit layer.

`PresentationEffectRenderer` is the active equivalent Canvas layer. It:

1. accepts a CombatPresentationEvent;
2. selects only destroyed combatant tile positions for square ISO;
3. initializes one 25-paint counter on each destroyed logical tile;
4. draws each `explode.unit_0..4` sprite for five tile paints at the browser offset;
5. schedules one cleanup paint after the final sprite, then removes the effect;
6. uses the native elapsed-time frame table only for ISO-hex.

Do not infer combat visibility from client state after the event; the server must
make that decision.

Acceptance criteria:

- Visible lethal square combat produces a five-frame explosion effect.
- Non-lethal square combat produces no transient effect.
- A supplied swords style cannot alter square output.
- Effects appear only on destroyed combatant tiles.
- Effects render above units and below persistent UI panels.
- Square effects advance once per painted logical-tile copy; multiple visible
  wrapped copies therefore advance the same tile counter within one map redraw.
- Missing sprite tags fail gracefully without breaking map rendering.

Tests verify square frame boundaries, tile-scoped reset, offsets, completion,
reduced motion, wrapped-copy advancement, non-lethal suppression, and the
independent native styles.

### ANIM-005 — Combat-time virtual units and health interpolation

**Priority:** P1  
**Status:** Implemented for native ISO-hex and intentionally disabled for
square browser parity

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

A native-only timeline is implemented:

- combat duration: virtual combatants and interpolated health bars;
- effect duration: swords or explosion frame;
- completion: discard visual snapshots.

Avoid rendering two copies of a surviving unit after the effect ends. Never
activate this timeline for the generated Amplio2 provider.

Acceptance criteria:

- Native: a unit that dies remains visible long enough for the death effect.
- A surviving unit’s visual health approaches final authoritative health.
- A removed unit does not disappear before its effect completes.
- The final frame contains no duplicate or stale health bar.
- Hidden combatants are never reconstructed from unauthorized data.
- Square: `getUnitOverrides()` remains empty for the whole effect.

Tests should cover attacker death, defender death, both surviving, legal
multiple-destruction cases, and a unit update arriving before animation end.

### ANIM-006 — Destruction sequencing and cancellation

**Priority:** P1  
**Status:** Partial; combat destruction is retained through the presentation effect, while non-combat destruction still settles immediately

GameClient immediately removes a unit after unit_destroyed in
apps/client/src/services/GameClient.ts:237. That is correct for authoritative
state but leaves no visual snapshot for a death animation.

For combat, the server sends the last known presentation data before the
authoritative update/removal. Native ISO-hex may retain that short-lived Canvas
copy. Square ISO removes the authoritative unit immediately and paints only the
tile explosion, matching the browser. Non-combat destruction remains
immediate.

Handle explicitly:

- combat death;
- settler consumption when founding a city;
- disband or other non-combat destruction;
- destruction while the unit is moving;
- destruction outside the viewport;
- destruction after reconnect or a full snapshot.

Only combat destruction should receive square explosion treatment or native
swords/explosion treatment. Other unit removal uses no combat effect.

Acceptance criteria:

- Square combat death disappears authoritatively and its tile explosion plays
  once; native may retain its visual snapshot during presentation.
- Non-combat destruction does not show a combat effect accidentally.
- Destroyed selected units clear selection without leaving a selected visual copy.
- Repeated destruction notifications are harmless.
- Teardown clears all visual copies.

### ANIM-007 — Nuclear explosion presentation

**Priority:** P2  
**Status:** Exact square one-anchor/60-paint effect plus native visibility-
scoped multi-tile presentation

The browser's nuke packet writes `tile.nuke = 60`, and its final GOTO layer
decrements that tile counter and paints one `explode.nuke` at `(-45,-45)`.
The native client has a distinct `ANIM_NUKE` path.

The active event carries an anchor and a server-authorized visible `tiles`
list. Square ISO paints exactly the anchor for 60 tile paints. Native ISO-hex uses
the visible list for its multi-tile elapsed-time presentation. Both finish
independently of authoritative city/unit updates.

Visibility must be resolved server-side. A client must not derive the entire
blast radius from hidden state.

Acceptance criteria:

- Square paints one packet anchor; native paints only the authorized visible
  subset.
- Players without detonation visibility do not see the effect.
- City, unit, terrain, and population updates remain immediate.
- The effect completes and cleans up if the map changes during playback.

Tests cover provider lookup, square offsets/counter/draw count, native
multi-tile visibility, completion, and the nuclear-action path.

### ANIM-008 — Map recenter slide

**Priority:** P2  
**Status:** Square right-click branch implemented from source; square direct
entry points and native camera remain separate

The web client initializes its 700 ms right-click slide in `mapview.js:434-460`
and advances it in `mapview_common.js:525-559`.

The active square UX centers overview/report/minimap requests directly. A
right click first applies visible-owned-unit menu precedence and the reference
polar guard; a nearby target uses the 100-step linear slide, while an active,
zero-distance, or farther-than-one-viewport slide snaps directly. Manual input
commits the latest rendered origin before taking over. Native ISO-hex retains
the existing cubic programmatic camera behavior.

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

- Square source branches choose direct center versus right-click slide exactly.
- Right-click owned-unit precedence and polar clamps match the browser.
- Manual drag cancels or takes over deterministically.
- Wrapped maps choose the reference-compatible visual path.
- Bounds and fog do not reveal stale pixels.

### ANIM-009 — Native animated borders and transient tile markers

**Priority:** P3  
**Status:** Native-only optional behavior; square ISO deliberately uses static
browser borders and no recenter marker

The audited pinned 2D browser paints static dashed borders and does not add a
`grid.usermark` when right-click recentering. Earlier notes conflated CivJS's
native presentation options with square-browser behavior.

The native path provides:

- BorderRenderer keeps its phase outside authoritative map state and exposes
  `hasActiveAnimation()` to MapRenderer.
- MapRenderer continues rendering only while moving borders are enabled; the
  normal default remains static borders.
- Native empty-tile `center-map-on-tile` events may add a 900 ms
  `grid.usermark` effect.
- The native marker is drawn before fog and expires through the normal effect
  loop.

This work should not block unit combat animation.

Acceptance criteria:

- Square border phase remains static and no recenter marker is created.
- Native border phase advances while enabled and visible.
- No permanent full-map render loop exists when no animated border is present.
- A native tile marker expires automatically and is cancelled on teardown.

### ANIM-010 — Reduced motion, timing, and performance policy

**Priority:** P1  
**Status:** Implemented for current Canvas paths; native-style timing configurability and a dedicated shared controller remain follow-up work

Canvas reads the saved `reducedMotion` preference through MapCanvas and passes
it to every RenderState. The preference is also refreshed when the settings
change event fires.

When reduced motion is enabled, the current Canvas policy:

- disable map recenter slide;
- render unit movement as a short snap or short interpolation;
- render the first square effect frame without scheduling continuation;
- suppress native combat continuation while keeping one informative frame;
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

1. ANIM-001: optional reusable scheduler cleanup, preserving square per-copy
   paint counters. **Not a parity blocker.**
2. ANIM-002: move transition capture closer to packet handling if packet-level
   timing evidence exposes a difference; square counter output is implemented.
3. PRES-001: make nation shields deterministic and movement-attached. **Done.**
4. ANIM-003: combat presentation event and visibility routing. **Done.**
5. ANIM-004: exact square explosions plus native effect frames. **Done.**
6. ANIM-005: native virtual combatants; square suppression. **Done.**
7. ANIM-006: add an intentional non-combat destruction policy. **Combat portion done.**
8. ANIM-010: reduced-motion and timing controls. **Done for current Canvas paths.**
9. ANIM-007: square one-anchor and native visible-area nuke paths. **Done.**
10. ANIM-008: square source-specific and native camera paths. **Done.**
11. ANIM-009: square static and native optional border/marker paths. **Done.**

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

| Scenario                       | Square ISO expected result                         | Native ISO-hex expected result            |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- |
| Initial snapshot               | Units appear immediately; no transition            | Same                                      |
| Visible identity               | Browser sprite order and matching nation shield    | Provider-native composition               |
| One move                       | Three-sample eight-step offsets, exact destination | 180 ms cubic destination                  |
| Two rapid moves                | Queued; no ghost or stale overlay                  | Queued; no ghost or stale overlay         |
| Non-lethal combat              | No transient effect                                | Style effect and HP interpolation allowed |
| Lethal combat                  | Dead unit removed; 25-paint tile explosion         | Virtual snapshot then configured effect   |
| Nuclear detonation             | One anchor for 60 tile paints                      | Authorized visible affected tiles         |
| Overview/report/minimap center | Direct target                                      | Native programmatic camera behavior       |
| Nearby right-click center      | Linear 700 ms/100-step slide                       | Native context/camera behavior            |
| Distant right-click center     | Direct target                                      | Native context/camera behavior            |
| Borders/marker                 | Static dash; no marker                             | Optional animated dash/marker             |
| Reduced motion                 | First frame, no continuation; camera snap          | Informative frame and camera snap         |
| Reconnect/full snapshot        | No replay of old movement/effects                  | Same                                      |
| Cleanup/unmount                | No loop or visual ghost                            | Same                                      |

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
