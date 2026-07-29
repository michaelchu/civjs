/** Default names used when an automated player founds a city. */
export const DEFAULT_CITY_NAMES = [
  'New Rome',
  'Alexandria',
  'Byzantium',
  'Carthage',
  'Babylon',
  'Memphis',
  'Thebes',
  'Damascus',
  'Antioch',
  'Palmyra',
  'New Athens',
  'Corinth',
  'Sparta',
  'Troy',
  'Marathon',
  'New York',
  'Boston',
  'Philadelphia',
  'Charleston',
  'Savannah',
] as const;

/**
 * Return a city name that is not already in use in the game.
 * Coordinate-based placeholders are stripped so they never become persisted names.
 */
export function getUniqueCityName(usedNames: Iterable<string>, preferredName?: string): string {
  const used = new Set([...usedNames].map(name => name.trim().toLowerCase()));
  const requested = (preferredName ?? '')
    .trim()
    .replace(/^New City\s*\(\s*-?\d+\s*,\s*-?\d+\s*\)$/i, 'New City');

  if (requested && !used.has(requested.toLowerCase())) return requested;

  const availableName = DEFAULT_CITY_NAMES.find(name => !used.has(name.toLowerCase()));
  if (availableName) return availableName;

  for (let suffix = 2; ; suffix += 1) {
    const fallback = `New City ${suffix}`;
    if (!used.has(fallback.toLowerCase())) return fallback;
  }
}
