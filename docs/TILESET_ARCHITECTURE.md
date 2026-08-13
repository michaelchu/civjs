# Tileset Architecture

## Status

Implemented for the two built-in Freeciv presentation paths. Provider identity,
lifecycle, topology compatibility, geometry, sprite lookup, terrain metadata,
native layer policy, presentation offsets, and runtime selection are active.
Square-isometric maps use Amplio2; C2C3's `ISO|HEX` topology `3` selects the
native Hexemplio provider.

Hexemplio is a reproducible package generated from pinned Freeciv revision
`eb8c7033aa6a70dfcd4aee828c3ac1ba33092afc`. Its manifest and exact source PNGs
are checked by `npm run check:hexemplio-tileset`, which is part of the root
verification gate. The remaining package-provenance limitation applies to the
older customized Amplio2 compatibility atlas, not the C2C3 runtime.

General manifest discovery, user-selectable fallback chains, and the Civ III
importer remain future work.

## Context

CivJS renders the C2C3 ruleset with Freeciv's Hexemplio assets and native
ISO-hex geometry. Amplio2 remains the complete built-in compatibility path for
square-isometric maps and the architectural fallback candidate for future
partial custom tilesets.

Future visual customization must not require replacing or forking the map
renderer. In particular, CivJS should be able to use terrain artwork from
corner-based Civilization III terrain mods, such as Sn00py-style terrain,
without making Civ III file conventions part of the core renderer.

Freeciv and Civilization III both compose terrain from neighboring tile
relationships, but they encode and package those relationships differently:

- Amplio2 uses Freeciv tilespec layers, sprite tags, matching rules, and
  generated atlases.
- Civilization III terrain mods use indexed PCX sheets whose entries represent
  combinations around terrain corners, plus separate sheets for overlays such
  as forests, rivers, roads, hills, and mountains.

The renderer therefore needs a stable presentation contract with
format-specific providers behind it.

## Sn00py Conquests package findings

The inspected Sn00py Terrain Graphics Modpack v4.5 “greener water” package for
Civilization III: Conquests confirms the provider design. It is a
presentation-only package: its README says that it changes graphics without
changing game rules.

The package contains 35 terrain PCX files, five city-style PCX files, resource
graphics, and a compressed Civ III scenario descriptor. Its image families
have stable but different layouts:

| Family                  | Source dimensions |
| ----------------------- | ----------------- |
| Land/water transitions  | 1152×576          |
| Forests and marsh       | 1000×884          |
| Hills                   | 512×288           |
| Mountains and volcanoes | 512×352           |
| Rivers and irrigation   | 512×256           |
| Polar ice               | 1024×256          |
| Cities                  | 501×380           |
| Resources               | 300×300           |

The transition sheets use a 128×64 isometric grid. This has the same 2:1
geometry as Amplio2’s 96×48 grid, so an importer may normalize Sn00py terrain
to Amplio2 dimensions without changing map topology.

The PCX files use indexed palettes. Palette entries 254 and 255 carry
background, transparency, or shadow conventions, but their RGB values and
ordering are not consistent across every file family. The importer must decode
palette-index semantics by supported file family; it must not treat a specific
RGB color such as magenta as a universal transparency rule.

The package supplies the principal ground-transition families plus hills,
mountains, forests, marshes, floodplains, irrigation, some river overlays,
volcanoes, ice, cities, and resources. Like a normal Civ III scenario graphics
package, it omits some presentation layers that the original installation
would provide, such as roads, railroads, and other terrain improvements. CivJS
does not require those proprietary base-game files: missing feature layers
will use the declared Amplio2 fallback.

Fallback must occur per presentation layer. A Sn00py ground tile may be
combined with an Amplio2 road, unit, city, or other unsupported overlay.
Individual missing Sn00py ground transitions must not silently switch to
Amplio2 ground graphics because mixing transition systems within one terrain
surface would create visible seams.

## Decision

CivJS will support multiple tileset formats through provider interfaces.
Amplio2 will remain the default and complete built-in provider. Civilization
III terrain support will be introduced as a separate provider and import
pipeline.

The shared map renderer will operate on normalized sprite and terrain
composition results. It will not parse Freeciv tilespec files, PCX files, or
format-specific adjacency codes directly.

```text
Map state
    |
    v
Shared map renderer
    |
    v
Tileset provider contract
    |-----------------------------|-----------------------------|
    v                             v                             v
Amplio2 provider          Hexemplio provider            Civ III provider
freeciv-web package       Freeciv tilespec package      PCX transitions
    |                             |                             |
    v                             v                             v
Normalized geometry, composition metadata, and sprites
```

## Provider responsibilities

A tileset provider owns:

- Tileset identity, metadata, capabilities, and supported map geometry.
- Sprite-sheet loading and sprite lookup.
- Tile dimensions and presentation offsets.
- Terrain adjacency and layer composition.
- Roads, rivers, resources, improvements, and other map overlays supported by
  the format.
- Unit, city, flag, activity, and interface sprites when supplied.
- Validation of required assets and actionable diagnostics for missing or
  malformed content.
- Provider-specific cleanup and cache lifetime.

The shared renderer owns:

- The authoritative game-state snapshot and visibility rules.
- Viewport culling and camera behavior.
- Global painter order.
- Dispatching normalized draw commands.
- Player colors and server-resolved public presentation.
- Input, selection, paths, and action feedback.

Game rules remain independent of the selected tileset. A tileset changes
presentation only.

## Common contract

The implementation should expose a typed contract equivalent to:

```ts
interface TilesetProvider {
  readonly metadata: TilesetMetadata;

  load(): Promise<void>;
  dispose(): void;

  getGeometry(): TilesetGeometry;
  getTopologyCompatibility(topologyId: number): TilesetTopologyCompatibility;
  getSprite(tag: string): HTMLCanvasElement | null;
  hasSprite(tag: string): boolean;
  hasTerrainDefinition(graphic: string): boolean;
  getTerrainComposition(): TerrainCompositionProfile | null;
  getPresentationOffsets(): TilesetPresentationOffsets;
  getRenderProfile?(): TilesetRenderProfile | null;
}
```

The exact interfaces may be split as implementation needs become clearer, but
format-specific globals and parsing must remain behind this boundary.

Map projection remains shared code selected by provider/topology metadata.
The implemented strategies preserve freeciv-web's square-ISO compatibility
path and Freeciv's native/logical ISO-hex path. Overhead projections remain a
future extension.

## Amplio2 provider

`Amplio2TilesetProvider`:

- Preserve current Amplio2 behavior and visual output.
- Encapsulate the existing configuration, sprite tables, sheets, dimensions,
  offsets, layer matching, and fallback tags.
- Replaces direct renderer access to Amplio2 browser globals.
- Is the intended complete fallback provider for future partial custom
  tilesets.

Visual and sprite-selection regression tests protect that compatibility path.

## Hexemplio provider

`HexemplioTilesetProvider` is selected whenever `MAP_INFO.topology_id` is
exactly `ISO|HEX` (`3`). It:

- Loads a schema-2 manifest generated from the pinned Freeciv submodule.
- Uses Hexemplio's `126x64` tile, `126x96` full-sprite, and 16-pixel hex-side
  geometry.
- Supplies native terrain composition, extra-style, presentation-offset,
  layer-order, darkness, and Auto-fog metadata.
- Preloads declared sprite sheets and lazily loads standalone flags/buildings,
  requesting a redraw when one becomes available.
- Never silently falls back to Amplio2, because Freeciv classifies that
  topology mismatch as hard-incompatible.

The package generator copies the exact referenced PNGs and `COPYING`, records
the source revision/spec list, and is reproducibility-checked during `verify`.

## Civilization III terrain provider

`Civ3TilesetProvider` will consume normalized output from a separate importer.
The importer will:

1. Read indexed PCX files without losing palette-index, transparency, or shadow
   semantics.
2. Identify supported Civilization III terrain and overlay sheet families.
3. Slice sprites according to each known sheet layout.
4. Translate Civilization III corner-transition identifiers into normalized
   terrain composition metadata.
5. Optionally normalize the native 128×64 geometry to Amplio2’s 96×48 geometry.
6. Emit browser-ready images and a validated manifest.
7. Catalogue coverage by layer so fallback is deterministic.
8. Report missing files that the original mod expected to inherit from a base
   Civilization III installation.

The provider will select terrain transitions from the local tile neighborhood
and emit ordinary draw commands. Civilization III adjacency rules must not be
added as conditionals throughout `TerrainRenderer`.

Initial support should be limited to the isometric square topology used by
Amplio2 and Civilization III. Other Freeciv topologies remain separate future
work.

## Composition and fallback

Tilesets may inherit from another provider. The initial fallback chain is:

```text
Selected Civ III layer
    -> same layer from Amplio2 when explicitly allowed
    -> diagnostic placeholder
```

This allows a terrain-only mod to replace land, water, and overlays while
Amplio2 continues to provide units, cities, flags, interface sprites, or any
terrain asset the package omits.

Fallback must be explicit in the tileset manifest and observable through
validation output. Silent asset substitution should not hide malformed
packages during development. Required ground-transition coverage is validated
as a unit; it cannot fall back one transition at a time.

Sprite identifiers exposed by rulesets continue to use CivJS/Freeciv
presentation tags. Providers are responsible for mapping their source format
to those normalized concepts.

## Packaging and discovery

Each installed tileset should have a manifest containing at least:

- Stable ID, display name, version, and author.
- Provider type and format version.
- Parent/fallback tileset.
- Supported topology and projection.
- Tile dimensions and provider-specific asset entry points.
- Attribution, license, and source information.

The built-in providers use validated manifests/configuration and topology-based
selection. General package discovery and a user preference may be added later;
C2C3 topology `3` must not allow selection of a hard-incompatible square-ISO
tileset.

## Licensing and distribution

Original Civilization III artwork is proprietary, and community terrain mods
may have independent licensing terms. CivJS must not bundle converted
Civilization III assets without confirmed redistribution rights.

The importer should support user-supplied, legally obtained files. Generated
output should retain attribution and source metadata. A distributable
third-party package requires explicit permission or a compatible license from
its authors and must not silently depend on proprietary base-game files.

## Delivery sequence

Completed:

1. Define provider, topology, geometry, composition, render-profile, and offset
   contracts.
2. Move Amplio2 loading behind `Amplio2TilesetProvider` and protect it with a
   synthetic provider plus visual regressions.
3. Add topology-compatible runtime selection and the generated Hexemplio
   package/provider.
4. Port native projection, terrain/extras, layer/fog, unit/city, border, and
   minimap behavior with source-mapped tests.

Remaining for custom packages:

1. Add general manifest discovery, validation, fallback, and selection UI.
2. Prototype PCX decoding and one Civilization III base-terrain transition
   family.
3. Add coast and water transitions, followed by forests, hills, mountains,
   rivers, roads, and other overlays.
4. Add importer diagnostics, visual fixtures, and licensing metadata.

## Acceptance criteria

The built-in provider foundation now satisfies:

- Amplio2 renders with no intentional visual regression.
- The renderer contains no hard-coded Amplio2 asset paths.
- Amplio2-specific matching data and offsets are provider-owned.
- A synthetic second provider can be selected in tests without changing
  renderer code.
- Provider topology capabilities are validated against `MAP_INFO`; a hard
  mismatch cannot silently render through the square-isometric strategy.
- The built-in Hexemplio manifest records and reproducibly generates its spec
  list, sprites, offsets, policy, assets, license, and exact Freeciv revision.

Explicit cross-provider missing-asset fallback and reproducible Amplio2 package
provenance remain future acceptance items for user-selectable custom tilesets.

C2C3 map presentation now has:

- A provider compatible with `ISO|HEX` topology `3` is selected.
- Projection, culling, pointer inversion, wrapping, painter order, and minimap
  geometry are exercised through that provider.
- Source-mapped terrain, city, unit, border, fog, path, and wrapped-copy command
  coverage using exact provider assets.
- Native CivJS map/minimap visual baselines, an independent byte-exact minimap
  raster oracle, and an end-to-end click/camera/outline test.

An independent native-Freeciv world/entity pixel capture, including a wrapped
seam, remains required before claiming complete cross-client pixel equality.

Civilization III terrain support is complete when:

- A supported user-supplied terrain package can be imported reproducibly.
- Base terrain, coastlines, and supported overlays select the correct graphics
  for every tested neighborhood.
- Partial mods fall back to Amplio2 as declared.
- Invalid or incomplete packages produce actionable diagnostics.
- No proprietary Civilization III assets are required in the CivJS
  repository or build.

## Consequences

The provider/manifest abstraction now supports two production Freeciv paths and
prevents square-ISO Amplio2 logic from leaking into C2C3's native ISO-hex
pipeline. It also keeps future Civ III/custom formats possible without
replacing the shared game-state or rendering architecture.
