# Tileset Architecture

## Status

Accepted design direction. The initial provider boundary is implemented for
Amplio2; the normalized composition contract, package manifests, fallback
chain, and Civ III importer remain future work.

The implemented checkpoint includes provider identity, lifecycle, sprite
lookup, terrain-definition lookup, tile dimensions, renderer injection, and a
synthetic-provider test. Amplio2’s legacy terrain composition tables and
presentation offsets still need to move fully behind the provider before a Civ
III provider is introduced.

## Context

CivJS currently renders the C2C3 ruleset with an Amplio2-derived sprite
atlas and legacy-compatible JavaScript sprite tables. Amplio2 is the only
tileset that CivJS needs to support as a complete, built-in presentation set
for now.

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
    |-----------------------------|
    v                             v
Amplio2 provider          Civ III terrain provider
Freeciv tags/layers       PCX transitions/overlays
    |                             |
    v                             v
Normalized draw commands and sprites
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

  getGeometry(): MapGeometryStrategy;
  getSprite(tag: string): CanvasImageSource | null;
  hasSprite(tag: string): boolean;

  composeTerrain(context: TerrainCompositionContext): DrawCommand[];
  composeExtras(context: ExtraCompositionContext): DrawCommand[];
  composeCity(context: CityCompositionContext): DrawCommand[];
  composeUnit(context: UnitCompositionContext): DrawCommand[];
}
```

The exact interfaces may be split as implementation needs become clearer, but
format-specific globals and parsing must remain behind this boundary.

Map projection should be a separate strategy owned or selected by the
provider. The first implementation only needs an Amplio2-compatible isometric
strategy, while preserving a clean path for overhead projections.

## Amplio2 provider

`Amplio2TilesetProvider` will:

- Preserve current Amplio2 behavior and visual output.
- Encapsulate the existing configuration, sprite tables, sheets, dimensions,
  offsets, layer matching, and fallback tags.
- Replace direct renderer access to Amplio2 browser globals.
- Act as the complete fallback provider for partial custom tilesets.

Moving existing behavior behind the provider must be covered by visual and
sprite-selection regression tests before behavior is changed.

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

The client should discover validated manifests rather than hard-code asset
filenames. Selection may later be exposed as a user preference, but Amplio2
remains the default.

## Licensing and distribution

Original Civilization III artwork is proprietary, and community terrain mods
may have independent licensing terms. CivJS must not bundle converted
Civilization III assets without confirmed redistribution rights.

The importer should support user-supplied, legally obtained files. Generated
output should retain attribution and source metadata. A distributable
third-party package requires explicit permission or a compatible license from
its authors and must not silently depend on proprietary base-game files.

## Delivery sequence

1. Define the provider, manifest, geometry, and normalized draw-command types.
2. Move current Amplio2 loading and composition behind
   `Amplio2TilesetProvider` without visual changes.
3. Add a minimal synthetic provider in tests to prove that renderer behavior
   is not tied to Amplio2 filenames or browser globals.
4. Add manifest discovery, validation, fallback, and selection plumbing.
5. Prototype PCX decoding and one Civilization III base-terrain transition
   family.
6. Add coast and water transitions, followed by forests, hills, mountains,
   rivers, roads, and other overlays.
7. Add package tooling, diagnostics, visual fixtures, and licensing metadata.

## Acceptance criteria

The provider foundation is complete when:

- Amplio2 renders with no intentional visual regression.
- The renderer contains no hard-coded Amplio2 asset paths.
- Amplio2-specific matching data and offsets are provider-owned.
- A synthetic second provider can be selected in tests without changing
  renderer code.
- Missing assets follow a tested and visible fallback chain.

Civilization III terrain support is complete when:

- A supported user-supplied terrain package can be imported reproducibly.
- Base terrain, coastlines, and supported overlays select the correct graphics
  for every tested neighborhood.
- Partial mods fall back to Amplio2 as declared.
- Invalid or incomplete packages produce actionable diagnostics.
- No proprietary Civilization III assets are required in the CivJS
  repository or build.

## Consequences

This design adds a provider and manifest abstraction before a second production
tileset exists. In return, it prevents Amplio2 and Civilization III composition
rules from becoming intertwined, makes partial visual overrides practical, and
keeps future tileset formats possible without replacing the shared game-state
or rendering architecture.
