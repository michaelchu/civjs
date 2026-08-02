import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { DatabaseProvider } from '@database';
import { players as playersTable } from '@database/schema';
import type { PlayerState } from '@game/runtime/GameTypes';
import type { BorderManager } from '@game/managers/BorderManager';
import type { CityManager } from '@game/managers/CityManager';
import type { GovernmentManager } from '@game/managers/GovernmentManager';
import type { ResearchManager } from '@game/managers/ResearchManager';
import type { TurnManager } from '@game/managers/TurnManager';
import type { UnitManager } from '@game/managers/UnitManager';
import type { EconomicManager } from '@game/systems/Economic/EconomicManager';
import type { DiplomaticState, DiplomaticRelation } from '@game/managers/DiplomacyManager';
import { createAIState, type FreecivAIState } from '@game/ai/AIStateStore';

const scenarioPlayerSetupSchema = z.object({
  playerNumber: z.number().int().min(1),
  gold: z.number().int().min(0).optional(),
  science: z.number().int().min(0).optional(),
  taxRate: z.number().int().min(0).max(100).optional(),
  luxuryRate: z.number().int().min(0).max(100).optional(),
  scienceRate: z.number().int().min(0).max(100).optional(),
  lockEconomicRates: z.boolean().optional(),
  government: z.string().trim().min(1).optional(),
  revolutionTurns: z.number().int().min(0).optional(),
  technologies: z.array(z.string().trim().min(1)).optional(),
  currentResearch: z.string().trim().min(1).nullable().optional(),
  researchGoal: z.string().trim().min(1).nullable().optional(),
  researchProgress: z.number().int().min(0).optional(),
  researchPerTurn: z.number().int().min(0).optional(),
  history: z.number().int().min(0).optional(),
  teamId: z.string().trim().min(1).nullable().optional(),
  isAlive: z.boolean().optional(),
  isWinner: z.boolean().optional(),
});

const scenarioCitySetupSchema = z.object({
  playerNumber: z.number().int().min(1),
  name: z.string().trim().min(1).max(100),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  population: z.number().int().min(1).optional(),
  buildings: z.array(z.string().trim().min(1)).optional(),
  currentProduction: z.string().trim().min(1).nullable().optional(),
  productionType: z.enum(['unit', 'building']).nullable().optional(),
  productionStock: z.number().int().min(0).optional(),
  foodStock: z.number().int().min(0).optional(),
  history: z.number().int().min(0).optional(),
  isCapital: z.boolean().optional(),
});

const scenarioUnitSetupSchema = z.object({
  playerNumber: z.number().int().min(1),
  unitType: z.string().trim().min(1),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  homeCityName: z.string().trim().min(1).optional(),
  health: z.number().int().min(1).max(100).optional(),
  experience: z.number().int().min(0).optional(),
  veteranLevel: z.number().int().min(0).optional(),
  fortified: z.boolean().optional(),
  movementLeft: z.number().min(0).optional(),
  automation: z.enum(['worker', 'explore']).nullable().optional(),
});

const scenarioDiplomacySetupSchema = z.object({
  playerNumber: z.number().int().min(1),
  otherPlayerNumber: z.number().int().min(1),
  state: z.enum([
    'no_contact',
    'war',
    'ceasefire',
    'armistice',
    'peace',
    'alliance',
    'team',
  ] satisfies [DiplomaticState, ...DiplomaticState[]]),
  maxState: z
    .enum(['no_contact', 'war', 'ceasefire', 'armistice', 'peace', 'alliance', 'team'] satisfies [
      DiplomaticState,
      ...DiplomaticState[],
    ])
    .optional(),
  sinceTurn: z.number().int().min(0).optional(),
  turnsLeft: z.number().int().min(0).optional(),
  contactTurnsLeft: z.number().int().min(0).optional(),
  embassy: z.boolean().optional(),
  sharedVision: z.boolean().optional(),
  givesSharedVision: z.boolean().optional(),
  reputation: z.number().int().min(0).optional(),
  attitude: z.number().int().optional(),
});

const scenarioAIDiplomacySetupSchema = z
  .object({
    playerNumber: z.number().int().min(1),
    otherPlayerNumber: z.number().int().min(1),
    love: z.number().int().min(-1000).max(1000).default(0),
    warDesire: z.number().int().min(-1000).max(1000).default(0),
    countdown: z.number().int().min(0).default(0),
    warCountdown: z.number().int().min(0).optional(),
  })
  .superRefine((value, context) => {
    if (value.playerNumber === value.otherPlayerNumber) {
      context.addIssue({
        code: 'custom',
        path: ['otherPlayerNumber'],
        message: 'must reference a different player',
      });
    }
  });

export const scenarioSetupSchema = z.object({
  initialTurn: z.number().int().min(1).default(1),
  initialYear: z.number().int().optional(),
  replaceDefaultStartingUnits: z.boolean().default(false),
  players: z.array(scenarioPlayerSetupSchema).default([]),
  cities: z.array(scenarioCitySetupSchema).default([]),
  units: z.array(scenarioUnitSetupSchema).default([]),
  diplomacy: z.array(scenarioDiplomacySetupSchema).default([]),
  aiDiplomacy: z.array(scenarioAIDiplomacySetupSchema).default([]),
});

export type ScenarioSetup = z.infer<typeof scenarioSetupSchema>;
export type ScenarioPlayerSetup = z.infer<typeof scenarioPlayerSetupSchema>;
export type ScenarioCitySetup = z.infer<typeof scenarioCitySetupSchema>;
export type ScenarioUnitSetup = z.infer<typeof scenarioUnitSetupSchema>;
export type ScenarioDiplomacySetup = z.infer<typeof scenarioDiplomacySetupSchema>;
export type ScenarioAIDiplomacySetup = z.infer<typeof scenarioAIDiplomacySetupSchema>;

export interface ScenarioSetupContext {
  databaseProvider: DatabaseProvider;
  gameId: string;
  players: Map<string, PlayerState>;
  cityManager: CityManager;
  unitManager: UnitManager;
  researchManager: ResearchManager;
  governmentManager: GovernmentManager;
  economicManager: EconomicManager;
  borderManager: BorderManager;
  turnManager: TurnManager;
}

export function hasCustomScenarioInitialState(setup: ScenarioSetup | undefined): boolean {
  return Boolean(
    setup && (setup.replaceDefaultStartingUnits || setup.cities.length || setup.units.length)
  );
}

export async function applyScenarioSetup(
  setup: ScenarioSetup,
  context: ScenarioSetupContext
): Promise<void> {
  const playersByNumber = indexPlayers(context.players);
  validatePlayerReferences(setup, playersByNumber);

  await applyPlayerSetup(setup.players, playersByNumber, context);
  await applyDiplomacySetup(setup.diplomacy, playersByNumber, context, setup.initialTurn);
  await applyAIDiplomacySetup(setup.aiDiplomacy, playersByNumber, context);

  const citiesByName = await applyCitySetup(setup.cities, playersByNumber, context);
  await applyUnitSetup(setup.units, playersByNumber, citiesByName, context);
}

function indexPlayers(players: Map<string, PlayerState>): Map<number, PlayerState> {
  return new Map([...players.values()].map(player => [player.playerNumber, player]));
}

function validatePlayerReferences(
  setup: ScenarioSetup,
  playersByNumber: Map<number, PlayerState>
): void {
  const references = [
    ...setup.players.map(player => player.playerNumber),
    ...setup.cities.map(city => city.playerNumber),
    ...setup.units.map(unit => unit.playerNumber),
    ...setup.diplomacy.flatMap(pair => [pair.playerNumber, pair.otherPlayerNumber]),
    ...setup.aiDiplomacy.flatMap(pair => [pair.playerNumber, pair.otherPlayerNumber]),
  ];
  const unknown = references.find(playerNumber => !playersByNumber.has(playerNumber));
  if (unknown !== undefined) {
    throw new Error(`Scenario setup references unknown player number ${unknown}`);
  }
  const duplicatePlayers = findDuplicate(setup.players.map(player => player.playerNumber));
  if (duplicatePlayers !== undefined) {
    throw new Error(`Scenario setup contains duplicate player number ${duplicatePlayers}`);
  }
  for (const pair of setup.diplomacy) {
    if (pair.playerNumber === pair.otherPlayerNumber) {
      throw new Error('Scenario diplomacy cannot relate a player to itself');
    }
  }
  for (const pair of setup.aiDiplomacy) {
    if (pair.playerNumber === pair.otherPlayerNumber) {
      throw new Error('Scenario AI diplomacy cannot relate a player to itself');
    }
  }
}

async function applyPlayerSetup(
  setups: ScenarioPlayerSetup[],
  playersByNumber: Map<number, PlayerState>,
  context: ScenarioSetupContext
): Promise<void> {
  for (const setup of setups) {
    const player = playersByNumber.get(setup.playerNumber)!;
    const playerPatch = definedFields({
      gold: setup.gold,
      science: setup.science,
      taxRate: setup.taxRate,
      luxuryRate: setup.luxuryRate,
      scienceRate: setup.scienceRate,
      government: setup.government,
      revolutionTurns: setup.revolutionTurns,
      history: setup.history,
      teamId: setup.teamId,
      isAlive: setup.isAlive,
      isWinner: setup.isWinner,
      currentResearch: setup.currentResearch,
      researchProgress: setup.researchProgress,
    });

    if (Object.keys(playerPatch).length > 0) {
      await context.databaseProvider
        .getDatabase()
        .update(playersTable)
        .set(playerPatch as Partial<typeof playersTable.$inferInsert>)
        .where(and(eq(playersTable.id, player.id), eq(playersTable.gameId, context.gameId)));
      Object.assign(player, playerPatch);
    }

    const researchState = {
      researchedTechs: setup.technologies,
      currentResearch: setup.currentResearch,
      researchGoal: setup.researchGoal,
      bulbsAccumulated: setup.researchProgress,
      bulbsLastTurn: setup.researchPerTurn,
    };
    if (hasDefinedValue(researchState)) {
      await context.researchManager.seedPlayerResearch(player.id, researchState);
    }
    if (setup.technologies !== undefined) player.technologies = [...setup.technologies];

    await applyGovernmentSetup(setup, player, context);
    await applyEconomicSetup(setup, player, context);
  }
}

async function applyAIDiplomacySetup(
  setups: ScenarioAIDiplomacySetup[],
  playersByNumber: Map<number, PlayerState>,
  context: ScenarioSetupContext
): Promise<void> {
  if (setups.length === 0) return;
  const updatedStates = new Map<string, FreecivAIState>();
  for (const setup of setups) {
    const player = playersByNumber.get(setup.playerNumber)!;
    const otherPlayer = playersByNumber.get(setup.otherPlayerNumber)!;
    if (!player.isAI) {
      throw new Error(`Scenario AI diplomacy requires AI player ${setup.playerNumber}`);
    }
    const current = (player.aiState ?? {}) as Partial<FreecivAIState>;
    const aiState: FreecivAIState = {
      ...createAIState(),
      ...current,
      diplomacy: { ...(current.diplomacy ?? {}) },
      unitTasks: { ...(current.unitTasks ?? {}) },
      cityWants: { ...(current.cityWants ?? {}) },
      techWants: { ...(current.techWants ?? {}) },
    };
    aiState.diplomacy[otherPlayer.id] = {
      love: setup.love,
      warDesire: setup.warDesire,
      countdown: setup.countdown,
      ...(setup.warCountdown === undefined ? {} : { warCountdown: setup.warCountdown }),
    };
    player.aiState = aiState as unknown as Record<string, unknown>;
    updatedStates.set(player.id, aiState);
  }

  await Promise.all(
    [...updatedStates.entries()].map(([playerId, aiState]) =>
      context.databaseProvider
        .getDatabase()
        .update(playersTable)
        .set({ aiState })
        .where(and(eq(playersTable.id, playerId), eq(playersTable.gameId, context.gameId)))
    )
  );
}

async function applyGovernmentSetup(
  setup: ScenarioPlayerSetup,
  player: PlayerState,
  context: ScenarioSetupContext
): Promise<void> {
  if (setup.government === undefined && setup.revolutionTurns === undefined) return;
  await context.governmentManager.loadPlayerGovernment(
    player.id,
    setup.government ?? player.government ?? 'despotism',
    setup.revolutionTurns ?? 0
  );
}

async function applyEconomicSetup(
  setup: ScenarioPlayerSetup,
  player: PlayerState,
  context: ScenarioSetupContext
): Promise<void> {
  if (
    setup.gold === undefined &&
    setup.taxRate === undefined &&
    setup.luxuryRate === undefined &&
    setup.scienceRate === undefined
  ) {
    return;
  }
  await context.economicManager.initializePlayer(player.id, setup.gold ?? player.gold ?? 0, {
    tax: setup.taxRate ?? 40,
    luxury: setup.luxuryRate ?? 0,
    science: setup.scienceRate ?? 60,
  });
}

async function applyDiplomacySetup(
  setups: ScenarioDiplomacySetup[],
  playersByNumber: Map<number, PlayerState>,
  context: ScenarioSetupContext,
  initialTurn: number
): Promise<void> {
  if (setups.length === 0) return;
  const rows = await context.databaseProvider.getDatabase().query.players.findMany({
    where: eq(playersTable.gameId, context.gameId),
  });
  const knownByPlayer = new Map<string, Set<string>>(
    rows.map(row => [row.id, new Set(Array.isArray(row.knownPlayers) ? row.knownPlayers : [])])
  );
  const relationsByPlayer = new Map<string, Record<string, DiplomaticRelation>>(
    rows.map(row => [row.id, readRelations(row.diplomaticRelations)])
  );
  const pairKeys = new Set<string>();

  for (const setup of setups) {
    const first = playersByNumber.get(setup.playerNumber)!;
    const second = playersByNumber.get(setup.otherPlayerNumber)!;
    const pairKey = [first.id, second.id].sort().join(':');
    if (!pairKeys.add(pairKey)) throw new Error(`Duplicate scenario diplomacy pair '${pairKey}'`);

    const relation = scenarioRelation(setup, initialTurn);
    relationsByPlayer.get(first.id)![second.id] = relation;
    relationsByPlayer.get(second.id)![first.id] = { ...relation };
    knownByPlayer.get(first.id)!.add(second.id);
    knownByPlayer.get(second.id)!.add(first.id);
  }

  for (const player of rows) {
    await context.databaseProvider
      .getDatabase()
      .update(playersTable)
      .set({
        knownPlayers: [...knownByPlayer.get(player.id)!],
        diplomaticRelations: relationsByPlayer.get(player.id)!,
      })
      .where(eq(playersTable.id, player.id));
  }
}

function scenarioRelation(setup: ScenarioDiplomacySetup, initialTurn: number): DiplomaticRelation {
  return {
    state: setup.state,
    maxState: setup.maxState ?? setup.state,
    sinceTurn: setup.sinceTurn ?? initialTurn,
    turnsLeft: setup.turnsLeft ?? 0,
    contactTurnsLeft: setup.contactTurnsLeft ?? 0,
    hasReasonToCancel: 0,
    embassy: setup.embassy ?? false,
    sharedVision: setup.sharedVision ?? false,
    ...(setup.givesSharedVision === undefined
      ? {}
      : { givesSharedVision: setup.givesSharedVision }),
    reputation: setup.reputation ?? 1000,
    attitude: setup.attitude ?? 0,
  };
}

async function applyCitySetup(
  setups: ScenarioCitySetup[],
  playersByNumber: Map<number, PlayerState>,
  context: ScenarioSetupContext
): Promise<Map<string, string>> {
  const citiesByName = new Map<string, string>();
  for (const setup of setups) {
    const player = playersByNumber.get(setup.playerNumber)!;
    if (citiesByName.has(setup.name.toLowerCase())) {
      throw new Error(`Scenario setup contains duplicate city '${setup.name}'`);
    }
    const city = await context.cityManager.foundCity(setup.x, setup.y, setup.name, player.id);
    Object.assign(
      city,
      definedFields({
        population: setup.population,
        buildings: setup.buildings === undefined ? undefined : [...setup.buildings],
        currentProduction: setup.currentProduction,
        productionType: setup.productionType,
        productionStock: setup.productionStock,
        foodStock: setup.foodStock,
        history: setup.history,
        isCapital: setup.isCapital,
      })
    );
    city.size = city.population;
    context.cityManager.refreshCityWithGovernmentEffects(city.id);
    await context.cityManager.saveCity(city.id);
    citiesByName.set(setup.name.toLowerCase(), city.id);
  }
  return citiesByName;
}

async function applyUnitSetup(
  setups: ScenarioUnitSetup[],
  playersByNumber: Map<number, PlayerState>,
  citiesByName: Map<string, string>,
  context: ScenarioSetupContext
): Promise<void> {
  for (const setup of setups) {
    const player = playersByNumber.get(setup.playerNumber)!;
    const homeCityId = setup.homeCityName
      ? citiesByName.get(setup.homeCityName.toLowerCase())
      : undefined;
    if (setup.homeCityName && !homeCityId) {
      throw new Error(`Scenario unit references unknown city '${setup.homeCityName}'`);
    }
    const unit = await context.unitManager.createUnit(
      player.id,
      setup.unitType,
      setup.x,
      setup.y,
      homeCityId
    );
    await context.unitManager.seedUnitState(unit.id, {
      health: setup.health,
      experience: setup.experience,
      veteranLevel: setup.veteranLevel,
      fortified: setup.fortified,
      movementLeft: setup.movementLeft,
      automation: setup.automation ?? undefined,
    });
  }
}

function readRelations(value: unknown): Record<string, DiplomaticRelation> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, DiplomaticRelation>) }
    : {};
}

function definedFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

function hasDefinedValue(fields: Record<string, unknown>): boolean {
  return Object.values(fields).some(value => value !== undefined);
}

function findDuplicate(values: number[]): number | undefined {
  const seen = new Set<number>();
  return values.find(value => (seen.has(value) ? true : (seen.add(value), false)));
}
