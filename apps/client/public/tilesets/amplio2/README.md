# Amplio2 browser package

This directory is the exact square-isometric (`topology_id = 1`) Amplio2
package used by CivJS. It is generated from the Freeciv revision pinned by the
`reference/freeciv-web` submodule, not from the newer gameplay-reference
revision in `reference/freeciv`.

`manifest.json` records both revisions, the freeciv-web extractor/config/patch
hashes, every generated sprite rectangle, atlas dimensions, and artifact
hashes. `npm run check:amplio2-tileset` validates the package without Python,
Pillow, network access, or regenerating PNGs.

To regenerate after updating `reference/freeciv-web`:

1. Read `FCREV` from `reference/freeciv-web/freeciv/version.txt` and make that
   commit available in `reference/freeciv`.
2. Export that commit to a temporary directory and apply
   `reference/freeciv-web/freeciv/patches/RevertAmplio2ExtraUnits.patch`.
3. Run `reference/freeciv-web/scripts/freeciv-img-extract/img-extract.py -f
<patched-freeciv> -o <extractor-output>` with Python 3 and Pillow.
4. Run `npm run generate:amplio2-tileset --
--generated-dir=<extractor-output>`.
5. Run `npm run check:amplio2-tileset` and the square-ISO browser pixel suite.

The source art and extractor are GPL-2.0-or-later. `COPYING` is included with
the generated package.
