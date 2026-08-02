/**
 * @module server/game/services/ResourceVisibilityService
 * Provides the server-side Resource Visibility Service service.
 */
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, ' ');

/**
 * Resolve whether a resource may be disclosed to a player.
 *
 * Resource placement and yields remain authoritative on the server. This
 * helper only controls whether the resource identity is included in a
 * player-specific map packet.
 */
export function isResourceRevealed(
  resource: string | undefined,
  researchedTechs: ReadonlySet<string>,
  rulesetName: string,
  loader: Pick<RulesetLoader, 'getResource'> = rulesetLoader
): boolean {
  if (!resource) return true;

  let definition;
  try {
    definition = loader.getResource(resource, rulesetName);
  } catch {
    // Preserve compatibility with older/custom maps containing resources
    // that are not declared in the selected ruleset.
    return true;
  }

  if (!definition.reveal_tech) return true;

  const knownTechs = new Set([...researchedTechs].map(normalize));
  return knownTechs.has(normalize(definition.reveal_tech));
}

export function visibleResourceForPlayer(
  resource: string | undefined,
  researchedTechs: ReadonlySet<string>,
  rulesetName: string,
  loader: Pick<RulesetLoader, 'getResource'> = rulesetLoader
): string | undefined {
  return isResourceRevealed(resource, researchedTechs, rulesetName, loader) ? resource : undefined;
}
