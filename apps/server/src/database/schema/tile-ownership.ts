import { pgTable, text, integer, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { games } from './games';
import { players } from './players';
import { cities } from './cities';

/**
 * Tile ownership table for city borders
 * Stores which player owns each tile for border visualization and mechanics
 */
export const tileOwnership = pgTable(
  'tile_ownership',
  {
    id: text('id').primaryKey(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    // Source of ownership (city that claimed this tile)
    sourceType: text('source_type').notNull().default('city'), // 'city' | 'base' | 'fort'
    sourceId: text('source_id'), // ID of the city/base that claimed this tile
    // Border strength at this tile (for conflict resolution)
    borderStrength: integer('border_strength').notNull().default(1),
    // When this tile was claimed
    claimedAt: timestamp('claimed_at').defaultNow().notNull(),
    // When this record was last updated
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Composite index for efficient tile lookups
    gamePositionIdx: index('tile_ownership_game_position_idx').on(
      table.gameId,
      table.x,
      table.y
    ),
    // Index for player ownership queries
    ownerIdx: index('tile_ownership_owner_idx').on(table.ownerId),
    // Index for source-based queries (e.g., all tiles claimed by a city)
    sourceIdx: index('tile_ownership_source_idx').on(table.sourceId),
    // Composite index for game + owner efficient filtering
    gameOwnerIdx: index('tile_ownership_game_owner_idx').on(table.gameId, table.ownerId),
  })
);

/**
 * Relations for tile ownership
 */
export const tileOwnershipRelations = relations(tileOwnership, ({ one }) => ({
  // Relation to game
  game: one(games, {
    fields: [tileOwnership.gameId],
    references: [games.id],
  }),
  // Relation to owning player
  owner: one(players, {
    fields: [tileOwnership.ownerId],
    references: [players.id],
  }),
  // Relation to source city (if source is a city)
  sourceCity: one(cities, {
    fields: [tileOwnership.sourceId],
    references: [cities.id],
  }),
}));

/**
 * TypeScript types derived from the schema
 */
export type TileOwnership = typeof tileOwnership.$inferSelect;
export type NewTileOwnership = typeof tileOwnership.$inferInsert;