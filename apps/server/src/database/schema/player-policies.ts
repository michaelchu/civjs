import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { players } from './players';
import { games } from './games';

/**
 * Player Policies Table
 * Tracks policy adoption and changes for players
 * Reference: freeciv multipliers system for civic policies
 */
export const playerPolicies = pgTable('player_policies', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),

  // Policy identification
  policyId: varchar('policy_id', { length: 50 }).notNull(),

  // Policy values
  currentValue: integer('current_value').notNull(),
  targetValue: integer('target_value').notNull(),

  // Change tracking
  adoptedTurn: integer('adopted_turn').notNull(),
  lastChangedTurn: integer('last_changed_turn').notNull(),

  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const playerPoliciesRelations = relations(playerPolicies, ({ one }) => ({
  game: one(games, {
    fields: [playerPolicies.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [playerPolicies.playerId],
    references: [players.id],
  }),
}));

export type PlayerPolicy = typeof playerPolicies.$inferSelect;
export type NewPlayerPolicy = typeof playerPolicies.$inferInsert;
