/**
 * Database schema for city disasters
 * Records all disaster events that affect cities during turn processing
 */

import { pgTable, text, integer, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { games } from './games';
import { cities } from './cities';

export const disasters = pgTable('disasters', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: text('game_id')
    .references(() => games.id)
    .notNull(),
  cityId: text('city_id')
    .references(() => cities.id)
    .notNull(),

  // Disaster details
  cityName: text('city_name').notNull(), // Snapshot of city name at time of disaster
  type: text('type').notNull(), // earthquake, fire, flood, plague, etc.
  severity: integer('severity').notNull(), // 1-10 scale

  // Effects applied
  effects: jsonb('effects').notNull(), // Array of AppliedDisasterEffect objects

  // Turn context
  turn: integer('turn').notNull(),
  year: integer('year').notNull(),

  // Message and metadata
  message: text('message').notNull(),
  timestamp: timestamp('timestamp').notNull(),

  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Disaster = typeof disasters.$inferSelect;
export type NewDisaster = typeof disasters.$inferInsert;
