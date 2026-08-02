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
        events: [{ type: 'phase_end', data: { phase: 'research' } }],
      })
    ).toEqual({
      players: [{ playerNumber: 1, minCities: 1 }],
      diplomacy: [],
      diplomacyEvents: [
        { type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2, minCount: 1 },
      ],
      events: [{ type: 'phase_end', data: { phase: 'research' }, minCount: 1 }],
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
        events: [{ type: 'city_production_complete', data: { result: { kind: 'unit' } } }],
      }),
      {
        completedTurns: [
          { turn: 1, snapshot: { ...snapshot(), diplomacyEvents: [] } },
          {
            turn: 4,
            snapshot: snapshot(),
            events: [
              {
                eventType: 'city_production_complete',
                playerId: playerOneId,
                relatedPlayerId: playerTwoId,
                eventData: {
                  turn: 4,
                  result: { kind: 'unit', value: 'warriors' },
                },
              },
            ],
          },
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
        events: [
          { type: 'phase_end', data: { phase: 'research' }, minCount: 2 },
          {
            type: 'phase_end',
            data: { phase: 'research' },
            minCount: 0,
            maxCount: 0,
          },
        ],
      }),
      {
        completedTurns: [
          {
            turn: 4,
            snapshot: snapshot(),
            events: [
              {
                eventType: 'phase_end',
                eventData: { turn: 4, phase: 'research', success: true },
              },
            ],
          },
        ],
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
      'events[0]: expected phase_end at least 2 time(s), observed 1',
      'events[1]: expected phase_end at most 0 time(s), observed 1',
    ]);
  });

  it('matches generic replay events by turn, players, and nested data', () => {
    const result = evaluateSimulationExpectations(
      simulationExpectationSchema.parse({
        events: [
          {
            type: 'city_production_complete',
            turn: 4,
            playerNumber: 1,
            otherPlayerNumber: 2,
            data: { result: { kind: 'unit' } },
          },
        ],
      }),
      {
        completedTurns: [
          {
            turn: 4,
            snapshot: snapshot(),
            events: [
              {
                eventType: 'city_production_complete',
                playerId: playerOneId,
                relatedPlayerId: playerTwoId,
                eventData: {
                  turn: 4,
                  result: { kind: 'unit', value: 'warriors' },
                },
              },
            ],
          },
        ],
        endReason: 'max_turns',
        standings: [],
      }
    );

    expect(result).toEqual({ passed: true, failures: [] });
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
    expect(() =>
      simulationExpectationSchema.parse({
        events: [{ type: 'phase_end', minTurn: 4, maxTurn: 3 }],
      })
    ).toThrow('minimum must not exceed maximum');
  });
});
