import type { Game, GameSettings } from '../../../shared/types';

const API_BASE_URL = 'http://localhost:3001/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.error || `HTTP ${response.status}: ${response.statusText}`
    );
  }

  return response.json();
}

export const gameApi = {
  // Get all available games
  async getGames(): Promise<{ games: Game[] }> {
    return apiRequest('/games');
  },

  // Create a new game
  async createGame(
    name: string,
    settings: GameSettings
  ): Promise<{ game: Game }> {
    return apiRequest('/games', {
      method: 'POST',
      body: JSON.stringify({ name, settings }),
    });
  },

  // Get a specific game
  async getGame(gameId: string): Promise<{ game: Game }> {
    return apiRequest(`/games/${gameId}`);
  },

  // Join a game
  async joinGame(
    gameId: string,
    civilization: string
  ): Promise<{ gamePlayer: any }> {
    return apiRequest(`/games/${gameId}/join`, {
      method: 'POST',
      body: JSON.stringify({ civilization }),
    });
  },

  // Start a game
  async startGame(gameId: string): Promise<{ message: string }> {
    return apiRequest(`/games/${gameId}/start`, {
      method: 'POST',
    });
  },

  // Get game state
  async getGameState(gameId: string): Promise<{
    map: any[];
    units: any[];
    cities: any[];
    players: any[];
  }> {
    return apiRequest(`/games/${gameId}/state`);
  },

  // Move unit
  async moveUnit(
    gameId: string,
    unitId: string,
    x: number,
    y: number
  ): Promise<{ unit: any }> {
    return apiRequest(`/games/${gameId}/actions/move-unit`, {
      method: 'POST',
      body: JSON.stringify({ unitId, x, y }),
    });
  },

  // End turn
  async endTurn(gameId: string): Promise<{ game: Game }> {
    return apiRequest(`/games/${gameId}/actions/end-turn`, {
      method: 'POST',
    });
  },
};

export { ApiError };
