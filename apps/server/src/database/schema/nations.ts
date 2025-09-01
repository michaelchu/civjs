import { pgTable, uuid, varchar, timestamp, jsonb, boolean, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { games } from './games';
import { players } from './players';

// Nation selections per game
export const nationSelections = pgTable('nation_selections', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  nationId: varchar('nation_id', { length: 50 }).notNull(), // e.g., 'american', 'roman'
  leaderName: varchar('leader_name', { length: 100 }).notNull(),
  selectedAt: timestamp('selected_at').defaultNow().notNull(),
});

// Diplomatic states between players in a game
export const diplomaticStates = pgTable('diplomatic_states', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  targetPlayerId: uuid('target_player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  
  // Diplomatic state
  state: varchar('state', { length: 20 }).default('neutral').notNull(), // war, peace, alliance, ceasefire, neutral
  turnsLeft: integer('turns_left'), // for temporary states like ceasefire
  contactTurnsAgo: integer('contact_turns_ago').default(0).notNull(),
  
  // Embassy and vision
  hasRealEmbassy: boolean('has_real_embassy').default(false).notNull(),
  hasEmbassyWithPlayer: boolean('has_embassy_with_player').default(false).notNull(),
  givesSharedVision: boolean('gives_shared_vision').default(false).notNull(),
  receivesSharedVision: boolean('receives_shared_vision').default(false).notNull(),
  
  // Treaties and agreements
  treaties: jsonb('treaties').default([]).notNull(), // array of treaty objects
  
  // Timestamps
  stateChangedAt: timestamp('state_changed_at').defaultNow().notNull(),
  lastContactAt: timestamp('last_contact_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Intelligence reports cache (optional - for performance)
export const intelligenceReports = pgTable('intelligence_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  gameId: uuid('game_id')
    .references(() => games.id, { onDelete: 'cascade' })
    .notNull(),
  playerId: uuid('player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  targetPlayerId: uuid('target_player_id')
    .references(() => players.id, { onDelete: 'cascade' })
    .notNull(),
  
  // Cached intelligence data
  reportData: jsonb('report_data').notNull(), // full intelligence report
  generatedAt: timestamp('generated_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(), // reports expire after a few turns
});

// Relations
export const nationSelectionsRelations = relations(nationSelections, ({ one }) => ({
  game: one(games, {
    fields: [nationSelections.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [nationSelections.playerId],
    references: [players.id],
  }),
}));

export const diplomaticStatesRelations = relations(diplomaticStates, ({ one }) => ({
  game: one(games, {
    fields: [diplomaticStates.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [diplomaticStates.playerId],
    references: [players.id],
  }),
  targetPlayer: one(players, {
    fields: [diplomaticStates.targetPlayerId],
    references: [players.id],
  }),
}));

export const intelligenceReportsRelations = relations(intelligenceReports, ({ one }) => ({
  game: one(games, {
    fields: [intelligenceReports.gameId],
    references: [games.id],
  }),
  player: one(players, {
    fields: [intelligenceReports.playerId],
    references: [players.id],
  }),
  targetPlayer: one(players, {
    fields: [intelligenceReports.targetPlayerId],
    references: [players.id],
  }),
}));

// Type exports
export type NationSelection = typeof nationSelections.$inferSelect;
export type NewNationSelection = typeof nationSelections.$inferInsert;
export type DiplomaticState = typeof diplomaticStates.$inferSelect;
export type NewDiplomaticState = typeof diplomaticStates.$inferInsert;
export type IntelligenceReport = typeof intelligenceReports.$inferSelect;
export type NewIntelligenceReport = typeof intelligenceReports.$inferInsert;