import { relations } from "drizzle-orm/relations";
import { users, games, barbarianTribes, cities, players, disasters, gameTurns, governmentChanges, units, playerTechs, research, playerPolicies, randomEvents, turnPhases, playerTurnStatus, turnEvents, turnMapChanges } from "./schema";

export const gamesRelations = relations(games, ({one, many}) => ({
	user: one(users, {
		fields: [games.hostId],
		references: [users.id]
	}),
	barbarianTribes: many(barbarianTribes),
	cities: many(cities),
	players: many(players),
	disasters: many(disasters),
	gameTurns: many(gameTurns),
	governmentChanges: many(governmentChanges),
	units: many(units),
	playerTechs: many(playerTechs),
	research: many(research),
	playerPolicies: many(playerPolicies),
	randomEvents: many(randomEvents),
	turnPhases: many(turnPhases),
	playerTurnStatuses: many(playerTurnStatus),
	turnEvents: many(turnEvents),
	turnMapChanges: many(turnMapChanges),
}));

export const usersRelations = relations(users, ({many}) => ({
	games: many(games),
	players: many(players),
}));

export const barbarianTribesRelations = relations(barbarianTribes, ({one}) => ({
	game: one(games, {
		fields: [barbarianTribes.gameId],
		references: [games.id]
	}),
}));

export const citiesRelations = relations(cities, ({one, many}) => ({
	game: one(games, {
		fields: [cities.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [cities.playerId],
		references: [players.id]
	}),
	disasters: many(disasters),
}));

export const playersRelations = relations(players, ({one, many}) => ({
	cities: many(cities),
	game: one(games, {
		fields: [players.gameId],
		references: [games.id]
	}),
	user: one(users, {
		fields: [players.userId],
		references: [users.id]
	}),
	governmentChanges: many(governmentChanges),
	units: many(units),
	playerTechs: many(playerTechs),
	research: many(research),
	playerPolicies: many(playerPolicies),
	playerTurnStatuses: many(playerTurnStatus),
	turnEvents: many(turnEvents),
	turnMapChanges: many(turnMapChanges),
}));

export const disastersRelations = relations(disasters, ({one}) => ({
	game: one(games, {
		fields: [disasters.gameId],
		references: [games.id]
	}),
	city: one(cities, {
		fields: [disasters.cityId],
		references: [cities.id]
	}),
}));

export const gameTurnsRelations = relations(gameTurns, ({one, many}) => ({
	game: one(games, {
		fields: [gameTurns.gameId],
		references: [games.id]
	}),
	turnPhases: many(turnPhases),
	playerTurnStatuses: many(playerTurnStatus),
	turnEvents: many(turnEvents),
	turnMapChanges: many(turnMapChanges),
}));

export const governmentChangesRelations = relations(governmentChanges, ({one}) => ({
	game: one(games, {
		fields: [governmentChanges.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [governmentChanges.playerId],
		references: [players.id]
	}),
}));

export const unitsRelations = relations(units, ({one}) => ({
	game: one(games, {
		fields: [units.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [units.playerId],
		references: [players.id]
	}),
}));

export const playerTechsRelations = relations(playerTechs, ({one}) => ({
	game: one(games, {
		fields: [playerTechs.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [playerTechs.playerId],
		references: [players.id]
	}),
}));

export const researchRelations = relations(research, ({one}) => ({
	game: one(games, {
		fields: [research.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [research.playerId],
		references: [players.id]
	}),
}));

export const playerPoliciesRelations = relations(playerPolicies, ({one}) => ({
	game: one(games, {
		fields: [playerPolicies.gameId],
		references: [games.id]
	}),
	player: one(players, {
		fields: [playerPolicies.playerId],
		references: [players.id]
	}),
}));

export const randomEventsRelations = relations(randomEvents, ({one}) => ({
	game: one(games, {
		fields: [randomEvents.gameId],
		references: [games.id]
	}),
}));

export const turnPhasesRelations = relations(turnPhases, ({one}) => ({
	game: one(games, {
		fields: [turnPhases.gameId],
		references: [games.id]
	}),
	gameTurn: one(gameTurns, {
		fields: [turnPhases.turnId],
		references: [gameTurns.id]
	}),
}));

export const playerTurnStatusRelations = relations(playerTurnStatus, ({one}) => ({
	game: one(games, {
		fields: [playerTurnStatus.gameId],
		references: [games.id]
	}),
	gameTurn: one(gameTurns, {
		fields: [playerTurnStatus.turnId],
		references: [gameTurns.id]
	}),
	player: one(players, {
		fields: [playerTurnStatus.playerId],
		references: [players.id]
	}),
}));

export const turnEventsRelations = relations(turnEvents, ({one}) => ({
	game: one(games, {
		fields: [turnEvents.gameId],
		references: [games.id]
	}),
	gameTurn: one(gameTurns, {
		fields: [turnEvents.turnId],
		references: [gameTurns.id]
	}),
	player: one(players, {
		fields: [turnEvents.playerId],
		references: [players.id]
	}),
}));

export const turnMapChangesRelations = relations(turnMapChanges, ({one}) => ({
	game: one(games, {
		fields: [turnMapChanges.gameId],
		references: [games.id]
	}),
	gameTurn: one(gameTurns, {
		fields: [turnMapChanges.turnId],
		references: [gameTurns.id]
	}),
	player: one(players, {
		fields: [turnMapChanges.playerId],
		references: [players.id]
	}),
}));