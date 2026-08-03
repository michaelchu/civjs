import {
  DEFAULT_RESEARCH_PACING,
  researchPacingFromGameState,
  resolveResearchPacingSettings,
} from '@game/services/ResearchPacing';

describe('ResearchPacing', () => {
  it('uses Freeciv defaults when the ruleset has no override', () => {
    expect(resolveResearchPacingSettings('civ2civ3')).toEqual(DEFAULT_RESEARCH_PACING);
  });

  it('rejects unsupported rulesets', () => {
    expect(() => resolveResearchPacingSettings('not-a-ruleset')).toThrow(
      "Unsupported ruleset 'not-a-ruleset'. CivJS supports only 'civ2civ3'."
    );
  });

  it('prefers and bounds persisted per-game settings', () => {
    expect(
      researchPacingFromGameState('civ2civ3', {
        researchPacing: { scienceBox: 20_000, techPenalty: -4, techLeakPct: 301 },
      })
    ).toEqual({ scienceBox: 10_000, techPenalty: 0, techLeakPct: 300 });
  });

  it('accepts the Freeciv tech leakage percentage as a per-game setting', () => {
    expect(resolveResearchPacingSettings('civ2civ3', { techLeakPct: 50 })).toMatchObject({
      techLeakPct: 50,
    });
  });
});
