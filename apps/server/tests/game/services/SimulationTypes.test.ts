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
});
