CREATE TABLE "barbarian_tribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"spawn_turn" integer NOT NULL,
	"spawn_location" jsonb NOT NULL,
	"unit_ids" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_turn" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"population" integer DEFAULT 1 NOT NULL,
	"food" integer DEFAULT 0 NOT NULL,
	"food_per_turn" integer DEFAULT 2 NOT NULL,
	"production" integer DEFAULT 0 NOT NULL,
	"production_per_turn" integer DEFAULT 1 NOT NULL,
	"current_production" varchar(100),
	"production_queue" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gold_per_turn" integer DEFAULT 0 NOT NULL,
	"science_per_turn" integer DEFAULT 0 NOT NULL,
	"culture_per_turn" integer DEFAULT 0 NOT NULL,
	"faith_per_turn" integer DEFAULT 0 NOT NULL,
	"history" integer DEFAULT 0 NOT NULL,
	"buildings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"worked_tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"specialists" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"happiness" integer DEFAULT 0 NOT NULL,
	"health" integer DEFAULT 100 NOT NULL,
	"is_capital" boolean DEFAULT false NOT NULL,
	"is_puppet" boolean DEFAULT false NOT NULL,
	"is_occupied" boolean DEFAULT false NOT NULL,
	"defense_strength" integer DEFAULT 1 NOT NULL,
	"walls_level" integer DEFAULT 0 NOT NULL,
	"founded_turn" integer NOT NULL,
	"captured_turn" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disasters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"city_name" text NOT NULL,
	"type" text NOT NULL,
	"severity" integer NOT NULL,
	"effects" jsonb NOT NULL,
	"turn" integer NOT NULL,
	"year" integer NOT NULL,
	"message" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"year" integer NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"player_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"statistics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_snapshot" jsonb,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"duration" integer
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"host_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'waiting' NOT NULL,
	"current_turn" integer DEFAULT 0 NOT NULL,
	"turn_phase" varchar(20) DEFAULT 'movement' NOT NULL,
	"game_type" varchar(20) DEFAULT 'multiplayer' NOT NULL,
	"max_players" integer DEFAULT 8 NOT NULL,
	"map_width" integer DEFAULT 80 NOT NULL,
	"map_height" integer DEFAULT 50 NOT NULL,
	"victory_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruleset" varchar(50) DEFAULT 'classic' NOT NULL,
	"history_interest_pml" integer DEFAULT 0 NOT NULL,
	"map_seed" varchar(100),
	"map_data" jsonb,
	"turn_time_limit" integer DEFAULT 300,
	"turn_started_at" timestamp,
	"paused_at" timestamp,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"game_state" jsonb
);
--> statement-breakpoint
CREATE TABLE "government_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"from_government" varchar(50),
	"to_government" varchar(50) NOT NULL,
	"change_turn" integer NOT NULL,
	"anarchy_turns" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"email" varchar(255),
	"password_hash" varchar(255),
	"is_guest" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"games_won" integer DEFAULT 0 NOT NULL,
	"total_score" integer DEFAULT 0 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid,
	"player_number" integer NOT NULL,
	"nation" varchar(50) NOT NULL,
	"civilization" varchar(50) NOT NULL,
	"leader_name" varchar(100) NOT NULL,
	"color" jsonb NOT NULL,
	"is_alive" boolean DEFAULT true NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"is_ready" boolean DEFAULT false NOT NULL,
	"has_ended_turn" boolean DEFAULT false NOT NULL,
	"connection_status" varchar(20) DEFAULT 'connected' NOT NULL,
	"gold" integer DEFAULT 0 NOT NULL,
	"science" integer DEFAULT 0 NOT NULL,
	"faith" integer DEFAULT 0 NOT NULL,
	"history" integer DEFAULT 0 NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_research" varchar(50),
	"research_progress" integer DEFAULT 0 NOT NULL,
	"government" varchar(50) DEFAULT 'despotism' NOT NULL,
	"revolution_turns" integer DEFAULT 0 NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"known_players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"diplomatic_relations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explored_tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visible_tiles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_action_at" timestamp DEFAULT now() NOT NULL,
	"eliminated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"unit_type" varchar(50) NOT NULL,
	"name" varchar(100),
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"health" integer DEFAULT 100 NOT NULL,
	"max_health" integer DEFAULT 100 NOT NULL,
	"attack_strength" integer NOT NULL,
	"defense_strength" integer NOT NULL,
	"ranged_strength" integer DEFAULT 0 NOT NULL,
	"movement_points" numeric(10, 2) NOT NULL,
	"max_movement_points" numeric(10, 2) NOT NULL,
	"experience" integer DEFAULT 0 NOT NULL,
	"veteran_level" integer DEFAULT 0 NOT NULL,
	"promotions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"orders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_order" varchar(50),
	"destination" jsonb,
	"is_embarked" boolean DEFAULT false NOT NULL,
	"is_fortified" boolean DEFAULT false NOT NULL,
	"is_automated" boolean DEFAULT false NOT NULL,
	"can_move" boolean DEFAULT true NOT NULL,
	"cargo_units" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"transported_by" uuid,
	"home_city_id" uuid,
	"created_turn" integer NOT NULL,
	"last_action_turn" integer
);
--> statement-breakpoint
CREATE TABLE "player_techs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"tech_id" varchar(50) NOT NULL,
	"researched_turn" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"current_tech" varchar(50),
	"tech_goal" varchar(50),
	"bulbs_accumulated" integer DEFAULT 0,
	"bulbs_last_turn" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"policy_id" varchar(50) NOT NULL,
	"current_value" integer NOT NULL,
	"target_value" integer NOT NULL,
	"adopted_turn" integer NOT NULL,
	"last_changed_turn" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "random_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"phase" text NOT NULL,
	"turn" integer NOT NULL,
	"year" integer NOT NULL,
	"success" boolean NOT NULL,
	"players_affected" jsonb NOT NULL,
	"details" jsonb NOT NULL,
	"timestamp" timestamp NOT NULL,
	"duration" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"phase" varchar(50) NOT NULL,
	"phase_order" integer NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"duration" integer,
	"success" boolean,
	"error_message" varchar(500),
	"phase_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"players_processed" integer DEFAULT 0 NOT NULL,
	"units_processed" integer DEFAULT 0 NOT NULL,
	"cities_processed" integer DEFAULT 0 NOT NULL,
	"actions_processed" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_turn_status" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"has_ended_turn" boolean DEFAULT false NOT NULL,
	"is_ready" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_ai" boolean DEFAULT false NOT NULL,
	"turn_started_at" timestamp,
	"turn_ended_at" timestamp,
	"total_turn_time" integer,
	"actions_count" integer DEFAULT 0 NOT NULL,
	"units_moved_count" integer DEFAULT 0 NOT NULL,
	"cities_managed" integer DEFAULT 0 NOT NULL,
	"end_reason" varchar(50),
	"player_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_processing_time" integer,
	"ai_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turn_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"player_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"event_category" varchar(30) NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"turn_phase" varchar(50),
	"title" varchar(200) NOT NULL,
	"description" varchar(1000),
	"event_data" jsonb NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"is_achievement" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" varchar(500),
	"achievement_id" varchar(50),
	"achievement_unlocked" boolean DEFAULT false NOT NULL,
	"location_x" integer,
	"location_y" integer,
	"related_unit_id" uuid,
	"related_city_id" uuid,
	"related_player_id" uuid
);
--> statement-breakpoint
CREATE TABLE "turn_map_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"player_id" uuid,
	"tile_x" integer NOT NULL,
	"tile_y" integer NOT NULL,
	"change_type" varchar(50) NOT NULL,
	"change_action" varchar(20) NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"turn_phase" varchar(50),
	"previous_state" jsonb,
	"new_state" jsonb NOT NULL,
	"change_reason" varchar(100),
	"change_source" varchar(50),
	"affected_players" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_change" boolean DEFAULT false NOT NULL,
	"border_change" boolean DEFAULT false NOT NULL,
	"related_city_id" uuid,
	"related_unit_id" uuid,
	"priority" integer DEFAULT 5 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "barbarian_tribes" ADD CONSTRAINT "barbarian_tribes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disasters" ADD CONSTRAINT "disasters_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disasters" ADD CONSTRAINT "disasters_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "game_turns_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "government_changes" ADD CONSTRAINT "government_changes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "government_changes" ADD CONSTRAINT "government_changes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_techs" ADD CONSTRAINT "player_techs_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_techs" ADD CONSTRAINT "player_techs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research" ADD CONSTRAINT "research_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_policies" ADD CONSTRAINT "player_policies_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_policies" ADD CONSTRAINT "player_policies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "random_events" ADD CONSTRAINT "random_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_phases" ADD CONSTRAINT "turn_phases_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_phases" ADD CONSTRAINT "turn_phases_turn_id_game_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."game_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_turn_status" ADD CONSTRAINT "player_turn_status_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_turn_status" ADD CONSTRAINT "player_turn_status_turn_id_game_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."game_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_turn_status" ADD CONSTRAINT "player_turn_status_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_events" ADD CONSTRAINT "turn_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_events" ADD CONSTRAINT "turn_events_turn_id_game_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."game_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_events" ADD CONSTRAINT "turn_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_map_changes" ADD CONSTRAINT "turn_map_changes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_map_changes" ADD CONSTRAINT "turn_map_changes_turn_id_game_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."game_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_map_changes" ADD CONSTRAINT "turn_map_changes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;