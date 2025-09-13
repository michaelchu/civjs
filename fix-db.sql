-- Fix missing history_interest_pml column in games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS history_interest_pml integer DEFAULT 0 NOT NULL;

-- Rename culture columns to history if they exist
ALTER TABLE cities RENAME COLUMN culture_per_turn TO history;
ALTER TABLE players RENAME COLUMN culture TO history;

-- Verify the changes
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'games' AND column_name = 'history_interest_pml';