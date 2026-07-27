import { describe, expect, it } from 'vitest';
import { MapSnapshotAssembler } from '../MapSnapshotAssembler';
import { mapTileFromWire } from '../MapTileReducer';

describe('map snapshot boundaries', () => {
  it('maps wire visibility into the typed domain tile', () => {
    expect(mapTileFromWire({ x: 2, y: 3, terrain: 'plains', known: 1, owner: 'player-1' })).toEqual(
      expect.objectContaining({
        x: 2,
        y: 3,
        terrain: 'plains',
        known: true,
        visible: false,
        owner: 'player-1',
      })
    );
  });

  it('does not publish a partial chunked snapshot', () => {
    const assembler = new MapSnapshotAssembler();
    const map = assembler.begin({ xsize: 2, ysize: 1, wrap_id: 0 });

    expect(
      assembler.applyBatch(map, {
        tiles: [{ x: 0, y: 0, terrain: 'plains', known: 2 }],
        startIndex: 0,
        endIndex: 1,
        total: 2,
      })
    ).toBeNull();

    const complete = assembler.applyBatch(map, {
      tiles: [{ x: 1, y: 0, terrain: 'ocean', known: 2 }],
      startIndex: 1,
      endIndex: 2,
      total: 2,
    });
    expect(complete?.tiles).toEqual({
      '0,0': expect.objectContaining({ terrain: 'plains' }),
      '1,0': expect.objectContaining({ terrain: 'ocean' }),
    });
  });
});
