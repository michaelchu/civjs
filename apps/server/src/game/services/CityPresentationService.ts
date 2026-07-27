import type { CityState } from '@game/managers/CityManager';
import type { PlayerState } from '@game/managers/GameManager';
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
  rulesetName: string = 'classic',
  loader: PresentationRuleset = rulesetLoader
): CityPresentation {
  let nationStyle = 'European';
  if (player?.civilization) {
    try {
      nationStyle = loader.getNation(player.civilization, rulesetName).style;
    } catch {
      // Recovered legacy games can contain a display name instead of a nation
      // id. Treat that value as a style only as a compatibility fallback.
      nationStyle = player.civilization;
    }
  }

  const normalizedStyle = normalizeNationStyle(nationStyle);
  const normalizedTechs = new Set([...researchedTechs].map(normalize));
  const styles = Object.values(loader.getRulesetCityStyles(rulesetName));
  const eligible = styles.filter(style =>
    (style.reqs ?? []).every(requirement => {
      const type = normalize(requirement.type);
      const name = normalize(requirement.name);
      const present = requirement.present !== false;
      const matches =
        type === 'style'
          ? normalizedStyle === normalizeNationStyle(requirement.name)
          : type === 'tech'
            ? normalizedTechs.has(name)
            : false;
      return present ? matches : !matches;
    })
  );
  const selected = eligible.at(-1);
  const buildings = new Set(city.buildings);
  const overlays: string[] = [];

  if (buildings.has('coastal_defense')) {
    overlays.push('city.coastal_underlay', 'city.coastal_overlay');
  }
  if (buildings.has('sam_battery')) {
    overlays.push('city.sam_overlay');
  }
  if (buildings.has('pyramids')) {
    overlays.push('city.pyramid_overlay');
  }
  if (buildings.has('hanging_gardens')) {
    overlays.push('city.hgarden_overlay');
  }

  return {
    graphic: selected?.graphic ?? 'city.european',
    graphicAlt:
      selected?.graphic_alt && selected.graphic_alt !== '-' ? selected.graphic_alt : undefined,
    hasWalls: buildings.has('walls'),
    overlays,
  };
}

export function resolveCityPresentations(
  cities: CityState[],
  players: ReadonlyMap<string, PlayerState>,
  getResearchedTechs: (playerId: string) => string[],
  rulesetName: string = 'classic'
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
