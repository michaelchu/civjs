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
const scheduled = (
  family: string,
  milestone: number,
  rationale: string
): ClassicActionCoverage => ({
  disposition: 'scheduled',
  family,
  milestone,
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
  'Enter Marketplace': scheduled('caravan-alternatives', 14, 'Marketplace outcome is not ported'),
  'Help Wonder': scheduled('caravan-alternatives', 14, 'Wonder contribution is not ported'),
  'Disband Unit Recover': scheduled(
    'unit-management',
    14,
    'Shield-recovery disband variant is not ported'
  ),
  'Disband Unit': implemented('unit-management', 'Authoritative disband command'),
  'Found City': implemented('city', 'Authoritative city founding'),
  'Join City': scheduled('city-unit-actions', 14, 'Population join outcome is not ported'),
  'Explode Nuclear': scheduled('nuclear-combat', 15, 'Nuclear explosion is not ported'),
  'Nuke City': scheduled('nuclear-combat', 15, 'City nuclear outcome is not ported'),
  'Nuke Units': scheduled('nuclear-combat', 15, 'Stack nuclear outcome is not ported'),
  Attack: implemented('combat', 'Authoritative unit combat'),
  'Collect Ransom': scheduled('combat-alternatives', 15, 'Ransom reward is not ported'),
  'Suicide Attack': scheduled('combat-alternatives', 15, 'Forced actor consumption is not ported'),
  'Conquer City Shrink': engineResolved('city-capture', 'Resolved by authoritative city capture'),
  'Conquer City Shrink 2': engineResolved('city-capture', 'Non-native capture variant'),
  'Home City': scheduled('unit-management', 14, 'Home-city reassignment is not ported'),
  'Paradrop Unit Enter': implemented('paradrop', 'Milestone 11 paradrop command'),
  'Paradrop Unit Enter Conquer': implemented('paradrop', 'Milestone 11 contested paradrop'),
  'Upgrade Unit': scheduled('unit-management', 14, 'Unit upgrade is not ported'),
  'Airlift Unit': implemented('airlift', 'Milestone 11 persisted airport airlift'),
  'Transform Terrain': implemented('worker', 'Authoritative transform activity'),
  Cultivate: scheduled('worker-extras', 14, 'Cultivate terrain outcome is not ported'),
  Plant: scheduled('worker-extras', 14, 'Plant terrain outcome is not ported'),
  Pillage: implemented('worker', 'Authoritative pillage activity'),
  Clean: implemented('worker', 'Authoritative pollution cleanup activity'),
  Fortify: implemented('unit-state', 'Authoritative fortify command'),
  'Build Road': implemented('worker', 'Authoritative road activity'),
  'Build Base': scheduled('worker-extras', 14, 'Fortress and airbase construction is not ported'),
  'Build Mine': implemented('worker', 'Authoritative mine activity'),
  'Build Irrigation': implemented('worker', 'Authoritative irrigation activity'),
  'Transport Deboard': implemented('transport', 'Authoritative unload command'),
  'Transport Board': implemented('transport', 'Authoritative load command'),
  'Transport Unload': implemented('transport', 'Authoritative unload command'),
  'Transport Disembark': implemented('transport', 'Authoritative unload command'),
  'Transport Disembark 2': implemented('transport', 'Non-native unload validation'),
  'Transport Embark': implemented('transport', 'Authoritative load command'),
  'Unit Move': implemented('movement', 'Authoritative path and movement command'),
  'Enter Hut': scheduled('huts-and-extras', 15, 'Goody-hut entry outcome is not ported'),
  'Enter Hut 2': scheduled('huts-and-extras', 15, 'Non-native hut entry is not ported'),
  'Frighten Hut': scheduled('huts-and-extras', 15, 'Hut frighten outcome is not ported'),
  'Frighten Hut 2': scheduled('huts-and-extras', 15, 'Non-native hut frighten is not ported'),
  'Conquer Extras': scheduled('huts-and-extras', 15, 'Extra ownership conquest is not ported'),
  'Conquer Extras 2': scheduled('huts-and-extras', 15, 'Non-native extra conquest is not ported'),
  'Gain Veterancy': engineResolved('combat', 'Veterancy is awarded by combat resolution'),
  'Civil War': scheduled('player-events', 15, 'Civil-war action consequence is not ported'),
  'Finish Unit': engineResolved('production', 'Resolved by city production completion'),
  'Finish Building': engineResolved('production', 'Resolved by city production completion'),
};
