import { ActionType } from '@app-types/shared/actions';
import {
  planDiplomatMissions,
  rankDiplomatTechnologyWants,
  rankVirtualDiplomatProduction,
} from '@game/ai/FreecivAIDiplomatPlanner';
import { makeAICity, makeAIUnit } from '../../fixtures/aiFixtures';

const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'ai') =>
  makeAIUnit({
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
  });
const city = (id: string, playerId: string, x: number, y: number, buildings: string[] = []) =>
  makeAICity({
    id,
    name: id,
    playerId,
    x,
    y,
    size: 5,
    buildings,
    happiness: { happy: 0, content: 5, unhappy: 0, angry: 0 },
    foodPerTurn: 3,
    productionPerTurn: 4,
    tradePerTurn: 3,
    sciencePerTurn: 2,
    goldPerTurn: 1,
  });
const types: Record<string, any> = {
  diplomat: {
    id: 'diplomat',
    flags: ['Diplomat'],
    cost: 30,
    movement: 3,
    requiredTech: 'writing',
  },
  spy: {
    id: 'spy',
    flags: ['Diplomat', 'Spy'],
    cost: 50,
    movement: 3,
    requiredTech: 'espionage',
  },
  cavalry: {
    id: 'cavalry',
    flags: [],
    cost: 80,
    attack: 8,
    movement: 6,
    canFoundCity: false,
    canBuildImprovements: false,
  },
  settlers: {
    id: 'settlers',
    flags: [],
    cost: 40,
    movement: 3,
    canFoundCity: true,
    canBuildImprovements: true,
  },
};
const distance = (x1: number, y1: number, x2: number, y2: number) =>
  Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

function context(overrides: Record<string, unknown> = {}) {
  return {
    diplomats: [unit('dip', 'diplomat', 0, 0)],
    friendlyUnits: [unit('dip', 'diplomat', 0, 0)],
    foreignUnits: [],
    foreignCities: [],
    friendlyCities: [],
    getType: (id: string) => types[id],
    distance,
    travelCost: (actor: any, x: number, y: number) => distance(actor.x, actor.y, x, y),
    relation: () => ({ allied: false, atWar: true, hasEmbassy: false }),
    countStealableTechs: () => 1,
    inciteCost: () => 100,
    bribeCost: () => 50,
    canBribeUnit: () => true,
    canInciteCity: () => true,
    actionOdds: (actor: any) => ({
      successChance: 1,
      escapeChance: actor.unitTypeId === 'spy' ? 1 : 0,
    }),
    cityUrgency: () => 0,
    cityDiplomatThreat: () => false,
    cityDiplomatDefender: () => undefined,
    unitThreatensDiplomat: () => true,
    gold: 500,
    goldReserve: 100,
    ...overrides,
  } as any;
}

describe('Freeciv AI diplomat planner', () => {
  it('establishes a missing embassy before attempting hostile espionage', () => {
    const missions = planDiplomatMissions(
      context({
        diplomats: [unit('spy', 'spy', 0, 0)],
        friendlyUnits: [unit('spy', 'spy', 0, 0)],
        foreignCities: [city('target', 'enemy', 2, 0, ['factory'])],
      })
    );
    expect(missions[0]).toMatchObject({
      action: ActionType.ESTABLISH_EMBASSY,
      targetId: 'target',
    });
  });

  it('steals technology before incitement and wartime sabotage once an embassy exists', () => {
    const missions = planDiplomatMissions(
      context({
        diplomats: [unit('spy', 'spy', 0, 0)],
        friendlyUnits: [unit('spy', 'spy', 0, 0)],
        foreignCities: [city('target', 'enemy', 2, 0, ['factory'])],
        relation: () => ({ allied: false, atWar: true, hasEmbassy: true }),
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.STEAL_TECH });
  });

  it('incites an affordable city when no technology is stealable', () => {
    const missions = planDiplomatMissions(
      context({
        foreignCities: [city('target', 'enemy', 2, 0, ['factory'])],
        relation: () => ({ allied: false, atWar: true, hasEmbassy: true }),
        countStealableTechs: () => 0,
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.INCITE_CITY });
  });

  it('uses wartime sabotage when incitement is unaffordable', () => {
    const spy = unit('spy', 'spy', 0, 0);
    const missions = planDiplomatMissions(
      context({
        diplomats: [spy],
        friendlyUnits: [spy],
        foreignCities: [city('target', 'enemy', 2, 0, ['factory'])],
        relation: () => ({ allied: false, atWar: true, hasEmbassy: true }),
        countStealableTechs: () => 0,
        inciteCost: () => 1_000,
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.SABOTAGE_CITY });
  });

  it('poisons a wartime city when stronger spy actions are unavailable', () => {
    const spy = unit('spy', 'spy', 0, 0);
    const missions = planDiplomatMissions(
      context({
        diplomats: [spy],
        friendlyUnits: [spy],
        foreignCities: [city('target', 'enemy', 2, 0)],
        relation: () => ({ allied: false, atWar: true, hasEmbassy: true }),
        countStealableTechs: () => 0,
        canInciteCity: () => false,
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.POISON_WATER });
  });

  it('prefers bribing an affordable nearby military unit before a city mission', () => {
    const missions = planDiplomatMissions(
      context({
        foreignUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
        foreignCities: [city('target', 'enemy', 2, 0)],
      })
    );
    expect(missions[0]).toMatchObject({
      action: ActionType.BRIBE_UNIT,
      targetId: 'cavalry',
    });
  });

  it('sabotages an immediate threat when a spy cannot afford to bribe it', () => {
    const spy = unit('spy', 'spy', 0, 0);
    const missions = planDiplomatMissions(
      context({
        diplomats: [spy],
        friendlyUnits: [spy],
        foreignUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
        bribeCost: () => 1_000,
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.SABOTAGE_UNIT });
  });

  it('preserves the treasury reserve when bribing a non-threatening unit', () => {
    const missions = planDiplomatMissions(
      context({
        foreignUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
        bribeCost: () => 450,
        unitThreatensDiplomat: () => false,
      })
    );
    expect(missions).toEqual([]);
  });

  it('does not plan bribery or incitement forbidden by the target government', () => {
    const missions = planDiplomatMissions(
      context({
        foreignUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
        foreignCities: [city('target', 'enemy', 2, 0)],
        relation: () => ({ allied: false, atWar: false, hasEmbassy: true }),
        countStealableTechs: () => 0,
        canBribeUnit: () => false,
        canInciteCity: () => false,
      })
    );
    expect(missions).toEqual([]);
  });

  it('lets a spy sabotage a wartime threat even when bribery is forbidden', () => {
    const spy = unit('spy', 'spy', 0, 0);
    const missions = planDiplomatMissions(
      context({
        diplomats: [spy],
        friendlyUnits: [spy],
        foreignUnits: [unit('cavalry', 'cavalry', 1, 0, 'enemy')],
        canBribeUnit: () => false,
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.SABOTAGE_UNIT });
  });

  it('holds the sole diplomat in a threatened city', () => {
    const home = city('home', 'ai', 0, 0);
    const missions = planDiplomatMissions(
      context({
        friendlyCities: [home],
        cityDiplomatThreat: (candidate: any) => candidate.id === home.id,
      })
    );
    expect(missions[0]).toMatchObject({ kind: 'hold', targetId: 'home' });
  });

  it('moves an idle diplomat to the most urgent undefended friendly city', () => {
    const missions = planDiplomatMissions(
      context({
        friendlyCities: [city('quiet', 'ai', 1, 0), city('threatened', 'ai', 3, 0)],
        cityDiplomatThreat: (candidate: any) => candidate.id === 'threatened',
        cityUrgency: (candidate: any) => (candidate.id === 'threatened' ? 3 : 0),
      })
    );
    expect(missions[0]).toMatchObject({ kind: 'defend', targetId: 'threatened' });
  });

  it('uses action success and escape odds in mission value', () => {
    const missions = planDiplomatMissions(
      context({
        foreignCities: [city('target', 'enemy', 1, 0)],
        relation: () => ({ allied: false, atWar: true, hasEmbassy: true }),
        actionOdds: (_actor: any, action: ActionType) => ({
          successChance: action === ActionType.STEAL_TECH ? 0.01 : 1,
          escapeChance: 0,
        }),
      })
    );
    expect(missions[0]).toMatchObject({ action: ActionType.INCITE_CITY });
  });

  it('returns no missions under the diplomat handicap', () => {
    expect(planDiplomatMissions(context({ diplomatHandicap: true }))).toEqual([]);
  });

  it('only excludes workers and founders when the war-footing handicap is active', () => {
    const settler = unit('settlers', 'settlers', 1, 0, 'enemy');
    expect(planDiplomatMissions(context({ foreignUnits: [settler] }))[0]).toMatchObject({
      action: ActionType.BRIBE_UNIT,
    });
    expect(
      planDiplomatMissions(context({ foreignUnits: [settler], noBribeWarFooting: true }))
    ).toEqual([]);
  });

  it('requests an overwhelming defensive diplomat when a defended city is threatened', () => {
    const wants = rankVirtualDiplomatProduction({
      playerId: 'ai',
      city: city('home', 'ai', 0, 0),
      unitTypes: [types.diplomat],
      friendlyUnits: [unit('guard', 'cavalry', 0, 0)],
      foreignCities: [],
      canBuild: () => true,
      travelTurns: () => Infinity,
      relation: () => ({ allied: false, atWar: true, hasEmbassy: false }),
      countStealableTechs: () => 0,
      inciteCost: () => Infinity,
      canInciteCity: () => true,
      actionOdds: () => ({ successChance: 1, escapeChance: 0 }),
      cityDiplomatThreat: true,
      cityUrgency: 1,
      conventionalDefenderCount: 1,
      gold: 100,
      goldReserve: 50,
    });
    expect(wants.get('diplomat')).toBe(16_000);
  });

  it('values an offensive diplomat for a reachable missing embassy', () => {
    const wants = rankVirtualDiplomatProduction({
      playerId: 'ai',
      city: city('home', 'ai', 0, 0),
      unitTypes: [types.diplomat],
      friendlyUnits: [],
      foreignCities: [city('target', 'enemy', 3, 0)],
      canBuild: () => true,
      travelTurns: () => 2,
      relation: () => ({ allied: false, atWar: false, hasEmbassy: false }),
      countStealableTechs: () => 0,
      inciteCost: () => Infinity,
      canInciteCity: () => true,
      actionOdds: () => ({ successChance: 1, escapeChance: 0 }),
      cityDiplomatThreat: false,
      cityUrgency: 0,
      conventionalDefenderCount: 0,
      gold: 100,
      goldReserve: 50,
    });
    expect(wants.get('diplomat')).toBeGreaterThanOrEqual(99);
  });

  it('strongly requests missing diplomat technology for a threatened defended city', () => {
    const wants = rankDiplomatTechnologyWants({
      unitTypes: [types.diplomat],
      knownTechs: new Set(),
      cityDiplomatThreat: true,
      conventionalDefenderCount: 1,
      canBuild: () => false,
    });
    expect(wants.get('writing')).toBe(3_000);
  });
});
