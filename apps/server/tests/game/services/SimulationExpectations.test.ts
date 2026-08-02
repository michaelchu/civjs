import {
  evaluateSimulationExpectations,
  simulationExpectationSchema,
} from '@game/services/SimulationExpectations';

const playerOneId = 'player-1';
const playerTwoId = 'player-2';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    turn: 4,
    year: -3960,
    cities: [
      { id: 'city-1', playerId: playerOneId },
      { id: 'city-2', playerId: playerTwoId },
    ],
    units: [
      { id: 'unit-1', playerId: playerOneId },
      { id: 'unit-2', playerId: playerOneId },
    ],
    research: {
      [playerOneId]: { researchedTechs: ['alphabet', 'pottery'] },
      [playerTwoId]: { researchedTechs: [] },
    },
    diplomacy: {
      players: [
        {
          playerId: playerOneId,
          playerNumber: 1,
          isAlive: true,
          relations: [
            {
              playerId: playerTwoId,
              state: 'war',
              maxState: 'war',
              embassy: false,
              sharedVision: false,
            },
          ],
        },
        {
          playerId: playerTwoId,
          playerNumber: 2,
          isAlive: false,
          relations: [
            {
              playerId: playerOneId,
              state: 'war',
              maxState: 'war',
              embassy: false,
              sharedVision: false,
            },
          ],
        },
      ],
    },
    diplomacyEvents: [{ type: 'war_declared', playerIds: [playerOneId, playerTwoId] }],
    ...overrides,
  };
}

describe('simulation outcome expectations', () => {
  it('normalizes diplomacy and player assertions', () => {
    expect(
      simulationExpectationSchema.parse({
        players: [{ playerNumber: 1, minCities: 1 }],
        diplomacyEvents: [{ type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2 }],
      })
    ).toEqual({
      players: [{ playerNumber: 1, minCities: 1 }],
      diplomacy: [],
      diplomacyEvents: [
        { type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2, minCount: 1 },
      ],
    });
  });

  it('passes final-state, winner, diplomacy, and event assertions', () => {
    const result = evaluateSimulationExpectations(
      simulationExpectationSchema.parse({
        minCompletedTurns: 2,
        maxCompletedTurns: 5,
        endReason: 'max_turns',
        players: [
          {
            playerNumber: 1,
            isAlive: true,
            isWinner: true,
            minCities: 1,
            minUnits: 2,
            minTechnologies: 2,
            requiredTechnologies: ['Alphabet'],
          },
          { playerNumber: 2, isAlive: false },
        ],
        diplomacy: [
          {
            playerNumber: 1,
            otherPlayerNumber: 2,
            state: 'war',
            maxState: 'war',
          },
        ],
        diplomacyEvents: [{ type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2 }],
      }),
      {
        completedTurns: [
          { turn: 1, snapshot: { ...snapshot(), diplomacyEvents: [] } },
          { turn: 4, snapshot: snapshot() },
        ],
        endReason: 'max_turns',
        standings: { winnerPlayerIds: [playerOneId] },
      }
    );

    expect(result).toEqual({ passed: true, failures: [] });
  });

  it('reports actionable failures for missing gameplay outcomes', () => {
    const result = evaluateSimulationExpectations(
      simulationExpectationSchema.parse({
        minCompletedTurns: 5,
        endReason: 'conquest',
        players: [{ playerNumber: 1, minCities: 2 }],
        diplomacy: [{ playerNumber: 1, otherPlayerNumber: 2, state: 'peace' }],
        diplomacyEvents: [
          { type: 'war_declared', playerNumber: 2, otherPlayerNumber: 1, minCount: 2 },
        ],
      }),
      {
        completedTurns: [{ turn: 4, snapshot: snapshot() }],
        endReason: 'max_turns',
        standings: [],
      }
    );

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      'minCompletedTurns: expected at least 5, observed 1',
      'endReason: expected conquest, observed max_turns',
      'players[0].cities: expected at least 2, observed 1',
      'diplomacy[0].state: expected peace, observed war',
      'diplomacyEvents[0]: expected war_declared from player 2 to player 1 at least 2 time(s), observed 0',
    ]);
  });

  it('rejects inverted ranges and self-referential diplomacy checks', () => {
    expect(() =>
      simulationExpectationSchema.parse({
        minCompletedTurns: 3,
        maxCompletedTurns: 2,
      })
    ).toThrow('minimum must not exceed maximum');
    expect(() =>
      simulationExpectationSchema.parse({
        diplomacy: [{ playerNumber: 1, otherPlayerNumber: 1 }],
      })
    ).toThrow('must reference a different player');
  });
});
