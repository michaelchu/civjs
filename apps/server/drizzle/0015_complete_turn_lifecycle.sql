ALTER TABLE "games" ADD COLUMN "max_turns" integer DEFAULT 0 NOT NULL;
ALTER TABLE "games" ADD COLUMN "turn_deadline_at" timestamp;
ALTER TABLE "games" ADD COLUMN "paused_timer_seconds" integer;
ALTER TABLE "players" ADD COLUMN "has_conceded" boolean DEFAULT false NOT NULL;
ALTER TABLE "players" ADD COLUMN "is_winner" boolean DEFAULT false NOT NULL;
ALTER TABLE "players" ADD COLUMN "team_id" varchar(50);
ALTER TABLE "players" ADD COLUMN "spaceship_state" jsonb DEFAULT '{}'::jsonb NOT NULL;
