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
  goldPerTurn: integer('gold_per_turn').default(0).notNull(),
  sciencePerTurn: integer('science_per_turn').default(0).notNull(),
  culturePerTurn: integer('culture_per_turn').default(0).notNull(),
  faithPerTurn: integer('faith_per_turn').default(0).notNull(),

  // Buildings
  buildings: jsonb('buildings').default([]).notNull(), // array of building IDs

  // Citizens
  workedTiles: jsonb('worked_tiles').default([]).notNull(), // array of {x, y} coordinates
  specialists: jsonb('specialists').default({}).notNull(), // {type: count}

  // Status
  happiness: integer('happiness').default(0).notNull(),
  health: integer('health').default(100).notNull(),
  isCapital: boolean('is_capital').default(false).notNull(),
  isPuppet: boolean('is_puppet').default(false).notNull(),
  isOccupied: boolean('is_occupied').default(false).notNull(),

  // Defense
  defenseStrength: integer('defense_strength').default(1).notNull(),
  wallsLevel: integer('walls_level').default(0).notNull(),

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
