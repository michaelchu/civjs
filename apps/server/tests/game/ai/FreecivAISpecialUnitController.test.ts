import { ActionType } from '@app-types/shared/actions';
import { FreecivAISpecialUnitController } from '@game/ai/FreecivAISpecialUnitController';
import { createAIState } from '@game/ai/FreecivAIStateStore';

const unit = (id: string, unitTypeId: string, x: number, y: number) =>
  ({
    id,
    playerId: 'ai',
    unitTypeId,
    x,
    y,
    movementLeft: 8,
    health: 100,
    fuel: unitTypeId === 'bomber' ? 2 : 0,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  }) as any;

const types: Record<string, any> = {
  bomber: {
    id: 'bomber',
    unitClass: 'air',
    rulesetUnitClass: 'Air',
    rulesetUnitClassFlags: [],
    flags: ['AirAttacker'],
    cargoClasses: [],
    transport_capacity: 0,
    attack: 12,
    defense: 1,
    combat: 12,
    firepower: 2,
    hitpoints: 20,
    movement: 8,
    range: 1,
    fuel: 2,
    cost: 120,
    bombardRate: 0,
    paratroopersRange: 0,
  },
  carrier: {
    id: 'carrier',
    unitClass: 'naval',
    rulesetUnitClass: 'Sea',
    rulesetUnitClassFlags: [],
    flags: [],
    cargoClasses: ['Air'],
    transport_capacity: 8,
    attack: 1,
    movement: 5,
    cost: 160,
    bombardRate: 0,
    paratroopersRange: 0,
  },
  paratroopers: {
    id: 'paratroopers',
    unitClass: 'military',
    rulesetUnitClass: 'Land',
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: ['Paratroopers'],
    cargoClasses: [],
    transport_capacity: 0,
    attack: 6,
    defense: 4,
    combat: 6,
    firepower: 1,
    hitpoints: 10,
    movement: 3,
    cost: 60,
    bombardRate: 0,
    paratroopersRange: 6,
  },
  enemy: {
    id: 'enemy',
    unitClass: 'military',
    rulesetUnitClass: 'Land',
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: [],
    cargoClasses: [],
    transport_capacity: 0,
    attack: 2,
    defense: 1,
    combat: 2,
    firepower: 1,
    hitpoints: 10,
    movement: 3,
    cost: 20,
    bombardRate: 0,
    paratroopersRange: 0,
  },
};

describe('Freeciv AI special-unit controller air integration', () => {
  it('flies an aircraft to a compatible carrier and loads through authoritative actions', async () => {
    const bomber = unit('bomber', 'bomber', 1, 0);
    const carrier = unit('carrier', 'carrier', 0, 0);
    const units = new Map([
      [bomber.id, bomber],
      [carrier.id, carrier],
    ]);
    const executeUnitAction = jest.fn(
      async (unitId: string, action: ActionType, targetX: number, targetY: number) => {
        const actor = units.get(unitId)!;
        if (action === ActionType.GOTO) {
          actor.x = targetX;
          actor.y = targetY;
        }
        if (action === ActionType.LOAD_UNIT) actor.transportedBy = carrier.id;
        return { success: true };
      }
    );
    const game = {
      id: 'game',
      currentTurn: 7,
      players: new Map([['ai', { aiLevel: 'hard' }]]),
      cityManager: { getAllCities: jest.fn(() => []), getCityAt: jest.fn() },
      unitManager: {
        getPlayerUnits: jest.fn(() => [...units.values()]),
        getAllUnits: jest.fn(() => units),
        getUnit: jest.fn((id: string) => units.get(id)),
        getUnitType: jest.fn((id: string) => types[id]),
        getTransportCapacityRemaining: jest.fn(() => 8),
        calculateUnitHitpointRecovery: jest.fn(() => ({ gain: 10 })),
        calculateUnitAttackRating: jest.fn(() => 100),
        calculateUnitDefenseRating: jest.fn(() => 100),
        canUnitTargetUnit: jest.fn(() => true),
        executeUnitAction,
      },
      mapManager: {
        getMapData: jest.fn(() => ({ tiles: [] })),
        getDistance: (x1: number, y1: number, x2: number, y2: number) =>
          Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      },
      visibilityManager: {},
    } as any;
    const hostility = {
      getRelationPlayerIds: jest.fn().mockResolvedValue({
        hostile: new Set(),
        allied: new Set(),
        unknown: new Set(),
      }),
    } as any;

    const actions = await new FreecivAISpecialUnitController(hostility).manageAirAndParadrops(
      'game',
      game,
      'ai',
      createAIState()
    );

    expect(actions).toBe(2);
    expect(executeUnitAction.mock.calls).toEqual([
      ['bomber', ActionType.GOTO, 0, 0, 'ai'],
      ['bomber', ActionType.LOAD_UNIT, 0, 0, 'ai'],
    ]);
    expect(bomber.transportedBy).toBe('carrier');
  });

  it('takes a profitable adjacent fight before holding a sole city defender', async () => {
    const paratrooper = unit('para', 'paratroopers', 0, 0);
    const enemy = { ...unit('enemy', 'enemy', 1, 0), playerId: 'enemy' };
    const units = new Map([
      [paratrooper.id, paratrooper],
      [enemy.id, enemy],
    ]);
    const attackUnit = jest.fn(async () => undefined);
    const home = { id: 'home', playerId: 'ai', x: 0, y: 0, size: 4 };
    const game = {
      id: 'game',
      currentTurn: 7,
      players: new Map([['ai', { aiLevel: 'hard' }]]),
      cityManager: {
        getAllCities: jest.fn(() => [home]),
        getCityAt: jest.fn((x: number, y: number) => (x === 0 && y === 0 ? home : undefined)),
      },
      unitManager: {
        getPlayerUnits: jest.fn(() => [paratrooper]),
        getAllUnits: jest.fn(() => units),
        getUnit: jest.fn((id: string) => units.get(id)),
        getUnitType: jest.fn((id: string) => types[id]),
        calculateUnitHitpointRecovery: jest.fn(() => ({ gain: 10 })),
        calculateUnitAttackRating: jest.fn(() => 60),
        calculateUnitDefenseRating: jest.fn(() => 10),
        calculateUnitWinChance: jest.fn(() => 0.95),
        canUnitTargetUnit: jest.fn(() => true),
        attackUnit,
      },
      mapManager: {
        getMapData: jest.fn(() => ({ tiles: [] })),
        getDistance: (x1: number, y1: number, x2: number, y2: number) =>
          Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
      },
      visibilityManager: {},
    } as any;
    const hostility = {
      getRelationPlayerIds: jest.fn().mockResolvedValue({
        hostile: new Set(['enemy']),
        allied: new Set(),
        unknown: new Set(),
      }),
    } as any;

    const actions = await new FreecivAISpecialUnitController(hostility).manageAirAndParadrops(
      'game',
      game,
      'ai',
      createAIState()
    );

    expect(actions).toBe(1);
    expect(attackUnit).toHaveBeenCalledWith('para', 'enemy');
  });
});
