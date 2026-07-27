import { describe, expect, it, vi } from 'vitest';
import { TilesetLoader } from '../TilesetLoader';

describe('TilesetLoader lifecycle', () => {
  it('stops an in-flight tileset load after cleanup', async () => {
    let finishConfig!: () => void;
    const loader = new TilesetLoader();
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

    const loading = loader.loadTileset();
    loader.cleanup();
    finishConfig();

    await expect(loading).rejects.toThrow('Tileset load cancelled');
    expect(loadSpec).not.toHaveBeenCalled();
  });
});
