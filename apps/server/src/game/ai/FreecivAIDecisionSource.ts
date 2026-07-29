import { createAIProfile, type AIProfile } from '@game/ai/FreecivAIProfile';
import type { GameInstance } from '@game/managers/GameManager';

const UINT32_RANGE = 0x1_0000_0000;

function hashDecision(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Freeciv's ai_fuzzy() occasionally flips a decision according to the
 * difficulty's 0..1000 fuzziness. The sample is explicit so tests and replay
 * do not depend on global random-call ordering.
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
 * Stateless decision randomness keyed by native game identity and decision
 * identity. Adding an unrelated AI decision cannot shift later outcomes.
 */
export class FreecivAIDecisionSource {
  constructor(
    private readonly seed: string,
    readonly profile: AIProfile
  ) {}

  sample(key: string): number {
    return hashDecision(`${this.seed}:${key}`) / UINT32_RANGE;
  }

  fuzzy(key: string, normalDecision: boolean): boolean {
    return applyAIFuzziness(this.profile, this.sample(key), normalDecision);
  }
}

export function createAIDecisionSource(
  game: GameInstance,
  playerId: string,
  domain: string
): FreecivAIDecisionSource {
  const player = game.players.get(playerId);
  const mapSeed = game.mapManager.getMapData?.()?.seed ?? game.id;
  return new FreecivAIDecisionSource(
    `${mapSeed}:${game.id}:${game.currentTurn}:${playerId}:${domain}`,
    createAIProfile(player?.aiLevel, player?.aiTraits)
  );
}
