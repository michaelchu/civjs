import {
  asArray,
  asRecord,
  isFiniteNumber,
  readNonNegativeInteger as readInteger,
  readPositiveInteger,
  readString,
} from '../shared/SimulationValueReader';

const DIPLOMATIC_STATE_ORDER: Record<string, number> = {
  no_contact: 0,
  war: 1,
  ceasefire: 2,
  armistice: 3,
  peace: 4,
  alliance: 5,
  team: 6,
};

const DIPLOMACY_STATES = new Set(Object.keys(DIPLOMATIC_STATE_ORDER));
const PROPOSAL_STATUSES = new Set(['pending', 'accepted', 'rejected', 'cancelled']);

export type SimulationInvariantCode =
  | 'SNAPSHOT_STRUCTURE'
  | 'TURN_SEQUENCE'
  | 'MAP_STATE'
  | 'PLAYER_STATE'
  | 'CITY_STATE'
  | 'CITY_REFERENCE'
  | 'CITY_TRADE_ROUTE'
  | 'UNIT_STATE'
  | 'UNIT_REFERENCE'
  | 'UNIT_TRANSPORT'
  | 'DIPLOMACY_STATE'
  | 'DIPLOMACY_SYMMETRY'
  | 'RESEARCH_STATE';

export interface SimulationInvariantViolation {
  code: SimulationInvariantCode;
  turn: number;
  path: string;
  message: string;
  reference: string;
}

export interface SimulationInvariantResult {
  passed: boolean;
  checkedTurns: number;
  violations: SimulationInvariantViolation[];
}

interface MapBounds {
  width: number;
  height: number;
}

interface ReplayPlayer {
  id: string;
  playerNumber: number;
  isAlive?: boolean;
  teamId?: string;
  relations: Map<string, Record<string, unknown>>;
}

interface ReplayCity {
  record: Record<string, unknown>;
  id: string;
  playerId: string;
  x: number;
  y: number;
}

interface ReplayUnit {
  record: Record<string, unknown>;
  id: string;
  playerId: string;
}

type ViolationReporter = (
  code: SimulationInvariantCode,
  turn: number,
  path: string,
  message: string,
  reference: string
) => void;

const REFERENCES = {
  general: 'reference/freeciv/server/sanitycheck.c:663-687',
  map: 'reference/freeciv/server/sanitycheck.c:171-220',
  cities: 'reference/freeciv/server/sanitycheck.c:223-319',
  citySize: 'reference/freeciv/server/sanitycheck.c:322-356',
  units: 'reference/freeciv/server/sanitycheck.c:412-505',
  unitIdentity: 'reference/freeciv/common/unit.h:264-271',
  diplomacy: 'reference/freeciv/server/sanitycheck.c:537-572',
  diplomacyMaxState: 'reference/freeciv/server/diplhand.c:81-112',
  research: 'reference/freeciv/server/sanitycheck.c:629-646',
} as const;

export function evaluateSimulationInvariants(
  completedTurns: ReadonlyArray<{ turn: number; snapshot: unknown }>
): SimulationInvariantResult {
  const violations: SimulationInvariantViolation[] = [];
  let previousTurn: number | undefined;

  for (const checkpoint of completedTurns) {
    const snapshot = asRecord(checkpoint.snapshot);
    const snapshotTurn = readInteger(snapshot.turn);
    const turn = snapshotTurn ?? checkpoint.turn;

    if (snapshotTurn === undefined) {
      report(
        violations,
        'SNAPSHOT_STRUCTURE',
        checkpoint.turn,
        'snapshot.turn',
        'snapshot turn must be a non-negative integer',
        REFERENCES.general
      );
    } else if (snapshotTurn !== checkpoint.turn) {
      report(
        violations,
        'TURN_SEQUENCE',
        checkpoint.turn,
        'snapshot.turn',
        `snapshot turn ${snapshotTurn} does not match replay turn ${checkpoint.turn}`,
        REFERENCES.general
      );
    }

    if (previousTurn !== undefined && turn <= previousTurn) {
      report(
        violations,
        'TURN_SEQUENCE',
        turn,
        'replay.turns',
        `turn ${turn} is not greater than previous completed turn ${previousTurn}`,
        REFERENCES.general
      );
    }
    previousTurn = turn;

    checkSnapshot(snapshot, turn, violations);
  }

  return {
    passed: violations.length === 0,
    checkedTurns: completedTurns.length,
    violations,
  };
}

function checkSnapshot(
  snapshot: Record<string, unknown>,
  turn: number,
  violations: SimulationInvariantViolation[]
): void {
  const reportViolation: ViolationReporter = (code, violationTurn, path, message, reference) =>
    report(violations, code, violationTurn, path, message, reference);
  const mapBounds = readMapBounds(snapshot, turn, reportViolation);
  const players = readPlayers(snapshot, turn, reportViolation);
  const playerById = new Map(players.map(player => [player.id, player]));
  const cities = readCities(snapshot, turn, mapBounds, playerById, reportViolation);
  const cityById = new Map(cities.map(city => [city.id, city]));
  const units = readUnits(snapshot, turn, mapBounds, playerById, cityById, reportViolation);
  const unitById = new Map(units.map(unit => [unit.id, unit]));

  checkDeadPlayerOwnership(players, cities, units, reportViolation, turn);
  checkTradeRoutes(cities, cityById, turn, reportViolation);
  checkTransportLinks(units, unitById, turn, reportViolation);
  checkDiplomacy(players, turn, reportViolation);
  checkResearch(snapshot, playerById, turn, reportViolation);
}

function readMapBounds(
  snapshot: Record<string, unknown>,
  turn: number,
  reportViolation: ViolationReporter
): MapBounds | undefined {
  const map = asRecord(snapshot.map);
  const width = readPositiveInteger(map.width);
  const height = readPositiveInteger(map.height);
  const tiles = map.tiles;
  if (width === undefined || height === undefined || !Array.isArray(tiles)) {
    reportViolation(
      'MAP_STATE',
      turn,
      'map',
      'map must contain positive integer width and height plus a tiles array',
      REFERENCES.map
    );
    return undefined;
  }

  if (tiles.length !== width) {
    reportViolation(
      'MAP_STATE',
      turn,
      'map.tiles',
      `map has ${tiles.length} tile columns, expected ${width}`,
      REFERENCES.map
    );
  }
  for (let x = 0; x < Math.min(width, tiles.length); x++) {
    if (!Array.isArray(tiles[x]) || tiles[x].length !== height) {
      reportViolation(
        'MAP_STATE',
        turn,
        `map.tiles[${x}]`,
        `map tile column must contain exactly ${height} rows`,
        REFERENCES.map
      );
    }
  }

  return { width, height };
}

function readPlayers(
  snapshot: Record<string, unknown>,
  turn: number,
  reportViolation: ViolationReporter
): ReplayPlayer[] {
  const diplomacy = asRecord(snapshot.diplomacy);
  if (!Array.isArray(diplomacy.players)) {
    reportViolation(
      'SNAPSHOT_STRUCTURE',
      turn,
      'diplomacy.players',
      'diplomacy.players must be an array',
      REFERENCES.diplomacy
    );
    return [];
  }

  const players: ReplayPlayer[] = [];
  const ids = new Set<string>();
  const numbers = new Set<number>();
  diplomacy.players.forEach((value, index) => {
    const record = asRecord(value);
    const id = readString(record.playerId);
    const playerNumber = readPositiveInteger(record.playerNumber);
    const path = `diplomacy.players[${index}]`;
    if (!id || playerNumber === undefined) {
      reportViolation(
        'PLAYER_STATE',
        turn,
        path,
        'player must contain a string playerId and positive integer playerNumber',
        REFERENCES.general
      );
      return;
    }
    if (ids.has(id)) {
      reportViolation(
        'PLAYER_STATE',
        turn,
        `${path}.playerId`,
        `duplicate player id ${id}`,
        REFERENCES.general
      );
    }
    if (numbers.has(playerNumber)) {
      reportViolation(
        'PLAYER_STATE',
        turn,
        `${path}.playerNumber`,
        `duplicate player number ${playerNumber}`,
        REFERENCES.general
      );
    }
    ids.add(id);
    numbers.add(playerNumber);
    if (record.isAlive !== undefined && typeof record.isAlive !== 'boolean') {
      reportViolation(
        'PLAYER_STATE',
        turn,
        `${path}.isAlive`,
        'isAlive must be boolean when present',
        REFERENCES.general
      );
    }
    const relations = new Map<string, Record<string, unknown>>();
    if (!Array.isArray(record.relations)) {
      reportViolation(
        'DIPLOMACY_STATE',
        turn,
        `${path}.relations`,
        'relations must be an array',
        REFERENCES.diplomacy
      );
    } else {
      record.relations.forEach((relationValue, relationIndex) => {
        const relation = asRecord(relationValue);
        const targetId = readString(relation.playerId);
        const relationPath = `${path}.relations[${relationIndex}]`;
        if (!targetId) {
          reportViolation(
            'DIPLOMACY_STATE',
            turn,
            relationPath,
            'relation must contain a string playerId',
            REFERENCES.diplomacy
          );
          return;
        }
        if (targetId === id) {
          reportViolation(
            'DIPLOMACY_STATE',
            turn,
            `${relationPath}.playerId`,
            'player cannot have a diplomatic relation with itself',
            REFERENCES.diplomacy
          );
        }
        if (relations.has(targetId)) {
          reportViolation(
            'DIPLOMACY_STATE',
            turn,
            `${relationPath}.playerId`,
            `duplicate relation for player ${targetId}`,
            REFERENCES.diplomacy
          );
        }
        relations.set(targetId, relation);
        checkDiplomaticRelation(relation, relationPath, turn, reportViolation);
      });
    }
    players.push({
      id,
      playerNumber,
      isAlive: typeof record.isAlive === 'boolean' ? record.isAlive : undefined,
      teamId: readString(record.teamId),
      relations,
    });
  });

  return players;
}

function checkDiplomaticRelation(
  relation: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const state = readString(relation.state);
  const maxState = readString(relation.maxState);
  checkDiplomaticStateValues(state, maxState, path, turn, reportViolation);
  checkDiplomaticTurnsLeft(relation, path, turn, reportViolation);
  checkDiplomaticProposal(relation, path, turn, reportViolation);
}

function checkDiplomaticStateValues(
  state: string | undefined,
  maxState: string | undefined,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  if (state !== undefined && !DIPLOMACY_STATES.has(state)) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      `${path}.state`,
      `unknown diplomatic state ${state}`,
      REFERENCES.diplomacy
    );
  }
  if (maxState !== undefined && !DIPLOMACY_STATES.has(maxState)) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      `${path}.maxState`,
      `unknown diplomatic maxState ${maxState}`,
      REFERENCES.diplomacyMaxState
    );
  }
  if (
    state !== undefined &&
    maxState !== undefined &&
    DIPLOMATIC_STATE_ORDER[maxState] < DIPLOMATIC_STATE_ORDER[state]
  ) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      `${path}.maxState`,
      `maxState ${maxState} is below current state ${state}`,
      REFERENCES.diplomacyMaxState
    );
  }
}

function checkDiplomaticTurnsLeft(
  relation: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const turnsLeft = relation.turnsLeft;
  if (turnsLeft !== undefined && (!isFiniteNumber(turnsLeft) || Number(turnsLeft) < 0)) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      `${path}.turnsLeft`,
      'turnsLeft must be a non-negative number when present',
      REFERENCES.diplomacy
    );
  }
}

function checkDiplomaticProposal(
  relation: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const proposal = asRecord(relation.proposal);
  const proposalStatus = readString(proposal.status);
  if (proposalStatus !== undefined && !PROPOSAL_STATUSES.has(proposalStatus)) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      `${path}.proposal.status`,
      `unknown proposal status ${proposalStatus}`,
      REFERENCES.diplomacy
    );
  }
}

function readCities(
  snapshot: Record<string, unknown>,
  turn: number,
  mapBounds: MapBounds | undefined,
  playerById: Map<string, ReplayPlayer>,
  reportViolation: ViolationReporter
): ReplayCity[] {
  if (!Array.isArray(snapshot.cities)) {
    reportViolation(
      'SNAPSHOT_STRUCTURE',
      turn,
      'cities',
      'cities must be an array',
      REFERENCES.cities
    );
    return [];
  }

  const cities: ReplayCity[] = [];
  const ids = new Set<string>();
  const positions = new Set<string>();
  snapshot.cities.forEach((value, index) => {
    const city = asRecord(value);
    const path = `cities[${index}]`;
    const id = readString(city.id);
    const playerId = readString(city.playerId);
    const x = readInteger(city.x);
    const y = readInteger(city.y);
    if (!id || !playerId || x === undefined || y === undefined) {
      reportViolation(
        'CITY_STATE',
        turn,
        path,
        'city must contain id, playerId, and integer x/y coordinates',
        REFERENCES.cities
      );
      return;
    }
    if (ids.has(id)) {
      reportViolation(
        'CITY_STATE',
        turn,
        `${path}.id`,
        `duplicate city id ${id}`,
        REFERENCES.cities
      );
    }
    const position = `${x},${y}`;
    if (positions.has(position)) {
      reportViolation(
        'CITY_STATE',
        turn,
        path,
        `multiple cities occupy tile ${position}`,
        REFERENCES.map
      );
    }
    ids.add(id);
    positions.add(position);
    checkCoordinate(mapBounds, x, y, path, turn, 'CITY_STATE', reportViolation);
    if (!playerById.has(playerId)) {
      reportViolation(
        'CITY_REFERENCE',
        turn,
        `${path}.playerId`,
        `city owner ${playerId} is missing from diplomacy.players`,
        REFERENCES.cities
      );
    }
    checkPositiveInteger(
      city.population,
      `${path}.population`,
      turn,
      'CITY_STATE',
      reportViolation,
      REFERENCES.citySize
    );
    checkPositiveInteger(
      city.size,
      `${path}.size`,
      turn,
      'CITY_STATE',
      reportViolation,
      REFERENCES.citySize
    );
    cities.push({ record: city, id, playerId, x, y });
  });
  return cities;
}

function readUnits(
  snapshot: Record<string, unknown>,
  turn: number,
  mapBounds: MapBounds | undefined,
  playerById: Map<string, ReplayPlayer>,
  cityById: Map<string, ReplayCity>,
  reportViolation: ViolationReporter
): ReplayUnit[] {
  if (!Array.isArray(snapshot.units)) {
    reportViolation(
      'SNAPSHOT_STRUCTURE',
      turn,
      'units',
      'units must be an array',
      REFERENCES.units
    );
    return [];
  }

  const units: ReplayUnit[] = [];
  const ids = new Set<string>();
  snapshot.units.forEach((value, index) => {
    const unit = asRecord(value);
    const path = `units[${index}]`;
    const id = readString(unit.id);
    const playerId = readString(unit.playerId);
    const x = readInteger(unit.x);
    const y = readInteger(unit.y);
    if (!id || !playerId || x === undefined || y === undefined) {
      reportViolation(
        'UNIT_STATE',
        turn,
        path,
        'unit must contain id, playerId, and integer x/y coordinates',
        REFERENCES.units
      );
      return;
    }
    if (ids.has(id)) {
      reportViolation(
        'UNIT_STATE',
        turn,
        `${path}.id`,
        `duplicate unit id ${id}`,
        REFERENCES.unitIdentity
      );
    }
    ids.add(id);
    checkCoordinate(mapBounds, x, y, path, turn, 'UNIT_STATE', reportViolation);
    if (!playerById.has(playerId)) {
      reportViolation(
        'UNIT_REFERENCE',
        turn,
        `${path}.playerId`,
        `unit owner ${playerId} is missing from diplomacy.players`,
        REFERENCES.unitIdentity
      );
    }
    checkPositiveNumber(
      unit.health,
      `${path}.health`,
      turn,
      'UNIT_STATE',
      reportViolation,
      REFERENCES.units
    );
    checkNonNegativeNumber(
      unit.movementLeft,
      `${path}.movementLeft`,
      turn,
      'UNIT_STATE',
      reportViolation,
      REFERENCES.units
    );
    const homeCityId = readString(unit.homeCityId);
    if (homeCityId) {
      const homeCity = cityById.get(homeCityId);
      if (!homeCity) {
        reportViolation(
          'UNIT_REFERENCE',
          turn,
          `${path}.homeCityId`,
          `home city ${homeCityId} does not exist`,
          REFERENCES.units
        );
      } else if (homeCity.playerId !== playerId) {
        reportViolation(
          'UNIT_REFERENCE',
          turn,
          `${path}.homeCityId`,
          `home city ${homeCityId} belongs to ${homeCity.playerId}, not ${playerId}`,
          REFERENCES.units
        );
      }
    }
    units.push({ record: unit, id, playerId });
  });
  return units;
}

function checkDeadPlayerOwnership(
  players: ReplayPlayer[],
  cities: ReplayCity[],
  units: ReplayUnit[],
  reportViolation: ViolationReporter,
  turn: number
): void {
  for (const player of players) {
    if (player.isAlive !== false) continue;
    const cityCount = cities.filter(city => city.playerId === player.id).length;
    const unitCount = units.filter(unit => unit.playerId === player.id).length;
    if (cityCount > 0 || unitCount > 0) {
      reportViolation(
        'PLAYER_STATE',
        turn,
        `diplomacy.players.${player.id}`,
        `dead player still owns ${cityCount} city/cities and ${unitCount} unit(s)`,
        REFERENCES.general
      );
    }
  }
}

function checkTradeRoutes(
  cities: ReplayCity[],
  cityById: Map<string, ReplayCity>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const checkedPairs = new Set<string>();
  for (const city of cities) {
    const routes = city.record.tradeRoutes;
    if (routes === undefined) continue;
    if (!Array.isArray(routes)) {
      reportViolation(
        'CITY_TRADE_ROUTE',
        turn,
        `cities.${city.id}.tradeRoutes`,
        'tradeRoutes must be an array when present',
        REFERENCES.cities
      );
      continue;
    }
    routes.forEach((value, index) => {
      const route = asRecord(value);
      const path = `cities.${city.id}.tradeRoutes[${index}]`;
      const sourceCity = readString(route.sourceCity);
      const partnerCityId = readString(route.partnerCity);
      if (sourceCity !== city.id) {
        reportViolation(
          'CITY_TRADE_ROUTE',
          turn,
          `${path}.sourceCity`,
          `trade route source is ${sourceCity ?? 'missing'}, expected ${city.id}`,
          REFERENCES.cities
        );
      }
      const partner = partnerCityId ? cityById.get(partnerCityId) : undefined;
      if (!partner) {
        reportViolation(
          'CITY_TRADE_ROUTE',
          turn,
          `${path}.partnerCity`,
          `trade route partner ${partnerCityId ?? 'missing'} does not exist`,
          REFERENCES.cities
        );
        return;
      }
      checkNonNegativeNumber(
        route.value,
        `${path}.value`,
        turn,
        'CITY_TRADE_ROUTE',
        reportViolation,
        REFERENCES.cities
      );
      checkNonNegativeInteger(
        route.establishedTurn,
        `${path}.establishedTurn`,
        turn,
        'CITY_TRADE_ROUTE',
        reportViolation,
        REFERENCES.cities
      );
      const pairKey = [city.id, partner.id].sort().join('|');
      if (checkedPairs.has(pairKey)) return;
      checkedPairs.add(pairKey);
      const reciprocal = asArray(partner.record.tradeRoutes).find(candidate => {
        const candidateRoute = asRecord(candidate);
        return (
          readString(candidateRoute.sourceCity) === partner.id &&
          readString(candidateRoute.partnerCity) === city.id
        );
      });
      if (!reciprocal) {
        reportViolation(
          'CITY_TRADE_ROUTE',
          turn,
          path,
          `trade route to ${partner.id} has no reciprocal route`,
          REFERENCES.cities
        );
        return;
      }
      const reciprocalRoute = asRecord(reciprocal);
      if (routeGoods(route) !== routeGoods(reciprocalRoute)) {
        reportViolation(
          'CITY_TRADE_ROUTE',
          turn,
          path,
          `trade route goods do not match reciprocal route (${routeGoods(route)} vs ${routeGoods(reciprocalRoute)})`,
          REFERENCES.cities
        );
      }
    });
  }
}

function checkTransportLinks(
  units: ReplayUnit[],
  unitById: Map<string, ReplayUnit>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  for (const unit of units) {
    checkTransportParent(unit, unitById, turn, reportViolation);
    checkTransportCargo(unit, unitById, turn, reportViolation);
  }
  checkTransportCycles(units, unitById, turn, reportViolation);
}

function checkTransportParent(
  unit: ReplayUnit,
  unitById: Map<string, ReplayUnit>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const transportedBy = readString(unit.record.transportedBy);
  if (!transportedBy) return;
  const path = `units.${unit.id}`;
  const transporter = unitById.get(transportedBy);
  if (!transporter || transportedBy === unit.id) {
    reportViolation(
      'UNIT_TRANSPORT',
      turn,
      `${path}.transportedBy`,
      `transporter ${transportedBy} does not exist or references itself`,
      REFERENCES.units
    );
    return;
  }
  if (!asArray(transporter.record.cargoUnits).some(value => value === unit.id)) {
    reportViolation(
      'UNIT_TRANSPORT',
      turn,
      `${path}.transportedBy`,
      `transporter ${transportedBy} does not list ${unit.id} as cargo`,
      REFERENCES.units
    );
  }
  if (unit.record.x !== transporter.record.x || unit.record.y !== transporter.record.y) {
    reportViolation(
      'UNIT_TRANSPORT',
      turn,
      path,
      `cargo and transporter ${transportedBy} are on different coordinates`,
      REFERENCES.units
    );
  }
}

function checkTransportCargo(
  unit: ReplayUnit,
  unitById: Map<string, ReplayUnit>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  if (!Array.isArray(unit.record.cargoUnits)) return;
  const seenCargo = new Set<string>();
  unit.record.cargoUnits.forEach((value, index) => {
    const cargoId = readString(value);
    const cargoPath = `units.${unit.id}.cargoUnits[${index}]`;
    if (!cargoId || seenCargo.has(cargoId)) {
      reportViolation(
        'UNIT_TRANSPORT',
        turn,
        cargoPath,
        'cargo list must contain unique string unit ids',
        REFERENCES.units
      );
      return;
    }
    seenCargo.add(cargoId);
    const cargo = unitById.get(cargoId);
    if (!cargo) {
      reportViolation(
        'UNIT_TRANSPORT',
        turn,
        cargoPath,
        `cargo unit ${cargoId} does not exist`,
        REFERENCES.units
      );
    } else if (readString(cargo.record.transportedBy) !== unit.id) {
      reportViolation(
        'UNIT_TRANSPORT',
        turn,
        cargoPath,
        `cargo unit ${cargoId} does not point back to transporter ${unit.id}`,
        REFERENCES.units
      );
    }
  });
}

function checkTransportCycles(
  units: ReplayUnit[],
  unitById: Map<string, ReplayUnit>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const reportedCycles = new Set<string>();
  for (const unit of units) {
    const visited = new Set<string>();
    let current: ReplayUnit | undefined = unit;
    while (current) {
      if (visited.has(current.id)) {
        if (!reportedCycles.has(current.id)) {
          reportedCycles.add(current.id);
          reportViolation(
            'UNIT_TRANSPORT',
            turn,
            `units.${unit.id}.transportedBy`,
            'transport chain contains a cycle',
            REFERENCES.units
          );
        }
        break;
      }
      visited.add(current.id);
      const parentId = readString(current.record.transportedBy);
      current = parentId ? unitById.get(parentId) : undefined;
    }
  }
}

function checkDiplomacy(
  players: ReplayPlayer[],
  turn: number,
  reportViolation: ViolationReporter
): void {
  const playersById = new Map(players.map(player => [player.id, player]));
  const checkedPairs = new Set<string>();
  for (const player of players) {
    for (const [targetId, relation] of player.relations) {
      if (!playersById.has(targetId)) {
        reportViolation(
          'DIPLOMACY_STATE',
          turn,
          `diplomacy.players.${player.id}.relations.${targetId}`,
          `relation target ${targetId} is missing from diplomacy.players`,
          REFERENCES.diplomacy
        );
        continue;
      }
      const pairKey = [player.id, targetId].sort().join('|');
      if (checkedPairs.has(pairKey)) continue;
      checkedPairs.add(pairKey);
      checkDiplomaticPair(player, targetId, relation, playersById, turn, reportViolation);
    }
  }
}

function checkDiplomaticPair(
  player: ReplayPlayer,
  targetId: string,
  relation: Record<string, unknown>,
  playersById: Map<string, ReplayPlayer>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const path = `diplomacy.players.${player.id}.relations.${targetId}`;
  const reverse = playersById.get(targetId)?.relations.get(player.id);
  if (!reverse) {
    reportViolation(
      'DIPLOMACY_SYMMETRY',
      turn,
      path,
      `relation has no reverse entry from ${targetId}`,
      REFERENCES.diplomacy
    );
    return;
  }
  checkBilateralState(relation, reverse, path, turn, reportViolation);
  checkBilateralTreatyDuration(relation, reverse, path, turn, reportViolation);
  if (
    readString(relation.state) === 'team' &&
    player.teamId !== playersById.get(targetId)?.teamId
  ) {
    reportViolation(
      'DIPLOMACY_STATE',
      turn,
      path,
      'team relation requires matching team ids',
      REFERENCES.diplomacy
    );
  }
}

function checkBilateralState(
  relation: Record<string, unknown>,
  reverse: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  if (relation.state === reverse.state && relation.maxState === reverse.maxState) return;
  reportViolation(
    'DIPLOMACY_SYMMETRY',
    turn,
    path,
    `bilateral state mismatch (${readString(relation.state) ?? 'missing'}/${readString(relation.maxState) ?? 'missing'} vs ${readString(reverse.state) ?? 'missing'}/${readString(reverse.maxState) ?? 'missing'})`,
    REFERENCES.diplomacy
  );
}

function checkBilateralTreatyDuration(
  relation: Record<string, unknown>,
  reverse: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  const state = readString(relation.state);
  if (state !== 'ceasefire' && state !== 'armistice') return;
  const turnsLeft = relation.turnsLeft;
  const reverseTurnsLeft = reverse.turnsLeft;
  if (
    !isFiniteNumber(turnsLeft) ||
    !isFiniteNumber(reverseTurnsLeft) ||
    turnsLeft === reverseTurnsLeft
  ) {
    return;
  }
  reportViolation(
    'DIPLOMACY_SYMMETRY',
    turn,
    `${path}.turnsLeft`,
    `treaty duration mismatch (${turnsLeft} vs ${reverseTurnsLeft})`,
    REFERENCES.diplomacy
  );
}

function checkResearch(
  snapshot: Record<string, unknown>,
  playerById: Map<string, ReplayPlayer>,
  turn: number,
  reportViolation: ViolationReporter
): void {
  if (
    !snapshot.research ||
    typeof snapshot.research !== 'object' ||
    Array.isArray(snapshot.research)
  ) {
    reportViolation(
      'SNAPSHOT_STRUCTURE',
      turn,
      'research',
      'research must be an object keyed by player id',
      REFERENCES.research
    );
    return;
  }
  for (const [playerId, value] of Object.entries(snapshot.research as Record<string, unknown>)) {
    const path = `research.${playerId}`;
    if (!playerById.has(playerId)) {
      reportViolation(
        'RESEARCH_STATE',
        turn,
        path,
        `research entry belongs to unknown player ${playerId}`,
        REFERENCES.research
      );
    }
    if (value === null) continue;
    checkResearchEntry(playerId, asRecord(value), path, turn, reportViolation);
  }
}

function checkResearchEntry(
  playerId: string,
  research: Record<string, unknown>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  if (research.playerId !== undefined && research.playerId !== playerId) {
    reportViolation(
      'RESEARCH_STATE',
      turn,
      `${path}.playerId`,
      `research playerId ${String(research.playerId)} does not match key ${playerId}`,
      REFERENCES.research
    );
  }
  checkNonNegativeNumber(
    research.bulbsAccumulated,
    `${path}.bulbsAccumulated`,
    turn,
    'RESEARCH_STATE',
    reportViolation,
    REFERENCES.research
  );
  checkNonNegativeNumber(
    research.bulbsLastTurn,
    `${path}.bulbsLastTurn`,
    turn,
    'RESEARCH_STATE',
    reportViolation,
    REFERENCES.research
  );
  checkNonNegativeInteger(
    research.futureTechs,
    `${path}.futureTechs`,
    turn,
    'RESEARCH_STATE',
    reportViolation,
    REFERENCES.research
  );
  const researchedTechs = research.researchedTechs;
  if (!Array.isArray(researchedTechs)) {
    reportViolation(
      'RESEARCH_STATE',
      turn,
      `${path}.researchedTechs`,
      'researchedTechs must be an array',
      REFERENCES.research
    );
    return;
  }
  const seenTechs = checkResearchedTechnologies(researchedTechs, path, turn, reportViolation);
  checkResearchTargets(research, seenTechs, path, turn, reportViolation);
}

function checkResearchedTechnologies(
  technologies: unknown[],
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): Set<string> {
  const seenTechs = new Set<string>();
  technologies.forEach((technology, index) => {
    if (typeof technology !== 'string' || !technology.trim() || seenTechs.has(technology)) {
      reportViolation(
        'RESEARCH_STATE',
        turn,
        `${path}.researchedTechs[${index}]`,
        'researched technologies must be unique non-empty strings',
        REFERENCES.research
      );
    }
    if (typeof technology === 'string') seenTechs.add(technology);
  });
  return seenTechs;
}

function checkResearchTargets(
  research: Record<string, unknown>,
  researchedTechs: Set<string>,
  path: string,
  turn: number,
  reportViolation: ViolationReporter
): void {
  for (const field of ['currentTech', 'techGoal']) {
    const technology = research[field];
    if (technology !== undefined && (typeof technology !== 'string' || !technology.trim())) {
      reportViolation(
        'RESEARCH_STATE',
        turn,
        `${path}.${field}`,
        `${field} must be a non-empty string when present`,
        REFERENCES.research
      );
    }
    if (typeof technology === 'string' && researchedTechs.has(technology)) {
      reportViolation(
        'RESEARCH_STATE',
        turn,
        `${path}.${field}`,
        `${field} ${technology} is already researched`,
        REFERENCES.research
      );
    }
  }
}

function checkCoordinate(
  mapBounds: MapBounds | undefined,
  x: number,
  y: number,
  path: string,
  turn: number,
  code: SimulationInvariantCode,
  reportViolation: ViolationReporter
): void {
  if (!mapBounds) return;
  if (x < 0 || x >= mapBounds.width || y < 0 || y >= mapBounds.height) {
    reportViolation(
      code,
      turn,
      path,
      `coordinate (${x},${y}) is outside map bounds ${mapBounds.width}x${mapBounds.height}`,
      REFERENCES.map
    );
  }
}

function checkPositiveInteger(
  value: unknown,
  path: string,
  turn: number,
  code: SimulationInvariantCode,
  reportViolation: ViolationReporter,
  reference: string
): void {
  if (readPositiveInteger(value) === undefined) {
    reportViolation(code, turn, path, 'value must be a positive integer', reference);
  }
}

function checkNonNegativeInteger(
  value: unknown,
  path: string,
  turn: number,
  code: SimulationInvariantCode,
  reportViolation: ViolationReporter,
  reference: string
): void {
  if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) {
    reportViolation(code, turn, path, 'value must be a non-negative integer', reference);
  }
}

function checkPositiveNumber(
  value: unknown,
  path: string,
  turn: number,
  code: SimulationInvariantCode,
  reportViolation: ViolationReporter,
  reference: string
): void {
  if (value !== undefined && (!isFiniteNumber(value) || Number(value) <= 0)) {
    reportViolation(code, turn, path, 'value must be a positive number', reference);
  }
}

function checkNonNegativeNumber(
  value: unknown,
  path: string,
  turn: number,
  code: SimulationInvariantCode,
  reportViolation: ViolationReporter,
  reference: string
): void {
  if (value !== undefined && (!isFiniteNumber(value) || Number(value) < 0)) {
    reportViolation(code, turn, path, 'value must be a non-negative number', reference);
  }
}

function report(
  violations: SimulationInvariantViolation[],
  code: SimulationInvariantCode,
  turn: number,
  path: string,
  message: string,
  reference: string
): void {
  violations.push({ code, turn, path, message, reference });
}

function routeGoods(route: Record<string, unknown>): string {
  return readString(route.goods) ?? '';
}
