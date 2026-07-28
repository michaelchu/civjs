export interface TilesetMetadata {
  id: string;
  name: string;
  format: 'freeciv-web' | 'civ3' | 'synthetic';
  projection: 'isometric' | 'overhead' | 'hex';
}

export interface TileSize {
  width: number;
  height: number;
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
  hasTerrainDefinition(graphic: string): boolean;
  getTileSize(): TileSize;
}
