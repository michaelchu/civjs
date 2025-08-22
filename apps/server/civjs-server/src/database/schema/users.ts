import { pgTable, uuid, varchar, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  email: varchar('email', { length: 255 }).unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  isGuest: boolean('is_guest').default(false).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastSeen: timestamp('last_seen').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  // Statistics
  gamesPlayed: integer('games_played').default(0).notNull(),
  gamesWon: integer('games_won').default(0).notNull(),
  totalScore: integer('total_score').default(0).notNull(),

  // Settings
  settings: jsonb('settings').default({}).notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  players: many(players),
  createdGames: many(games),
}));

// Import these from their respective files after creation
import { players } from './players';
import { games } from './games';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
