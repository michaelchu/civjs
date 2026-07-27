import { BorderNetworkService } from '@game/services/BorderNetworkService';
import { PacketType } from '@app-types/packet';
import type { BorderUpdate } from '@app-types/shared/BorderTypes';

describe('BorderNetworkService', () => {
  it('sends incremental borders to owners and players who previously explored the tile', () => {
    const hostEmit = jest.fn();
    const guestEmit = jest.fn();
    const io = {
      to: jest.fn((room: string) => ({
        emit: room === 'player:host-user' ? hostEmit : guestEmit,
      })),
    } as any;
    const visibleTiles = new Map([
      ['host-player', new Set<string>()],
      ['guest-player', new Set<string>()],
    ]);
    const exploredTiles = new Map([
      ['host-player', new Set(['2,2'])],
      ['guest-player', new Set(['1,1'])],
    ]);
    const game = {
      players: new Map([
        ['host-player', { id: 'host-player', userId: 'host-user' }],
        ['guest-player', { id: 'guest-player', userId: 'guest-user' }],
      ]),
      visibilityManager: {
        updatePlayerVisibility: jest.fn(),
        getVisibleTiles: (playerId: string) => visibleTiles.get(playerId),
        getExploredTiles: (playerId: string) => exploredTiles.get(playerId),
      },
    } as any;
    const service = new BorderNetworkService(io, {} as any, () => game);
    const update: BorderUpdate = {
      tiles: [
        { x: 1, y: 1, playerId: 'host-player', strength: 1, claimedBy: null },
        { x: 2, y: 2, playerId: 'guest-player', strength: 1, claimedBy: null },
        { x: 9, y: 9, playerId: 'hidden-player', strength: 1, claimedBy: null },
      ],
      sources: [],
      removedSources: [],
      affectedPlayers: ['host-player'],
    };

    service.broadcastBorderUpdate('game-1', update);

    expect(hostEmit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.BORDER_UPDATE,
        data: expect.objectContaining({
          tiles: [
            { x: 1, y: 1, owner: 'host-player', strength: 1 },
            { x: 2, y: 2, owner: 'guest-player', strength: 1 },
          ],
        }),
      })
    );
    expect(guestEmit).toHaveBeenCalledWith(
      'packet',
      expect.objectContaining({
        type: PacketType.BORDER_UPDATE,
        data: expect.objectContaining({
          tiles: [
            { x: 1, y: 1, owner: 'host-player', strength: 1 },
            { x: 2, y: 2, owner: 'guest-player', strength: 1 },
          ],
        }),
      })
    );
  });
});
