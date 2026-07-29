import { planSpaceship } from '@game/ai/FreecivAISpaceshipPlanner';
import { makeAICity } from '../../fixtures/aiFixtures';

function city(
  id: string,
  playerId: string,
  productionPerTurn: number,
  buildings: string[] = []
): any {
  return makeAICity({
    id,
    name: id,
    playerId,
    productionPerTurn,
    buildings,
  });
}

describe('Freeciv AI spaceship planner', () => {
  it('prioritizes Apollo and its enabling technology for a production leader', () => {
    const plan = planSpaceship({
      enabled: true,
      playerId: 'ai',
      citiesByPlayer: new Map([
        ['ai', [city('capital', 'ai', 20)]],
        ['rival', [city('rival', 'rival', 5)]],
      ]),
      technologyCount: playerId => (playerId === 'ai' ? 10 : 8),
      spaceshipState: () => ({}),
    });

    expect(plan.pursuing).toBe(true);
    expect(plan.buildingWants.get('capital')?.get('apollo_program')).toMatchObject({
      want: 160,
      reason: 'enable space race',
    });
    expect(plan.technologyWants.get('space_flight')).toBe(160);
  });

  it('commits fully to all remaining ship part classes after construction starts', () => {
    const plan = planSpaceship({
      enabled: true,
      playerId: 'ai',
      citiesByPlayer: new Map([
        ['ai', [city('capital', 'ai', 20, ['apollo_program']), city('factory', 'ai', 12)]],
        ['rival', [city('rival', 'rival', 8)]],
      ]),
      technologyCount: () => 10,
      spaceshipState: playerId => (playerId === 'ai' ? { structurals: 1 } : {}),
    });

    expect(plan.buildingWants.get('factory')?.get('space_structural')?.want).toBe(630);
    expect(plan.buildingWants.get('factory')?.get('space_component')?.want).toBe(630);
    expect(plan.buildingWants.get('factory')?.get('space_module')?.want).toBe(630);
    expect(plan.technologyWants.get('superconductors')).toBe(630);
  });

  it('does not pursue a disabled space race', () => {
    expect(
      planSpaceship({
        enabled: false,
        playerId: 'ai',
        citiesByPlayer: new Map([['ai', [city('capital', 'ai', 20)]]]),
        technologyCount: () => 10,
        spaceshipState: () => ({}),
      }).pursuing
    ).toBe(false);
  });

  it('does not pursue when the player has no surviving city', () => {
    const plan = planSpaceship({
      enabled: true,
      playerId: 'ai',
      citiesByPlayer: new Map([
        ['ai', []],
        ['rival', [city('rival', 'rival', 10)]],
      ]),
      technologyCount: () => 10,
      spaceshipState: () => ({}),
    });

    expect(plan.pursuing).toBe(false);
    expect(plan.buildingWants.size).toBe(0);
  });

  it('does not pursue when another player leads both production and technology', () => {
    const plan = planSpaceship({
      enabled: true,
      playerId: 'ai',
      citiesByPlayer: new Map([
        ['ai', [city('capital', 'ai', 5)]],
        ['rival', [city('rival', 'rival', 20)]],
      ]),
      technologyCount: playerId => (playerId === 'rival' ? 12 : 8),
      spaceshipState: () => ({}),
    });

    expect(plan.pursuing).toBe(false);
    expect(plan.leaderId).toBeUndefined();
  });

  it('responds to a rival ship lead and discounts part production in a wonder city', () => {
    const wonderCity = city('wonder', 'ai', 10, ['apollo_program']);
    wonderCity.productionType = 'building';
    wonderCity.currentProduction = 'great_library';
    const plan = planSpaceship({
      enabled: true,
      playerId: 'ai',
      citiesByPlayer: new Map([
        ['ai', [wonderCity, city('factory', 'ai', 8)]],
        ['rival', [city('rival', 'rival', 20)]],
      ]),
      technologyCount: playerId => (playerId === 'rival' ? 12 : 8),
      spaceshipState: playerId => (playerId === 'rival' ? { structurals: 3 } : {}),
    });

    expect(plan.pursuing).toBe(true);
    expect(plan.leaderId).toBe('rival');
    expect(plan.buildingWants.get('wonder')?.get('space_structural')?.want).toBe(120);
    expect(plan.buildingWants.get('factory')?.get('space_structural')?.want).toBe(210);
    expect(plan.technologyWants.get('plastics')).toBe(210);
  });
});
