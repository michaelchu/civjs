import { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { PacketType } from '@app-types/packet';

jest.mock('../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('GameBroadcastManager visibility sync', () => {
  const gameId = 'game-1';
  const playerOne = 'player-1';
  const playerTwo = 'player-2';
  const userOne = 'user-1';
  const userTwo = 'user-2';
  let emitted: Array<{ room: string; event: string; data: any }>;
  let manager: GameBroadcastManager;

  beforeEach(() => {
    emitted = [];
    const io = {
      to: jest.fn((room: string) => ({
        emit: (event: string, data: any) => emitted.push({ room, event, data }),
      })),
    };
    manager = new GameBroadcastManager(io as any);

    const visible = new Map([
      [playerOne, new Set(['0,0'])],
      [playerTwo, new Set(['1,0'])],
    ]);
    const explored = new Map([
      [playerOne, new Set(['0,0', '1,0'])],
      [playerTwo, new Set(['1,0'])],
    ]);
    const game = {
      players: new Map([
        [playerOne, { id: playerOne, userId: userOne, isConnected: true }],
        [playerTwo, { id: playerTwo, userId: userTwo, isConnected: true }],
      ]),
      currentTurn: 1,
      visibilityManager: {
        updatePlayerVisibility: jest.fn(),
        getVisibleTiles: (playerId: string) => visible.get(playerId),
        getExploredTiles: (playerId: string) => explored.get(playerId),
      },
      unitManager: {
        getVisibleUnits: (playerId: string) =>
          playerId === playerOne
            ? [
                {
                  id: 'own-unit',
                  playerId: playerOne,
                  type: 'warriors',
                  x: 0,
                  y: 0,
                  movementLeft: 1,
                  health: 100,
                },
              ]
            : [],
        getUnitMaxMovement: () => 1,
      },
      cityManager: { getAllCities: () => [] },
    };
    manager.setGamesReference(new Map([[gameId, game as any]]));
  });

  it('sends each user only their explored map and visible units', () => {
    manager.broadcastMapData(gameId, {
      width: 2,
      height: 1,
      tiles: [
        [
          {
            terrain: 'grassland',
            resource: 'wheat',
            elevation: 0,
            riverMask: 0,
            hasRoad: true,
            hasRailroad: false,
            improvements: ['irrigation'],
            cityId: 'city-1',
            owner: playerOne,
            claimer: 'city-1',
          },
        ],
        [
          {
            terrain: 'hills',
            resource: 'iron',
            elevation: 2,
            riverMask: 1,
            hasRoad: true,
            hasRailroad: true,
            improvements: ['mine', 'pollution'],
            owner: playerTwo,
            claimer: 'city-2',
          },
        ],
      ],
    });

    const playerOnePackets = emitted.filter(
      emission => emission.room === `player:${userOne}` && emission.event === 'packet'
    );
    const playerTwoPackets = emitted.filter(
      emission => emission.room === `player:${userTwo}` && emission.event === 'packet'
    );
    const playerOneTiles = playerOnePackets.find(
      emission => emission.data.type === PacketType.TILE_INFO
    )?.data.data.tiles;

    expect(
      emitted.some(emission => emission.room === `game:${gameId}` && emission.event === 'packet')
    ).toBe(false);
    expect(playerOneTiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          x: 0,
          y: 0,
          terrain: 'grassland',
          resource: 'wheat',
          hasRoad: true,
          hasRailroad: false,
          improvements: ['irrigation'],
          cityId: 'city-1',
          owner: playerOne,
          claimer: 'city-1',
          known: 1,
          seen: 1,
        }),
        expect.objectContaining({
          x: 1,
          y: 0,
          terrain: 'hills',
          resource: undefined,
          hasRoad: false,
          hasRailroad: false,
          improvements: [],
          cityId: undefined,
          owner: undefined,
          claimer: undefined,
          known: 0,
          seen: 1,
        }),
      ])
    );
    expect(
      playerTwoPackets.find(emission => emission.data.type === PacketType.TILE_INFO)?.data.data
        .tiles
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          x: 0,
          y: 0,
          terrain: 'grassland',
          resource: undefined,
          hasRoad: false,
          hasRailroad: false,
          improvements: [],
          cityId: undefined,
          owner: undefined,
          claimer: undefined,
          known: 0,
          seen: 1,
        }),
        expect.objectContaining({
          x: 1,
          y: 0,
          terrain: 'hills',
          resource: 'iron',
          hasRoad: true,
          hasRailroad: true,
          improvements: ['mine', 'pollution'],
          owner: playerTwo,
          claimer: 'city-2',
          known: 1,
          seen: 1,
        }),
      ])
    );
    expect(
      playerOnePackets.find(emission => emission.data.type === PacketType.UNIT_INFO)?.data.data
        .units
    ).toEqual([expect.objectContaining({ id: 'own-unit', owner: playerOne })]);
    expect(
      playerTwoPackets.find(emission => emission.data.type === PacketType.UNIT_INFO)?.data.data
        .units
    ).toEqual([]);
  });

  it('does not disclose a newly produced unit outside the recipient vision', () => {
    manager.broadcastUnitInfo(gameId, {
      id: 'new-unit',
      playerId: playerOne,
      type: 'warriors',
      x: 0,
      y: 0,
      movementLeft: 1,
      health: 100,
    });

    expect(
      emitted.some(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )
    ).toBe(true);
    expect(
      emitted.some(
        emission =>
          emission.room === `player:${userTwo}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )
    ).toBe(false);
    expect(
      emitted.find(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )?.data.data.units
    ).toEqual([
      expect.objectContaining({
        id: 'new-unit',
        owner: playerOne,
        type: 'warriors',
        hp: 100,
        movesleft: 1,
      }),
    ]);
  });

  it('visibility-scopes unit destruction using the last-known tile', () => {
    manager.broadcastUnitDestroyed(gameId, {
      id: 'lost-unit',
      playerId: playerOne,
      x: 0,
      y: 0,
    });

    expect(emitted).toContainEqual({
      room: `player:${userOne}`,
      event: 'unit_destroyed',
      data: { gameId, unitId: 'lost-unit' },
    });
    expect(emitted.some(emission => emission.room === `player:${userTwo}`)).toBe(false);
  });
});
