import { afterEach, describe, expect, it, vi } from 'vitest';
import { Amplio2TilesetProvider } from '../tilesets/Amplio2TilesetProvider';

const manifest = {
  schemaVersion: 1,
  id: 'amplio2',
  name: 'Amplio2',
  sourceWebRevision: 'web-revision',
  sourceFreecivRevision: 'freeciv-revision',
  topologyId: 1,
  geometry: {
    tileWidth: 96,
    tileHeight: 48,
    fullTileWidth: 96,
    fullTileHeight: 48,
    hexWidth: 0,
    hexHeight: 0,
  },
  offsets: {
    unitFlagX: 25,
    unitFlagY: -16,
    cityFlagX: 2,
    cityFlagY: -9,
    unitX: 19,
    unitY: -14,
    activityX: 55,
    activityY: -25,
    selectX: 0,
    selectY: 0,
    stackX: 0,
    stackY: -31,
    cityX: 0,
    cityY: -14,
    citybarX: 45,
    citybarY: 55,
    tileLabelX: 0,
    tileLabelY: 15,
  },
  terrainComposition: {
    mode: 'legacy-cellgroup',
    matchTypes: [['land']],
    terrains: {
      plains: {
        numLayers: 1,
        blendLayer: 1,
        layers: [
          {
            matchStyle: 0,
            spriteType: 0,
            matchIndices: 1,
            matchIndex: [0],
            dither: true,
            matchType: 'land',
            matchWith: [],
          },
        ],
      },
    },
    cellgroupMap: {},
  },
  renderProfile: {
    fogStyle: 'auto',
    darknessStyle: 'none',
    layerOrder: ['Terrain1', 'Unit', 'Fog', 'CityBar', 'Goto'],
  },
  preloadImages: ['images/sheet.png'],
  sprites: {
    'u.warriors_Idle': {
      image: 'images/sheet.png',
      x: 4,
      y: 6,
      width: 16,
      height: 18,
    },
  },
};

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_source: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('Amplio2TilesetProvider manifest lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const installLoadMocks = () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => manifest }));
    vi.stubGlobal('Image', MockImage);
  };

  /**
   * @evidence parity
   * @reference reference/freeciv-web/scripts/freeciv-img-extract/img-extract.py:155-173,280-350
   * @assertion The provider crops a generated rectangle from the exact manifest
   * image and accepts the ruleset's bare unit tag through the extractor's Idle suffix.
   */
  it('loads one revisioned manifest and resolves generated Idle unit tags', async () => {
    installLoadMocks();
    const drawImage = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
    } as unknown as HTMLElement);
    const loader = new Amplio2TilesetProvider();

    await loader.load();

    expect(loader.isReady()).toBe(true);
    expect(loader.getGeometry()).toEqual(manifest.geometry);
    expect(loader.hasTerrainDefinition('plains')).toBe(true);
    expect(loader.getPresentationOffsets()).toEqual(manifest.offsets);
    expect(loader.getSprite('u.warriors')).not.toBeNull();
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 4, 6, 16, 18, 0, 0, 16, 18);
  });

  it('stops an in-flight manifest load after cleanup', async () => {
    let finishManifest!: (value: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => new Promise(resolve => (finishManifest = resolve)),
      })
    );
    vi.stubGlobal('Image', MockImage);
    const loader = new Amplio2TilesetProvider();

    const loading = loader.load();
    await Promise.resolve();
    loader.dispose();
    finishManifest(manifest);

    await expect(loading).rejects.toThrow('Tileset load cancelled');
    expect(loader.isReady()).toBe(false);
  });

  it('rejects a manifest for a different topology', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...manifest, topologyId: 3 }) })
    );
    const loader = new Amplio2TilesetProvider();

    await expect(loader.load()).rejects.toThrow('Unsupported Amplio2 manifest');
  });
});
