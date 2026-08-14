import {
  mergeTechnologyWants,
  rankEffectTechnologyWants,
  rankThreatTechnologyWants,
} from '@game/ai/AITechnologyWantPlanner';
import { makeAICity } from '../../fixtures/aiFixtures';

const city = (buildings: string[] = []) => makeAICity({ id: 'capital', buildings });

describe('Freeciv AI technology want planner', () => {
  it('values a technology-gated effect only where its other requirements hold', () => {
    const wants = rankEffectTechnologyWants(
      [city(['temple']), city()],
      {
        mysticism_content: {
          id: 'mysticism_content',
          type: 'Make_Content',
          value: 1,
          reqs: [
            { type: 'Building', name: 'Temple', range: 'City' },
            { type: 'Tech', name: 'Mysticism', range: 'Player' },
          ],
        },
      } as any,
      new Set()
    );

    expect(wants.get('mysticism')).toBe(30);
    expect(rankEffectTechnologyWants([city(['temple'])], {} as any, new Set())).toEqual(new Map());
  });

  it('raises the unlock for a defender stronger than current production', () => {
    const wants = rankThreatTechnologyWants({
      cities: [city()],
      hostileUnits: [
        {
          id: 'enemy',
          unitTypeId: 'attacker',
          health: 100,
        } as any,
      ],
      unitTypes: {
        attacker: { id: 'attacker', attack: 6, defense: 2 } as any,
        current: { id: 'current', defense: 2 } as any,
        future: { id: 'future', defense: 6, requiredTech: 'Bronze Working' } as any,
      },
      researchedTechs: new Set(),
      canBuildNow: (_cityId, unitTypeId) => unitTypeId === 'current',
    });

    expect(wants.get('bronze_working')).toBeGreaterThan(0);
  });

  it('does not evaluate city production when there is no observed attacker', () => {
    const canBuildNow = jest.fn(() => true);

    expect(
      rankThreatTechnologyWants({
        cities: [city()],
        hostileUnits: [],
        unitTypes: {
          current: { id: 'current', defense: 2 } as any,
          future: { id: 'future', defense: 6, requiredTech: 'Bronze Working' } as any,
        },
        researchedTechs: new Set(),
        canBuildNow,
      })
    ).toEqual(new Map());
    expect(canBuildNow).not.toHaveBeenCalled();
  });

  it('merges normalized advisor sources', () => {
    expect(
      mergeTechnologyWants(new Map([['Bronze Working', 10]]), new Map([['bronze_working', 5]]))
    ).toEqual(new Map([['bronze_working', 15]]));
  });
});
