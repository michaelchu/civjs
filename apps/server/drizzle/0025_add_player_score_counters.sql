ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "units_built" integer DEFAULT 0 NOT NULL;

ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "units_killed" integer DEFAULT 0 NOT NULL;

ALTER TABLE "players"
  ADD COLUMN IF NOT EXISTS "units_lost" integer DEFAULT 0 NOT NULL;
