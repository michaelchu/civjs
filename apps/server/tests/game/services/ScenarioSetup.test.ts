import {
  hasCustomScenarioInitialState,
  scenarioSetupSchema,
} from '@game/simulation/config/ScenarioSetup';

describe('scenario setup', () => {
  it('distinguishes default starting units from controlled initial state', () => {
    const defaultSetup = scenarioSetupSchema.parse({});
    expect(hasCustomScenarioInitialState(defaultSetup)).toBe(false);
    expect(
      hasCustomScenarioInitialState(
        scenarioSetupSchema.parse({ replaceDefaultStartingUnits: true })
      )
    ).toBe(true);
    expect(
      hasCustomScenarioInitialState(
        scenarioSetupSchema.parse({ cities: [{ playerNumber: 1, name: 'Alpha', x: 15, y: 18 }] })
      )
    ).toBe(true);
  });

  it('requires the runtime player-number contract', () => {
    expect(() => scenarioSetupSchema.parse({ players: [{ playerNumber: 0 }] })).toThrow();
    expect(scenarioSetupSchema.parse({ players: [{ playerNumber: 1 }] }).players).toEqual([
      { playerNumber: 1 },
    ]);
  });

  it('normalizes deterministic AI diplomacy memory seeds', () => {
    expect(
      scenarioSetupSchema.parse({
        aiDiplomacy: [{ playerNumber: 1, otherPlayerNumber: 2, warDesire: 500 }],
      }).aiDiplomacy
    ).toEqual([
      {
        playerNumber: 1,
        otherPlayerNumber: 2,
        love: 0,
        warDesire: 500,
        countdown: 0,
      },
    ]);
  });

  it('preserves scenario economic-rate locks for deterministic UAT runs', () => {
    expect(
      scenarioSetupSchema.parse({
        players: [{ playerNumber: 1, luxuryRate: 100, lockEconomicRates: true }],
      }).players
    ).toEqual([{ playerNumber: 1, luxuryRate: 100, lockEconomicRates: true }]);
  });
});
