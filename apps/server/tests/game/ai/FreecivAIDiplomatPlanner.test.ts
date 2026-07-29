import { ActionType } from '@app-types/shared/actions';
import { planDiplomatMissions } from '@game/ai/FreecivAIDiplomatPlanner';

const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'ai') =>
  ({
    id,
    unitTypeId,
    x,
    y,
    playerId,
    movementLeft: 3,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
  }) as any;
const city = (id: string, playerId: string, x: number, y: number, buildings: string[] = []) =>
  ({ id, playerId, x, y, size: 5, buildings }) as any;
const types: Record<string, any> = {
  diplomat: { flags: ['Diplomat'], cost: 30 },
  spy: { flags: ['Diplomat', 'Spy'], cost: 50 },
  cavalry: { flags: [], cost: 80, canFoundCity: false, canBuildImprovements: false },
};
const base = {
  friendlyUnits: [] as any[],
  hostileUnits: [] as any[],
  foreignCities: [] as any[],
  friendlyCities: [] as any[],
  hostilePlayerIds: new Set(['enemy']),
  getType: (id: string) => types[id],
  distance: (x1: number, y1: number, x2: number, y2: number) =>
    Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2)),
};

describe('Freeciv AI diplomat planner', () => {
  it('uses a spy to sabotage a valuable hostile city', () => {
    const missions = planDiplomatMissions({
      ...base,
      diplomats: [unit('spy', 'spy', 0, 0)],
      foreignCities: [city('target', 'enemy', 2, 0, ['factory'])],
    });
    expect(missions[0]).toMatchObject({
      action: ActionType.SABOTAGE_CITY,
      targetId: 'target',
    });
  });

  it('prefers bribing a nearby expensive military unit', () => {
    const missions = planDiplomatMissions({
      ...base,
      diplomats: [unit('dip', 'diplomat', 0, 0)],
      hostileUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
      foreignCities: [city('far-city', 'enemy', 12, 0)],
    });
    expect(missions[0]).toMatchObject({
      action: ActionType.BRIBE_UNIT,
      targetId: 'cavalry',
    });
  });

  it('returns no missions under the diplomat handicap', () => {
    expect(
      planDiplomatMissions({
        ...base,
        diplomats: [unit('dip', 'diplomat', 0, 0)],
        diplomatHandicap: true,
      })
    ).toEqual([]);
  });
});
