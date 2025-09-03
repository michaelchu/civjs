import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { players } from './players';
import { games } from './games';

/**
 * Government Changes Table
 * Tracks government change history for players
 * Reference: freeciv government transition system
 */
export const governmentChanges = pgTable('government_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),

  // Government transition
  fromGovernment: varchar('from_government', { length: 50 }),
  toGovernment: varchar('to_government', { length: 50 }).notNull(),
  
  // Revolution details
  changeTurn: integer('change_turn').notNull(),
  anarchyTurns: integer('anarchy_turns').default(0).notNull(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const governmentChangesRelations = relations(governmentChanges, ({ one }) => ({
  game: one(games, {
    fields: [governmentChanges.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [governmentChanges.playerId],
    references: [players.id],
  }),
}));

export type GovernmentChange = typeof governmentChanges.$inferSelect;
export type NewGovernmentChange = typeof governmentChanges.$inferInsert;