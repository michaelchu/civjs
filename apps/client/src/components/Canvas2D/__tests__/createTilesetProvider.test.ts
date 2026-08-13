import { describe, expect, it } from 'vitest';
import { TOPOLOGY_HEX, TOPOLOGY_ISO } from '../mapTopologyGeometry';
import { Amplio2TilesetProvider } from '../tilesets/Amplio2TilesetProvider';
import { createTilesetProvider } from '../tilesets/createTilesetProvider';
import { HexemplioTilesetProvider } from '../tilesets/HexemplioTilesetProvider';

describe('createTilesetProvider', () => {
  it('selects Hexemplio for the C2C3 ISO-hex topology', () => {
    expect(createTilesetProvider(TOPOLOGY_ISO | TOPOLOGY_HEX)).toBeInstanceOf(
      HexemplioTilesetProvider
    );
  });

  it('keeps Amplio2 for square-isometric reference fixtures', () => {
    expect(createTilesetProvider(TOPOLOGY_ISO)).toBeInstanceOf(Amplio2TilesetProvider);
  });
});
