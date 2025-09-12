-- Fix for missing columns in Railway production database
-- This script is safe to run multiple times (uses IF NOT EXISTS)

-- Add missing history column to cities table if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'cities' AND column_name = 'history') THEN
        ALTER TABLE cities ADD COLUMN history integer DEFAULT 0 NOT NULL;
        RAISE NOTICE 'Added history column to cities table';
    ELSE
        RAISE NOTICE 'Column history already exists in cities table';
    END IF;
END $$;

-- Add missing history_interest_pml column to games table if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'games' AND column_name = 'history_interest_pml') THEN
        ALTER TABLE games ADD COLUMN history_interest_pml integer DEFAULT 0 NOT NULL;
        RAISE NOTICE 'Added history_interest_pml column to games table';
    ELSE
        RAISE NOTICE 'Column history_interest_pml already exists in games table';
    END IF;
END $$;

-- Add missing culture_per_turn column to cities table if it doesn't exist  
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'cities' AND column_name = 'culture_per_turn') THEN
        ALTER TABLE cities ADD COLUMN culture_per_turn integer DEFAULT 0 NOT NULL;
        RAISE NOTICE 'Added culture_per_turn column to cities table';
    ELSE
        RAISE NOTICE 'Column culture_per_turn already exists in cities table';
    END IF;
END $$;

-- Verify columns were added
SELECT 
    table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name IN ('cities', 'games') 
AND column_name IN ('history', 'history_interest_pml', 'culture_per_turn')
ORDER BY table_name, column_name;