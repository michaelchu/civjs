import { pgTable, uuid, varchar, integer, boolean, jsonb, decimal } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { players } from './players';
import { games } from './games';

export const units = pgTable('units', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),

  // Basic info
  unitType: varchar('unit_type', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }),
  x: integer('x').notNull(),
  y: integer('y').notNull(),

  // Combat stats
  health: integer('health').default(100).notNull(),
  maxHealth: integer('max_health').default(100).notNull(),
  attackStrength: integer('attack_strength').notNull(),
  defenseStrength: integer('defense_strength').notNull(),
  rangedStrength: integer('ranged_strength').default(0).notNull(),

  // Movement
  movementPoints: decimal('movement_points', { precision: 10, scale: 2 }).notNull(),
  maxMovementPoints: decimal('max_movement_points', { precision: 10, scale: 2 }).notNull(),

  // Experience
  experience: integer('experience').default(0).notNull(),
  veteranLevel: integer('veteran_level').default(0).notNull(),
  promotions: jsonb('promotions').default([]).notNull(),

  // Orders
  orders: jsonb('orders').default([]).notNull(), // queue of commands
  currentOrder: varchar('current_order', { length: 50 }),
  destination: jsonb('destination'), // {x, y} for goto orders

  // Status
  isEmbarked: boolean('is_embarked').default(false).notNull(),
  isFortified: boolean('is_fortified').default(false).notNull(),
  isAutomated: boolean('is_automated').default(false).notNull(),
  canMove: boolean('can_move').default(true).notNull(),

  // Special
  cargoUnits: jsonb('cargo_units').default([]).notNull(), // for transports
  homeCityId: uuid('home_city_id'),

  // Timestamps
  createdTurn: integer('created_turn').notNull(),
  lastActionTurn: integer('last_action_turn'),
});

export const unitsRelations = relations(units, ({ one }) => ({
  game: one(games, {
    fields: [units.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [units.playerId],
    references: [players.id],
  }),
}));

export type Unit = typeof units.$inferSelect;
export type NewUnit = typeof units.$inferInsert;
