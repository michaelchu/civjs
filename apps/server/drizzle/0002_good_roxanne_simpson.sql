-- Add nation column as nullable first
ALTER TABLE "players" ADD COLUMN "nation" varchar(50);

-- Update existing players with default nation
UPDATE "players" SET "nation" = 'american' WHERE "nation" IS NULL;

-- Now make the column NOT NULL
ALTER TABLE "players" ALTER COLUMN "nation" SET NOT NULL;