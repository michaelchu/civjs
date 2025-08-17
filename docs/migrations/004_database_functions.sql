-- Database Functions for CivJS
-- Run this AFTER running schema.sql and rls-policies.sql

-- Function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, username, display_name)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'username', 'Player' || substr(NEW.id::text, 1, 8)),
        COALESCE(NEW.raw_user_meta_data->>'display_name', 'Player' || substr(NEW.id::text, 1, 8))
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile when user signs up
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to generate starting units for a player
CREATE OR REPLACE FUNCTION public.create_starting_units(
    p_game_id UUID,
    p_player_id UUID,
    p_start_x INTEGER,
    p_start_y INTEGER
)
RETURNS void AS $$
BEGIN
    -- Only create units if player doesn't already have any
    IF NOT EXISTS (SELECT 1 FROM public.units WHERE game_id = p_game_id AND player_id = p_player_id) THEN
        -- Create settler at starting position
        INSERT INTO public.units (game_id, player_id, type, x, y)
        VALUES (p_game_id, p_player_id, 'settler', p_start_x, p_start_y);
        
        -- Create warrior adjacent to settler
        INSERT INTO public.units (game_id, player_id, type, x, y)
        VALUES (p_game_id, p_player_id, 'warrior', p_start_x + 1, p_start_y);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to initialize player state when joining a game
CREATE OR REPLACE FUNCTION public.initialize_player_state(
    p_game_id UUID,
    p_player_id UUID
)
RETURNS void AS $$
BEGIN
    -- Only create player state if it doesn't already exist
    INSERT INTO public.player_state (game_id, player_id, gold, science_per_turn, culture_per_turn, happiness)
    SELECT p_game_id, p_player_id, 0, 1, 1, 5
    WHERE NOT EXISTS (
        SELECT 1 FROM public.player_state ps 
        WHERE ps.game_id = p_game_id AND ps.player_id = p_player_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Simplified function to update game status only
-- Map generation is now handled by the server-side TypeScript code
CREATE OR REPLACE FUNCTION public.start_game(p_game_id UUID)
RETURNS void AS $$
BEGIN
    -- Simply update game status to active
    -- All map generation and player initialization is handled by the server
    UPDATE public.games 
    SET status = 'active'
    WHERE id = p_game_id AND status = 'waiting';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
