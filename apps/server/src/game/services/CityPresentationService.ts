/**
 * @module server/game/services/CityPresentationService
 * Provides the server-side City Presentation Service service.
 */
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';
import type { CityState } from '@game/cities/CityTypes';
import type { PlayerState } from '@game/runtime/GameTypes';
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

export interface CityPresentation {
  graphic: string;
  graphicAlt?: string;
  hasWalls: boolean;
  overlays: string[];
}

type PresentationRuleset = Pick<RulesetLoader, 'getNation' | 'getRulesetCityStyles'>;

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, ' ');

const normalizeNationStyle = (style: string): string => {
  const aliases: Record<string, string> = {
    african: 'Tropical',
    american: 'European',
    'middle eastern': 'Babylonian',
  };
  return normalize(aliases[normalize(style)] ?? style);
};

/**
 * Resolve the public presentation state the reference server includes with a
 * city packet. This avoids exposing another player's technology list while
 * still allowing every client to draw the correct city era.
 */
export function resolveCityPresentation(
  city: CityState,
  player: Pick<PlayerState, 'civilization'> | undefined,
  researchedTechs: ReadonlySet<string>,
  rulesetName: string = DEFAULT_RULESET,
  loader: PresentationRuleset = rulesetLoader
): CityPresentation {
  const nationStyle = getNationStyle(player, loader, rulesetName);

  const normalizedStyle = normalizeNationStyle(nationStyle);
  const normalizedTechs = new Set([...researchedTechs].map(normalize));
  const styles = Object.values(loader.getRulesetCityStyles(rulesetName));
  const eligible = styles.filter(style =>
    isCityStyleEligible(style, normalizedStyle, normalizedTechs)
  );
  const selected = eligible.at(-1);
  const buildings = new Set(city.buildings);
  const overlays = getCityOverlays(buildings);

  return {
    graphic: selected?.graphic ?? 'city.european',
    graphicAlt:
      selected?.graphic_alt && selected.graphic_alt !== '-' ? selected.graphic_alt : undefined,
    hasWalls: city.walls === undefined ? buildings.has('city_walls') : city.walls > 0,
    overlays,
  };
}

function getNationStyle(
  player: Pick<PlayerState, 'civilization'> | undefined,
  loader: PresentationRuleset,
  rulesetName: string
): string {
  if (!player?.civilization) return 'European';
  try {
    return loader.getNation(player.civilization, rulesetName).style;
  } catch {
    return player.civilization;
  }
}

function isCityStyleEligible(
  style: any,
  normalizedStyle: string,
  normalizedTechs: Set<string>
): boolean {
  return (style.reqs ?? []).every((requirement: any) => {
    const type = normalize(requirement.type);
    const name = normalize(requirement.name);
    const matches =
      type === 'style'
        ? normalizedStyle === normalizeNationStyle(requirement.name)
        : type === 'tech' && normalizedTechs.has(name);
    return requirement.present === false ? !matches : matches;
  });
}

function getCityOverlays(buildings: Set<string>): string[] {
  const overlays: string[] = [];
  if (buildings.has('coastal_defense'))
    overlays.push('city.coastal_underlay', 'city.coastal_overlay');
  if (buildings.has('sam_battery')) overlays.push('city.sam_overlay');
  if (buildings.has('pyramids')) overlays.push('city.pyramid_overlay');
  if (buildings.has('hanging_gardens')) overlays.push('city.hgarden_overlay');
  return overlays;
}

export function resolveCityPresentations(
  cities: CityState[],
  players: ReadonlyMap<string, PlayerState>,
  getResearchedTechs: (playerId: string) => string[],
  rulesetName: string = DEFAULT_RULESET
): Record<string, CityPresentation> {
  return Object.fromEntries(
    cities.map(city => [
      city.id,
      resolveCityPresentation(
        city,
        players.get(city.playerId),
        new Set(getResearchedTechs(city.playerId)),
        rulesetName
      ),
    ])
  );
}
