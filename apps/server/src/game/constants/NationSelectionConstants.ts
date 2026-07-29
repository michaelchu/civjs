/**
 * Nation roster retained for the Civ III–V compatibility set.
 *
 * This is intentionally a selection policy rather than a deletion from the
 * ruleset catalogue, so saved games and ruleset lookups can still resolve
 * nations that are not offered to new players.
 */
export const CIV_3_TO_5_NATION_IDS = new Set([
  'american',
  'arab',
  'aztec',
  'babylonian',
  'chinese',
  'egyptian',
  'english',
  'french',
  'german',
  'greek',
  'indian',
  'inca',
  'iroquois',
  'japanese',
  'mali',
  'mongol',
  'ottoman',
  'persian',
  'roman',
  'russian',
  'spanish',
  'thai',
  'zulu',
]);

export function isCiv3To5Nation(nationId: string): boolean {
  return CIV_3_TO_5_NATION_IDS.has(nationId);
}
