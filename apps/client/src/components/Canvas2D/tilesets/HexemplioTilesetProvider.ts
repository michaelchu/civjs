/**
 * @module client/components/Canvas2D/tilesets/HexemplioTilesetProvider
 * Loads the topology-exact ISO-hex package generated from Freeciv Hexemplio.
 * Every sprite comes from the exact files declared by Hexemplio's tilespec.
 * Large standalone flags/buildings are fetched lazily and trigger one redraw.
 *
 * @reference reference/freeciv/data/hexemplio.tilespec
 */
import {
  getTilesetTopologyCompatibility,
  type TerrainCompositionProfile,
  type TilesetGeometry,
  type TilesetMetadata,
  type TilesetPresentationOffsets,
  type TilesetProvider,
  type TilesetRenderProfile,
} from './TilesetProvider';

interface HexemplioSpriteRectangle {
  image: string;
  x: number;
  y: number;
  width: number;
  height: number;
  standalone?: boolean;
}

interface HexemplioManifest {
  schemaVersion: number;
  id: string;
  name: string;
  sourceRevision: string;
  topologyId: number;
  geometry: TilesetGeometry;
  offsets: TilesetPresentationOffsets;
  terrainComposition: TerrainCompositionProfile;
  renderProfile: TilesetRenderProfile;
  preloadImages: string[];
  sprites: Record<string, HexemplioSpriteRectangle>;
}

export class HexemplioTilesetProvider implements TilesetProvider {
  readonly metadata: TilesetMetadata = {
    id: 'hexemplio',
    name: 'Hexemplio',
    format: 'freeciv',
    projection: 'hex',
    topologyId: 3,
  };

  private manifest: HexemplioManifest | null = null;
  private images = new Map<string, HTMLImageElement>();
  private sprites = new Map<string, HTMLCanvasElement>();
  private pendingImages = new Map<string, Promise<void>>();
  private spriteReadyListener: (() => void) | null = null;
  private loadGeneration = 0;

  async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const response = await fetch('/tilesets/hexemplio/manifest.json');
    if (!response.ok) throw new Error(`Failed to load Hexemplio manifest (${response.status})`);
    const manifest = (await response.json()) as HexemplioManifest;
    if (manifest.schemaVersion !== 2 || manifest.topologyId !== this.metadata.topologyId) {
      throw new Error('Unsupported Hexemplio manifest');
    }

    await Promise.all(
      manifest.preloadImages.map(async source => {
        const image = await this.loadImage(`/tilesets/hexemplio/${source}`);
        if (generation === this.loadGeneration) this.images.set(source, image);
      })
    );
    if (generation !== this.loadGeneration) throw new Error('Tileset load cancelled');
    this.manifest = manifest;
  }

  private loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load Hexemplio image ${source}`));
      image.src = source;
    });
  }

  private getCandidates(tag: string): string[] {
    const candidates = tag.endsWith(':0') ? [tag, tag.slice(0, -2)] : [tag, `${tag}:0`];
    if (tag.startsWith('u.') && !tag.includes('_Idle')) {
      const bare = tag.endsWith(':0') ? tag.slice(0, -2) : tag;
      candidates.push(`${bare}_Idle:0`);
    }
    return [...new Set(candidates)];
  }

  private requestStandaloneImage(source: string): void {
    if (this.images.has(source) || this.pendingImages.has(source)) return;
    const generation = this.loadGeneration;
    const pending = this.loadImage(`/tilesets/hexemplio/${source}`)
      .then(image => {
        if (generation !== this.loadGeneration) return;
        this.images.set(source, image);
        this.spriteReadyListener?.();
      })
      .catch(error => console.error(error))
      .finally(() => this.pendingImages.delete(source));
    this.pendingImages.set(source, pending);
  }

  getSprite(tag: string): HTMLCanvasElement | null {
    const candidates = this.getCandidates(tag);
    for (const candidate of candidates) {
      const cached = this.sprites.get(candidate);
      if (cached) return cached;
      const rectangle = this.manifest?.sprites[candidate];
      if (!rectangle) continue;
      const image = this.images.get(rectangle.image);
      if (!image) {
        if (rectangle.standalone) this.requestStandaloneImage(rectangle.image);
        continue;
      }

      const canvas = document.createElement('canvas');
      canvas.width = rectangle.width;
      canvas.height = rectangle.height;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(
        image,
        rectangle.x,
        rectangle.y,
        rectangle.width,
        rectangle.height,
        0,
        0,
        rectangle.width,
        rectangle.height
      );
      this.sprites.set(candidate, canvas);
      return canvas;
    }

    return null;
  }

  hasSprite(tag: string): boolean {
    return this.getCandidates(tag).some(candidate => Boolean(this.manifest?.sprites[candidate]));
  }

  hasNativeSprite(tag: string): boolean {
    return this.hasSprite(tag);
  }

  hasTerrainDefinition(graphic: string): boolean {
    return Boolean(this.manifest?.terrainComposition.terrains[graphic]);
  }

  getTileSize(): { width: number; height: number } {
    const geometry = this.getGeometry();
    return { width: geometry.tileWidth, height: geometry.tileHeight };
  }

  getGeometry(): TilesetGeometry {
    return (
      this.manifest?.geometry ?? {
        tileWidth: 126,
        tileHeight: 64,
        fullTileWidth: 126,
        fullTileHeight: 96,
        hexWidth: 16,
        hexHeight: 0,
      }
    );
  }

  getTopologyCompatibility(topologyId: number) {
    return getTilesetTopologyCompatibility(topologyId, this.metadata.topologyId);
  }

  getTerrainComposition(): TerrainCompositionProfile | null {
    return this.manifest?.terrainComposition ?? null;
  }

  getPresentationOffsets(): TilesetPresentationOffsets {
    return (
      this.manifest?.offsets ?? {
        unitFlagX: 45,
        unitFlagY: 39,
        cityFlagX: 41,
        cityFlagY: 10,
        unitX: 34,
        unitY: 38,
        activityX: 74,
        activityY: 28,
        selectX: 0,
        selectY: 21,
        stackX: 32,
        stackY: 25,
        cityX: 17,
        cityY: 21,
        citybarY: 40,
        tileLabelY: 20,
      }
    );
  }

  getRenderProfile(): TilesetRenderProfile | null {
    return this.manifest?.renderProfile ?? null;
  }

  setSpriteReadyListener(listener: (() => void) | null): void {
    this.spriteReadyListener = listener;
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.spriteReadyListener = null;
    this.manifest = null;
    this.images.clear();
    this.sprites.clear();
    this.pendingImages.clear();
  }
}
