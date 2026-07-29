import { CIVJS_AI_CONTRACT, CivJSAIAdapter } from '@game/services/CivJSAIAdapter';
import { ActionType } from '@app-types/shared/actions';

type TestUnit = {
  id: string;
  playerId: string;
  unitTypeId: string;
  x: number;
  y: number;
  movementLeft: number;
  health: number;
  veteranLevel: number;
  experience: number;
  fortified: boolean;
  automation?: 'explore' | 'settler';
  transportedBy?: string;
};

function createScenario() {
  const units = new Map<string, TestUnit>([
    [
      'settler',
      {
        id: 'settler',
        playerId: 'ai',
        unitTypeId: 'settlers',
        x: 2,
        y: 2,
        movementLeft: 3,
        health: 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
    [
      'worker',
      {
        id: 'worker',
        playerId: 'ai',
        unitTypeId: 'worker',
        x: 3,
        y: 3,
        movementLeft: 3,
        health: 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
    [
      'warrior',
      {
        id: 'warrior',
        playerId: 'ai',
        unitTypeId: 'warriors',
        x: 4,
        y: 4,
        movementLeft: 3,
        health: 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
    [
      'scout',
      {
        id: 'scout',
        playerId: 'ai',
        unitTypeId: 'explorer',
        x: 7,
        y: 7,
        movementLeft: 3,
        health: 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
    [
      'enemy',
      {
        id: 'enemy',
        playerId: 'human',
        unitTypeId: 'warriors',
        x: 5,
        y: 4,
        movementLeft: 3,
        health: 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
  ]);
  const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
  const attackUnit = jest.fn().mockResolvedValue({ defenderDestroyed: true });
  const setCurrentResearch = jest.fn().mockResolvedValue(undefined);
  const setCityProduction = jest.fn().mockResolvedValue(true);
  const diplomacyManager = {
    getSnapshot: jest.fn().mockResolvedValue({
      nations: [
        {
          id: 'human',
          relation: {
            state: 'war',
            proposal: {
              id: 'peace-proposal',
              recipientId: 'ai',
              status: 'pending',
              clauses: [{ type: 'peace' }],
            },
          },
        },
        {
          id: 'other-ai',
          relation: {
            state: 'peace',
            proposal: {
              id: 'alliance-proposal',
              recipientId: 'ai',
              status: 'pending',
              clauses: [{ type: 'alliance' }],
            },
          },
        },
      ],
    }),
    respondToTreaty: jest.fn().mockResolvedValue(undefined),
    proposeTreaty: jest.fn().mockResolvedValue(undefined),
  };
  const unitTypes: Record<string, Record<string, unknown>> = {
    settlers: { canFoundCity: true, canBuildImprovements: false, attack: 0, movement: 1 },
    worker: { canFoundCity: false, canBuildImprovements: true, attack: 0, movement: 1 },
    warriors: {
      canFoundCity: false,
      canBuildImprovements: false,
      attack: 1,
      defense: 1,
      range: 1,
    },
    explorer: { canFoundCity: false, canBuildImprovements: false, attack: 0, movement: 3 },
  };
  const game = {
    state: 'active',
    players: new Map([
      ['human', { id: 'human', isAI: false }],
      ['ai', { id: 'ai', isAI: true }],
    ]),
    researchManager: {
      getPlayerResearch: (): { currentTech: string | undefined } => ({
        currentTech: undefined,
      }),
      getAvailableTechnologies: () => [
        { id: 'writing', cost: 30 },
        { id: 'alphabet', cost: 10 },
      ],
      setCurrentResearch,
    },
    cityManager: {
      getPlayerCities: () => [
        {
          id: 'capital',
          currentProduction: null,
          goldPerTurn: -2,
          buildings: [],
        },
      ],
      setCityProduction,
    },
    unitManager: {
      getPlayerUnits: (playerId: string) =>
        Array.from(units.values()).filter(unit => unit.playerId === playerId),
      getAllUnits: () => units,
      getUnit: (unitId: string) => units.get(unitId),
      getUnitType: (unitTypeId: string) => unitTypes[unitTypeId],
      canUnitPerformAction: () => true,
      executeUnitAction,
      attackUnit,
    },
    mapManager: {
      getDistance: (fromX: number, fromY: number, toX: number, toY: number) =>
        Math.max(Math.abs(fromX - toX), Math.abs(fromY - toY)),
    },
  };

  return {
    attackUnit,
    diplomacyManager,
    executeUnitAction,
    game,
    setCityProduction,
    setCurrentResearch,
    unitTypes,
    units,
  };
}

describe('CivJSAIAdapter compatibility contract', () => {
  it('publishes explicit supported behavior and non-parity boundaries', () => {
    expect(CIVJS_AI_CONTRACT.version).toBe(2);
    expect(CIVJS_AI_CONTRACT.supported).toEqual(
      expect.arrayContaining([
        expect.stringContaining('city-founding'),
        expect.stringContaining('worker'),
        expect.stringContaining('military'),
        expect.stringContaining('restart'),
        expect.stringContaining('completion'),
      ])
    );
    expect(CIVJS_AI_CONTRACT.remaining).toEqual(
      expect.arrayContaining([expect.stringContaining('lifecycle')])
    );
  });

  it('covers expansion, economy, research, production, workers, combat, diplomacy, and action use', async () => {
    const scenario = createScenario();
    const actions = await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(actions).toBe(8);
    expect(scenario.setCurrentResearch).toHaveBeenCalledWith('ai', 'alphabet');
    expect(scenario.setCityProduction).toHaveBeenCalledWith(
      'capital',
      'building',
      'marketplace',
      'ai'
    );
    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'settler',
      ActionType.FOUND_CITY,
      undefined,
      undefined,
      'ai'
    );
    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'worker',
      ActionType.AUTO_SETTLER,
      undefined,
      undefined,
      'ai'
    );
    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'scout',
      ActionType.AUTO_EXPLORE,
      undefined,
      undefined,
      'ai'
    );
    expect(scenario.attackUnit).toHaveBeenCalledWith('warrior', 'enemy');
    expect(scenario.diplomacyManager.respondToTreaty).toHaveBeenCalledWith(
      'game',
      'ai',
      'human',
      'peace-proposal',
      true
    );
    expect(scenario.diplomacyManager.respondToTreaty).toHaveBeenCalledWith(
      'game',
      'ai',
      'other-ai',
      'alliance-proposal',
      false
    );
  });

  it('uses nuclear consequences instead of ordinary combat for nuclear actors', async () => {
    const scenario = createScenario();
    scenario.units.set('nuclear', {
      id: 'nuclear',
      playerId: 'ai',
      unitTypeId: 'nuclear',
      x: 4,
      y: 5,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    });
    scenario.unitTypes.nuclear = {
      attack: 99,
      range: 1,
      flags: ['Nuclear'],
      rulesetUnitClassFlags: ['Missile'],
    };

    await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'nuclear',
      ActionType.NUCLEAR_EXPLOSION,
      5,
      4,
      'ai'
    );
    expect(scenario.attackUnit).not.toHaveBeenCalledWith('nuclear', 'enemy');
  });

  it('does not target players unless diplomacy says they are at war', async () => {
    const scenario = createScenario();
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({
      nations: [{ id: 'human', relation: { state: 'peace' } }],
    });

    await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.attackUnit).not.toHaveBeenCalled();
  });

  it('uses a legal Milestone 14 city-unit command through UnitManager', async () => {
    const scenario = createScenario();
    for (const id of ['settler', 'worker', 'scout', 'enemy']) scenario.units.delete(id);
    scenario.game.researchManager.getPlayerResearch = () => ({ currentTech: 'alphabet' });
    (scenario.game.cityManager as any).getPlayerCities = () => [
      { id: 'capital', currentProduction: 'warriors', goldPerTurn: 0, buildings: [] },
    ];
    (scenario.game.cityManager as any).getCityAt = () => ({ id: 'capital', playerId: 'ai' });
    (scenario.game.unitManager as any).canUnitPerformAction = jest.fn(
      (_unitId: string, action: ActionType) => action === ActionType.UPGRADE_UNIT
    );
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await expect(
      new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn('game', scenario.game as any)
    ).resolves.toBe(1);
    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'warrior',
      ActionType.UPGRADE_UNIT,
      undefined,
      undefined,
      'ai'
    );
  });

  it('persists relationship memory and proactively proposes valued treaties', async () => {
    const scenario = createScenario();
    scenario.game.players.set('ai', {
      id: 'ai',
      isAI: true,
      aiLevel: 'normal',
      aiTraits: { expansionist: 50, trader: 50, aggressive: 50, builder: 50 },
      aiState: {},
    } as any);
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({
      nations: [
        {
          id: 'human',
          known: true,
          canMeet: true,
          relation: {
            state: 'peace',
            attitude: 100,
            reputation: 0,
          },
        },
      ],
    });

    await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.diplomacyManager.proposeTreaty).toHaveBeenCalledWith(
      'game',
      'ai',
      'human',
      [{ type: 'alliance' }],
      expect.stringContaining('alliance')
    );
    expect((scenario.game.players.get('ai') as any).aiState.diplomacy.human).toMatchObject({
      love: 100,
      countdown: 5,
    });
  });

  it('assigns and fortifies a city guard instead of sending it on offense', async () => {
    const scenario = createScenario();
    const threatenedCity = {
      id: 'frontier',
      x: 4,
      y: 4,
      currentProduction: 'warriors',
      goldPerTurn: 0,
      buildings: [],
    };
    scenario.game.cityManager.getPlayerCities = () => [threatenedCity] as any;
    (scenario.game.cityManager as any).getCity = (cityId: string) =>
      cityId === threatenedCity.id ? threatenedCity : undefined;
    scenario.units.delete('settler');
    scenario.units.delete('worker');
    scenario.units.delete('scout');

    await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'warrior',
      ActionType.FORTIFY,
      undefined,
      undefined,
      'ai'
    );
    expect(scenario.attackUnit).not.toHaveBeenCalled();
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'defend',
      targetId: 'frontier',
    });
  });

  it('queues one expansion unit and otherwise falls back to deterministic defense production', async () => {
    const scenario = createScenario();
    scenario.game.cityManager.getPlayerCities = () =>
      [
        { id: 'capital', currentProduction: null, goldPerTurn: 2, buildings: [] },
        { id: 'second', currentProduction: null, goldPerTurn: 1, buildings: [] },
      ] as any;
    scenario.units.delete('settler');
    scenario.units.delete('enemy');
    scenario.units.get('worker')!.automation = 'settler';
    scenario.units.get('scout')!.automation = 'explore';
    scenario.units.get('warrior')!.movementLeft = 0;
    scenario.game.researchManager.getPlayerResearch = () => ({ currentTech: 'alphabet' });
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.setCityProduction).toHaveBeenNthCalledWith(
      1,
      'capital',
      'unit',
      'settlers',
      'ai'
    );
    expect(scenario.setCityProduction).toHaveBeenNthCalledWith(
      2,
      'second',
      'unit',
      'warriors',
      'ai'
    );
  });

  it('resumes from recovered manager state without duplicating completed decisions', async () => {
    const scenario = createScenario();
    scenario.game.researchManager.getPlayerResearch = () => ({ currentTech: 'alphabet' });
    scenario.game.cityManager.getPlayerCities = () =>
      [{ id: 'capital', currentProduction: 'settlers', goldPerTurn: 1, buildings: [] }] as any;
    scenario.units.delete('settler');
    scenario.units.delete('enemy');
    scenario.units.get('worker')!.automation = 'settler';
    scenario.units.get('scout')!.automation = 'explore';
    scenario.units.get('warrior')!.movementLeft = 0;
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    const actions = await new CivJSAIAdapter(scenario.diplomacyManager as any).processTurn(
      'recovered-game',
      scenario.game as any
    );

    expect(actions).toBe(0);
    expect(scenario.setCurrentResearch).not.toHaveBeenCalled();
    expect(scenario.setCityProduction).not.toHaveBeenCalled();
    expect(scenario.executeUnitAction).not.toHaveBeenCalled();
  });

  it('does not mutate a completed game and isolates an unsuitable decision', async () => {
    const scenario = createScenario();
    const adapter = new CivJSAIAdapter(scenario.diplomacyManager as any);
    scenario.game.state = 'ended';
    expect(await adapter.processTurn('ended-game', scenario.game as any)).toBe(0);

    scenario.game.state = 'active';
    scenario.game.researchManager.setCurrentResearch.mockRejectedValueOnce(
      new Error('invalid target')
    );
    await expect(adapter.processTurn('active-game', scenario.game as any)).resolves.toBe(7);
    expect(scenario.setCityProduction).toHaveBeenCalled();
  });

  it('invalidates destroyed unit and captured city assignments immediately', () => {
    const scenario = createScenario();
    const ai = scenario.game.players.get('ai') as any;
    ai.aiState = {
      version: 1,
      diplomacy: {},
      unitTasks: {
        destroyed: { role: 'attack', assignedTurn: 1 },
        hunter: { role: 'hunter', targetId: 'destroyed', assignedTurn: 1 },
        guard: { role: 'guard', targetId: 'captured-city', assignedTurn: 1 },
        survivor: { role: 'explore', assignedTurn: 1 },
      },
      cityWants: {
        'captured-city': { granary: 10 },
        capital: { temple: 5 },
      },
      techWants: {},
    };
    const adapter = new CivJSAIAdapter(scenario.diplomacyManager as any);

    adapter.onUnitDestroyed(
      'game',
      scenario.game as any,
      { id: 'destroyed', playerId: 'enemy' } as any
    );
    adapter.onCityInvalidated('game', scenario.game as any, 'captured-city');

    expect(ai.aiState.unitTasks).toEqual({
      survivor: { role: 'explore', assignedTurn: 1 },
    });
    expect(ai.aiState.cityWants).toEqual({
      capital: { temple: 5 },
    });
  });
});
