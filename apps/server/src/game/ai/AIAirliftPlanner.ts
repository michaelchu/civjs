import type { AIUnitTask } from '@game/ai/AIStateStore';
import type { CityDangerAssessment } from '@game/ai/AICityDangerPlanner';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface DefenderAirlift {
  unit: Unit;
  sourceCity: CityState;
  targetCity: CityState;
}

interface DefenderAirliftContext {
  assessments: CityDangerAssessment[];
  units: Unit[];
  tasks: Record<string, AIUnitTask>;
  getCityAt: (x: number, y: number) => CityState | undefined;
  getType: (unitTypeId: string) => UnitType | undefined;
  canAirlift: (unit: Unit, target: CityState) => boolean;
}

/**
 * Move an idle attacking defender from a safe city to the city with the
 * greatest urgent defense deficit.
 *
 * @reference reference/freeciv/ai/default/daiunit.c:dai_airlift
 */
export function planDefenderAirlift(context: DefenderAirliftContext): DefenderAirlift | undefined {
  const targets = context.assessments
    .filter(assessment => assessment.urgency > 0 && assessment.defenseDeficit > 0)
    .sort(
      (left, right) =>
        right.urgency - left.urgency ||
        right.defenseDeficit - left.defenseDeficit ||
        left.city.id.localeCompare(right.city.id)
    );
  for (const target of targets) {
    const candidates = context.units
      .map(unit => ({
        unit,
        type: context.getType(unit.unitTypeId),
        source: context.getCityAt(unit.x, unit.y),
      }))
      .filter(
        (
          candidate
        ): candidate is {
          unit: Unit;
          type: UnitType;
          source: CityState;
        } => Boolean(candidate.type && candidate.source)
      )
      .filter(candidate => candidate.source.id !== target.city.id)
      .filter(candidate => {
        const sourceAssessment = context.assessments.find(
          assessment => assessment.city.id === candidate.source.id
        );
        const task = context.tasks[candidate.unit.id];
        const defense = candidate.type.defense ?? candidate.type.combat ?? 0;
        const attack = candidate.type.attack ?? candidate.type.combat ?? 0;
        return Boolean(
          sourceAssessment?.urgency === 0 &&
            sourceAssessment.danger < defense &&
            defense > 2 &&
            attack > 0 &&
            !candidate.unit.transportedBy &&
            (!task || task.role === 'defend' || task.role === 'guard') &&
            context.canAirlift(candidate.unit, target.city)
        );
      })
      .sort((left, right) => {
        const leftSource = context.assessments.find(
          assessment => assessment.city.id === left.source.id
        )!;
        const rightSource = context.assessments.find(
          assessment => assessment.city.id === right.source.id
        )!;
        const leftDefense = left.type.defense ?? left.type.combat ?? 0;
        const rightDefense = right.type.defense ?? right.type.combat ?? 0;
        return (
          leftSource.danger - rightSource.danger ||
          rightDefense - leftDefense ||
          left.unit.id.localeCompare(right.unit.id)
        );
      });
    const selected = candidates[0];
    if (selected) {
      return {
        unit: selected.unit,
        sourceCity: selected.source,
        targetCity: target.city,
      };
    }
  }
  return undefined;
}
