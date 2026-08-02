/**
 * @module server/game/simulation/expectations/ExpectationSchema
 * Defines Expectation Schema headless simulation behavior.
 */
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

const cityExpectationSchema = z
  .object({
    playerNumber: z.number().int().min(1),
    name: z.string().trim().min(1).optional(),
    minPopulation: z.number().int().min(1).optional(),
    maxPopulation: z.number().int().min(1).optional(),
    minTradePerTurn: z.number().min(0).optional(),
    maxTradePerTurn: z.number().min(0).optional(),
    minLuxuryPerTurn: z.number().min(0).optional(),
    maxLuxuryPerTurn: z.number().min(0).optional(),
    minTradeRoutes: z.number().int().min(0).optional(),
    maxTradeRoutes: z.number().int().min(0).optional(),
  })
  .superRefine((value, context) => {
    addRangeIssue(context, value.minPopulation, value.maxPopulation, 'population');
    addRangeIssue(context, value.minTradePerTurn, value.maxTradePerTurn, 'tradePerTurn');
    addRangeIssue(context, value.minLuxuryPerTurn, value.maxLuxuryPerTurn, 'luxuryPerTurn');
    addRangeIssue(context, value.minTradeRoutes, value.maxTradeRoutes, 'tradeRoutes');
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

const eventExpectationSchema = z
  .object({
    type: z.string().trim().min(1),
    turn: z.number().int().min(0).optional(),
    minTurn: z.number().int().min(0).optional(),
    maxTurn: z.number().int().min(0).optional(),
    playerNumber: z.number().int().min(1).optional(),
    otherPlayerNumber: z.number().int().min(1).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    minCount: z.number().int().min(0).default(1),
    maxCount: z.number().int().min(0).optional(),
  })
  .superRefine((value, context) => {
    if (value.playerNumber !== undefined && value.playerNumber === value.otherPlayerNumber) {
      context.addIssue({
        code: 'custom',
        path: ['otherPlayerNumber'],
        message: 'must reference a different player',
      });
    }
    addRangeIssue(context, value.minTurn, value.maxTurn, 'turn');
    addRangeIssue(context, value.minCount, value.maxCount, 'count');
    if (value.turn !== undefined && value.minTurn !== undefined && value.turn < value.minTurn) {
      context.addIssue({
        code: 'custom',
        path: ['turn'],
        message: 'must not be below minTurn',
      });
    }
    if (value.turn !== undefined && value.maxTurn !== undefined && value.turn > value.maxTurn) {
      context.addIssue({
        code: 'custom',
        path: ['turn'],
        message: 'must not exceed maxTurn',
      });
    }
  });

export const simulationExpectationSchema = z
  .object({
    minCompletedTurns: z.number().int().min(0).optional(),
    maxCompletedTurns: z.number().int().min(0).optional(),
    endReason: z.string().trim().min(1).optional(),
    players: z.array(playerExpectationSchema).default([]),
    cities: z.array(cityExpectationSchema).default([]),
    diplomacy: z.array(diplomacyExpectationSchema).default([]),
    diplomacyEvents: z.array(diplomacyEventExpectationSchema).default([]),
    events: z.array(eventExpectationSchema).default([]),
  })
  .superRefine((value, context) => {
    addRangeIssue(context, value.minCompletedTurns, value.maxCompletedTurns, 'completedTurns');
  });

export type SimulationExpectations = z.infer<typeof simulationExpectationSchema>;

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
    message: 'minimum must not exceed maximum',
  });
}
