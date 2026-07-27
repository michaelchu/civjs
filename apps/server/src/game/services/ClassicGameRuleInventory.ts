export type ClassicGameRuleDisposition = 'implemented' | 'partial' | 'preserved';

export interface ClassicGameRuleCoverage {
  disposition: ClassicGameRuleDisposition;
  consumer: string;
  remaining?: readonly string[];
}

const implemented = (consumer: string): ClassicGameRuleCoverage => ({
  disposition: 'implemented',
  consumer,
});
const preserved = (consumer: string): ClassicGameRuleCoverage => ({
  disposition: 'preserved',
  consumer,
});
const partial = (consumer: string, remaining: readonly string[]): ClassicGameRuleCoverage => ({
  disposition: 'partial',
  consumer,
  remaining,
});

/**
 * Executable accounting for every top-level section converted from
 * classic/game.ruleset. "Preserved" means the section is metadata or is
 * intentionally inert under the values selected by the classic ruleset.
 */
export const CLASSIC_GAME_RULE_COVERAGE: Readonly<Record<string, ClassicGameRuleCoverage>> = {
  source: preserved('ruleset provenance'),
  datafile: preserved('RulesetLoader metadata'),
  ruledit: preserved('ruleset editor metadata'),
  about: preserved('ruleset metadata'),
  capabilities: preserved('scenario compatibility metadata'),
  options: implemented('initial technologies and buildings'),
  tileset: preserved('classic declares no preferred tileset'),
  soundset: preserved('classic declares no preferred soundset'),
  musicset: preserved('classic declares no preferred musicset'),
  civstyle: implemented('city economy, growth, pollution, and center output'),
  game_parameters: partial('actions, upkeep, airlift, and unit lifecycle', [
    'gameloss_style outcomes',
    'paradrop_to_transport',
    'airlift unlimited-capacity exceptions',
  ]),
  wonder_visibility: partial('wonder ownership packets', ['Embassy/Never visibility variants']),
  illness: preserved('classic disables illness'),
  combat_rules: partial('combat, bombardment, and nuclear city damage', [
    'scaled veterancy variants',
    'all low-firepower override families',
    'nonzero nuclear defender survival',
  ]),
  borders: implemented('BorderManager'),
  research: implemented('ResearchManager'),
  culture: partial('CultureManager and game creation', [
    'cultural victory',
    'culture-driven migration',
  ]),
  world_peace: partial('EndGameService', ['world-peace victory']),
  calendar: implemented('CalendarService and TurnManager effects'),
  disasters: partial('DisasterManager definitions', ['ruleset-native disaster execution']),
  trade: partial('CityTradeRouteService', [
    'alliance/team/enemy route relationship selection',
    'one-time gold/science bonuses',
    'route cancellation policy changes',
  ]),
  goods: partial('trade route goods metadata', ['goods selection and depletion lifecycle']),
  access_area: preserved('classic leaves access_unit empty'),
  diplomacy_clauses: partial('DiplomacyManager', [
    'technology, gold, map, seamap, city, and vision clause transfers',
  ]),
  player_colors: implemented('player color assignment'),
  teams: preserved('classic defines no team names'),
  settings: preserved('classic locks no server settings'),
};
