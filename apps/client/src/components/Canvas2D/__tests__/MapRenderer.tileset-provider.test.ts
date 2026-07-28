import { afterEach, describe, expect, it, vi } from 'vitest';
import { rulesetService } from '../../../services/RulesetService';
import { MapRenderer } from '../MapRenderer';
import type { TilesetProvider } from '../tilesets/TilesetProvider';

function createContext() {
  return {
    canvas: { width: 800, height: 600 },
    imageSmoothingEnabled: false,
  } as unknown as CanvasRenderingContext2D;
}

function createSyntheticProvider(): TilesetProvider {
  return {
    metadata: {
      id: 'synthetic',
      name: 'Synthetic test tileset',
      format: 'synthetic',
      projection: 'isometric',
    },
    load: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    getSprite: vi.fn().mockReturnValue(null),
    hasSprite: vi.fn().mockReturnValue(false),
    hasTerrainDefinition: vi.fn().mockImplementation(graphic => graphic === 'plains'),
    getTileSize: vi.fn().mockReturnValue({ width: 128, height: 64 }),
  };
}

describe('MapRenderer tileset provider boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes an injected provider without assuming Amplio2 paths or dimensions', async () => {
    const provider = createSyntheticProvider();
    vi.spyOn(rulesetService, 'loadPresentationRuleset').mockResolvedValue({
      nation_styles: {},
      city_styles: {},
      music_styles: {},
      terrains: {
        plains: { graphic: 'plains', graphic_alt: 'grassland' },
      },
      units: {},
      extras: {},
    });
    vi.spyOn(rulesetService, 'getNationStyles').mockResolvedValue({});

    const renderer = new MapRenderer(createContext(), provider);
    await renderer.initialize();

    expect(provider.load).toHaveBeenCalledOnce();
    expect(provider.hasTerrainDefinition).toHaveBeenCalledWith('plains');
    expect(provider.getTileSize).toHaveBeenCalledOnce();
    expect(
      (
        renderer as unknown as {
          terrainRenderer: { tileWidth: number; tileHeight: number };
        }
      ).terrainRenderer
    ).toMatchObject({ tileWidth: 128, tileHeight: 64 });

    renderer.cleanup();
    expect(provider.dispose).toHaveBeenCalledOnce();
  });
});
