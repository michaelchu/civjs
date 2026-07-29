UPDATE "players"
SET "spaceship_state" = '{"structurals":0,"components":0,"modules":0}'::jsonb
WHERE "spaceship_state" = '{}'::jsonb;

ALTER TABLE "players"
ALTER COLUMN "spaceship_state"
SET DEFAULT '{"structurals":0,"components":0,"modules":0}'::jsonb;
