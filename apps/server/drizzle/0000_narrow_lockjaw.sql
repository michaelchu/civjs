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
	"max_players" integer DEFAULT 8 NOT NULL,
	"map_width" integer DEFAULT 80 NOT NULL,
	"map_height" integer DEFAULT 50 NOT NULL,
	"victory_conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruleset" varchar(50) DEFAULT 'classic' NOT NULL,
	"map_seed" varchar(100),
	"map_data" jsonb,
	"turn_time_limit" integer,
	"turn_started_at" timestamp,
	"paused_at" timestamp,
	"started_at" timestamp,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"game_state" jsonb
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
	"user_id" uuid NOT NULL,
	"player_number" integer NOT NULL,
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
	"culture" integer DEFAULT 0 NOT NULL,
	"faith" integer DEFAULT 0 NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_research" varchar(50),
	"research_progress" integer DEFAULT 0 NOT NULL,
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
	"home_city_id" uuid,
	"created_turn" integer NOT NULL,
	"last_action_turn" integer
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_turns" ADD CONSTRAINT "game_turns_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;