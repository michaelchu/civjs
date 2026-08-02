/**
 * @module server/database/schema/cities
 * Defines the database schema for cities.
 */
import { pgTable, uuid, varchar, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { players } from './players';
import { games } from './games';

export const cities = pgTable('cities', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  originalOwnerId: uuid('original_owner_id').references(() => players.id, { onDelete: 'set null' }),

  // Basic info
  name: varchar('name', { length: 100 }).notNull(),
  x: integer('x').notNull(),
  y: integer('y').notNull(),

  // Population
  population: integer('population').default(1).notNull(),
  food: integer('food').default(0).notNull(),
  foodPerTurn: integer('food_per_turn').default(2).notNull(),

  // Production
  production: integer('production').default(0).notNull(),
  productionPerTurn: integer('production_per_turn').default(1).notNull(),
  currentProduction: varchar('current_production', { length: 100 }), // what's being built
  productionQueue: jsonb('production_queue').default([]).notNull(),

  // Resources
  tradePerTurn: integer('trade_per_turn').default(0).notNull(),
  goldPerTurn: integer('gold_per_turn').default(0).notNull(),
  luxuryPerTurn: integer('luxury_per_turn').default(0).notNull(),
  sciencePerTurn: integer('science_per_turn').default(0).notNull(),
  pollution: integer('pollution').default(0).notNull(),
  tradeRoutes: jsonb('trade_routes').default([]).notNull(),
  governor: jsonb('governor'),
  rallyPoint: jsonb('rally_point'),
  faithPerTurn: integer('faith_per_turn').default(0).notNull(),

  // Culture system (freeciv-based)
  history: integer('history').default(0).notNull(), // Accumulated culture history

  // Buildings
  buildings: jsonb('buildings').default([]).notNull(), // array of building IDs

  // Citizens
  workedTiles: jsonb('worked_tiles').default([]).notNull(), // array of {x, y} coordinates
  specialists: jsonb('specialists').default({}).notNull(), // {type: count}

  // Status
  happiness: integer('happiness').default(0).notNull(),
  wasHappy: boolean('was_happy').default(false).notNull(),
  disorderTurns: integer('disorder_turns').default(0).notNull(),
  health: integer('health').default(100).notNull(),
  isCapital: boolean('is_capital').default(false).notNull(),
  isPuppet: boolean('is_puppet').default(false).notNull(),
  isOccupied: boolean('is_occupied').default(false).notNull(),

  // Defense
  defenseStrength: integer('defense_strength').default(1).notNull(),
  wallsLevel: integer('walls_level').default(0).notNull(),
  airliftUsedTurn: integer('airlift_used_turn'),
  didSellTurn: integer('did_sell_turn'),
  didBuyTurn: integer('did_buy_turn'),
  espionageThefts: jsonb('espionage_thefts').default({}).notNull(),

  // Timestamps
  foundedTurn: integer('founded_turn').notNull(),
  capturedTurn: integer('captured_turn'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const citiesRelations = relations(cities, ({ one }) => ({
  game: one(games, {
    fields: [cities.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [cities.playerId],
    references: [players.id],
  }),
}));

export type City = typeof cities.$inferSelect;
export type NewCity = typeof cities.$inferInsert;
