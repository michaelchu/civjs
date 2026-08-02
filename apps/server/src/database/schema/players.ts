/**
 * @module server/database/schema/players
 * Defines the database schema for players.
 */
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
  userId: uuid('user_id').references(() => users.id),

  // Player info
  playerNumber: integer('player_number').notNull(), // 0-based index
  nation: varchar('nation', { length: 50 }).notNull(), // Nation ID (e.g., 'american', 'roman')
  civilization: varchar('civilization', { length: 50 }).notNull(), // Display name (e.g., 'American', 'Roman')
  leaderName: varchar('leader_name', { length: 100 }).notNull(), // Selected leader name
  color: jsonb('color').notNull(), // {r, g, b} - TODO: migrate to colorTheme

  // Status
  isAlive: boolean('is_alive').default(true).notNull(),
  isAI: boolean('is_ai').default(false).notNull(),
  aiLevel: varchar('ai_level', { length: 20 }).default('easy').notNull(),
  aiTraits: jsonb('ai_traits')
    .default({ expansionist: 50, trader: 50, aggressive: 50, builder: 50 })
    .notNull(),
  aiState: jsonb('ai_state')
    .default({ diplomacy: {}, unitTasks: {}, cityWants: {}, techWants: {} })
    .notNull(),
  isReady: boolean('is_ready').default(false).notNull(),
  hasEndedTurn: boolean('has_ended_turn').default(false).notNull(),
  hasConceded: boolean('has_conceded').default(false).notNull(),
  isWinner: boolean('is_winner').default(false).notNull(),
  teamId: varchar('team_id', { length: 50 }),
  connectionStatus: varchar('connection_status', { length: 20 }).default('connected').notNull(),

  // Resources
  gold: integer('gold').default(0).notNull(),
  science: integer('science').default(0).notNull(),
  faith: integer('faith').default(0).notNull(),

  // Economic system (tax rate allocation)
  taxRate: integer('tax_rate').default(40).notNull(), // Percentage of trade converted to gold
  luxuryRate: integer('luxury_rate').default(0).notNull(), // Percentage of trade converted to luxury
  scienceRate: integer('science_rate').default(60).notNull(), // Percentage of trade converted to science

  // Culture system (freeciv-based)
  history: integer('history').default(0).notNull(), // National history accumulation

  // Technologies and civics
  technologies: jsonb('technologies').default([]).notNull(), // array of tech IDs
  currentResearch: varchar('current_research', { length: 50 }),
  researchProgress: integer('research_progress').default(0).notNull(),

  // Government
  government: varchar('government', { length: 50 }).default('despotism').notNull(),
  revolutionTurns: integer('revolution_turns').default(0).notNull(),

  // Score
  score: integer('score').default(0).notNull(),
  unitsBuilt: integer('units_built').default(0).notNull(),
  unitsKilled: integer('units_killed').default(0).notNull(),
  unitsLost: integer('units_lost').default(0).notNull(),
  spaceshipState: jsonb('spaceship_state')
    .default({ structurals: 0, components: 0, modules: 0 })
    .notNull(),

  // Diplomacy
  knownPlayers: jsonb('known_players').default([]).notNull(), // array of player IDs
  diplomaticRelations: jsonb('diplomatic_relations').default({}).notNull(),

  // Visibility (fog of war)
  exploredTiles: jsonb('explored_tiles').default([]).notNull(), // array of tile coordinates
  visibleTiles: jsonb('visible_tiles').default([]).notNull(),
  tileLastSeen: jsonb('tile_last_seen').default({}).notNull(),
  tileMemory: jsonb('tile_memory').default({}).notNull(),

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
