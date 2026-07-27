ALTER TABLE "cities" ADD COLUMN "trade_routes" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "cities" ADD COLUMN "governor" jsonb;
