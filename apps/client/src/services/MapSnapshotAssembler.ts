/**
 * @module client/services/MapSnapshotAssembler
 * Provides the client-side Map Snapshot Assembler service.
 */
import type { GameState, Tile } from '../types';
import { mapTileFromWire, type MapTileWireData } from './MapTileReducer';

type GameMap = GameState['map'];

export interface MapInfoWireData {
  xsize: number;
  ysize: number;
  topology_id?: number;
  wrap_id?: number;
}

export interface MapTileBatchWireData {
  tiles: MapTileWireData[];
  startIndex?: number;
  endIndex?: number;
  total?: number;
  fullSnapshot?: boolean;
}

/**
 * Stages chunked tile packets and exposes a new immutable map only when the
 * complete snapshot is available.
 */
export class MapSnapshotAssembler {
  private pendingTiles: Record<string, Tile> | null = null;
  private pendingOverrides: Record<string, Tile> | null = null;

  begin(data: MapInfoWireData): GameMap {
    this.pendingTiles = {};
    this.pendingOverrides = {};
    return {
      width: data.xsize,
      height: data.ysize,
      xsize: data.xsize,
      ysize: data.ysize,
      topology_id: data.topology_id ?? 0,
      wrap_id: data.wrap_id ?? 0,
      tiles: {},
    };
  }

  applyTile(map: GameMap, data: MapTileWireData): GameMap {
    return {
      ...map,
      tiles: {
        ...map.tiles,
        [`${data.x},${data.y}`]: mapTileFromWire(data),
      },
    };
  }

  applyBatch(map: GameMap, data: MapTileBatchWireData): GameMap | null {
    if (data.fullSnapshot === false) {
      if (this.pendingOverrides) {
        for (const tile of data.tiles) {
          this.pendingOverrides[`${tile.x},${tile.y}`] = mapTileFromWire(tile);
        }
      }
      return data.tiles.reduce((nextMap, tile) => this.applyTile(nextMap, tile), map);
    }

    if (data.startIndex === 0 || !this.pendingTiles) {
      this.pendingTiles = {};
    }

    for (const tile of data.tiles) {
      this.pendingTiles[`${tile.x},${tile.y}`] = mapTileFromWire(tile);
    }

    const complete =
      typeof data.total !== 'number' ||
      typeof data.endIndex !== 'number' ||
      data.endIndex >= data.total;
    if (!complete) return null;

    const tiles = { ...this.pendingTiles, ...this.pendingOverrides };
    this.pendingTiles = null;
    this.pendingOverrides = null;
    return { ...map, tiles };
  }

  cancel(): void {
    this.pendingTiles = null;
    this.pendingOverrides = null;
  }
}
