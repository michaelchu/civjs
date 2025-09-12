-- Add culture history column to cities table
ALTER TABLE "cities" ADD COLUMN "history" integer DEFAULT 0 NOT NULL;

-- Add history_interest_pml column to games table  
ALTER TABLE "games" ADD COLUMN "history_interest_pml" integer DEFAULT 0 NOT NULL;