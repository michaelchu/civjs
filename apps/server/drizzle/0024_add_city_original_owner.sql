ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "original_owner_id" uuid REFERENCES "players"("id") ON DELETE SET NULL;

UPDATE "cities"
SET "original_owner_id" = "player_id"
WHERE "original_owner_id" IS NULL;
