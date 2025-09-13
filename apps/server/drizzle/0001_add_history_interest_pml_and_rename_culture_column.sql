-- Add history_interest_pml column to games table
ALTER TABLE "games" ADD COLUMN "history_interest_pml" integer DEFAULT 0 NOT NULL;

-- Rename culture_per_turn to history in cities table  
ALTER TABLE "cities" RENAME COLUMN "culture_per_turn" TO "history";