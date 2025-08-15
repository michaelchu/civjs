-- CivJS Database Schema for Supabase
-- Run this in your Supabase SQL Editor

-- Enable UUID extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (id)
);

-- Games table
CREATE TABLE IF NOT EXISTS public.games (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed')),
    max_players INTEGER DEFAULT 4 CHECK (max_players >= 2 AND max_players <= 6),
    current_turn INTEGER DEFAULT 1,
    current_player_id UUID,
    created_by UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{
        "mapSize": "small",
        "turnTimer": 300,
        "allowSpectators": false
    }'::jsonb
);

-- Game players junction table
CREATE TABLE IF NOT EXISTS public.game_players (
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    civilization VARCHAR(50) NOT NULL,
    turn_order INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    PRIMARY KEY (game_id, player_id),
    UNIQUE(game_id, turn_order)
);

-- Map tiles table
CREATE TABLE IF NOT EXISTS public.map_tiles (
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    terrain VARCHAR(20) NOT NULL CHECK (terrain IN (
        'grassland', 'plains', 'desert', 'tundra', 'snow',
        'hills', 'mountains', 'forest', 'jungle',
        'coast', 'ocean', 'lake'
    )),
    feature VARCHAR(20),
    resource VARCHAR(30),
    improvement VARCHAR(30),
    owner_id UUID REFERENCES public.profiles(id),
    
    PRIMARY KEY (game_id, x, y)
);

-- Cities table
CREATE TABLE IF NOT EXISTS public.cities (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    population INTEGER DEFAULT 1,
    food_stored INTEGER DEFAULT 0,
    production_stored INTEGER DEFAULT 0,
    buildings JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(game_id, x, y)
);

-- Units table
CREATE TABLE IF NOT EXISTS public.units (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL CHECK (type IN (
        'settler', 'worker', 'warrior', 'scout', 'archer',
        'swordsman', 'spearman'
    )),
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    health INTEGER DEFAULT 100,
    movement_left INTEGER DEFAULT 2,
    experience INTEGER DEFAULT 0,
    promotions JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Player state table (resources, research, etc.)
CREATE TABLE IF NOT EXISTS public.player_state (
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    gold INTEGER DEFAULT 0,
    science_per_turn INTEGER DEFAULT 0,
    culture_per_turn INTEGER DEFAULT 0,
    happiness INTEGER DEFAULT 0,
    policies JSONB DEFAULT '[]'::jsonb,
    
    PRIMARY KEY (game_id, player_id)
);

-- Research progress table
CREATE TABLE IF NOT EXISTS public.player_research (
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    technology VARCHAR(50) NOT NULL,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    PRIMARY KEY (game_id, player_id, technology)
);

-- Game events/history table (for replays and debugging)
CREATE TABLE IF NOT EXISTS public.game_events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
    player_id UUID REFERENCES public.profiles(id),
    turn INTEGER NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_games_status ON public.games(status);
CREATE INDEX IF NOT EXISTS idx_games_created_by ON public.games(created_by);
CREATE INDEX IF NOT EXISTS idx_game_players_game ON public.game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_map_tiles_game ON public.map_tiles(game_id);
CREATE INDEX IF NOT EXISTS idx_map_tiles_owner ON public.map_tiles(owner_id);
CREATE INDEX IF NOT EXISTS idx_cities_game_player ON public.cities(game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_units_game_player ON public.units(game_id, player_id);
CREATE INDEX IF NOT EXISTS idx_units_position ON public.units(game_id, x, y);
CREATE INDEX IF NOT EXISTS idx_game_events_game ON public.game_events(game_id, turn);

-- Enable Row Level Security on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_tiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_research ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_events ENABLE ROW LEVEL SECURITY;
