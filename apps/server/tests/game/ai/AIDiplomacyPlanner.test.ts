import {
  calculateWarDesire,
  evaluateTreaty,
  type TreatyValuationContext,
} from '@game/ai/AIDiplomacyPlanner';
import type { DiplomaticState, TreatyClause } from '@game/managers/DiplomacyManager';

function city(id: string, overrides: Record<string, unknown> = {}): any {
  return {
    id,
    size: 5,
    population: 5,
    productionPerTurn: 5,
    tradePerTurn: 5,
    buildings: [],
    ...overrides,
  };
}

function treatyContext(overrides: Partial<TreatyValuationContext> = {}): TreatyValuationContext {
  return {
    playerId: 'ai',
    otherPlayerId: 'other',
    currentState: 'peace',
    relation: {
      state: 'peace',
      maxState: 'peace',
      sinceTurn: 1,
      turnsLeft: 0,
      contactTurnsLeft: 10,
      hasReasonToCancel: 0,
      embassy: false,
      sharedVision: false,
      reputation: 1000,
      attitude: 0,
    },
    love: 200,
    turn: 20,
    ownCities: [city('a'), city('b'), city('c'), city('d')],
    otherCities: [city('foreign')],
    ownTechs: new Set(['alphabet']),
    otherTechs: new Set(['writing']),
    catalogue: new Map([
      ['alphabet', { id: 'alphabet', name: 'Alphabet', cost: 10, requirements: [], flags: [] }],
      ['writing', { id: 'writing', name: 'Writing', cost: 20, requirements: [], flags: [] }],
    ]),
    techWants: { writing: 100 },
    diplomacyHandicap: false,
    sharedVisionSafe: true,
    alliedWithEnemy: false,
    ...overrides,
  };
}

describe('Freeciv AI diplomacy planner', () => {
  it('prefers a nearby profitable weak empire over a distant advanced threat', () => {
    const base = {
      ownCities: [city('home')],
      targetCities: [city('rich', { size: 10, productionPerTurn: 12, tradePerTurn: 12 })],
      ownUnits: [
        { id: 'ours', unitTypeId: 'strong', playerId: 'ai' },
        { id: 'settler', unitTypeId: 'settler', playerId: 'ai' },
      ],
      targetUnits: [{ id: 'theirs', unitTypeId: 'weak', playerId: 'other' }],
      unitTypes: {
        strong: { id: 'strong', attack: 8, firepower: 1 },
        weak: { id: 'weak', attack: 1, firepower: 1 },
        settler: { id: 'settler', canFoundCity: true },
      },
      ownTechCount: 5,
      targetTechCount: 5,
      targetGold: 0,
      love: 0,
      relation: treatyContext().relation,
      aggressiveTrait: 50,
      diplomacyHandicap: false,
      targetIsHuman: false,
    } as any;
    const profitable = calculateWarDesire({ ...base, distance: 2 });
    const dangerous = calculateWarDesire({
      ...base,
      distance: 20,
      targetTechCount: 12,
      targetGold: 10_000,
      targetUnits: [
        { id: 'one', unitTypeId: 'strong', playerId: 'other' },
        { id: 'two', unitTypeId: 'strong', playerId: 'other' },
      ],
    });

    expect(profitable).toBeGreaterThan(0);
    expect(profitable).toBeGreaterThan(dangerous);
  });

  it('treats a rival launch as an overriding war target unless pursuing the space race', () => {
    const base = {
      ownCities: [city('home')],
      targetCities: [city('rival')],
      ownUnits: [],
      targetUnits: [],
      unitTypes: {},
      ownTechCount: 10,
      targetTechCount: 10,
      targetGold: 0,
      distance: 3,
      love: 500,
      relation: { ...treatyContext().relation, state: 'alliance' },
      aggressiveTrait: 50,
      diplomacyHandicap: false,
      targetIsHuman: false,
      targetSpaceshipProgress: 3,
      targetSpaceshipLaunched: true,
    } as any;

    expect(calculateWarDesire(base)).toBeGreaterThan(250);
    expect(calculateWarDesire({ ...base, pursuingSpaceVictory: true })).toBeLessThan(250);
  });

  it('accepts a favorable technology exchange and rejects gold extortion', () => {
    expect(
      evaluateTreaty(
        [
          { type: 'technology', techId: 'writing', giverId: 'other' },
          { type: 'technology', techId: 'alphabet', giverId: 'ai' },
        ],
        treatyContext()
      )
    ).toMatchObject({ acceptable: true });
    expect(
      evaluateTreaty([{ type: 'gold', amount: 500, giverId: 'ai' }], treatyContext())
    ).toMatchObject({ acceptable: false, balance: -500 });
  });

  it('never gives away a capital, its last three cities, or unsafe vision', () => {
    const capital = city('capital', { buildings: ['palace'] });
    expect(
      evaluateTreaty(
        [{ type: 'city', cityId: 'capital', giverId: 'ai' }],
        treatyContext({ ownCities: [capital, city('b'), city('c'), city('d')] })
      ).acceptable
    ).toBe(false);
    expect(
      evaluateTreaty(
        [{ type: 'city', cityId: 'a', giverId: 'ai' }],
        treatyContext({ ownCities: [city('a'), city('b'), city('c')] })
      ).acceptable
    ).toBe(false);
    expect(
      evaluateTreaty(
        [{ type: 'shared_vision', giverId: 'ai' }],
        treatyContext({ currentState: 'alliance', sharedVisionSafe: false })
      ).acceptable
    ).toBe(false);
  });

  it('refuses deeper pacts while the partner remains allied with an enemy', () => {
    expect(
      evaluateTreaty(
        [{ type: 'alliance', giverId: 'other' }],
        treatyContext({ alliedWithEnemy: true })
      ).acceptable
    ).toBe(false);
  });

  it('requires peace before an outgoing wartime material deal', () => {
    const war = treatyContext({
      currentState: 'war',
      relation: { ...treatyContext().relation, state: 'war' },
    });
    expect(evaluateTreaty([{ type: 'gold', amount: 50, giverId: 'ai' }], war).acceptable).toBe(
      false
    );
    expect(
      evaluateTreaty(
        [
          { type: 'ceasefire', giverId: 'other' },
          { type: 'gold', amount: 50, giverId: 'other' },
        ],
        war
      ).acceptable
    ).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/ai/default/daidiplomacy.c:406-449
   * @assertion The treaty ladder rejects or permits ceasefire, peace, and alliance clauses at the same diplomatic-state boundaries.
   */
  it.each<{
    currentState: DiplomaticState;
    turnsLeft: number;
    clause: TreatyClause;
    acceptable: boolean;
  }>([
    {
      currentState: 'war',
      turnsLeft: 0,
      clause: { type: 'peace', giverId: 'other' },
      acceptable: false,
    },
    {
      currentState: 'war',
      turnsLeft: 0,
      clause: { type: 'ceasefire', giverId: 'other' },
      acceptable: true,
    },
    {
      currentState: 'ceasefire',
      turnsLeft: 5,
      clause: { type: 'peace', giverId: 'other' },
      acceptable: false,
    },
    {
      currentState: 'ceasefire',
      turnsLeft: 4,
      clause: { type: 'peace', giverId: 'other' },
      acceptable: true,
    },
    {
      currentState: 'armistice',
      turnsLeft: 0,
      clause: { type: 'peace', giverId: 'other' },
      acceptable: true,
    },
    {
      currentState: 'peace',
      turnsLeft: 0,
      clause: { type: 'alliance', giverId: 'other' },
      acceptable: true,
    },
  ])(
    'enforces the reference treaty ladder for $currentState and $clause.type',
    ({ currentState, turnsLeft, clause, acceptable }) => {
      // @reference reference/freeciv/ai/default/daidiplomacy.c:406-449
      const context = treatyContext({
        currentState,
        relation: {
          ...treatyContext().relation,
          state: currentState,
          turnsLeft,
        },
      });

      expect(evaluateTreaty([clause], context).acceptable).toBe(acceptable);
    }
  );
});
