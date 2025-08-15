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
    -- Create settler at starting position
    INSERT INTO public.units (game_id, player_id, type, x, y)
    VALUES (p_game_id, p_player_id, 'settler', p_start_x, p_start_y);
    
    -- Create warrior adjacent to settler
    INSERT INTO public.units (game_id, player_id, type, x, y)
    VALUES (p_game_id, p_player_id, 'warrior', p_start_x + 1, p_start_y);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to initialize player state when joining a game
CREATE OR REPLACE FUNCTION public.initialize_player_state(
    p_game_id UUID,
    p_player_id UUID
)
RETURNS void AS $$
BEGIN
    INSERT INTO public.player_state (game_id, player_id, gold, science_per_turn, culture_per_turn, happiness)
    VALUES (p_game_id, p_player_id, 0, 1, 1, 5);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to start a game (generate map, place starting units)
CREATE OR REPLACE FUNCTION public.start_game(p_game_id UUID)
RETURNS void AS $$
DECLARE
    game_record RECORD;
    player_record RECORD;
    map_width INTEGER;
    map_height INTEGER;
    start_positions INTEGER[][] := ARRAY[[5,5], [35,35], [5,35], [35,5], [20,20], [10,25]];
    position_index INTEGER := 1;
BEGIN
    -- Get game settings
    SELECT * INTO game_record FROM public.games WHERE id = p_game_id;
    
    -- Determine map size
    CASE game_record.settings->>'mapSize'
        WHEN 'small' THEN
            map_width := 40;
            map_height := 40;
        WHEN 'medium' THEN
            map_width := 60;
            map_height := 60;
        WHEN 'large' THEN
            map_width := 80;
            map_height := 80;
        ELSE
            map_width := 40;
            map_height := 40;
    END CASE;
    
    -- Generate basic map (for now, just grassland - we'll improve this later)
    INSERT INTO public.map_tiles (game_id, x, y, terrain)
    SELECT p_game_id, x, y, 'grassland'
    FROM generate_series(0, map_width-1) x
    CROSS JOIN generate_series(0, map_height-1) y;
    
    -- Initialize each player
    FOR player_record IN 
        SELECT player_id, turn_order 
        FROM public.game_players 
        WHERE game_id = p_game_id 
        ORDER BY turn_order
    LOOP
        -- Initialize player state
        PERFORM public.initialize_player_state(p_game_id, player_record.player_id);
        
        -- Create starting units at designated positions
        PERFORM public.create_starting_units(
            p_game_id, 
            player_record.player_id,
            start_positions[position_index][1],
            start_positions[position_index][2]
        );
        
        position_index := position_index + 1;
    END LOOP;
    
    -- Update game status to active
    UPDATE public.games 
    SET status = 'active', 
        current_player_id = (
            SELECT player_id 
            FROM public.game_players 
            WHERE game_id = p_game_id 
            ORDER BY turn_order 
            LIMIT 1
        )
    WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
