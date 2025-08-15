import { supabase, supabaseAdmin } from '../database/supabase';
import type { Game, Player, GameSettings } from '../../../shared/types';

export class GameService {
  // Get or create test user for development
  async getOrCreateTestUser(userId: string): Promise<{ data: any | null; error: any }> {
    try {
      // First try to get existing profile
      const { data: existingProfile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (existingProfile) {
        return { data: existingProfile, error: null };
      }

      // If profile doesn't exist, create it
      const { data: newProfile, error } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          username: 'testuser',
          display_name: 'Test User'
        })
        .select()
        .single();

      return { data: newProfile, error };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Create a new game
  async createGame(
    createdBy: string, 
    name: string, 
    settings: GameSettings
  ): Promise<{ data: Game | null; error: any }> {
    const { data, error } = await supabaseAdmin
      .from('games')
      .insert({
        name,
        created_by: createdBy,
        settings,
        max_players: settings.mapSize === 'small' ? 4 : settings.mapSize === 'medium' ? 6 : 6
      })
      .select()
      .single();

    return { data, error };
  }

  // Get all available games
  async getAvailableGames(): Promise<{ data: Game[] | null; error: any }> {
    const { data, error } = await supabaseAdmin
      .from('games')
      .select(`
        *,
        game_players(count)
      `)
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false });

    return { data, error };
  }

  // Get a specific game with all details
  async getGame(gameId: string): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase
      .from('games')
      .select(`
        *,
        game_players(
          player_id,
          civilization,
          turn_order,
          is_active,
          profiles(username, display_name)
        )
      `)
      .eq('id', gameId)
      .single();

    return { data, error };
  }

  // Join a game
  async joinGame(
    gameId: string, 
    playerId: string, 
    civilization: string
  ): Promise<{ data: any | null; error: any }> {
    // First, get the current player count
    const { data: playerCount, error: countError } = await supabase
      .from('game_players')
      .select('*', { count: 'exact', head: true })
      .eq('game_id', gameId);

    if (countError) return { data: null, error: countError };

    const turnOrder = (playerCount?.length || 0) + 1;

    const { data, error } = await supabase
      .from('game_players')
      .insert({
        game_id: gameId,
        player_id: playerId,
        civilization,
        turn_order: turnOrder
      })
      .select()
      .single();

    return { data, error };
  }

  // Start a game (uses the database function)
  async startGame(gameId: string): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabaseAdmin
      .rpc('start_game', { p_game_id: gameId });

    return { data, error };
  }

  // Get game state (map, units, cities)
  async getGameState(gameId: string): Promise<{ 
    map: any[] | null;
    units: any[] | null; 
    cities: any[] | null;
    players: any[] | null;
    error: any;
  }> {
    // Get map tiles
    const { data: map, error: mapError } = await supabase
      .from('map_tiles')
      .select('*')
      .eq('game_id', gameId);

    if (mapError) return { map: null, units: null, cities: null, players: null, error: mapError };

    // Get units
    const { data: units, error: unitsError } = await supabase
      .from('units')
      .select('*')
      .eq('game_id', gameId);

    if (unitsError) return { map, units: null, cities: null, players: null, error: unitsError };

    // Get cities
    const { data: cities, error: citiesError } = await supabase
      .from('cities')
      .select('*')
      .eq('game_id', gameId);

    if (citiesError) return { map, units, cities: null, players: null, error: citiesError };

    // Get player states
    const { data: players, error: playersError } = await supabase
      .from('player_state')
      .select(`
        *,
        profiles(username, display_name)
      `)
      .eq('game_id', gameId);

    return { map, units, cities, players, error: playersError };
  }

  // Move unit
  async moveUnit(
    unitId: string, 
    newX: number, 
    newY: number, 
    playerId: string
  ): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase
      .from('units')
      .update({ x: newX, y: newY, movement_left: 0 })
      .eq('id', unitId)
      .eq('player_id', playerId)  // Ensure player owns the unit
      .select()
      .single();

    return { data, error };
  }

  // End turn
  async endTurn(gameId: string, currentPlayerId: string): Promise<{ data: any | null; error: any }> {
    // Get next player in turn order
    const { data: nextPlayer, error: playerError } = await supabase
      .from('game_players')
      .select('player_id, turn_order')
      .eq('game_id', gameId)
      .gt('turn_order', 
        await supabase
          .from('game_players')
          .select('turn_order')
          .eq('game_id', gameId)
          .eq('player_id', currentPlayerId)
          .single()
          .then(res => res.data?.turn_order || 0)
      )
      .order('turn_order')
      .limit(1)
      .single();

    let nextPlayerId = nextPlayer?.player_id;
    let newTurn = false;

    // If no next player, wrap to first player and increment turn
    if (!nextPlayerId) {
      const { data: firstPlayer } = await supabase
        .from('game_players')
        .select('player_id')
        .eq('game_id', gameId)
        .order('turn_order')
        .limit(1)
        .single();
      
      nextPlayerId = firstPlayer?.player_id;
      newTurn = true;
    }

    // Update game
    const updateData: any = { current_player_id: nextPlayerId };
    if (newTurn) {
      updateData.current_turn = supabase.raw('current_turn + 1');
    }

    const { data, error } = await supabase
      .from('games')
      .update(updateData)
      .eq('id', gameId)
      .select()
      .single();

    return { data, error };
  }
}
