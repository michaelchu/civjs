import { describe, expect, it, vi } from 'vitest';
import { Amplio2TilesetProvider } from '../tilesets/Amplio2TilesetProvider';

describe('Amplio2TilesetProvider lifecycle', () => {
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
});
