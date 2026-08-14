/**
 * @module server/game/services/RulesetActionsService
 * Provides the server-side Ruleset Actions Service service.
 */
import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { ActionEnabler } from '@shared/data/rulesets/schemas';
import { RulesetRequirementEvaluator } from './RulesetRequirementEvaluator';
import { ActionType } from '@app-types/shared/actions';
import type { UnitType } from './RulesetUnitsService';
import { DEFAULT_RULESET } from '@shared/data/rulesets/defaultRuleset';

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
  { id: 'spy_attack', upstream: ['Spy Attack'] },
];

const CIV2CIV3_UNIT_ACTIONS: ReadonlyArray<{
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
  { id: ActionType.CAPTURE_UNITS, upstream: ['Capture Units'] },
  { id: ActionType.COLLECT_RANSOM, upstream: ['Collect Ransom'] },
  { id: ActionType.SUICIDE_ATTACK, upstream: ['Suicide Attack'] },
];

/**
 * Resolves coarse unit capabilities from Civ2Civ3 action enablers. Target,
 * diplomatic, movement, and local-state requirements remain authoritative at
 * action execution time; this layer only answers whether a unit type can ever
 * satisfy an enabler.
 */
export class RulesetActionsService {
  private readonly diplomatActionsCache = new Map<string, string[]>();
  private readonly unitActionsCache = new Map<string, ActionType[]>();

  constructor(
    private readonly loader: Pick<RulesetLoader, 'getActionEnablersFor'> = rulesetLoader,
    private readonly rulesetName: string = DEFAULT_RULESET,
    private readonly requirements = new RulesetRequirementEvaluator()
  ) {}

  getDiplomatActions(actor: UnitType | Iterable<string>): string[] {
    const unitType = this.asUnitType(actor);
    const cacheKey = unitType
      ? `unit:${unitType.id}`
      : `flags:${Array.from(actor as Iterable<string>)
          .sort()
          .join('\0')}`;
    const cached = this.diplomatActionsCache.get(cacheKey);
    if (cached) return cached;
    const flags = new Set(unitType ? (unitType.flags ?? []) : (actor as Iterable<string>));
    const unitClassFlags = new Set(unitType?.rulesetUnitClassFlags ?? []);
    const actions = CLIENT_ACTIONS.filter(action =>
      action.upstream.some(upstream =>
        this.loader
          .getActionEnablersFor(upstream, this.rulesetName)
          .some(enabler =>
            this.matchesStaticActorFacts(
              enabler,
              flags,
              unitType?.rulesetUnitClass,
              unitClassFlags,
              unitType?.id
            )
          )
      )
    ).map(action => action.id);
    this.diplomatActionsCache.set(cacheKey, actions);
    return actions;
  }

  /**
   * Resolve coarse, player-visible capabilities. Dynamic source/target facts
   * are still checked by UnitManager when the command executes.
   */
  getUnitActions(unitType: UnitType): ActionType[] {
    const cached = this.unitActionsCache.get(unitType.id);
    if (cached) return cached;
    const flags = new Set(unitType.flags ?? []);
    const unitClass = unitType.rulesetUnitClass;
    const unitClassFlags = new Set(unitType.rulesetUnitClassFlags);
    const actions = CIV2CIV3_UNIT_ACTIONS.filter(action => {
      if (action.id === ActionType.BUILD_AIRBASE && !flags.has('Airbase')) return false;
      if (action.id === ActionType.UPGRADE_UNIT && !unitType.obsolete_by) return false;
      return action.upstream.some(upstream =>
        this.loader
          .getActionEnablersFor(upstream, this.rulesetName)
          .some(enabler =>
            this.matchesStaticActorFacts(enabler, flags, unitClass, unitClassFlags, unitType.id)
          )
      );
    }).map(action => action.id);

    // C2C3 has bombard range settings but no unit with bombard_rate. Keep
    // the generic outcome available should C2C3 add a capable unit.
    if (unitType.bombardRate > 0) actions.push(ActionType.BOMBARD);
    if (unitType.movement > 0) actions.push(ActionType.AUTO_EXPLORE);
    if (unitType.canBuildImprovements) actions.push(ActionType.AUTO_SETTLER);
    this.unitActionsCache.set(unitType.id, actions);
    return actions;
  }

  private matchesStaticActorFacts(
    enabler: ActionEnabler,
    flags: Set<string>,
    unitClass: string | undefined,
    unitClassFlags: Set<string>,
    unitType: string | undefined
  ): boolean {
    const staticRequirements = enabler.actor_reqs.filter(requirement =>
      ['UnitType', 'UnitTypeFlag', 'UnitClass', 'UnitClassFlag'].includes(requirement.type)
    );
    return this.requirements.evaluateAll(staticRequirements, {
      Local: { unitType, unitTypeFlags: flags, unitClass, unitClassFlags },
    });
  }

  private asUnitType(actor: UnitType | Iterable<string>): UnitType | undefined {
    return typeof actor === 'object' && actor !== null && 'id' in actor && 'flags' in actor
      ? (actor as UnitType)
      : undefined;
  }
}

export const rulesetActionsService = new RulesetActionsService();
