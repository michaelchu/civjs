import {
  calculateWarDesire,
  evaluateTreaty,
  type TreatyValuationContext,
} from '@game/ai/FreecivAIDiplomacyPlanner';

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
});
