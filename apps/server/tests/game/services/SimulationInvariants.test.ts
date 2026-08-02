import {
  evaluateSimulationInvariants,
  type SimulationInvariantResult,
} from '@game/services/SimulationInvariants';

const playerOneId = 'player-1';
const playerTwoId = 'player-2';

function createMap() {
  return {
    width: 4,
    height: 4,
    tiles: Array.from({ length: 4 }, (_, x) =>
      Array.from({ length: 4 }, (_, y) => ({ x, y, terrain: 'grassland' }))
    ),
  };
}

function createSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    turn: 1,
    year: -4000,
    map: createMap(),
    cities: [
      { id: 'city-1', playerId: playerOneId, x: 1, y: 1, population: 1, size: 1 },
      { id: 'city-2', playerId: playerTwoId, x: 2, y: 2, population: 1, size: 1 },
    ],
    units: [
      {
        id: 'unit-1',
        playerId: playerOneId,
        x: 1,
        y: 1,
        health: 100,
        movementLeft: 1,
      },
    ],
    research: {
      [playerOneId]: {
        playerId: playerOneId,
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
        futureTechs: 0,
        researchedTechs: [],
      },
      [playerTwoId]: {
        playerId: playerTwoId,
        bulbsAccumulated: 0,
        bulbsLastTurn: 0,
        futureTechs: 0,
        researchedTechs: [],
      },
    },
    diplomacy: {
      players: [
        {
          playerId: playerOneId,
          playerNumber: 1,
          isAlive: true,
          teamId: 'team-1',
          relations: [
            {
              playerId: playerTwoId,
              state: 'peace',
              maxState: 'peace',
              turnsLeft: 0,
            },
          ],
        },
        {
          playerId: playerTwoId,
          playerNumber: 2,
          isAlive: true,
          teamId: 'team-2',
          relations: [
            {
              playerId: playerOneId,
              state: 'peace',
              maxState: 'peace',
              turnsLeft: 0,
            },
          ],
        },
      ],
    },
    ...overrides,
  };
}

describe('simulation state invariants', () => {
  it('accepts a structurally valid checkpoint', () => {
    const result = evaluateSimulationInvariants([{ turn: 1, snapshot: createSnapshot() }]);

    expect(result).toEqual<SimulationInvariantResult>({
      passed: true,
      checkedTurns: 1,
      violations: [],
    });
  });

  it('reports ownership, coordinate, research, and bilateral diplomacy corruption', () => {
    const broken = createSnapshot() as any;
    broken.cities[1].x = 1;
    broken.cities[1].y = 1;
    broken.units[0].x = 9;
    broken.units[0].playerId = 'missing-player';
    broken.research[playerOneId].bulbsAccumulated = -1;
    broken.diplomacy.players[1].relations[0].state = 'war';

    const result = evaluateSimulationInvariants([{ turn: 1, snapshot: broken }]);

    expect(result.passed).toBe(false);
    expect(result.violations.map(violation => violation.code)).toEqual(
      expect.arrayContaining([
        'CITY_STATE',
        'UNIT_STATE',
        'UNIT_REFERENCE',
        'RESEARCH_STATE',
        'DIPLOMACY_SYMMETRY',
      ])
    );
    expect(result.violations.some(violation => violation.path === 'units[0]')).toBe(true);
  });

  it('requires reciprocal trade routes and transport links', () => {
    const snapshot = createSnapshot() as any;
    snapshot.cities[0].tradeRoutes = [
      {
        sourceCity: 'city-1',
        partnerCity: 'city-2',
        establishedTurn: 1,
        value: 3,
        goods: 'silk',
      },
    ];
    snapshot.units = [
      {
        id: 'transport',
        playerId: playerOneId,
        x: 1,
        y: 1,
        health: 100,
        movementLeft: 1,
        cargoUnits: ['cargo'],
      },
      {
        id: 'cargo',
        playerId: playerOneId,
        x: 1,
        y: 1,
        health: 100,
        movementLeft: 0,
        transportedBy: 'missing-transporter',
      },
    ];

    const result = evaluateSimulationInvariants([{ turn: 1, snapshot }]);

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'CITY_TRADE_ROUTE' }),
        expect.objectContaining({ code: 'UNIT_TRANSPORT' }),
      ])
    );
  });

  it('checks turn continuity across replay checkpoints', () => {
    const second = createSnapshot({ turn: 1 });
    const result = evaluateSimulationInvariants([
      { turn: 1, snapshot: createSnapshot() },
      { turn: 2, snapshot: second },
    ]);

    expect(result.violations).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TURN_SEQUENCE' })])
    );
  });
});
