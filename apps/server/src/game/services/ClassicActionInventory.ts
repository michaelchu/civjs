export type ClassicActionDisposition =
  | 'implemented'
  | 'engine_resolved'
  | 'scheduled'
  | 'inapplicable';

export interface ClassicActionCoverage {
  disposition: ClassicActionDisposition;
  family: string;
  milestone?: number;
  rationale: string;
}

const implemented = (family: string, rationale: string): ClassicActionCoverage => ({
  disposition: 'implemented',
  family,
  rationale,
});
const engineResolved = (family: string, rationale: string): ClassicActionCoverage => ({
  disposition: 'engine_resolved',
  family,
  rationale,
});
/**
 * Executable accounting for every distinct action referenced by classic
 * actions.ruleset enablers. Alternate Freeciv action names may converge on
 * one CivJS command, but enabled outcomes that are not yet equivalent remain
 * explicitly scheduled rather than silently advertised.
 */
export const CLASSIC_ACTION_COVERAGE: Readonly<Record<string, ClassicActionCoverage>> = {
  'Sabotage City': implemented('espionage', 'Authoritative city sabotage'),
  'Sabotage City Escape': implemented('espionage', 'Spy escape variant converges on sabotage'),
  'Targeted Sabotage City Escape': implemented(
    'espionage',
    'Targeted variant converges on sabotage'
  ),
  'Sabotage City Production Escape': implemented(
    'espionage',
    'Production sabotage clears authoritative production'
  ),
  'Spy Attack': engineResolved('combat', 'Resolved through unit combat'),
  'Establish Embassy Stay': implemented('espionage', 'Embassy command retains spies'),
  'Establish Embassy': implemented('espionage', 'Embassy command consumes diplomats'),
  'Investigate City Spend Unit': implemented('espionage', 'Investigation diplomat variant'),
  'Investigate City': implemented('espionage', 'Investigation spy variant'),
  'Poison City Escape': implemented('espionage', 'Authoritative poison-city command'),
  'Steal Tech': implemented('espionage', 'Authoritative technology theft'),
  'Steal Tech Escape Expected': implemented('espionage', 'Spy theft variant'),
  'Targeted Steal Tech Escape Expected': implemented('espionage', 'Targeted theft variant'),
  'Incite City': implemented('espionage', 'Authoritative incite-city command'),
  'Incite City Escape': implemented('espionage', 'Spy incite variant'),
  'Bribe Unit': implemented('espionage', 'Authoritative unit bribery'),
  'Sabotage Unit Escape': implemented('espionage', 'Authoritative unit sabotage'),
  'Establish Trade Route': implemented('trade', 'Authoritative trade-route command'),
  'Enter Marketplace': implemented('caravan-alternatives', 'Authoritative one-time trade revenue'),
  'Help Wonder': implemented('caravan-alternatives', 'Authoritative Great Wonder contribution'),
  'Disband Unit Recover': implemented('unit-management', 'Authoritative city shield recovery'),
  'Disband Unit': implemented('unit-management', 'Authoritative disband command'),
  'Found City': implemented('city', 'Authoritative city founding'),
  'Join City': implemented('city-unit-actions', 'Authoritative population join outcome'),
  'Explode Nuclear': implemented('nuclear-combat', 'Authoritative ruleset-capable detonation'),
  'Nuke City': implemented('nuclear-combat', 'Nuclear city targeting converges on detonation'),
  'Nuke Units': implemented('nuclear-combat', 'Nuclear stack targeting converges on detonation'),
  Attack: implemented('combat', 'Authoritative unit combat'),
  'Collect Ransom': implemented('combat-alternatives', 'Authoritative barbarian stack ransom'),
  'Suicide Attack': implemented('combat-alternatives', 'Combat always consumes the missile actor'),
  'Conquer City Shrink': engineResolved('city-capture', 'Resolved by authoritative city capture'),
  'Conquer City Shrink 2': engineResolved('city-capture', 'Non-native capture variant'),
  'Home City': implemented('unit-management', 'Persisted home-city reassignment'),
  'Paradrop Unit Enter': implemented('paradrop', 'Milestone 11 paradrop command'),
  'Paradrop Unit Enter Conquer': implemented('paradrop', 'Milestone 11 contested paradrop'),
  'Upgrade Unit': implemented('unit-management', 'Ruleset upgrade chain and treasury cost'),
  'Airlift Unit': implemented('airlift', 'Milestone 11 persisted airport airlift'),
  'Transform Terrain': implemented('worker', 'Authoritative transform activity'),
  Cultivate: implemented('worker-extras', 'Ruleset terrain cultivation activity'),
  Plant: implemented('worker-extras', 'Ruleset terrain planting activity'),
  Pillage: implemented('worker', 'Authoritative pillage activity'),
  Clean: implemented('worker', 'Authoritative pollution cleanup activity'),
  Fortify: implemented('unit-state', 'Authoritative fortify command'),
  'Build Road': implemented('worker', 'Authoritative road activity'),
  'Build Base': implemented('worker-extras', 'Ruleset fortress and airbase activities'),
  'Build Mine': implemented('worker', 'Authoritative mine activity'),
  'Build Irrigation': implemented('worker', 'Authoritative irrigation activity'),
  'Transport Deboard': implemented('transport', 'Authoritative unload command'),
  'Transport Board': implemented('transport', 'Authoritative load command'),
  'Transport Unload': implemented('transport', 'Authoritative unload command'),
  'Transport Disembark': implemented('transport', 'Authoritative unload command'),
  'Transport Disembark 2': implemented('transport', 'Non-native unload validation'),
  'Transport Embark': implemented('transport', 'Authoritative load command'),
  'Unit Move': implemented('movement', 'Authoritative path and movement command'),
  'Enter Hut': engineResolved('huts-and-extras', 'Movement resolves and persists hut rewards'),
  'Enter Hut 2': engineResolved('huts-and-extras', 'Non-native movement uses the same hut outcome'),
  'Frighten Hut': engineResolved('huts-and-extras', 'Movement removes huts without a reward'),
  'Frighten Hut 2': engineResolved('huts-and-extras', 'Non-native frighten uses the same outcome'),
  'Conquer Extras': engineResolved('huts-and-extras', 'Movement claims conquerable tile extras'),
  'Conquer Extras 2': engineResolved(
    'huts-and-extras',
    'Non-native movement uses the same ownership outcome'
  ),
  'Gain Veterancy': engineResolved('combat', 'Veterancy is awarded by combat resolution'),
  'Civil War': {
    disposition: 'inapplicable',
    family: 'player-events',
    rationale:
      'CivJS games use a fixed lobby participant set and do not create mid-game rebel players',
  },
  'Finish Unit': engineResolved('production', 'Resolved by city production completion'),
  'Finish Building': engineResolved('production', 'Resolved by city production completion'),
};
