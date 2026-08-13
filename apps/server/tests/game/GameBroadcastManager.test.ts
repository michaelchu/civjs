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
  let availableWorkerActions: string[];
  let spectatorSockets: Set<string>;

  beforeEach(() => {
    emitted = [];
    availableWorkerActions = [];
    spectatorSockets = new Set(['spectator-socket']);
    const io = {
      to: jest.fn((room: string) => ({
        emit: (event: string, data: any) => emitted.push({ room, event, data }),
      })),
      sockets: {
        adapter: {
          rooms: new Map([[`game:${gameId}:spectators`, spectatorSockets]]),
        },
      },
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
        getAvailableWorkerActions: () => availableWorkerActions,
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

  it('refreshes the owner-only worker action projection when authoritative state changes', () => {
    availableWorkerActions = ['build_road'];
    manager.broadcastVisibilityState(gameId);

    const firstUnitPacket = emitted.find(
      emission =>
        emission.room === `player:${userOne}` &&
        emission.event === 'packet' &&
        emission.data.type === PacketType.UNIT_INFO
    );
    expect(firstUnitPacket?.data.data.units[0].capabilities.availableWorkerActions).toEqual([
      'build_road',
    ]);

    emitted = [];
    availableWorkerActions = ['build_road', 'build_railroad'];
    manager.broadcastVisibilityState(gameId);

    const refreshedUnitPacket = emitted.find(
      emission =>
        emission.room === `player:${userOne}` &&
        emission.event === 'packet' &&
        emission.data.type === PacketType.UNIT_INFO
    );
    expect(refreshedUnitPacket?.data.data.units[0].capabilities.availableWorkerActions).toEqual([
      'build_road',
      'build_railroad',
    ]);
  });

  it('forwards rich combat presentation data only to participants or visible observers', () => {
    manager.broadcastCombatOccurred(gameId, {
      eventId: 'combat-1',
      x: 0,
      y: 0,
      playerIds: [playerOne],
      style: 'swords',
      attackerDamage: 40,
      defenderDamage: 100,
      defenderDestroyed: true,
      combatants: [
        {
          id: 'defender-1',
          role: 'defender',
          playerId: playerTwo,
          unitTypeId: 'warriors',
          x: 0,
          y: 0,
          hpBefore: 100,
          hpAfter: 0,
          destroyed: true,
        },
      ],
    });

    expect(emitted).toContainEqual(
      expect.objectContaining({
        room: `player:${userOne}`,
        event: 'combat_occurred',
        data: expect.objectContaining({
          eventId: 'combat-1',
          style: 'swords',
          combatants: expect.arrayContaining([expect.objectContaining({ id: 'defender-1' })]),
        }),
      })
    );
    expect(emitted.some(emission => emission.room === `player:${userTwo}`)).toBe(false);
  });

  it('filters hidden combatants from a visible observer payload', () => {
    manager.broadcastCombatOccurred(gameId, {
      eventId: 'combat-observer',
      x: 1,
      y: 0,
      playerIds: [playerOne],
      combatants: [
        {
          id: 'hidden-attacker',
          role: 'attacker',
          playerId: playerOne,
          unitTypeId: 'warriors',
          x: 0,
          y: 0,
          hpBefore: 100,
          hpAfter: 80,
          destroyed: false,
        },
        {
          id: 'visible-defender',
          role: 'defender',
          playerId: 'player-3',
          unitTypeId: 'warriors',
          x: 1,
          y: 0,
          hpBefore: 100,
          hpAfter: 0,
          destroyed: true,
        },
      ],
    });

    const participantEvent = emitted.find(
      emission => emission.room === `player:${userOne}` && emission.event === 'combat_occurred'
    );
    expect(participantEvent?.data.combatants).toHaveLength(2);

    const observerEvent = emitted.find(
      emission => emission.room === `player:${userTwo}` && emission.event === 'combat_occurred'
    );
    expect(observerEvent?.data.combatants).toEqual([
      expect.objectContaining({ id: 'visible-defender' }),
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-815
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-38
   * @assertion The live-map snapshot carries Civ2Civ3's independent ISO|HEX (3) and WrapX|WrapY (3) Freeciv packet flags to every player.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario normal
   */
  it('sends Civ2Civ3 ISO-hex topology in each MAP_INFO packet', () => {
    manager.broadcastMapData(gameId, {
      width: 2,
      height: 1,
      topologyId: 3,
      wrapId: 3,
      tiles: [
        [{ terrain: 'grassland', elevation: 0, riverMask: 0 }],
        [{ terrain: 'hills', elevation: 0, riverMask: 0 }],
      ],
    });

    const mapInfoPackets = emitted.filter(
      emission => emission.event === 'packet' && emission.data.type === PacketType.MAP_INFO
    );
    expect(mapInfoPackets).toHaveLength(3);
    expect(mapInfoPackets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            data: { xsize: 2, ysize: 1, topology_id: 3, wrap_id: 3 },
          }),
        }),
        expect.objectContaining({
          room: `game:${gameId}:spectators`,
          data: expect.objectContaining({
            data: { xsize: 2, ysize: 1, topology_id: 3, wrap_id: 3 },
          }),
        }),
      ])
    );
  });

  it('keeps the live spectator presentation stream omniscient and read-only', () => {
    const game = (manager as any).games.get(gameId);
    game.mapManager.getMapData = () => ({
      width: 2,
      height: 1,
      tiles: [
        [{ terrain: 'grassland', resource: 'wheat', elevation: 0, riverMask: 0 }],
        [{ terrain: 'hills', resource: 'gold', elevation: 0, riverMask: 0 }],
      ],
    });
    game.borderManager.getAllTileOwnership = () => [
      { x: 1, y: 0, playerId: playerTwo, strength: 4 },
    ];
    game.unitManager.getUnitType = () => ({
      id: 'warriors',
      hitpoints: 10,
      movement: 1,
      flags: [],
      rulesetUnitClassFlags: [],
    });
    const spectatorUnits = game.unitManager.getAllUnits();
    game.unitManager.getAllUnits = () => spectatorUnits;
    const hiddenUnit = spectatorUnits.get('hidden-unit');
    hiddenUnit.health = 7;
    hiddenUnit.automation = 'worker';
    hiddenUnit.automationTask = {
      action: 'build_road',
      targetX: 1,
      targetY: 0,
      assignedTurn: 1,
    };
    game.cityManager.getAllCities = () => [];

    manager.broadcastVisibilityState(gameId);

    const spectatorPackets = emitted.filter(
      emission => emission.room === `game:${gameId}:spectators` && emission.event === 'packet'
    );
    expect(
      spectatorPackets
        .flatMap(emission => emission.data.data.tiles ?? [])
        .filter(tile => tile.terrain)
    ).toEqual([
      expect.objectContaining({ x: 0, y: 0, known: 2, seen: 1, resource: 'wheat' }),
      expect.objectContaining({ x: 1, y: 0, known: 2, seen: 1, resource: 'gold' }),
    ]);
    expect(
      spectatorPackets.find(emission => emission.data.type === PacketType.UNIT_INFO)?.data.data
        .units
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hidden-unit',
          hp: 7,
          maxHp: 10,
          automation: 'worker',
          automationTask: undefined,
        }),
      ])
    );
    expect(
      spectatorPackets.find(emission => emission.data.type === PacketType.BORDER_UPDATE)?.data.data
        .tiles
    ).toEqual([{ x: 1, y: 0, owner: playerTwo, strength: 4 }]);
    expect(
      emitted.some(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO &&
          emission.data.data.units.some(
            (unit: any) => unit.id === 'hidden-unit' && unit.automation === 'worker'
          )
      )
    ).toBe(false);
  });

  it('skips omniscient projection work when no spectator is connected', () => {
    spectatorSockets.clear();
    const projectTiles = jest.spyOn(manager as any, 'getSpectatorMapTiles');
    const projectUnits = jest.spyOn(manager as any, 'getSpectatorUnits');
    const projectCities = jest.spyOn(manager as any, 'sendSpectatorCityData');

    manager.broadcastVisibilityDelta(gameId);

    expect(projectTiles).not.toHaveBeenCalled();
    expect(projectUnits).not.toHaveBeenCalled();
    expect(projectCities).not.toHaveBeenCalled();
    expect(emitted.some(emission => emission.room === `game:${gameId}:spectators`)).toBe(false);
  });

  it('reuses each visibility calculation for the matching city delta', () => {
    spectatorSockets.clear();
    const game = (manager as any).games.get(gameId);

    manager.broadcastVisibilityDelta(gameId);

    expect(game.visibilityManager.updatePlayerVisibility).toHaveBeenCalledTimes(2);
  });

  it('projects only currently relevant tiles for a primed movement delta', () => {
    spectatorSockets.clear();
    manager.broadcastVisibilityState(gameId);
    const createTileInfo = jest.spyOn(manager as any, 'createTileInfo');

    manager.broadcastVisibilityDelta(gameId);

    expect(createTileInfo).toHaveBeenCalledTimes(2);

    emitted = [];
    createTileInfo.mockClear();
    manager.broadcastVisibilityDelta(gameId, true);

    expect(createTileInfo).toHaveBeenCalledTimes(4);
    expect(
      emitted.some(
        emission => emission.event === 'packet' && emission.data.type === PacketType.TILE_INFO
      )
    ).toBe(false);
  });

  it('routes nuclear effects by visible affected tiles without exposing a hidden center', () => {
    manager.broadcastNuclearExplosion(gameId, {
      eventId: 'nuke-1',
      x: 0,
      y: 0,
      playerId: playerOne,
      affectedTiles: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });

    const ownerEvent = emitted.find(
      emission => emission.room === `player:${userOne}` && emission.event === 'nuclear_explosion'
    );
    expect(ownerEvent?.data.tiles).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(ownerEvent?.data).toEqual(expect.objectContaining({ x: 0, y: 0 }));
    const observerEvent = emitted.find(
      emission => emission.room === `player:${userTwo}` && emission.event === 'nuclear_explosion'
    );
    expect(observerEvent?.data.tiles).toEqual([{ x: 1, y: 0 }]);
    expect(observerEvent?.data).toEqual(expect.objectContaining({ x: 1, y: 0 }));
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
          resource: 'iron',
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
    manager.broadcastVisibilityState(gameId);
    emitted = [];

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
    expect(
      emitted.find(
        emission =>
          emission.room === `player:${userOne}` &&
          emission.event === 'packet' &&
          emission.data.type === PacketType.UNIT_INFO
      )?.data.data.fullSnapshot
    ).toBe(false);
  });

  it('removes a unit that leaves sight without sending full visibility snapshots', () => {
    const game = (manager as any).games.get(gameId);
    const ownUnit = game.unitManager.getAllUnits().get('own-unit');
    game.unitManager.getVisibleUnits = (playerId: string) =>
      playerId === playerOne || playerId === playerTwo ? [ownUnit] : [];
    manager.broadcastVisibilityState(gameId);
    emitted = [];

    game.unitManager.getVisibleUnits = (playerId: string) =>
      playerId === playerOne ? [ownUnit] : [];
    manager.broadcastVisibilityDelta(gameId);

    expect(emitted).toContainEqual({
      room: `player:${userTwo}`,
      event: 'unit_destroyed',
      data: { gameId, unitId: 'own-unit' },
    });
    expect(
      emitted.some(
        emission =>
          emission.event === 'packet' &&
          ((emission.data.type === PacketType.UNIT_INFO &&
            emission.data.data.fullSnapshot === true) ||
            (emission.data.type === PacketType.TILE_INFO &&
              emission.data.data.fullSnapshot === true))
      )
    ).toBe(false);
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

  it('does not reveal C2C3 small-wonder cities before their tile is explored', () => {
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

  it('advertises the audited C2C3 covert actions for spies', () => {
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
      'spy_attack',
    ]);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:449-486
   * @assertion CivJS advertises c2c3's UnitType-based Explorer city actions rather than requiring the Diplomat unit flag.
   * @c2c3-surface diplomacy-espionage
   * @c2c3-surface-scenario normal
   */
  it('advertises c2c3 Explorer embassy and investigation actions', () => {
    const formatted = (manager as any).formatUnitForClient(
      {
        id: 'explorer-1',
        playerId: playerOne,
        unitTypeId: 'explorer',
        x: 0,
        y: 0,
        movementLeft: 3,
        health: 100,
      },
      { getUnitMaxMovement: () => 1 },
      playerOne,
      'civ2civ3'
    );

    expect(formatted.capabilities.diplomatActions).toEqual([
      'establish_embassy',
      'investigate_city',
    ]);
  });

  it('sends researched upgrade metadata only to the owning player', () => {
    const unit = {
      id: 'upgrade-unit',
      playerId: playerOne,
      unitTypeId: 'warriors',
      x: 0,
      y: 0,
      movementLeft: 3,
      health: 100,
    };
    const unitManager = {
      getUnitMaxMovement: () => 3,
      getUnitUpgradeInfo: () => ({ unitTypeId: 'musketeers', name: 'Musketeers', cost: 65 }),
    };

    expect((manager as any).formatUnitForClient(unit, unitManager, playerOne).capabilities).toEqual(
      expect.objectContaining({
        upgradeTarget: { unitTypeId: 'musketeers', name: 'Musketeers', cost: 65 },
      })
    );
    expect(
      (manager as any).formatUnitForClient(unit, unitManager, playerTwo).capabilities.upgradeTarget
    ).toBeUndefined();
  });

  it('adds owner-scoped airlift endpoint capacity to city updates', () => {
    const game = (manager as any).games.get(gameId);
    game.cityManager.getAllCities = () => [
      {
        id: 'own-city',
        name: 'Capital',
        playerId: playerOne,
        x: 0,
        y: 0,
        population: 1,
        history: 0,
        specialists: {},
        happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
        buildings: ['airport'],
        worklist: [],
        tradeRoutes: [],
      },
    ];
    game.cityManager.getAirliftAvailability = jest.fn(
      (_cityId: string, _playerId: string, direction: 'from' | 'to') =>
        direction === 'from'
          ? { enabled: true, available: false }
          : { enabled: true, available: true }
    );

    manager.broadcastCityDataToPlayer(gameId, playerOne);

    const city = emitted.find(
      emission => emission.room === `player:${userOne}` && emission.event === 'cities_updated'
    )?.data.cities['own-city'];
    expect(city.airlift).toEqual({
      from: { enabled: true, available: false },
      to: { enabled: true, available: true },
    });
  });

  it('sends worker automation state only to the owning player', () => {
    const unit = {
      id: 'worker-1',
      playerId: playerOne,
      unitTypeId: 'worker',
      x: 0,
      y: 0,
      movementLeft: 3,
      health: 100,
      automation: 'worker',
      automationTask: {
        action: 'build_road',
        targetX: 2,
        targetY: 2,
        assignedTurn: 4,
      },
    };
    const unitManager = { getUnitMaxMovement: () => 1 };

    expect((manager as any).formatUnitForClient(unit, unitManager, playerOne)).toMatchObject({
      automation: 'worker',
      automationTask: expect.objectContaining({ targetX: 2, targetY: 2 }),
    });
    expect((manager as any).formatUnitForClient(unit, unitManager, playerTwo)).toMatchObject({
      automation: undefined,
      automationTask: undefined,
    });
  });

  it('uses the ruleset hitpoint maximum for unit presentation', () => {
    const formatted = (manager as any).formatUnitForClient(
      {
        id: 'storm-1',
        playerId: playerOne,
        unitTypeId: 'storm',
        x: 0,
        y: 0,
        movementLeft: 3,
        health: 5,
      },
      {
        getUnitMaxMovement: () => 3,
      },
      playerOne
    );

    expect(formatted).toMatchObject({ hp: 5, maxHp: 10 });
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
    expect(
      emitted.filter(
        emission =>
          emission.room === `game:${gameId}:spectators` && emission.event === 'unit_destroyed'
      )
    ).toEqual([
      {
        room: `game:${gameId}:spectators`,
        event: 'unit_destroyed',
        data: { gameId, unitId: 'lost-unit' },
      },
    ]);
  });
});
