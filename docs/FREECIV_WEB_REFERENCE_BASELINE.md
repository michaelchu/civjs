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
