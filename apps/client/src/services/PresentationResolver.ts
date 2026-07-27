import type {
  CityStyle,
  GraphicDefinition,
  MusicStyle,
  NationStyle,
  RulesetRequirement,
} from './RulesetService';

const normalize = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, ' ');

const requirementMatches = (
  requirement: RulesetRequirement,
  nationStyle: string,
  researchedTechs: ReadonlySet<string>
): boolean => {
  const type = normalize(requirement.type);
  const name = normalize(requirement.name);
  const present = requirement.present !== false;
  if (type !== 'style' && type !== 'tech') return false;
  let matches = false;

  if (type === 'style') {
    matches = normalize(nationStyle) === name;
  } else if (type === 'tech') {
    matches = [...researchedTechs].some(tech => normalize(tech) === name);
  }

  return present ? matches : !matches;
};

const requirementsMatch = (
  requirements: RulesetRequirement[] | undefined,
  nationStyle: string,
  researchedTechs: ReadonlySet<string>
): boolean =>
  (requirements ?? []).every(requirement =>
    requirementMatches(requirement, nationStyle, researchedTechs)
  );

export const resolveNationStyleName = (
  requestedStyle: string | undefined,
  styles: Record<string, NationStyle>
): string => {
  if (!requestedStyle) return '';
  const normalizedRequested = normalize(requestedStyle);
  const legacyNationAliases: Record<string, string> = {
    african: 'Tropical',
    american: 'European',
    'middle eastern': 'Babylonian',
  };
  const aliasedRequested = normalize(legacyNationAliases[normalizedRequested] ?? requestedStyle);
  const match = Object.values(styles).find(
    style =>
      normalize(style.name) === aliasedRequested ||
      (style.rule_name ? normalize(style.rule_name) === aliasedRequested : false)
  );
  return match?.name ?? requestedStyle;
};

export const resolveCityGraphic = ({
  requestedNationStyle,
  nationStyles,
  cityStyles,
  researchedTechs = new Set<string>(),
}: {
  requestedNationStyle?: string;
  nationStyles: Record<string, NationStyle>;
  cityStyles: Record<string, CityStyle>;
  researchedTechs?: ReadonlySet<string>;
}): string => {
  const nationStyle = resolveNationStyleName(requestedNationStyle, nationStyles);
  const eligible = Object.values(cityStyles).filter(style =>
    requirementsMatch(style.reqs, nationStyle, researchedTechs)
  );
  return eligible.at(-1)?.graphic || 'city.european';
};

export const resolveMusicStyle = ({
  requestedNationStyle,
  nationStyles,
  musicStyles,
  researchedTechs = new Set<string>(),
  combat = false,
}: {
  requestedNationStyle?: string;
  nationStyles: Record<string, NationStyle>;
  musicStyles: Record<string, MusicStyle>;
  researchedTechs?: ReadonlySet<string>;
  combat?: boolean;
}): string | null => {
  const nationStyle = resolveNationStyleName(requestedNationStyle, nationStyles);
  const eligible = Object.values(musicStyles).filter(style =>
    requirementsMatch(style.reqs, nationStyle, researchedTechs)
  );
  const selected = eligible.at(-1);
  return selected ? (combat ? selected.music_combat : selected.music_peaceful) : null;
};

export const resolveGraphic = (
  definition: GraphicDefinition | undefined,
  isAvailable?: (tag: string) => boolean
): string | null => {
  for (const candidate of [
    definition?.graphic,
    definition?.graphic_alt,
    definition?.graphic_alt2,
  ]) {
    if (candidate && candidate !== '-' && (!isAvailable || isAvailable(candidate))) {
      return candidate;
    }
  }
  return null;
};
