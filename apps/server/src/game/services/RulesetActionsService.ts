import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { ActionEnabler } from '@shared/data/rulesets/schemas';
import { RulesetRequirementEvaluator } from './RulesetRequirementEvaluator';
import { ActionType } from '@app-types/shared/actions';
import type { UnitType } from './RulesetUnitsService';

const CLIENT_ACTIONS: ReadonlyArray<{ id: string; upstream: readonly string[] }> = [
  {
    id: 'establish_embassy',
    upstream: ['Establish Embassy', 'Establish Embassy Stay'],
  },
  { id: 'investigate_city', upstream: ['Investigate City', 'Investigate City Spend Unit'] },
  {
    id: 'steal_tech',
    upstream: ['Steal Tech', 'Steal Tech Escape Expected', 'Targeted Steal Tech Escape Expected'],
  },
  { id: 'bribe_unit', upstream: ['Bribe Unit'] },
  { id: 'incite_city', upstream: ['Incite City', 'Incite City Escape'] },
  {
    id: 'sabotage_city',
    upstream: ['Sabotage City', 'Sabotage City Escape', 'Targeted Sabotage City Escape'],
  },
  {
    id: 'sabotage_city_production',
    upstream: ['Sabotage City Production Escape'],
  },
  { id: 'poison_water', upstream: ['Poison City Escape'] },
  { id: 'sabotage_unit', upstream: ['Sabotage Unit Escape'] },
];

const CLASSIC_UNIT_ACTIONS: ReadonlyArray<{
  id: ActionType;
  upstream: readonly string[];
}> = [
  {
    id: ActionType.PARADROP,
    upstream: ['Paradrop Unit Enter', 'Paradrop Unit Enter Conquer'],
  },
  { id: ActionType.AIRLIFT, upstream: ['Airlift Unit'] },
  { id: ActionType.MARKETPLACE, upstream: ['Enter Marketplace'] },
  { id: ActionType.HELP_WONDER, upstream: ['Help Wonder'] },
  { id: ActionType.DISBAND_UNIT_RECOVER, upstream: ['Disband Unit Recover'] },
  { id: ActionType.JOIN_CITY, upstream: ['Join City'] },
  { id: ActionType.CHANGE_HOME_CITY, upstream: ['Home City'] },
  { id: ActionType.UPGRADE_UNIT, upstream: ['Upgrade Unit'] },
  { id: ActionType.CULTIVATE, upstream: ['Cultivate'] },
  { id: ActionType.PLANT, upstream: ['Plant'] },
  { id: ActionType.BUILD_FORTRESS, upstream: ['Build Base'] },
  { id: ActionType.BUILD_AIRBASE, upstream: ['Build Base'] },
  {
    id: ActionType.NUCLEAR_EXPLOSION,
    upstream: ['Explode Nuclear', 'Nuke City', 'Nuke Units'],
  },
  { id: ActionType.COLLECT_RANSOM, upstream: ['Collect Ransom'] },
  { id: ActionType.SUICIDE_ATTACK, upstream: ['Suicide Attack'] },
];

/**
 * Resolves coarse unit capabilities from classic action enablers. Target,
 * diplomatic, movement, and local-state requirements remain authoritative at
 * action execution time; this layer only answers whether a unit type can ever
 * satisfy an enabler.
 */
export class RulesetActionsService {
  constructor(
    private readonly loader: Pick<RulesetLoader, 'getActionEnablersFor'> = rulesetLoader,
    private readonly rulesetName: string = 'classic',
    private readonly requirements = new RulesetRequirementEvaluator()
  ) {}

  getDiplomatActions(unitFlags: Iterable<string>): string[] {
    const flags = new Set(unitFlags);
    return CLIENT_ACTIONS.filter(action =>
      action.upstream.some(upstream =>
        this.loader
          .getActionEnablersFor(upstream, this.rulesetName)
          .some(enabler => this.matchesUnitTypeFlags(enabler, flags))
      )
    ).map(action => action.id);
  }

  /**
   * Resolve coarse, player-visible capabilities. Dynamic source/target facts
   * are still checked by UnitManager when the command executes.
   */
  getUnitActions(unitType: UnitType): ActionType[] {
    const flags = new Set(unitType.flags ?? []);
    const unitClass = unitType.rulesetUnitClass;
    const actions = CLASSIC_UNIT_ACTIONS.filter(action => {
      if (action.id === ActionType.BUILD_AIRBASE && !flags.has('Airbase')) return false;
      if (action.id === ActionType.UPGRADE_UNIT && !unitType.obsolete_by) return false;
      return action.upstream.some(upstream =>
        this.loader
          .getActionEnablersFor(upstream, this.rulesetName)
          .some(enabler =>
            this.matchesStaticActorFacts(
              enabler,
              flags,
              unitClass,
              new Set(unitType.rulesetUnitClassFlags)
            )
          )
      );
    }).map(action => action.id);

    // Classic has bombard range settings but no unit with bombard_rate. Keep
    // the generic outcome available to rulesets that define a capable unit.
    if (unitType.bombardRate > 0) actions.push(ActionType.BOMBARD);
    if (unitType.movement > 0) actions.push(ActionType.AUTO_EXPLORE);
    if (unitType.canBuildImprovements) actions.push(ActionType.AUTO_SETTLER);
    return actions;
  }

  private matchesUnitTypeFlags(enabler: ActionEnabler, flags: Set<string>): boolean {
    return this.requirements.evaluateAll(
      enabler.actor_reqs.filter(requirement => requirement.type === 'UnitTypeFlag'),
      { Local: { unitTypeFlags: flags } }
    );
  }

  private matchesStaticActorFacts(
    enabler: ActionEnabler,
    flags: Set<string>,
    unitClass: string | undefined,
    unitClassFlags: Set<string>
  ): boolean {
    const staticRequirements = enabler.actor_reqs.filter(requirement =>
      ['UnitTypeFlag', 'UnitClass', 'UnitClassFlag'].includes(requirement.type)
    );
    return this.requirements.evaluateAll(staticRequirements, {
      Local: { unitTypeFlags: flags, unitClass, unitClassFlags },
    });
  }
}

export const rulesetActionsService = new RulesetActionsService();
