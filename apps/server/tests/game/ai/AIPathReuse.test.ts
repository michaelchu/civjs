import { buildCityThreatTravelTimes, cityThreatTravelKey } from '@game/ai/AICityDangerPlanner';
import { buildMilitaryTravelTimes } from '@game/ai/AIMilitaryPlanner';
import type { Unit } from '@game/units/UnitTypes';

function unit(id: string, x = 0, y = 0): Unit {
  return {
    id,
    gameId: 'game',
    playerId: 'player',
    unitTypeId: 'warrior',
    x,
    y,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  };
}

describe('AI path reuse', () => {
  it('resolves shared attacker target-neighbor destinations once per attacker', async () => {
    const attacker = unit('attacker');
    const findPath = jest.fn(async () => ({ valid: true, estimatedTurns: 2 }));
    const times = await buildMilitaryTravelTimes({
      attackers: [attacker],
      targets: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
      getNeighbors: () => [{ x: 0, y: 0 }],
      findPath,
    });

    expect(findPath).toHaveBeenCalledTimes(3);
    expect(times.get('attacker:2,2')).toBe(2);
    expect(times.get('attacker:3,2')).toBe(2);
  });

  it('resolves a shared carrier/city route once for multiple transported threats', async () => {
    const city = { id: 'city', playerId: 'defender', x: 5, y: 5 } as any;
    const carrier = unit('carrier');
    const marineOne = { ...unit('marine-one'), unitTypeId: 'marine', transportedBy: carrier.id };
    const marineTwo = { ...unit('marine-two'), unitTypeId: 'marine', transportedBy: carrier.id };
    const findPath = jest.fn(async (actor: Unit) => ({
      valid: true,
      estimatedTurns: actor.id === carrier.id ? 3 : 6,
    }));

    const times = await buildCityThreatTravelTimes({
      cities: [city],
      threateningUnits: [marineOne, marineTwo],
      getType: id =>
        ({
          id,
          paratroopersRange: 0,
          flags: id === 'marine' ? ['Marines'] : [],
          rulesetUnitClassFlags: [],
        }) as any,
      getUnit: id => (id === carrier.id ? carrier : undefined),
      distance: () => 20,
      findPath,
    });

    expect(findPath).toHaveBeenCalledTimes(3);
    expect(times.get(cityThreatTravelKey(marineOne.id, city.id))).toBe(3);
    expect(times.get(cityThreatTravelKey(marineTwo.id, city.id))).toBe(3);
  });
});
