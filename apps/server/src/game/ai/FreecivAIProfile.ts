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
  ],
} satisfies Record<AILevel, AIHandicap[]>;

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
  return {
    level,
    fuzzy: level === 'restricted' || level === 'novice' ? 400 : level === 'easy' ? 300 : 0,
    expansion:
      level === 'away'
        ? 0
        : level === 'restricted' || level === 'novice' || level === 'easy'
          ? 10
          : 100,
    scienceCost: level === 'restricted' || level === 'novice' ? 250 : 100,
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
