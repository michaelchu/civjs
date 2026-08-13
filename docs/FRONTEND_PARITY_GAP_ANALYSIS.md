# Frontend Parity Gap Analysis

**Audit date:** 2026-08-12
**Reference revision:** `freeciv-web/develop` at
`c19ce060fadc99663f8aba3652ca94b07174467c`
**Scope:** CivJS's React/Canvas client compared with the pinned
`reference/freeciv-web` browser client, with emphasis on board rendering,
overview/minimap rendering, sprites, and mouse/keyboard interaction.

The upstream check was performed with `git ls-remote` against
`https://github.com/freeciv/freeciv-web.git`. The remote `develop` tip still
matches the submodule, so this audit incorporates the latest available
upstream additions without changing the pin.

This is a behavior and integration audit with a strict pixel comparison for a
deterministic terrain/fog scene. CivJS uses a typed Zustand snapshot and a
provider-backed Canvas renderer; the legacy client uses browser globals,
generated sprite tables, and imperative DOM/canvas state. The feature-rich
reference scene is also snapshotted. Overview palette generation still uses
freeciv-web's rectangular square-cell source bitmap. CivJS presents that
bitmap through Freeciv's physical `2x1` isometric overview cell, with one
shared scale on both axes, and draws the camera footprint separately as a
projected polygon. This intentionally fixes two lossy browser-reference
behaviors: independently stretched overview axes and integer-rounded viewport
corners. The remembered-fog presentation difference remains explicit rather
than being hidden in a permissive image threshold.

The pixel coverage is deliberately map-only. World-map captures hide the game
HUD, and minimap captures target only the base and viewport-overlay canvases, so
custom UI panels and their look and feel are excluded from the baselines.

## Exactness boundary

“Exact end to end” currently applies only to the explicitly covered
square-isometric browser-painter surfaces. It must not be generalized to every
map topology or every entity sprite yet:

| Boundary                                                | Result                                                    | Reason                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Finite square-isometric terrain and feature composition | Direct zero-diff reference coverage                       | The harness runs the pinned browser painter with the same deterministic tile data and compares final pixels.                                                                                                                                                 |
| Painter layers and wrapped-copy ordering                | Source-mapped command coverage                            | Every wrapped copy participates in one global painter walk; GOTO feedback remains drawable over unknown terrain as in the reference. A seam-centered reference pixel oracle is still missing.                                                                |
| Minimap palette raster                                  | Direct zero-diff reference coverage                       | CivJS generates the same rectangular square-cell color bitmap as `overview.js`.                                                                                                                                                                              |
| Displayed ISO minimap and camera outline                | Intentional corrected parity target                       | The source bitmap receives one uniform physical `2:1` transform, and the outline uses continuous projected camera corners. This combines freeciv-web's raster with Freeciv C's aspect and precision rather than reproducing the browser client's distortion. |
| Unit/city composition                                   | Source-mapped command coverage, not direct pixel equality | City-bar commands, unit ordering, selection cadence, Flagless shields, and server-side-agent overlays are covered. The runtime atlas is not generated from the pinned web baseline, and the reference pixel harness currently disables entities.             |
| Observer map presentation                               | Initial and live render state covered                     | Observers receive an omniscient initial snapshot and a dedicated live room for terrain/resources, units, cities, borders, combat, and nuclear effects. Owner-only automation tasks and worker action choices remain excluded.                                |
| C2C3 ISO+HEX gameplay topology                          | Incompatible with the current painter                     | C2C3 advertises topology `3`, while Amplio2 declares square isometric (`is_hex=FALSE`). Freeciv classifies that pair as hard-incompatible and selects an ISO-hex tileset such as Hexemplio instead.                                                          |

The topology row is the largest remaining architectural gap. To preserve exact
C2C3 map semantics, CivJS needs an ISO-hex geometry/tileset provider and must
select it for topology `3`. Changing the server to square ISO topology `1`
would make Amplio2/freeciv-web presentation coherent, but would be an explicit
gameplay deviation from C2C3 rather than a parity fix.

## Method

The comparison covered the current submodule sources, the CivJS rendering and
interaction tests, the carried Amplio2 config/spec/atlas, and these focused
checks:

```sh
git ls-remote https://github.com/freeciv/freeciv-web.git refs/heads/develop
npm --prefix apps/client run type-check
npm --prefix apps/client run test -- --run \
  src/components/Canvas2D/__tests__/MapRenderer.layer-order.test.ts \
  src/components/Canvas2D/__tests__/MapRenderer.live-state.test.ts \
  src/components/Canvas2D/__tests__/TerrainRenderer.parity.test.ts \
  src/components/Canvas2D/__tests__/UnitRenderer.parity.test.ts \
  src/components/Canvas2D/__tests__/BorderRenderer.player-color.test.ts \
  src/components/Canvas2D/__tests__/Amplio2TilesetProvider.lifecycle.test.ts \
  src/components/GameUI/__tests__/Minimap.test.tsx \
  src/utils/__tests__/mapInteraction.test.ts \
  src/services/__tests__/KeyboardController.test.ts \
  src/components/Canvas2D/__tests__/MapCanvas.goto-feedback.test.tsx
npx playwright test tests/e2e/renderer-parity.spec.ts --project=chromium-desktop
npx playwright test tests/e2e/renderer-pixel.spec.ts --project=chromium-desktop
npx playwright test tests/e2e/freeciv-web-pixel.spec.ts --project=chromium-desktop
```

Reference source paths are recorded in the findings so a future submodule
advance can be reviewed against the same surfaces.

The parity suite now also verifies the rendered output boundary instead of
only testing pure geometry helpers: the painter pass order is asserted with a
deterministic renderer fixture, the mounted minimap is checked for city and
foreign-owner colors, animation redraw and cleanup are exercised through the
renderer lifecycle, touch pan and long-press behavior are exercised through
`MapCanvas`, provider reloads are checked for stale sprite eviction, and the
browser fixture validates canvas color diversity plus the shape/configuration
of sprite tags required by active board renderers. The terrain and unit
renderer contracts now also cover connected roads, rivers, coast outlets,
irrigation suppression, resources, unit overlays, activity targets, and
reduced-motion selection frames; the mounted minimap overlay and Escape target
action cancellation are covered as lifecycle behaviors.

The map-only pixel suite seeds deterministic `48x48` and `32x64` maps. Its
production geometry case uses the C2C3 topology and wrapping contract
(`topology_id=3`, `wrap_id=3`) and captures the world-map canvas and minimap
base/overlay pair. Shifted CivJS save values (`4`, `8`, and `12`) are migrated
server-side; live rendering, fog, projection, minimap geometry, and the
reference harness all consume Freeciv's canonical ISO/HEX bits (`1`/`2`). The
CivJS-only suite uses strict zero-diff
baselines for terrain, rivers, coast outlets, roads, rails, irrigation,
resources, borders, fog, and unit/city overlays. The separate
`freeciv-web-pixel.spec.ts` suite loads the pinned reference JavaScript and
generated sprite table directly into a blank browser page, without starting a
Freeciv server or full client. It compares terrain-only world pixels and the
physically scaled overview base with zero channel tolerance, including a
`32x64` native ISO map that becomes a square `256x256` overview. Viewport
geometry is compared to independently evaluated continuous reference math and
the actual painted outline is sampled after a click-to-camera round trip. The
finite board oracle remains separate from the C2C3 wrapped minimap fixture so
topology coverage cannot weaken the existing world-pixel assertion. Hex-shaped
tilesets and 3D terrain modes are not part of this coverage.

## Findings

| ID     | Frontend surface                                            | Current status                                                                                                                        | Reference evidence                                                                                                                                                                                                                                                                                                                                                                                     | CivJS evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Board painter order and layer separation                    | Implemented for the square-isometric painter; command and seam-order regression coverage exists                                       | `freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:251-402` refreshes the map through ordered layer passes and deliberately lets the GOTO layer run for unknown tiles.                                                                                                                                                                                                                 | `MapRenderer.ts` merges every visible wrapped copy into one globally depth-sorted walk for terrain, borders, cities, unit/effect layers, fog, labels, and paths. Paint-visible entries exclude unknown terrain, while geometry-visible entries remain available to GOTO feedback. `MapRenderer.layer-order.test.ts` protects the full pass order, unknown-tile exception, and wrapped-copy ordering.                                                                                                           |
| FE-002 | Isometric projection, finite edges, and wrapping            | Implemented; world projection and physical overview geometry have regression coverage                                                 | `2dcanvas/mapview_common.js:195-239,282-291` normalizes GUI positions, map wrapping, and finite-map padding. `overview.js:50-54,104-109,139-158` supplies the square-cell source raster. Freeciv `client/overview_common.h:27-33` and `overview_common.c:450-483` define a `2x1` ISO overview cell and natural width `2 * xsize`.                                                                      | `mapTopologyGeometry.ts`, `MapRenderer.ts`, and `minimapGeometry.ts` share native dimensions, physical `2x1` overview cells, pointer inversion, marker centers, and wrapped copies. The source remains byte-for-byte compatible with the browser palette bitmap, but display sizing preserves one physical scale rather than independently stretching axes. `renderer-pixel.spec.ts` and `freeciv-web-pixel.spec.ts` cover `48x48` and `32x64` geometry under real C2C3 topology/wrap metadata.                |
| FE-003 | Overview terrain palette and marker precedence              | Resolved in this audit                                                                                                                | `overview.js:304-335` builds terrain/player palettes; `overview.js:342-379` resolves city, visible unit, known owner, terrain, and unknown colors in that order. Its observer path treats every visible unit as foreign.                                                                                                                                                                               | `GameUI/minimapVisibility.ts` and `GameUI/Minimap.tsx` implement the same precedence and C2C3 terrain palette. Own city/unit, foreign city/unit, observer unit, owner, terrain, and unknown cases are source-mapped in `Minimap.test.tsx`; the mounted minimap test also verifies the overlay draw lifecycle.                                                                                                                                                                                                  |
| FE-004 | Overview viewport outline and click-to-center               | Implemented; continuous geometry and end-to-end pixel regression exist                                                                | `overview.js:194-275,387-400` supplies the separate overlay, map-axis transform, wrapping copies, and click mapping, but its `gui_to_map_pos()` floors camera corners. Freeciv `client/overview_common.c:51-79,153-177` retains fractional corner precision before overview conversion.                                                                                                                | `minimapGeometry.ts` uses the continuous inverse projection for camera corners while retaining integer tile selection for board interaction. `Minimap.tsx` draws the pale-white wrapped polygons on a separate canvas and maps clicks through the same physical transform. `renderer-pixel.spec.ts` clicks a `32x64` minimap, verifies the board camera centers on that tile, then confirms the painted outline is centered there and samples its sloped edges.                                                |
| FE-005 | Sprite sheets, tags, frame suffixes, and offsets            | Partial; blocked on a reproducible single-source atlas baseline                                                                       | `2dcanvas/tileset_config_amplio2.js` and `tilespec.js` define image counts, dimensions, sprite tables, presentation offsets, and agent tags. The pinned config uses unit offsets `19/14`; CivJS's carried customized config uses `25/18` plus per-unit tables. The pinned extractor currently emits four sheets while its runtime config declares three, so generated output cannot be copied blindly. | `Amplio2TilesetProvider.ts` loads the CivJS three-sheet atlas and protects its cache/tag behavior. Terrain and unit tests cover the carried bundle, while renderer logic prefers pinned tags such as `unit.auto_worker` and provides an explicit legacy fallback where the bundle only has `unit.auto_settler`. Until atlas, config, offsets, and manifest are regenerated together from one recorded source revision, exact entity-sprite pixel parity is not claimed.                                        |
| FE-006 | Mouse click, goto, touch, and right-drag selection          | Right-drag, core touch lifecycle, and target-action cancellation coverage resolved in this audit; broader interaction remains partial | `2dcanvas/mapctrl.js:54-127` defines click/mousedown modes; `mapctrl.js:131-190` handles touch pan/long-press; `control.js:367-374` activates right rectangle selection only after both axes exceed 45 px and 200 ms; `control.js:2199-2221` aborts active goto/target actions on Escape.                                                                                                              | `MapCanvas.tsx` preserves existing left/Alt drag and touch behavior, while `mapInteraction.ts:isRightDragSelectionReady` and `MapCanvas.tsx` apply the delayed right-drag gate, touch pan commit, stationary long-press context interaction, and Escape cleanup of target-action feedback. Normal right clicks still resolve to context/tile information.                                                                                                                                                      |
| FE-007 | Keyboard listener lifecycle and map actions                 | Lifecycle bug resolved in this audit; action parity remains partial                                                                   | `control.js:80-91` installs/removes the global keyboard listener and `control.js:380-416` updates cursor/action state.                                                                                                                                                                                                                                                                                 | `KeyboardController.ts` now removes the same bound handler it registered, preventing duplicate actions after map-tab/session transitions. Key bindings and action dispatch are covered by the existing controller tests; a full browser-level action parity claim is not made.                                                                                                                                                                                                                                 |
| FE-008 | Animations, sprites, and visual effects                     | Partial; selection cadence and static composition are source-mapped, movement timing is not exact                                     | The pinned tree composes activity, server-side-agent, action-decision, HP, stack, and veteran sprites in `tilespec.js:674-705`; `895-913` defines Flagless shield visibility; `970-1085` defines activity/agent overlays; `1164-1168` selects at six frames per second.                                                                                                                                | CivJS now exports the ruleset's Flagless bit end to end, paints activity and automation as distinct layers, suppresses activity during auto-explore, and uses the absolute six-Hz selection frame. Movement redraw/cleanup and reduced-motion behavior are tested, but CivJS's elapsed-time cubic interpolation is not the same frame-stepped algorithm as `unit.js:get_unit_anim_offset()`.                                                                                                                   |
| FE-009 | Render-only reference snapshots and cross-client comparison | Implemented for deterministic terrain, overview raster, and continuous camera geometry; entity and wrapped-seam oracles remain open   | `2dcanvas/mapview_common.js:266-450` paints the world canvas; `overview.js:117-379` generates the palette bitmap and legacy outline; `libs/bmp_lib.js` creates the overview image without the full client; Freeciv's overview code supplies the corrected physical/fractional geometry.                                                                                                                | `freecivWebRenderHarness.ts` loads the pinned modules but intentionally stubs `find_visible_unit()`, disables unit/city drawing, and uses the CivJS-carried atlas. `freeciv-web-pixel.spec.ts` therefore proves terrain/features and overview pixels—not unit/city equality. `renderer-pixel.spec.ts` validates CivJS's complete map canvas, outline raster, and click/camera alignment against CivJS baselines. Direct reference entity pixels and a seam-centered wrapped reference capture remain required. |

## Latest-reference additions that must stay on the audit list

When the submodule advances, review these files first because they are the
highest-risk frontend contracts:

- `javascript/overview.js`: palette precedence, visibility, viewport outline,
  and overview click mapping.
- `reference/freeciv/client/overview_common.c` and `.h`: physical ISO overview
  aspect, natural dimensions, fractional camera conversion, and wrap origin.
- `javascript/2dcanvas/mapctrl.js`: button-specific mouse and touch behavior.
- `javascript/control.js`: drag thresholds, context-menu suppression, cursor
  state, goto mode, and keyboard listener lifecycle.
- `javascript/2dcanvas/tileset_config_amplio2.js` plus `javascript/tilespec.js`:
  image counts, sprite tags, frame suffixes, offsets, and terrain composition.
- `tests/e2e/support/freecivWebRenderHarness.ts` and
  `tests/e2e/freeciv-web-pixel.spec.ts`: reference-page loading, the logical
  ISO coordinate adapter, source snapshots, and the zero-tolerance comparison
  contract.

The CivJS `apps/client/public/js/2dcanvas/tileset_config_amplio2.js`,
`tileset_spec_amplio2.js`, and PNG atlas are application assets. Compare them
with upstream on every pin update, but do not discard CivJS-specific asset
additions without checking deployment and renderer tests.

## Verification record

The focused frontend regression set passed during this audit:

- Deterministic map painter-order and mounted minimap draw-command tests.
- Browser sprite-contract and board-render color-diversity checks.
- Minimap geometry, palette, and visibility tests.
- Right-drag threshold and map-interaction tests.
- Keyboard activation/deactivation tests.
- MapCanvas goto, context-menu, middle-click, Alt-drag, right-drag, touch-pan,
  and long-press tests.
- Movement animation redraw/cleanup, reduced-motion and transport transitions,
  and tileset cache reload tests.
- Terrain, border, and unit renderer parity contracts for roads, rivers, coast
  outlets, irrigation, resources, player-colored borders, unit overlays,
  activity targets, and selection frames.
- Sprite manifest tag shape, dimensions, image count, and isometric config
  checks in the browser fixture.
- Escape cancellation of active target-action feedback and the mounted
  minimap viewport overlay redraw/unmount lifecycle.
- Map-only pixel baselines for the isometric world map and physical-aspect
  minimap, including the sloped pale-white viewport outline; no UI-panel pixels
  are included.
- The render-only reference suite: strict zero-diff terrain-world comparison,
  reference world/overview snapshots, full displayed-pixel parity for the
  overview base, continuous viewport geometry, and `32x64` ISO overview bounds.
- Client TypeScript type-check.
- Repository-wide `npm run verify` (including client/server lint, type-check,
  formatting, and unit suites).

The focused map/minimap/interaction and observer-stream batches passed. The
targeted Chromium map run passed 6 tests: 3 render-only reference comparisons
and 3 strict map/minimap pixel and click-camera-outline tests. The
repository-wide gate passed with 67 client suites (350 tests) and 179 server
suites (1,896 passing, 15 skipped). CI remains the final post-push verification
of the same change.

## Known limitations

- The strict cross-client pixel comparison intentionally covers a terrain/fog
  scene plus terrain features, but the harness disables units and cities.
  Entity composition has source-mapped command tests; exact sprite-by-sprite
  cross-client equality is not yet claimed.
- Overview color rasterization matches freeciv-web for covered fixtures: both
  build the same integer rectangular palette bitmap and apply one displayed-size
  resample. CivJS deliberately does not copy freeciv-web's independent-axis
  aspect distortion or integer-rounded camera corners; those are corrected from
  Freeciv C and locked by geometry plus painted-pixel tests.
- The strict cross-client world-pixel oracle is finite ISO because the pinned
  freeciv-web render harness has no complete wrapped `map_pos_to_tile()` adapter.
  Production C2C3 wrapped-board behavior is covered by renderer/unit tests, but
  a seam-centered zero-diff reference world capture remains a test-harness gap.
- The CivJS renderer intentionally uses typed snapshots and separate overlay
  canvases instead of the legacy global `overview_canvas`/DOM lifecycle.
- C2C3's `ISO|HEX` topology and the square-isometric Amplio2 painter are hard
  incompatible under Freeciv's own tileset compatibility rule. Exact C2C3 map
  presentation requires an ISO-hex provider; changing topology to square ISO
  would instead be an explicit ruleset deviation.
- The Amplio2 config/spec/atlas is a customized CivJS-carried snapshot. It does
  not share one reproducible revision with the pinned reference painter, and
  the provider boundary is not yet a complete normalized composition contract.
- Selection cadence is exact, but movement interpolation, all cursor states,
  and every keyboard/action branch remain broader parity work.
