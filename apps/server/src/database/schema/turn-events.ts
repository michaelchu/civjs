/**
 * @module server/database/schema/turn-events
 * Defines the database schema for turn events.
 */
import { pgTable, uuid, varchar, timestamp, jsonb, integer, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { gameTurns } from './game-turns';
import { players } from './players';
import { games } from './games';

/**
 * Turn Events - comprehensive event history with proper categorization
 * Addresses Database Schema Gap: Event history with proper categorization
 *
 * @reference freeciv/server/srv_main.c event processing
 * @reference apps/server/src/game/events/GameEventService.ts
 */
export const turnEvents = pgTable('turn_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  turnId: uuid('turn_id')
    .references(() => gameTurns.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),

  // Event identification
  eventType: varchar('event_type', { length: 50 }).notNull(), // GameEventType enum value
  eventCategory: varchar('event_category', { length: 30 }).notNull(), // 'game', 'player', 'unit', 'city', 'research', 'combat', 'achievement'

  // Event timing
  occurredAt: timestamp('occurred_at').notNull(),
  turnPhase: varchar('turn_phase', { length: 50 }), // Phase when event occurred

  // Event details
  title: varchar('title', { length: 200 }).notNull(),
  description: varchar('description', { length: 1000 }),
  eventData: jsonb('event_data').notNull(), // Event-specific data

  // Event importance and visibility
  priority: integer('priority').default(5).notNull(), // 1 (low) to 10 (critical)
  isVisible: boolean('is_visible').default(true).notNull(), // Show to player
  isAchievement: boolean('is_achievement').default(false).notNull(),

  // Event processing status
  status: varchar('status', { length: 20 }).default('completed').notNull(), // pending, processing, completed, failed
  attempts: integer('attempts').default(1).notNull(),
  lastError: varchar('last_error', { length: 500 }),

  // Achievement-specific data (if applicable)
  achievementId: varchar('achievement_id', { length: 50 }),
  achievementUnlocked: boolean('achievement_unlocked').default(false).notNull(),

  // Location data (if applicable)
  locationX: integer('location_x'),
  locationY: integer('location_y'),

  // Related entities (if applicable)
  relatedUnitId: uuid('related_unit_id'),
  relatedCityId: uuid('related_city_id'),
  relatedPlayerId: uuid('related_player_id'),
});

export const turnEventsRelations = relations(turnEvents, ({ one }) => ({
  game: one(games, {
    fields: [turnEvents.gameId],
    references: [games.id],
  }),
  turn: one(gameTurns, {
    fields: [turnEvents.turnId],
    references: [gameTurns.id],
  }),
  player: one(players, {
    fields: [turnEvents.playerId],
    references: [players.id],
  }),
  relatedPlayer: one(players, {
    fields: [turnEvents.relatedPlayerId],
    references: [players.id],
  }),
}));

export type TurnEvent = typeof turnEvents.$inferSelect;
export type NewTurnEvent = typeof turnEvents.$inferInsert;
