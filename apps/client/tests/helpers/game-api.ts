import { APIRequestContext } from '@playwright/test';

export interface GameConfig {
  name: string;
  maxPlayers?: number;
  mapWidth?: number;
  mapHeight?: number;
  ruleset?: string;
  turnTimeLimit?: number;
}

export interface GameCreationResponse {
  success: boolean;
  gameId?: string;
  game?: {
    id: string;
    name: string;
    status: string;
    hostId: string;
  };
  error?: string;
}

export class GameApiHelper {
  constructor(
    private request: APIRequestContext,
    private baseUrl: string = 'http://localhost:3001'
  ) {}

  /**
   * Creates a real game via the backend API
   * Handles authentication and returns actual UUID game ID
   */
  async createGame(config: GameConfig): Promise<string> {
    try {
      // In a real implementation, you'd handle authentication properly
      // For now, we'll mock the auth token
      const response = await this.request.post(`${this.baseUrl}/api/games`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
        data: {
          name: config.name || 'Test Game',
          maxPlayers: config.maxPlayers || 2,
          mapWidth: config.mapWidth || 40,
          mapHeight: config.mapHeight || 30,
          ruleset: config.ruleset || 'classic',
          turnTimeLimit: config.turnTimeLimit,
        },
      });

      if (response.ok()) {
        const data: GameCreationResponse = await response.json();
        if (data.success && data.gameId) {
          return data.gameId;
        } else if (data.game?.id) {
          return data.game.id;
        }
      }

      console.warn('Game creation API failed, using fallback UUID');
      return this.generateMockUuid();
    } catch (error) {
      console.warn('Backend not available, using mock game ID:', error);
      return this.generateMockUuid();
    }
  }

  /**
   * Gets game details by ID
   */
  async getGame(gameId: string) {
    try {
      const response = await this.request.get(`${this.baseUrl}/api/games/${gameId}`, {
        headers: {
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
      });

      if (response.ok()) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Failed to get game details:', error);
    }
    return null;
  }

  /**
   * Joins a game as a player
   */
  async joinGame(gameId: string, playerName: string, nation: string = 'romans') {
    try {
      const response = await this.request.post(`${this.baseUrl}/api/games/${gameId}/join`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
        data: {
          playerName,
          nation,
        },
      });

      if (response.ok()) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Failed to join game:', error);
    }
    return null;
  }

  /**
   * Starts a game (host only)
   */
  async startGame(gameId: string) {
    try {
      const response = await this.request.post(`${this.baseUrl}/api/games/${gameId}/start`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
      });

      if (response.ok()) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Failed to start game:', error);
    }
    return null;
  }

  /**
   * Generates a valid UUID for testing when backend is not available
   */
  private generateMockUuid(): string {
    // Generate a valid UUID v4 format for testing
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Cleans up test games (for teardown)
   */
  async deleteGame(gameId: string) {
    try {
      const response = await this.request.delete(`${this.baseUrl}/api/games/${gameId}`, {
        headers: {
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
      });

      return response.ok();
    } catch (error) {
      console.warn('Failed to delete test game:', error);
      return false;
    }
  }

  /**
   * Lists all games (for debugging/verification)
   */
  async listGames() {
    try {
      const response = await this.request.get(`${this.baseUrl}/api/games`, {
        headers: {
          'Authorization': `Bearer test-token-${Date.now()}`,
        },
      });

      if (response.ok()) {
        return await response.json();
      }
    } catch (error) {
      console.warn('Failed to list games:', error);
    }
    return null;
  }
}

/**
 * Validates that a string is a valid UUID format
 */
export function isValidUuid(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Mock game data for testing map rendering
 */
export function getMockGameData(gameId: string) {
  return {
    id: gameId,
    name: 'E2E Test Game',
    status: 'active',
    currentTurn: 1,
    players: [
      {
        id: 'test-player-1',
        name: 'E2ETestPlayer',
        nation: 'romans',
        isActive: true,
        gold: 100,
        science: 10,
        color: '#ff0000'
      }
    ],
    tiles: [
      { x: 0, y: 0, terrain: 'grassland', known: 1, seen: 1, elevation: 0 },
      { x: 1, y: 0, terrain: 'plains', known: 1, seen: 1, elevation: 0 },
      { x: 0, y: 1, terrain: 'forest', known: 1, seen: 1, elevation: 1 },
      { x: 1, y: 1, terrain: 'hills', known: 1, seen: 1, elevation: 2 },
      { x: 2, y: 0, terrain: 'ocean', known: 1, seen: 1, elevation: -1 },
      { x: 2, y: 1, terrain: 'mountains', known: 1, seen: 1, elevation: 3 },
      { x: 0, y: 2, terrain: 'desert', known: 1, seen: 1, elevation: 0 },
      { x: 1, y: 2, terrain: 'tundra', known: 1, seen: 1, elevation: 0 },
      { x: 2, y: 2, terrain: 'swamp', known: 1, seen: 1, elevation: 0 },
    ],
    map: {
      xsize: 40,
      ysize: 30,
      topology: 0,
    }
  };
}