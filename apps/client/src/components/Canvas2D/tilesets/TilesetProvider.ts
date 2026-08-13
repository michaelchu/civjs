/**
 * @module client/components/Canvas2D/tilesets/TilesetProvider
 * Defines the Tileset Provider tileset integration.
 */
export interface TilesetMetadata {
  id: string;
  name: string;
  format: 'freeciv' | 'freeciv-web' | 'civ3' | 'synthetic';
  projection: 'isometric' | 'overhead' | 'hex';
  /** Freeciv topology bits represented by this package. */
  topologyId: number;
}

export interface TileSize {
  width: number;
  height: number;
}

export type TilesetTopologyCompatibility = 'exact' | 'soft' | 'hard';

export interface TilesetGeometry {
  tileWidth: number;
  tileHeight: number;
  /** Full isometric sprite canvas used by unit/city/overlay origins. */
  fullTileWidth: number;
  fullTileHeight: number;
  /** Non-zero for an ISO-hex tileset such as Hexemplio. */
  hexWidth: number;
  /** Non-zero for an overhead-hex tileset. */
  hexHeight: number;
}

export interface TilesetRenderProfile {
  fogStyle: 'auto' | 'sprite' | 'none';
  darknessStyle: 'cardinal-single' | 'none';
  layerOrder: string[];
}

export interface TerrainLayerComposition {
  matchStyle: number;
  spriteType: number;
  /** Number of entries in `matchIndex`, matching Freeciv's `match_indices`. */
  matchIndices: number;
  matchIndex: number[];
  dither: boolean;
  isTall?: boolean;
  offsetX?: number;
  offsetY?: number;
}

export interface TerrainCompositionDefinition {
  numLayers: number;
  blendLayer: number;
  layers: Array<
    | (TerrainLayerComposition & {
        matchType: string;
        matchWith: string[];
      })
    | null
  >;
}

export interface TerrainCompositionProfile {
  mode: 'legacy-cellgroup' | 'direct-cells';
  matchTypes: string[][];
  terrains: Record<string, TerrainCompositionDefinition>;
  /** Freeciv [extras].styles lookup keyed by the ruleset graphic tag. */
  extraStyles?: Record<string, string>;
  cellgroupMap?: Record<string, string>;
}

export interface TilesetPresentationOffsets {
  unitFlagX: number;
  unitFlagY: number;
  cityFlagX: number;
  cityFlagY: number;
  unitX: number;
  unitY: number;
  activityX: number;
  activityY: number;
  selectX: number;
  selectY: number;
  stackX: number;
  stackY: number;
  cityX: number;
  cityY: number;
  citybarX: number;
  citybarY: number;
  tileLabelX: number;
  tileLabelY: number;
}

/**
 * Presentation-only boundary between the map renderer and a packaged tileset.
 *
 * Providers own asset discovery, loading, sprite lookup, geometry metadata,
 * and format-specific terrain metadata. They never own game state.
 */
export interface TilesetProvider {
  readonly metadata: TilesetMetadata;

  load(): Promise<void>;
  dispose(): void;

  getSprite(tag: string): HTMLCanvasElement | null;
  hasSprite(tag: string): boolean;
  /** True only when this package, rather than a shared fallback, owns the tag. */
  hasNativeSprite?(tag: string): boolean;
  hasTerrainDefinition(graphic: string): boolean;
  getTileSize(): TileSize;
  getGeometry(): TilesetGeometry;
  getTopologyCompatibility(topologyId: number): TilesetTopologyCompatibility;
  getTerrainComposition(): TerrainCompositionProfile | null;
  getPresentationOffsets(): TilesetPresentationOffsets;
  /** Native Freeciv layer/fog policy when the package carries one. */
  getRenderProfile?(): TilesetRenderProfile | null;
  /** Called after a lazily requested standalone sprite becomes drawable. */
  setSpriteReadyListener?(listener: (() => void) | null): void;
}

/** Port of Freeciv tileset_map_topo_compatible(). */
export const getTilesetTopologyCompatibility = (
  mapTopologyId: number,
  tilesetTopologyId: number
): TilesetTopologyCompatibility => {
  const HEX = 1 << 1;
  const ISO = 1 << 0;
  if ((tilesetTopologyId & HEX) !== 0) {
    return (mapTopologyId & (HEX | ISO)) === tilesetTopologyId ? 'exact' : 'hard';
  }
  if ((mapTopologyId & HEX) !== 0) return 'hard';
  return (mapTopologyId & ISO) === (tilesetTopologyId & ISO) ? 'exact' : 'soft';
};
