import { RequirementsManager } from '@game/managers/RequirementsManager';

describe('RequirementsManager ruleset culture requirements', () => {
  const cultureManager = {
    getCityCultureInfo: jest.fn(),
    getPlayerCultureInfo: jest.fn(),
  } as any;

  const manager = new RequirementsManager(cultureManager);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('evaluates city culture requirements from ruleset data', async () => {
    cultureManager.getCityCultureInfo.mockResolvedValue({ culture: 99 });

    await expect(
      manager.evaluateRulesetCultureRequirements(
        [{ type: 'MinCulture', value: 100, range: 'City', present: true }],
        { cityId: 'city-1', playerId: 'player-1' }
      )
    ).resolves.toEqual(
      expect.objectContaining({ satisfied: false, reason: 'requires minimum 100 culture' })
    );
  });

  it('evaluates player culture requirements from ruleset data', async () => {
    cultureManager.getPlayerCultureInfo.mockResolvedValue({ totalCulture: 125 });

    await expect(
      manager.evaluateRulesetCultureRequirements(
        [{ type: 'MinCulture', value: 100, range: 'Player', present: true }],
        { cityId: 'city-1', playerId: 'player-1' }
      )
    ).resolves.toEqual({ satisfied: true });
  });
});
