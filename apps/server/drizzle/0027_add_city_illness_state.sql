ALTER TABLE "cities"
  ADD COLUMN IF NOT EXISTS "illness" integer DEFAULT 0 NOT NULL;

ALTER TABLE "cities"
  ADD COLUMN IF NOT EXISTS "illness_trade" integer DEFAULT 0 NOT NULL;

ALTER TABLE "cities"
  ADD COLUMN IF NOT EXISTS "turn_plague" integer;
