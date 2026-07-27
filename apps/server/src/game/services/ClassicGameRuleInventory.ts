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
  game_parameters: implemented('actions, upkeep, airlift, and unit lifecycle'),
  wonder_visibility: implemented('wonder ownership and city visibility packets'),
  illness: preserved('classic disables illness'),
  combat_rules: implemented('combat, veterancy, bombardment, and nuclear city damage'),
  borders: implemented('BorderManager'),
  research: implemented('ResearchManager'),
  culture: implemented('CultureManager, EndGameService, and game creation'),
  world_peace: implemented('EndGameService'),
  calendar: implemented('CalendarService and TurnManager effects'),
  disasters: implemented('DisasterManager and TurnPhaseService'),
  trade: implemented('CityTradeRouteService and CityManager settlement'),
  goods: implemented('trade route goods selection and persistence'),
  access_area: preserved('classic leaves access_unit empty'),
  diplomacy_clauses: implemented('DiplomacyManager treaty validation and transfers'),
  player_colors: implemented('player color assignment'),
  teams: preserved('classic defines no team names'),
  settings: preserved('classic locks no server settings'),
};
