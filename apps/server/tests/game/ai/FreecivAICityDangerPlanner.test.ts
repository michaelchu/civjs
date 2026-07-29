import {
  assessCityDanger,
  buildCityThreatTravelTimes,
  cityThreatTravelKey,
  dangerAssessmentTurns,
  reevaluateDefensiveBuildingWant,
} from '@game/ai/FreecivAICityDangerPlanner';
import { createAIProfile } from '@game/ai/FreecivAIProfile';

const city = { id: 'capital', x: 5, y: 5, playerId: 'ai' } as any;
const unit = (id: string, unitTypeId: string, x: number, y: number, playerId = 'enemy') =>
  ({
    id,
    unitTypeId,
    x,
    y,
    playerId,
    health: 100,
    veteranLevel: 0,
  }) as any;

const types: Record<string, any> = {
  attacker: {
    id: 'attacker',
    attack: 4,
    defense: 1,
    combat: 4,
    movement: 3,
    hitpoints: 10,
    firepower: 1,
    bombardRate: 0,
    cargoClasses: [],
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: [],
  },
  defender: {
    id: 'defender',
    attack: 1,
    defense: 4,
    combat: 1,
    movement: 3,
    hitpoints: 10,
    firepower: 1,
    bombardRate: 0,
    cargoClasses: [],
    rulesetUnitClassFlags: ['CanOccupyCity'],
    flags: [],
  },
  transport: {
    id: 'transport',
    attack: 0,
    defense: 2,
    combat: 0,
    movement: 3,
    hitpoints: 10,
    firepower: 1,
    bombardRate: 0,
    transport_capacity: 2,
    cargoClasses: ['Land'],
    rulesetUnitClassFlags: [],
    flags: [],
  },
};

describe('Freeciv AI city danger planner', () => {
  it('uses difficulty-specific assessment horizons', () => {
    expect(dangerAssessmentTurns(createAIProfile('easy'))).toBe(2);
    expect(dangerAssessmentTurns(createAIProfile('normal'))).toBe(3);
    expect(dangerAssessmentTurns(createAIProfile('hard'))).toBe(6);
  });

  it('squares attacker vulnerability once and aggregate defense once', () => {
    const assessment = assessCityDanger({
      city,
      friendlyUnits: [unit('guard', 'defender', 5, 5, 'ai')],
      threateningUnits: [unit('enemy', 'attacker', 6, 5)],
      profile: createAIProfile('normal'),
      getType: id => types[id],
      travelTurns: () => 1,
    });

    expect(assessment.danger).toBe(1600);
    expect(assessment.defense).toBe(1600);
    expect(assessment.defenseDeficit).toBe(0);
    expect(assessment).toMatchObject({ urgency: 11, graveDanger: 1 });
  });

  it('counts an approaching occupier transport as urgent despite zero attack', () => {
    const assessment = assessCityDanger({
      city,
      friendlyUnits: [],
      threateningUnits: [unit('ferry', 'transport', 7, 5)],
      profile: createAIProfile('normal'),
      getType: id => types[id],
      travelTurns: () => 2,
    });

    expect(assessment.danger).toBe(0.5);
    expect(assessment).toMatchObject({ urgency: 1, graveDanger: 0 });
  });

  it('escalates defensive building wants under urgent overwhelming danger', () => {
    expect(
      reevaluateDefensiveBuildingWant(40, {
        urgency: 11,
        danger: 1600,
        defense: 100,
      })
    ).toBe(211);
  });

  it('uses paradrop and embarked-carrier routes when they beat or replace a land path', async () => {
    const paratrooper = unit('para', 'paratrooper', 0, 0);
    const marine = {
      ...unit('marine', 'marine', 0, 0),
      transportedBy: 'carrier',
    };
    const carrier = unit('carrier', 'transport', 0, 0);
    const travel = await buildCityThreatTravelTimes({
      cities: [city],
      threateningUnits: [paratrooper, marine],
      getType: id =>
        ({
          ...types[id === 'carrier' ? 'transport' : 'attacker'],
          id,
          paratroopersRange: id === 'paratrooper' ? 3 : 0,
          flags: id === 'marine' ? ['Marines'] : [],
        }) as any,
      getUnit: id => (id === 'carrier' ? carrier : undefined),
      distance: () => 8,
      findPath: async candidate =>
        candidate.id === 'carrier'
          ? { valid: true, estimatedTurns: 3 }
          : { valid: false, estimatedTurns: 0 },
    });

    expect(travel.get(cityThreatTravelKey('para', city.id))).toBe(2);
    expect(travel.get(cityThreatTravelKey('marine', city.id))).toBe(3);
  });
});
