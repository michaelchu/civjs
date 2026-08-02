/**
 * @module server/game/simulation/expectations/ExpectationEvaluator
 * Defines Expectation Evaluator headless simulation behavior.
 */
import type { SimulationExpectations } from './ExpectationSchema';
import {
  asArray,
  asRecord,
  normalizeIdentifier,
  readBoolean,
  readNonNegativeInteger,
  readString,
} from '../shared/SimulationValueReader';

export interface SimulationExpectationContext {
  completedTurns: ReadonlyArray<{ turn: number; snapshot: unknown; events?: unknown[] }>;
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

interface ReplayEvent {
  type: string;
  turn: number;
  playerIds: string[];
  data: Record<string, unknown>;
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
  const replayEvents = readReplayEvents(context.completedTurns);

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

  for (const [index, expected] of expectations.cities.entries()) {
    checkCityExpectation(expected, finalState, playersByNumber, failures, `cities[${index}]`);
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

  for (const [index, expected] of expectations.events.entries()) {
    checkEventExpectation(expected, replayEvents, playerNumberById, failures, `events[${index}]`);
  }

  return { passed: failures.length === 0, failures };
}

function checkEventExpectation(
  expected: SimulationExpectations['events'][number],
  events: ReplayEvent[],
  playerNumberById: Map<string, number>,
  failures: string[],
  path: string
): void {
  const observed = events.filter(event =>
    matchesEventExpectation(event, expected, playerNumberById)
  ).length;
  if (observed < expected.minCount) {
    failures.push(
      `${path}: expected ${expected.type} at least ${expected.minCount} time(s), observed ${observed}`
    );
  }
  if (expected.maxCount !== undefined && observed > expected.maxCount) {
    failures.push(
      `${path}: expected ${expected.type} at most ${expected.maxCount} time(s), observed ${observed}`
    );
  }
}

function matchesEventExpectation(
  event: ReplayEvent,
  expected: SimulationExpectations['events'][number],
  playerNumberById: Map<string, number>
): boolean {
  return (
    event.type === expected.type &&
    matchesEventTurn(event.turn, expected) &&
    matchesEventPlayers(event, expected, playerNumberById) &&
    (expected.data === undefined || matchesRecord(event.data, expected.data))
  );
}

function matchesEventTurn(
  turn: number,
  expected: SimulationExpectations['events'][number]
): boolean {
  if (expected.turn !== undefined && turn !== expected.turn) return false;
  if (expected.minTurn !== undefined && turn < expected.minTurn) return false;
  if (expected.maxTurn !== undefined && turn > expected.maxTurn) return false;
  return true;
}

function matchesEventPlayers(
  event: ReplayEvent,
  expected: SimulationExpectations['events'][number],
  playerNumberById: Map<string, number>
): boolean {
  const playerNumber = playerNumberById.get(event.playerIds[0]);
  const otherPlayerNumber = playerNumberById.get(event.playerIds[1]);
  return (
    (expected.playerNumber === undefined || playerNumber === expected.playerNumber) &&
    (expected.otherPlayerNumber === undefined || otherPlayerNumber === expected.otherPlayerNumber)
  );
}

function readReplayEvents(
  completedTurns: ReadonlyArray<{ turn: number; snapshot: unknown; events?: unknown[] }>
): ReplayEvent[] {
  return completedTurns.flatMap(({ turn, snapshot, events }) => [
    ...readStoredEvents(turn, events),
    ...readDiplomacyReplayEvents(turn, snapshot),
  ]);
}

function readStoredEvents(turn: number, events: unknown[] | undefined): ReplayEvent[] {
  return (events ?? []).flatMap(value => {
    const record = asRecord(value);
    const data = asRecord(record.eventData);
    const type = readString(record.eventType) ?? readString(data.type);
    if (!type) return [];
    return [
      {
        type,
        turn: readNonNegativeInteger(data.turn) ?? turn,
        playerIds: readEventPlayerIds(record, data),
        data,
      },
    ];
  });
}

function readDiplomacyReplayEvents(turn: number, snapshot: unknown): ReplayEvent[] {
  return asArray(asRecord(snapshot).diplomacyEvents).flatMap(value => {
    const record = asRecord(value);
    const type = readString(record.type);
    if (!type) return [];
    return [
      {
        type,
        turn,
        playerIds: asArray(record.playerIds)
          .map(readString)
          .filter((playerId): playerId is string => playerId !== undefined),
        data: record,
      },
    ];
  });
}

function readEventPlayerIds(
  record: Record<string, unknown>,
  data: Record<string, unknown>
): string[] {
  const ids = [
    ...asArray(data.playerIds).map(readString),
    readString(record.playerId),
    readString(record.relatedPlayerId),
    readString(data.playerId),
    readString(data.targetPlayerId),
  ].filter((playerId): playerId is string => playerId !== undefined);
  return [...new Set(ids)];
}

function matchesRecord(
  observed: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean {
  return Object.entries(expected).every(([key, expectedValue]) =>
    matchesValue(observed[key], expectedValue)
  );
}

function matchesValue(observed: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(observed, expected);
  if (Array.isArray(expected)) {
    return (
      Array.isArray(observed) &&
      observed.length === expected.length &&
      expected.every((value, index) => matchesValue(observed[index], value))
    );
  }
  if (observed === null || typeof observed !== 'object' || Array.isArray(observed)) return false;
  return matchesRecord(asRecord(observed), expected as Record<string, unknown>);
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

function checkCityExpectation(
  expected: SimulationExpectations['cities'][number],
  finalState: FinalState,
  playersByNumber: Map<number, ReplayPlayer>,
  failures: string[],
  path: string
): void {
  const player = playersByNumber.get(expected.playerNumber);
  if (!player) {
    failures.push(`${path}: player ${expected.playerNumber} is missing from the final snapshot`);
    return;
  }

  const city = finalState.cities.find(
    candidate =>
      candidate.playerId === player.playerId &&
      (expected.name === undefined || candidate.name === expected.name)
  );
  if (!city) {
    failures.push(
      `${path}: city ${expected.name ?? '(any)'} for player ${expected.playerNumber} is missing from the final snapshot`
    );
    return;
  }

  checkNumericBounds(
    expected.minPopulation,
    expected.maxPopulation,
    city.population,
    `${path}.population`,
    failures
  );
  checkNumericBounds(
    expected.minTradePerTurn,
    expected.maxTradePerTurn,
    city.tradePerTurn,
    `${path}.tradePerTurn`,
    failures
  );
  checkNumericBounds(
    expected.minLuxuryPerTurn,
    expected.maxLuxuryPerTurn,
    city.luxuryPerTurn,
    `${path}.luxuryPerTurn`,
    failures
  );
  checkNumericBounds(
    expected.minTradeRoutes,
    expected.maxTradeRoutes,
    Array.isArray(city.tradeRoutes) ? city.tradeRoutes.length : undefined,
    `${path}.tradeRoutes`,
    failures
  );
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

function checkNumericBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  observed: unknown,
  path: string,
  failures: string[]
): void {
  if (minimum === undefined && maximum === undefined) return;
  if (typeof observed !== 'number' || !Number.isFinite(observed)) {
    failures.push(`${path}: expected a numeric value, observed ${String(observed)}`);
    return;
  }
  checkCountBounds(minimum, maximum, observed, path, failures);
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
