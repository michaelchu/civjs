-- Migration: Culture-Border Integration
-- Adds missing columns and renames culture columns to history
-- This migration brings the database in sync with the culture system implementation

-- Add missing history_interest_pml column to games table
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "history_interest_pml" integer DEFAULT 0 NOT NULL;

-- Rename culture columns to history for consistency with Freeciv culture system
-- Only rename if the old columns exist and new ones don't
DO $$ 
BEGIN
    -- Rename culture_per_turn to history in cities table
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cities' AND column_name = 'culture_per_turn')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cities' AND column_name = 'history') THEN
        ALTER TABLE "cities" RENAME COLUMN "culture_per_turn" TO "history";
    END IF;
    
    -- Rename culture to history in players table  
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'culture')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'history') THEN
        ALTER TABLE "players" RENAME COLUMN "culture" TO "history";
    END IF;
END $$;