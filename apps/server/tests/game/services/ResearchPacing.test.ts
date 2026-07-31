import {
  DEFAULT_RESEARCH_PACING,
  researchPacingFromGameState,
  resolveResearchPacingSettings,
} from '@game/services/ResearchPacing';

describe('ResearchPacing', () => {
  it('uses Freeciv defaults when the ruleset has no override', () => {
    expect(resolveResearchPacingSettings('civ2civ3')).toEqual(DEFAULT_RESEARCH_PACING);
  });

  it('loads converted ruleset overrides', () => {
    expect(resolveResearchPacingSettings('civ2')).toMatchObject({ scienceBox: 50 });
    expect(resolveResearchPacingSettings('multiplayer')).toMatchObject({ techPenalty: 0 });
  });

  it('prefers and bounds persisted per-game settings', () => {
    expect(
      researchPacingFromGameState('civ2', {
        researchPacing: { scienceBox: 20_000, techPenalty: -4 },
      })
    ).toEqual({ scienceBox: 10_000, techPenalty: 0 });
  });
});
