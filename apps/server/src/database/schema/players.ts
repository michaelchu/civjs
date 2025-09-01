import { pgTable, uuid, varchar, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';
import { games } from './games';
import { cities } from './cities';
import { units } from './units';

export const players = pgTable('players', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  userId: uuid('user_id')
    .references(() => users.id)
    .notNull(),

  // Player info
  playerNumber: integer('player_number').notNull(), // 0-based index
  civilization: varchar('civilization', { length: 50 }).notNull(),
  leaderName: varchar('leader_name', { length: 100 }).notNull(),
  color: jsonb('color').notNull(), // {r, g, b}

  // Status
  isAlive: boolean('is_alive').default(true).notNull(),
  isAI: boolean('is_ai').default(false).notNull(),
  isReady: boolean('is_ready').default(false).notNull(),
  hasEndedTurn: boolean('has_ended_turn').default(false).notNull(),
  connectionStatus: varchar('connection_status', { length: 20 }).default('connected').notNull(),

  // Resources
  gold: integer('gold').default(0).notNull(),
  science: integer('science').default(0).notNull(),
  culture: integer('culture').default(0).notNull(),
  faith: integer('faith').default(0).notNull(),

  // Technologies and civics
  technologies: jsonb('technologies').default([]).notNull(), // array of tech IDs
  currentResearch: varchar('current_research', { length: 50 }),
  researchProgress: integer('research_progress').default(0).notNull(),

  // Government
  government: varchar('government', { length: 50 }).default('despotism').notNull(),
  revolutionTurns: integer('revolution_turns').default(0).notNull(),

  // Score
  score: integer('score').default(0).notNull(),

  // Diplomacy
  knownPlayers: jsonb('known_players').default([]).notNull(), // array of player IDs
  diplomaticRelations: jsonb('diplomatic_relations').default({}).notNull(),

  // Visibility (fog of war)
  exploredTiles: jsonb('explored_tiles').default([]).notNull(), // array of tile coordinates
  visibleTiles: jsonb('visible_tiles').default([]).notNull(),

  // Timestamps
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
  lastActionAt: timestamp('last_action_at').defaultNow().notNull(),
  eliminatedAt: timestamp('eliminated_at'),
});

export const playersRelations = relations(players, ({ one, many }) => ({
  game: one(games, {
    fields: [players.gameId],
    references: [games.id],
  }),
  user: one(users, {
    fields: [players.userId],
    references: [users.id],
  }),
  cities: many(cities),
  units: many(units),
}));

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
