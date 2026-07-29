import { FreecivAIOrchestrator } from '@game/services/FreecivAIOrchestrator';
import { createAIState } from '@game/ai/FreecivAIStateStore';
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
      ['ai', { id: 'ai', isAI: true, aiState: createAIState() }],
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
    visibilityManager: {
      updatePlayerVisibility: jest.fn(),
      getVisibleTiles: () => [],
      getDetectionTiles: () => [],
      isTileVisible: () => true,
    },
    unitManager: {
      getPlayerUnits: (playerId: string) =>
        Array.from(units.values()).filter(unit => unit.playerId === playerId),
      getAllUnits: () => units,
      getVisibleUnits: () => Array.from(units.values()),
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

describe('FreecivAIOrchestrator', () => {
  it('covers expansion, economy, research, production, workers, combat, diplomacy, and action use', async () => {
    const scenario = createScenario();
    const actions = await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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
      new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
        'game',
        scenario.game as any
      )
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
      aiState: createAIState(),
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

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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

    const actions = await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
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
    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);
    scenario.game.state = 'ended';
    expect(await orchestrator.processTurn('ended-game', scenario.game as any)).toBe(0);

    scenario.game.state = 'active';
    scenario.game.researchManager.setCurrentResearch.mockRejectedValueOnce(
      new Error('invalid target')
    );
    await expect(orchestrator.processTurn('active-game', scenario.game as any)).resolves.toBe(7);
    expect(scenario.setCityProduction).toHaveBeenCalled();
  });

  it('invalidates destroyed unit and captured city assignments immediately', () => {
    const scenario = createScenario();
    const ai = scenario.game.players.get('ai') as any;
    ai.aiState = {
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
    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);

    orchestrator.onUnitDestroyed(
      'game',
      scenario.game as any,
      { id: 'destroyed', playerId: 'enemy' } as any
    );
    orchestrator.onCityInvalidated('game', scenario.game as any, 'captured-city');

    expect(ai.aiState.unitTasks).toEqual({
      survivor: { role: 'explore', assignedTurn: 1 },
    });
    expect(ai.aiState.cityWants).toEqual({
      capital: { temple: 5 },
    });
  });

  it('optimizes AI citizens with starvation and unrest constraints', async () => {
    const scenario = createScenario();
    const optimizeCityManually = jest.fn().mockResolvedValue(true);
    (scenario.game.cityManager as any).optimizeCityManually = optimizeCityManually;
    scenario.game.cityManager.getPlayerCities = () => [
      {
        id: 'capital',
        size: 4,
        foodStock: 0,
        foodPerTurn: -1,
        goldPerTurn: -2,
        productionPerTurn: 2,
        currentProduction: null,
        buildings: [],
        happiness: { happy: 0, content: 2, unhappy: 1, angry: 1 },
      },
    ];

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(optimizeCityManually).toHaveBeenCalledWith(
      'capital',
      expect.objectContaining({
        require_happy: true,
        allow_disorder: false,
        allow_specialists: true,
      })
    );
    const parameters = optimizeCityManually.mock.calls[0][1];
    expect(parameters.minimal_surplus.food).toBe(2);
    expect(parameters.factor.food).toBe(24);
    expect(parameters.factor.luxury).toBe(20);
  });

  it('persists ranked wants and seeds an active city worklist', async () => {
    const scenario = createScenario();
    const addToWorklist = jest.fn().mockResolvedValue(true);
    const activeCity = {
      id: 'capital',
      name: 'Capital',
      x: 2,
      y: 2,
      playerId: 'ai',
      population: 3,
      size: 3,
      currentProduction: 'warriors',
      productionType: 'unit',
      productionPerTurn: 3,
      foodPerTurn: 2,
      goldPerTurn: 0,
      defenseStrength: 1,
      buildings: [],
      worklist: [],
      happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
    };
    (scenario.game.cityManager as any).getPlayerCities = () => [activeCity];
    (scenario.game.cityManager as any).canCityContinueProduction = () => true;
    (scenario.game.cityManager as any).addToWorklist = addToWorklist;

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(addToWorklist).toHaveBeenCalledWith(
      'capital',
      expect.arrayContaining([expect.objectContaining({ value: expect.any(String) })]),
      'ai'
    );
    const ai = scenario.game.players.get('ai') as any;
    expect(Object.keys(ai.aiState.cityWants.capital).length).toBeGreaterThan(0);
  });

  it('keeps accumulated research on the active technology', async () => {
    const scenario = createScenario();
    scenario.game.researchManager.getPlayerResearch = () => ({
      currentTech: 'writing',
      researchedTechs: [],
    });
    (scenario.game.researchManager as any).getTechnologyCatalogue = () => [
      { id: 'writing', cost: 30, requirements: [] },
      { id: 'alphabet', cost: 10, requirements: [] },
    ];
    scenario.units.delete('enemy');
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.setCurrentResearch).not.toHaveBeenCalled();
  });

  it('honors the Freeciv target-visibility handicap by difficulty', async () => {
    const easy = createScenario();
    (easy.game.players.get('ai') as any).aiLevel = 'easy';
    (easy.game.unitManager as any).getVisibleUnits = (playerId: string) =>
      Array.from(easy.units.values()).filter(unit => unit.playerId === playerId);

    await new FreecivAIOrchestrator(easy.diplomacyManager as any).processTurn(
      'game',
      easy.game as any
    );
    expect(easy.attackUnit).not.toHaveBeenCalled();

    const hard = createScenario();
    (hard.game.players.get('ai') as any).aiLevel = 'hard';
    (hard.game.unitManager as any).getVisibleUnits = () => [];
    await new FreecivAIOrchestrator(hard.diplomacyManager as any).processTurn(
      'game',
      hard.game as any
    );
    expect(hard.attackUnit).toHaveBeenCalledWith('warrior', 'enemy');
  });

  it('routes ferry rendezvous to water and embarks the passenger authoritatively', async () => {
    const scenario = createScenario();
    const ferry = {
      ...scenario.units.get('warrior')!,
      id: 'ferry',
      unitTypeId: 'transport',
      x: 0,
      y: 0,
    };
    const passenger = {
      ...scenario.units.get('settler')!,
      id: 'passenger',
      x: 2,
      y: 0,
    };
    scenario.units.clear();
    scenario.units.set(ferry.id, ferry);
    scenario.units.set(passenger.id, passenger);
    scenario.unitTypes.transport = {
      unitClass: 'naval',
      rulesetUnitClass: 'sea',
      transport_capacity: 1,
      cargoClasses: ['land'],
    };
    scenario.unitTypes.settlers.rulesetUnitClass = 'land';
    (scenario.game.unitManager as any).getTransportCapacityRemaining = () => 1;
    (scenario.game.unitManager as any).canContinuePathFrom = (
      unit: TestUnit,
      x: number,
      y: number
    ) => unit.id === 'ferry' && x === 1 && y === 0;
    (scenario.game.mapManager as any).getNeighbors = () => [{ x: 1, y: 0 }];
    (scenario.game as any).pathfindingManager = {
      findPath: jest.fn().mockResolvedValue({
        valid: true,
        path: [],
        totalCost: 3,
        estimatedTurns: 1,
      }),
    };
    scenario.executeUnitAction.mockImplementation(
      async (unitId: string, action: ActionType, x?: number, y?: number) => {
        expect(action).toBe(ActionType.GOTO);
        const unit = scenario.units.get(unitId)!;
        unit.x = x!;
        unit.y = y!;
        if (unitId === 'passenger') passenger.transportedBy = 'ferry';
        return { success: true };
      }
    );
    const state = {
      diplomacy: {},
      cityWants: {},
      techWants: {},
      unitTasks: {
        passenger: {
          role: 'settle' as const,
          targetX: 7,
          targetY: 7,
          assignedTurn: 1,
        },
      },
    };

    const actions = await (
      new FreecivAIOrchestrator(scenario.diplomacyManager as any) as any
    ).manageFerries(scenario.game, 'ai', state);

    expect(actions).toBe(2);
    expect(scenario.executeUnitAction).toHaveBeenNthCalledWith(
      1,
      'ferry',
      ActionType.GOTO,
      1,
      0,
      'ai'
    );
    expect(scenario.executeUnitAction).toHaveBeenNthCalledWith(
      2,
      'passenger',
      ActionType.GOTO,
      1,
      0,
      'ai'
    );
    expect(passenger.transportedBy).toBe('ferry');
  });
});
