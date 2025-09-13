import { pgTable, foreignKey, uuid, varchar, integer, jsonb, timestamp, text, boolean, unique, numeric } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const games = pgTable("games", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	hostId: uuid("host_id").notNull(),
	status: varchar({ length: 20 }).default('waiting').notNull(),
	currentTurn: integer("current_turn").default(0).notNull(),
	turnPhase: varchar("turn_phase", { length: 20 }).default('movement').notNull(),
	gameType: varchar("game_type", { length: 20 }).default('multiplayer').notNull(),
	maxPlayers: integer("max_players").default(8).notNull(),
	mapWidth: integer("map_width").default(80).notNull(),
	mapHeight: integer("map_height").default(50).notNull(),
	victoryConditions: jsonb("victory_conditions").default([]).notNull(),
	ruleset: varchar({ length: 50 }).default('classic').notNull(),
	mapSeed: varchar("map_seed", { length: 100 }),
	mapData: jsonb("map_data"),
	turnTimeLimit: integer("turn_time_limit").default(300),
	turnStartedAt: timestamp("turn_started_at", { mode: 'string' }),
	pausedAt: timestamp("paused_at", { mode: 'string' }),
	startedAt: timestamp("started_at", { mode: 'string' }),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	gameState: jsonb("game_state"),
	historyInterestPml: integer("history_interest_pml").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.hostId],
			foreignColumns: [users.id],
			name: "games_host_id_users_id_fk"
		}),
]);

export const barbarianTribes = pgTable("barbarian_tribes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: text("player_id").notNull(),
	name: text().notNull(),
	type: text().notNull(),
	spawnTurn: integer("spawn_turn").notNull(),
	spawnLocation: jsonb("spawn_location").notNull(),
	unitIds: jsonb("unit_ids").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	lastSeenTurn: integer("last_seen_turn").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "barbarian_tribes_game_id_games_id_fk"
		}),
]);

export const cities = pgTable("cities", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	name: varchar({ length: 100 }).notNull(),
	x: integer().notNull(),
	y: integer().notNull(),
	population: integer().default(1).notNull(),
	food: integer().default(0).notNull(),
	foodPerTurn: integer("food_per_turn").default(2).notNull(),
	production: integer().default(0).notNull(),
	productionPerTurn: integer("production_per_turn").default(1).notNull(),
	currentProduction: varchar("current_production", { length: 100 }),
	productionQueue: jsonb("production_queue").default([]).notNull(),
	goldPerTurn: integer("gold_per_turn").default(0).notNull(),
	sciencePerTurn: integer("science_per_turn").default(0).notNull(),
	culturePerTurn: integer("culture_per_turn").default(0).notNull(),
	faithPerTurn: integer("faith_per_turn").default(0).notNull(),
	buildings: jsonb().default([]).notNull(),
	workedTiles: jsonb("worked_tiles").default([]).notNull(),
	specialists: jsonb().default({}).notNull(),
	happiness: integer().default(0).notNull(),
	health: integer().default(100).notNull(),
	isCapital: boolean("is_capital").default(false).notNull(),
	isPuppet: boolean("is_puppet").default(false).notNull(),
	isOccupied: boolean("is_occupied").default(false).notNull(),
	defenseStrength: integer("defense_strength").default(1).notNull(),
	wallsLevel: integer("walls_level").default(0).notNull(),
	foundedTurn: integer("founded_turn").notNull(),
	capturedTurn: integer("captured_turn"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "cities_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "cities_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const players = pgTable("players", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	userId: uuid("user_id"),
	playerNumber: integer("player_number").notNull(),
	nation: varchar({ length: 50 }).notNull(),
	civilization: varchar({ length: 50 }).notNull(),
	leaderName: varchar("leader_name", { length: 100 }).notNull(),
	color: jsonb().notNull(),
	isAlive: boolean("is_alive").default(true).notNull(),
	isAi: boolean("is_ai").default(false).notNull(),
	isReady: boolean("is_ready").default(false).notNull(),
	hasEndedTurn: boolean("has_ended_turn").default(false).notNull(),
	connectionStatus: varchar("connection_status", { length: 20 }).default('connected').notNull(),
	gold: integer().default(0).notNull(),
	science: integer().default(0).notNull(),
	history: integer().default(0).notNull(),
	faith: integer().default(0).notNull(),
	technologies: jsonb().default([]).notNull(),
	currentResearch: varchar("current_research", { length: 50 }),
	researchProgress: integer("research_progress").default(0).notNull(),
	government: varchar({ length: 50 }).default('despotism').notNull(),
	revolutionTurns: integer("revolution_turns").default(0).notNull(),
	score: integer().default(0).notNull(),
	knownPlayers: jsonb("known_players").default([]).notNull(),
	diplomaticRelations: jsonb("diplomatic_relations").default({}).notNull(),
	exploredTiles: jsonb("explored_tiles").default([]).notNull(),
	visibleTiles: jsonb("visible_tiles").default([]).notNull(),
	joinedAt: timestamp("joined_at", { mode: 'string' }).defaultNow().notNull(),
	lastActionAt: timestamp("last_action_at", { mode: 'string' }).defaultNow().notNull(),
	eliminatedAt: timestamp("eliminated_at", { mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "players_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "players_user_id_users_id_fk"
		}),
]);

export const disasters = pgTable("disasters", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	cityId: uuid("city_id").notNull(),
	cityName: text("city_name").notNull(),
	type: text().notNull(),
	severity: integer().notNull(),
	effects: jsonb().notNull(),
	turn: integer().notNull(),
	year: integer().notNull(),
	message: text().notNull(),
	timestamp: timestamp({ mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "disasters_game_id_games_id_fk"
		}),
	foreignKey({
			columns: [table.cityId],
			foreignColumns: [cities.id],
			name: "disasters_city_id_cities_id_fk"
		}),
]);

export const gameTurns = pgTable("game_turns", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	turnNumber: integer("turn_number").notNull(),
	year: integer().notNull(),
	events: jsonb().default([]).notNull(),
	playerActions: jsonb("player_actions").default([]).notNull(),
	statistics: jsonb().default({}).notNull(),
	stateSnapshot: jsonb("state_snapshot"),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	endedAt: timestamp("ended_at", { mode: 'string' }),
	duration: integer(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "game_turns_game_id_games_id_fk"
		}).onDelete("cascade"),
]);

export const users = pgTable("users", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	username: varchar({ length: 32 }).notNull(),
	email: varchar({ length: 255 }),
	passwordHash: varchar("password_hash", { length: 255 }),
	isGuest: boolean("is_guest").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	lastSeen: timestamp("last_seen", { mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
	gamesPlayed: integer("games_played").default(0).notNull(),
	gamesWon: integer("games_won").default(0).notNull(),
	totalScore: integer("total_score").default(0).notNull(),
	settings: jsonb().default({}).notNull(),
}, (table) => [
	unique("users_username_unique").on(table.username),
	unique("users_email_unique").on(table.email),
]);

export const governmentChanges = pgTable("government_changes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	fromGovernment: varchar("from_government", { length: 50 }),
	toGovernment: varchar("to_government", { length: 50 }).notNull(),
	changeTurn: integer("change_turn").notNull(),
	anarchyTurns: integer("anarchy_turns").default(0).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "government_changes_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "government_changes_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const units = pgTable("units", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	unitType: varchar("unit_type", { length: 50 }).notNull(),
	name: varchar({ length: 100 }),
	x: integer().notNull(),
	y: integer().notNull(),
	health: integer().default(100).notNull(),
	maxHealth: integer("max_health").default(100).notNull(),
	attackStrength: integer("attack_strength").notNull(),
	defenseStrength: integer("defense_strength").notNull(),
	rangedStrength: integer("ranged_strength").default(0).notNull(),
	movementPoints: numeric("movement_points", { precision: 10, scale:  2 }).notNull(),
	maxMovementPoints: numeric("max_movement_points", { precision: 10, scale:  2 }).notNull(),
	experience: integer().default(0).notNull(),
	veteranLevel: integer("veteran_level").default(0).notNull(),
	promotions: jsonb().default([]).notNull(),
	orders: jsonb().default([]).notNull(),
	currentOrder: varchar("current_order", { length: 50 }),
	destination: jsonb(),
	isEmbarked: boolean("is_embarked").default(false).notNull(),
	isFortified: boolean("is_fortified").default(false).notNull(),
	isAutomated: boolean("is_automated").default(false).notNull(),
	canMove: boolean("can_move").default(true).notNull(),
	cargoUnits: jsonb("cargo_units").default([]).notNull(),
	transportedBy: uuid("transported_by"),
	homeCityId: uuid("home_city_id"),
	createdTurn: integer("created_turn").notNull(),
	lastActionTurn: integer("last_action_turn"),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "units_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "units_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const playerTechs = pgTable("player_techs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	techId: varchar("tech_id", { length: 50 }).notNull(),
	researchedTurn: integer("researched_turn").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "player_techs_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "player_techs_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const research = pgTable("research", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	currentTech: varchar("current_tech", { length: 50 }),
	techGoal: varchar("tech_goal", { length: 50 }),
	bulbsAccumulated: integer("bulbs_accumulated").default(0),
	bulbsLastTurn: integer("bulbs_last_turn").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "research_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "research_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const playerPolicies = pgTable("player_policies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	playerId: uuid("player_id").notNull(),
	policyId: varchar("policy_id", { length: 50 }).notNull(),
	currentValue: integer("current_value").notNull(),
	targetValue: integer("target_value").notNull(),
	adoptedTurn: integer("adopted_turn").notNull(),
	lastChangedTurn: integer("last_changed_turn").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "player_policies_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "player_policies_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const randomEvents = pgTable("random_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	eventType: text("event_type").notNull(),
	phase: text().notNull(),
	turn: integer().notNull(),
	year: integer().notNull(),
	success: boolean().notNull(),
	playersAffected: jsonb("players_affected").notNull(),
	details: jsonb().notNull(),
	timestamp: timestamp({ mode: 'string' }).notNull(),
	duration: integer(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "random_events_game_id_games_id_fk"
		}),
]);

export const turnPhases = pgTable("turn_phases", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	turnId: uuid("turn_id").notNull(),
	phase: varchar({ length: 50 }).notNull(),
	phaseOrder: integer("phase_order").notNull(),
	status: varchar({ length: 20 }).default('pending').notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	duration: integer(),
	success: boolean(),
	errorMessage: varchar("error_message", { length: 500 }),
	phaseData: jsonb("phase_data").default({}).notNull(),
	playersProcessed: integer("players_processed").default(0).notNull(),
	unitsProcessed: integer("units_processed").default(0).notNull(),
	citiesProcessed: integer("cities_processed").default(0).notNull(),
	actionsProcessed: integer("actions_processed").default(0).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "turn_phases_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.turnId],
			foreignColumns: [gameTurns.id],
			name: "turn_phases_turn_id_game_turns_id_fk"
		}).onDelete("cascade"),
]);

export const playerTurnStatus = pgTable("player_turn_status", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	turnId: uuid("turn_id").notNull(),
	playerId: uuid("player_id").notNull(),
	hasEndedTurn: boolean("has_ended_turn").default(false).notNull(),
	isReady: boolean("is_ready").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	isAi: boolean("is_ai").default(false).notNull(),
	turnStartedAt: timestamp("turn_started_at", { mode: 'string' }),
	turnEndedAt: timestamp("turn_ended_at", { mode: 'string' }),
	totalTurnTime: integer("total_turn_time"),
	actionsCount: integer("actions_count").default(0).notNull(),
	unitsMovedCount: integer("units_moved_count").default(0).notNull(),
	citiesManaged: integer("cities_managed").default(0).notNull(),
	endReason: varchar("end_reason", { length: 50 }),
	playerData: jsonb("player_data").default({}).notNull(),
	aiProcessingTime: integer("ai_processing_time"),
	aiDecisions: jsonb("ai_decisions").default({}).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "player_turn_status_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.turnId],
			foreignColumns: [gameTurns.id],
			name: "player_turn_status_turn_id_game_turns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "player_turn_status_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const turnEvents = pgTable("turn_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	turnId: uuid("turn_id").notNull(),
	playerId: uuid("player_id"),
	eventType: varchar("event_type", { length: 50 }).notNull(),
	eventCategory: varchar("event_category", { length: 30 }).notNull(),
	occurredAt: timestamp("occurred_at", { mode: 'string' }).notNull(),
	turnPhase: varchar("turn_phase", { length: 50 }),
	title: varchar({ length: 200 }).notNull(),
	description: varchar({ length: 1000 }),
	eventData: jsonb("event_data").notNull(),
	priority: integer().default(5).notNull(),
	isVisible: boolean("is_visible").default(true).notNull(),
	isAchievement: boolean("is_achievement").default(false).notNull(),
	status: varchar({ length: 20 }).default('completed').notNull(),
	attempts: integer().default(1).notNull(),
	lastError: varchar("last_error", { length: 500 }),
	achievementId: varchar("achievement_id", { length: 50 }),
	achievementUnlocked: boolean("achievement_unlocked").default(false).notNull(),
	locationX: integer("location_x"),
	locationY: integer("location_y"),
	relatedUnitId: uuid("related_unit_id"),
	relatedCityId: uuid("related_city_id"),
	relatedPlayerId: uuid("related_player_id"),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "turn_events_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.turnId],
			foreignColumns: [gameTurns.id],
			name: "turn_events_turn_id_game_turns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "turn_events_player_id_players_id_fk"
		}).onDelete("cascade"),
]);

export const turnMapChanges = pgTable("turn_map_changes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	gameId: uuid("game_id").notNull(),
	turnId: uuid("turn_id").notNull(),
	playerId: uuid("player_id"),
	tileX: integer("tile_x").notNull(),
	tileY: integer("tile_y").notNull(),
	changeType: varchar("change_type", { length: 50 }).notNull(),
	changeAction: varchar("change_action", { length: 20 }).notNull(),
	occurredAt: timestamp("occurred_at", { mode: 'string' }).notNull(),
	turnPhase: varchar("turn_phase", { length: 50 }),
	previousState: jsonb("previous_state"),
	newState: jsonb("new_state").notNull(),
	changeReason: varchar("change_reason", { length: 100 }),
	changeSource: varchar("change_source", { length: 50 }),
	affectedPlayers: jsonb("affected_players").default([]).notNull(),
	visibilityChange: boolean("visibility_change").default(false).notNull(),
	borderChange: boolean("border_change").default(false).notNull(),
	relatedCityId: uuid("related_city_id"),
	relatedUnitId: uuid("related_unit_id"),
	priority: integer().default(5).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.gameId],
			foreignColumns: [games.id],
			name: "turn_map_changes_game_id_games_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.turnId],
			foreignColumns: [gameTurns.id],
			name: "turn_map_changes_turn_id_game_turns_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.playerId],
			foreignColumns: [players.id],
			name: "turn_map_changes_player_id_players_id_fk"
		}).onDelete("cascade"),
]);
