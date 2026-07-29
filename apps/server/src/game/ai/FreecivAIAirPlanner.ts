import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export type AirMission =
  | { unit: Unit; kind: 'return'; targetX: number; targetY: number; want: number }
  | { unit: Unit; kind: 'strike'; target: Unit; targetX: number; targetY: number; want: number }
  | {
      unit: Unit;
      kind: 'paradrop';
      targetCity: CityState;
      targetX: number;
      targetY: number;
      want: number;
    };

interface AirPlanningContext {
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  friendlyCities: CityState[];
  hostileCities: CityState[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  planesHandicap?: boolean;
}

function combatPower(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(1, type.hitpoints ?? 10) *
    Math.max(0.1, unit.health / 100)
  );
}

/**
 * Plan fuel-safe air strikes and high-value paradrops.
 *
 * @reference reference/freeciv/ai/default/daiair.c
 * @reference reference/freeciv/ai/default/daiparadrop.c
 */
export function planAirMissions(context: AirPlanningContext): AirMission[] {
  const missions: AirMission[] = [];
  const hostileAt = (x: number, y: number) =>
    context.hostileUnits.filter(unit => unit.x === x && unit.y === y);

  for (const unit of context.friendlyUnits.sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(unit.unitTypeId);
    if (!type || unit.transportedBy) continue;

    if (type.paratroopersRange > 0) {
      const target = context.hostileCities
        .filter(
          city =>
            context.distance(unit.x, unit.y, city.x, city.y) <= type.paratroopersRange &&
            hostileAt(city.x, city.y).length === 0
        )
        .map(city => ({
          city,
          want:
            city.size * 100 -
            context.distance(unit.x, unit.y, city.x, city.y) * 5 +
            city.buildings.length * 20,
        }))
        .sort((a, b) => b.want - a.want || a.city.id.localeCompare(b.city.id))[0];
      if (target) {
        missions.push({
          unit,
          kind: 'paradrop',
          targetCity: target.city,
          targetX: target.city.x,
          targetY: target.city.y,
          want: target.want,
        });
        continue;
      }
    }

    if (type.unitClass !== 'air') continue;
    const bases = context.friendlyCities
      .map(city => ({
        city,
        distance: context.distance(unit.x, unit.y, city.x, city.y),
      }))
      .sort((a, b) => a.distance - b.distance || a.city.id.localeCompare(b.city.id));
    const atBase = bases.some(base => base.distance === 0);
    const fuel = unit.fuel ?? type.fuel ?? 0;
    if (!atBase && fuel > 0 && fuel <= Math.max(1, bases[0]?.distance ?? Infinity)) {
      const base = bases[0];
      if (base) {
        missions.push({
          unit,
          kind: 'return',
          targetX: base.city.x,
          targetY: base.city.y,
          want: Number.MAX_SAFE_INTEGER,
        });
      }
      continue;
    }
    if (context.planesHandicap) continue;

    const maxRange = Math.max(1, type.range || type.movement);
    const target = context.hostileUnits
      .filter(enemy => context.distance(unit.x, unit.y, enemy.x, enemy.y) <= maxRange)
      .map(enemy => {
        const enemyType = context.getType(enemy.unitTypeId);
        const distance = context.distance(unit.x, unit.y, enemy.x, enemy.y);
        const value = hostileAt(enemy.x, enemy.y).reduce((sum, member) => {
          const memberType = context.getType(member.unitTypeId);
          return sum + (memberType?.cost ?? 0) + (memberType ? combatPower(member, memberType) : 0);
        }, 0);
        const loss = Math.max(1, type.cost) / Math.max(1, combatPower(unit, type));
        return { enemy, want: value / (distance + 1) - loss, enemyType };
      })
      .filter(candidate => candidate.enemyType && candidate.want > 0)
      .sort((a, b) => b.want - a.want || a.enemy.id.localeCompare(b.enemy.id))[0];
    if (target) {
      missions.push({
        unit,
        kind: 'strike',
        target: target.enemy,
        targetX: target.enemy.x,
        targetY: target.enemy.y,
        want: target.want,
      });
    }
  }
  return missions;
}
