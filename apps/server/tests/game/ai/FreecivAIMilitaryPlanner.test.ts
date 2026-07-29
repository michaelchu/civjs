import {
  killDesire,
  rankMilitaryObjectives,
  type MilitaryPlanningContext,
} from '@game/ai/FreecivAIMilitaryPlanner';

function unit(id: string, unitTypeId: string, x: number, y: number, health = 100): any {
  return {
    id,
    playerId: id === 'attacker' ? 'ai' : 'enemy',
    unitTypeId,
    x,
    y,
    movementLeft: 3,
    health,
    veteranLevel: 0,
    fortified: false,
  };
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
    distance: (x, y) => Math.max(Math.abs(x), Math.abs(y)),
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
});
