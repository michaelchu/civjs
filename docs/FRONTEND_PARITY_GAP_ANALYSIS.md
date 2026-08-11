# Frontend Parity Gap Analysis

**Audit date:** 2026-08-11
**Reference revision:** `freeciv-web/develop` at
`c19ce060fadc99663f8aba3652ca94b07174467c`
**Scope:** CivJS's React/Canvas client compared with the pinned
`reference/freeciv-web` browser client, with emphasis on board rendering,
overview/minimap rendering, sprites, and mouse/keyboard interaction.

The upstream check was performed with `git ls-remote` against
`https://github.com/freeciv/freeciv-web.git`. The remote `develop` tip still
matches the submodule, so this audit incorporates the latest available
upstream additions without changing the pin.

This is a behavior and integration audit, not a claim of pixel-identical
rendering. CivJS uses a typed Zustand snapshot and a provider-backed Canvas
renderer; the legacy client uses browser globals, generated sprite tables, and
imperative DOM/canvas state.

## Method

The comparison covered the current submodule sources, the CivJS rendering and
interaction tests, the carried Amplio2 config/spec/atlas, and these focused
checks:

```sh
git ls-remote https://github.com/freeciv/freeciv-web.git refs/heads/develop
npm --prefix apps/client run type-check
npm --prefix apps/client run test -- --run \
  src/components/GameUI/__tests__/Minimap.test.tsx \
  src/utils/__tests__/mapInteraction.test.ts \
  src/services/__tests__/KeyboardController.test.ts \
  src/components/Canvas2D/__tests__/MapCanvas.goto-feedback.test.tsx
```

Reference source paths are recorded in the findings so a future submodule
advance can be reviewed against the same surfaces.

## Findings

| ID     | Frontend surface                                   | Current status                                                              | Reference evidence                                                                                                                                                                              | CivJS evidence                                                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 | Board painter order and layer separation           | Implemented; regression coverage exists                                     | `freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:580-720` renders terrain, borders/specials, cities, units, fog, and interaction layers in ordered passes.                           | `apps/client/src/components/Canvas2D/MapRenderer.ts:349-389` dispatches `TerrainRenderer`, `BorderRenderer`, cities, units, presentation effects, fog, paths, and selection in stable painter order. The renderer culls visible tiles and draws wrapped copies from one snapshot.                                                   |
| FE-002 | Isometric projection, finite edges, and wrapping   | Implemented; geometry tests exist                                           | `2dcanvas/mapview_common.js:195-239,282-291` normalizes GUI positions, map wrapping, and finite-map padding.                                                                                    | `mapTopologyGeometry.ts`, `MapRenderer.ts:237-291`, and `minimapGeometry.ts` share native/display transforms. ISO minimap tiles retain diamond/parallelogram footprints, wrapped origins are translated, and finite-map ocean/fog padding is handled explicitly.                                                                    |
| FE-003 | Overview terrain palette and marker precedence     | Resolved in this audit                                                      | `overview.js:304-335` builds terrain/player palettes; `overview.js:342-379` resolves city, visible unit, known owner, terrain, and unknown colors in that order.                                | `GameUI/minimapVisibility.ts` and `GameUI/Minimap.tsx` now implement the same precedence and C2C3 terrain palette. Own city/unit, foreign city, foreign unit, owner, terrain, and unknown cases are source-mapped in `Minimap.test.tsx`.                                                                                            |
| FE-004 | Overview viewport outline and click-to-center      | Implemented with an intentional geometry adaptation                         | `overview.js:233-275,387-400` draws the viewport outline and maps overview clicks to map coordinates.                                                                                           | `minimapGeometry.ts` projects GUI viewport corners through logical map space, producing an ISO diamond and wrapped copies; `Minimap.tsx` keeps the outline on a separate overlay canvas and emits center requests consumed by `MapCanvas`.                                                                                          |
| FE-005 | Sprite sheets, tags, frame suffixes, and offsets   | Partial; current Amplio2 asset snapshot intentionally retained              | `2dcanvas/tileset_config_amplio2.js` and `tilespec.js` define image counts, dimensions, sprite tables, and presentation offsets. The pinned config is older than CivJS's carried custom config. | `Amplio2TilesetProvider.ts` loads the CivJS config/spec/three-sheet atlas, caches canvases, clears stale cache entries on reload, and accepts both bare and `:0` frame tags. `TILESET_ARCHITECTURE.md` records that legacy composition tables and all offsets are not yet fully provider-owned; exact visual parity is not claimed. |
| FE-006 | Mouse click, goto, touch, and right-drag selection | Right-drag gate resolved in this audit; broader interaction remains partial | `2dcanvas/mapctrl.js:54-127` defines click/mousedown modes; `control.js:367-374` activates right rectangle selection only after both axes exceed 45 px and 200 ms.                              | `MapCanvas.tsx` preserves existing left/Alt drag and touch behavior, while `mapInteraction.ts:isRightDragSelectionReady` and `MapCanvas.tsx` apply the delayed 45 px/200 ms right-drag gate. Normal right clicks still resolve to context/tile information.                                                                         |
| FE-007 | Keyboard listener lifecycle and map actions        | Lifecycle bug resolved in this audit; action parity remains partial         | `control.js:80-91` installs/removes the global keyboard listener and `control.js:380-416` updates cursor/action state.                                                                          | `KeyboardController.ts` now removes the same bound handler it registered, preventing duplicate actions after map-tab/session transitions. Key bindings and action dispatch are covered by the existing controller tests; a full browser-level action parity claim is not made.                                                      |
| FE-008 | Animations, sprites, and visual effects            | Partial by design                                                           | The latest pinned tree includes the reference animation/effect paths in `mapview.js`, `control.js`, and the Amplio2 tables.                                                                     | CivJS supports movement, combat, marker, border, fog, city, unit, and path presentation effects through specialized renderers. Walking-cycle and complete legacy animation sequencing, exact camera behavior, and pixel-diff parity still require a browser visual harness.                                                         |

## Latest-reference additions that must stay on the audit list

When the submodule advances, review these files first because they are the
highest-risk frontend contracts:

- `javascript/overview.js`: palette precedence, visibility, viewport outline,
  and overview click mapping.
- `javascript/2dcanvas/mapctrl.js`: button-specific mouse and touch behavior.
- `javascript/control.js`: drag thresholds, context-menu suppression, cursor
  state, goto mode, and keyboard listener lifecycle.
- `javascript/2dcanvas/tileset_config_amplio2.js` plus `javascript/tilespec.js`:
  image counts, sprite tags, frame suffixes, offsets, and terrain composition.

The CivJS `apps/client/public/js/2dcanvas/tileset_config_amplio2.js`,
`tileset_spec_amplio2.js`, and PNG atlas are application assets. Compare them
with upstream on every pin update, but do not discard CivJS-specific asset
additions without checking deployment and renderer tests.

## Verification record

The focused frontend regression set passed during this audit:

- Minimap geometry, palette, and visibility tests.
- Right-drag threshold and map-interaction tests.
- Keyboard activation/deactivation tests.
- MapCanvas goto, context-menu, middle-click, and Alt-drag tests.
- Client TypeScript type-check.
- Repository-wide `npm run verify` (including client/server lint, type-check,
  formatting, and unit suites).

The repository-wide gate passed with 64 client suites (311 tests) and 179
server suites (1,894 passing, 15 skipped). CI remains the final post-push
verification of the same change.

## Known limitations

- No automated pixel-level comparison against a running freeciv-web browser
  client exists yet.
- The CivJS renderer intentionally uses typed snapshots and separate overlay
  canvases instead of the legacy global `overview_canvas`/DOM lifecycle.
- The Amplio2 config/spec/atlas is a CivJS-carried snapshot with deployment and
  renderer additions; the provider boundary is not yet a complete normalized
  terrain-composition contract.
- Exact legacy animation timing, all cursor states, and every keyboard/action
  branch remain broader parity work beyond this focused audit.
