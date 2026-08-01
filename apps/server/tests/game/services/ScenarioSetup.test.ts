import { hasCustomScenarioInitialState, scenarioSetupSchema } from '@game/services/ScenarioSetup';

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
});
