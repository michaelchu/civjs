-- Migration 003: Add seed-based map generation
-- Replaces storing individual map_tiles with deterministic seeds
-- Date: 2025-01-17
-- Author: Claude (Freeciv Canvas Migration)

-- Create game_seeds table to replace map_tiles storage
CREATE TABLE IF NOT EXISTS public.game_seeds (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    game_id uuid NOT NULL,
    seed text NOT NULL,
    map_size character varying NOT NULL CHECK (map_size::text = ANY (ARRAY['small'::character varying, 'medium'::character varying, 'large'::character varying]::text[])),
    generation_params jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    
    CONSTRAINT game_seeds_pkey PRIMARY KEY (id),
    CONSTRAINT game_seeds_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE,
    -- Ensure one seed per game
    CONSTRAINT game_seeds_game_id_unique UNIQUE (game_id)
);

-- Create index for efficient game lookups
CREATE INDEX IF NOT EXISTS idx_game_seeds_game_id ON public.game_seeds(game_id);

-- Enable Row Level Security
ALTER TABLE public.game_seeds ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Anyone can read game seeds (public map data)
CREATE POLICY "Public read access on game_seeds" ON public.game_seeds
    FOR SELECT USING (true);

-- RLS Policy: Only game creators can insert seeds (when starting a game)
CREATE POLICY "Game creators can insert seeds" ON public.game_seeds
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.games 
            WHERE games.id = game_seeds.game_id 
            AND games.created_by = auth.uid()
        )
    );

-- Optional: Future fog of war table for exploration tracking
-- This enables storing only tiles that players have actually explored
CREATE TABLE IF NOT EXISTS public.explored_tiles (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    game_id uuid NOT NULL,
    player_id uuid NOT NULL,
    x integer NOT NULL,
    y integer NOT NULL,
    terrain_type character varying NOT NULL,
    discovered_at timestamp with time zone DEFAULT now(),
    visibility_level integer DEFAULT 1 CHECK (visibility_level >= 0 AND visibility_level <= 2), -- 0=hidden, 1=seen, 2=visible
    
    CONSTRAINT explored_tiles_pkey PRIMARY KEY (id),
    CONSTRAINT explored_tiles_game_id_fkey FOREIGN KEY (game_id) REFERENCES public.games(id) ON DELETE CASCADE,
    CONSTRAINT explored_tiles_player_id_fkey FOREIGN KEY (player_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Prevent duplicate exploration records
    CONSTRAINT explored_tiles_game_player_coords_unique UNIQUE (game_id, player_id, x, y)
);

-- Indexes for efficient fog of war queries
CREATE INDEX IF NOT EXISTS idx_explored_tiles_game_player ON public.explored_tiles(game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_explored_tiles_coords ON public.explored_tiles(game_id, x, y);

-- RLS for explored_tiles (players can only see their own exploration)
ALTER TABLE public.explored_tiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can manage their own exploration" ON public.explored_tiles
    FOR ALL USING (player_id = auth.uid());

-- Add helpful comments
COMMENT ON TABLE public.game_seeds IS 'Stores deterministic seeds for procedural map generation, replacing individual tile storage for efficiency';
COMMENT ON COLUMN public.game_seeds.seed IS 'Deterministic seed string used for client-side map generation';
COMMENT ON COLUMN public.game_seeds.generation_params IS 'Additional parameters for map generation algorithm';

COMMENT ON TABLE public.explored_tiles IS 'Tracks player exploration for fog of war system - only stores tiles players have discovered';
COMMENT ON COLUMN public.explored_tiles.visibility_level IS '0=hidden from player, 1=seen but not currently visible, 2=currently visible';

-- Performance benefits of this migration:
-- Before: 60x60 map = 3,600 database records in map_tiles
-- After: Any size map = 1 database record in game_seeds  
-- Result: ~99.97% reduction in map storage + instant client-side generation