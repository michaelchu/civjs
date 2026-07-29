import { planAirMissions } from '@game/ai/FreecivAIAirPlanner';

const unit = (id: string, unitTypeId: string, x: number, y: number, fuel?: number) =>
  ({
    id,
    playerId: id.startsWith('enemy') ? 'enemy' : 'ai',
    unitTypeId,
    x,
    y,
    fuel,
    movementLeft: 6,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  }) as any;
const city = (id: string, playerId: string, x: number, y: number, size = 4) =>
  ({ id, playerId, x, y, size, buildings: [] }) as any;
const types: Record<string, any> = {
  bomber: {
    unitClass: 'air',
    attack: 12,
    combat: 12,
    firepower: 2,
    hitpoints: 20,
    movement: 8,
    range: 8,
    fuel: 2,
    cost: 80,
    paratroopersRange: 0,
  },
  paratrooper: {
    unitClass: 'military',
    attack: 6,
    movement: 1,
    range: 1,
    cost: 60,
    paratroopersRange: 5,
  },
  tank: {
    unitClass: 'military',
    attack: 10,
    combat: 10,
    firepower: 1,
    hitpoints: 20,
    movement: 3,
    range: 1,
    cost: 80,
    paratroopersRange: 0,
  },
};
const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

describe('Freeciv AI air planner', () => {
  it('returns a low-fuel aircraft to the nearest friendly city', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 3, 0, 1)],
      hostileUnits: [unit('enemy-tank', 'tank', 4, 0)],
      friendlyCities: [city('base', 'ai', 2, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'return', targetX: 2, targetY: 0 });
  });

  it('strikes a profitable visible target when fuel is safe', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('plane', 'bomber', 0, 0, 2)],
      hostileUnits: [unit('enemy-tank', 'tank', 3, 0)],
      friendlyCities: [city('base', 'ai', 0, 0)],
      hostileCities: [],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'strike', target: { id: 'enemy-tank' } });
  });

  it('paradrops into the most valuable undefended hostile city in range', () => {
    const missions = planAirMissions({
      friendlyUnits: [unit('para', 'paratrooper', 0, 0)],
      hostileUnits: [],
      friendlyCities: [],
      hostileCities: [city('small', 'enemy', 2, 0, 2), city('large', 'enemy', 4, 0, 6)],
      getType: id => types[id],
      distance,
    });
    expect(missions[0]).toMatchObject({ kind: 'paradrop', targetCity: { id: 'large' } });
  });
});
