import { FreecivScenarioLoader } from '@game/map/FreecivScenarioLoader';
import { PlayerState } from '@game/managers/GameManager';
import { WrapFlag } from '@game/map/MapTopology';
import { MapManager } from '@game/managers/MapManager';
import { ScenarioUnavailableError } from '@game/map/ScenarioProvider';

function players(...civilizations: string[]): Map<string, PlayerState> {
  return new Map(
    civilizations.map((civilization, index) => {
      const id = `player-${index + 1}`;
      return [
        id,
        {
          id,
          userId: id,
          playerNumber: index,
          civilization,
          isReady: true,
          hasEndedTurn: false,
          isConnected: true,
          lastSeen: new Date(),
        },
      ];
    })
  );
}

describe('FreecivScenarioLoader', () => {
  it('loads a packaged classic scenario with topology, terrain, extras, and starts', () => {
    const result = new FreecivScenarioLoader().loadScenario(
      'earth-small',
      players('American', 'Roman')
    );

    expect(result.metadata.name).toBe('Earth (classic/small)');
    expect(result.mapData.width).toBe(80);
    expect(result.mapData.height).toBe(50);
    expect(result.mapData.wrapId).toBe(WrapFlag.X);
    expect(result.mapData.startingPositions).toEqual([
      { x: 15, y: 18, playerId: 'player-1' },
      { x: 36, y: 17, playerId: 'player-2' },
    ]);
    expect(result.mapData.tiles[0][0].terrain).toBe('glacier');
    expect(result.mapData.tiles.flat().some(tile => tile.improvements.includes('river'))).toBe(
      true
    );
    expect(result.mapData.tiles.flat().some(tile => tile.continentId > 0)).toBe(true);
  });

  it('rejects unknown scenario IDs before accessing the filesystem', () => {
    expect(() => new FreecivScenarioLoader().loadScenario('../secret', players())).toThrow(
      "Unknown classic scenario '../secret'"
    );
  });

  it('keeps scenario generation disabled unless a provider is explicitly installed', async () => {
    const manager = new MapManager(80, 50, 'test-seed', 'scenario', 'SCENARIO');

    await expect(manager.generateMap(players('American'), 'SCENARIO')).rejects.toBeInstanceOf(
      ScenarioUnavailableError
    );
    expect(manager.getMapData()).toBeNull();
  });

  it('retains an opt-in provider hook for a future scenario implementation', async () => {
    const manager = new MapManager(
      80,
      50,
      'test-seed',
      'scenario',
      'SCENARIO',
      undefined,
      false,
      50,
      {},
      'earth-small'
    );
    manager.setScenarioProvider(new FreecivScenarioLoader());

    await manager.generateMap(players('American'), 'SCENARIO');

    expect(manager.getMapData()).toMatchObject({
      width: 80,
      height: 50,
      seed: 'scenario:earth-small',
    });
  });
});
