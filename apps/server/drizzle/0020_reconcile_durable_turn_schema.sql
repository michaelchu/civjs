CREATE TABLE IF NOT EXISTS "turn_actions" (
	"id" varchar(100) NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"turn_number" integer NOT NULL,
	"action_type" varchar(50) NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"error_message" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "turn_actions_game_action_pk" PRIMARY KEY("game_id","turn_number","id")
);
--> statement-breakpoint
ALTER TABLE "game_turns" ADD COLUMN IF NOT EXISTS "processing_owner" varchar(100);
--> statement-breakpoint
ALTER TABLE "game_turns" ADD COLUMN IF NOT EXISTS "processing_lease_expires_at" timestamp;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'turn_actions_game_id_games_id_fk'
	) THEN
		ALTER TABLE "turn_actions"
			ADD CONSTRAINT "turn_actions_game_id_games_id_fk"
			FOREIGN KEY ("game_id") REFERENCES "public"."games"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'turn_actions_player_id_players_id_fk'
	) THEN
		ALTER TABLE "turn_actions"
			ADD CONSTRAINT "turn_actions_player_id_players_id_fk"
			FOREIGN KEY ("player_id") REFERENCES "public"."players"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_actions_game_turn_idx"
	ON "turn_actions" USING btree ("game_id","turn_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "turn_actions_player_status_idx"
	ON "turn_actions" USING btree ("player_id","status");
--> statement-breakpoint
WITH "ranked_game_turns" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "game_id", "turn_number"
			ORDER BY
				CASE WHEN "ended_at" IS NOT NULL AND "state_snapshot" IS NOT NULL THEN 0 ELSE 1 END,
				"ended_at" DESC NULLS LAST,
				"id"
		) AS "duplicate_rank"
	FROM "game_turns"
)
DELETE FROM "game_turns"
WHERE "id" IN (
	SELECT "id"
	FROM "ranked_game_turns"
	WHERE "duplicate_rank" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "game_turns_game_turn_idx"
	ON "game_turns" USING btree ("game_id","turn_number");
--> statement-breakpoint
WITH "ranked_turn_phases" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "turn_id", "phase"
			ORDER BY
				CASE WHEN "status" = 'completed' AND "success" = true THEN 0 ELSE 1 END,
				"completed_at" DESC NULLS LAST,
				"id"
		) AS "duplicate_rank"
	FROM "turn_phases"
)
DELETE FROM "turn_phases"
WHERE "id" IN (
	SELECT "id"
	FROM "ranked_turn_phases"
	WHERE "duplicate_rank" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "turn_phases_turn_phase_idx"
	ON "turn_phases" USING btree ("turn_id","phase");
