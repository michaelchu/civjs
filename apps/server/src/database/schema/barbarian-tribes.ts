/**
 * Database schema for barbarian tribes
 * Tracks active barbarian groups spawned during random events
 */

import { pgTable, text, integer, boolean, timestamp, jsonb, uuid } from 'drizzle-orm/pg-core';
import { games } from './games';

export const barbarianTribes = pgTable('barbarian_tribes', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: text('game_id')
    .references(() => games.id)
    .notNull(),

  // Tribe identification
  playerId: text('player_id').notNull(), // Barbarian "player" ID
  name: text('name').notNull(), // Generated barbarian civilization name
  type: text('type').notNull(), // 'land', 'sea', 'mixed'

  // Spawn information
  spawnTurn: integer('spawn_turn').notNull(),
  spawnLocation: jsonb('spawn_location').notNull(), // { x, y, tileId, terrain }

  // Units and status
  unitIds: jsonb('unit_ids').notNull(), // Array of unit IDs belonging to this tribe
  isActive: boolean('is_active').default(true).notNull(),
  lastSeenTurn: integer('last_seen_turn').notNull(),

  // Metadata
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type BarbarianTribe = typeof barbarianTribes.$inferSelect;
export type NewBarbarianTribe = typeof barbarianTribes.$inferInsert;
