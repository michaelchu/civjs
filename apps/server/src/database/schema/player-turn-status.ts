import { pgTable, uuid, varchar, timestamp, boolean, jsonb, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { gameTurns } from './game-turns';
import { players } from './players';
import { games } from './games';

/**
 * Player Turn Status - tracks detailed per-player turn completion status
 * Addresses Database Schema Gap: Per-player turn completion tracking
 *
 * @reference freeciv-web/javascript/packhand.js handle_end_turn()
 */
export const playerTurnStatus = pgTable('player_turn_status', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  turnId: uuid('turn_id')
    .references(() => gameTurns.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),

  // Turn status tracking
  hasEndedTurn: boolean('has_ended_turn').default(false).notNull(),
  isReady: boolean('is_ready').default(false).notNull(),

  // Turn participation
  isActive: boolean('is_active').default(true).notNull(), // Player participated in turn
  isAI: boolean('is_ai').default(false).notNull(), // AI vs human player

  // Timing information
  turnStartedAt: timestamp('turn_started_at'),
  turnEndedAt: timestamp('turn_ended_at'),
  totalTurnTime: integer('total_turn_time'), // in seconds

  // Player actions during turn
  actionsCount: integer('actions_count').default(0).notNull(),
  unitsMovedCount: integer('units_moved_count').default(0).notNull(),
  citiesManaged: integer('cities_managed').default(0).notNull(),

  // Turn end reason
  endReason: varchar('end_reason', { length: 50 }), // 'manual', 'timeout', 'auto', 'ai'

  // Player-specific turn data
  playerData: jsonb('player_data').default({}).notNull(), // Resources, research, etc. at turn end

  // AI-specific data (if applicable)
  aiProcessingTime: integer('ai_processing_time'), // in milliseconds
  aiDecisions: jsonb('ai_decisions').default({}).notNull(), // AI decision log
});

export const playerTurnStatusRelations = relations(playerTurnStatus, ({ one }) => ({
  game: one(games, {
    fields: [playerTurnStatus.gameId],
    references: [games.id],
  }),
  turn: one(gameTurns, {
    fields: [playerTurnStatus.turnId],
    references: [gameTurns.id],
  }),
  player: one(players, {
    fields: [playerTurnStatus.playerId],
    references: [players.id],
  }),
}));

export type PlayerTurnStatus = typeof playerTurnStatus.$inferSelect;
export type NewPlayerTurnStatus = typeof playerTurnStatus.$inferInsert;
