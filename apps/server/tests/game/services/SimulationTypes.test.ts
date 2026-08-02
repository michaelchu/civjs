import { headlessSimulationConfigSchema } from '@game/services/SimulationTypes';

describe('headless simulation configuration', () => {
  it('normalizes the bounded AI-only configuration shape', () => {
    expect(
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 2,
        randomSeed: 42,
        mapSeed: 'map-42',
        maxTurns: 12,
      })
    ).toEqual(
      expect.objectContaining({
        aiPlayerCount: 2,
        maxTurns: 12,
        mapWidth: 80,
        mapHeight: 50,
        ruleset: 'civ2civ3',
        aiLevel: 'easy',
        victoryConditions: ['max_turns'],
        terrainSettings: expect.objectContaining({ generator: 'random' }),
      })
    );
  });

  it('rejects a one-player or unbounded simulation', () => {
    expect(() =>
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 1,
        randomSeed: 1,
        mapSeed: 'map',
        maxTurns: 0,
      })
    ).toThrow();
    expect(() =>
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 2,
        randomSeed: 1,
        mapSeed: 'map',
        maxTurns: 100_001,
      })
    ).toThrow();
  });

  it('requires validated deterministic seeds', () => {
    expect(() =>
      headlessSimulationConfigSchema.parse({ aiPlayerCount: 2, maxTurns: 12 })
    ).toThrow();
    expect(() =>
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 2,
        randomSeed: 0x1_0000_0000,
        mapSeed: ' ',
        maxTurns: 12,
      })
    ).toThrow();
  });

  it('requires a scenario id only for scenario generation', () => {
    const base = { aiPlayerCount: 2, randomSeed: 1, mapSeed: 'map', maxTurns: 12 };
    expect(() =>
      headlessSimulationConfigSchema.parse({
        ...base,
        terrainSettings: { generator: 'scenario' },
      })
    ).toThrow('scenarioId is required');
    expect(
      headlessSimulationConfigSchema.parse({
        ...base,
        terrainSettings: { generator: 'scenario', scenarioId: 'duel' },
      }).terrainSettings.scenarioId
    ).toBe('duel');
  });

  it('normalizes controlled scenario setup state', () => {
    const config = headlessSimulationConfigSchema.parse({
      aiPlayerCount: 2,
      randomSeed: 42,
      mapSeed: 'earth-small-42',
      maxTurns: 20,
      terrainSettings: { generator: 'scenario', scenarioId: 'earth-small' },
      scenarioSetup: {
        initialTurn: 12,
        initialYear: -3989,
        replaceDefaultStartingUnits: true,
        players: [{ playerNumber: 1, technologies: ['alphabet'] }],
        diplomacy: [{ playerNumber: 1, otherPlayerNumber: 2, state: 'war' }],
      },
    });

    expect(config.scenarioSetup).toEqual(
      expect.objectContaining({
        initialTurn: 12,
        initialYear: -3989,
        replaceDefaultStartingUnits: true,
      })
    );
    expect(config.scenarioSetup?.diplomacy).toEqual([
      expect.objectContaining({
        playerNumber: 1,
        otherPlayerNumber: 2,
        state: 'war',
      }),
    ]);
  });

  it('rejects zero-based scenario player references', () => {
    expect(() =>
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 2,
        randomSeed: 42,
        mapSeed: 'earth-small-42',
        maxTurns: 20,
        terrainSettings: { generator: 'scenario', scenarioId: 'earth-small' },
        scenarioSetup: { players: [{ playerNumber: 0 }] },
      })
    ).toThrow();
  });

  it('normalizes declarative gameplay outcome expectations', () => {
    const config = headlessSimulationConfigSchema.parse({
      aiPlayerCount: 2,
      randomSeed: 42,
      mapSeed: 'earth-small-42',
      maxTurns: 20,
      expect: {
        minCompletedTurns: 10,
        diplomacy: [{ playerNumber: 1, otherPlayerNumber: 2, state: 'war' }],
        diplomacyEvents: [{ type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2 }],
      },
    });

    expect(config.expect).toEqual({
      minCompletedTurns: 10,
      players: [],
      cities: [],
      diplomacy: [{ playerNumber: 1, otherPlayerNumber: 2, state: 'war' }],
      diplomacyEvents: [
        { type: 'war_declared', playerNumber: 1, otherPlayerNumber: 2, minCount: 1 },
      ],
      events: [],
    });
  });
});
