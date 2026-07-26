ALTER TABLE "cities" ADD COLUMN "trade_per_turn" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "luxury_per_turn" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "pollution" integer DEFAULT 0 NOT NULL;
