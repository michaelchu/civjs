import { createAIProfile, type AIProfile } from '@game/ai/AIProfile';
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
 * Stateless decision randomness keyed by game identity and decision identity.
 * Adding an unrelated AI decision cannot shift later outcomes. Deterministic
 * benchmark/replay scenarios can provide an explicit stable decision seed.
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

function createAIDecisionSeed(game: GameInstance, playerId: string, domain: string): string {
  const player = game.players.get(playerId);
  const mapSeed = game.mapManager.getMapData?.()?.seed ?? game.id;
  // Some callers (notably lightweight simulations and migration-era saves)
  // provide a partial GameInstance without the optional runtime config.
  const configuredSeed = game.config?.aiDecisionSeed;
  const decisionSeed = configuredSeed ?? game.id;
  const playerSeed = configuredSeed ? (player?.playerNumber ?? playerId) : playerId;
  return `${mapSeed}:${decisionSeed}:${game.currentTurn}:${playerSeed}:${domain}`;
}

export function createAIDecisionSource(
  game: GameInstance,
  playerId: string,
  domain: string
): FreecivAIDecisionSource {
  const player = game.players.get(playerId);
  return new FreecivAIDecisionSource(
    createAIDecisionSeed(game, playerId, domain),
    createAIProfile(player?.aiLevel, player?.aiTraits)
  );
}
