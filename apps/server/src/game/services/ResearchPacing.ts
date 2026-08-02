/**
 * @module server/game/services/ResearchPacing
 * Provides the server-side Research Pacing service.
 */
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface ResearchPacingSettings {
  /** Freeciv's percentage multiplier applied to every technology cost. */
  scienceBox: number;
  /** Percentage of non-free bulbs lost when changing the current technology. */
  techPenalty: number;
}

export const DEFAULT_RESEARCH_PACING: ResearchPacingSettings = {
  scienceBox: 100,
  techPenalty: 100,
};

function numericSetting(
  loader: RulesetLoader,
  rulesetName: string,
  settingName: string
): number | undefined {
  const configured = loader.loadGameRulesRuleset(rulesetName).settings.set;
  if (!Array.isArray(configured)) return undefined;
  const setting = configured.find(
    candidate =>
      candidate !== null &&
      typeof candidate === 'object' &&
      (candidate as { name?: unknown }).name === settingName
  ) as { value?: unknown } | undefined;
  return typeof setting?.value === 'number' && Number.isFinite(setting.value)
    ? setting.value
    : undefined;
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value ?? fallback)));
}

/** Resolve Freeciv server defaults, ruleset overrides, then per-game overrides. */
export function resolveResearchPacingSettings(
  rulesetName: string,
  overrides: Partial<ResearchPacingSettings> = {},
  loader: RulesetLoader = rulesetLoader
): ResearchPacingSettings {
  const rulesetScienceBox = numericSetting(loader, rulesetName, 'sciencebox');
  const rulesetTechPenalty = numericSetting(loader, rulesetName, 'techpenalty');
  return {
    scienceBox: boundedInteger(
      overrides.scienceBox,
      rulesetScienceBox ?? DEFAULT_RESEARCH_PACING.scienceBox,
      1,
      10_000
    ),
    techPenalty: boundedInteger(
      overrides.techPenalty,
      rulesetTechPenalty ?? DEFAULT_RESEARCH_PACING.techPenalty,
      0,
      100
    ),
  };
}

export function researchPacingFromGameState(
  rulesetName: string,
  gameState: unknown
): ResearchPacingSettings {
  const configured =
    gameState && typeof gameState === 'object'
      ? (gameState as { researchPacing?: Partial<ResearchPacingSettings> }).researchPacing
      : undefined;
  return resolveResearchPacingSettings(rulesetName, configured);
}
