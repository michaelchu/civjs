/**
 * @module client/utils/cityNames Return the first unused city name from a nation's ruleset catalogue. */
export function getNextNationCityName(
  cityNames: string[] | undefined,
  usedNames: Iterable<string>
): string | undefined {
  const used = new Set([...usedNames].map(name => name.trim().toLowerCase()));

  return cityNames
    ?.map(name => name.split(' (')[0]?.trim())
    .find(name => Boolean(name) && !used.has(name.toLowerCase()));
}
