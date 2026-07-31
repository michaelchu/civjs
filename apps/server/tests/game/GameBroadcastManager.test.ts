import { GameBroadcastManager } from '@game/orchestrators/GameBroadcastManager';
import { PacketType } from '@app-types/packet';
import { logger } from '@utils/logger';

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
      config: { ruleset: 'civ2civ3' },
      players: new Map([
        [
          playerOne,
          {
            id: playerOne,
            userId: userOne,
            isConnected: true,
            civilization: 'romans',
            leaderName: 'Caesar',
            color: { r: 255, g: 0, b: 0 },
          },
        ],
        [
          playerTwo,
          {
            id: playerTwo,
            userId: userTwo,
            isConnected: true,
            isAI: true,
            civilization: 'greeks',
            leaderName: 'Pericles',
            color: { r: 0, g: 170, b: 51 },
          },
        ],
      ]),
      currentTurn: 1,
      mapManager: {
        getMapData: () => ({
          width: 2,
          height: 1,
          tiles: [
            [{ terrain: 'grassland', elevation: 0, riverMask: 0 }],
            [{ terrain: 'hills', elevation: 0, riverMask: 0 }],
          ],
        }),
      },
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
        getAllUnits: () =>
          new Map([
            [
              'own-unit',
              {
                id: 'own-unit',
                playerId: playerOne,
                type: 'warriors',
                x: 0,
                y: 0,
                movementLeft: 1,
                health: 100,
              },
            ],
            [
              'hidden-unit',
              {
                id: 'hidden-unit',
                playerId: playerTwo,
                type: 'warriors',
                x: 1,
                y: 0,
                movementLeft: 1,
                health: 100,
              },
            ],
          ]),
      },
      cityManager: { getAllCities: () => [] },
      borderManager: { getAllTileOwnership: () => [] },
      researchManager: {
        getResearchedTechs: (playerId: string) => (playerId === playerOne ? ['iron_working'] : []),
      },
    };
    manager.setGamesReference(new Map([[gameId, game as any]]));
  });

  it('broadcasts lobby connection events without warning about a missing runtime instance', () => {
    manager.setGamesReference(new Map());

    manager.broadcastToGame(gameId, 'player-connection-changed', {
      playerId: playerOne,
      isConnected: true,
    });

    expect(emitted).toEqual([
      {
        room: `game:${gameId}`,
        event: 'player-connection-changed',
        data: { playerId: playerOne, isConnected: true },
      },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('broadcasts authoritative resource totals and per-turn changes', async () => {
    const economicManager = {
      getPlayerGold: jest.fn().mockResolvedValue(41),
      getLastTurnSummary: jest.fn().mockReturnValue({
        totals: { netGoldChange: -1 },
      }),
    };
    const game = {
      players: new Map([
        [
          playerOne,
          {
            id: playerOne,
            userId: userOne,
            isConnected: true,
            civilization: 'romans',
            color: { r: 255, g: 0, b: 0 },
          },
        ],
      ]),
      turnManager: {
        getEconomicManager: () => economicManager,
      },
      researchManager: {
        getPlayerResearch: () => ({
          currentTech: 'pottery',
          bulbsAccumulated: 18,
          bulbsLastTurn: 2,
          researchedTechs: new Set(['alphabet']),
          futureTechs: 0,
        }),
        getResearchProgress: () => ({ current: 18, required: 20, turnsRemaining: 1 }),
        getAvailableTechnologies: () => [
          {
            id: 'pottery',
            name: 'Pottery',
            cost: 20,
            requirements: [],
            flags: [],
          },
        ],
        getTechnologyCatalogue: () => [
          {
            id: 'alphabet',
            name: 'Alphabet',
            cost: 10,
            requirements: [],
            flags: [],
          },
          {
            id: 'pottery',
            name: 'Pottery',
            cost: 20,
            requirements: [],
            flags: [],
          },
        ],
      },
    };
    manager.setGamesReference(new Map([[gameId, game as any]]));

    await manager.broadcastPlayerInfo(gameId);

    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          room: `player:${userOne}`,
          event: 'packet',
          data: expect.objectContaining({
            type: PacketType.PLAYER_INFO,
            data: expect.objectContaining({
              id: playerOne,
              gold: 41,
              goldPerTurn: -1,
              science: 18,
              sciencePerTurn: 2,
            }),
          }),
        }),
      ])
    );
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          room: `player:${userOne}`,
          event: 'packet',
          data: expect.objectContaining({
            type: PacketType.RESEARCH_PROGRESS_REPLY,
            data: {
              currentTech: 'pottery',
              techGoal: undefined,
              current: 18,
              required: 20,
              turnsRemaining: 1,
              bulbsLastTurn: 2,
            },
          }),
        }),
        expect.objectContaining({
          room: `player:${userOne}`,
          event: 'packet',
          data: expect.objectContaining({
            type: PacketType.RESEARCH_LIST_REPLY,
            data: expect.objectContaining({
              researchedTechs: ['alphabet'],
            }),
          }),
        }),
      ])
    );
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
    const playerOnePlayerInfo = playerOnePackets
      .filter(emission => emission.data.type === PacketType.PLAYER_INFO)
      .map(emission => emission.data.data);

    expect(
      emitted.some(emission => emission.room === `game:${gameId}` && emission.event === 'packet')
    ).toBe(false);
    expect(playerOnePlayerInfo).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: playerTwo,
          isAI: true,
          color: { r: 0, g: 170, b: 51 },
        }),
      ])
    );
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
          known: 2,
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
          seen: 0,
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
          terrain: 'unknown',
          resource: undefined,
          hasRoad: false,
          hasRailroad: false,
          improvements: [],
          cityId: undefined,
          owner: undefined,
          claimer: undefined,
          known: 0,
          seen: 0,
        }),
        expect.objectContaining({
          x: 1,
          y: 0,
          terrain: 'hills',
          resource: undefined,
          hasRoad: true,
          hasRailroad: true,
          improvements: ['mine', 'pollution'],
          owner: playerTwo,
          claimer: 'city-2',
          known: 2,
          seen: 1,
        }),
      ])
    );
    expect(
      playerOnePackets.find(emission => emission.data.type === PacketType.UNIT_INFO)?.data.data
        .units
    ).toEqual([
      expect.objectContaining({
        id: 'own-unit',
        owner: playerOne,
        capabilities: expect.objectContaining({
          canFortify: true,
          canFoundCity: false,
          canBuildImprovements: false,
          canPillage: true,
          canTrade: false,
          diplomatActions: [],
        }),
      }),
    ]);
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
      emitted.find(
        emission =>
          emission.room === `player:${userTwo}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )?.data.data.units
    ).toEqual([]);
    expect(
      emitted.find(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )?.data.data.units
    ).toEqual([
      expect.objectContaining({
        id: 'own-unit',
        owner: playerOne,
        type: 'warriors',
        hp: 100,
        movesleft: 1,
      }),
    ]);
  });

  it('sends and maintains a complete development visibility snapshot', () => {
    expect(manager.setDebugVisibility(gameId, playerOne, true)).toBe(true);

    const packets = emitted.filter(
      emission => emission.room === `player:${userOne}` && emission.event === 'packet'
    );
    const tiles = packets.find(emission => emission.data.type === PacketType.TILE_INFO)?.data.data
      .tiles;
    const units = packets.find(emission => emission.data.type === PacketType.UNIT_INFO)?.data.data
      .units;

    expect(tiles).toEqual([
      expect.objectContaining({ terrain: 'grassland', known: 2, seen: 1 }),
      expect.objectContaining({ terrain: 'hills', known: 2, seen: 1 }),
    ]);
    expect(units).toEqual([
      expect.objectContaining({ id: 'own-unit' }),
      expect.objectContaining({ id: 'hidden-unit' }),
    ]);

    emitted = [];
    manager.broadcastVisibilityState(gameId);
    expect(
      emitted.find(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )?.data.data.units
    ).toEqual([
      expect.objectContaining({ id: 'own-unit' }),
      expect.objectContaining({ id: 'hidden-unit' }),
    ]);
  });

  it('keeps a discovered foreign city in sync after it leaves current vision', () => {
    const game = (manager as any).games.get(gameId);
    game.cityManager.getAllCities = () => [
      {
        id: 'known-city',
        name: 'Known City',
        playerId: 'ai-player',
        x: 0,
        y: 0,
        population: 1,
        history: 0,
        specialists: {},
        happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
        buildings: [],
        worklist: [],
        tradeRoutes: [],
      },
    ];

    manager.broadcastCityDataToPlayer(gameId, playerOne);
    manager.broadcastCityDataToPlayer(gameId, playerTwo);

    expect(
      emitted.find(
        emission => emission.room === `player:${userOne}` && emission.event === 'cities_updated'
      )?.data.cities
    ).toHaveProperty('known-city');
    expect(
      emitted.find(
        emission => emission.room === `player:${userTwo}` && emission.event === 'cities_updated'
      )?.data.cities
    ).toEqual({});
  });

  it('does not reveal classic small-wonder cities before their tile is explored', () => {
    const game = (manager as any).games.get(gameId);
    game.cityManager.getAllCities = () => [
      {
        id: 'palace-city',
        name: 'Capital',
        playerId: 'ai-player',
        x: 0,
        y: 0,
        population: 1,
        history: 0,
        specialists: {},
        happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
        buildings: ['palace'],
        worklist: [],
        tradeRoutes: [],
      },
    ];

    manager.broadcastCityDataToPlayer(gameId, playerTwo);

    expect(
      emitted.find(
        emission => emission.room === `player:${userTwo}` && emission.event === 'cities_updated'
      )?.data.cities
    ).toEqual({});
  });

  it('advertises the audited classic covert actions for spies', () => {
    const formatted = (manager as any).formatUnitForClient(
      {
        id: 'spy-1',
        playerId: playerOne,
        unitTypeId: 'spy',
        x: 0,
        y: 0,
        movementLeft: 9,
        health: 100,
      },
      { getUnitMaxMovement: () => 3 }
    );

    expect(formatted.capabilities.diplomatActions).toEqual([
      'establish_embassy',
      'investigate_city',
      'steal_tech',
      'bribe_unit',
      'incite_city',
      'sabotage_city',
      'sabotage_city_production',
      'poison_water',
      'sabotage_unit',
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
    expect(
      emitted.some(
        emission => emission.room === `player:${userTwo}` && emission.event === 'unit_destroyed'
      )
    ).toBe(false);
  });
});
