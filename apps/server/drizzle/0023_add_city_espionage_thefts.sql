ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "espionage_thefts" jsonb DEFAULT '{}'::jsonb NOT NULL;
