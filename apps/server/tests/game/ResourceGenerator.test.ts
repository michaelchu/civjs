import { ResourceGenerator } from '@game/map/ResourceGenerator';
import type { MapTile } from '@game/map/MapTypes';

function tile(terrain: MapTile['terrain']): MapTile {
  return {
    x: 0,
    y: 0,
    terrain,
    riverMask: 0,
    elevation: 0,
    continentId: terrain === 'ocean' || terrain === 'deep_ocean' ? 0 : 1,
    isExplored: false,
    isVisible: false,
    hasRoad: false,
    hasRailroad: false,
    improvements: [],
    unitIds: [],
    properties: {},
    temperature: 4,
    wetness: 50,
  };
}

describe('ResourceGenerator classic resources', () => {
  it('uses classic terrain resource lists, including coastal water', async () => {
    const tiles = [[tile('ocean')], [tile('grassland')], [tile('deep_ocean')]];
    const generator = new ResourceGenerator(3, 1, () => 0);

    await generator.generateResources(tiles);

    expect(tiles[0][0].resource).toBe('fish');
    expect(tiles[1][0].resource).toBe('resources');
    expect(tiles[2][0].resource).toBeUndefined();
  });

  it('uses the classic 250-per-thousand richness threshold', async () => {
    const generated = [[tile('plains')]];
    const omitted = [[tile('plains')]];

    await new ResourceGenerator(1, 1, () => 0.25).generateResources(generated);
    await new ResourceGenerator(1, 1, () => 0.251).generateResources(omitted);

    expect(generated[0][0].resource).toBeDefined();
    expect(omitted[0][0].resource).toBeUndefined();
  });
});
