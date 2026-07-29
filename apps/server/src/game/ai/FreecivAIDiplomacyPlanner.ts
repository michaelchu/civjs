import { amortize } from '@game/ai/FreecivAIPlanner';
import type { FreecivAIState } from '@game/ai/FreecivAIStateStore';
import type { CityState } from '@game/managers/CityManager';
import type {
  DiplomaticRelation,
  DiplomaticState,
  TreatyClause,
} from '@game/managers/DiplomacyManager';
import type { Technology } from '@game/managers/ResearchManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

const NEVER_ACCEPT = 1_000_000;

export interface WarDesireContext {
  ownCities: CityState[];
  targetCities: CityState[];
  ownUnits: Unit[];
  targetUnits: Unit[];
  unitTypes: Readonly<Record<string, UnitType>>;
  ownTechCount: number;
  targetTechCount: number;
  targetGold: number;
  distance: number;
  love: number;
  relation: DiplomaticRelation;
  aggressiveTrait: number;
  diplomacyHandicap: boolean;
  targetIsHuman: boolean;
  pursuingSpaceVictory?: boolean;
  targetSpaceshipProgress?: number;
  targetSpaceshipLaunched?: boolean;
}

function attackPower(unit: Unit, unitTypes: Readonly<Record<string, UnitType>>): number {
  const type = unitTypes[unit.unitTypeId];
  if (!type) return 0;
  return Math.max(0, type.attack ?? type.combat ?? 0) * Math.max(1, type.firepower ?? 1);
}

/**
 * Profit-minus-fear war target value from the default AI. The value remains
 * comparable with persistent love and incident memory.
 *
 * @reference reference/freeciv/ai/default/daidiplomacy.c:dai_war_desire
 */
export function calculateWarDesire(context: WarDesireContext): number {
  let want = context.targetCities.reduce(
    (sum, city) =>
      sum +
      100 +
      (city.size ?? city.population ?? 0) * 20 +
      Math.max(0, city.productionPerTurn ?? 0) * 8 +
      Math.max(0, city.tradePerTurn ?? 0) * 6 +
      city.buildings.length * 20,
    0
  );
  let fear = context.targetUnits.reduce(
    (sum, unit) => sum + attackPower(unit, context.unitTypes),
    0
  );
  fear -= context.ownUnits.reduce((sum, unit) => sum + attackPower(unit, context.unitTypes), 0) / 2;
  const ownSettlers = context.ownUnits.filter(
    unit => context.unitTypes[unit.unitTypeId]?.canFoundCity
  ).length;
  want -= ownSettlers * 200;
  want -= Math.abs(want) / Math.max(1, context.ownCities.length - ownSettlers);
  fear +=
    Math.floor(Math.max(0, context.targetGold) / 5000) * Math.max(1, context.targetCities.length);
  fear += Math.max(0, context.targetTechCount - context.ownTechCount) * 100;
  want -= Math.max(0, (want * context.love) / 2000);
  want += (context.aggressiveTrait - 50) * 4;
  if (!context.pursuingSpaceVictory) {
    want += Math.round((context.targetSpaceshipProgress ?? 0) * 250);
    if (context.targetSpaceshipLaunched) want += 2000;
  }
  want = amortize(want, context.distance);
  if (context.relation.state === 'alliance') want /= 4;
  else if (context.relation.state === 'peace' && context.relation.hasReasonToCancel <= 0)
    want *= 0.8;
  else if (context.relation.state === 'ceasefire' && context.relation.hasReasonToCancel <= 0)
    want *= 0.85;
  if (context.diplomacyHandicap && context.targetIsHuman) want /= 2;
  return Math.round(want - fear);
}

export interface TreatyValuationContext {
  playerId: string;
  otherPlayerId: string;
  currentState: DiplomaticState;
  relation: DiplomaticRelation;
  love: number;
  turn: number;
  ownCities: CityState[];
  otherCities: CityState[];
  ownTechs: ReadonlySet<string>;
  otherTechs: ReadonlySet<string>;
  catalogue: ReadonlyMap<string, Technology>;
  techWants: FreecivAIState['techWants'];
  diplomacyHandicap: boolean;
  sharedVisionSafe: boolean;
  alliedWithEnemy: boolean;
}

export interface TreatyValuation {
  balance: number;
  acceptable: boolean;
  clauseValues: number[];
}

function cityGoldWorth(city: CityState): number {
  return (
    100 +
    (city.size ?? city.population ?? 0) * 40 +
    Math.max(0, city.productionPerTurn ?? 0) * 12 +
    Math.max(0, city.tradePerTurn ?? 0) * 10 +
    city.buildings.length * 30
  );
}

function technologyWorth(context: TreatyValuationContext, techId: string): number {
  if (context.ownTechs.has(techId)) return 0;
  const tech = context.catalogue.get(techId);
  if (!tech) return 0;
  const directlyResearchable = tech.requirements.every(requirement =>
    context.ownTechs.has(requirement)
  );
  const worth =
    tech.cost * 3 + Math.max(0, context.techWants[techId] ?? 0) / Math.max(1, context.turn);
  return Math.round(directlyResearchable ? worth / 2 : worth);
}

function resultingState(currentState: DiplomaticState, clauses: TreatyClause[]): DiplomaticState {
  const pact = clauses.find(clause => ['ceasefire', 'peace', 'alliance'].includes(clause.type));
  return (pact?.type as DiplomaticState | undefined) ?? currentState;
}

type MaterialClause = Extract<TreatyClause, { type: 'technology' | 'gold' | 'city' }>;
type InformationClause = {
  type: 'map' | 'seamap' | 'shared_vision' | 'embassy';
  giverId?: string;
};
type PactClause = {
  type: 'ceasefire' | 'peace' | 'alliance';
  giverId?: string;
};

function valueMaterialClause(context: TreatyValuationContext, clause: MaterialClause): number {
  const giving = clause.giverId === context.playerId;
  switch (clause.type) {
    case 'technology': {
      if (giving) {
        if (!context.ownTechs.has(clause.techId) || context.otherTechs.has(clause.techId)) return 0;
        const tech = context.catalogue.get(clause.techId);
        return (
          -(tech?.cost ?? 0) * 3 -
          Math.round((context.techWants[clause.techId] ?? 0) / Math.max(1, context.turn))
        );
      }
      return technologyWorth(context, clause.techId);
    }
    case 'gold':
      return giving ? -clause.amount : clause.amount;
    case 'city': {
      const city = (giving ? context.ownCities : context.otherCities).find(
        candidate => candidate.id === clause.cityId
      );
      if (!city) return 0;
      const worth = cityGoldWorth(city);
      if (!giving) return worth;
      if (city.buildings.includes('palace') || context.ownCities.length <= 3) return -NEVER_ACCEPT;
      return -worth * 15;
    }
  }
}

function valueInformationClause(
  context: TreatyValuationContext,
  clause: InformationClause,
  afterState: DiplomaticState
): number {
  const giving = clause.giverId === context.playerId;
  switch (clause.type) {
    case 'map':
      if (!giving || afterState === 'alliance') return 0;
      return (
        Math.min(context.love * 10, -40 * Math.max(1, context.ownCities.length)) *
        (context.diplomacyHandicap ? 1 / 6 : 1)
      );
    case 'seamap':
      if (!giving || afterState === 'alliance') return 0;
      return (
        Math.min(context.love * 7, -15 * context.otherCities.length) *
        (context.diplomacyHandicap ? 1 / 2 : 1)
      );
    case 'shared_vision':
      return giving && (afterState !== 'alliance' || !context.sharedVisionSafe) ? -NEVER_ACCEPT : 0;
    case 'embassy':
      if (!giving || afterState === 'alliance') return 0;
      return afterState === 'peace'
        ? -5 * context.turn
        : Math.min(-50 * context.turn + context.love, -5 * context.turn);
  }
}

function valuePactClause(context: TreatyValuationContext, clause: PactClause): number {
  switch (clause.type) {
    case 'ceasefire':
      return context.currentState === 'war' ? context.love : -NEVER_ACCEPT;
    case 'peace':
      return !context.alliedWithEnemy && ['war', 'ceasefire'].includes(context.currentState)
        ? context.love - 10
        : -NEVER_ACCEPT;
    case 'alliance':
      return !context.alliedWithEnemy && context.currentState === 'peace' && context.love >= 100
        ? context.love - 80
        : -NEVER_ACCEPT;
  }
}

function valueClause(
  context: TreatyValuationContext,
  clause: TreatyClause,
  afterState: DiplomaticState
): number {
  switch (clause.type) {
    case 'technology':
    case 'gold':
    case 'city':
      return valueMaterialClause(context, clause);
    case 'map':
    case 'seamap':
    case 'shared_vision':
    case 'embassy':
      return valueInformationClause(context, clause as InformationClause, afterState);
    case 'ceasefire':
    case 'peace':
    case 'alliance':
      return valuePactClause(context, clause as PactClause);
  }
}

/**
 * Evaluate an entire treaty in one gold-equivalent balance.
 *
 * @reference reference/freeciv/ai/default/daidiplomacy.c:dai_goldequiv_clause
 * @reference reference/freeciv/ai/default/daidiplomacy.c:dai_treaty_evaluate
 */
export function evaluateTreaty(
  clauses: TreatyClause[],
  context: TreatyValuationContext
): TreatyValuation {
  const afterState = resultingState(context.currentState, clauses);
  const clauseValues = clauses.map(clause => valueClause(context, clause, afterState));
  const balance = Math.round(clauseValues.reduce((sum, value) => sum + value, 0));
  const hasPeace = afterState !== 'war';
  const outgoingMaterial = clauses.some(
    clause =>
      clause.giverId === context.playerId &&
      ['technology', 'gold', 'city', 'map', 'seamap', 'shared_vision'].includes(clause.type)
  );
  return {
    balance,
    acceptable:
      balance >= 0 &&
      !clauseValues.some(value => value <= -NEVER_ACCEPT) &&
      (context.currentState !== 'war' || hasPeace || !outgoingMaterial),
    clauseValues,
  };
}
