import { supabase, supabaseAdmin } from '../database/supabase';
import type {
  Game,
  Player,
  GameSettings,
  MapTile,
} from '../../../shared/types';
import { MapGenerationService } from './mapGenerationService';

export class GameService {
  private mapGenerationService = new MapGenerationService();
  // Get or create test user for development
  async getOrCreateTestUser(
    userId: string
  ): Promise<{ data: any | null; error: any }> {
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
          display_name: 'Test User',
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
        max_players:
          settings.mapSize === 'small'
            ? 4
            : settings.mapSize === 'medium'
              ? 6
              : 6,
      })
      .select()
      .single();

    return { data, error };
  }

  // Get all available games
  async getAvailableGames(): Promise<{ data: Game[] | null; error: any }> {
    const { data, error } = await supabaseAdmin
      .from('games')
      .select(
        `
        *,
        game_players(count)
      `
      )
      .in('status', ['waiting', 'active'])
      .order('created_at', { ascending: false });

    return { data, error };
  }

  // Get a specific game with all details
  async getGame(gameId: string): Promise<{ data: any | null; error: any }> {
    const { data, error } = await supabase
      .from('games')
      .select(
        `
        *,
        game_players(
          player_id,
          civilization,
          turn_order,
          is_active,
          profiles(username, display_name)
        )
      `
      )
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
        turn_order: turnOrder,
      })
      .select()
      .single();

    return { data, error };
  }

  // Start a game (generate map and initialize players)
  async startGame(gameId: string): Promise<{ data: any | null; error: any }> {
    try {
      // Get game details
      const { data: game, error: gameError } = await supabaseAdmin
        .from('games')
        .select('*, game_players(player_id, turn_order)')
        .eq('id', gameId)
        .single();

      if (gameError || !game) {
        return { data: null, error: gameError || new Error('Game not found') };
      }

      // Check if game is completed
      if (game.status === 'completed') {
        return { data: null, error: new Error('Game already completed') };
      }

      // Check if map already exists for this game
      const { data: existingMap } = await supabaseAdmin
        .from('map_tiles')
        .select('x')
        .eq('game_id', gameId)
        .limit(1)
        .single();

      // If map exists and game is active, just return success
      if (existingMap && game.status === 'active') {
        return { data: game, error: null };
      }

      // If map exists but game is waiting, update status to active
      if (existingMap && game.status === 'waiting') {
        const { data: updatedGame, error: updateError } = await supabaseAdmin
          .from('games')
          .update({ status: 'active' })
          .eq('id', gameId)
          .select()
          .single();

        return { data: updatedGame, error: updateError };
      }

      // Generate map
      const mapTiles = this.mapGenerationService.generateMap(
        gameId,
        game.settings
      );

      // Get map dimensions for starting positions
      const dimensions = this.mapGenerationService.getMapDimensions(
        game.settings.mapSize
      );

      // Generate starting positions
      const playerCount = game.game_players.length;
      let startingPositions =
        this.mapGenerationService.generateStartingPositions(
          playerCount,
          dimensions
        );

      // Adjust positions if they're on water
      startingPositions = this.mapGenerationService.adjustStartingPositions(
        startingPositions,
        mapTiles,
        dimensions
      );

      // Insert map tiles into database
      const { error: mapError } = await supabaseAdmin.from('map_tiles').insert(
        mapTiles.map(tile => ({
          game_id: gameId,
          x: tile.x,
          y: tile.y,
          terrain: tile.terrain,
          feature: tile.feature,
          resource: tile.resource,
          improvement: tile.improvement,
          owner_id: tile.ownerId,
        }))
      );

      if (mapError) {
        return { data: null, error: mapError };
      }

      // Initialize each player and create starting units
      for (let i = 0; i < game.game_players.length; i++) {
        const player = game.game_players[i];
        const startPos = startingPositions[i];

        if (!startPos) {
          throw new Error(`No starting position available for player ${i + 1}`);
        }

        // Initialize player state
        await this.initializePlayerState(gameId, player.player_id);

        // Create starting units
        await this.createStartingUnits(
          gameId,
          player.player_id,
          startPos.x,
          startPos.y
        );
      }

      // Update game status to active
      const { data: updatedGame, error: updateError } = await supabaseAdmin
        .from('games')
        .update({
          status: 'active',
          current_player_id: game.game_players.sort(
            (a: any, b: any) => a.turn_order - b.turn_order
          )[0]?.player_id,
        })
        .eq('id', gameId)
        .select()
        .single();

      return { data: updatedGame, error: updateError };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Helper method to initialize player state
  private async initializePlayerState(
    gameId: string,
    playerId: string
  ): Promise<void> {
    await supabaseAdmin.from('player_state').insert({
      game_id: gameId,
      player_id: playerId,
      gold: 0,
      science_per_turn: 1,
      culture_per_turn: 1,
      happiness: 5,
    });
  }

  // Helper method to create starting units
  private async createStartingUnits(
    gameId: string,
    playerId: string,
    startX: number,
    startY: number
  ): Promise<void> {
    // Create settler at starting position
    await supabaseAdmin.from('units').insert({
      game_id: gameId,
      player_id: playerId,
      type: 'settler',
      x: startX,
      y: startY,
      health: 100,
      movement_left: 2,
      experience: 0,
    });

    // Create warrior adjacent to settler
    await supabaseAdmin.from('units').insert({
      game_id: gameId,
      player_id: playerId,
      type: 'warrior',
      x: startX + 1,
      y: startY,
      health: 100,
      movement_left: 2,
      experience: 0,
    });
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

    if (mapError)
      return {
        map: null,
        units: null,
        cities: null,
        players: null,
        error: mapError,
      };

    // Get units
    const { data: units, error: unitsError } = await supabase
      .from('units')
      .select('*')
      .eq('game_id', gameId);

    if (unitsError)
      return {
        map,
        units: null,
        cities: null,
        players: null,
        error: unitsError,
      };

    // Get cities
    const { data: cities, error: citiesError } = await supabase
      .from('cities')
      .select('*')
      .eq('game_id', gameId);

    if (citiesError)
      return { map, units, cities: null, players: null, error: citiesError };

    // Get player states
    const { data: players, error: playersError } = await supabase
      .from('player_state')
      .select(
        `
        *,
        profiles(username, display_name)
      `
      )
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
      .eq('player_id', playerId) // Ensure player owns the unit
      .select()
      .single();

    return { data, error };
  }

  // End turn
  async endTurn(
    gameId: string,
    currentPlayerId: string
  ): Promise<{ data: any | null; error: any }> {
    // Get next player in turn order
    const { data: nextPlayer, error: playerError } = await supabase
      .from('game_players')
      .select('player_id, turn_order')
      .eq('game_id', gameId)
      .gt(
        'turn_order',
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
      // Increment turn counter by fetching current value and adding 1
      const { data: currentGame } = await supabase
        .from('games')
        .select('current_turn')
        .eq('id', gameId)
        .single();

      updateData.current_turn = (currentGame?.current_turn || 1) + 1;
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
