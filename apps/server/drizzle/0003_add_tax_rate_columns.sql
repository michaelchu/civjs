ALTER TABLE "players" ADD COLUMN "tax_rate" integer DEFAULT 50 NOT NULL;
ALTER TABLE "players" ADD COLUMN "luxury_rate" integer DEFAULT 20 NOT NULL;
ALTER TABLE "players" ADD COLUMN "science_rate" integer DEFAULT 30 NOT NULL;