ALTER TABLE "units"
  ADD COLUMN IF NOT EXISTS "automation_mode" varchar(20);

ALTER TABLE "units"
  ADD COLUMN IF NOT EXISTS "automation_task" jsonb;

UPDATE "units"
SET "automation_mode" = CASE
  WHEN "current_order" = 'autoExplore' THEN 'explore'
  WHEN "current_order" = 'autoSettler' THEN 'worker'
  WHEN "orders" @> '[{"type":"autoSettler"}]'::jsonb THEN 'worker'
  WHEN "orders" @> '[{"type":"autoExplore"}]'::jsonb THEN 'explore'
  ELSE NULL
END
WHERE "automation_mode" IS NULL
  AND "is_automated" = true;
