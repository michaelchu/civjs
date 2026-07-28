ALTER TABLE "players"
ADD COLUMN "tile_last_seen" jsonb DEFAULT '{}'::jsonb NOT NULL;
