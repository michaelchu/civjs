/**
 * @module server/game/ai/AIParadropPlanner
 * Implements AIParadrop Planner decision logic for AI-controlled players.
 */
import type { CityState } from '@game/cities/CityTypes';
import type { MapTile } from '@game/map/MapTypes';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';

export type ParadropMission =
  | { unit: Unit; kind: 'hold'; targetX: number; targetY: number; want: number }
  | {
      unit: Unit;
      kind: 'return';
      targetCity: CityState;
      targetX: number;
      targetY: number;
      want: number;
    }
  | {
      unit: Unit;
      kind: 'reinforce' | 'capture';
      targetCity: CityState;
      targetX: number;
      targetY: number;
      want: number;
    }
  | {
      unit: Unit;
      kind: 'tactical';
      targetTile: MapTile;
      attackTarget: Unit;
      targetX: number;
      targetY: number;
      want: number;
    };

export interface ParadropPlanningContext {
  paratroopers: Unit[];
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  friendlyCities: CityState[];
  hostileCities: CityState[];
  tiles: MapTile[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  canParadropTo: (unit: Unit, tile: MapTile) => boolean;
  isKnown: (tile: MapTile) => boolean;
  isSeen: (tile: MapTile) => boolean;
  cityUrgency: (city: CityState) => number;
  terrainDefense: (tile: MapTile) => number;
  isStackProtected: (tile: MapTile) => boolean;
  canAttack: (attacker: Unit, defender: Unit) => boolean;
  defenderRating: (attacker: Unit, defender: Unit) => number;
  winChance: (attacker: Unit, defender: Unit) => number;
  fogHandicap?: boolean;
}

export interface VirtualParadropProductionContext {
  gameId: string;
  playerId: string;
  city: CityState;
  unitTypes: Iterable<UnitType>;
  units: Unit[];
  cities: CityState[];
  alliedPlayerIds: ReadonlySet<string>;
  tiles: MapTile[];
  canBuild: (unitTypeId: string) => boolean;
  isKnown: (tile: MapTile) => boolean;
  distance: ParadropPlanningContext['distance'];
}

function tileKey(value: Pick<MapTile, 'x' | 'y'> | Pick<CityState, 'x' | 'y'>): string {
  return `${value.x},${value.y}`;
}

function actualHitpoints(unit: Unit, type: UnitType): number {
  return Math.max(1, (Math.max(1, type.hitpoints ?? 10) * unit.health) / 100);
}

function bestDefender(
  attacker: Unit,
  stack: Unit[],
  context: ParadropPlanningContext
): Unit | undefined {
  return stack
    .filter(unit => context.getType(unit.unitTypeId) && context.canAttack(attacker, unit))
    .sort(
      (left, right) =>
        context.defenderRating(attacker, right) - context.defenderRating(attacker, left) ||
        left.id.localeCompare(right.id)
    )[0];
}

function canLandTactically(
  tile: MapTile,
  context: ParadropPlanningContext,
  landingCity: CityState | undefined,
  unitsByTile: ReadonlyMap<string, Unit[]>
): boolean {
  if (tile.cityId && !landingCity) return false;
  if (!landingCity && (unitsByTile.get(tileKey(tile))?.length ?? 0) > 0) return false;
  return !landingCity || context.friendlyCities.some(city => city.id === landingCity.id);
}

function tacticalTargetScore(
  unit: Unit,
  landingTile: MapTile,
  targetTile: MapTile,
  context: ParadropPlanningContext,
  unitsByTile: ReadonlyMap<string, Unit[]>
): { want: number; target: Unit } | undefined {
  if (context.distance(landingTile.x, landingTile.y, targetTile.x, targetTile.y) !== 1) {
    return undefined;
  }
  if (context.fogHandicap && !context.isSeen(targetTile)) return undefined;
  const stack = (unitsByTile.get(tileKey(targetTile)) ?? []).filter(candidate =>
    context.hostileUnits.some(hostile => hostile.id === candidate.id)
  );
  const defender = bestDefender(unit, stack, context);
  if (!defender) return undefined;
  const exposed = context.isStackProtected(targetTile) ? [defender] : stack;
  const victimValue = exposed.reduce((sum, victim) => {
    const type = context.getType(victim.unitTypeId);
    return type && context.canAttack(unit, victim)
      ? sum + actualHitpoints(victim, type) * 100
      : sum;
  }, 0);
  const type = context.getType(unit.unitTypeId)!;
  const want =
    victimValue * context.winChance(unit, defender) +
    context.terrainDefense(landingTile) / 10 -
    actualHitpoints(unit, type) * 100;
  return want > 0 ? { want, target: defender } : undefined;
}

function tacticalLandingScore(
  unit: Unit,
  tile: MapTile,
  context: ParadropPlanningContext,
  cityByTile: ReadonlyMap<string, CityState>,
  unitsByTile: ReadonlyMap<string, Unit[]>
): { want: number; target: Unit } | undefined {
  const landingCity = cityByTile.get(tileKey(tile));
  if (!canLandTactically(tile, context, landingCity, unitsByTile)) return undefined;
  let best: { want: number; target: Unit } | undefined;
  for (const targetTile of context.tiles) {
    const candidate = tacticalTargetScore(unit, tile, targetTile, context, unitsByTile);
    if (!candidate) continue;
    if (
      !best ||
      candidate.want > best.want ||
      (candidate.want === best.want && candidate.target.id < best.target.id)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Select reinforcement, capture, or tactical paradrop destinations in the
 * same priority order as Freeciv's classic/default AI.
 *
 * @reference reference/freeciv/ai/default/daiparadrop.c:find_best_tile_to_paradrop_to
 */
export function planParadropMissions(context: ParadropPlanningContext): ParadropMission[] {
  const missions: ParadropMission[] = [];
  const reservedCities = new Set<string>();
  const reservedTiles = new Set<string>();
  const cityByTile = new Map(
    [...context.friendlyCities, ...context.hostileCities].map(city => [tileKey(city), city])
  );
  const unitsByTile = new Map<string, Unit[]>();
  for (const candidate of [...context.friendlyUnits, ...context.hostileUnits]) {
    const key = tileKey(candidate);
    const stack = unitsByTile.get(key) ?? [];
    stack.push(candidate);
    unitsByTile.set(key, stack);
  }

  for (const unit of [...context.paratroopers].sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(unit.unitTypeId);
    if (!type || unit.transportedBy || unit.movementLeft <= 0) continue;
    const sourceCity = context.friendlyCities.find(city => city.x === unit.x && city.y === unit.y);
    if (
      (sourceCity && unit.health < 50) ||
      (sourceCity && (unitsByTile.get(tileKey(sourceCity))?.length ?? 0) === 1)
    ) {
      missions.push({ unit, kind: 'hold', targetX: unit.x, targetY: unit.y, want: Infinity });
      continue;
    }

    const legalTiles = context.tiles.filter(
      tile =>
        context.distance(unit.x, unit.y, tile.x, tile.y) <= type.paratroopersRange &&
        context.canParadropTo(unit, tile)
    );
    const legalTileKeys = new Set(legalTiles.map(tileKey));
    if (legalTiles.length === 0) {
      if (!sourceCity) {
        const targetCity = [...context.friendlyCities].sort(
          (left, right) =>
            context.distance(unit.x, unit.y, left.x, left.y) -
              context.distance(unit.x, unit.y, right.x, right.y) || left.id.localeCompare(right.id)
        )[0];
        if (targetCity) {
          missions.push({
            unit,
            kind: 'return',
            targetCity,
            targetX: targetCity.x,
            targetY: targetCity.y,
            want: Infinity,
          });
        }
      }
      continue;
    }

    const reinforce = context.friendlyCities
      .filter(
        city =>
          !reservedCities.has(city.id) &&
          legalTileKeys.has(tileKey(city)) &&
          context.isKnown(context.tiles.find(tile => tile.x === city.x && tile.y === city.y)!) &&
          context.distance(unit.x, unit.y, city.x, city.y) <= type.paratroopersRange &&
          (unitsByTile.get(tileKey(city))?.length ?? 0) === 0
      )
      .map(city => ({ city, want: city.size * context.cityUrgency(city) }))
      .filter(candidate => candidate.want > 0)
      .sort(
        (left, right) => right.want - left.want || left.city.id.localeCompare(right.city.id)
      )[0];
    if (reinforce) {
      reservedCities.add(reinforce.city.id);
      missions.push({
        unit,
        kind: 'reinforce',
        targetCity: reinforce.city,
        targetX: reinforce.city.x,
        targetY: reinforce.city.y,
        want: reinforce.want,
      });
      continue;
    }

    const sourceTile = context.tiles.find(tile => tile.x === unit.x && tile.y === unit.y);
    const capture = context.hostileCities
      .filter(
        city =>
          !reservedCities.has(city.id) &&
          legalTileKeys.has(tileKey(city)) &&
          (unitsByTile.get(tileKey(city))?.length ?? 0) === 0 &&
          context.distance(unit.x, unit.y, city.x, city.y) <= type.paratroopersRange &&
          (!context.fogHandicap ||
            context.isSeen(context.tiles.find(tile => tile.x === city.x && tile.y === city.y)!))
      )
      .map(city => {
        const targetTile = context.tiles.find(tile => tile.x === city.x && tile.y === city.y);
        return {
          city,
          want:
            city.size +
            Number(sourceTile && targetTile && sourceTile.continentId !== targetTile.continentId),
        };
      })
      .sort(
        (left, right) => right.want - left.want || left.city.id.localeCompare(right.city.id)
      )[0];
    if (capture) {
      reservedCities.add(capture.city.id);
      missions.push({
        unit,
        kind: 'capture',
        targetCity: capture.city,
        targetX: capture.city.x,
        targetY: capture.city.y,
        want: capture.want,
      });
      continue;
    }

    const tactical = legalTiles
      .filter(
        tile =>
          !reservedTiles.has(tileKey(tile)) &&
          context.isKnown(tile) &&
          (!context.fogHandicap || context.isSeen(tile))
      )
      .flatMap(tile => {
        const score = tacticalLandingScore(unit, tile, context, cityByTile, unitsByTile);
        return score ? [{ tile, ...score }] : [];
      })
      .sort(
        (left, right) =>
          right.want - left.want || left.tile.x - right.tile.x || left.tile.y - right.tile.y
      )[0];
    if (tactical) {
      reservedTiles.add(tileKey(tactical.tile));
      missions.push({
        unit,
        kind: 'tactical',
        targetTile: tactical.tile,
        attackTarget: tactical.target,
        targetX: tactical.tile.x,
        targetY: tactical.tile.y,
        want: tactical.want,
      });
    }
  }
  return missions;
}

/**
 * Port of Freeciv's city-local paratrooper production value.
 *
 * @reference reference/freeciv/ai/default/daiparadrop.c:calculate_want_for_paratrooper
 * @reference reference/freeciv/ai/default/daiparadrop.c:dai_choose_paratrooper
 */
function virtualParadropWant(
  context: VirtualParadropProductionContext,
  type: UnitType,
  tileByKey: ReadonlyMap<string, MapTile>,
  existing: number,
  cityCount: number
): number {
  const sourceTile = tileByKey.get(tileKey(context.city));
  let want =
    Math.max(0, type.defense ?? type.combat ?? 0) +
    type.movement +
    Math.max(0, type.attack ?? type.combat ?? 0);
  for (const targetCity of context.cities) {
    const targetTile = tileByKey.get(tileKey(targetCity));
    const distance = context.distance(context.city.x, context.city.y, targetCity.x, targetCity.y);
    const defenders = context.units.filter(
      unit => unit.x === targetCity.x && unit.y === targetCity.y
    ).length;
    if (
      !targetTile ||
      !context.isKnown(targetTile) ||
      distance > type.paratroopersRange ||
      defenders > 2
    ) {
      continue;
    }
    const otherContinent =
      sourceTile && targetTile.continentId > 0 && sourceTile.continentId !== targetTile.continentId;
    const continentSize = otherContinent
      ? context.tiles.filter(tile => tile.continentId === targetTile.continentId).length
      : 0;
    const multiplier = otherContinent ? (continentSize < 3 ? 10 : 5) : 1;
    const allied =
      targetCity.playerId === context.playerId || context.alliedPlayerIds.has(targetCity.playerId);
    want += targetCity.size * multiplier * distance * (allied ? 0.5 : 1);
  }
  return existing > cityCount ? (want * cityCount) / existing : want;
}

export function rankVirtualParadropProduction(
  context: VirtualParadropProductionContext
): Map<string, number> {
  const unitTypes = [...context.unitTypes];
  const tileByKey = new Map(context.tiles.map(tile => [tileKey(tile), tile]));
  const existing = context.units.filter(unit => {
    const type = unitTypes.find(candidate => candidate.id === unit.unitTypeId);
    return unit.playerId === context.playerId && (type?.paratroopersRange ?? 0) > 0;
  }).length;
  const cityCount = Math.max(
    1,
    context.cities.filter(city => city.playerId === context.playerId).length
  );
  return new Map(
    unitTypes.flatMap(type => {
      if (
        type.paratroopersRange <= 0 ||
        !type.flags?.includes('Paratroopers') ||
        !context.canBuild(type.id)
      ) {
        return [];
      }
      const want = virtualParadropWant(context, type, tileByKey, existing, cityCount);
      return want > 0 ? ([[type.id, want]] as const) : [];
    })
  );
}
