# Frontend Parity Gap Analysis

**Audit date:** 2026-08-13
**Reference revisions:** `freeciv-web/develop` at
`c19ce060fadc99663f8aba3652ca94b07174467c` and `freeciv/main` at
`eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc`
**Scope:** CivJS's React/Canvas client compared with the pinned browser and
native Freeciv clients, with emphasis on board rendering, overview/minimap
rendering, sprites, and mouse/keyboard interaction.

The upstream check was performed with `git ls-remote` against
`https://github.com/freeciv/freeciv-web.git`. The remote `develop` tip still
matches the submodule, so this audit incorporates the latest available
upstream additions without changing the pin.

This is a behavior and integration audit with strict pixel comparisons for
deterministic terrain/fog scenes. CivJS uses a typed Zustand snapshot and a
provider-backed Canvas renderer; the browser client uses globals, generated
sprite tables, and imperative DOM/canvas state, while native Freeciv parses
tilespec packages and paints its declared layer sequence. Square-ISO fixtures
continue to compare directly with the pinned freeciv-web painter. Production
C2C3 fixtures now select the pinned Freeciv Hexemplio assets and native
ISO-hex geometry.

The overview has the same split. Square-ISO compatibility fixtures retain
freeciv-web's rectangular one-cell bitmap. C2C3 uses Freeciv's staggered
natural raster, where every native tile occupies a `2x1` cell. Terrain,
markers, wrapping, pointer inversion, and the projected camera footprint share
that transform, so a minimap click, the board camera, and the white outline
resolve to the same native tile without independently stretched axes.

The pixel coverage is deliberately map-only. World-map captures hide the game
HUD, and minimap captures target only the base and viewport-overlay canvases, so
custom UI panels and their look and feel are excluded from the baselines.

## Exactness boundary

“Exact end to end” applies only to the explicitly covered surfaces below. The
native ISO-hex path is no longer routed through the square-ISO painter, but its
source-mapped tests are not yet an independent native-Freeciv world-pixel
comparison:

| Boundary                                                | Result                                                    | Reason                                                                                                                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finite square-isometric terrain and feature composition | Direct zero-diff reference coverage                       | The harness runs the pinned browser painter with the same deterministic tile data and compares final pixels.                                                                                                                  |
| Painter layers and wrapped-copy ordering                | Source-mapped command coverage                            | Every wrapped copy participates in one global painter walk; GOTO feedback remains drawable over unknown terrain as in the reference. A seam-centered reference pixel oracle is still missing.                                 |
| Minimap palette raster                                  | Direct zero-diff coverage for both renderer paths         | Square ISO matches `overview.js`; C2C3's final `256x256` raster matches an independent implementation of Freeciv's staggered natural `2x1` cells.                                                                             |
| Displayed ISO minimap and camera outline                | Implemented with end-to-end interaction coverage          | One physical scale is used on both axes. A browser test clicks a native cell, verifies the board camera resolves to that tile through the active Hexemplio inverse, and samples the corresponding sloped white outline.       |
| Unit/city composition                                   | Source-mapped command coverage, not direct pixel equality | Native offsets, focus/non-focus layers, stack/status overlays, city layers, and Auto fog use the generated Hexemplio package. There is not yet an independent native-client entity pixel capture.                             |
| Observer map presentation                               | Initial and live render state covered                     | Observers receive an omniscient initial snapshot and a dedicated live room for terrain/resources, units, cities, borders, combat, and nuclear effects. Owner-only automation tasks and worker action choices remain excluded. |
| C2C3 ISO+HEX gameplay topology                          | Implemented through the native Hexemplio pipeline         | Topology `3` selects the generated Hexemplio provider, native/logical projection, six valid directions, native layer order, and matching `126x64`/hex-side geometry. Amplio2 remains isolated to compatible square-ISO maps.  |

The former topology/tileset incompatibility is resolved. The main remaining
rendering evidence gap is a headless native Freeciv capture for complete
ISO-hex world pixels, entities, and wrapped seams; the current native pipeline
is protected by exact generated assets, source-mapped command tests, CivJS
visual baselines, and the independent minimap-raster oracle.

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
browser fixture validates canvas color diversity plus the active provider's
topology, geometry, source revision, generated manifest, and sprite tags. The terrain and unit
renderer contracts now also cover native terrain blends, six-direction rivers
and coast outlets, ruleset-ordered extras, roads/railways, resources, borders,
Auto fog boundaries, native unit/city offsets, stack/status overlays, activity
targets, and reduced-motion selection frames. The mounted minimap overlay and
Escape target-action cancellation are covered as lifecycle behaviors.

The map-only pixel suite seeds deterministic `48x48` and `32x64` maps. Its
production geometry case uses the C2C3 topology and wrapping contract
(`topology_id=3`, `wrap_id=3`) and captures the Hexemplio world-map canvas and
minimap base/overlay pair. Shifted CivJS save values (`4`, `8`, and `12`) are
migrated server-side; live rendering, fog, projection, minimap geometry, and
the reference harness all consume Freeciv's canonical ISO/HEX bits (`1`/`2`).
The CivJS suite uses strict zero-diff baselines for native terrain, extras,
borders, fog, and unit/city overlays. The separate
`freeciv-web-pixel.spec.ts` suite loads the pinned reference JavaScript and
generated sprite table directly into a blank browser page, without starting a
Freeciv server or full client. It compares terrain-only world pixels and the
physically scaled overview base with zero channel tolerance. A separate
`32x64` C2C3 case compares the final `256x256` minimap byte-for-byte with an
independent native natural-raster oracle. The actual painted outline is sampled
after a click-to-camera round trip through Hexemplio's `126x64` hex hit-test.
The finite browser oracle stays separate from the wrapped C2C3 fixture so
topology coverage cannot weaken the existing freeciv-web world-pixel assertion.
3D terrain modes are not covered.

## Findings

| ID     | Frontend surface                                            | Current status                                                                                                                        | Reference evidence                                                                                                                                                                                                                                                                        | CivJS evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Board painter order and layer separation                    | Implemented for square ISO and native ISO-hex; command and seam-order regression coverage exists                                      | freeciv-web `mapview_common.js:251-402` defines the browser passes. Freeciv `data/hexemplio.tilespec:111-143` and `client/tilespec.c:6139-6465` define Hexemplio's native sequence and extra families.                                                                                    | `MapRenderer.ts` merges wrapped copies into one depth-sorted walk, then selects the provider's layer policy. Native tests protect Terrain1/2, Darkness, Terrain3, Water, Roads, Special1/2/3, Grid1, City1/2, Fog boundaries, Unit/FocusUnit, overlays, labels, city bars, and GOTO behavior.                                                                                                                                                                   |
| FE-002 | Isometric projection, finite edges, and wrapping            | Implemented; native/logical projection and physical overview geometry have regression coverage                                        | Freeciv `common/map.h:170-190`, `client/mapview_common.c:594-668`, and `client/overview_common.c:51-108,324-483` define native/logical/GUI conversion, hex hit-testing, wrapping, and the natural overview.                                                                               | `mapTopologyGeometry.ts`, `MapRenderer.ts`, and `minimapGeometry.ts` share native dimensions, six ISO-hex directions, `126x64` Hexemplio projection, pointer inversion, staggered `2x1` overview cells, and wrapped copies. Unit tests round-trip every `32x64` tile; browser tests cover the click/camera/outline round trip.                                                                                                                                  |
| FE-003 | Overview terrain palette and marker precedence              | Resolved in this audit                                                                                                                | `overview.js:304-335` builds terrain/player palettes; `overview.js:342-379` resolves city, visible unit, known owner, terrain, and unknown colors in that order. Its observer path treats every visible unit as foreign.                                                                  | `GameUI/minimapVisibility.ts` and `GameUI/Minimap.tsx` implement the same precedence and C2C3 terrain palette. Own city/unit, foreign city/unit, observer unit, owner, terrain, and unknown cases are source-mapped in `Minimap.test.tsx`; the mounted minimap test also verifies the overlay draw lifecycle.                                                                                                                                                   |
| FE-004 | Overview viewport outline and click-to-center               | Implemented; continuous geometry and end-to-end pixel regression exist                                                                | `overview.js:194-275,387-400` supplies the separate overlay, map-axis transform, wrapping copies, and click mapping, but its `gui_to_map_pos()` floors camera corners. Freeciv `client/overview_common.c:51-79,153-177` retains fractional corner precision before overview conversion.   | `minimapGeometry.ts` uses the continuous inverse projection for camera corners while retaining integer tile selection for board interaction. `Minimap.tsx` draws the pale-white wrapped polygons on a separate canvas and maps clicks through the same physical transform. `renderer-pixel.spec.ts` clicks a `32x64` minimap, verifies the board camera centers on that tile, then confirms the painted outline is centered there and samples its sloped edges. |
| FE-005 | Sprite sheets, tags, frame suffixes, and offsets            | Resolved for C2C3 Hexemplio; legacy Amplio2 provenance remains partial                                                                | Freeciv `data/hexemplio.tilespec` and its ordered spec files define geometry, layers, styles, offsets, tags, source rectangles, and standalone assets.                                                                                                                                    | `generate-hexemplio-tileset.mjs` creates a revisioned schema-2 package from pinned Freeciv, copying exact PNGs and GPL metadata. `HexemplioTilesetProvider` preloads sheets, lazily loads standalone sprites, and applies native offsets. `check:hexemplio-tileset` rejects drift. The older Amplio2 compatibility package retains its separate provenance limitation.                                                                                          |
| FE-006 | Mouse click, goto, touch, and right-drag selection          | Right-drag, core touch lifecycle, and target-action cancellation coverage resolved in this audit; broader interaction remains partial | `2dcanvas/mapctrl.js:54-127` defines click/mousedown modes; `mapctrl.js:131-190` handles touch pan/long-press; `control.js:367-374` activates right rectangle selection only after both axes exceed 45 px and 200 ms; `control.js:2199-2221` aborts active goto/target actions on Escape. | `MapCanvas.tsx` preserves existing left/Alt drag and touch behavior, while `mapInteraction.ts:isRightDragSelectionReady` and `MapCanvas.tsx` apply the delayed right-drag gate, touch pan commit, stationary long-press context interaction, and Escape cleanup of target-action feedback. Normal right clicks still resolve to context/tile information.                                                                                                       |
| FE-007 | Keyboard listener lifecycle and map actions                 | Lifecycle bug resolved in this audit; action parity remains partial                                                                   | `control.js:80-91` installs/removes the global keyboard listener and `control.js:380-416` updates cursor/action state.                                                                                                                                                                    | `KeyboardController.ts` now removes the same bound handler it registered, preventing duplicate actions after map-tab/session transitions. Key bindings and action dispatch are covered by the existing controller tests; a full browser-level action parity claim is not made.                                                                                                                                                                                  |
| FE-008 | Animations, sprites, and visual effects                     | Partial; native static composition and selection cadence are source-mapped, movement timing is not exact                              | Freeciv `client/tilespec.c:4744-4970` defines native unit flags, body, activity, orders, HP, stack, veteran, and focus composition; freeciv-web supplies the six-Hz selection cadence.                                                                                                    | CivJS uses Hexemplio's unit offsets and native tags for flags, stack/status sprites, orders, body, activity, HP, veteran, selection, and FocusUnit separation. Movement fragment handling is consistent across reply/broadcast packets, but CivJS's cubic movement interpolation remains different from freeciv-web's frame-stepped algorithm.                                                                                                                  |
| FE-009 | Render-only reference snapshots and cross-client comparison | Implemented for browser terrain/overview and native C2C3 minimap; native world/entity oracle remains open                             | `mapview_common.js:266-450` and `overview.js:117-379` supply the browser capture. Freeciv `overview_common.c:324-483` supplies the independent native minimap raster rule.                                                                                                                | Browser terrain and square overview remain direct zero-diff comparisons. The C2C3 `32x64` minimap is zero-diff against an independent staggered `2x1` oracle, and native world/minimap snapshots plus click/camera/outline behavior are locked. A headless native-Freeciv world/entity capture and seam-centered native differential remain required.                                                                                                           |

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
- `reference/freeciv/data/hexemplio.tilespec`, its declared spec files, and
  `reference/freeciv/client/tilespec.c`: native ISO-hex package data, layer
  order, terrain blending, extras, units, cities, borders, and fog policy.
- `tools/generate-hexemplio-tileset.mjs`: reproducible package generation and
  source-revision validation.
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
  outlets, irrigation/farmland, resources, player-colored borders, native
  layer/fog boundaries, unit overlays, activity targets, and selection frames.
- Generated Hexemplio manifest/package validation against pinned Freeciv,
  including 3,263 sprite tags and exact copied source images.
- Active Hexemplio provider identity, exact topology compatibility, geometry,
  source revision, preload count, manifest rectangle validity, and required
  native sprite-tag checks in the browser fixture.
- Escape cancellation of active target-action feedback and the mounted
  minimap viewport overlay redraw/unmount lifecycle.
- Map-only pixel baselines for the isometric world map and physical-aspect
  minimap, including the sloped pale-white viewport outline; no UI-panel pixels
  are included.
- The render-only reference suite: strict zero-diff browser terrain-world and
  square-overview comparisons, native Hexemplio visual baselines, full
  displayed-pixel parity for a `32x64` C2C3 natural overview, and an exact
  click-to-camera-to-outline round trip.
- Client TypeScript type-check.
- Repository-wide `npm run verify` (including client/server lint, type-check,
  formatting, and unit suites).

The focused native map/minimap/movement batch passed 101 tests. The final
combined Chromium run passed all 10 tests: 4 renderer/UI and active-provider
contract checks, 3 render-only reference comparisons, and 3 strict native
map/minimap pixel and click-camera-outline tests. Repository-wide `npm run
verify` passed 68 client suites (365 tests) and 180 server suites (1,899 passed,
15 intentionally skipped). The production client and server build also passed.

## Known limitations

- The strict cross-client pixel comparison intentionally covers a terrain/fog
  scene plus terrain features, but the harness disables units and cities.
  Entity composition has source-mapped command tests; exact sprite-by-sprite
  cross-client equality is not yet claimed.
- Square-ISO overview color rasterization matches freeciv-web for covered
  fixtures. C2C3 instead follows Freeciv's staggered natural `2x1` raster; it
  has a byte-exact independent oracle, but not a native GUI process capture.
- The strict browser world-pixel oracle is finite square ISO because the pinned
  freeciv-web harness has neither Hexemplio nor a complete wrapped
  `map_pos_to_tile()` adapter. Production C2C3 wrapped-board behavior is covered
  by native renderer tests and CivJS baselines, but a seam-centered
  native-Freeciv zero-diff world capture remains a test-harness gap.
- The CivJS renderer intentionally uses typed snapshots and separate overlay
  canvases instead of the legacy global `overview_canvas`/DOM lifecycle.
- The C2C3 topology/Amplio2 mismatch is resolved by selecting Hexemplio for
  `ISO|HEX`. The Amplio2 config/spec/atlas remains a customized CivJS-carried
  compatibility snapshot. It does not share one reproducible revision with the
  pinned reference painter, and its exact entity-pixel provenance is still not
  claimed.
- Selection cadence is exact, but movement interpolation, all cursor states,
  and every keyboard/action branch remain broader parity work.
