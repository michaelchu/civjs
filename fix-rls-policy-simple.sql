-- Fix for infinite recursion in RLS policy for game_players
-- Execute this script in your Supabase SQL Editor
-- This version skips test user creation to avoid auth.users dependency

-- Step 1: Drop the existing problematic policy
DROP POLICY IF EXISTS "Players can view game participants" ON public.game_players;

-- Step 2: Create the new, fixed policy
-- This allows players to:
-- 1. View their own game_player records (player_id = auth.uid())
-- 2. View all participants in games they created (via games.created_by)
CREATE POLICY "Players can view game participants" ON public.game_players FOR SELECT 
    USING (
        player_id = auth.uid() OR 
        EXISTS (
            SELECT 1 FROM public.games g 
            WHERE g.id = game_players.game_id 
            AND g.created_by = auth.uid()
        )
    );

-- Verify the policy was created successfully
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE tablename = 'game_players' 
AND policyname = 'Players can view game participants';
