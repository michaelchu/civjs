import { pgTable, uuid, varchar, timestamp, jsonb, integer, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { gameTurns } from './game-turns';
import { players } from './players';
import { games } from './games';

/**
 * Turn Map Changes - tracks all map modifications during each turn
 * Addresses Database Schema Gap: Turn-specific map changes
 *
 * @reference freeciv/server/maphand.c map modifications
 * @reference freeciv/server/cityturn.c border changes
 * @reference docs/TURN_SYSTEM_GAPS_ANALYSIS.md section 10
 */
export const turnMapChanges = pgTable('turn_map_changes', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  turnId: uuid('turn_id')
    .references(() => gameTurns.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id').references(() => players.id, { onDelete: 'cascade' }),

  // Map location
  tileX: integer('tile_x').notNull(),
  tileY: integer('tile_y').notNull(),

  // Change details
  changeType: varchar('change_type', { length: 50 }).notNull(), // 'border', 'terrain', 'visibility', 'improvement', 'city', 'unit'
  changeAction: varchar('change_action', { length: 20 }).notNull(), // 'created', 'modified', 'removed', 'revealed', 'hidden'

  // Change timing
  occurredAt: timestamp('occurred_at').notNull(),
  turnPhase: varchar('turn_phase', { length: 50 }), // Phase when change occurred

  // Previous and current state
  previousState: jsonb('previous_state'), // State before change
  newState: jsonb('new_state').notNull(), // State after change

  // Change metadata
  changeReason: varchar('change_reason', { length: 100 }), // 'city_growth', 'unit_move', 'improvement_built', 'border_expansion'
  changeSource: varchar('change_source', { length: 50 }), // 'player_action', 'ai_action', 'game_rule', 'random_event'

  // Impact assessment
  affectedPlayers: jsonb('affected_players').default([]).notNull(), // Array of player IDs who can see this change
  visibilityChange: boolean('visibility_change').default(false).notNull(),
  borderChange: boolean('border_change').default(false).notNull(),

  // Related entities
  relatedCityId: uuid('related_city_id'),
  relatedUnitId: uuid('related_unit_id'),

  // Change priority for replay/analysis
  priority: integer('priority').default(5).notNull(), // 1 (cosmetic) to 10 (critical)
});

export const turnMapChangesRelations = relations(turnMapChanges, ({ one }) => ({
  game: one(games, {
    fields: [turnMapChanges.gameId],
    references: [games.id],
  }),
  turn: one(gameTurns, {
    fields: [turnMapChanges.turnId],
    references: [gameTurns.id],
  }),
  player: one(players, {
    fields: [turnMapChanges.playerId],
    references: [players.id],
  }),
}));

export type TurnMapChange = typeof turnMapChanges.$inferSelect;
export type NewTurnMapChange = typeof turnMapChanges.$inferInsert;
