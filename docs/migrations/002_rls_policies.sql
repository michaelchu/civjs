-- Row Level Security Policies for CivJS
-- Run this AFTER running the schema.sql

-- Profiles policies
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Games policies
CREATE POLICY "Anyone can view active games" ON public.games FOR SELECT USING (status IN ('waiting', 'active'));
CREATE POLICY "Users can create games" ON public.games FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Game creator can update game" ON public.games FOR UPDATE USING (auth.uid() = created_by);

-- Game players policies
CREATE POLICY "Players can view game participants" ON public.game_players FOR SELECT 
    USING (
        player_id = auth.uid() OR 
        EXISTS (
            SELECT 1 FROM public.games g 
            WHERE g.id = game_players.game_id 
            AND g.created_by = auth.uid()
        )
    );
CREATE POLICY "Users can join games" ON public.game_players FOR INSERT 
    WITH CHECK (auth.uid() = player_id);
CREATE POLICY "Players can leave games" ON public.game_players FOR DELETE 
    USING (auth.uid() = player_id);

-- Map tiles policies (players can see tiles in their games)
CREATE POLICY "Players can view map tiles" ON public.map_tiles FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.game_players gp 
            WHERE gp.game_id = map_tiles.game_id 
            AND gp.player_id = auth.uid()
        )
    );
CREATE POLICY "System can manage map tiles" ON public.map_tiles FOR ALL 
    USING (current_setting('role') = 'service_role');

-- Cities policies
CREATE POLICY "Players can view cities in their games" ON public.cities FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.game_players gp 
            WHERE gp.game_id = cities.game_id 
            AND gp.player_id = auth.uid()
        )
    );
CREATE POLICY "Players can manage their own cities" ON public.cities FOR ALL 
    USING (auth.uid() = player_id);

-- Units policies
CREATE POLICY "Players can view units in their games" ON public.units FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.game_players gp 
            WHERE gp.game_id = units.game_id 
            AND gp.player_id = auth.uid()
        )
    );
CREATE POLICY "Players can manage their own units" ON public.units FOR ALL 
    USING (auth.uid() = player_id);

-- Player state policies
CREATE POLICY "Players can view their own state" ON public.player_state FOR SELECT 
    USING (auth.uid() = player_id);
CREATE POLICY "Players can update their own state" ON public.player_state FOR ALL 
    USING (auth.uid() = player_id);

-- Research policies
CREATE POLICY "Players can view their own research" ON public.player_research FOR SELECT 
    USING (auth.uid() = player_id);
CREATE POLICY "Players can update their own research" ON public.player_research FOR ALL 
    USING (auth.uid() = player_id);

-- Game events policies (read-only for players)
CREATE POLICY "Players can view events from their games" ON public.game_events FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.game_players gp 
            WHERE gp.game_id = game_events.game_id 
            AND gp.player_id = auth.uid()
        )
    );
CREATE POLICY "System can insert game events" ON public.game_events FOR INSERT 
    WITH CHECK (current_setting('role') = 'service_role');
