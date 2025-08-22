import { pgTable, uuid, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { games } from './games';

export const gameTurns = pgTable('game_turns', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),

  turnNumber: integer('turn_number').notNull(),
  year: integer('year').notNull(), // Game year (e.g., 4000 BC)

  // Turn data
  events: jsonb('events').default([]).notNull(), // Array of turn events
  playerActions: jsonb('player_actions').default([]).notNull(), // Actions taken this turn

  // Statistics
  statistics: jsonb('statistics').default({}).notNull(), // Per-player stats for this turn

  // State snapshot (for replay/rollback)
  stateSnapshot: jsonb('state_snapshot'), // Compressed game state

  // Timing
  startedAt: timestamp('started_at').notNull(),
  endedAt: timestamp('ended_at'),
  duration: integer('duration'), // in seconds
});

export const gameTurnsRelations = relations(gameTurns, ({ one }) => ({
  game: one(games, {
    fields: [gameTurns.gameId],
    references: [games.id],
  }),
}));

export type GameTurn = typeof gameTurns.$inferSelect;
export type NewGameTurn = typeof gameTurns.$inferInsert;
