import { ActionType } from '@app-types/shared/actions';
import { CLASSIC_ACTION_COVERAGE } from '@game/services/ClassicActionInventory';
import { RulesetActionsService } from '@game/services/RulesetActionsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { UNIT_TYPES } from '@game/constants/UnitConstants';

describe('classic action inventory', () => {
  it('accounts for every classic enabler and keeps scheduled gaps explicit', () => {
    const enablers = rulesetLoader.getActionEnablers();
    const actionNames = new Set(enablers.map(enabler => enabler.action));

    expect(enablers).toHaveLength(82);
    expect(actionNames.size).toBe(64);
    expect(Object.keys(CLASSIC_ACTION_COVERAGE).sort()).toEqual([...actionNames].sort());
    expect(
      Object.values(CLASSIC_ACTION_COVERAGE).every(
        coverage =>
          coverage.disposition !== 'scheduled' ||
          (coverage.milestone !== undefined && coverage.rationale.length > 0)
      )
    ).toBe(true);
  });

  it('advertises Milestone 11 actions only for ruleset-capable units', () => {
    const service = new RulesetActionsService();

    expect(service.getUnitActions(UNIT_TYPES.paratroopers)).toEqual(
      expect.arrayContaining([ActionType.PARADROP, ActionType.AIRLIFT, ActionType.AUTO_EXPLORE])
    );
    expect(service.getUnitActions(UNIT_TYPES.worker)).toEqual(
      expect.arrayContaining([ActionType.AIRLIFT, ActionType.AUTO_EXPLORE, ActionType.AUTO_SETTLER])
    );
    expect(service.getUnitActions(UNIT_TYPES.warriors)).not.toContain(ActionType.PARADROP);
  });

  it('does not advertise bombardment when classic defines no bombard-capable unit', () => {
    const service = new RulesetActionsService();

    expect(Object.values(UNIT_TYPES).every(unit => unit.bombardRate === 0)).toBe(true);
    expect(
      Object.values(UNIT_TYPES).every(
        unit => !service.getUnitActions(unit).includes(ActionType.BOMBARD)
      )
    ).toBe(true);
  });
});
