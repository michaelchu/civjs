import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { ActionEnabler } from '@shared/data/rulesets/schemas';
import { RulesetRequirementEvaluator } from './RulesetRequirementEvaluator';

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
    upstream: [
      'Sabotage City',
      'Sabotage City Escape',
      'Targeted Sabotage City Escape',
      'Sabotage City Production Escape',
    ],
  },
  { id: 'poison_water', upstream: ['Poison City Escape'] },
  { id: 'sabotage_unit', upstream: ['Sabotage Unit Escape'] },
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

  private matchesUnitTypeFlags(enabler: ActionEnabler, flags: Set<string>): boolean {
    return this.requirements.evaluateAll(
      enabler.actor_reqs.filter(requirement => requirement.type === 'UnitTypeFlag'),
      { Local: { unitTypeFlags: flags } }
    );
  }
}

export const rulesetActionsService = new RulesetActionsService();
