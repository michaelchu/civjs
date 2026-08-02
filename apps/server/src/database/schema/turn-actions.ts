/**
 * @module server/database/schema/turn-actions
 * Defines the database schema for turn actions.
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { games } from './games';
import { players } from './players';

export const turnActions = pgTable(
  'turn_actions',
  {
    id: varchar('id', { length: 100 }).notNull(),
    gameId: uuid('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull(),
    playerId: uuid('player_id')
      .references(() => players.id, { onDelete: 'cascade' })
      .notNull(),
    turnNumber: integer('turn_number').notNull(),
    actionType: varchar('action_type', { length: 50 }).notNull(),
    priority: integer('priority').default(5).notNull(),
    payload: jsonb('payload').default({}).notNull(),
    dependencies: jsonb('dependencies').default([]).notNull(),
    status: varchar('status', { length: 20 }).default('queued').notNull(),
    errorMessage: varchar('error_message', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    completedAt: timestamp('completed_at'),
  },
  table => [
    primaryKey({
      name: 'turn_actions_game_action_pk',
      columns: [table.gameId, table.turnNumber, table.id],
    }),
    index('turn_actions_game_turn_idx').on(table.gameId, table.turnNumber),
    index('turn_actions_player_status_idx').on(table.playerId, table.status),
  ]
);

export type TurnAction = typeof turnActions.$inferSelect;
export type NewTurnAction = typeof turnActions.$inferInsert;
