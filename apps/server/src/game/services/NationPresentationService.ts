/**
 * @module server/game/services/NationPresentationService
 * Provides the server-side Nation Presentation Service service.
 */
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

/**
 * Resolve the sprite graphic suffix used by the active Amplio2 client.
 *
 * Player state stores a ruleset nation id (for example, `roman`), while the
 * tileset stores the corresponding flag graphic (for example, `rome`). Keep
 * this conversion on the authoritative side so every client uses the same
 * presentation identity.
 */
export function resolveNationGraphic(
  nationId: unknown,
  rulesetName: string = 'classic'
): string | undefined {
  if (typeof nationId !== 'string' || nationId.length === 0) return undefined;

  try {
    const flag = rulesetLoader.getNation(nationId, rulesetName).flag;
    if (typeof flag === 'string' && flag.length > 0) {
      return flag.startsWith('f.') ? flag.slice(2) : flag;
    }
  } catch {
    // Older saved games may contain a legacy graphic suffix instead of a
    // current ruleset nation id. Preserve that value as the best fallback.
  }

  return nationId.startsWith('f.') ? nationId.slice(2) : nationId;
}
