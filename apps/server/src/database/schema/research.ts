import { pgTable, uuid, varchar, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { games } from './games';
import { players } from './players';

export const research = pgTable('research', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  currentTech: varchar('current_tech', { length: 50 }),
  techGoal: varchar('tech_goal', { length: 50 }),
  bulbsAccumulated: integer('bulbs_accumulated').default(0),
  bulbsLastTurn: integer('bulbs_last_turn').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const playerTechs = pgTable('player_techs', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  techId: varchar('tech_id', { length: 50 }).notNull(),
  researchedTurn: integer('researched_turn').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const researchRelations = relations(research, ({ one }) => ({
  game: one(games, {
    fields: [research.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [research.playerId],
    references: [players.id],
  }),
}));

export const playerTechRelations = relations(playerTechs, ({ one }) => ({
  game: one(games, {
    fields: [playerTechs.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [playerTechs.playerId],
    references: [players.id],
  }),
}));

export type Research = typeof research.$inferSelect;
export type NewResearch = typeof research.$inferInsert;
export type PlayerTech = typeof playerTechs.$inferSelect;
export type NewPlayerTech = typeof playerTechs.$inferInsert;
