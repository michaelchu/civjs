/**
 * @module client/components/Canvas2D/tilesets/createTilesetProvider
 * Selects a topology-compatible packaged tileset for the board renderer.
 */
import { TOPOLOGY_HEX, TOPOLOGY_ISO } from '../mapTopologyGeometry';
import { Amplio2TilesetProvider } from './Amplio2TilesetProvider';
import { HexemplioTilesetProvider } from './HexemplioTilesetProvider';
import type { TilesetProvider } from './TilesetProvider';

export const createTilesetProvider = (topologyId: number): TilesetProvider =>
  (topologyId & (TOPOLOGY_ISO | TOPOLOGY_HEX)) === (TOPOLOGY_ISO | TOPOLOGY_HEX)
    ? new HexemplioTilesetProvider()
    : new Amplio2TilesetProvider();
