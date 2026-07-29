import { FreecivAIOrchestrator } from '@game/services/FreecivAIOrchestrator';
import { FreecivAITransportController } from '@game/ai/FreecivAITransportController';
import { createAIState } from '@game/ai/FreecivAIStateStore';
import { ActionType } from '@app-types/shared/actions';
import { EffectType } from '@game/managers/EffectsManager';

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
  const mapTiles = Array.from({ length: 9 }, (_, x) =>
    Array.from({ length: 9 }, (_, y) => ({
      x,
      y,
      terrain: 'grassland',
      riverMask: 0,
      elevation: 100,
      continentId: 1,
      isExplored: false,
      isVisible: false,
      hasRoad: false,
      hasRailroad: false,
      improvements: [],
      unitIds: [],
      properties: {},
      temperature: 'temperate',
      wetness: 50,
      owner: x === 3 && y === 3 ? 'ai' : undefined,
    }))
  );
  mapTiles[3]![2]!.riverMask = 1;
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
        health: 50,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      },
    ],
  ]);
  const executeUnitAction = jest.fn().mockResolvedValue({ success: true });
  const attackUnit = jest.fn().mockImplementation(async (attackerId: string) => {
    const attacker = units.get(attackerId);
    if (attacker) attacker.movementLeft = 0;
    return { defenderDestroyed: true };
  });
  const moveUnit = jest.fn().mockImplementation(async (unitId: string, x: number, y: number) => {
    const actor = units.get(unitId);
    if (!actor) return false;
    actor.x = x;
    actor.y = y;
    actor.movementLeft = 0;
    return true;
  });
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
    declareWar: jest.fn().mockResolvedValue(undefined),
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
      movement: 1,
      firepower: 1,
      cost: 10,
      rulesetUnitClassFlags: ['CanOccupyCity'],
      flags: [],
    },
    explorer: {
      canFoundCity: false,
      canBuildImprovements: false,
      attack: 0,
      movement: 3,
      sight: 2,
      vision_radius_sq: 2,
      rulesetUnitClass: 'Land',
      roles: ['Explorer'],
    },
  };
  const game = {
    state: 'active',
    players: new Map([
      ['human', { id: 'human', isAI: false }],
      ['ai', { id: 'ai', isAI: true, aiState: createAIState() }],
    ]),
    researchManager: {
      getPlayerResearch: (): any => ({
        currentTech: undefined,
        researchedTechs: new Set(),
      }),
      getAvailableTechnologies: () => [
        { id: 'writing', cost: 30 },
        { id: 'alphabet', cost: 10 },
      ],
      setCurrentResearch,
    },
    cityManager: {
      getPlayerCities: (): any[] => [
        {
          id: 'capital',
          playerId: 'ai',
          currentProduction: null,
          goldPerTurn: -2,
          buildings: [],
          workableTiles: [{ x: 3, y: 3, isWorked: true }],
        },
      ],
      setCityProduction,
      getAllCities: (): any[] => [],
      getCityAt: () => null,
    },
    visibilityManager: {
      updatePlayerVisibility: jest.fn(),
      getVisibleTiles: () => new Set(['7,7', '6,7']),
      getExploredTiles: () => new Set(['7,7', '6,7']),
      getDetectionTiles: () => ({ invisible: new Set(), subsurface: new Set() }),
      isTileVisible: () => true,
      isTileExplored: (_playerId: string, x: number, y: number) =>
        (x === 7 && y === 7) || (x === 6 && y === 7),
    },
    unitManager: {
      getPlayerUnits: (playerId: string) =>
        Array.from(units.values()).filter(unit => unit.playerId === playerId),
      getAllUnits: () => units,
      getVisibleUnits: () => Array.from(units.values()),
      getUnit: (unitId: string) => units.get(unitId),
      getUnitType: (unitTypeId: string) => unitTypes[unitTypeId],
      calculateUnitAttackRating: (unit: TestUnit) =>
        Number(unitTypes[unit.unitTypeId]?.attack ?? 0) * Math.max(1, unit.health),
      calculateUnitDefenseRating: (unit: TestUnit) =>
        Number(unitTypes[unit.unitTypeId]?.defense ?? unitTypes[unit.unitTypeId]?.attack ?? 0) *
        Math.max(1, unit.health),
      calculateCityDefenseBonusAgainst: () => 0,
      canUnitPerformAction: () => true,
      executeUnitAction,
      attackUnit,
      moveUnit,
      calculateUnitHitpointRecovery: () => ({
        regeneration: 0,
        minimum: 33,
        secondary: 10,
        gain: 10,
      }),
    },
    mapManager: {
      getMapData: () => ({
        width: 9,
        height: 9,
        tiles: mapTiles,
        startingPositions: [],
        seed: 'test',
        generatedAt: new Date(0),
      }),
      getDistance: (fromX: number, fromY: number, toX: number, toY: number) =>
        Math.max(Math.abs(fromX - toX), Math.abs(fromY - toY)),
      getTile: (x: number, y: number) => mapTiles[x]?.[y] ?? null,
      getNeighbors: (x: number, y: number) =>
        mapTiles.flat().filter(tile => Math.max(Math.abs(tile.x - x), Math.abs(tile.y - y)) === 1),
      getTopology: () => ({
        getCardinalNeighbors: (x: number, y: number) =>
          [
            { x: x - 1, y },
            { x: x + 1, y },
            { x, y: y - 1 },
            { x, y: y + 1 },
          ].filter(position => mapTiles[position.x]?.[position.y]),
        squaredDistance: (fromX: number, fromY: number, toX: number, toY: number) =>
          (fromX - toX) ** 2 + (fromY - toY) ** 2,
      }),
    },
    pathfindingManager: {
      findPath: jest.fn().mockImplementation(async (actor, targetX, targetY) => ({
        valid: true,
        path: [
          { x: actor.x, y: actor.y, moveCost: 0 },
          { x: targetX, y: targetY, moveCost: 1 },
        ],
        totalCost: Math.max(Math.abs(actor.x - targetX), Math.abs(actor.y - targetY)),
        estimatedTurns: 1,
      })),
    },
  };

  return {
    attackUnit,
    diplomacyManager,
    executeUnitAction,
    game,
    moveUnit,
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
      ActionType.BUILD_IRRIGATION,
      undefined,
      undefined,
      'ai'
    );
    expect(scenario.moveUnit).toHaveBeenCalledWith('scout', 6, 7);
    expect(scenario.executeUnitAction).not.toHaveBeenCalledWith(
      'scout',
      ActionType.AUTO_EXPLORE,
      undefined,
      undefined,
      'ai'
    );
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.scout).toMatchObject({
      role: 'explore',
      targetX: 6,
      targetY: 7,
    });
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

  it('persists an urgent treasury savings goal and rushes when it is funded', async () => {
    const scenario = createScenario();
    (scenario.game.players.get('ai') as any).aiLevel = 'hard';
    const city = {
      id: 'capital',
      playerId: 'ai',
      x: 4,
      y: 4,
      size: 4,
      currentProduction: 'warriors',
      productionType: 'unit',
      goldPerTurn: 0,
      foodPerTurn: 2,
      tradePerTurn: 8,
      buildings: [],
      happiness: { happy: 1, content: 3, unhappy: 0, angry: 0 },
      workableTiles: [{ x: 3, y: 3, isWorked: true }],
    };
    (scenario.game.cityManager as any).getPlayerCities = () => [city];
    (scenario.game.cityManager as any).calculateBuyCost = () => ({
      canBuy: true,
      goldCost: 100,
    });
    const buyProduction = jest.fn().mockResolvedValue({ success: true });
    (scenario.game.cityManager as any).buyProduction = buyProduction;
    scenario.unitTypes.warriors.attack = 10;
    const economicStatus = {
      currentGold: 50,
      taxRates: { tax: 30, luxury: 0, science: 70 },
    };
    const setPlayerTaxRates = jest.fn().mockReturnValue({ isValid: true });
    (scenario.game as any).turnManager = {
      getEconomicManager: () => ({
        getPlayerEconomicStatus: async () => economicStatus,
        getPlayerGold: async () => economicStatus.currentGold,
        setPlayerTaxRates,
      }),
    };

    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);
    await orchestrator.processTurn('game', scenario.game as any);

    const state = (scenario.game.players.get('ai') as any).aiState;
    expect(state.treasuryGoal).toMatchObject({
      cityId: 'capital',
      reason: 'rush warriors',
    });
    expect(setPlayerTaxRates).toHaveBeenCalledWith({
      playerId: 'ai',
      newRates: { tax: 60, luxury: 0, science: 40 },
    });
    expect(buyProduction).not.toHaveBeenCalled();

    economicStatus.currentGold = 500;
    await orchestrator.processTurn('game', scenario.game as any);
    expect(buyProduction).toHaveBeenCalledWith('capital', 'ai');
    expect(state.treasuryGoal).toBeUndefined();
  });

  it('applies a rate-limited majority celebration through the citizen optimizer', async () => {
    const scenario = createScenario();
    const cities = ['capital', 'second', 'small'].map((id, index) => ({
      id,
      playerId: 'ai',
      x: index + 1,
      y: 1,
      size: index < 2 ? 4 : 2,
      currentProduction: 'warriors',
      productionType: 'unit',
      goldPerTurn: 0,
      foodPerTurn: index < 2 ? 2 : 0,
      tradePerTurn: 10,
      buildings: [],
      happiness: { happy: 2, content: 2, unhappy: 0, angry: 0 },
      workableTiles: [],
    }));
    (scenario.game.cityManager as any).getPlayerCities = () => cities;
    (scenario.game.cityManager as any).calculateBuyCost = () => ({
      canBuy: false,
      goldCost: 0,
    });
    const optimizeCityManually = jest.fn().mockResolvedValue(true);
    (scenario.game.cityManager as any).optimizeCityManually = optimizeCityManually;
    (scenario.game as any).governmentManager = {
      getPlayerGovernment: () => ({ currentGovernment: 'republic', revolutionTurns: 0 }),
      calculateGovernmentEffect: (_governmentId: string, type: EffectType) => {
        if (type === EffectType.RAPTURE_GROW) return 1;
        if (type === EffectType.MAX_RATES) return 60;
        return 0;
      },
    };
    const setPlayerTaxRates = jest.fn().mockReturnValue({ isValid: true });
    (scenario.game as any).turnManager = {
      getEconomicManager: () => ({
        getPlayerEconomicStatus: async () => ({
          currentGold: 100,
          taxRates: { tax: 30, luxury: 0, science: 70 },
        }),
        getPlayerGold: async () => 100,
        setPlayerTaxRates,
      }),
    };

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(setPlayerTaxRates).toHaveBeenCalledWith({
      playerId: 'ai',
      newRates: { tax: 30, luxury: 60, science: 10 },
    });
    for (const cityId of ['capital', 'second']) {
      expect(optimizeCityManually).toHaveBeenCalledWith(
        cityId,
        expect.objectContaining({ require_happy: true, max_growth: true })
      );
    }
  });

  it('reserves remote worker improvements and moves through authoritative goto', async () => {
    const scenario = createScenario();
    scenario.units.get('worker')!.x = 1;
    scenario.units.get('worker')!.y = 3;
    scenario.units.delete('enemy');
    (scenario.game as any).pathfindingManager = {
      findPath: jest.fn().mockResolvedValue({
        valid: true,
        path: [
          { x: 1, y: 3 },
          { x: 3, y: 3 },
        ],
        totalCost: 2,
        estimatedTurns: 2,
      }),
    };

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith('worker', ActionType.GOTO, 3, 3, 'ai');
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.worker).toMatchObject({
      role: 'worker',
      action: ActionType.BUILD_IRRIGATION,
      targetX: 3,
      targetY: 3,
    });
  });

  it('consumes an authoritative city worker request after starting its activity', async () => {
    const scenario = createScenario();
    const city = {
      id: 'capital',
      playerId: 'ai',
      currentProduction: null,
      goldPerTurn: -2,
      buildings: [],
      workableTiles: [{ x: 3, y: 3, isWorked: true }],
      workerTaskRequests: [
        {
          x: 3,
          y: 3,
          action: ActionType.BUILD_ROAD,
          want: 100,
        },
      ],
    };
    (scenario.game.cityManager as any).getPlayerCities = () => [city];
    const clearWorkerTaskRequest = jest.fn();
    (scenario.game.cityManager as any).clearWorkerTaskRequest = clearWorkerTaskRequest;

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'worker',
      ActionType.BUILD_ROAD,
      undefined,
      undefined,
      'ai'
    );
    expect(clearWorkerTaskRequest).toHaveBeenCalledWith('capital', 3, 3, ActionType.BUILD_ROAD);
  });

  it('withdraws a critically damaged military unit before guard and combat planning', async () => {
    const scenario = createScenario();
    scenario.units.get('warrior')!.health = 24;
    scenario.unitTypes.warriors.unitClass = 'military';
    scenario.unitTypes.warriors.rulesetUnitClass = 'Land';
    (scenario.game.cityManager as any).getAllCities = () => [
      { id: 'refuge', playerId: 'ai', x: 3, y: 4, buildings: [] },
    ];

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith('warrior', ActionType.GOTO, 3, 4, 'ai');
    expect(scenario.attackUnit).not.toHaveBeenCalledWith('warrior', 'enemy');
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'recover',
      targetId: 'refuge',
    });
  });

  it('captures a visible undefended hostile city as a military objective', async () => {
    const scenario = createScenario();
    scenario.units.delete('enemy');
    (scenario.game.cityManager as any).getAllCities = () => [
      {
        id: 'enemy-city',
        playerId: 'human',
        x: 5,
        y: 4,
        size: 3,
        buildings: [],
      },
    ];

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith('warrior', ActionType.GOTO, 5, 4, 'ai');
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'attack',
      targetId: 'enemy-city',
    });
  });

  it('withdraws a sub-half-health attacker when no worthy objective exists', async () => {
    const scenario = createScenario();
    scenario.units.delete('enemy');
    scenario.units.get('warrior')!.health = 49;
    (scenario.game.cityManager as any).getAllCities = () => [
      {
        id: 'safe-city',
        playerId: 'ai',
        x: 3,
        y: 4,
        size: 2,
        buildings: [],
      },
    ];

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.executeUnitAction).toHaveBeenCalledWith('warrior', ActionType.GOTO, 3, 4, 'ai');
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'retreat',
      targetId: 'safe-city',
    });
  });

  it('falls back to exploration with an otherwise idle military unit', async () => {
    const scenario = createScenario();
    scenario.units.delete('scout');
    scenario.units.delete('enemy');
    scenario.unitTypes.warriors.unitClass = 'military';
    scenario.unitTypes.warriors.sight = 2;
    scenario.unitTypes.warriors.vision_radius_sq = 2;
    scenario.game.visibilityManager.getVisibleTiles = () => new Set(['4,4', '5,4']);
    (scenario.game.visibilityManager as any).getExploredTiles = () => new Set(['4,4', '5,4']);
    (scenario.game.visibilityManager as any).isTileExplored = (
      _playerId: string,
      x: number,
      y: number
    ) => (x === 4 && y === 4) || (x === 5 && y === 4);
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.moveUnit).toHaveBeenCalledWith('warrior', 5, 4);
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'explore',
      targetX: 5,
      targetY: 4,
    });
  });

  it('executes the selected safe route rather than recalculating a direct goto', async () => {
    const scenario = createScenario();
    scenario.units.delete('enemy');
    scenario.units.get('warrior')!.movementLeft = 0;
    scenario.game.visibilityManager.getVisibleTiles = () => new Set(['7,7', '6,6', '6,7']);
    (scenario.game.visibilityManager as any).getExploredTiles = () =>
      new Set(['7,7', '6,6', '6,7']);
    (scenario.game.pathfindingManager as any).findPath = jest
      .fn()
      .mockImplementation(async (actor, targetX, targetY) => ({
        valid: targetX === 6 && targetY === 7,
        path: [
          { x: actor.x, y: actor.y, moveCost: 0 },
          { x: 6, y: 6, moveCost: 1 },
          { x: 6, y: 7, moveCost: 1 },
        ],
        totalCost: 2,
        weightedCost: 2,
        estimatedTurns: 1,
      }));
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.moveUnit).toHaveBeenCalledWith('scout', 6, 6);
    expect(scenario.moveUnit).not.toHaveBeenCalledWith('scout', 6, 7);
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.scout).toMatchObject({
      role: 'explore',
      targetX: 6,
      targetY: 7,
    });
  });

  it('does not wake fortified military units for fallback exploration in away mode', async () => {
    const scenario = createScenario();
    scenario.units.delete('scout');
    scenario.units.delete('enemy');
    scenario.units.get('warrior')!.fortified = true;
    scenario.unitTypes.warriors.unitClass = 'military';
    (scenario.game.players.get('ai') as any).aiLevel = 'away';
    scenario.game.visibilityManager.getVisibleTiles = () => new Set(['4,4', '5,4']);
    (scenario.game.visibilityManager as any).getExploredTiles = () => new Set(['4,4', '5,4']);
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.moveUnit).not.toHaveBeenCalledWith(
      'warrior',
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('preserves an existing military role instead of assigning fallback exploration', async () => {
    const scenario = createScenario();
    scenario.units.delete('scout');
    scenario.units.delete('enemy');
    scenario.unitTypes.warriors.unitClass = 'military';
    (scenario.game.players.get('ai') as any).aiState.unitTasks.warrior = {
      role: 'guard',
      targetId: 'capital',
      assignedTurn: 1,
    };
    scenario.game.cityManager.getPlayerCities = () =>
      [
        {
          id: 'capital',
          playerId: 'ai',
          x: 3,
          y: 3,
          buildings: [],
          happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
        },
      ] as any;
    (scenario.game.cityManager as any).getCity = (cityId: string) =>
      cityId === 'capital' ? scenario.game.cityManager.getPlayerCities()[0] : undefined;
    scenario.game.visibilityManager.getVisibleTiles = () => new Set(['4,4', '5,4']);
    (scenario.game.visibilityManager as any).getExploredTiles = () => new Set(['4,4', '5,4']);
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.moveUnit).not.toHaveBeenCalledWith(
      'warrior',
      expect.any(Number),
      expect.any(Number)
    );
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior.role).toBe('guard');
  });

  it('moves a persistent guard to rendezvous with its vulnerable unit charge', async () => {
    const scenario = createScenario();
    scenario.units.delete('scout');
    scenario.units.delete('enemy');
    scenario.units.set('diplomat', {
      id: 'diplomat',
      playerId: 'ai',
      unitTypeId: 'diplomat',
      x: 6,
      y: 4,
      movementLeft: 1,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    });
    Object.assign(scenario.unitTypes.warriors, {
      unitClass: 'military',
      defense: 4,
      hitpoints: 100,
      roles: ['DefendGood'],
    });
    scenario.unitTypes.diplomat = {
      unitClass: 'civilian',
      attack: 0,
      defense: 1,
      movement: 1,
      hitpoints: 100,
      flags: ['Diplomat', 'NonMil'],
      roles: ['DiplomatStartUnit'],
    };
    (scenario.game.players.get('ai') as any).aiState.unitTasks.diplomat = {
      role: 'diplomat',
      targetId: 'foreign-city',
      targetX: 8,
      targetY: 4,
      assignedTurn: 1,
    };
    scenario.game.cityManager.getPlayerCities = () => [];
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.warrior).toMatchObject({
      role: 'guard',
      targetId: 'diplomat',
    });
    expect(scenario.executeUnitAction).toHaveBeenCalledWith('warrior', ActionType.GOTO, 6, 4, 'ai');
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

  it('launches a carried hunter missile through authoritative unload and suicide actions', async () => {
    const scenario = createScenario();
    scenario.units.delete('settler');
    scenario.units.delete('worker');
    scenario.units.delete('scout');
    scenario.units.delete('warrior');
    scenario.units.set('hunter', {
      id: 'hunter',
      playerId: 'ai',
      unitTypeId: 'hunter-platform',
      x: 4,
      y: 4,
      movementLeft: 3,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
    });
    scenario.units.set('missile', {
      id: 'missile',
      playerId: 'ai',
      unitTypeId: 'hunter-missile',
      x: 4,
      y: 4,
      movementLeft: 6,
      health: 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
      transportedBy: 'hunter',
    });
    scenario.unitTypes['hunter-platform'] = {
      roles: ['Hunter'],
      attack: 8,
      defense: 2,
      movement: 3,
      cost: 5,
      transport_capacity: 2,
      cargoClasses: ['Missile'],
      unitClass: 'naval',
    };
    scenario.unitTypes['hunter-missile'] = {
      attack: 18,
      defense: 0,
      movement: 6,
      cost: 60,
      rulesetUnitClass: 'Missile',
      rulesetUnitClassFlags: ['Missile'],
      unitClass: 'military',
    };
    const unloadUnit = jest.fn(async (unitId: string) => {
      const missile = scenario.units.get(unitId);
      if (!missile) return false;
      missile.transportedBy = undefined;
      return true;
    });
    (scenario.game.unitManager as any).unloadUnit = unloadUnit;

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(unloadUnit).toHaveBeenCalledWith('missile', 4, 4);
    expect(scenario.executeUnitAction).toHaveBeenCalledWith(
      'missile',
      ActionType.SUICIDE_ATTACK,
      5,
      4,
      'ai'
    );
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
            reputation: 500,
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

  it('declares war when the persisted profitable-target countdown expires', async () => {
    const scenario = createScenario();
    scenario.units.delete('settler');
    const ai = scenario.game.players.get('ai') as any;
    ai.aiLevel = 'hard';
    ai.aiState = createAIState();
    ai.aiState.diplomacy.human = {
      love: 0,
      warDesire: 500,
      countdown: 0,
      warCountdown: 0,
    };
    (scenario.game.cityManager as any).getPlayerCities = (playerId: string) =>
      playerId === 'human'
        ? [
            {
              id: 'rich-target',
              playerId,
              x: 6,
              y: 6,
              size: 12,
              productionPerTurn: 20,
              tradePerTurn: 20,
              buildings: ['palace', 'marketplace', 'library'],
            },
          ]
        : [
            {
              id: 'home-a',
              playerId,
              x: 3,
              y: 3,
              size: 3,
              productionPerTurn: 3,
              tradePerTurn: 3,
              buildings: [],
            },
            {
              id: 'home-b',
              playerId,
              x: 4,
              y: 3,
              size: 3,
              productionPerTurn: 3,
              tradePerTurn: 3,
              buildings: [],
            },
          ];
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({
      nations: [
        {
          id: 'human',
          known: true,
          canMeet: true,
          isAI: false,
          relation: {
            state: 'peace',
            maxState: 'peace',
            sinceTurn: 1,
            turnsLeft: 0,
            contactTurnsLeft: 10,
            hasReasonToCancel: 0,
            embassy: false,
            sharedVision: false,
            reputation: 500,
            attitude: 0,
          },
        },
      ],
    });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.diplomacyManager.declareWar).toHaveBeenCalledWith('game', 'ai', 'human');
    expect(ai.aiState.diplomacy.human.warCountdown).toBeUndefined();
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
    scenario.units.get('scout')!.automation = 'explore';
    scenario.units.get('scout')!.movementLeft = 0;
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
    scenario.units.get('scout')!.automation = 'explore';
    scenario.units.get('scout')!.movementLeft = 0;
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

    orchestrator.onUnitLifecycle('game', scenario.game as any, {
      type: 'destroyed',
      unit: { id: 'destroyed', playerId: 'enemy' } as any,
    });
    orchestrator.onCityInvalidated('game', scenario.game as any, 'captured-city');

    expect(ai.aiState.unitTasks).toEqual({
      survivor: { role: 'explore', assignedTurn: 1 },
    });
    expect(ai.aiState.cityWants).toEqual({
      capital: { temple: 5 },
    });
  });

  it('tracks moved targets and invalidates tasks when a unit changes owner', () => {
    const scenario = createScenario();
    const ai = scenario.game.players.get('ai') as any;
    ai.aiState = {
      diplomacy: {},
      unitTasks: {
        target: { role: 'guard', assignedTurn: 1 },
        hunter: {
          role: 'hunter',
          targetId: 'target',
          targetX: 2,
          targetY: 3,
          assignedTurn: 1,
        },
      },
      cityWants: {},
      techWants: {},
    };
    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);
    const target = { id: 'target', playerId: 'human', x: 8, y: 9 } as any;

    orchestrator.onUnitLifecycle('game', scenario.game as any, {
      type: 'moved',
      unit: target,
      previousX: 2,
      previousY: 3,
    });
    expect(ai.aiState.unitTasks.hunter).toMatchObject({ targetX: 8, targetY: 9 });

    orchestrator.onUnitLifecycle('game', scenario.game as any, {
      type: 'owner_changed',
      unit: { ...target, playerId: 'ai' },
      previousPlayerId: 'human',
    });
    expect(ai.aiState.unitTasks).toEqual({});
  });

  it('applies action and war incidents to persistent diplomacy memory immediately', () => {
    const scenario = createScenario();
    scenario.game.players.set('other-ai', {
      id: 'other-ai',
      isAI: true,
      aiState: createAIState(),
    });
    const ai = scenario.game.players.get('ai') as any;
    const otherAI = scenario.game.players.get('other-ai') as any;
    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);

    orchestrator.onDiplomacyEvent('game', scenario.game as any, {
      type: 'incident',
      gameId: 'game',
      playerIds: ['human', 'ai'],
      offenderId: 'human',
      victimId: 'ai',
      severity: 143,
      message: 'Technology stolen.',
    });
    expect(ai.aiState.diplomacy.human).toMatchObject({ love: -143, warDesire: 72 });
    expect(otherAI.aiState.diplomacy.human).toBeUndefined();

    orchestrator.onDiplomacyEvent('game', scenario.game as any, {
      type: 'incident',
      gameId: 'game',
      playerIds: ['human', 'ai'],
      offenderId: 'human',
      victimId: 'ai',
      severity: 143,
      scope: 'international_outcry',
      message: 'International outrage.',
    });
    expect(ai.aiState.diplomacy.human).toMatchObject({ love: -429, warDesire: 215 });
    expect(otherAI.aiState.diplomacy.human).toMatchObject({ love: -10, warDesire: 0 });

    orchestrator.onDiplomacyEvent('game', scenario.game as any, {
      type: 'war_declared',
      gameId: 'game',
      playerIds: ['human', 'ai'],
      message: 'War declared.',
    });
    expect(ai.aiState.diplomacy.human).toMatchObject({ love: -795, warDesire: 465 });
    expect(otherAI.aiState.diplomacy.human).toMatchObject({ love: -43, warDesire: 0 });

    orchestrator.onDiplomacyEvent('game', scenario.game as any, {
      type: 'war_declared',
      gameId: 'game',
      playerIds: ['human', 'ai'],
      justified: true,
      message: 'Justified war declared.',
    });
    expect(ai.aiState.diplomacy.human).toMatchObject({ love: -795, warDesire: 465 });
  });

  it('optimizes AI citizens with starvation and unrest constraints', async () => {
    const scenario = createScenario();
    const optimizeCityManually = jest.fn().mockResolvedValue(true);
    (scenario.game.cityManager as any).optimizeCityManually = optimizeCityManually;
    const city = {
      id: 'capital',
      size: 4,
      foodStock: 0,
      foodPerTurn: -1,
      goldPerTurn: -2,
      productionPerTurn: 2,
      currentProduction: null,
      buildings: [],
      happiness: { happy: 0, content: 2, unhappy: 1, angry: 1 },
    };
    scenario.game.cityManager.getPlayerCities = () => [city];

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

    city.foodStock = 10;
    city.foodPerTurn = 3;
    city.happiness = { happy: 1, content: 3, unhappy: 0, angry: 0 };
    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );
    const reevaluated = optimizeCityManually.mock.calls.at(-1)![1];
    expect(reevaluated.minimal_surplus.food).toBe(1);
    expect(reevaluated.factor.food).toBe(8);
    expect(reevaluated.require_happy).toBe(false);
    expect(reevaluated.max_growth).toBe(true);
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

  it('selects repeatable spaceship parts through the authoritative production path', async () => {
    const scenario = createScenario();
    const city = {
      id: 'capital',
      name: 'Capital',
      x: 2,
      y: 2,
      playerId: 'ai',
      population: 5,
      size: 5,
      currentProduction: null,
      productionType: null,
      productionPerTurn: 20,
      foodPerTurn: 3,
      goldPerTurn: 2,
      tradePerTurn: 8,
      defenseStrength: 1,
      buildings: ['apollo_program', 'factory'],
      worklist: [],
      workableTiles: [],
      happiness: { happy: 1, content: 4, unhappy: 0, angry: 0 },
    };
    (scenario.game as any).config = { victoryConditions: ['science'] };
    (scenario.game.players.get('ai') as any).spaceshipState = {
      structurals: 1,
      components: 0,
      modules: 0,
    };
    (scenario.game.cityManager as any).getPlayerCities = (candidateId: string) =>
      candidateId === 'ai' ? [city] : [];
    scenario.game.cityManager.getAllCities = () => [city];
    (scenario.game.cityManager as any).canCityContinueProduction = (
      _cityId: string,
      kind: string,
      id: string
    ) => kind === 'building' && id.startsWith('space_');
    scenario.game.researchManager.getPlayerResearch = () => ({
      currentTech: undefined,
      researchedTechs: new Set(['space_flight', 'plastics', 'superconductors']),
    });
    scenario.units.clear();

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.setCityProduction).toHaveBeenCalledWith(
      'capital',
      'building',
      'space_structural',
      'ai'
    );
    expect((scenario.game.players.get('ai') as any).aiState.techWants).toMatchObject({
      plastics: 630,
      superconductors: 630,
    });
  });

  it('holds wonder helpers until their combined shields can finish construction', async () => {
    const scenario = createScenario();
    const wonderCity = {
      id: 'wonder',
      playerId: 'ai',
      x: 2,
      y: 2,
      size: 4,
      currentProduction: 'pyramids',
      productionType: 'building',
      productionStock: 100,
      productionPerTurn: 10,
      goldPerTurn: 0,
      foodPerTurn: 2,
      tradePerTurn: 4,
      buildings: [],
      happiness: { happy: 0, content: 4, unhappy: 0, angry: 0 },
      worklist: [],
      workableTiles: [],
    };
    (scenario.game.cityManager as any).getPlayerCities = () => [wonderCity];
    (scenario.game.cityManager as any).getAllCities = () => [wonderCity];
    (scenario.game.cityManager as any).canCityContinueProduction = () => false;
    scenario.unitTypes.caravan = {
      cost: 50,
      movement: 1,
      attack: 0,
      defense: 1,
      flags: ['HelpWonder', 'NonMil'],
      rulesetUnitClass: 'land',
      unitClass: 'civilian',
    };
    const first = {
      ...scenario.units.get('settler')!,
      id: 'first-caravan',
      unitTypeId: 'caravan',
      x: 2,
      y: 2,
    };
    scenario.units.clear();
    scenario.units.set(first.id, first);
    scenario.executeUnitAction.mockClear();
    const orchestrator = new FreecivAIOrchestrator(scenario.diplomacyManager as any);

    await orchestrator.processTurn('game', scenario.game as any);
    expect(
      scenario.executeUnitAction.mock.calls.filter(
        ([, action]) => action === ActionType.HELP_WONDER
      )
    ).toHaveLength(0);

    const second = { ...first, id: 'second-caravan' };
    scenario.units.set(second.id, second);
    await orchestrator.processTurn('game', scenario.game as any);

    expect(
      scenario.executeUnitAction.mock.calls.filter(
        ([, action]) => action === ActionType.HELP_WONDER
      )
    ).toEqual([
      ['first-caravan', ActionType.HELP_WONDER, 2, 2, 'ai'],
      ['second-caravan', ActionType.HELP_WONDER, 2, 2, 'ai'],
    ]);
    expect(
      (scenario.game.players.get('ai') as any).aiState.unitTasks['first-caravan']
    ).toMatchObject({
      role: 'caravan',
      targetId: 'wonder',
    });
  });

  it('keeps accumulated research when a replacement want does not repay the switch penalty', async () => {
    const scenario = createScenario();
    scenario.game.researchManager.getPlayerResearch = () => ({
      currentTech: 'writing',
      bulbsAccumulated: 100,
      researchedTechs: new Set(),
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

  it('consumes city advisor technology wants in the same AI phase', async () => {
    const scenario = createScenario();
    const state = (scenario.game.players.get('ai') as any).aiState;
    scenario.setCityProduction.mockImplementation(async () => {
      state.techWants.writing = 1000;
      return true;
    });
    scenario.game.researchManager.getPlayerResearch = () => ({
      currentTech: 'alphabet',
      bulbsAccumulated: 0,
      researchedTechs: new Set(),
    });
    (scenario.game.researchManager as any).getTechnologyCatalogue = () => [
      { id: 'writing', name: 'Writing', cost: 30, requirements: [], flags: [] },
      { id: 'alphabet', name: 'Alphabet', cost: 10, requirements: [], flags: [] },
    ];
    scenario.units.delete('enemy');
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    expect(scenario.setCurrentResearch).toHaveBeenCalledWith('ai', 'writing');
    expect(state.techWants.writing).toBeGreaterThanOrEqual(1000);
  });

  it('feeds an amortized future-government value into its prerequisite goal', async () => {
    const scenario = createScenario();
    (scenario.game.players.get('ai') as any).aiLevel = 'hard';
    (scenario.game as any).governmentManager = {
      getPlayerGovernment: () => ({ currentGovernment: 'despotism', revolutionTurns: 0 }),
      getAvailableGovernments: () => [{ id: 'despotism', available: true }],
      getAllGovernments: () => ({
        despotism: { id: 'despotism', reqs: [] },
        republic: {
          id: 'republic',
          reqs: [{ type: 'tech', name: 'The Republic', range: 'Player' }],
        },
      }),
      calculateGovernmentEffect: (governmentId: string, type: EffectType) =>
        governmentId === 'republic' && type === EffectType.MAKE_CONTENT ? 10 : 0,
      canChangeGovernment: jest.fn().mockResolvedValue(false),
    };
    (scenario.game.cityManager as any).getPlayerCities = () => [
      {
        id: 'capital',
        playerId: 'ai',
        foodPerTurn: 2,
        productionPerTurn: 3,
        tradePerTurn: 4,
        goldPerTurn: 1,
        sciencePerTurn: 2,
        buildings: [],
        happiness: { happy: 0, content: 3, unhappy: 0, angry: 0 },
        currentProduction: 'warriors',
        productionType: 'unit',
        worklist: [],
      },
    ];
    scenario.game.researchManager.getPlayerResearch = () => ({
      currentTech: undefined,
      bulbsAccumulated: 0,
      researchedTechs: new Set(),
    });
    (scenario.game.researchManager as any).getTechnologyCatalogue = () => [
      { id: 'alphabet', name: 'Alphabet', cost: 10, requirements: [], flags: [] },
      {
        id: 'the_republic',
        name: 'The Republic',
        cost: 40,
        requirements: ['alphabet'],
        flags: [],
      },
    ];
    scenario.game.researchManager.getAvailableTechnologies = () => [
      { id: 'alphabet', name: 'Alphabet', cost: 10, requirements: [], flags: [] },
    ];
    scenario.units.delete('enemy');
    scenario.diplomacyManager.getSnapshot.mockResolvedValue({ nations: [] });

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    const state = (scenario.game.players.get('ai') as any).aiState;
    expect(state.techWants.the_republic).toBeGreaterThan(0);
    expect(scenario.setCurrentResearch).toHaveBeenCalledWith('ai', 'alphabet');
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

  it('reserves distinct city sites for multiple settlers', async () => {
    const scenario = createScenario();
    const first = {
      ...scenario.units.get('settler')!,
      id: 'a-settler',
      x: 0,
      y: 0,
    };
    const second = {
      ...scenario.units.get('settler')!,
      id: 'b-settler',
      x: 0,
      y: 1,
    };
    const stale = {
      ...scenario.units.get('settler')!,
      id: 'c-settler',
      x: 0,
      y: 2,
    };
    scenario.units.clear();
    scenario.units.set(first.id, first);
    scenario.units.set(second.id, second);
    scenario.units.set(stale.id, stale);
    (scenario.game.cityManager as any).canFoundCityAt = (x: number, y: number) =>
      (x === 4 && y === 4) || (x === 8 && y === 8);
    (scenario.game.unitManager as any).canUnitPerformAction = (
      _unitId: string,
      action: ActionType
    ) => action !== ActionType.FOUND_CITY;
    scenario.executeUnitAction.mockResolvedValue({ success: true });
    (scenario.game.players.get('ai') as any).aiState.unitTasks[first.id] = {
      role: 'settle',
      targetX: 8,
      targetY: 8,
      assignedTurn: 1,
    };
    (scenario.game.players.get('ai') as any).aiState.unitTasks[stale.id] = {
      role: 'settle',
      targetX: 7,
      targetY: 7,
      assignedTurn: 1,
    };

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    const tasks = (scenario.game.players.get('ai') as any).aiState.unitTasks;
    expect(tasks['a-settler']).toMatchObject({ role: 'settle' });
    expect(tasks['b-settler']).toMatchObject({ role: 'settle' });
    expect(tasks['a-settler']).toMatchObject({ targetX: 8, targetY: 8 });
    expect(tasks['c-settler']).toBeUndefined();
    expect(
      scenario.game.mapManager.getDistance(
        tasks['a-settler'].targetX,
        tasks['a-settler'].targetY,
        tasks['b-settler'].targetX,
        tasks['b-settler'].targetY
      )
    ).toBeGreaterThanOrEqual(3);
  });

  it('marks an unreachable cross-continent worker task as ferry demand', async () => {
    const scenario = createScenario();
    const worker = scenario.units.get('worker')!;
    worker.x = 1;
    worker.y = 1;
    const ferry = {
      ...scenario.units.get('warrior')!,
      id: 'ferry',
      unitTypeId: 'transport',
      x: 0,
      y: 0,
    };
    scenario.units.clear();
    scenario.units.set(worker.id, worker);
    scenario.units.set(ferry.id, ferry);
    scenario.unitTypes.worker.rulesetUnitClass = 'land';
    scenario.unitTypes.transport = {
      unitClass: 'naval',
      rulesetUnitClass: 'sea',
      transport_capacity: 1,
      cargoClasses: ['land'],
    };
    (scenario.game.unitManager as any).getTransportCapacityRemaining = () => 1;
    (scenario.game.unitManager as any).canContinuePathFrom = () => false;
    scenario.game.mapManager.getTile(3, 3)!.continentId = 2;
    (scenario.game as any).pathfindingManager = {
      findPath: jest.fn().mockResolvedValue({
        valid: false,
        path: [],
        totalCost: 0,
        estimatedTurns: 0,
      }),
    };

    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );

    const tasks = (scenario.game.players.get('ai') as any).aiState.unitTasks;
    expect(tasks.worker).toMatchObject({
      role: 'worker',
      targetX: 3,
      targetY: 3,
      transportRequired: true,
    });
    expect(tasks.ferry).toMatchObject({ role: 'ferry', targetId: 'worker' });

    worker.transportedBy = 'ferry';
    await new FreecivAIOrchestrator(scenario.diplomacyManager as any).processTurn(
      'game',
      scenario.game as any
    );
    expect((scenario.game.players.get('ai') as any).aiState.unitTasks.worker).toMatchObject({
      role: 'worker',
      transportRequired: true,
    });
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
    const passenger: TestUnit = {
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
    const state: any = {
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

    const actions = await new FreecivAITransportController().manageFerries(
      scenario.game as any,
      'ai',
      state
    );

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

  it('pools co-located passengers up to ferry capacity under one passenger-in-charge', async () => {
    const scenario = createScenario();
    const ferry = {
      ...scenario.units.get('warrior')!,
      id: 'ferry',
      unitTypeId: 'transport',
      x: 1,
      y: 1,
    };
    const first = {
      ...scenario.units.get('settler')!,
      id: 'first',
      x: 1,
      y: 1,
    };
    const second = {
      ...scenario.units.get('settler')!,
      id: 'second',
      x: 1,
      y: 1,
    };
    scenario.units.clear();
    scenario.units.set(ferry.id, ferry);
    scenario.units.set(first.id, first);
    scenario.units.set(second.id, second);
    scenario.unitTypes.transport = {
      unitClass: 'naval',
      rulesetUnitClass: 'sea',
      transport_capacity: 2,
      cargoClasses: ['land'],
    };
    scenario.unitTypes.settlers.rulesetUnitClass = 'land';
    (scenario.game.unitManager as any).getTransportCapacityRemaining = () => 2;
    const loadUnitOntoTransport = jest.fn(async (ferryId: string, passengerId: string) => {
      scenario.units.get(passengerId)!.transportedBy = ferryId;
      return true;
    });
    (scenario.game.unitManager as any).loadUnitOntoTransport = loadUnitOntoTransport;
    const state: any = {
      diplomacy: {},
      cityWants: {},
      techWants: {},
      unitTasks: {
        first: { role: 'settle' as const, targetX: 7, targetY: 7, assignedTurn: 1 },
        second: { role: 'guard' as const, targetX: 7, targetY: 7, assignedTurn: 1 },
      },
    };

    const actions = await new FreecivAITransportController().manageFerries(
      scenario.game as any,
      'ai',
      state
    );

    expect(actions).toBe(2);
    expect(loadUnitOntoTransport).toHaveBeenCalledTimes(2);
    expect(state.unitTasks.ferry).toMatchObject({ role: 'ferry', targetId: 'first' });
    expect(first.transportedBy).toBe('ferry');
    expect(second.transportedBy).toBe('ferry');
  });

  it('delivers an embarked passenger through a reachable coastal beachhead', async () => {
    const scenario = createScenario();
    const ferry = {
      ...scenario.units.get('warrior')!,
      id: 'ferry',
      unitTypeId: 'transport',
      x: 0,
      y: 1,
    };
    const passenger: TestUnit = {
      ...scenario.units.get('settler')!,
      id: 'passenger',
      x: 0,
      y: 1,
      transportedBy: 'ferry',
    };
    scenario.units.clear();
    scenario.units.set(ferry.id, ferry);
    scenario.units.set(passenger.id, passenger);
    scenario.unitTypes.transport = {
      unitClass: 'naval',
      rulesetUnitClass: 'sea',
      transport_capacity: 2,
      cargoClasses: ['land'],
    };
    scenario.unitTypes.settlers.rulesetUnitClass = 'land';
    (scenario.game as any).config = { mapWidth: 3, mapHeight: 2 };
    (scenario.game.mapManager as any).getDistance = (
      fromX: number,
      fromY: number,
      toX: number,
      toY: number
    ) => Math.abs(fromX - toX) + Math.abs(fromY - toY);
    (scenario.game.mapManager as any).isValidPosition = (x: number, y: number) =>
      x >= 0 && x < 3 && y >= 0 && y < 2;
    (scenario.game.mapManager as any).getNeighbors = (x: number, y: number) =>
      [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ].filter(position => position.x >= 0 && position.x < 3 && position.y >= 0 && position.y < 2);
    (scenario.game.unitManager as any).getTransportCapacityRemaining = () => 0;
    (scenario.game.unitManager as any).canContinuePathFrom = (unit: TestUnit, x: number) =>
      unit.id === 'ferry' ? x === 0 : x >= 1;
    (scenario.game.unitManager as any).getUnitsAt = () => [];
    (scenario.game as any).pathfindingManager.findPath = jest.fn().mockResolvedValue({
      valid: true,
      path: [{ x: 0, y: 1, moveCost: 0 }],
      totalCost: 1,
      estimatedTurns: 1,
    });
    (scenario.game.unitManager as any).canUnloadUnit = (unitId: string, x: number, y: number) =>
      unitId === 'passenger' && x === 1 && y === 1;
    const unloadUnit = jest.fn(async (_unitId: string, x: number, y: number) => {
      passenger.transportedBy = undefined;
      passenger.x = x;
      passenger.y = y;
      return true;
    });
    (scenario.game.unitManager as any).unloadUnit = unloadUnit;
    const state: any = {
      diplomacy: {},
      cityWants: {},
      techWants: {},
      unitTasks: {
        ferry: { role: 'ferry', targetId: 'passenger', assignedTurn: 1 },
        passenger: { role: 'settle', targetX: 2, targetY: 1, assignedTurn: 1 },
      },
    };

    const actions = await new FreecivAITransportController().manageFerries(
      scenario.game as any,
      'ai',
      state
    );

    expect(actions).toBe(1);
    expect(unloadUnit).toHaveBeenCalledWith('passenger', 1, 1);
    expect({ x: passenger.x, y: passenger.y }).toEqual({ x: 1, y: 1 });
  });
});
