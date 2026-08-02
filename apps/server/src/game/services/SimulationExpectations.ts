import { z } from 'zod';

export const simulationDiplomaticStateSchema = z.enum([
  'no_contact',
  'war',
  'ceasefire',
  'armistice',
  'peace',
  'alliance',
  'team',
]);

export const simulationDiplomacyEventTypeSchema = z.enum([
  'first_contact',
  'proposal',
  'accepted',
  'rejected',
  'cancelled',
  'ceasefire_expired',
  'armistice_completed',
  'war_declared',
  'vision_cancelled',
  'incident',
]);

const playerExpectationSchema = z
  .object({
    playerNumber: z.number().int().min(1),
    isAlive: z.boolean().optional(),
    isWinner: z.boolean().optional(),
    minCities: z.number().int().min(0).optional(),
    maxCities: z.number().int().min(0).optional(),
    minUnits: z.number().int().min(0).optional(),
    maxUnits: z.number().int().min(0).optional(),
    minTechnologies: z.number().int().min(0).optional(),
    maxTechnologies: z.number().int().min(0).optional(),
    requiredTechnologies: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((value, context) => {
    addRangeIssue(context, value.minCities, value.maxCities, 'cities');
    addRangeIssue(context, value.minUnits, value.maxUnits, 'units');
    addRangeIssue(context, value.minTechnologies, value.maxTechnologies, 'technologies');
  });

const diplomacyExpectationSchema = z
  .object({
    playerNumber: z.number().int().min(1),
    otherPlayerNumber: z.number().int().min(1),
    state: simulationDiplomaticStateSchema.optional(),
    maxState: simulationDiplomaticStateSchema.optional(),
    embassy: z.boolean().optional(),
    sharedVision: z.boolean().optional(),
    proposalStatus: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(),
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

const diplomacyEventExpectationSchema = z
  .object({
    type: simulationDiplomacyEventTypeSchema,
    playerNumber: z.number().int().min(1),
    otherPlayerNumber: z.number().int().min(1),
    minCount: z.number().int().min(1).default(1),
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

export const simulationExpectationSchema = z
  .object({
    minCompletedTurns: z.number().int().min(0).optional(),
    maxCompletedTurns: z.number().int().min(0).optional(),
    endReason: z.string().trim().min(1).optional(),
    players: z.array(playerExpectationSchema).default([]),
    diplomacy: z.array(diplomacyExpectationSchema).default([]),
    diplomacyEvents: z.array(diplomacyEventExpectationSchema).default([]),
  })
  .superRefine((value, context) => {
    addRangeIssue(context, value.minCompletedTurns, value.maxCompletedTurns, 'completedTurns');
  });

export type SimulationExpectations = z.infer<typeof simulationExpectationSchema>;

export interface SimulationExpectationContext {
  completedTurns: ReadonlyArray<{ turn: number; snapshot: unknown }>;
  endReason: string;
  standings: unknown;
}

export interface SimulationExpectationResult {
  passed: boolean;
  failures: string[];
}

interface ReplayPlayer {
  playerId: string;
  playerNumber: number;
  isAlive: boolean;
  relations: ReplayRelation[];
}

interface ReplayRelation {
  playerId: string;
  state?: string;
  maxState?: string;
  embassy?: boolean;
  sharedVision?: boolean;
  proposal?: { status?: string };
}

interface FinalState {
  players: ReplayPlayer[];
  cities: Record<string, unknown>[];
  units: Record<string, unknown>[];
  research: Record<string, unknown>;
}

export function evaluateSimulationExpectations(
  expectations: SimulationExpectations,
  context: SimulationExpectationContext
): SimulationExpectationResult {
  const failures: string[] = [];
  const completedTurns = context.completedTurns.length;
  const finalState = readFinalState(context.completedTurns.at(-1)?.snapshot);
  const playersByNumber = new Map(finalState.players.map(player => [player.playerNumber, player]));
  const playerNumberById = new Map(
    finalState.players.map(player => [player.playerId, player.playerNumber])
  );

  checkTurnBounds(expectations, completedTurns, failures);
  if (expectations.endReason && expectations.endReason !== context.endReason) {
    failures.push(`endReason: expected ${expectations.endReason}, observed ${context.endReason}`);
  }

  for (const [index, expected] of expectations.players.entries()) {
    const player = playersByNumber.get(expected.playerNumber);
    if (!player) {
      failures.push(
        `players[${index}]: player ${expected.playerNumber} is missing from the final snapshot`
      );
      continue;
    }
    checkPlayerExpectation(
      expected,
      player,
      finalState,
      context.standings,
      failures,
      `players[${index}]`
    );
  }

  for (const [index, expected] of expectations.diplomacy.entries()) {
    checkDiplomacyExpectation(expected, playersByNumber, failures, `diplomacy[${index}]`);
  }

  const diplomacyEvents = readDiplomacyEvents(context.completedTurns);
  for (const [index, expected] of expectations.diplomacyEvents.entries()) {
    const observed = diplomacyEvents.filter(event => {
      if (event.type !== expected.type || event.playerIds.length < 2) return false;
      return (
        playerNumberById.get(event.playerIds[0]) === expected.playerNumber &&
        playerNumberById.get(event.playerIds[1]) === expected.otherPlayerNumber
      );
    }).length;
    if (observed < expected.minCount) {
      failures.push(
        `diplomacyEvents[${index}]: expected ${expected.type} from player ${expected.playerNumber} to player ${expected.otherPlayerNumber} at least ${expected.minCount} time(s), observed ${observed}`
      );
    }
  }

  return { passed: failures.length === 0, failures };
}

function checkTurnBounds(
  expectations: SimulationExpectations,
  completedTurns: number,
  failures: string[]
): void {
  if (
    expectations.minCompletedTurns !== undefined &&
    completedTurns < expectations.minCompletedTurns
  ) {
    failures.push(
      `minCompletedTurns: expected at least ${expectations.minCompletedTurns}, observed ${completedTurns}`
    );
  }
  if (
    expectations.maxCompletedTurns !== undefined &&
    completedTurns > expectations.maxCompletedTurns
  ) {
    failures.push(
      `maxCompletedTurns: expected at most ${expectations.maxCompletedTurns}, observed ${completedTurns}`
    );
  }
}

function checkPlayerExpectation(
  expected: SimulationExpectations['players'][number],
  player: ReplayPlayer,
  finalState: FinalState,
  standings: unknown,
  failures: string[],
  path: string
): void {
  if (expected.isAlive !== undefined && player.isAlive !== expected.isAlive) {
    failures.push(`${path}.isAlive: expected ${expected.isAlive}, observed ${player.isAlive}`);
  }

  const winner = readWinnerIds(standings).has(player.playerId);
  if (expected.isWinner !== undefined && winner !== expected.isWinner) {
    failures.push(`${path}.isWinner: expected ${expected.isWinner}, observed ${winner}`);
  }

  const cityCount = countOwned(finalState.cities, player.playerId);
  checkCountBounds(expected.minCities, expected.maxCities, cityCount, `${path}.cities`, failures);

  const unitCount = countOwned(finalState.units, player.playerId);
  checkCountBounds(expected.minUnits, expected.maxUnits, unitCount, `${path}.units`, failures);

  const technologies = readTechnologies(finalState.research[player.playerId]);
  checkCountBounds(
    expected.minTechnologies,
    expected.maxTechnologies,
    technologies.length,
    `${path}.technologies`,
    failures
  );
  for (const technology of expected.requiredTechnologies ?? []) {
    if (
      !technologies.some(
        observed => normalizeIdentifier(observed) === normalizeIdentifier(technology)
      )
    ) {
      failures.push(`${path}.requiredTechnologies: missing ${technology}`);
    }
  }
}

function checkDiplomacyExpectation(
  expected: SimulationExpectations['diplomacy'][number],
  playersByNumber: Map<number, ReplayPlayer>,
  failures: string[],
  path: string
): void {
  const player = playersByNumber.get(expected.playerNumber);
  const otherPlayer = playersByNumber.get(expected.otherPlayerNumber);
  if (!player || !otherPlayer) {
    failures.push(
      `${path}: expected players ${expected.playerNumber} and ${expected.otherPlayerNumber} in the final snapshot`
    );
    return;
  }

  const relation = findRelation(player, otherPlayer.playerId);
  const reverseRelation = findRelation(otherPlayer, player.playerId);
  if (!relation) {
    failures.push(
      `${path}: relation from player ${expected.playerNumber} to player ${expected.otherPlayerNumber} is missing`
    );
    return;
  }
  checkExpectedRelationValues(expected, relation, failures, path);
  checkBilateralRelationValues(relation, reverseRelation, expected, failures, path);
}

function findRelation(player: ReplayPlayer, targetPlayerId: string): ReplayRelation | undefined {
  return player.relations.find(candidate => candidate.playerId === targetPlayerId);
}

function checkExpectedRelationValues(
  expected: SimulationExpectations['diplomacy'][number],
  relation: ReplayRelation,
  failures: string[],
  path: string
): void {
  checkOptionalValue(expected.state, relation.state, `${path}.state`, failures);
  checkOptionalValue(expected.maxState, relation.maxState, `${path}.maxState`, failures);
  checkOptionalValue(expected.embassy, relation.embassy, `${path}.embassy`, failures);
  checkOptionalValue(
    expected.sharedVision,
    relation.sharedVision,
    `${path}.sharedVision`,
    failures
  );
  checkOptionalValue(
    expected.proposalStatus,
    relation.proposal?.status,
    `${path}.proposalStatus`,
    failures
  );
}

function checkBilateralRelationValues(
  relation: ReplayRelation,
  reverseRelation: ReplayRelation | undefined,
  expected: SimulationExpectations['diplomacy'][number],
  failures: string[],
  path: string
): void {
  if (!reverseRelation) {
    failures.push(
      `${path}: reverse relation from player ${expected.otherPlayerNumber} to player ${expected.playerNumber} is missing`
    );
    return;
  }
  if (relation.state !== reverseRelation.state) {
    failures.push(
      `${path}: bilateral state mismatch (${relation.state ?? 'missing'} vs ${reverseRelation.state ?? 'missing'})`
    );
  }
  if (relation.maxState !== reverseRelation.maxState) {
    failures.push(
      `${path}: bilateral maxState mismatch (${relation.maxState ?? 'missing'} vs ${reverseRelation.maxState ?? 'missing'})`
    );
  }
}

function checkCountBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  observed: number,
  path: string,
  failures: string[]
): void {
  if (minimum !== undefined && observed < minimum) {
    failures.push(`${path}: expected at least ${minimum}, observed ${observed}`);
  }
  if (maximum !== undefined && observed > maximum) {
    failures.push(`${path}: expected at most ${maximum}, observed ${observed}`);
  }
}

function checkOptionalValue<T>(
  expected: T | undefined,
  observed: T | undefined,
  path: string,
  failures: string[]
): void {
  if (expected !== undefined && expected !== observed) {
    failures.push(`${path}: expected ${String(expected)}, observed ${String(observed)}`);
  }
}

function readFinalState(snapshot: unknown): FinalState {
  const record = asRecord(snapshot);
  const diplomacy = asRecord(record.diplomacy);
  return {
    players: asArray(diplomacy.players)
      .map(readReplayPlayer)
      .filter((player): player is ReplayPlayer => player !== null),
    cities: asArray(record.cities).map(asRecord),
    units: asArray(record.units).map(asRecord),
    research: asRecord(record.research),
  };
}

function readReplayPlayer(value: unknown): ReplayPlayer | null {
  const record = asRecord(value);
  const playerId = readString(record.playerId);
  const playerNumber = record.playerNumber;
  if (!playerId || typeof playerNumber !== 'number' || !Number.isInteger(playerNumber)) return null;
  return {
    playerId,
    playerNumber,
    isAlive: record.isAlive === true,
    relations: asArray(record.relations)
      .map(readReplayRelation)
      .filter((relation): relation is ReplayRelation => relation !== null),
  };
}

function readReplayRelation(value: unknown): ReplayRelation | null {
  const record = asRecord(value);
  const playerId = readString(record.playerId);
  if (!playerId) return null;
  const proposal = asRecord(record.proposal);
  return {
    playerId,
    state: readString(record.state),
    maxState: readString(record.maxState),
    embassy: readBoolean(record.embassy),
    sharedVision: readBoolean(record.sharedVision),
    proposal: Object.keys(proposal).length ? { status: readString(proposal.status) } : undefined,
  };
}

function readDiplomacyEvents(
  completedTurns: ReadonlyArray<{ turn: number; snapshot: unknown }>
): Array<{ type: string | undefined; playerIds: string[] }> {
  return completedTurns.flatMap(({ snapshot }) => {
    const events = asArray(asRecord(snapshot).diplomacyEvents);
    return events.map(event => {
      const record = asRecord(event);
      return {
        type: readString(record.type),
        playerIds: asArray(record.playerIds)
          .map(readString)
          .filter((playerId): playerId is string => playerId !== undefined),
      };
    });
  });
}

function readWinnerIds(standings: unknown): Set<string> {
  const record = asRecord(standings);
  const winnerIds = asArray(record.winnerPlayerIds).map(readString);
  const winnerId = readString(record.winnerPlayerId);
  if (winnerId) winnerIds.push(winnerId);
  return new Set(winnerIds.filter((id): id is string => id !== undefined));
}

function readTechnologies(value: unknown): string[] {
  return asArray(asRecord(value).researchedTechs)
    .map(readString)
    .filter((technology): technology is string => technology !== undefined);
}

function countOwned(items: Record<string, unknown>[], playerId: string): number {
  return items.filter(item => item.playerId === playerId).length;
}

function addRangeIssue(
  context: z.RefinementCtx,
  minimum: number | undefined,
  maximum: number | undefined,
  path: string
): void {
  if (minimum === undefined || maximum === undefined || minimum <= maximum) return;
  context.addIssue({
    code: 'custom',
    path: [path],
    message: `minimum must not exceed maximum`,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}
