-- Migration: Add missing culture-related columns
-- This adds the columns that should have been in the initial migration

-- Add missing history column to players table
ALTER TABLE "players" ADD COLUMN "history" integer DEFAULT 0 NOT NULL;

-- Add missing history_interest_pml column to games table (if not exists)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'games' AND column_name = 'history_interest_pml') THEN
        ALTER TABLE "games" ADD COLUMN "history_interest_pml" integer DEFAULT 0 NOT NULL;
    END IF;
END $$;

-- Add missing history column to cities table (if not exists)  
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'cities' AND column_name = 'history') THEN
        ALTER TABLE "cities" ADD COLUMN "history" integer DEFAULT 0 NOT NULL;
    END IF;
END $$;