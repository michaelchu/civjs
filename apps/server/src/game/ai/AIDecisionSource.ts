import { createAIProfile, type AIProfile } from '@game/ai/AIProfile';
import type { GameInstance } from '@game/managers/GameManager';
import { type IntegerRandomSource } from '@game/random/FreecivRandom';

const MAX_UINT32 = 0xffff_ffff;

/**
 * Freeciv's ai_fuzzy() occasionally flips a decision according to the
 * difficulty's 0..1000 fuzziness.
 *
 * @reference reference/freeciv/ai/difficulty.c:318-351
 */
export function applyAIFuzziness(
  profile: Pick<AIProfile, 'fuzzy'>,
  sample: number,
  normalDecision: boolean
): boolean {
  if (profile.fuzzy === 0) return normalDecision;
  return sample * 1000 < profile.fuzzy ? !normalDecision : normalDecision;
}

/**
 * AI decisions consume the game's shared authoritative stream, matching
 * Freeciv's ai_fuzzy()/fc_rand() call-order semantics.
 */
export class FreecivAIDecisionSource {
  constructor(
    private readonly random: IntegerRandomSource,
    readonly profile: AIProfile
  ) {}

  sample(_key: string): number {
    return this.random.next(MAX_UINT32) / MAX_UINT32;
  }

  fuzzy(_key: string, normalDecision: boolean): boolean {
    if (this.profile.fuzzy === 0) return normalDecision;
    return this.random.next(1000) < this.profile.fuzzy ? !normalDecision : normalDecision;
  }
}

export function createAIDecisionSource(
  game: GameInstance,
  playerId: string,
  _domain: string
): FreecivAIDecisionSource {
  const player = game.players.get(playerId);
  if (!game.random) throw new Error(`Game ${game.id} has no authoritative random source`);
  return new FreecivAIDecisionSource(
    game.random,
    createAIProfile(player?.aiLevel, player?.aiTraits)
  );
}
