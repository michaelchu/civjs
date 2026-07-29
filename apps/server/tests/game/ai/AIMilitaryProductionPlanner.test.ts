import { rankVirtualMilitaryProduction } from '@game/ai/AIMilitaryProductionPlanner';

describe('FreecAIMilitaryProductionPlanner', () => {
  it('scores legal conventional attackers as virtual units against reachable targets', async () => {
    const types: Record<string, any> = {
      legion: {
        id: 'legion',
        attack: 4,
        defense: 2,
        combat: 4,
        cost: 40,
        movement: 1,
        hitpoints: 100,
        firepower: 1,
        rulesetUnitClassFlags: ['CanOccupyCity'],
        flags: [],
      },
      bomber: {
        id: 'bomber',
        attack: 12,
        defense: 1,
        combat: 12,
        cost: 80,
        movement: 8,
        hitpoints: 100,
        firepower: 2,
        fuel: 2,
        rulesetUnitClassFlags: [],
        flags: [],
      },
    };
    const wants = await rankVirtualMilitaryProduction({
      gameId: 'game',
      playerId: 'ai',
      city: { id: 'home', playerId: 'ai', x: 0, y: 0 } as any,
      unitTypes: Object.values(types),
      targetUnits: [],
      targetCities: [
        {
          id: 'target',
          playerId: 'enemy',
          x: 2,
          y: 0,
          size: 3,
          buildings: [],
        } as any,
      ],
      canBuild: (_cityId, typeId) => typeId !== 'illegal',
      getType: typeId => types[typeId],
      getNeighbors: (x, y) => [{ x: x - 1, y }],
      findPath: async () => ({ valid: true, estimatedTurns: 2 }),
      isStackProtected: () => true,
      rateAttack: unit => types[unit.unitTypeId].attack * unit.health,
      rateDefense: () => 1,
      causesMilitaryUnhappiness: () => false,
    });

    expect(wants.get('legion')).toBeGreaterThan(0);
    expect(wants.has('bomber')).toBe(false);
  });
});
