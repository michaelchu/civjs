import { headlessSimulationConfigSchema } from '@game/services/SimulationTypes';

describe('headless simulation configuration', () => {
  it('normalizes the bounded AI-only configuration shape', () => {
    expect(
      headlessSimulationConfigSchema.parse({
        aiPlayerCount: 2,
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
    expect(() => headlessSimulationConfigSchema.parse({ aiPlayerCount: 1, maxTurns: 0 })).toThrow();
    expect(() =>
      headlessSimulationConfigSchema.parse({ aiPlayerCount: 2, maxTurns: 100_001 })
    ).toThrow();
  });
});
