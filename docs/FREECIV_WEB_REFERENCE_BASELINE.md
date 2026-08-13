# Freeciv-web Reference Baseline

`reference/freeciv-web` is the browser-client behavior, rendering, controls,
and asset reference for CivJS. It is pinned as a Git submodule so the project
can update against the official upstream history without carrying a second
vendored copy of the repository.

## Pinned reference

- **Reference path:** `reference/freeciv-web`
- **Upstream repository:** `https://github.com/freeciv/freeciv-web.git`
- **Upstream branch:** `develop`
- **Submodule commit:** `c19ce060fadc99663f8aba3652ca94b07174467c`
  (committed 2025-05-02)
- **JavaScript source root:**
  `reference/freeciv-web/freeciv-web/src/main/webapp/javascript`

The submodule now contains the complete upstream `freeciv-web` tree. The
previous CivJS checkout was a small curated snapshot with a flattened
JavaScript path; source references have been migrated to the upstream
repository layout. The submodule is reference material only;
the CivJS client remains the runtime implementation.

## Frontend audit checkpoint

On 2026-08-11, upstream `develop` still resolved to the pinned
`c19ce060fadc99663f8aba3652ca94b07174467c`; there was no newer
`freeciv-web` commit to import. The latest checked-in frontend additions were
re-audited against the client, including:

- `javascript/overview.js` for overview palette precedence, visibility, marker
  colors, viewport outlines, and click-to-center behavior.
- `javascript/2dcanvas/mapctrl.js` and `javascript/control.js` for map clicks,
  drag modes, right-drag rectangle selection, context-menu suppression, and
  keyboard lifecycle behavior.
- `javascript/2dcanvas/tileset_config_amplio2.js` and `javascript/tilespec.js`
  for sprite tags, frame suffixes, tile dimensions, and presentation offsets.

CivJS carries a newer, application-specific Amplio2 config/spec and PNG atlas
snapshot under `apps/client/public/`. Those assets include CivJS deployment
and renderer additions that are not present as tracked files in the pinned
upstream tree, so they remain in place and are audited through the provider
boundary rather than replaced wholesale by the older upstream config.

That retained bundle is not an exact asset baseline for the pinned painter.
The pinned config uses unit offsets `19/14`, while the carried config uses
`25/18` plus customized per-unit adjustments. The pinned extractor also
currently emits four `1800x1030` sheets although its runtime config declares
three. Before replacing the runtime bundle, the extractor, config, generated
sprite table, image count, offsets, and source Freeciv revision must be made one
reproducible artifact and validated together. Cross-client terrain tests
currently run the pinned painter against the carried atlas, so they certify
painter/rasterization equivalence for those fixtures, not official upstream
asset provenance or unit/city pixel equality.

The detailed client comparison is maintained in
[`FRONTEND_PARITY_GAP_ANALYSIS.md`](FRONTEND_PARITY_GAP_ANALYSIS.md).

For minimap parity, the pinned browser client remains the source of truth for
the integer overview palette raster and marker precedence. Freeciv's native
client overview code supplies the physical `2x1` isometric cell aspect and
fractional viewport-corner conversion: the browser client independently
stretches its axes and floors those corners, which makes non-square maps appear
distorted and moves the outline away from the actual board viewport. CivJS
uses one shared physical transform for the displayed raster, markers, wrapped
copies, pointer inversion, and viewport outline while retaining the exact
freeciv-web source bitmap.

There is also a topology boundary between the two references. C2C3 defaults to
`ISO|HEX` (`topology_id=3`), while Amplio2 declares square isometric
(`is_hex=FALSE`). Freeciv treats that combination as hard-incompatible and
would select an ISO-hex tileset such as Hexemplio. CivJS currently preserves
the C2C3 topology packet while painting with the square Amplio2 strategy. Exact
C2C3 presentation therefore requires an ISO-hex provider; using Amplio2
exactly would require an explicit square-ISO gameplay deviation.

## Updating the pin

Review upstream changes first, then advance the submodule from the repository
root:

```bash
git submodule update --remote --merge reference/freeciv-web
git -C reference/freeciv-web log -1 --format='%H %cI %s'
```

Record the selected commit here, update any affected source line references,
and run the browser tests plus `npm run verify` before accepting the new pin.
For a fresh checkout, initialize both references with:

```bash
git clone --recurse-submodules git@github.com:michaelchu/civjs.git
# or, from an existing checkout:
git submodule update --init --recursive
```
