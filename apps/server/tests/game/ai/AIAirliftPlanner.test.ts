import { planDefenderAirlift } from '@game/ai/AIAirliftPlanner';
import { makeAICity, makeAIUnit } from '../../fixtures/aiFixtures';

const assessment = (
  city: ReturnType<typeof makeAICity>,
  overrides: Partial<{
    danger: number;
    urgency: number;
    defense: number;
    defenseDeficit: number;
  }> = {}
) => ({
  city,
  danger: 0,
  urgency: 0,
  graveDanger: 0,
  defense: 0,
  defenseDeficit: 0,
  assessTurns: 3,
  ...overrides,
});

describe('Freeciv defender airlift planner', () => {
  const safe = makeAICity({ id: 'safe', x: 0, y: 0 });
  const frontier = makeAICity({ id: 'frontier', x: 8, y: 8 });
  const defender = makeAIUnit({
    id: 'defender',
    unitTypeId: 'legion',
    x: safe.x,
    y: safe.y,
  });
  const type = { id: 'legion', attack: 4, defense: 4, movement: 1 } as any;

  it('airlifts an idle attacker from a safe city to the neediest city', () => {
    const plan = planDefenderAirlift({
      assessments: [
        assessment(safe),
        assessment(frontier, { danger: 10, urgency: 12, defenseDeficit: 8 }),
      ],
      units: [defender],
      tasks: {},
      getCityAt: (x, y) => (x === safe.x && y === safe.y ? safe : undefined),
      getType: () => type,
      canAirlift: () => true,
    });

    expect(plan).toMatchObject({
      unit: { id: 'defender' },
      sourceCity: { id: 'safe' },
      targetCity: { id: 'frontier' },
    });
  });

  it('does not strip defense from an urgent source or divert a specialized unit', () => {
    expect(
      planDefenderAirlift({
        assessments: [
          assessment(safe, { danger: 4, urgency: 1, defenseDeficit: 1 }),
          assessment(frontier, { danger: 10, urgency: 12, defenseDeficit: 8 }),
        ],
        units: [defender],
        tasks: {
          defender: { role: 'hunter', targetId: 'enemy', assignedTurn: 2 },
        },
        getCityAt: () => safe,
        getType: () => type,
        canAirlift: () => true,
      })
    ).toBeUndefined();
  });
});
