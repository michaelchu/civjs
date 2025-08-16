import { create } from 'zustand';
import type { Game } from '../../../shared/types';
import { gameApi } from '../services/api';

interface GameState {
  // Current games list
  games: Game[];
  loading: boolean;
  error: string | null;

  // Current game
  currentGame: Game | null;
  gameState: {
    map: any[];
    units: any[];
    cities: any[];
    players: any[];
    mapWidth: number;
    mapHeight: number;
  } | null;

  // Actions
  loadGames: () => Promise<void>;
  createGame: (name: string, settings: any) => Promise<Game | null>;
  joinGame: (gameId: string, civilization: string) => Promise<boolean>;
  startGame: (gameId: string) => Promise<boolean>;
  loadGameState: (gameId: string) => Promise<void>;
  setCurrentGame: (game: Game | null) => void;
  clearError: () => void;
  deleteGame: (gameId: string) => Promise<boolean>;
}

export const useGameStore = create<GameState>(set => ({
  games: [],
  loading: false,
  error: null,
  currentGame: null,
  gameState: null,

  loadGames: async () => {
    set({ loading: true, error: null });
    try {
      const response = await gameApi.getGames();
      set({ games: response.games, loading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load games',
        loading: false,
      });
    }
  },

  createGame: async (name: string, settings: any) => {
    set({ loading: true, error: null });
    try {
      const response = await gameApi.createGame(name, settings);
      const newGame = response.game;

      // Add the new game to the list and set it as current
      set(state => ({
        games: [...state.games, newGame],
        currentGame: newGame,
        loading: false,
      }));

      return newGame;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create game',
        loading: false,
      });
      return null;
    }
  },

  joinGame: async (gameId: string, civilization: string) => {
    set({ loading: true, error: null });
    try {
      await gameApi.joinGame(gameId, civilization);

      // Reload the current game to get updated player list
      const gameResponse = await gameApi.getGame(gameId);
      set({
        currentGame: gameResponse.game,
        loading: false,
      });

      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to join game',
        loading: false,
      });
      return false;
    }
  },

  startGame: async (gameId: string) => {
    set({ loading: true, error: null });
    try {
      await gameApi.startGame(gameId);

      // Reload the game and game state
      const [gameResponse, gameStateResponse] = await Promise.all([
        gameApi.getGame(gameId),
        gameApi.getGameState(gameId),
      ]);

      set({
        currentGame: gameResponse.game,
        gameState: gameStateResponse,
        loading: false,
      });

      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to start game',
        loading: false,
      });
      return false;
    }
  },

  loadGameState: async (gameId: string) => {
    set({ loading: true, error: null });
    try {
      const response = await gameApi.getGameState(gameId);
      console.log('Game state loaded:', {
        mapTiles: response.map?.length || 0,
        units: response.units?.length || 0,
        cities: response.cities?.length || 0,
        players: response.players?.length || 0,
        mapWidth: response.mapWidth,
        mapHeight: response.mapHeight,
      });
      set({
        gameState: response,
        loading: false,
      });
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : 'Failed to load game state',
        loading: false,
      });
    }
  },

  setCurrentGame: (game: Game | null) => {
    set({ currentGame: game });
  },

  clearError: () => {
    set({ error: null });
  },

  deleteGame: async (gameId: string) => {
    set({ loading: true, error: null });
    try {
      await gameApi.deleteGame(gameId);

      // Remove the game from the list
      set(state => ({
        games: state.games.filter(game => game.id !== gameId),
        loading: false,
        // Clear current game if it was the deleted one
        currentGame:
          state.currentGame?.id === gameId ? null : state.currentGame,
      }));

      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete game',
        loading: false,
      });
      return false;
    }
  },
}));
