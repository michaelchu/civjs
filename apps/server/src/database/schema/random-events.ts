/**
 * Database schema for random events log
 * General log of all random events that occur during turn processing
 */

import { pgTable, text, integer, boolean, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { games } from './games';

export const randomEvents = pgTable('random_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id)
    .notNull(),

  // Event classification
  eventType: text('event_type').notNull(), // barbarian_uprising, city_disaster, random_unit_movement, etc.
  phase: text('phase').notNull(), // Turn phase when event occurred

  // Turn context
  turn: integer('turn').notNull(),
  year: integer('year').notNull(),

  // Event outcome
  success: boolean('success').notNull(),
  playersAffected: jsonb('players_affected').notNull(), // Array of player IDs

  // Event details (type-specific data)
  details: jsonb('details').notNull(),

  // Timing
  timestamp: timestamp('timestamp').notNull(),
  duration: integer('duration'), // Event processing time in ms

  // Audit fields
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type RandomEvent = typeof randomEvents.$inferSelect;
export type NewRandomEvent = typeof randomEvents.$inferInsert;
