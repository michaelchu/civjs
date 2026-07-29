import { ActionType } from '@app-types/shared/actions';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface DiplomatMission {
  unit: Unit;
  kind: 'action' | 'defend';
  action?: ActionType;
  targetId: string;
  targetX: number;
  targetY: number;
  want: number;
}

interface DiplomatPlanningContext {
  diplomats: Unit[];
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  foreignCities: CityState[];
  friendlyCities: CityState[];
  hostilePlayerIds: ReadonlySet<string>;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  diplomatHandicap?: boolean;
}

function isDiplomat(type: UnitType | undefined): boolean {
  return Boolean(type?.flags?.includes('Diplomat'));
}

/**
 * Select embassy, espionage, bribery, and defensive diplomat missions.
 *
 * @reference reference/freeciv/ai/default/daidiplomat.c
 * @reference reference/freeciv/ai/default/daiactions.c
 */
export function planDiplomatMissions(context: DiplomatPlanningContext): DiplomatMission[] {
  if (context.diplomatHandicap) return [];
  const missions: DiplomatMission[] = [];
  const reservedTargets = new Set<string>();

  for (const diplomat of context.diplomats.sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(diplomat.unitTypeId);
    if (!isDiplomat(type)) continue;
    const isSpy = type!.flags?.includes('Spy') ?? false;
    const cityTargets = context.foreignCities
      .filter(city => !reservedTargets.has(city.id))
      .map(city => {
        const hostile = context.hostilePlayerIds.has(city.playerId);
        const distance = context.distance(diplomat.x, diplomat.y, city.x, city.y);
        let action = ActionType.ESTABLISH_EMBASSY;
        let value = city.size * 40 + city.buildings.length * 25;
        if (hostile && isSpy && city.buildings.some(building => building !== 'palace')) {
          action = ActionType.SABOTAGE_CITY;
          value += 180;
        } else if (hostile) {
          action = ActionType.STEAL_TECH;
          value += 140;
        } else {
          value += 80;
        }
        return { city, action, want: value / (distance + 1) };
      })
      .sort((a, b) => b.want - a.want || a.city.id.localeCompare(b.city.id));

    const bribeTargets = context.hostileUnits
      .filter(unit => {
        const unitType = context.getType(unit.unitTypeId);
        return (
          !reservedTargets.has(unit.id) &&
          !unit.transportedBy &&
          !unitType?.canFoundCity &&
          !unitType?.canBuildImprovements
        );
      })
      .map(unit => {
        const unitType = context.getType(unit.unitTypeId)!;
        const distance = context.distance(diplomat.x, diplomat.y, unit.x, unit.y);
        return { unit, want: (unitType.cost * 3) / (distance + 1) };
      })
      .sort((a, b) => b.want - a.want || a.unit.id.localeCompare(b.unit.id));

    const cityTarget = cityTargets[0];
    const bribeTarget = bribeTargets[0];
    if (bribeTarget && (!cityTarget || bribeTarget.want > cityTarget.want)) {
      missions.push({
        unit: diplomat,
        kind: 'action',
        action: ActionType.BRIBE_UNIT,
        targetId: bribeTarget.unit.id,
        targetX: bribeTarget.unit.x,
        targetY: bribeTarget.unit.y,
        want: bribeTarget.want,
      });
      reservedTargets.add(bribeTarget.unit.id);
      continue;
    }
    if (cityTarget) {
      missions.push({
        unit: diplomat,
        kind: 'action',
        action: cityTarget.action,
        targetId: cityTarget.city.id,
        targetX: cityTarget.city.x,
        targetY: cityTarget.city.y,
        want: cityTarget.want,
      });
      reservedTargets.add(cityTarget.city.id);
      continue;
    }

    const undefended = context.friendlyCities
      .filter(
        city =>
          !context.friendlyUnits.some(
            unit =>
              unit.id !== diplomat.id &&
              unit.x === city.x &&
              unit.y === city.y &&
              isDiplomat(context.getType(unit.unitTypeId))
          )
      )
      .sort(
        (a, b) =>
          context.distance(diplomat.x, diplomat.y, a.x, a.y) -
            context.distance(diplomat.x, diplomat.y, b.x, b.y) || b.size - a.size
      )[0];
    if (undefended) {
      missions.push({
        unit: diplomat,
        kind: 'defend',
        targetId: undefended.id,
        targetX: undefended.x,
        targetY: undefended.y,
        want: undefended.size * 20,
      });
      reservedTargets.add(undefended.id);
    }
  }
  return missions;
}
