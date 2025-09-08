/**
 * Tile ownership database schema for border system
 * Ported from reference/freeciv map tile ownership concepts
 */

import { pgTable, uuid, varchar, integer, real, timestamp, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { players } from './players';
import { games } from './games';
import { cities } from './cities';

export const tiles = pgTable('tiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  
  // Tile coordinates
  x: integer('x').notNull(),
  y: integer('y').notNull(),
  
  // Basic tile properties
  terrain: varchar('terrain', { length: 50 }).notNull(),
  resource: varchar('resource', { length: 50 }),
  elevation: integer('elevation'),
  riverMask: integer('river_mask').default(0), // Bitmask for river connections
  
  // Border system properties - ported from reference/freeciv/server/maphand.c
  owner: uuid('owner') // playerId that owns this tile
    .references(() => players.id, { onDelete: 'set null' }),
  claimer: uuid('claimer'), // cityId or baseId that claims this tile for borders
  borderStrength: real('border_strength'), // Border strength at this tile for conflict resolution
  
  // Timestamps for tracking changes
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for common queries
  gameCoordinatesIdx: index('tiles_game_coordinates_idx').on(table.gameId, table.x, table.y),
  gameOwnerIdx: index('tiles_game_owner_idx').on(table.gameId, table.owner),
  gameClaimerIdx: index('tiles_game_claimer_idx').on(table.gameId, table.claimer),
}));

export const tilesRelations = relations(tiles, ({ one }) => ({
  game: one(games, {
    fields: [tiles.gameId],
    references: [games.id],
  }),
  ownerPlayer: one(players, {
    fields: [tiles.owner],
    references: [players.id],
  }),
  claimerCity: one(cities, {
    fields: [tiles.claimer],
    references: [cities.id],
  }),
}));

export type Tile = typeof tiles.$inferSelect;
export type NewTile = typeof tiles.$inferInsert;

// Border-specific queries and operations
export const tileQueries = {
  /**
   * Get all tiles owned by a specific player in a game
   */
  getPlayerTerritory: (gameId: string, playerId: string) => ({
    gameId,
    owner: playerId,
  }),
  
  /**
   * Get all tiles within a rectangular area (for border calculations)
   */
  getTilesInArea: (gameId: string, minX: number, maxX: number, minY: number, maxY: number) => ({
    gameId,
    x: { gte: minX, lte: maxX },
    y: { gte: minY, lte: maxY },
  }),
  
  /**
   * Get tiles claimed by a specific border source (city or base)
   */
  getClaimedTiles: (gameId: string, claimerId: string) => ({
    gameId,
    claimer: claimerId,
  }),
};