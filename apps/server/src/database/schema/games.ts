import { pgTable, uuid, varchar, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { players } from './players';
import { gameTurns } from './game-turns';

export const games = pgTable('games', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  hostId: uuid('host_id')
    .references(() => users.id)
    .notNull(),

  // Game state
  status: varchar('status', { length: 20 }).notNull().default('waiting'), // waiting, running, paused, ended
  currentTurn: integer('current_turn').default(0).notNull(),
  turnPhase: varchar('turn_phase', { length: 20 }).default('movement').notNull(),

  // Settings
  gameType: varchar('game_type', { length: 20 }).notNull().default('multiplayer'), // single, multiplayer
  maxPlayers: integer('max_players').default(8).notNull(),
  mapWidth: integer('map_width').default(80).notNull(),
  mapHeight: integer('map_height').default(50).notNull(),
  victoryConditions: jsonb('victory_conditions').default([]).notNull(),
  ruleset: varchar('ruleset', { length: 50 }).default('classic').notNull(),

  // Map data
  mapSeed: varchar('map_seed', { length: 100 }),
  mapData: jsonb('map_data'), // Compressed map data

  // Timing
  turnTimeLimit: integer('turn_time_limit'), // in seconds
  turnStartedAt: timestamp('turn_started_at'),
  pausedAt: timestamp('paused_at'),

  // Metadata
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  // Game state snapshot for quick loading
  gameState: jsonb('game_state'),
});

export const gamesRelations = relations(games, ({ one, many }) => ({
  host: one(users, {
    fields: [games.hostId],
    references: [users.id],
  }),
  players: many(players),
  turns: many(gameTurns),
}));

export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
