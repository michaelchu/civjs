import { afterEach, describe, expect, it, vi } from 'vitest';
import { Amplio2TilesetProvider } from '../tilesets/Amplio2TilesetProvider';

describe('Amplio2TilesetProvider lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts bare and explicit frame-zero sprite tags', () => {
    const loader = new Amplio2TilesetProvider();
    const sprite = {} as HTMLCanvasElement;

    Object.assign(loader as unknown as Record<string, unknown>, {
      sprites: { 'unit.warriors': sprite },
    });

    expect(loader.getSprite('unit.warriors')).toBe(sprite);
    expect(loader.getSprite('unit.warriors:0')).toBe(sprite);
  });

  it('stops an in-flight tileset load after cleanup', async () => {
    let finishConfig!: () => void;
    const loader = new Amplio2TilesetProvider();
    const loadSpec = vi.fn();

    Object.assign(loader as unknown as Record<string, unknown>, {
      loadConfig: vi.fn(
        () =>
          new Promise<void>(resolve => {
            finishConfig = resolve;
          })
      ),
      loadSpec,
      loadSpriteSheets: vi.fn(),
      cacheSprites: vi.fn(),
    });

    const loading = loader.load();
    loader.dispose();
    finishConfig();

    await expect(loading).rejects.toThrow('Tileset load cancelled');
    expect(loadSpec).not.toHaveBeenCalled();
  });

  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview.js:174-205
   * @assertion Rebuilding the cached sprite table removes tags from an older
   * spec instead of returning stale canvases after a tileset reload.
   */
  it('clears stale cached sprites when a new spec is loaded', () => {
    const loader = new Amplio2TilesetProvider();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);

    const cacheSprites = (loader as unknown as { cacheSprites: () => void }).cacheSprites.bind(
      loader
    );
    const spriteSheet = {} as HTMLImageElement;

    Object.assign(loader as unknown as Record<string, unknown>, {
      spec: {
        'unit.old': [0, 0, 16, 16, 0],
      },
      spriteSheets: [spriteSheet],
    });
    cacheSprites();
    expect(loader.hasSprite('unit.old')).toBe(true);
    expect(drawImage).toHaveBeenCalledWith(spriteSheet, 0, 0, 16, 16, 0, 0, 16, 16);

    Object.assign(loader as unknown as Record<string, unknown>, {
      spec: {
        'unit.new': [16, 0, 16, 16, 0],
      },
    });
    cacheSprites();

    expect(loader.hasSprite('unit.old')).toBe(false);
    expect(loader.hasSprite('unit.new')).toBe(true);
  });
});
