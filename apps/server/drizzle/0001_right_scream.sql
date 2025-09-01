ALTER TABLE "players" ADD COLUMN "government" varchar(50) DEFAULT 'despotism' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "revolution_turns" integer DEFAULT 0 NOT NULL;