ALTER TABLE "units"
  ADD COLUMN IF NOT EXISTS "moved_this_turn" boolean DEFAULT false NOT NULL;
