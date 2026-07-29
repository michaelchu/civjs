import {
  buildMilitaryTravelTimes,
  militaryTravelKey,
  rankMilitaryObjectives,
  selectProjectedCityDefender,
} from '@game/ai/FreecivAIMilitaryPlanner';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface VirtualMilitaryProductionContext {
  gameId: string;
  playerId: string;
  city: CityState;
  unitTypes: Iterable<UnitType>;
  targetUnits: Unit[];
  targetCities: CityState[];
  canBuild: (cityId: string, unitTypeId: string) => boolean;
  getType: (unitTypeId: string) => UnitType | undefined;
  getNeighbors: (x: number, y: number) => Array<{ x: number; y: number }>;
  findPath: (
    unit: Unit,
    targetX: number,
    targetY: number
  ) => Promise<{ valid: boolean; estimatedTurns: number }>;
  isStackProtected: (x: number, y: number) => boolean;
  rateAttack: (unit: Unit) => number;
  rateDefense: (defender: Unit, attacker: Unit) => number;
  causesMilitaryUnhappiness: () => boolean;
}

/**
 * Evaluate each legal, conventional attacker as a Freeciv-style virtual unit
 * built in this city, against current and prospective hostile targets.
 *
 * Fuel-limited aircraft are handled by the air advisor, not this conventional
 * military production pass.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:kill_something_with
 * @reference reference/freeciv/ai/default/daimilitary.c:process_attacker_want
 */
export async function rankVirtualMilitaryProduction(
  context: VirtualMilitaryProductionContext
): Promise<Map<string, number>> {
  const unitTypes = [...context.unitTypes];
  const virtualAttackers = unitTypes
    .filter(
      type =>
        (type.attack ?? type.combat ?? 0) > 0 &&
        !(type.fuel && type.fuel > 0) &&
        context.canBuild(context.city.id, type.id)
    )
    .map(
      (type): Unit => ({
        id: `virtual:${context.city.id}:${type.id}`,
        gameId: context.gameId,
        playerId: context.playerId,
        unitTypeId: type.id,
        x: context.city.x,
        y: context.city.y,
        movementLeft: type.movement,
        health: type.hitpoints ?? 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
        homeCityId: context.city.id,
      })
    );
  const travelTimes = await buildMilitaryTravelTimes({
    attackers: virtualAttackers,
    targets: [
      ...context.targetUnits.map(target => ({ x: target.x, y: target.y })),
      ...context.targetCities.map(target => ({ x: target.x, y: target.y })),
    ],
    getNeighbors: context.getNeighbors,
    findPath: context.findPath,
  });

  return new Map(
    virtualAttackers.flatMap(attacker => {
      const type = context.getType(attacker.unitTypeId);
      if (!type) return [];
      const objective = rankMilitaryObjectives({
        attacker,
        attackerType: type,
        hostileUnits: context.targetUnits,
        hostileCities: context.targetCities,
        getType: context.getType,
        travelTurns: (targetX, targetY) =>
          travelTimes.get(militaryTravelKey(attacker.id, targetX, targetY)),
        isStackProtected: context.isStackProtected,
        attackerRating: unit => context.rateAttack(unit),
        defenderRating: (projectedAttacker, defender) =>
          context.rateDefense(defender, projectedAttacker),
        projectedDefender: (targetCity, projectedAttacker) =>
          selectProjectedCityDefender({
            gameId: context.gameId,
            city: targetCity,
            attacker: projectedAttacker,
            unitTypes,
            canBuild: context.canBuild,
            rateDefense: context.rateDefense,
          }),
        causesMilitaryUnhappiness: context.causesMilitaryUnhappiness,
      })[0];
      return objective ? ([[type.id, objective.want]] as const) : [];
    })
  );
}
