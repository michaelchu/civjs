export const AI_LEVELS = [
  'restricted',
  'novice',
  'easy',
  'normal',
  'hard',
  'cheating',
  'away',
] as const;

export type AILevel = (typeof AI_LEVELS)[number];

/**
 * Freeciv's "away" profile is an internal temporary mode, not a difficulty a
 * game creator can assign to an AI player.
 *
 * @reference reference/freeciv/server/settings.c (SSET_AI_LEVEL)
 * @reference reference/freeciv/server/commands.c (set_ai_level_direct)
 */
export const SETTABLE_AI_LEVELS = [
  'restricted',
  'novice',
  'easy',
  'normal',
  'hard',
  'cheating',
] as const;
export type SettableAILevel = (typeof SETTABLE_AI_LEVELS)[number];

export interface AITraits {
  expansionist: number;
  trader: number;
  aggressive: number;
  builder: number;
}

export type AIHandicap =
  | 'away'
  | 'fog'
  | 'map'
  | 'rates'
  | 'targets'
  | 'huts'
  | 'no_planes'
  | 'diplomat'
  | 'limited_huts'
  | 'defensive'
  | 'diplomacy'
  | 'revolution'
  | 'expansion'
  | 'danger'
  | 'assess_danger_limited'
  | 'ceasefire'
  | 'no_bribe_war_footing'
  | 'production_change_penalty';

export interface AIProfile {
  level: AILevel;
  fuzzy: number;
  expansion: number;
  scienceCost: number;
  handicaps: ReadonlySet<AIHandicap>;
  traits: AITraits;
}

const HANDICAPS = {
  restricted: [
    'rates',
    'targets',
    'huts',
    'no_planes',
    'diplomat',
    'limited_huts',
    'defensive',
    'diplomacy',
    'revolution',
    'expansion',
    'danger',
    'assess_danger_limited',
    'ceasefire',
    'no_bribe_war_footing',
    'production_change_penalty',
  ],
  novice: [
    'rates',
    'targets',
    'huts',
    'no_planes',
    'diplomat',
    'limited_huts',
    'defensive',
    'diplomacy',
    'revolution',
    'expansion',
    'danger',
    'assess_danger_limited',
    'ceasefire',
    'no_bribe_war_footing',
    'production_change_penalty',
  ],
  easy: [
    'rates',
    'targets',
    'huts',
    'no_planes',
    'diplomat',
    'limited_huts',
    'defensive',
    'diplomacy',
    'revolution',
    'expansion',
    'assess_danger_limited',
    'ceasefire',
    'no_bribe_war_footing',
  ],
  normal: ['rates', 'targets', 'huts', 'diplomat', 'ceasefire', 'no_bribe_war_footing'],
  hard: ['rates'],
  cheating: ['rates'],
  away: [
    'away',
    'fog',
    'map',
    'rates',
    'targets',
    'huts',
    'revolution',
    'production_change_penalty',
    'assess_danger_limited',
  ],
} satisfies Record<AILevel, AIHandicap[]>;

const DIFFICULTY_PARAMETERS: Record<
  AILevel,
  Pick<AIProfile, 'fuzzy' | 'expansion' | 'scienceCost'>
> = {
  restricted: { fuzzy: 400, expansion: 10, scienceCost: 250 },
  novice: { fuzzy: 400, expansion: 10, scienceCost: 250 },
  easy: { fuzzy: 300, expansion: 10, scienceCost: 100 },
  normal: { fuzzy: 0, expansion: 100, scienceCost: 100 },
  hard: { fuzzy: 0, expansion: 100, scienceCost: 100 },
  cheating: { fuzzy: 0, expansion: 100, scienceCost: 100 },
  away: { fuzzy: 0, expansion: 0, scienceCost: 100 },
};

/**
 * Freeciv difficulty parameters. Ruleset bonuses for Restricted/Cheating are
 * applied by normal effects evaluation, not directly in this profile.
 *
 * @reference reference/freeciv/ai/difficulty.c
 * @reference reference/freeciv/ai/handicaps.c
 */
export function createAIProfile(
  level: AILevel = 'easy',
  traits: AITraits = {
    expansionist: 50,
    trader: 50,
    aggressive: 50,
    builder: 50,
  }
): AIProfile {
  const parameters = DIFFICULTY_PARAMETERS[level];
  return {
    level,
    ...parameters,
    handicaps: new Set(HANDICAPS[level]),
    traits: {
      expansionist: clampTrait(traits.expansionist),
      trader: clampTrait(traits.trader),
      aggressive: clampTrait(traits.aggressive),
      builder: clampTrait(traits.builder),
    },
  };
}

function clampTrait(value: number): number {
  return Math.max(0, Math.min(2500, Math.round(value)));
}

export function isAILevel(value: unknown): value is AILevel {
  return typeof value === 'string' && (AI_LEVELS as readonly string[]).includes(value);
}

export function isSettableAILevel(value: unknown): value is SettableAILevel {
  return typeof value === 'string' && (SETTABLE_AI_LEVELS as readonly string[]).includes(value);
}
