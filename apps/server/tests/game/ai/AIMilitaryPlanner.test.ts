import {
  buildMilitaryTravelTimes,
  killDesire,
  planMilitaryCampaign,
  rankMilitaryObjectives,
  selectProjectedCityDefender,
  type MilitaryPlanningContext,
} from '@game/ai/AIMilitaryPlanner';
import { makeAIUnit } from '../../fixtures/aiFixtures';

function unit(id: string, unitTypeId: string, x: number, y: number, health = 100): any {
  return makeAIUnit({
    id,
    playerId: id === 'attacker' ? 'ai' : 'enemy',
    unitTypeId,
    x,
    y,
    health,
  });
}

function context(overrides: Partial<MilitaryPlanningContext> = {}): MilitaryPlanningContext {
  const types: Record<string, any> = {
    legion: {
      id: 'legion',
      unitClass: 'military',
      rulesetUnitClassFlags: ['CanOccupyCity'],
      flags: [],
      attack: 4,
      defense: 2,
      firepower: 1,
      movement: 1,
      range: 1,
      cost: 40,
    },
    warrior: {
      id: 'warrior',
      attack: 1,
      defense: 1,
      firepower: 1,
      movement: 1,
      cost: 10,
    },
    settler: {
      id: 'settler',
      attack: 0,
      defense: 1,
      firepower: 1,
      movement: 1,
      cost: 30,
      canFoundCity: true,
    },
  };
  return {
    attacker: unit('attacker', 'legion', 0, 0),
    attackerType: types.legion,
    hostileUnits: [unit('guard', 'warrior', 1, 0), unit('settler', 'settler', 1, 0)],
    hostileCities: [],
    getType: id => types[id],
    travelTurns: (x, y) => Math.max(Math.abs(x), Math.abs(y)),
    isStackProtected: () => false,
    ...overrides,
  };
}

describe('FreecivAIMilitaryPlanner', () => {
  it('ports Freeciv kill_desire shield weighting', () => {
    expect(killDesire(100, 100, 20, 25, 2)).toBeCloseTo(2153.333);
  });

  it('values every collateral victim in an unprotected field stack', () => {
    const exposed = rankMilitaryObjectives(context())[0];
    const protectedTarget = rankMilitaryObjectives(context({ isStackProtected: () => true }))[0];

    expect(exposed).toMatchObject({ kind: 'stack', victimCount: 2, benefit: 40 });
    expect(protectedTarget).toMatchObject({ victimCount: 1, benefit: 10 });
    expect(exposed.want).toBeGreaterThan(protectedTarget.want);
  });

  it('counts every city defender as an invasion victim while valuing only the selected defender', () => {
    const target = {
      id: 'city',
      playerId: 'enemy',
      x: 1,
      y: 0,
      size: 3,
      buildings: [],
    } as any;
    const objective = rankMilitaryObjectives(
      context({
        hostileCities: [target],
        isStackProtected: () => true,
      })
    )[0];

    expect(objective).toMatchObject({
      kind: 'city',
      victimCount: 2,
      benefit: 10,
    });
  });

  it('targets an undefended hostile city only with an occupying unit', () => {
    const city = {
      id: 'city',
      playerId: 'enemy',
      x: 2,
      y: 0,
      size: 4,
      buildings: ['granary'],
    } as any;
    const occupier = rankMilitaryObjectives(context({ hostileUnits: [], hostileCities: [city] }));
    const nonOccupier = rankMilitaryObjectives(
      context({
        hostileUnits: [],
        hostileCities: [city],
        attackerType: {
          ...context().attackerType,
          rulesetUnitClassFlags: [],
        },
      })
    );

    expect(occupier[0]).toMatchObject({ kind: 'city', targetId: 'city', victimCount: 0 });
    expect(nonOccupier).toEqual([]);
  });

  it('rejects objectives beyond Freeciv ten-turn attack planning', () => {
    const plan = rankMilitaryObjectives(
      context({
        hostileUnits: [unit('far', 'settler', 11, 0)],
      })
    );

    expect(plan).toEqual([]);
  });

  it('accounts for a stronger defender the target city can finish before arrival', () => {
    const target = {
      id: 'city',
      playerId: 'enemy',
      x: 2,
      y: 0,
      size: 3,
      buildings: [],
    } as any;
    const withoutProjection = rankMilitaryObjectives(
      context({ hostileUnits: [], hostileCities: [target] })
    );
    const withProjection = rankMilitaryObjectives(
      context({
        hostileUnits: [],
        hostileCities: [target],
        projectedDefender: () => ({
          rating: 1000,
          cost: 40,
          unitTypeId: 'future-defender',
        }),
      })
    );

    expect(withoutProjection[0]).toMatchObject({ targetId: target.id });
    expect(withProjection).toEqual([]);
  });

  it('selects the strongest legal projected defender against this attacker', () => {
    const attacker = context().attacker;
    const target = {
      id: 'city',
      playerId: 'enemy',
      x: 2,
      y: 0,
    } as any;
    const projected = selectProjectedCityDefender({
      gameId: 'game',
      city: target,
      attacker,
      unitTypes: [
        { id: 'cheap', roles: ['DefendOk'], movement: 1, hitpoints: 100, cost: 20 },
        { id: 'strong', roles: ['DefendGood'], movement: 1, hitpoints: 100, cost: 40 },
        { id: 'illegal', roles: ['DefendGood'], movement: 1, hitpoints: 100, cost: 10 },
      ] as any,
      canBuild: (_cityId, typeId) => typeId !== 'illegal',
      rateDefense: defender => (defender.unitTypeId === 'strong' ? 80 : 40),
    });

    expect(projected).toEqual({ rating: 80, cost: 40, unitTypeId: 'strong' });
  });

  it('charges the higher Freeciv travel cost for military unhappiness', () => {
    const content = rankMilitaryObjectives(
      context({
        hostileUnits: [unit('guard', 'warrior', 2, 0)],
      })
    )[0];
    const unhappy = rankMilitaryObjectives(
      context({
        hostileUnits: [unit('guard', 'warrior', 2, 0)],
        causesMilitaryUnhappiness: () => true,
      })
    )[0];

    expect(unhappy.want).toBeLessThan(content.want);
  });

  it('coordinates city attackers and requisitions an occupier for committed assault strength', () => {
    const base = context();
    const artilleryType = {
      ...base.attackerType,
      id: 'artillery',
      attack: 8,
      cost: 50,
      rulesetUnitClassFlags: [],
    };
    const artillery = {
      ...unit('a-artillery', 'artillery', 0, 0),
      playerId: 'ai',
    };
    const occupier = {
      ...unit('b-occupier', 'legion', 0, 0),
      playerId: 'ai',
    };
    const target = {
      id: 'target-city',
      playerId: 'enemy',
      x: 1,
      y: 0,
      size: 4,
      buildings: [],
    } as any;
    const guard = unit('guard', 'warrior', 1, 0);

    const plan = planMilitaryCampaign({
      attackers: [
        { unit: artillery, type: artilleryType },
        { unit: occupier, type: base.attackerType },
      ],
      hostileUnits: [guard],
      hostileCities: [target],
      getType: id => (id === 'artillery' ? artilleryType : base.getType(id)),
      travelTurns: (attacker, x, y) => Math.max(Math.abs(attacker.x - x), Math.abs(attacker.y - y)),
      isStackProtected: () => true,
    });

    expect(plan.assignments.get(artillery.id)).toMatchObject({
      kind: 'city',
      targetId: target.id,
    });
    expect(plan.assignments.get(occupier.id)).toMatchObject({
      kind: 'city',
      targetId: target.id,
    });
    expect(plan.invasionSupport.get(target.id)).toMatchObject({
      occupiers: 1,
      buildCost: 90,
    });
  });

  it('removes a unit from persisted invasion support before reconsidering it', () => {
    const base = context();
    const attacker = base.attacker;
    const target = {
      id: 'target-city',
      playerId: 'enemy',
      x: 2,
      y: 0,
      size: 2,
      buildings: [],
    } as any;
    const plan = planMilitaryCampaign({
      attackers: [{ unit: attacker, type: base.attackerType }],
      hostileUnits: [],
      hostileCities: [target],
      existingCityTargets: new Map([[attacker.id, target.id]]),
      getType: base.getType,
      travelTurns: (_attacker, x, y) => Math.max(Math.abs(x), Math.abs(y)),
      isStackProtected: () => true,
    });

    expect(plan.invasionSupport.get(target.id)).toMatchObject({
      occupiers: 1,
      buildCost: 40,
    });
  });

  it('rejects unreachable military targets using authoritative route results', async () => {
    const attacker = context().attacker;
    const times = await buildMilitaryTravelTimes({
      attackers: [attacker],
      targets: [
        { x: 4, y: 4 },
        { x: 8, y: 8 },
      ],
      getNeighbors: (x, y) => [{ x: x - 1, y }],
      findPath: async (_unit, x) =>
        x <= 4 ? { valid: true, estimatedTurns: 3 } : { valid: false, estimatedTurns: 0 },
    });

    expect(times.get(`${attacker.id}:4,4`)).toBe(3);
    expect(times.has(`${attacker.id}:8,8`)).toBe(false);
  });
});
