import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { gameTurns } from './game-turns';
import { games } from './games';

/**
 * Turn Phase tracking - stores detailed information about each phase of turn processing
 * Addresses Database Schema Gap: Phase information
 *
 * @reference freeciv/server/srv_main.c turn processing phases
 */
export const turnPhases = pgTable(
  'turn_phases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    gameId: uuid('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    turnId: uuid('turn_id')
      .references(() => gameTurns.id, { onDelete: 'cascade' })
      .notNull(),

    // Phase identification
    phase: varchar('phase', { length: 50 }).notNull(), // TurnPhase enum value
    phaseOrder: integer('phase_order').notNull(), // Execution order (1-10)

    // Phase execution tracking
    status: varchar('status', { length: 20 }).default('pending').notNull(), // pending, running, completed, failed
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    duration: integer('duration'), // in milliseconds

    // Phase results and data
    success: boolean('success'),
    errorMessage: varchar('error_message', { length: 500 }),
    phaseData: jsonb('phase_data').default({}).notNull(), // Phase-specific data and results

    // Statistics for this phase
    playersProcessed: integer('players_processed').default(0).notNull(),
    unitsProcessed: integer('units_processed').default(0).notNull(),
    citiesProcessed: integer('cities_processed').default(0).notNull(),
    actionsProcessed: integer('actions_processed').default(0).notNull(),
  },
  table => [uniqueIndex('turn_phases_turn_phase_idx').on(table.turnId, table.phase)]
);

export const turnPhasesRelations = relations(turnPhases, ({ one }) => ({
  game: one(games, {
    fields: [turnPhases.gameId],
    references: [games.id],
  }),
  turn: one(gameTurns, {
    fields: [turnPhases.turnId],
    references: [gameTurns.id],
  }),
}));

export type TurnPhase = typeof turnPhases.$inferSelect;
export type NewTurnPhase = typeof turnPhases.$inferInsert;
